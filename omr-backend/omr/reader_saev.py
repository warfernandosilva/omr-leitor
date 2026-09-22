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

from .config import BLUR_BLOCK, FLOOR, MARGIN
from .adaptive import adaptive_floor
from .detector_saev import detect_saev_corners, saev_homography
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
) -> OMRResult | None:
    """Pipeline completo OMR-SAEV. questions_per_subject = por disciplina (16..26)."""
    qps = max(1, min(SAEV_MAX_QPS, int(questions_per_subject or 22)))

    det = detect_saev_corners(image)
    if not det.found:
        return None

    M = saev_homography(det.centers)
    if M is None:
        return None
    try:
        rectified = cv2.warpPerspective(image, M, (PAGE_W, PAGE_H))
    except cv2.error:
        return None

    gray = cv2.cvtColor(rectified, cv2.COLOR_BGR2GRAY) if len(rectified.shape) == 3 else rectified

    blur_var = cv2.Laplacian(gray, cv2.CV_64F).var()
    if blur_var < BLUR_BLOCK:
        return None

    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)

    qr_id = _decode_saev_qr(gray)

    letters = ["A", "B", "C", "D"]
    all_ratios: dict[int, dict[str, float]] = {}

    for q, col, _r in saev_block_rows(qps):
        _, cy = saev_bubble_center(col, _r, 0, qps)
        x0 = SAEV_COLS_X[col]
        q_ratios: dict[str, float] = {}
        for i in range(4):
            cx = x0 + SAEV_NUM_W + i * SAEV_PITCH + SAEV_PITCH / 2
            q_ratios[letters[i]] = _square_score(gray, cx, cy)
        all_ratios[q] = q_ratios

    answers: dict[int, str] = {}
    blank: list[int] = []
    duplicates: list[int] = []
    dup_marks: dict[int, list[str]] = {}
    low_conf: list[int] = []

    floor, floor_source = FLOOR, "fixed"
    if adaptive:
        # Otsu sobre os MELHORES por questão (44 valores): separa o modo
        # "vazia" (~0.35-0.45 em foto real texturizada) do modo "marcada".
        # Teto 0.55: fundos frios/sombreados pedem divisor acima do 0.45
        # padrão; o fallback do adaptive protege cartão em branco.
        bests = [max(qr.values()) for qr in all_ratios.values()]
        floor, floor_source = adaptive_floor(bests, hi=0.55)

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
    )
