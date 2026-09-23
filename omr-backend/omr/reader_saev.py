"""
Leitor OMR do modelo SAEV (Gabarito SAEV).

Pipeline:
1. Detectar 4 quadrados -> homografia foto->template 1448×2048
2. Warp + CLAHE + checagem de blur
3. QR do sistema no topo-esquerdo (identifica o cartão)
4. Leitura das bolhas QUADRADAS A–D (score próprio + limiares padrão)
"""

from __future__ import annotations

import cv2
import numpy as np
import time as _time

from .config import BLUR_BLOCK, MARGIN
from .tuning import compute_floor_for
from .detector_saev import detect_saev_corners, saev_homography, saev_homography_aruco
from .reader import (
    OMRResult,
    _decode_qr_from,
    _estimate_paper_brightness,
    classify_question,
)
from .template_saev import (
    PAGE_W, PAGE_H,
    SAEV_COLS_X, SAEV_NUM_W, SAEV_PITCH, SAEV_SIDE,
    SAEV_QR_POS, SAEV_QR_SIZE,
    SAEV_MAX_QPS,
    saev_block_rows, saev_bubble_center,
)


def _square_score(
    gray: np.ndarray, cx: float, cy: float, side: float = SAEV_SIDE, inset: int = 6
) -> float:
    """Score 0..1 de preenchimento do interior do quadrado.

    Mesma ponderação do _bubble_score circular (0.4 média + 0.4 razão
    escura + 0.2 contraste), com máscara quadrada insetada para ignorar
    o traço impresso. Quadrado vazio ≈ 0.05.
    """
    half = side / 2 - inset
    if half <= 0:
        return 0.0
    h, w = gray.shape[:2]
    margin = 4
    x0 = max(0, int(cx - half - margin)); y0 = max(0, int(cy - half - margin))
    x1 = min(w, int(cx + half + margin + 1)); y1 = min(h, int(cy + half + margin + 1)
    )
    roi = gray[y0:y1, x0:x1]
    if roi.size == 0:
        return 0.0

    _, binary = cv2.threshold(roi, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    yy, xx = np.ogrid[:roi.shape[0], :roi.shape[1]]
    lx, ly = cx - x0, cy - y0
    mask = (np.abs(xx - lx) <= half) & (np.abs(yy - ly) <= half)
    if mask.sum() == 0:
        return 0.0

    brightness = _estimate_paper_brightness(gray, int(cx), int(cy), int(half))
    mean_intensity = 1.0 - (float(np.mean(roi[mask])) / 255.0)
    dark_ratio = float((binary[mask] > 0).sum()) / float(mask.sum())
    contrast = max(0, (brightness - float(np.mean(roi[mask]))) / 255.0)
    return 0.4 * mean_intensity + 0.4 * dark_ratio + 0.2 * contrast


def _decode_saev_qr(gray_rectified: np.ndarray) -> str | None:
    qx, qy = SAEV_QR_POS
    half = SAEV_QR_SIZE // 2 + 40
    cx, cy = qx + SAEV_QR_SIZE // 2, qy + SAEV_QR_SIZE // 2
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


def process_saev_image(
    image: np.ndarray,
    questions_per_subject: int | None = None,
    adaptive: bool = False,
    debug: bool = False,
) -> OMRResult | None:
    """Pipeline completo OMR-SAEV. questions_per_subject = por disciplina (16..26)."""
    qps = max(1, min(SAEV_MAX_QPS, int(questions_per_subject or 22)))

    _t0 = _time.perf_counter()
    det = detect_saev_corners(image)
    t_detect = _time.perf_counter() - _t0
    if not det.found:
        return None

    # Homografia de 16 cantos + RANSAC (mesma do padrão); fallback: 4 centros
    from .config import REPROJ_MAX
    pts = saev_homography_aruco(det.markers or [])
    if pts is not None:
        src, dst = pts
        if len(src) == 4:
            M = cv2.getPerspectiveTransform(src, dst)
        else:
            M, _ = cv2.findHomography(src, dst, cv2.RANSAC, REPROJ_MAX)
            if M is None:
                return None
    else:
        M = saev_homography(det.centers)
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
    qr_id = _decode_saev_qr(gray)
    t_qr = _time.perf_counter() - _t2
    _t3 = _time.perf_counter()

    letters = ["A", "B", "C", "D"]
    all_ratios: dict[int, dict[str, float]] = {}
    geom: dict[int, list] = {}

    for q, col, _r in saev_block_rows(qps):
        _, cy = saev_bubble_center(col, _r, 0, qps)
        x0 = SAEV_COLS_X[col]
        q_ratios: dict[str, float] = {}
        q_geom: list = []
        for i in range(4):
            cx = x0 + SAEV_NUM_W + i * SAEV_PITCH + SAEV_PITCH / 2
            q_ratios[letters[i]] = _square_score(gray, cx, cy)
            if debug:
                q_geom.append((cx, cy, SAEV_SIDE / 2, letters[i]))
        all_ratios[q] = q_ratios
        if debug:
            geom[q] = q_geom

    answers: dict[int, str] = {}
    blank: list[int] = []
    duplicates: list[int] = []
    dup_marks: dict[int, list[str]] = {}
    low_conf: list[int] = []

    # Divisor via tabela por modelo (score_set='bests', hi=0.55,
    # force_adaptive — ver omr/tuning.py).
    floor, floor_source = compute_floor_for("saev", all_ratios, adaptive)

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
