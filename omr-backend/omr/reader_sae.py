"""
Leitor OMR do modelo SAE (Avaliação Contínua).

Pipeline:
1. Detectar 4 quadrados -> homografia foto->template 1448×2048
2. Warp + CLAHE + checagem de blur
3. QR Code da ficha cinza (identifica o cartão)
4. Leitura das bolhas A–D (reaproveita _bubble_score e limiares do modelo padrão)
"""

from __future__ import annotations

import cv2
import numpy as np
import time as _time

from .config import BLUR_BLOCK, MARGIN
from .tuning import compute_floor_for
from .detector_sae import detect_sae_corners, sae_homography
from .reader import OMRResult, _bubble_score, _decode_qr_from, classify_question
from .template_sae import (
    PAGE_W, PAGE_H,
    SAE_BLOCKS_X, SAE_BUBBLE_DX, SAE_BUBBLE_RADIUS,
    SAE_FIRST_ROW_Y, SAE_ROW_STEP, SAE_ROWS_PER_BLOCK,
    SAE_MAX_QUESTIONS,
    SAE_QR_POS, SAE_QR_SIZE,
    sae_block_rows,
)


def _decode_sae_qr(gray_rectified: np.ndarray) -> str | None:
    qx, qy = SAE_QR_POS
    half = SAE_QR_SIZE // 2 + 40
    cx, cy = qx + SAE_QR_SIZE // 2, qy + SAE_QR_SIZE // 2
    h, w = gray_rectified.shape[:2]
    x0 = max(0, int(cx - half)); y0 = max(0, int(cy - half))
    x1 = min(w, int(cx + half)); y1 = min(h, int(cy + half))
    if x1 <= x0 or y1 <= y0:
        return None
    crop = gray_rectified[y0:y1, x0:x1]
    data = _decode_qr_from(crop)
    if data:
        return data
    big = cv2.resize(crop, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    return _decode_qr_from(big)


def process_sae_image(
    image: np.ndarray,
    n_questions: int | None = None,
    adaptive: bool = False,
    debug: bool = False,
) -> OMRResult | None:
    """Pipeline completo OMR-SAE. n_questions = total de questões (1..28)."""
    n = max(1, min(SAE_MAX_QUESTIONS, int(n_questions or 26)))

    _t0 = _time.perf_counter()
    det = detect_sae_corners(image)
    t_detect = _time.perf_counter() - _t0
    if not det.found:
        return None

    M = sae_homography(det.centers)
    if M is None:
        return None
    _t1 = _time.perf_counter()
    try:
        rectified = cv2.warpPerspective(image, M, (PAGE_W, PAGE_H))
    except cv2.error:
        return None
    t_warp = _time.perf_counter() - _t1

    gray = cv2.cvtColor(rectified, cv2.COLOR_BGR2GRAY) if len(rectified.shape) == 3 else rectified

    blur_var = cv2.Laplacian(gray, cv2.CV_64F).var()
    if blur_var < BLUR_BLOCK:
        return None

    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)

    _t2 = _time.perf_counter()
    qr_id = _decode_sae_qr(gray)
    t_qr = _time.perf_counter() - _t2
    _t3 = _time.perf_counter()

    letters = ["A", "B", "C", "D"]
    # Máscara um pouco menor que a bolha: ignora o contorno impresso e mede
    # só o interior (marca de lápis/caneta). Bolhas vazias ≈ 0.05.
    radius = max(6, int(round(SAE_BUBBLE_RADIUS)) - 2)
    all_ratios: dict[int, dict[str, float]] = {}
    geom: dict[int, list] = {}

    for q, b, r in sae_block_rows(n):
        y = SAE_FIRST_ROW_Y + r * SAE_ROW_STEP
        bx = SAE_BLOCKS_X[b]
        q_ratios: dict[str, float] = {}
        q_geom: list = []
        for i, dx in enumerate(SAE_BUBBLE_DX):
            score = _bubble_score(gray, bx + dx, y, radius=radius)
            q_ratios[letters[i]] = score
            if debug:
                q_geom.append((bx + dx, y, SAE_BUBBLE_RADIUS, letters[i]))
        all_ratios[q] = q_ratios
        if debug:
            geom[q] = q_geom

    answers: dict[int, str] = {}
    blank: list[int] = []
    duplicates: list[int] = []
    dup_marks: dict[int, list[str]] = {}
    low_conf: list[int] = []

    floor, floor_source = compute_floor_for("sae", all_ratios, adaptive)

    for q_num, ratios in all_ratios.items():
        status, best_letter, marks = classify_question(ratios, floor=floor, margin=MARGIN)
        if status == "blank":
            blank.append(q_num)
        elif status == "duplicate":
            duplicates.append(q_num)
            dup_marks[q_num] = marks
        elif status == "low":
            low_conf.append(q_num)
            answers[q_num] = best_letter  # type: ignore[assignment]
        else:
            answers[q_num] = best_letter  # type: ignore[assignment]

    t_score = _time.perf_counter() - _t3

    debug_points = None
    if debug:
        from .debug import build_debug_points
        debug_points = build_debug_points(geom, all_ratios, answers, blank, duplicates, low_conf)

    return OMRResult(
        answers=answers,
        blank_questions=blank,
        duplicate_questions=duplicates,
        low_confidence=low_conf,
        all_ratios=all_ratios,
        rectified=rectified,
        qr_id=qr_id,
        duplicate_marks=dup_marks,
        floor_used=floor,
        floor_source=floor_source,
        t_detect=t_detect,
        t_warp=t_warp,
        t_qr=t_qr,
        t_score=t_score,
        debug_points=debug_points,
    )
