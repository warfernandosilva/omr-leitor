"""Leitores e métricas do Laboratório OMR — reusa o motor de produção.

O Lab NÃO tem pipeline paralelo: `run_lab_pipeline` chama o mesmo
process_* dos endpoints de produção (omr/reader*.py), com dispatch por
template idêntico ao main.py. `collect_option_metrics` recalcula os
COMPONENTES do score de cada bolha a partir da imagem retificada — mesma
prévia (CLAHE) e mesmas coordenadas dos leitores, então os scores batem
com `result.all_ratios` (o teste de paridade garante isso).
"""

from __future__ import annotations

import cv2

from .params import OmrParams
from .reader import OMRResult, _bubble_metrics, process_image
from .reader_sae import process_sae_image
from .reader_saev import process_saev_image, _square_metrics
from .reader_herby import process_herby_image

TEMPLATES = ("padrao", "sae", "colar", "saev", "herby")

# Constantes geo do template padrão (mesmas usadas em reader.py)
from .template import (
    BUBBLE_RADIUS, MAX_QUESTIONS_PER_SUBJECT, MAX_QUESTIONS_SINGLE,
    MAT_X, PORT_X,
    SINGLE_BUBBLE_RADIUS, SINGLE_X,
    question_y_for, single_question_y_for,
)
from .template_sae import (
    SAE_BLOCKS_X, SAE_BUBBLE_DX, SAE_BUBBLE_RADIUS,
    SAE_FIRST_ROW_Y, SAE_ROW_STEP, SAE_MAX_QUESTIONS,
    sae_block_rows,
)
from .template_saev import (
    SAEV_COLS_X, SAEV_NUM_W, SAEV_PITCH,
    SAEV_MIN_QPS, SAEV_MAX_QPS, SAEV_SIDE,
    saev_block_rows, saev_bubble_center,
)
from .template_herby import (
    HERBY_COLS_X, HERBY_NUM_W, HERBY_PITCH, HERBY_SIDE,
    HERBY_MIN_QPS, HERBY_MAX_QPS,
    herby_block_rows, herby_bubble_center,
)


def normalize_template(template: str | None) -> str:
    return template if template in TEMPLATES else "padrao"


def run_lab_pipeline(
    image,
    template: str | None,
    questions_per_subject: int = 22,
    layout_mode: str = "dual",
    adaptive: bool = False,
    overrides: OmrParams | None = None,
) -> OMRResult | None:
    """Dispatch por template — mesmo comportamento dos endpoints de produção."""
    t = normalize_template(template)
    qps = int(questions_per_subject or 22)
    if t in ("sae", "colar"):
        return process_sae_image(image, n_questions=qps, adaptive=adaptive, overrides=overrides)
    if t == "saev":
        return process_saev_image(image, questions_per_subject=qps, adaptive=adaptive, overrides=overrides)
    if t == "herby":
        return process_herby_image(
            image, questions_per_subject=qps, adaptive=adaptive, layout_mode=layout_mode,
            overrides=overrides,
        )
    return process_image(
        image, questions_per_subject=qps, layout_mode=layout_mode,
        adaptive=adaptive, overrides=overrides,
    )


def _clahe_gray(rectified, overrides: OmrParams | None = None):
    p = overrides or OmrParams()
    clip = p.clahe_clip if p.clahe_clip is not None else 2.0
    tiles = p.clahe_tiles if p.clahe_tiles is not None else (8, 8)
    gray = cv2.cvtColor(rectified, cv2.COLOR_BGR2GRAY) if len(rectified.shape) == 3 else rectified
    return cv2.createCLAHE(clipLimit=clip, tileGridSize=tiles).apply(gray)


def collect_option_metrics(
    rectified,
    template: str | None,
    questions_per_subject: int,
    layout_mode: str = "dual",
    overrides: OmrParams | None = None,
) -> dict[int, dict[str, object]]:
    """Componentes de score de cada bolha (mesmas coords dos leitores).

    Devolve {questão: {letra: BubbleMetrics}}. Os scores somados
    (0.4/0.4/0.2) batem com result.all_ratios da leitura de produção.
    """
    gray = _clahe_gray(rectified, overrides)
    metrics: dict[int, dict[str, object]] = {}
    letters = ["A", "B", "C", "D"]
    t = normalize_template(template)
    qps = int(questions_per_subject or 22)

    if t in ("sae", "colar"):
        n = max(1, min(SAE_MAX_QUESTIONS, qps))
        radius = max(6, int(round(SAE_BUBBLE_RADIUS)) - 2)
        for q, b, r in sae_block_rows(n):
            y = SAE_FIRST_ROW_Y + r * SAE_ROW_STEP
            bx = SAE_BLOCKS_X[b]
            row: dict[str, object] = {}
            for i, dx in enumerate(SAE_BUBBLE_DX):
                row[letters[i]] = _bubble_metrics(gray, bx + dx, y, radius=radius)
            metrics[q] = row
        return metrics

    if t == "saev":
        qps = max(SAEV_MIN_QPS, min(SAEV_MAX_QPS, qps))
        for q, col, _r in saev_block_rows(qps):
            _, cy = saev_bubble_center(col, _r, 0, qps)
            x0 = SAEV_COLS_X[col]
            row = {}
            for i in range(4):
                cx = x0 + SAEV_NUM_W + i * SAEV_PITCH + SAEV_PITCH / 2
                row[letters[i]] = _square_metrics(gray, cx, cy, side=SAEV_SIDE)
            metrics[q] = row
        return metrics

    if t == "herby":
        qps = max(HERBY_MIN_QPS, min(HERBY_MAX_QPS, qps))
        layout = "single" if layout_mode == "single" else "dual"
        for q, col, _r in herby_block_rows(qps, layout):
            _, cy = herby_bubble_center(col, _r, 0, qps)
            x0 = HERBY_COLS_X[col]
            row = {}
            for i in range(4):
                cx = x0 + HERBY_NUM_W + i * HERBY_PITCH + HERBY_PITCH / 2
                row[letters[i]] = _square_metrics(gray, cx, cy, side=HERBY_SIDE)
            metrics[q] = row
        return metrics

    # padrao
    single = layout_mode == "single"
    if single:
        xs, radius = SINGLE_X, max(6, int(SINGLE_BUBBLE_RADIUS) - 2)
        qps = max(1, min(MAX_QUESTIONS_SINGLE, qps))
        question_y = single_question_y_for(qps)
        for q, y in enumerate(question_y):
            y = int(y)
            row = {}
            for i, x in enumerate(xs):
                row[letters[i]] = _bubble_metrics(gray, int(x), y, radius=radius)
            metrics[q + 1] = row
        return metrics

    xs, radius = PORT_X, max(6, int(BUBBLE_RADIUS) - 2)
    qps = max(1, min(MAX_QUESTIONS_PER_SUBJECT, qps))
    question_y = question_y_for(qps)
    for q, y in enumerate(question_y):
        y = int(y)
        row = {}
        for i, x in enumerate(xs):
            row[letters[i]] = _bubble_metrics(gray, int(x), y, radius=radius)
        metrics[q + 1] = row
    for q, y in enumerate(question_y):
        y = int(y)
        q_num = q + qps + 1
        row = {}
        for i, x in enumerate(MAT_X):
            row[letters[i]] = _bubble_metrics(gray, int(x), y, radius=radius)
        metrics[q_num] = row
    return metrics


def failure_reason(image, template: str | None) -> str:
    """Diagnóstico curto quando o leitor retorna None (mesmo espírito do main.py)."""
    t = normalize_template(template)
    try:
        if t in ("sae", "colar"):
            from .detector_sae import detect_sae_corners
            det = detect_sae_corners(image)
            if not det.found:
                return f"Quadrados dos cantos não encontrados (faltam: {', '.join(det.missing)})"
            return "Falha ao retificar a imagem (foto muito borrada ou escura)"
        if t == "saev":
            from .detector_saev import detect_saev_corners
            det = detect_saev_corners(image)
            if not det.found:
                return f"Quadrados SAEV não encontrados (faltam: {', '.join(det.missing)})"
            return "Falha ao retificar (foto muito borrada ou escura)"
        if t == "herby":
            from .detector_herby import detect_herby_anchors
            det = detect_herby_anchors(image)
            if not det.found:
                return f"QRs/borda não detectados (faltam: {', '.join(det.missing)})"
            return "Falha na homografia/retificação Herby"
        from .detector import detect_markers
        det = detect_markers(image)
        if det.missing_ids:
            return "Marcadores ArUco ausentes (faltam: " + ", ".join(map(str, det.missing_ids)) + ")"
        return "Geometria inválida dos 4 marcadores ou foto muito borrada"
    except Exception:
        return "Falha ao detectar âncoras do cartão"