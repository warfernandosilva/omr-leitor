"""
Detector das âncoras do modelo SAEV: 4 quadrados pretos (par superior na
altura dos títulos, par inferior no rodapé) — sem ArUco.

Reaproveita a cascata de detector_sae com os centros esperados do SAEV
(quadrados ~75px; faixa de área ampliada).
"""

from __future__ import annotations

import cv2
import numpy as np

from .detector_sae import (
    CORNERS_ORDER,
    SaeDetectionResult,
    _order_quad,
    _pick_four,
    _square_candidates,
    validate_sae_geometry,
)
from .template_saev import SAEV_CORNER_CENTERS, SAEV_SQUARE, PAGE_W, PAGE_H

# Quadrado de 75px em 1448×2048 ≈ 0.19% da área; foto de longe cai p/
# ~0.01%. Mínimo baixo é seguro: o filtro de quadrilátero (área ≥10% da
# imagem + proporção) rejeita falsos pequenos (letras, finders do QR).
SAEV_MIN_AREA_FRAC = 0.0001
SAEV_MAX_AREA_FRAC = 0.03


def _refine_centers(
    gray: np.ndarray, centers: dict[str, tuple[float, float]]
) -> dict[str, tuple[float, float]]:
    """Refino dos centros via centroides de momentos (subpixel).

    O centro vindo da média dos vértices do approxPolyDP tem viés de
    alguns px; o centroide de momentos do quadrado limiarizado é mais
    estável e cada px conta na homografia da grade. Escolhe o contorno
    quadrado MAIS PRÓXIMO do centro de entrada (não o maior: em foto de
    longe o título/texto vizinho pode ser maior que a âncora).
    """
    h, w = gray.shape[:2]
    out: dict[str, tuple[float, float]] = {}
    for k, (cx, cy) in centers.items():
        try:
            x0 = max(0, int(cx - 70)); y0 = max(0, int(cy - 70))
            x1 = min(w, int(cx + 70)); y1 = min(h, int(cy + 70))
            roi = gray[y0:y1, x0:x1]
            if roi.size == 0:
                raise ValueError("roi vazio")
            _, bw = cv2.threshold(roi, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
            contours, _ = cv2.findContours(bw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            best = None
            best_d2 = float("inf")
            for cnt in contours:
                area = float(cv2.contourArea(cnt))
                if area < 25:
                    continue
                peri = float(cv2.arcLength(cnt, True))
                if peri <= 0:
                    continue
                approx = cv2.approxPolyDP(cnt, 0.03 * peri, True)
                if len(approx) != 4 or not cv2.isContourConvex(approx):
                    continue
                bx, by, cw, ch = cv2.boundingRect(approx)
                if ch == 0 or not (0.6 <= cw / float(ch) <= 1.4):
                    continue
                if area / float(cw * ch) < 0.7:
                    continue
                m = cv2.moments(cnt)
                if m["m00"] <= 0:
                    continue
                qx, qy = x0 + m["m10"] / m["m00"], y0 + m["m01"] / m["m00"]
                d2 = (qx - cx) ** 2 + (qy - cy) ** 2
                if d2 < best_d2:
                    best_d2 = d2
                    best = (qx, qy)
            # Só aceita se perto da entrada (evita pular p/ texto vizinho)
            if best is None or best_d2 > 60 ** 2:
                raise ValueError("sem quadrado próximo")
            out[k] = best
        except (cv2.error, ValueError):
            out[k] = (cx, cy)
    return out


def detect_saev_corners(image: np.ndarray) -> SaeDetectionResult:
    """Detecta os 4 quadrados SAEV. Retorna centros ordenados TL/TR/BR/BL."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image

    try:
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        preprocess = [lambda g: g, clahe.apply, lambda g: cv2.GaussianBlur(g, (5, 5), 0)]
    except cv2.error:
        preprocess = [lambda g: g, lambda g: cv2.GaussianBlur(g, (5, 5), 0)]

    # Multiescala: foto de longe tem âncoras pequenas; 1.5x ajuda o
    # approxPolyDP em pixels absolutos (a fração de área não muda).
    # Cap de candidatos: _pick_four é O(n^4); âncoras reais estão entre
    # os maiores, então mantém só os 80 maiores por área.
    for scale in (1.0, 1.5):
        g0 = gray if scale == 1.0 else cv2.resize(
            gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        h, w = g0.shape[:2]
        for fn in preprocess:
            try:
                g = fn(g0)
            except cv2.error:
                continue
            cands = _square_candidates(g, SAEV_MIN_AREA_FRAC, SAEV_MAX_AREA_FRAC)
            if len(cands) > 80:
                cands = sorted(
                    cands,
                    key=lambda p: float(cv2.contourArea(p.astype(np.float32))),
                    reverse=True,
                )[:80]
            chosen = _pick_four(cands, w, h, SAEV_CORNER_CENTERS)
            if chosen and validate_sae_geometry(chosen, SAEV_CORNER_CENTERS):
                if scale != 1.0:
                    chosen = {k: (v[0] / scale, v[1] / scale) for k, v in chosen.items()}
                    gray_full = gray
                else:
                    gray_full = g0
                chosen = _refine_centers(gray_full, chosen)
                return SaeDetectionResult(centers=chosen, found=True, missing=[])

    # Diagnóstico: quantos quadrantes faltam na melhor tentativa
    best_missing = CORNERS_ORDER
    g0 = gray
    h, w = g0.shape[:2]
    for fn in preprocess:
        try:
            cands = _square_candidates(fn(g0), SAEV_MIN_AREA_FRAC, SAEV_MAX_AREA_FRAC)
        except cv2.error:
            continue
        chosen = _pick_four(cands, w, h, SAEV_CORNER_CENTERS) or {}
        missing = [k for k in CORNERS_ORDER if k not in chosen]
        if len(missing) < len(best_missing):
            best_missing = missing
    return SaeDetectionResult(centers={}, found=False, missing=best_missing)


def saev_homography(centers: dict[str, tuple[float, float]]) -> np.ndarray | None:
    """Matriz foto -> template 1448×2048 a partir dos 4 centros SAEV."""
    try:
        src = np.array([centers[k] for k in CORNERS_ORDER], dtype=np.float32)
        dst = np.array([SAEV_CORNER_CENTERS[k] for k in CORNERS_ORDER], dtype=np.float32)
    except KeyError:
        return None
    try:
        return cv2.getPerspectiveTransform(src, dst)
    except cv2.error:
        return None


__all__ = [
    "SAEV_MIN_AREA_FRAC", "SAEV_MAX_AREA_FRAC",
    "detect_saev_corners", "saev_homography",
    "PAGE_W", "PAGE_H", "SAEV_SQUARE",
    "_order_quad",
]
