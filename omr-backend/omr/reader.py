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
import time as _time

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


@dataclass(frozen=True)
class BubbleMetrics:
    """Componentes de score de uma bolha (preservados p/ calibração).

    `score` é a ponderação dos três componentes; o Laboratório guarda as
    partes para recalcular com outros pesos SEM reprocessar a imagem.
    `otsu_threshold` é o limiar de Otsu da ROI (intensidade bruta 0..255).
    """
    score: float
    mean_intensity: float
    dark_ratio: float
    contrast: float
    otsu_threshold: float
    # Contraste normalizado (paper - média) / (0.75 * paper): 0 = papel,
    # ~1 = tinta cheia. Usado por faint_mark/cancel_replace e pela segunda opinião.
    darkness: float = 0.0

    @classmethod
    def zeros(cls) -> "BubbleMetrics":
        return cls(0.0, 0.0, 0.0, 0.0, 0.0)

    def rescore(self, weights: tuple[float, float, float]) -> "BubbleMetrics":
        """Mesmo ROI, nova ponderação (calibração de pesos)."""
        return BubbleMetrics(
            weights[0] * self.mean_intensity
            + weights[1] * self.dark_ratio
            + weights[2] * self.contrast,
            self.mean_intensity,
            self.dark_ratio,
            self.contrast,
            self.otsu_threshold,
            self.darkness,
        )


from .config import (
    CANCEL_REPLACE_GAP,
    DARKEST_MARK_GAP_FACTOR,
    FLOOR,
    LOW_CONF_THRESHOLD,
    MARGIN,
)
from .params import OmrParams
from .preprocess import InvalidImage, prepare_image
from .tuning import compute_floor_for


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
    floor_used: float = FLOOR
    floor_source: str = "fixed"  # "fixed" | "adaptive"
    # Tempos por etapa (segundos) — observabilidade
    t_detect: float = 0.0
    t_warp: float = 0.0
    t_qr: float = 0.0
    t_score: float = 0.0
    # Pontos p/ heatmap de debug (só quando debug=True)
    debug_points: list | None = None
    # Diagnóstico de alinhamento (só Gabarito Personalizado): {"ok", "method", ...}
    alignment: dict | None = None
    # Gabarito Personalizado: questões resolvidas por regra alternativa
    darkest_marks: list[int] | None = None   # dupla resolvida pela marca mais escura
    fallback_marks: list[int] | None = None  # vazia recuperada pelo método alternativo
    # Gabarito Personalizado: matrícula lida das bolhas de identificação.
    # `None` quando não há grade de matrícula, quando um dígito não tem marca
    # clara ou quando dois empatam (nunca inventa identificação).
    student_id: str | None = None
    student_id_detail: dict | None = None
    # Gabarito Personalizado (múltipla resposta): questão -> letras marcadas (ordenadas)
    multi_marks: dict[int, list[str]] | None = None
    # Melhorias opt-in (amazingOMR): estilo da marca e segunda opinião na faixa cinzenta
    mark_styles: dict[int, dict[str, str]] | None = None
    second_opinion: dict[int, dict] | None = None
    # Deslocamento médio aplicado pelo offset field (dx, dy) em px, se ligado
    offset_applied: tuple[float, float] | None = None


def classify_question(
    ratios: dict[str, float],
    floor: float = FLOOR,
    margin: float = MARGIN,
    low_thr: float | None = None,
    pick_darkest: bool = False,
    darkest_gap: float | None = None,
    cancel_replace: bool = False,
    faint_darkness: float | None = None,
    darkness: dict[str, float] | None = None,
) -> tuple[str, str | None, list[str]]:
    """Classifica uma questão a partir dos scores A–D.

    Devolve (status, melhor_letra, marcas):
    - blank: melhor abaixo do piso — nada marcado;
    - duplicate: DUAS ou mais acima do piso com gap < margin — dupla real;
    - darkest: como `duplicate`, mas resolvida pela marca mais escura quando
      `pick_darkest` está ligado e o vencedor abre `darkest_gap` sobre a 2ª
      marca (default: MARGIN * DARKEST_MARK_GAP_FACTOR);
    - low: ambíguo (uma no piso e demais abaixo, ou melhor fraco) — conferência manual;
    - ok: vencedor claro.

    A exigência da segunda acima do piso evita que duas bolhas VAZIAS
    com score elevado por ruído (foto de celular) virem "duplicada".
    O limiar de baixa confiança acompanha o piso (mesmo offset do fixo),
    a menos que `low_thr` explicite um valor (calibração).

    `pick_darkest`/`darkest_gap` só são usados pelo Gabarito Personalizado;
    os modelos nativos chamam sem esses argumentos e o comportamento é
    idêntico ao anterior.

    `cancel_replace` (opt-in) resolve "apagou uma e marcou outra": quando a
    dupla tem gap >= CANCEL_REPLACE_GAP o vencedor é aceito (status
    `darkest`, igual ao pick_darkest). `faint_darkness` (opt-in) impede que
    uma bolha com tinta fraca visível vire `blank`: ela passa a `low`
    (conferência manual), nunca a resposta confiante.
    """
    if low_thr is None:
        low_thr = floor + (LOW_CONF_THRESHOLD - FLOOR)
    ordered = sorted(ratios.items(), key=lambda kv: kv[1], reverse=True)
    best_letter, best_score = ordered[0]
    second_score = ordered[1][1] if len(ordered) > 1 else 0.0
    if best_score < floor:
        if (faint_darkness is not None and darkness
                and darkness.get(best_letter, 0.0) >= faint_darkness):
            return "low", best_letter, []
        return "blank", None, []
    if second_score >= floor and best_score - second_score < margin:
        marks = sorted(letter for letter, s in ratios.items() if s >= floor)
        gap = best_score - second_score
        gap_thr = (margin * DARKEST_MARK_GAP_FACTOR) if darkest_gap is None else darkest_gap
        if pick_darkest and gap >= gap_thr:
            return "darkest", best_letter, [best_letter]
        if cancel_replace and gap >= CANCEL_REPLACE_GAP:
            return "darkest", best_letter, [best_letter]
        return "duplicate", None, marks
    if best_score < low_thr or best_score - second_score < margin:
        return "low", best_letter, []
    return "ok", best_letter, []


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


DEFAULT_WEIGHTS: tuple[float, float, float] = (0.4, 0.4, 0.2)

# Denominador do "darkness": papel - 25% do papel. Dá uma escala estável
# (0 ≈ papel limpo, ~1 ≈ tinta cheia) independente do contraste da foto.
_DARKNESS_SPAN_FRAC = 0.75


def _bubble_metrics(
    gray: np.ndarray,
    x: int,
    y: int,
    radius: int = int(BUBBLE_RADIUS),
    weights: tuple[float, float, float] = DEFAULT_WEIGHTS,
    snap: int = 0,
) -> BubbleMetrics:
    """Componentes de score da bolha circular (média + razão escura + contraste).

    Mesma fórmula do formato original (0.4/0.4/0.2 por padrão), agora com
    componentes expostos p/ calibração e pesos configuráveis por override.

    `snap` (opt-in): desloca o centro em até ±snap px até a região mais
    escura, corrigindo o resíduo de alinhamento local. `darkness` é sempre
    calculado (contraste normalizado), mas não entra no score.
    """
    brightness = _estimate_paper_brightness(gray, x, y, radius)
    snap = max(0, min(6, int(snap or 0)))

    h, w = gray.shape[:2]
    x0 = max(0, x - radius - snap)
    y0 = max(0, y - radius - snap)
    x1 = min(w, x + radius + snap + 1)
    y1 = min(h, y + radius + snap + 1)
    roi = gray[y0:y1, x0:x1]
    if roi.size == 0:
        return BubbleMetrics.zeros()

    thr_otsu, binary = cv2.threshold(roi, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    yy, xx = np.ogrid[:roi.shape[0], :roi.shape[1]]
    cx_local, cy_local = x - x0, y - y0

    if snap:
        base = (cx_local, cy_local)
        best: tuple[float, int, int] | None = None
        for dy in range(-snap, snap + 1):
            for dx in range(-snap, snap + 1):
                m = ((xx - (base[0] + dx)) ** 2
                     + (yy - (base[1] + dy)) ** 2) <= radius ** 2
                n = int(m.sum())
                if n == 0:
                    continue
                mean = float(np.mean(roi[m]))
                if best is None or mean < best[0]:
                    best = (mean, dx, dy)
        if best is not None:
            nx, ny = base[0] + best[1], base[1] + best[2]
            moved = ((xx - nx) ** 2 + (yy - ny) ** 2) <= radius ** 2
            if moved.any():
                cx_local, cy_local = nx, ny

    mask = ((xx - cx_local) ** 2 + (yy - cy_local) ** 2) <= radius ** 2
    if mask.sum() == 0:
        return BubbleMetrics.zeros()

    mean_value = float(np.mean(roi[mask]))
    mean_intensity = 1.0 - (mean_value / 255.0)
    dark_ratio = float((binary[mask] > 0).sum()) / float(mask.sum())
    contrast = max(0.0, (brightness - mean_value) / 255.0)
    span = max(brightness * _DARKNESS_SPAN_FRAC, 1.0)
    darkness = float(np.clip((brightness - mean_value) / span, 0.0, 1.0))

    return BubbleMetrics(
        score=weights[0] * mean_intensity + weights[1] * dark_ratio + weights[2] * contrast,
        mean_intensity=mean_intensity,
        dark_ratio=dark_ratio,
        contrast=contrast,
        otsu_threshold=float(thr_otsu),
        darkness=darkness,
    )


def _bubble_score(
    gray: np.ndarray,
    x: int,
    y: int,
    radius: int = int(BUBBLE_RADIUS),
    weights: tuple[float, float, float] = DEFAULT_WEIGHTS,
) -> float:
    return _bubble_metrics(gray, x, y, radius, weights).score


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
        except (cv2.error, np.linalg.LinAlgError):
            # matriz singular (foto degenerada) → sem QR, sem 500
            return None

    return None


def process_image(
    image: np.ndarray,
    questions_per_subject: int | None = None,
    layout_mode: str = LAYOUT_DUAL,
    adaptive: bool = False,
    debug: bool = False,
    overrides: OmrParams | None = None,
) -> OMRResult | None:
    """Pipeline completo OMR. questions_per_subject define quantas linhas ler.

    `overrides` (OmrParams) é só para Laboratório/Calibração: nenhum campo
    altera produção por padrão (None cai nas constantes/tuning atuais).
    """
    try:
        image = prepare_image(image)
    except InvalidImage:
        return None

    p = overrides or OmrParams()
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

    _t0 = _time.perf_counter()
    det = detect_markers(image)
    t_detect = _time.perf_counter() - _t0
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
    _t1 = _time.perf_counter()
    rectified = cv2.warpPerspective(image, M, (PAGE_W, PAGE_H))
    t_warp = _time.perf_counter() - _t1

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
    clahe = cv2.createCLAHE(
        clipLimit=p.clahe_clip if p.clahe_clip is not None else 2.0,
        tileGridSize=p.clahe_tiles if p.clahe_tiles is not None else (8, 8),
    )
    gray = clahe.apply(gray)

    # Offset field (opt-in): o warp corrige a perspectiva da FOLHA, mas não o
    # relevo (curl/amassado). Estimamos um campo suave (dx, dy) pelo contorno
    # das bolhas e aplicamos antes de medir cada ROI.
    offset_field = None
    if p.offset_field:
        from .offset_field import estimate_offset_field
        cells = [(float(x), float(y), float(radius))
                 for y in question_y for x in xs]
        if not single:
            cells += [(float(x), float(y), float(radius))
                      for y in question_y for x in MAT_X]
        offset_field = estimate_offset_field(gray, cells)

    def _shift(x: float, y: float) -> tuple[int, int]:
        if offset_field is None:
            # Sem offset, preserva EXATAMENTE o arredondamento histórico
            # (truncamento de x) para paridade byte-a-byte com o laboratório.
            return int(x), int(y)
        dx, dy = offset_field(float(x), float(y))
        return int(round(x + dx)), int(round(y + dy))

    offset_applied = None
    if offset_field is not None:
        offset_applied = offset_field(PAGE_W / 2.0, PAGE_H / 2.0)
    snap = max(0, min(6, int(p.local_snap or 0)))

    _t2 = _time.perf_counter()
    qr_id = _decode_card_qr(gray, image, M)
    t_qr = _time.perf_counter() - _t2
    _t3 = _time.perf_counter()

    all_ratios: dict[int, dict[str, float]] = {}
    all_darkness: dict[int, dict[str, float]] = {}
    all_pos: dict[int, dict[str, tuple[int, int]]] = {}
    geom: dict[int, list] = {}
    letters = ["A", "B", "C", "D"]
    # Máscara um pouco menor que a bolha: ignora o contorno impresso e mede
    # só o interior (marca de lápis/caneta). Bolhas vazias ≈ 0.05.
    inner_radius = p.inner_radius if p.inner_radius is not None else max(6, int(radius) - 2)
    weights = p.weights if p.weights is not None else DEFAULT_WEIGHTS

    for q, y in enumerate(question_y):
        q_num = q + 1
        y = int(y)
        q_ratios: dict[str, float] = {}
        q_darkness: dict[str, float] = {}
        q_pos: dict[str, tuple[int, int]] = {}
        q_geom: list = []

        for i, x in enumerate(xs):
            sx, sy = _shift(float(x), y)
            m = _bubble_metrics(gray, sx, sy, radius=inner_radius,
                                weights=weights, snap=snap)
            q_ratios[letters[i]] = m.score
            q_darkness[letters[i]] = m.darkness
            q_pos[letters[i]] = (sx, sy)
            if debug:
                q_geom.append((sx, sy, radius, letters[i]))

        all_ratios[q_num] = q_ratios
        all_darkness[q_num] = q_darkness
        all_pos[q_num] = q_pos
        if debug:
            geom[q_num] = q_geom

    if not single:
        for q, y in enumerate(question_y):
            q_num = q + qps + 1
            y = int(y)
            q_ratios: dict[str, float] = {}
            q_darkness: dict[str, float] = {}
            q_pos: dict[str, tuple[int, int]] = {}
            q_geom = []

            for i, x in enumerate(MAT_X):
                sx, sy = _shift(float(x), y)
                m = _bubble_metrics(gray, sx, sy, radius=inner_radius,
                                    weights=weights, snap=snap)
                q_ratios[letters[i]] = m.score
                q_darkness[letters[i]] = m.darkness
                q_pos[letters[i]] = (sx, sy)
                if debug:
                    q_geom.append((sx, sy, radius, letters[i]))

            all_ratios[q_num] = q_ratios
            all_darkness[q_num] = q_darkness
            all_pos[q_num] = q_pos
            if debug:
                geom[q_num] = q_geom

    answers: dict[int, str] = {}
    blank: list[int] = []
    duplicates: list[int] = []
    dup_marks: dict[int, list[str]] = {}
    low_conf: list[int] = []
    status_of: dict[int, str] = {}

    # Limiar adaptativo: divisor calculado dos scores desta foto
    # (desligado por padrão — comportamento idêntico ao fixo).
    # Parâmetros vêm da tabela por modelo (omr/tuning.py).
    floor, floor_source = compute_floor_for("padrao", all_ratios, adaptive)
    if p.floor is not None:
        floor, floor_source = p.floor, "override"
    margin = p.margin if p.margin is not None else MARGIN

    for q_num, ratios in all_ratios.items():
        status, best_letter, marks = classify_question(
            ratios, floor=floor, margin=margin, low_thr=p.low_conf_threshold,
            cancel_replace=bool(p.cancel_replace),
            faint_darkness=p.faint_darkness,
            darkness=all_darkness.get(q_num),
        )
        status_of[q_num] = status
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

    # Segunda opinião (opt-in): MLP só para marcas na faixa cinzenta. O voto
    # NUNCA vira resposta confiante — no máximo move uma questão para a
    # conferência manual (low_confidence), mantendo a letra sugerida.
    second_opinion_map: dict[int, dict] | None = None
    if p.second_opinion:
        from .second_opinion import bubble_second_opinion, is_available
        if is_available():
            second_opinion_map = {}
            for q_num, status in status_of.items():
                if status not in ("blank", "low"):
                    continue
                ordered = sorted(all_ratios[q_num].items(),
                                 key=lambda kv: kv[1], reverse=True)
                letter, score = ordered[0]
                if not (0.10 <= score <= floor + 0.10):
                    continue
                sx, sy = all_pos[q_num][letter]
                paper = _estimate_paper_brightness(gray, sx, sy, inner_radius)
                ink = paper * 0.25
                verdict = bubble_second_opinion(
                    gray, sx, sy, inner_radius, paper, ink, fill=score)
                if not verdict.get("available"):
                    break
                second_opinion_map[q_num] = {"letter": letter, **verdict}
                if (status == "blank" and verdict["prob"] >= 0.80
                        and verdict["label"] == "marked"):
                    if q_num in blank:
                        blank.remove(q_num)
                    if q_num not in low_conf:
                        low_conf.append(q_num)
                    answers[q_num] = letter

    # Estilo da marca (opt-in): explica à revisão COMO a bolha foi marcada.
    mark_styles_map: dict[int, dict[str, str]] | None = None
    if p.mark_styles:
        from .mark_style import classify_bubble
        mark_styles_map = {}
        for q_num, status in status_of.items():
            if status not in ("blank", "low", "duplicate"):
                continue
            styles: dict[str, str] = {}
            for letter, (sx, sy) in all_pos[q_num].items():
                paper = _estimate_paper_brightness(gray, sx, sy, int(round(radius)))
                ink = paper * 0.25
                styles[letter] = classify_bubble(
                    gray, sx, sy, float(radius), paper, ink)
            mark_styles_map[q_num] = styles

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
        mark_styles=mark_styles_map,
        second_opinion=second_opinion_map,
        offset_applied=offset_applied,
    )
