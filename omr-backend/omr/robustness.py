"""
Harness de regressão de legibilidade (Fase 4) — QA, não faz parte do
caminho de produção.

Gera um cartão com gabarito conhecido, aplica degradações sintéticas
reproduzíveis (seed fixa) e mede a acurácia do reader REAL de produção
(`omr.reader.process_image`). Nenhum pipeline paralelo: a leitura é sempre
a mesma que roda no app.

Uso como script (relatório por condição):

    python -m omr.robustness

Regras do dataset:
- rotação 0–180° (cartão inteiro visível, reenquadrado);
- escala menor (cartão reduzido e centralizado);
- perspectiva (cantos do cartão deslocados sobre fundo branco);
- JPEG de baixa qualidade;
- combinações (pior caso).

O baseline medido vira assert em `test_robustness.py`.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .reader import process_image
from .template import (
    ARUCO_CENTERS,
    ARUCO_SIZE,
    BUBBLE_RADIUS,
    MAT_X,
    PAGE_H,
    PAGE_W,
    PORT_X,
    QUESTIONS_PER_SUBJECT,
    generate_card,
    question_y_for,
)

LETTERS = ["A", "B", "C", "D"]


@dataclass(frozen=True)
class Condition:
    """Uma variante degradada do cartão, pronta para `process_image`."""
    name: str
    image: np.ndarray


@dataclass(frozen=True)
class Accuracy:
    """Resultado da leitura de uma variante."""
    condition: str
    read: bool
    correct: int
    total: int
    errors: dict[int, tuple[str, str | None]]

    @property
    def accuracy(self) -> float:
        return self.correct / self.total if self.total else 0.0


# ─── Gabarito e preenchimento ───

def answer_key(qps: int = QUESTIONS_PER_SUBJECT) -> dict[int, str]:
    """Gabarito conhecido: PORT A,B,C,D… / MAT D,C,B,A… (1-based)."""
    key: dict[int, str] = {}
    for q in range(qps):
        key[q + 1] = LETTERS[q % 4]
    for q in range(qps):
        key[q + qps + 1] = LETTERS[3 - (q % 4)]
    return key


def fill_answers(
    card: np.ndarray,
    key: dict[int, str] | None = None,
    qps: int = QUESTIONS_PER_SUBJECT,
) -> dict[int, str]:
    """Preenche as bolhas do gabarito no cartão (in-place) e devolve a chave."""
    key = key or answer_key(qps)
    ys = question_y_for(qps)
    inner = max(6, int(BUBBLE_RADIUS) - 3)
    for q in range(1, qps + 1):
        alt = LETTERS.index(key[q])
        cv2.circle(card, (int(PORT_X[alt]), int(ys[q - 1])), inner, (0, 0, 0), -1)
    for q in range(qps + 1, 2 * qps + 1):
        alt = LETTERS.index(key[q])
        cv2.circle(card, (int(MAT_X[alt]), int(ys[q - qps - 1])), inner, (0, 0, 0), -1)
    return key


def filled_card(qps: int = QUESTIONS_PER_SUBJECT) -> tuple[np.ndarray, dict[int, str]]:
    """Cartão padrão com todas as 44 respostas preenchidas + gabarito."""
    card = generate_card(questions_per_subject=qps)
    key = fill_answers(card, qps=qps)
    return card, key


# ─── Degradações (determinísticas) ───

def _reframe(img: np.ndarray, M: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    """Aplica M num canvas branco (nada cortado) e reenquadra a 1448×2048."""
    h, w = img.shape[:2]
    big = cv2.warpAffine(img, M, size, borderValue=(255, 255, 255))
    scale = min(w / size[0], h / size[1])
    small = cv2.resize(big, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    canvas = np.ones((h, w, 3), dtype=np.uint8) * 255
    sh, sw = small.shape[:2]
    y0, x0 = (h - sh) // 2, (w - sw) // 2
    canvas[y0:y0 + sh, x0:x0 + sw] = small
    return canvas


def rotate(img: np.ndarray, angle_deg: float) -> np.ndarray:
    """Rotação com cartão inteiro visível (como uma foto de cartão torto)."""
    h, w = img.shape[:2]
    diag = int(np.ceil(np.hypot(w, h)))
    M = cv2.getRotationMatrix2D((w / 2, h / 2), angle_deg, 1.0)
    M[0, 2] += (diag - w) / 2
    M[1, 2] += (diag - h) / 2
    return _reframe(img, M, (diag, diag))


def scale(img: np.ndarray, factor: float) -> np.ndarray:
    """Reduz o cartão e centraliza sobre fundo branco."""
    h, w = img.shape[:2]
    small = cv2.resize(img, None, fx=factor, fy=factor, interpolation=cv2.INTER_AREA)
    canvas = np.ones((h, w, 3), dtype=np.uint8) * 255
    sh, sw = small.shape[:2]
    y0, x0 = max(0, (h - sh) // 2), max(0, (w - sw) // 2)
    canvas[y0:y0 + sh, x0:x0 + sw] = small
    return canvas


def perspective(img: np.ndarray, amount_px: float, seed: int = 0) -> np.ndarray:
    """Tilt de câmera: desloca os 4 cantos do cartão até `amount_px`.

    O cartão é colocado sobre um fundo branco com margem para que o tilt
    não recorte os marcadores (cenário real de foto com cartão inteiro).
    """
    h, w = img.shape[:2]
    pad = int(max(w, h) * 0.15)
    cw, ch = w + 2 * pad, h + 2 * pad
    canvas = np.ones((ch, cw, 3), dtype=np.uint8) * 255
    canvas[pad:pad + h, pad:pad + w] = img

    rng = np.random.default_rng(seed)
    src = np.float32([[pad, pad], [pad + w, pad], [pad + w, pad + h], [pad, pad + h]])
    jitter = rng.uniform(-amount_px, amount_px, size=(4, 2))
    dst = (src.astype(np.float64) + jitter)
    dst[:, 0] = np.clip(dst[:, 0], 0, cw - 1)
    dst[:, 1] = np.clip(dst[:, 1], 0, ch - 1)
    dst = np.ascontiguousarray(dst, dtype=np.float32)
    M = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(canvas, M, (cw, ch), borderValue=(255, 255, 255))


def jpeg(img: np.ndarray, quality: int) -> np.ndarray:
    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), int(quality)])
    assert ok, "falha ao codificar JPEG"
    return cv2.imdecode(buf, cv2.IMREAD_COLOR)


def cover_marker(img: np.ndarray, marker_id: int, pad: int = 12) -> np.ndarray:
    """Cobre um marcador ArUco com um quadrado branco (marca ausente)."""
    out = img.copy()
    cx, cy = ARUCO_CENTERS[marker_id]
    half = ARUCO_SIZE // 2 + pad
    cv2.rectangle(out, (cx - half, cy - half), (cx + half, cy + half), (255, 255, 255), -1)
    return out


# ─── Dataset e medição ───

def build_variants(seed: int = 42) -> tuple[dict[int, str], list[Condition]]:
    """Dataset determinístico de variantes + gabarito compartilhado."""
    card, key = filled_card()
    conds = [
        Condition("clean", card),
        Condition("rot_0", rotate(card, 0)),
        Condition("rot_45", rotate(card, 45)),
        Condition("rot_90", rotate(card, 90)),
        Condition("rot_135", rotate(card, 135)),
        Condition("rot_180", rotate(card, 180)),
        Condition("scale_0.50", scale(card, 0.50)),
        Condition("scale_0.30", scale(card, 0.30)),
        Condition("scale_0.18", scale(card, 0.18)),
        Condition("persp_100", perspective(card, 100, seed)),
        Condition("persp_250", perspective(card, 250, seed + 1)),
        Condition("persp_500", perspective(card, 500, seed + 2)),
        Condition("jpeg_q20", jpeg(card, 20)),
        Condition("jpeg_q5", jpeg(card, 5)),
        Condition("combo_rot45_jpeg20", jpeg(rotate(card, 45), 20)),
        Condition("combo_scale0.5_persp100_jpeg20",
                  jpeg(perspective(scale(card, 0.5), 100, seed + 3), 20)),
    ]
    return key, conds


def measure(condition: Condition, key: dict[int, str]) -> Accuracy:
    """Roda o reader de produção e compara com o gabarito."""
    result = process_image(condition.image)
    if result is None:
        return Accuracy(condition.name, False, 0, len(key), {q: (exp, None) for q, exp in key.items()})
    correct = 0
    errors: dict[int, tuple[str, str | None]] = {}
    for q, exp in key.items():
        got = result.answers.get(q)
        if got == exp:
            correct += 1
        else:
            errors[q] = (exp, got)
    return Accuracy(condition.name, True, correct, len(key), errors)


def run_dataset(seed: int = 42) -> list[Accuracy]:
    key, conds = build_variants(seed)
    return [measure(c, key) for c in conds]


def report(rows: list[Accuracy]) -> str:
    lines = [f"{'condição':34s} {'leu':>4s} {'acertos':>8s}  erros"]
    for a in rows:
        tag = "sim" if a.read else "NÃO"
        lines.append(f"{a.condition:34s} {tag:>4s} {a.correct:>3d}/{a.total:<3d}  {len(a.errors)}")
    return "\n".join(lines)


if __name__ == "__main__":
    print(report(run_dataset()))
