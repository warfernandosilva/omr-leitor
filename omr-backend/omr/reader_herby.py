"""
Leitor OMR do modelo Herby (Gabarito Herby).

Pipeline:
1. Detectar 2 QRs + borda da página -> homografia foto->template 1448×2048
2. Warp + CLAHE + checagem de blur
3. QRs: cabeçalho (magic link, maior) com fallback rodapé (ID);
   qr_id normalizado (URL -> ID) via normalize_herby_qr
4. Leitura dos QUADRADOS A–D (mesmo score do SAEV + limiares por modelo)
"""

from __future__ import annotations

import cv2
import numpy as np
import time as _time

from .config import BLUR_BLOCK, MARGIN
from .tuning import compute_floor_for
from .detector_herby import detect_herby_anchors, herby_homography, refine_herby_qr_boxes
from .reader import (
    OMRResult,
    _decode_qr_from,
)
from .reader_saev import _square_score
from .template_herby import (
    PAGE_W, PAGE_H,
    HERBY_COLS_X, HERBY_NUM_W, HERBY_PITCH, HERBY_SIDE,
    HERBY_QR_HEAD_POS, HERBY_QR_HEAD_SIZE,
    HERBY_QR_FOOT_POS, HERBY_QR_FOOT_SIZE,
    HERBY_MIN_QPS, HERBY_MAX_QPS,
    herby_block_rows, herby_bubble_center, normalize_herby_qr,
)
from .reader import classify_question


def _decode_herby_qr(gray_rectified: np.ndarray, pos: tuple[int, int], size: int) -> str | None:
    qx, qy = pos
    half = size // 2 + 40
    cx, cy = qx + size // 2, qy + size // 2
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


def process_herby_image(
    image: np.ndarray,
    questions_per_subject: int | None = None,
    adaptive: bool = False,
    debug: bool = False,
) -> OMRResult | None:
    """Pipeline completo OMR-Herby. questions_per_subject = por disciplina (1..26)."""
    qps = max(HERBY_MIN_QPS, min(HERBY_MAX_QPS, int(questions_per_subject or 22)))

    _t0 = _time.perf_counter()
    det = detect_herby_anchors(image)
    t_detect = _time.perf_counter() - _t0
    if not det.found:
        return None

    M = herby_homography(det)
    if M is None:
        return None
    _t1 = _time.perf_counter()
    try:
        rectified = cv2.warpPerspective(image, M, (PAGE_W, PAGE_H))
    except cv2.error:
        return None
    # Refino: cantos do detector têm viés para dentro do QR — re-localiza
    # os boxes exatos na retificada e compõe M2 @ M1 (1 interpolação só).
    try:
        gray_pre = cv2.cvtColor(rectified, cv2.COLOR_BGR2GRAY) if len(rectified.shape) == 3 else rectified
        M2 = refine_herby_qr_boxes(gray_pre)
        if M2 is not None:
            M = M2 @ M
            rectified = cv2.warpPerspective(image, M, (PAGE_W, PAGE_H))
    except cv2.error:
        pass
    t_warp = _time.perf_counter() - _t1

    gray = cv2.cvtColor(rectified, cv2.COLOR_BGR2GRAY) if len(rectified.shape) == 3 else rectified

    blur_var = cv2.Laplacian(gray, cv2.CV_64F).var()
    if blur_var < BLUR_BLOCK:
        return None

    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)

    _t2 = _time.perf_counter()
    # QRs já decodificados na detecção; recorte retificado como fallback
    raw_head = det.qr_data.get("qr_head") or _decode_herby_qr(gray, HERBY_QR_HEAD_POS, HERBY_QR_HEAD_SIZE)
    raw_foot = det.qr_data.get("qr_foot") or _decode_herby_qr(gray, HERBY_QR_FOOT_POS, HERBY_QR_FOOT_SIZE)
    raw = raw_head or raw_foot
    qr_id = normalize_herby_qr(raw) if raw else None
    t_qr = _time.perf_counter() - _t2
    _t3 = _time.perf_counter()

    letters = ["A", "B", "C", "D"]
    all_ratios: dict[int, dict[str, float]] = {}
    geom: dict[int, list] = {}

    for q, col, _r in herby_block_rows(qps):
        _, cy = herby_bubble_center(col, _r, 0, qps)
        x0 = HERBY_COLS_X[col]
        q_ratios: dict[str, float] = {}
        q_geom: list = []
        for i in range(4):
            cx = x0 + HERBY_NUM_W + i * HERBY_PITCH + HERBY_PITCH / 2
            q_ratios[letters[i]] = _square_score(gray, cx, cy, side=HERBY_SIDE)
            if debug:
                q_geom.append((cx, cy, HERBY_SIDE / 2, letters[i]))
        all_ratios[q] = q_ratios
        if debug:
            geom[q] = q_geom

    answers: dict[int, str] = {}
    blank: list[int] = []
    duplicates: list[int] = []
    dup_marks: dict[int, list[str]] = {}
    low_conf: list[int] = []

    # Divisor via tabela por modelo (herby = ponto de partida SAEV até
    # calibração com folhas preenchidas reais — ver omr/tuning.py).
    floor, floor_source = compute_floor_for("herby", all_ratios, adaptive)

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
