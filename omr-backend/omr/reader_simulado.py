"""
Leitor OMR do modelo Simulado (réguas da tabela).

Pipeline:
1. Detectar as réguas -> 4 quinas -> homografia foto->template 1448×2048
2. Warp (fora do quad = branco) + CLAHE + checagem de blur
3. Leitura das 88 bolhas A–D (disco r = SIMULADO_INNER_R, dentro do anel)
4. Floor com floor_method='gap' (tuning do Simulado)
Sem QR / sem identificação: o cartão não tem como se identificar sozinho.
"""

from __future__ import annotations

import cv2
import numpy as np
import time as _time

from .config import BLUR_BLOCK, MARGIN
from .params import OmrParams
from .tuning import compute_floor_for
from .detector_simulado import detect_simulado_table, simulado_homography
from .reader import OMRResult, DEFAULT_WEIGHTS, _bubble_score, classify_question
from .template_simulado import (
    PAGE_W, PAGE_H,
    SIMULADO_MAX_QUESTIONS, SIMULADO_INNER_R, SIMULADO_BUBBLE_R,
    SIMULADO_LETTERS, simulado_bubble_center,
)


def process_simulado_image(
    image: np.ndarray,
    questions_per_subject: int | None = None,
    adaptive: bool = False,
    debug: bool = False,
    overrides: OmrParams | None = None,
) -> OMRResult | None:
    """Pipeline completo OMR-Simulado. Sempre 22 questões (fixo do template).

    `overrides` é só para Laboratório/Calibração (ver omr/params.py).
    """
    p = overrides or OmrParams()
    n = SIMULADO_MAX_QUESTIONS

    _t0 = _time.perf_counter()
    det = detect_simulado_table(image)
    t_detect = _time.perf_counter() - _t0
    if not det.found:
        return None

    M = simulado_homography(det)
    if M is None:
        return None
    _t1 = _time.perf_counter()
    try:
        rectified = cv2.warpPerspective(
            image, M, (PAGE_W, PAGE_H),
            borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 255, 255),
        )
    except cv2.error:
        return None
    t_warp = _time.perf_counter() - _t1

    gray = cv2.cvtColor(rectified, cv2.COLOR_BGR2GRAY) if len(rectified.shape) == 3 else rectified

    blur_var = cv2.Laplacian(gray, cv2.CV_64F).var()
    if blur_var < BLUR_BLOCK:
        return None

    clahe = cv2.createCLAHE(
        clipLimit=p.clahe_clip if p.clahe_clip is not None else 2.0,
        tileGridSize=p.clahe_tiles if p.clahe_tiles is not None else (8, 8),
    )
    gray = clahe.apply(gray)

    _t3 = _time.perf_counter()

    # Disco menor que o anel (interno 22 / externo 27): ignora o contorno
    # impresso e mede só o interior. Vazias ≈ 0,16–0,25 (medido na foto real).
    radius = int(SIMULADO_INNER_R)
    if p.inner_radius is not None:
        radius = p.inner_radius
    weights = p.weights if p.weights is not None else DEFAULT_WEIGHTS
    all_ratios: dict[int, dict[str, float]] = {}
    geom: dict[int, list] = {}

    for q in range(1, n + 1):
        q_ratios: dict[str, float] = {}
        q_geom: list = []
        for ci, letter in enumerate(SIMULADO_LETTERS):
            cx, cy = simulado_bubble_center(q, ci)
            x, y = int(round(cx)), int(round(cy))
            q_ratios[letter] = _bubble_score(gray, x, y, radius=radius, weights=weights)
            if debug:
                q_geom.append((cx, cy, SIMULADO_BUBBLE_R, letter))
        all_ratios[q] = q_ratios
        if debug:
            geom[q] = q_geom

    answers: dict[int, str] = {}
    blank: list[int] = []
    duplicates: list[int] = []
    dup_marks: dict[int, list[str]] = {}
    low_conf: list[int] = []

    floor, floor_source = compute_floor_for("simulado", all_ratios, adaptive)
    if p.floor is not None:
        floor, floor_source = p.floor, "override"
    margin = p.margin if p.margin is not None else MARGIN

    for q_num, ratios in all_ratios.items():
        status, best_letter, marks = classify_question(
            ratios, floor=floor, margin=margin, low_thr=p.low_conf_threshold
        )
        if status == "blank":
            blank.append(q_num)
        elif status == "duplicate":
            duplicates.append(q_num)
            dup_marks[q_num] = marks
        else:
            answers[q_num] = best_letter  # type: ignore[assignment]
            if status == "low":
                low_conf.append(q_num)

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
        qr_id=None,
        duplicate_marks=dup_marks,
        floor_used=floor,
        floor_source=floor_source,
        t_detect=t_detect,
        t_warp=t_warp,
        t_qr=0.0,
        t_score=t_score,
        debug_points=debug_points,
    )
