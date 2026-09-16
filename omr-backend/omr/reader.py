"""
Leitor OMR: warp perspective + leitura de 176 bolhas.

Pipeline:
1. Detectar 4 marcadores → extrair centros
2. Perspective warp para template 1448×2048
3. Para cada bolha: extrair ROI circular, binarizar, calcular score
4. Classificar: marcada, em branco, dupla marcação
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .detector import DetectionResult, ArUcoMarker, detect_markers, validate_geometry, get_homography_points
from .template import (
    PAGE_W, PAGE_H,
    BUBBLE_RADIUS, question_y_for, MAX_QUESTIONS_PER_SUBJECT,
    PORT_X, MAT_X, PORT_NUM_X,
    QR_CENTER, QR_SIZE,
    LAYOUT_DUAL, LAYOUT_SINGLE,
    SINGLE_X, SINGLE_NUM_X, SINGLE_BUBBLE_RADIUS,
    single_question_y_for, MAX_QUESTIONS_SINGLE,
)


@dataclass
class BubbleReading:
    question: int
    subject: str
    alternative: str
    ratio: float


from .config import FLOOR, LOW_CONF_THRESHOLD, MARGIN


@dataclass
class OMRResult:
    answers: dict[int, str]
    blank_questions: list[int]
    duplicate_questions: list[int]
    low_confidence: list[int]
    all_ratios: dict[int, dict[str, float]]
    rectified: np.ndarray | None = None
    qr_id: str | None = None
    duplicate_marks: dict[int, list[str]] | None = None


def _sample_bubble_ratio(
    gray: np.ndarray, x: int, y: int, radius: int = int(BUBBLE_RADIUS)
) -> float:
    h, w = gray.shape[:2]
    margin = 4
    x0 = max(0, x - radius - margin)
    y0 = max(0, y - radius - margin)
    x1 = min(w, x + radius + margin + 1)
    y1 = min(h, y + radius + margin + 1)

    roi = gray[y0:y1, x0:x1]
    if roi.size == 0:
        return 0.0

    _, binary = cv2.threshold(roi, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    cy_local = y - y0
    cx_local = x - x0
    yy, xx = np.ogrid[:binary.shape[0], :binary.shape[1]]
    mask = ((xx - cx_local) ** 2 + (yy - cy_local) ** 2) <= (radius + 2) ** 2

    total = mask.sum()
    if total == 0:
        return 0.0

    filled = (binary > 0) & mask
    return float(filled.sum()) / float(total)


def _estimate_paper_brightness(gray: np.ndarray, x: int, y: int, radius: int) -> float:
    h, w = gray.shape[:2]
    outer_r = radius + 15
    x0 = max(0, x - outer_r)
    y0 = max(0, y - outer_r)
    x1 = min(w, x + outer_r + 1)
    y1 = min(h, y + outer_r + 1)

    roi = gray[y0:y1, x0:x1]
    if roi.size == 0:
        return 200.0

    cy_local = y - y0
    cx_local = x - x0
    yy, xx = np.ogrid[:roi.shape[0], :roi.shape[1]]
    outer_mask = ((xx - cx_local) ** 2 + (yy - cy_local) ** 2) > (radius + 4) ** 2
    inner_mask = ((xx - cx_local) ** 2 + (yy - cy_local) ** 2) <= outer_r ** 2
    ring_mask = outer_mask & inner_mask

    if ring_mask.sum() == 0:
        return 200.0

    return float(np.median(roi[ring_mask]))


def _bubble_score(
    gray: np.ndarray, x: int, y: int, radius: int = int(BUBBLE_RADIUS)
) -> float:
    ratio = _sample_bubble_ratio(gray, x, y, radius)
    brightness = _estimate_paper_brightness(gray, x, y, radius)

    h, w = gray.shape[:2]
    x0 = max(0, x - radius)
    y0 = max(0, y - radius)
    x1 = min(w, x + radius + 1)
    y1 = min(h, y + radius + 1)
    roi = gray[y0:y1, x0:x1]
    if roi.size == 0:
        return 0.0

    _, binary = cv2.threshold(roi, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    yy, xx = np.ogrid[:roi.shape[0], :roi.shape[1]]
    mask = ((xx - (x - x0)) ** 2 + (yy - (y - y0)) ** 2) <= radius ** 2
    if mask.sum() == 0:
        return 0.0

    mean_intensity = 1.0 - (float(np.mean(roi[mask])) / 255.0)
    dark_ratio = float((binary[mask] > 0).sum()) / float(mask.sum())
    contrast = max(0, (brightness - float(np.mean(roi[mask]))) / 255.0)

    score = 0.4 * mean_intensity + 0.4 * dark_ratio + 0.2 * contrast
    return score


def _decode_qr_pyzbar(gray_crop: np.ndarray) -> str | None:
    try:
        from pyzbar.pyzbar import decode as _zbar_decode
    except ImportError:
        return None
    try:
        for obj in _zbar_decode(gray_crop):
            data = obj.data.decode('utf-8', errors='ignore').strip()
            if data:
                return data
    except Exception:
        return None
    return None


def _decode_qr_from(gray_crop: np.ndarray) -> str | None:
    # pyzbar primeiro (melhor em QR pequeno/borrado), depois OpenCV
    data = _decode_qr_pyzbar(gray_crop)
    if data:
        return data
    detector = cv2.QRCodeDetector()
    try:
        data, _, _ = detector.detectAndDecode(gray_crop)
    except cv2.error:
        return None
    return data.strip() or None


def _decode_card_qr(
    gray_rectified: np.ndarray,
    original: np.ndarray | None = None,
    M: np.ndarray | None = None,
) -> str | None:
    """Tenta decodificar o QR Code do topo central do cartão.

    Estratégias em ordem:
    1. Recorte na imagem retificada.
    2. Recorte retificado com upscale 3×.
    3. Recorte mapeado de volta para a foto original (resolução nativa).
    """
    h, w = gray_rectified.shape[:2]
    cx, cy = QR_CENTER
    half = QR_SIZE // 2 + 30  # margem de busca
    x0 = max(0, int(cx - half))
    y0 = max(0, int(cy - half))
    x1 = min(w, int(cx + half))
    y1 = min(h, int(cy + half))
    if x1 <= x0 or y1 <= y0:
        return None

    crop = gray_rectified[y0:y1, x0:x1]

    data = _decode_qr_from(crop)
    if data:
        return data

    big = cv2.resize(crop, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    data = _decode_qr_from(big)
    if data:
        return data

    if original is not None and M is not None:
        try:
            pts = np.array([[[x0, y0]], [[x1, y0]], [[x1, y1]], [[x0, y1]]], dtype=np.float32)
            src_pts = cv2.perspectiveTransform(pts, np.linalg.inv(M)).reshape(-1, 2)
            oh, ow = original.shape[:2]
            sx0 = max(0, int(src_pts[:, 0].min()) - 10)
            sy0 = max(0, int(src_pts[:, 1].min()) - 10)
            sx1 = min(ow, int(np.ceil(src_pts[:, 0].max())) + 10)
            sy1 = min(oh, int(np.ceil(src_pts[:, 1].max())) + 10)
            if sx1 > sx0 and sy1 > sy0:
                gsrc = cv2.cvtColor(original, cv2.COLOR_BGR2GRAY) if len(original.shape) == 3 else original
                native = gsrc[sy0:sy1, sx0:sx1]
                data = _decode_qr_from(native)
                if data:
                    return data
                big_native = cv2.resize(native, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
                return _decode_qr_from(big_native)
        except cv2.error:
            return None

    return None


def process_image(
    image: np.ndarray,
    questions_per_subject: int | None = None,
    layout_mode: str = LAYOUT_DUAL,
) -> OMRResult | None:
    """Pipeline completo OMR. questions_per_subject define quantas linhas ler."""
    single = layout_mode == LAYOUT_SINGLE
    qps = questions_per_subject or 22
    if single:
        xs = SINGLE_X
        radius = SINGLE_BUBBLE_RADIUS
        num_x = SINGLE_NUM_X
        qps = max(1, min(MAX_QUESTIONS_SINGLE, int(qps)))
        question_y = single_question_y_for(qps)
    else:
        xs = PORT_X
        radius = BUBBLE_RADIUS
        num_x = PORT_NUM_X  # noqa: F841 (simetria com modo único)
        qps = max(1, min(MAX_QUESTIONS_PER_SUBJECT, int(qps)))
        question_y = question_y_for(qps)

    det = detect_markers(image)
    if det.missing_ids:
        return None

    if not validate_geometry(det.markers):
        return None

    src, dst = get_homography_points(det.markers)
    if len(src) == 4:
        M = cv2.getPerspectiveTransform(src, dst)
    else:
        from .config import REPROJ_MAX
        M, _ = cv2.findHomography(src, dst, cv2.RANSAC, REPROJ_MAX)
        if M is None:
            return None
    rectified = cv2.warpPerspective(image, M, (PAGE_W, PAGE_H))

    if len(rectified.shape) == 3:
        gray = cv2.cvtColor(rectified, cv2.COLOR_BGR2GRAY)
    else:
        gray = rectified

    # Foto extremamente borrada bloqueia; caso contrário segue (blur só diagnóstico)
    from .config import BLUR_BLOCK
    blur_var = cv2.Laplacian(gray, cv2.CV_64F).var()
    if blur_var < BLUR_BLOCK:
        return None

    # Normalizar iluminação desigual
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)

    qr_id = _decode_card_qr(gray, image, M)

    all_ratios: dict[int, dict[str, float]] = {}
    letters = ["A", "B", "C", "D"]

    for q, y in enumerate(question_y):
        q_num = q + 1
        y = int(y)
        q_ratios: dict[str, float] = {}

        for i, x in enumerate(xs):
            score = _bubble_score(gray, int(x), y, radius=int(radius))
            q_ratios[letters[i]] = score

        all_ratios[q_num] = q_ratios

    if not single:
        for q, y in enumerate(question_y):
            q_num = q + qps + 1
            y = int(y)
            q_ratios: dict[str, float] = {}

            for i, x in enumerate(MAT_X):
                score = _bubble_score(gray, int(x), y)
                q_ratios[letters[i]] = score

            all_ratios[q_num] = q_ratios

    answers: dict[int, str] = {}
    blank: list[int] = []
    duplicates: list[int] = []
    dup_marks: dict[int, list[str]] = {}
    low_conf: list[int] = []

    for q_num, ratios in all_ratios.items():
        sorted_ratios = sorted(ratios.items(), key=lambda x: x[1], reverse=True)
        best_letter, best_score = sorted_ratios[0]
        second_score = sorted_ratios[1][1] if len(sorted_ratios) > 1 else 0

        if best_score < FLOOR:
            blank.append(q_num)
        elif best_score - second_score < MARGIN and best_score > FLOOR:
            duplicates.append(q_num)
            # Alternativas que o aluno marcou (todas acima do limiar)
            marks = sorted(letter for letter, s in ratios.items() if s >= FLOOR)
            dup_marks[q_num] = marks
        elif best_score < LOW_CONF_THRESHOLD:
            low_conf.append(q_num)
            answers[q_num] = best_letter
        else:
            answers[q_num] = best_letter

    return OMRResult(
        answers=answers,
        blank_questions=blank,
        duplicate_questions=duplicates,
        low_confidence=low_conf,
        all_ratios=all_ratios,
        rectified=rectified,
        qr_id=qr_id,
        duplicate_marks=dup_marks,
    )
