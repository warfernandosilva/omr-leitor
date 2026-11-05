"""Segunda opinião para marcas na faixa cinzenta (MLP pequeno).

Portado do amazingOMR (`classifier.py`). Quando o score de uma bolha cai
entre "vazia" e "marcada" (0.18–0.40), o OMR fica em dúvida. Em vez de
mandar tudo para revisão (ou para um LLM), um MLP de uma camada escondida
(tanh) vota a partir de 8 features da ROI.

O modelo é treinado com cartões SINTÉTICOS: o próprio gerador do
omr-leitor + distorções (rotação, escala, blur, ruído, sombra, perspectiva,
JPEG) + 10 estilos de marca. Nada de dados de aluno sai da máquina.

Segurança: se o modelo não existir ou a inferência falhar, o motor segue
como antes (`available=False`). O voto nunca vira veredito: só resgata uma
marca com confiança alta e clara dominância.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Sequence, Union

import numpy as np

from .mark_style import MarkStats, mark_stats

FEATURE_NAMES = (
    "darkness",
    "hard_fill",
    "soft_cover",
    "center_fill",
    "ring_fill",
    "uniformity",
    "symmetry",
    "fill",
)
N_FEATURES = len(FEATURE_NAMES)

_MODEL_DIR = Path(__file__).resolve().parent / "models"
_MODEL_PATH = _MODEL_DIR / "second_opinion.npz"
_RING_OUTER = 1.05


def features_from_stats(stats: MarkStats, fill: float) -> np.ndarray:
    return np.array([
        stats.darkness,
        stats.hard_fill,
        stats.soft_cover,
        stats.center_fill,
        stats.ring_fill,
        stats.uniformity,
        stats.symmetry,
        float(fill),
    ], dtype=np.float64)


def _sigmoid(z: np.ndarray) -> np.ndarray:
    out = np.empty_like(z)
    pos = z >= 0
    out[pos] = 1.0 / (1.0 + np.exp(-z[pos]))
    ez = np.exp(z[~pos])
    out[~pos] = ez / (1.0 + ez)
    return out


@dataclass
class SecondOpinionModel:
    W1: np.ndarray
    b1: np.ndarray
    W2: np.ndarray
    b2: np.ndarray
    mean: np.ndarray
    std: np.ndarray
    val_accuracy: float = 0.0

    def prob(self, X: np.ndarray) -> np.ndarray:
        X = np.asarray(X, dtype=np.float64)
        if X.ndim == 1:
            X = X[None, :]
        xs = (X - self.mean) / self.std
        h = np.tanh(xs @ self.W1 + self.b1)
        z = h @ self.W2 + self.b2
        return _sigmoid(z).reshape(-1)

    def save(self, path: str | os.PathLike = _MODEL_PATH) -> None:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        np.savez(p, W1=self.W1, b1=self.b1, W2=self.W2, b2=self.b2,
                 mean=self.mean, std=self.std,
                 val_accuracy=np.float64(self.val_accuracy),
                 feature_names=np.array(FEATURE_NAMES))

    @classmethod
    def load(cls, path: str | os.PathLike = _MODEL_PATH) -> "SecondOpinionModel":
        with np.load(path, allow_pickle=False) as d:
            keys = set(d.files)
            required = ("W1", "b1", "W2", "b2", "mean", "std")
            missing = [k for k in required if k not in keys]
            if missing:
                raise ValueError(f"modelo sem arrays obrigatórios: {missing}")
            arrs = {k: np.asarray(d[k], dtype=np.float64) for k in required}
            val_acc = float(d["val_accuracy"]) if "val_accuracy" in keys else 0.0

        W1, b1, W2, b2 = arrs["W1"], arrs["b1"], arrs["W2"], arrs["b2"]
        mean, std = arrs["mean"], arrs["std"]
        if W1.ndim != 2 or W1.shape[0] != N_FEATURES or W1.shape[1] < 1:
            raise ValueError(f"W1 deve ser ({N_FEATURES}, hidden), veio {W1.shape}")
        hidden = W1.shape[1]
        expected = {"b1": (hidden,), "W2": (hidden, 1), "b2": (1,),
                    "mean": (N_FEATURES,), "std": (N_FEATURES,)}
        for k, shape in expected.items():
            if arrs[k].shape != shape:
                raise ValueError(f"{k} deve ter shape {shape}, veio {arrs[k].shape}")
        for k, a in arrs.items():
            if not np.all(np.isfinite(a)):
                raise ValueError(f"{k} contém valores não finitos")
        std = std.copy()
        std[std < 1e-9] = 1.0
        return cls(W1=W1, b1=b1, W2=W2, b2=b2, mean=mean, std=std,
                   val_accuracy=val_acc if np.isfinite(val_acc) else 0.0)


_MODEL: Optional[SecondOpinionModel] = None


def _try_load() -> None:
    global _MODEL
    try:
        if _MODEL_PATH.exists():
            _MODEL = SecondOpinionModel.load(_MODEL_PATH)
    except Exception:
        _MODEL = None


_try_load()


def is_available() -> bool:
    return _MODEL is not None


def get_model() -> Optional[SecondOpinionModel]:
    return _MODEL


def reload_model() -> bool:
    _try_load()
    return is_available()


def _coerce_features(
    stats_or_features: Union[MarkStats, Sequence[float], np.ndarray],
    fill: Optional[float],
) -> np.ndarray:
    if isinstance(stats_or_features, MarkStats):
        f = stats_or_features.hard_fill if fill is None else float(fill)
        return features_from_stats(stats_or_features, f)
    arr = np.asarray(stats_or_features, dtype=np.float64).reshape(-1)
    if arr.size != N_FEATURES:
        raise ValueError(f"esperava {N_FEATURES} features, veio {arr.size}")
    return arr


def second_opinion(
    stats_or_features: Union[MarkStats, Sequence[float], np.ndarray],
    fill: Optional[float] = None,
) -> dict:
    if _MODEL is None:
        return {"label": "blank", "prob": 0.0, "available": False}
    feats = _coerce_features(stats_or_features, fill)
    p = float(_MODEL.prob(feats)[0])
    return {"label": "marked" if p >= 0.5 else "blank",
            "prob": p, "available": True}


def _bubble_stats(gray: np.ndarray, x: float, y: float, r_px: float,
                  paper: float, ink: float) -> MarkStats:
    pad = int(round(r_px * _RING_OUTER + 3))
    x0, y0 = int(round(x - pad)), int(round(y - pad))
    x1, y1 = int(round(x + pad)), int(round(y + pad))
    h, w = gray.shape[:2]
    x0c, y0c = max(0, x0), max(0, y0)
    patch = gray[y0c:min(h, y1), x0c:min(w, x1)]
    if patch.size == 0:
        return MarkStats(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    if patch.ndim != 2:
        import cv2
        patch = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY)
    return mark_stats(patch, paper, ink, r_px, center=(x - x0c, y - y0c))


def bubble_second_opinion(gray: np.ndarray, x: float, y: float, r_px: float,
                          paper: float, ink: float,
                          fill: Optional[float] = None) -> dict:
    if _MODEL is None:
        return {"label": "blank", "prob": 0.0, "available": False}
    stats = _bubble_stats(gray, x, y, r_px, paper, ink)
    return second_opinion(stats, fill)


# ─── Treino sintético ──────────────────────────────────────────────────────

_MARKED_KINDS = ("full", "pen", "partial", "sloppy", "light",
                 "faint", "faint_dark", "tick", "cross")
_UNMARKED_KINDS = ("ghost",)


def _draw_mark(img: np.ndarray, cx: float, cy: float, r: float,
               kind: str, rng: np.random.Generator) -> None:
    """Desenha uma marca sintética em `(cx, cy)` (BGR uint8)."""
    import cv2

    cxi, cyi, ri = int(round(cx)), int(round(cy)), max(1, int(round(r)))
    if kind in ("full", "pen"):
        radius = ri * (0.72 if kind == "full" else 0.62)
        cv2.circle(img, (cxi, cyi), max(1, int(radius)),
                   int(rng.integers(10, 50)), -1, cv2.LINE_AA)
    elif kind == "partial":
        ox = int(rng.integers(-ri // 3, ri // 3 + 1))
        oy = int(rng.integers(-ri // 3, ri // 3 + 1))
        cv2.circle(img, (cxi + ox, cyi + oy), max(1, int(ri * 0.45)),
                   int(rng.integers(10, 60)), -1, cv2.LINE_AA)
    elif kind == "sloppy":
        axes = (max(1, int(ri * rng.uniform(0.55, 0.85))),
                max(1, int(ri * rng.uniform(0.55, 0.85))))
        cv2.ellipse(img, (cxi, cyi), axes, int(rng.integers(0, 180)), 0, 360,
                    int(rng.integers(10, 55)), -1, cv2.LINE_AA)
    elif kind in ("light", "faint", "faint_dark", "ghost"):
        grey = {"light": 150, "faint": 170, "faint_dark": 60, "ghost": 200}[kind]
        radius = ri * (0.70 if kind != "faint_dark" else 0.52)
        cv2.circle(img, (cxi, cyi), max(1, int(radius)),
                   int(grey + rng.integers(-8, 9)), -1, cv2.LINE_AA)
    elif kind == "tick":
        p1 = (int(cxi - ri * 0.55), int(cyi + ri * 0.05))
        p2 = (int(cxi - ri * 0.10), int(cyi + ri * 0.50))
        p3 = (int(cxi + ri * 0.60), int(cyi - ri * 0.55))
        col = int(rng.integers(15, 45))
        cv2.line(img, p1, p2, col, 3, cv2.LINE_AA)
        cv2.line(img, p2, p3, col, 3, cv2.LINE_AA)
    elif kind == "cross":
        d = ri * 0.62
        col = int(rng.integers(15, 45))
        cv2.line(img, (int(cxi - d), int(cyi - d)),
                 (int(cxi + d), int(cyi + d)), col, 3, cv2.LINE_AA)
        cv2.line(img, (int(cxi - d), int(cyi + d)),
                 (int(cxi + d), int(cyi - d)), col, 3, cv2.LINE_AA)


def _distort(img: np.ndarray, kind: str, seed: int) -> np.ndarray:
    """Distorções baratas que imitam foto de celular/scan."""
    import cv2

    rng = np.random.default_rng(seed)
    h, w = img.shape[:2]
    if kind == "clean":
        return img
    if kind == "rotate":
        angle = float(rng.uniform(-8, 8))
        m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
        return cv2.warpAffine(img, m, (w, h), borderValue=(255, 255, 255))
    if kind == "scale":
        s = float(rng.uniform(0.55, 1.25))
        small = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
        return cv2.resize(small, (w, h), interpolation=cv2.INTER_LINEAR)
    if kind == "blur":
        return cv2.GaussianBlur(img, (0, 0), sigmaX=float(rng.uniform(0.6, 1.8)))
    if kind == "noise":
        noise = rng.normal(0, float(rng.uniform(4, 14)), img.shape)
        return np.clip(img.astype(np.float32) + noise, 0, 255).astype(np.uint8)
    if kind == "shadow":
        grad = np.linspace(float(rng.uniform(0.55, 0.9)), 1.0, w)[None, :, None]
        if rng.random() < 0.5:
            grad = grad[:, ::-1]
        return np.clip(img.astype(np.float32) * grad, 0, 255).astype(np.uint8)
    if kind == "perspective":
        d = float(rng.uniform(0.01, 0.04))
        src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
        dst = np.float32([[w * d, h * d], [w * (1 - d), 0],
                          [w, h], [0, h * (1 - d)]])
        m = cv2.getPerspectiveTransform(src, dst)
        return cv2.warpPerspective(img, m, (w, h),
                                   borderValue=(255, 255, 255))
    if kind == "jpeg":
        ok, buf = cv2.imencode(".jpg", img,
                               [int(cv2.IMWRITE_JPEG_QUALITY), 40])
        if not ok:
            return img
        return cv2.imdecode(buf, cv2.IMREAD_COLOR)
    return img


_DISTORTIONS = ("clean", "rotate", "scale", "blur", "noise", "shadow",
                "perspective", "jpeg")


def _rectify(img: np.ndarray) -> Optional[np.ndarray]:
    """Detecta ArUco, warpa para o template e devolve o cinza com CLAHE."""
    import cv2

    from .detector import detect_markers, get_homography_points
    from .template import PAGE_H, PAGE_W

    det = detect_markers(img)
    if det.missing_ids:
        return None
    src, dst = get_homography_points(det.markers)
    if len(src) == 4:
        m = cv2.getPerspectiveTransform(src, dst)
    else:
        from .config import REPROJ_MAX
        m, _ = cv2.findHomography(src, dst, cv2.RANSAC, REPROJ_MAX)
        if m is None:
            return None
    rect = cv2.warpPerspective(img, m, (PAGE_W, PAGE_H))
    gray = cv2.cvtColor(rect, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    return clahe.apply(gray)


def _estimate_levels(gray: np.ndarray) -> tuple[float, float]:
    """Brilho do papel e nível de tinta da página (percentis robustos)."""
    flat = np.asarray(gray, dtype=np.uint8).reshape(-1)
    if flat.size == 0:
        return 200.0, 40.0
    step = max(1, flat.size // 200_000)
    sample = flat[::step]
    paper = float(np.percentile(sample, 85))
    ink = float(np.percentile(sample, 5))
    if paper - ink < 40.0:
        ink = max(0.0, paper - 40.0)
    return paper, ink


def collect_training_samples(max_questions: int = 22, seeds: int = 2,
                             verbose: bool = False):
    """Gera amostras (features, rótulo, na-faixa-cinzenta) sintéticas."""
    import random

    import cv2

    from .template import (BUBBLE_RADIUS, MAT_X, PAGE_H, PAGE_W, PORT_X,
                           generate_card, question_y_for)

    base = generate_card()
    qys = question_y_for(max_questions)
    cells: list[tuple[int, float, float, float]] = []
    for qi, y in enumerate(qys):
        for x in PORT_X:
            cells.append((qi + 1, float(x), float(y), BUBBLE_RADIUS))
        for x in MAT_X:
            cells.append((qi + 1 + max_questions, float(x), float(y),
                          BUBBLE_RADIUS))

    feats: list[np.ndarray] = []
    labels: list[int] = []
    band: list[bool] = []

    for dist_name in _DISTORTIONS:
        for seed in range(seeds):
            rng = np.random.default_rng(hash((dist_name, seed)) & 0xFFFFFFFF)
            img = base.copy()
            intent: dict[int, dict[str, str]] = {}
            for qi, y in enumerate(qys):
                for group, xs, qnum in (
                    ("PORT", PORT_X, qi + 1),
                    ("MAT", MAT_X, qi + 1 + max_questions),
                ):
                    marks: dict[str, str] = {}
                    if rng.random() < 0.20:
                        intent[qnum] = marks
                        continue
                    letter_i = int(rng.integers(0, len(xs)))
                    kind = _MARKED_KINDS[int(rng.integers(0, len(_MARKED_KINDS)))]
                    marks["ABCD"[letter_i]] = kind
                    _draw_mark(img, xs[letter_i], y, BUBBLE_RADIUS, kind, rng)
                    if rng.random() < 0.25:
                        opts = [i for i in range(len(xs)) if i != letter_i]
                        gi = opts[int(rng.integers(0, len(opts)))]
                        marks["ABCD"[gi]] = "ghost"
                        _draw_mark(img, xs[gi], y, BUBBLE_RADIUS, "ghost", rng)
                    intent[qnum] = marks

            distorted = _distort(img, dist_name, seed)
            gray = _rectify(distorted)
            if gray is None:
                continue

            paper, ink = _estimate_levels(gray)
            for qnum, cx, cy, r in cells:
                marks = intent.get(qnum, {})
                stats = _bubble_stats(gray, cx, cy, r, paper, ink)
                # score de preenchimento igual ao reader (reusa a função)
                from .reader import _bubble_metrics
                fill = _bubble_metrics(gray, int(round(cx)), int(round(cy)),
                                       radius=max(3, int(round(r)) - 2)).score
                label = 1 if any(k in _MARKED_KINDS for k in marks.values()) else 0
                feats.append(features_from_stats(stats, fill))
                labels.append(label)
                band.append(0.18 <= fill <= 0.40)
            if verbose:
                print(f"  [{dist_name} seed={seed}] {len(feats)} amostras")

    return (np.asarray(feats, dtype=np.float64),
            np.asarray(labels, dtype=np.int64),
            np.asarray(band, dtype=bool))


def _train_mlp(X: np.ndarray, y: np.ndarray, sample_w: np.ndarray,
               hidden: int = 16, iters: int = 3000, lr: float = 0.05,
               l2: float = 1e-4, seed: int = 20240117):
    rng = np.random.default_rng(seed)
    mean = X.mean(axis=0)
    std = X.std(axis=0)
    std[std < 1e-6] = 1.0
    xs = (X - mean) / std
    n, d = xs.shape

    W1 = rng.normal(0, np.sqrt(1.0 / d), (d, hidden))
    b1 = np.zeros(hidden)
    W2 = rng.normal(0, np.sqrt(1.0 / hidden), (hidden, 1))
    b2 = np.zeros(1)

    y = y.reshape(-1, 1).astype(np.float64)
    w = sample_w.reshape(-1, 1).astype(np.float64)
    w = w / max(w.mean(), 1e-9)
    wsum = max(float(w.sum()), 1e-9)

    params = [W1, b1, W2, b2]
    m = [np.zeros_like(p) for p in params]
    v = [np.zeros_like(p) for p in params]
    beta1, beta2, eps = 0.9, 0.999, 1e-8

    for t in range(1, iters + 1):
        z1 = xs @ W1 + b1
        h = np.tanh(z1)
        p = _sigmoid(h @ W2 + b2)

        dz2 = (p - y) * w / wsum
        gW2 = h.T @ dz2 + l2 * W2
        gb2 = dz2.sum(axis=0)
        dh = dz2 @ W2.T
        dz1 = dh * (1.0 - h * h)
        gW1 = xs.T @ dz1 + l2 * W1
        gb1 = dz1.sum(axis=0)

        for i, (pr, g) in enumerate(zip(params, [gW1, gb1, gW2, gb2])):
            m[i] = beta1 * m[i] + (1 - beta1) * g
            v[i] = beta2 * v[i] + (1 - beta2) * g * g
            mhat = m[i] / (1 - beta1 ** t)
            vhat = v[i] / (1 - beta2 ** t)
            pr -= lr * mhat / (np.sqrt(vhat) + eps)
        W1, b1, W2, b2 = params

    return W1, b1, W2, b2, mean, std


def train_second_opinion(save_path: str | os.PathLike = _MODEL_PATH,
                         hidden: int = 16, iters: int = 3000,
                         verbose: bool = True) -> dict:
    """Treina o MLP sinteticamente e grava o `.npz`."""
    if verbose:
        print("second-opinion: coletando amostras sintéticas...", flush=True)
    X, y, band = collect_training_samples(verbose=verbose)
    if len(y) == 0:
        raise RuntimeError("nenhuma amostra sintética gerada")

    rng = np.random.default_rng(7)
    idx = rng.permutation(len(y))
    n_val = max(1, int(0.2 * len(y)))
    val_idx, tr_idx = idx[:n_val], idx[n_val:]
    Xtr, ytr, btr = X[tr_idx], y[tr_idx], band[tr_idx]
    Xva, yva, bva = X[val_idx], y[val_idx], band[val_idx]

    w = np.ones(len(ytr))
    pos = ytr == 1
    n_pos = max(1, int(pos.sum()))
    n_neg = max(1, int((~pos).sum()))
    w[pos] *= 0.5 * len(ytr) / n_pos
    w[~pos] *= 0.5 * len(ytr) / n_neg
    w[btr] *= 2.5

    W1, b1, W2, b2, mean, std = _train_mlp(
        Xtr, ytr.astype(np.float64), w, hidden=hidden, iters=iters)
    model = SecondOpinionModel(W1, b1, W2, b2, mean, std)

    def _acc(Xe, ye):
        if len(ye) == 0:
            return float("nan")
        pred = (model.prob(Xe) >= 0.5).astype(int)
        return float((pred == ye).mean())

    val_acc = _acc(Xva, yva)
    band_acc = _acc(Xva[bva], yva[bva])
    model.val_accuracy = val_acc
    model.save(save_path)
    reload_model()

    metrics = {
        "n_samples": int(len(y)),
        "n_marked": int(y.sum()),
        "n_band": int(band.sum()),
        "val_accuracy": round(val_acc, 4),
        "band_val_accuracy": None if band_acc != band_acc else round(band_acc, 4),
        "n_band_val": int(bva.sum()),
        "saved_to": str(save_path),
    }
    if verbose:
        print(f"second-opinion: val acc {val_acc:.4f}, faixa cinzenta "
              f"{band_acc:.4f} (n={int(bva.sum())}) -> {save_path}", flush=True)
    return metrics


if __name__ == "__main__":  # pragma: no cover - build manual do modelo
    train_second_opinion()
