"""
Detector das âncoras do modelo SAE: 4 quadrados pretos nos cantos.

Estratégia (sem ArUco):
1. Pré-processamentos em cascata: gray, CLAHE, blur+Otsu invertido.
2. findContours + filtro (área relativa, 4 vértices, convexo, quadrado, solidez).
3. Se >4 candidatos, escolhe 1 por quadrante (mais próximo do canto da imagem).
4. Ordena TL/TR/BR/BL e valida a geometria do quadrilátero.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import cv2
import numpy as np

from .template_sae import CORNER_CENTERS, PAGE_W, PAGE_H

CORNERS_ORDER = ["TL", "TR", "BR", "BL"]

# Teto de resolução p/ busca de âncoras: foto 12MP vira ~27MP no upscale
# 1.5x e o findContours/combos estouram em minutos. Acima disso, detecta
# reduzido e remapeia os centros (o refino por momentos corrige sub-pixel).
DETECT_MAX_SIDE = 2000


def downscale_for_detection(gray: np.ndarray, max_side: int = DETECT_MAX_SIDE,
                            ) -> tuple[np.ndarray, float]:
    """Reduz p/ teto de lado maior. Devolve (imagem, escala): coord_original = coord / escala."""
    h, w = gray.shape[:2]
    longest = max(h, w)
    if longest <= max_side:
        return gray, 1.0
    scale = max_side / float(longest)
    small = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    return small, scale


@dataclass
class SaeDetectionResult:
    centers: dict[str, tuple[float, float]]  # canto -> (x, y) na foto
    found: bool
    missing: list[str]
    markers: list = field(default_factory=list)  # ArUcoMarker (só SAEV-ArUco preenche)


def _square_candidates(
    gray: np.ndarray,
    min_area_frac: float = 0.0001,
    max_area_frac: float = 0.02,
) -> list[np.ndarray]:
    h, w = gray.shape[:2]
    img_area = float(h * w)
    # Quadrado de 40px em 1448×2048 ≈ 0.05% da área; aceita ampla faixa de escala.
    min_area = img_area * min_area_frac
    max_area = img_area * max_area_frac

    _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    # RETR_LIST (não EXTERNAL): ilhas brancas dentro do papel fechado
    # (âncoras cercadas de preto) são contornos aninhados e seriam ignoradas.
    contours, _ = cv2.findContours(bw, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

    out = []
    for cnt in contours:
        area = float(cv2.contourArea(cnt))
        if not (min_area <= area <= max_area):
            continue
        peri = float(cv2.arcLength(cnt, True))
        if peri <= 0:
            continue
        approx = cv2.approxPolyDP(cnt, 0.03 * peri, True)
        if len(approx) != 4 or not cv2.isContourConvex(approx):
            continue
        x, y, cw, ch = cv2.boundingRect(approx)
        if ch == 0:
            continue
        aspect = cw / float(ch)
        if not (0.72 <= aspect <= 1.38):
            continue
        rect_area = float(cw * ch)
        solidity = area / rect_area if rect_area > 0 else 0.0
        if solidity < 0.82:
            continue
        out.append(approx.reshape(-1, 2).astype(np.float64))
    return out


def _order_quad(pts: np.ndarray) -> dict[str, tuple[float, float]]:
    """Ordena 4 centros em TL/TR/BR/BL."""
    by_y = sorted(pts.tolist(), key=lambda p: p[1])
    top = sorted(by_y[:2], key=lambda p: p[0])
    bot = sorted(by_y[2:], key=lambda p: p[0])
    return {
        "TL": (float(top[0][0]), float(top[0][1])),
        "TR": (float(top[1][0]), float(top[1][1])),
        "BR": (float(bot[1][0]), float(bot[1][1])),
        "BL": (float(bot[0][0]), float(bot[0][1])),
    }


def _rect_score(
    ordered: dict[str, tuple[float, float]],
    expected_centers: dict[str, tuple[float, float]] = CORNER_CENTERS,
) -> float:
    """0 = retângulo perfeito com a proporção do template; maior = pior."""
    pts = np.array([ordered[k] for k in CORNERS_ORDER], dtype=np.float64)
    tl, tr, br, bl = pts
    top = float(np.linalg.norm(tr - tl))
    bottom = float(np.linalg.norm(br - bl))
    left = float(np.linalg.norm(bl - tl))
    right = float(np.linalg.norm(br - tr))
    if min(top, bottom, left, right) <= 0:
        return float("inf")
    width = (top + bottom) / 2
    height = (left + right) / 2
    tw = abs(expected_centers["TR"][0] - expected_centers["TL"][0])
    th = abs(expected_centers["BL"][1] - expected_centers["TL"][1])
    expected = tw / th if th > 0 else PAGE_W / PAGE_H
    score = (max(top, bottom) / min(top, bottom) - 1.0)
    score += (max(left, right) / min(left, right) - 1.0)
    score += 2.0 * abs(width / height - expected) / expected
    # ângulos internos próximos de 90°
    angs = []
    for i in range(4):
        a = pts[i] - pts[(i - 1) % 4]
        b = pts[(i + 1) % 4] - pts[i]
        cosang = float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))
        angs.append(abs(float(np.degrees(np.arccos(np.clip(cosang, -1, 1)))) - 90.0))
    score += 2.0 * (sum(angs) / len(angs)) / 90.0
    return score


def _order_quads(pts: np.ndarray) -> np.ndarray:
    """Ordena M quadriláteros em TL/TR/BR/BL (versão vetorizada de _order_quad)."""
    m = pts.shape[0]
    rank_y = np.argsort(pts[:, :, 1], axis=1)
    s = pts[np.arange(m)[:, None], rank_y]
    top2, bot2 = s[:, :2, :], s[:, 2:, :]
    top2 = top2[np.arange(m)[:, None], np.argsort(top2[:, :, 0], axis=1)]
    bot2 = bot2[np.arange(m)[:, None], np.argsort(bot2[:, :, 0], axis=1)]
    return np.stack([top2[:, 0], top2[:, 1], bot2[:, 1], bot2[:, 0]], axis=1)


def _quad_areas(ordered: np.ndarray) -> np.ndarray:
    """Área (shoelace) de M quadriláteros já ordenados."""
    x, y = ordered[:, :, 0], ordered[:, :, 1]
    return 0.5 * np.abs(
        x[:, 0] * y[:, 1] + x[:, 1] * y[:, 2] + x[:, 2] * y[:, 3] + x[:, 3] * y[:, 0]
        - y[:, 0] * x[:, 1] - y[:, 1] * x[:, 2] - y[:, 2] * x[:, 3] - y[:, 3] * x[:, 0]
    )


def _rect_scores_vec(ordered: np.ndarray, tw: float, th: float) -> np.ndarray:
    """Versão vetorizada de _rect_score (mesma fórmula e mesmas bordas).

    ordered: (M,4,2) em TL/TR/BR/BL. Devolve (M,) com inf onde houver
    lado degenerado — igual ao `return inf` do escalar.
    """
    tl, tr, br, bl = ordered[:, 0], ordered[:, 1], ordered[:, 2], ordered[:, 3]
    top = np.linalg.norm(tr - tl, axis=1)
    bottom = np.linalg.norm(br - bl, axis=1)
    left = np.linalg.norm(bl - tl, axis=1)
    right = np.linalg.norm(br - tr, axis=1)
    width = (top + bottom) / 2.0
    height = (left + right) / 2.0
    expected = tw / th if th > 0 else PAGE_W / PAGE_H
    with np.errstate(divide="ignore", invalid="ignore"):
        score = (np.maximum(top, bottom) / np.minimum(top, bottom) - 1.0)
        score = score + (np.maximum(left, right) / np.minimum(left, right) - 1.0)
        score = score + 2.0 * np.abs(width / height - expected) / expected
    p = ordered
    a = p - np.roll(p, 1, axis=1)
    b = np.roll(p, -1, axis=1) - p
    cosang = (a * b).sum(-1) / (np.linalg.norm(a, axis=-1) * np.linalg.norm(b, axis=-1) + 1e-9)
    angs = np.abs(np.degrees(np.arccos(np.clip(cosang, -1.0, 1.0))) - 90.0)
    score = score + 2.0 * (angs.mean(axis=1)) / 90.0
    tiny = np.minimum(np.minimum(top, bottom), np.minimum(left, right)) <= 0
    return np.where(tiny, np.inf, score)


def _pick_four(
    candidates: list[np.ndarray], w: int, h: int,
    expected_centers: dict[str, tuple[float, float]] = CORNER_CENTERS,
    time_budget: float = 3.0,
    per_quadrant: int = 25,
) -> dict[str, tuple[float, float]] | None:
    """Escolhe o quarteto MAIS RETANGULAR com a proporção das âncoras.

    As âncoras reais formam um retângulo; falsos positivos (padrões do
    QR) entortam o quadrilátero e são rejeitados pelo score.

    Anti-travamento (foto real com dezenas de candidatos => C(n,4)
    combos em Python puro levava minutos, pendurando a API nos 50%):
    - cada âncora mora perto do seu canto da foto: candidatos são
      fatiados por quadrante (cap per_quadrant por área desc) e os
      combos vêm do produto — não de C(n,4) global;
    - o pré-filtro de área (≥10% da imagem) roda VETORIZADO em numpy:
      390K combos filtrados em ms; só sobreviventes passam pelo
      _rect_score, avaliados por área desc;
    - se algum quadrante fica vazio, fallback para o scan global em
      chunks, com o mesmo teto de tempo (rede de segurança).
    Em foto limpa o resultado é idêntico ao scan completo (mínimo
    global do mesmo score com o mesmo teto 0.6).
    """
    import itertools

    if len(candidates) < 4:
        return None
    areas = np.array([float(cv2.contourArea(c.astype(np.float32))) for c in candidates])
    centers = np.array([[p[:, 0].mean(), p[:, 1].mean()] for p in candidates])
    img_area = float(w * h)
    deadline = time.perf_counter() + max(0.1, time_budget)
    tw = abs(expected_centers["TR"][0] - expected_centers["TL"][0])
    th = abs(expected_centers["BL"][1] - expected_centers["TL"][1])
    state = {"best": None, "best_score": 0.6}  # teto: forma bem próxima de retângulo

    def _scan_idx(idxs: np.ndarray) -> None:
        if idxs.shape[0] == 0 or time.perf_counter() >= deadline:
            return
        ordered = _order_quads(centers[idxs])
        big = _quad_areas(ordered) >= img_area * 0.10
        surv = np.flatnonzero(big)
        if surv.shape[0] == 0:
            return
        scores = _rect_scores_vec(ordered[surv], tw, th)
        k = int(np.argmin(scores))
        if scores[k] < state["best_score"]:
            state["best_score"] = float(scores[k])
            o = ordered[surv[k]]
            state["best"] = {"TL": (float(o[0][0]), float(o[0][1])),
                             "TR": (float(o[1][0]), float(o[1][1])),
                             "BR": (float(o[2][0]), float(o[2][1])),
                             "BL": (float(o[3][0]), float(o[3][1]))}

    # Fase 1: um candidato por quadrante (cantos da foto)
    corners = np.array([[0.0, 0.0], [float(w), 0.0], [float(w), float(h)], [0.0, float(h)]])
    nearest = ((centers[:, None, :] - corners[None, :, :]) ** 2).sum(-1).argmin(1)
    buckets: list[list[int]] = []
    for k in range(4):
        idx = [i for i in range(len(candidates)) if nearest[i] == k]
        idx.sort(key=lambda i: areas[i], reverse=True)
        buckets.append(idx[:per_quadrant])
    if all(buckets):
        _scan_idx(np.array(list(itertools.product(*buckets)), dtype=np.int64))
        if state["best"] is not None:
            return state["best"]

    # Fase 2 (fallback): scan global por área desc, em chunks.
    order = np.argsort(areas)[::-1]
    centers = centers[order]
    it = itertools.combinations(range(len(centers)), 4)
    while time.perf_counter() < deadline:
        chunk = np.array(list(itertools.islice(it, 250000)), dtype=np.int64)
        if chunk.shape[0] == 0:
            break
        _scan_idx(chunk)
    return state["best"]


def validate_sae_geometry(
    centers: dict[str, tuple[float, float]],
    expected_centers: dict[str, tuple[float, float]] = CORNER_CENTERS,
) -> bool:
    """Confere se o quadrilátero é plausível (convexo, proporção A4)."""
    try:
        pts = np.array([centers[k] for k in CORNERS_ORDER], dtype=np.float64)
    except KeyError:
        return False
    if cv2.contourArea(pts.astype(np.float32)) <= 0:
        return False
    tl, tr, br, bl = pts
    top = float(np.linalg.norm(tr - tl))
    bottom = float(np.linalg.norm(br - bl))
    left = float(np.linalg.norm(bl - tl))
    right = float(np.linalg.norm(br - tr))
    if min(top, bottom, left, right) <= 0:
        return False
    # Lados opostos devem ser parecidos (tolerância p/ perspectiva)
    if max(top, bottom) / min(top, bottom) > 1.6:
        return False
    if max(left, right) / min(left, right) > 1.6:
        return False
    width = (top + bottom) / 2
    height = (left + right) / 2
    aspect = width / height
    # Proporção esperada = a do quad de âncoras no template (não a da página)
    tw = abs(expected_centers["TR"][0] - expected_centers["TL"][0])
    th = abs(expected_centers["BL"][1] - expected_centers["TL"][1])
    expected = tw / th if th > 0 else PAGE_W / PAGE_H
    if not (expected * 0.7 <= aspect <= expected * 1.3):
        return False
    return True


def detect_sae_corners(image: np.ndarray) -> SaeDetectionResult:
    """Detecta os 4 quadrados. Retorna centros ordenados TL/TR/BR/BL."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
    gray, ds = downscale_for_detection(gray)
    h, w = gray.shape[:2]

    def _up(centers: dict[str, tuple[float, float]]) -> dict[str, tuple[float, float]]:
        if ds == 1.0:
            return centers
        return {k: (v[0] / ds, v[1] / ds) for k, v in centers.items()}

    attempts: list[np.ndarray] = [gray]
    try:
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        attempts.append(clahe.apply(gray))
    except cv2.error:
        pass
    attempts.append(cv2.GaussianBlur(gray, (5, 5), 0))

    for g in attempts:
        cands = _square_candidates(g)
        chosen = _pick_four(cands, w, h)
        if chosen and validate_sae_geometry(chosen):
            return SaeDetectionResult(centers=_up(chosen), found=True, missing=[])

    # Diagnóstico: quantos quadrantes faltam na melhor tentativa
    best_missing = CORNERS_ORDER
    for g in attempts:
        cands = _square_candidates(g)
        chosen = _pick_four(cands, w, h) or {}
        missing = [k for k in CORNERS_ORDER if k not in chosen]
        if len(missing) < len(best_missing):
            best_missing = missing
    return SaeDetectionResult(centers={}, found=False, missing=best_missing)


def sae_homography(centers: dict[str, tuple[float, float]]) -> np.ndarray | None:
    """Matriz foto -> template 1448×2048 a partir dos 4 centros."""
    try:
        src = np.array([centers[k] for k in CORNERS_ORDER], dtype=np.float32)
        dst = np.array([CORNER_CENTERS[k] for k in CORNERS_ORDER], dtype=np.float32)
    except KeyError:
        return None
    try:
        return cv2.getPerspectiveTransform(src, dst)
    except cv2.error:
        return None
