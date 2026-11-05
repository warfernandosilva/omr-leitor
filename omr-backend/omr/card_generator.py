"""Gerador de cartões-resposta do zero.

Desenha a folha (âncoras ArUco, cabeçalho, QR e grade de bolhas) e devolve,
junto com a imagem, a configuração de Gabarito Personalizado correspondente.
O cartão gerado é um modelo normal: as mesmas âncoras, coordenadas
normalizadas e blocos que o motor OMR já lê — não existe caminho de leitura
paralelo.

Todas as medidas de entrada estão em milímetros; a saída usa pixels na
resolução pedida e coordenadas 0..1 (independentes de resolução).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

from .custom_template import SCHEMA_VERSION, has_errors, validate_config
from .template import ARUCO_DICT, _generate_aruco_marker, load_font

# Formato -> (largura, altura) em mm, retrato.
PAGE_FORMATS: dict[str, tuple[float, float]] = {
    "A4": (210.0, 297.0),
    "A5": (148.0, 210.0),
    "Letter": (215.9, 279.4),
    "Oficio": (216.0, 330.0),
}

FIELD_LABELS: dict[str, str] = {
    "student_name": "Nome",
    "matricula": "Matrícula",
    "turma": "Turma",
    "exam_title": "Prova",
    "subject": "Disciplina",
    "date": "Data",
    "code": "Código",
}

LABELS = "ABCDEFGHIJ"

DEFAULTS: dict[str, Any] = {
    "page_format": "A4",
    "page_w_mm": 210.0,
    "page_h_mm": 297.0,
    "orientation": "portrait",
    "dpi": 200,
    "margin_mm": 10.0,
    "title": "Cartão-resposta",
    "subtitle": "",
    # Texto fixo do cartão (não existe campo de escola/professor no banco).
    "school": "",
    "teacher": "",
    "instructions": "",
    "fields": ["student_name", "matricula", "turma"],
    "n_questions": 20,
    "n_options": 4,
    "labels": None,
    "columns": 1,
    "start_question": 1,
    "bubble_mm": 5.0,
    "option_gap_mm": 3.0,
    "row_gap_mm": 2.0,
    "column_gap_mm": 12.0,
    "shape": "circle",
    "anchors": True,
    "anchor_mm": 10.0,
    "qr": True,
    "qr_mm": 22.0,
}

MIN_BUBBLE_MM = 3.0
MAX_COLUMNS = 6
MAX_QUESTIONS = 200


@dataclass
class GeneratedCard:
    image: np.ndarray
    config: dict
    warnings: list[str]


def _num(spec: dict, key: str, lo: float, hi: float) -> float:
    try:
        v = float(spec.get(key, DEFAULTS[key]))
    except (TypeError, ValueError):
        v = float(DEFAULTS[key])
    return max(lo, min(hi, v))


def _resolve_page(spec: dict) -> tuple[float, float]:
    fmt = str(spec.get("page_format") or "A4")
    if fmt in PAGE_FORMATS:
        w, h = PAGE_FORMATS[fmt]
    else:  # "custom"
        w = _num(spec, "page_w_mm", 50.0, 1000.0)
        h = _num(spec, "page_h_mm", 50.0, 1000.0)
    if str(spec.get("orientation") or "portrait").lower().startswith("land"):
        w, h = h, w
    return w, h


def _labels(spec: dict) -> list[str]:
    n = int(_num(spec, "n_options", 2, len(LABELS)))
    raw = spec.get("labels")
    if isinstance(raw, list) and raw:
        labels = [str(x).strip().upper()[:2] for x in raw if str(x).strip()]
        if labels:
            return labels[:len(LABELS)]
    return list(LABELS[:n])


def _center_text(draw, center: tuple[float, float], text: str, font, fill=(0, 0, 0)) -> None:
    w = draw.textlength(text, font=font)
    box = draw.textbbox((0, 0), text, font=font)
    h = box[3] - box[1]
    draw.text((center[0] - w / 2, center[1] - h / 2 - box[1]), text, font=font, fill=fill)


def _fit_text(draw, text: str, font, max_w: float) -> str:
    """Corta o texto com reticências para caber na largura disponível."""
    if draw.textlength(text, font=font) <= max_w:
        return text
    while text and draw.textlength(text, font=font) > max_w:
        text = text[:-1]
    return f"{text}…" if text else ""


def generate_card(spec: dict | None = None) -> GeneratedCard:
    """Desenha o cartão e devolve (imagem BGR, config, avisos).

    Levanta ValueError quando a combinação de questões/alternativas não cabe
    na página com bolhas legíveis.
    """
    s = {**DEFAULTS, **(spec or {})}
    warnings: list[str] = []

    pw_mm, ph_mm = _resolve_page(s)
    dpi = _num(s, "dpi", 96.0, 400.0)

    def mm2px(v: float) -> float:
        return v / 25.4 * dpi

    pw = int(round(mm2px(pw_mm)))
    ph = int(round(mm2px(ph_mm)))

    margin_px = mm2px(_num(s, "margin_mm", 3.0, 40.0))
    use_anchors = bool(s.get("anchors", True))
    anchor_px = mm2px(_num(s, "anchor_mm", 5.0, 25.0)) if use_anchors else 0.0
    qr_px = mm2px(_num(s, "qr_mm", 10.0, 60.0)) if s.get("qr", True) else 0.0

    n_q = int(_num(s, "n_questions", 1, MAX_QUESTIONS))
    labels = _labels(s)
    n_opts = len(labels)
    start_q = int(_num(s, "start_question", 1, 10000))
    requested_cols = int(_num(s, "columns", 1, MAX_COLUMNS))
    shape = "square" if str(s.get("shape")) == "square" else "circle"

    # ── Geometria base ──────────────────────────────────────────────────────
    pad = anchor_px + mm2px(3.0) if use_anchors else 0.0
    cx0 = margin_px + pad
    cx1 = pw - margin_px - pad
    cy0 = margin_px + pad
    cy1 = ph - margin_px - pad
    if cx1 - cx0 < mm2px(40) or cy1 - cy0 < mm2px(40):
        raise ValueError("Margens grandes demais para o formato escolhido.")

    anchor_centers = {
        "TL": (margin_px + anchor_px / 2, margin_px + anchor_px / 2),
        "TR": (pw - margin_px - anchor_px / 2, margin_px + anchor_px / 2),
        "BR": (pw - margin_px - anchor_px / 2, ph - margin_px - anchor_px / 2),
        "BL": (margin_px + anchor_px / 2, ph - margin_px - anchor_px / 2),
    }

    img = np.ones((ph, pw, 3), dtype=np.uint8) * 255
    pil = _PIL(img)
    draw = _draw(pil)

    title_px = int(mm2px(6.0))
    sub_px = int(mm2px(3.6))
    field_px = int(mm2px(3.2))
    small_px = int(mm2px(2.6))
    title_font = load_font(title_px)
    sub_font = load_font(sub_px)
    field_font = load_font(field_px)
    small_font = load_font(small_px)

    header_w = cx1 - cx0 - (qr_px + mm2px(4.0) if qr_px else 0.0)
    y = cy0

    title = str(s.get("title") or "").strip()
    school = str(s.get("school") or "").strip()[:120]
    teacher = str(s.get("teacher") or "").strip()[:120]

    if school:
        draw.text((cx0, y), _fit_text(draw, school, sub_font, header_w), font=sub_font, fill=(0, 0, 0))
        y += sub_px * 1.6

    if title:
        draw.text((cx0, y), title, font=title_font, fill=(0, 0, 0))
        y += title_px * 1.35

    subtitle = str(s.get("subtitle") or "").strip()
    if subtitle:
        draw.text((cx0, y), subtitle, font=sub_font, fill=(60, 60, 60))
        y += sub_px * 1.6

    if teacher:
        draw.text((cx0, y), _fit_text(draw, teacher, small_font, header_w), font=small_font, fill=(60, 60, 60))
        y += small_px * 1.6

    fields = [f for f in (s.get("fields") or []) if f in FIELD_LABELS]
    info_regions: list[dict] = []
    print_fields: list[dict] = []
    if fields:
        y += mm2px(1.5)
        per_row = 2
        gap = mm2px(6.0)
        cell_w = (header_w - gap * (per_row - 1)) / per_row
        row_h = field_px * 1.9
        for idx, source in enumerate(fields):
            row, col = divmod(idx, per_row)
            if col == 0 and row > 0:
                y += row_h
            fx = cx0 + col * (cell_w + gap)
            fy = y
            label = f"{FIELD_LABELS[source]}:"
            draw.text((fx, fy + (row_h - field_px) / 2), label, font=field_font, fill=(0, 0, 0))
            lx = fx + draw.textlength(label, font=field_font) + mm2px(1.5)
            line_y = fy + row_h * 0.86
            draw.line((lx, line_y, fx + cell_w, line_y), fill=(0, 0, 0), width=1)
            region_h = field_px * 1.25
            info_regions.append({
                "id": f"info_{source}",
                "kind": source,
                "x": lx / pw,
                "y": fy / ph,
                "w": max(1.0, fx + cell_w - lx) / pw,
                "h": region_h / ph,
            })
            print_fields.append({
                "region_id": f"info_{source}",
                "source": source,
                "font_size": field_px,
                "align": "left",
            })
        y += row_h + mm2px(1.0)

    instructions = str(s.get("instructions") or "").strip()
    if instructions:
        max_w = header_w
        for raw in instructions.splitlines()[:6]:
            text = raw.strip()
            if not text:
                continue
            draw.text((cx0, y), _fit_text(draw, text, small_font, max_w),
                      font=small_font, fill=(90, 90, 90))
            y += small_px * 1.6

    header_bottom = y + mm2px(2.5)

    qr_region = None
    if qr_px:
        qx = cx1 - qr_px
        qy = cy0
        draw.rectangle((qx, qy, qx + qr_px, qy + qr_px), outline=(200, 200, 200), width=1)
        _center_text(draw, (qx + qr_px / 2, qy + qr_px / 2), "QR", small_font, (190, 190, 190))
        qr_region = {
            "id": "qr",
            "x": qx / pw,
            "y": qy / ph,
            "w": qr_px / pw,
            "h": qr_px / ph,
            "required": False,
            "purpose": "card",
            "field": "codigo_unico",
        }

    # ── Grade de questões ───────────────────────────────────────────────────
    grid_w = cx1 - cx0
    grid_h = cy1 - header_bottom
    if grid_h < mm2px(20):
        raise ValueError("Sobra pouco espaço para as questões: reduza o cabeçalho ou as margens.")

    d_req = mm2px(_num(s, "bubble_mm", MIN_BUBBLE_MM, 20.0))
    num_w = d_req * 1.8
    col_gap = mm2px(_num(s, "column_gap_mm", 4.0, 60.0))
    min_d = mm2px(MIN_BUBBLE_MM)
    # Faixa com as letras das alternativas (como nos cartões oficiais: letras
    # no cabeçalho da grade, bolhas vazias — o leitor depende do contorno).
    label_row_h = d_req * 1.15
    grid_h_avail = grid_h - label_row_h
    if grid_h_avail < mm2px(15):
        raise ValueError("Sobra pouco espaço para as questões: reduza o cabeçalho ou as margens.")

    gap_x = mm2px(_num(s, "option_gap_mm", 1.0, 20.0))
    gap_y = mm2px(_num(s, "row_gap_mm", 0.5, 20.0))

    chosen = None
    for cols in range(requested_cols, MAX_COLUMNS + 1):
        col_w = (grid_w - (cols - 1) * col_gap) / cols
        if col_w <= num_w + d_req * 1.2:
            continue
        step_x = (col_w - num_w) / n_opts
        rows = math.ceil(n_q / cols)
        step_y = grid_h_avail / rows
        # O diâmetro respeita o tamanho pedido E os espaçamentos mínimos.
        d = min(d_req, step_x - gap_x, step_y - gap_y)
        if d >= min_d:
            chosen = (cols, col_w, step_x, rows, step_y, d)
            break
    if chosen is None:
        raise ValueError(
            f"Não cabe: {n_q} questões × {n_opts} alternativas nesta página. "
            "Reduza as questões, use outro formato ou menos margem."
        )

    cols, col_w, step_x, rows, step_y, d = chosen
    if cols > requested_cols:
        warnings.append(f"Foram usadas {cols} colunas para as questões caberem com bolhas legíveis.")
    if d < d_req - 0.5:
        warnings.append(f"Bolhas reduzidas para {d / mm2px(1):.1f} mm para caber no espaço.")

    used_w = cols * col_w + (cols - 1) * col_gap
    x_start = cx0 + (grid_w - used_w) / 2
    y_start = header_bottom + label_row_h + (grid_h_avail - rows * step_y) / 2
    first_cx = x_start + num_w + step_x / 2
    first_cy = y_start + step_y / 2

    r = d / 2
    outline = max(3, int(round(d * 0.09)))
    label_font = load_font(max(9, int(d * 0.55)))
    number_font = load_font(max(8, int(d * 0.55)))
    col_pitch = col_w + col_gap

    # Letras das alternativas no topo de cada coluna.
    label_cy = header_bottom + label_row_h / 2
    for col in range(cols):
        for i, label in enumerate(labels):
            bx = first_cx + col * col_pitch + i * step_x
            _center_text(draw, (bx, label_cy), label, label_font, (0, 0, 0))

    for idx in range(n_q):
        row = idx % rows
        col = idx // rows
        cy = first_cy + row * step_y
        num_x = x_start + col * col_pitch + num_w - mm2px(2.0)
        draw.text((num_x, cy), str(start_q + idx), font=number_font,
                  fill=(0, 0, 0), anchor="rm")
        for i in range(n_opts):
            bx = first_cx + col * col_pitch + i * step_x
            if shape == "square":
                draw.rectangle((bx - r, cy - r, bx + r, cy + r), outline=(0, 0, 0), width=outline)
            else:
                draw.ellipse((bx - r, cy - r, bx + r, cy + r), outline=(0, 0, 0), width=outline)

    img = _BGR(pil)

    # Âncoras por último: nada pode ser desenhado por cima delas.
    for corner, (ax, ay) in anchor_centers.items():
        if not use_anchors:
            continue
        marker = _generate_aruco_marker(ARUCO_DICT, list(anchor_centers).index(corner), int(round(anchor_px)))
        if marker.ndim == 2:
            marker = cv2.cvtColor(marker, cv2.COLOR_GRAY2BGR)
        x0 = int(round(ax - anchor_px / 2))
        y0 = int(round(ay - anchor_px / 2))
        h, w = marker.shape[:2]
        img[y0:y0 + h, x0:x0 + w] = marker

    config: dict = {
        "schema_version": SCHEMA_VERSION,
        "page_w": pw,
        "page_h": ph,
        "n_pages": 1,
        "page_images": {},
        "anchors": [
            {
                "id": f"anc_{corner}",
                "type": "aruco",
                "corner": corner,
                "aruco_id": i,
                "page": 0,
                "x": anchor_centers[corner][0] / pw,
                "y": anchor_centers[corner][1] / ph,
                "size": anchor_px / pw,
                "tolerance": 0.15,
                "required": True,
            }
            for i, corner in enumerate(("TL", "TR", "BR", "BL"))
        ] if use_anchors else [],
        "page_corners": None,
        "qr": qr_region,
        "info_regions": info_regions,
        "questions": [{
            "id": "blk_1",
            "type": "bubble_block",
            "page": 0,
            "first_x": first_cx / pw,
            "first_y": first_cy / ph,
            "option_step_x": step_x / pw,
            "question_step_y": step_y / ph,
            "column_step_x": col_pitch / pw,
            "columns": cols,
            "n_questions": n_q,
            "labels": labels,
            "radius": r / max(pw, ph),
            "shape": shape,
            "start_question": start_q,
            "distribution": "column",
        }],
        "print_fields": print_fields,
        "omr_params": {},
    }

    issues = validate_config(config)
    if has_errors(issues):
        raise ValueError("; ".join(i["message"] for i in issues if i.get("level") == "error"))
    warnings.extend(i["message"] for i in issues if i.get("level") == "warning")

    return GeneratedCard(image=img, config=config, warnings=warnings)


# ── Ponte PIL (texto/linhas) ↔ numpy (ArUco) ──────────────────────────────

def _PIL(img: np.ndarray):
    from PIL import Image

    return Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))


def _draw(pil):
    from PIL import ImageDraw

    return ImageDraw.Draw(pil)


def _BGR(pil) -> np.ndarray:
    return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
