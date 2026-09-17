"""
Detector das âncoras do modelo SAE: 4 quadrados pretos nos cantos.

Estratégia (sem ArUco):
1. Pré-processamentos em cascata: gray, CLAHE, blur+Otsu invertido.
2. findContours + filtro (área relativa, 4 vértices, convexo, quadrado, solidez).
3. Se >4 candidatos, escolhe 1 por quadrante (mais próximo do canto da imagem).
4. Ordena TL/TR/BR/BL e valida a geometria do quadrilátero.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .template_sae import CORNER_CENTERS, PAGE_W, PAGE_H

CORNERS_ORDER = ["TL", "TR", "BR", "BL"]


@dataclass
class SaeDetectionResult:
    centers: dict[str, tuple[float, float]]  # canto -> (x, y) na foto
    found: bool
    missing: list[str]


def _square_candidates(gray: np.ndarray) -> list[np.ndarray]:
    h, w = gray.shape[:2]
    img_area = float(h * w)
    # Quadrado de 40px em 1448×2048 ≈ 0.05% da área; aceita ampla faixa de escala.
    min_area = img_area * 0.0001
    max_area = img_area * 0.02

    _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(bw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

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


def _rect_score(ordered: dict[str, tuple[float, float]]) -> float:
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
    tw = abs(CORNER_CENTERS["TR"][0] - CORNER_CENTERS["TL"][0])
    th = abs(CORNER_CENTERS["BL"][1] - CORNER_CENTERS["TL"][1])
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


def _pick_four(
    candidates: list[np.ndarray], w: int, h: int
) -> dict[str, tuple[float, float]] | None:
    """Escolhe o quarteto MAIS RETANGULAR com a proporção das âncoras.

    As âncoras reais formam um retângulo; falsos positivos (padrões do
    QR) entortam o quadrilátero e são rejeitados pelo score.
    """
    import itertools

    if len(candidates) < 4:
        return None
    centers = np.array([[p[:, 0].mean(), p[:, 1].mean()] for p in candidates])
    img_area = float(w * h)

    best: dict[str, tuple[float, float]] | None = None
    best_score = 0.6  # teto: exige forma bem próxima de retângulo
    for combo in itertools.combinations(range(len(centers)), 4):
        quad = centers[list(combo)]
        ordered = _order_quad(quad)
        pts = np.array([ordered[k] for k in CORNERS_ORDER], dtype=np.float32)
        if float(cv2.contourArea(pts)) < img_area * 0.10:
            continue
        score = _rect_score(ordered)
        if score < best_score:
            best_score = score
            best = ordered
    return best


def validate_sae_geometry(centers: dict[str, tuple[float, float]]) -> bool:
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
    tw = abs(CORNER_CENTERS["TR"][0] - CORNER_CENTERS["TL"][0])
    th = abs(CORNER_CENTERS["BL"][1] - CORNER_CENTERS["TL"][1])
    expected = tw / th if th > 0 else PAGE_W / PAGE_H
    if not (expected * 0.7 <= aspect <= expected * 1.3):
        return False
    return True


def detect_sae_corners(image: np.ndarray) -> SaeDetectionResult:
    """Detecta os 4 quadrados. Retorna centros ordenados TL/TR/BR/BL."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
    h, w = gray.shape[:2]

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
            return SaeDetectionResult(centers=chosen, found=True, missing=[])

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
