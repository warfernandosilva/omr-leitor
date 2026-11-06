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
from dataclasses import dataclass, field
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
    # Geometria dos blocos desenhados (mm), usada pelo editor para mostrar
    # as caixas de seleção em cima da prévia e para arrastar blocos.
    layout: list[dict] = field(default_factory=list)


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


def _block_labels(raw: dict, spec: dict) -> list[str]:
    """Rótulos de um bloco: lista própria > n_options próprio > padrão global."""
    own = raw.get("labels")
    if isinstance(own, list) and own:
        labels = [str(x).strip().upper()[:2] for x in own if str(x).strip()]
        if labels:
            return labels[:len(LABELS)]
    n = raw.get("n_options")
    if n is None:
        return _labels(spec)
    try:
        n = int(n)
    except (TypeError, ValueError):
        n = len(_labels(spec))
    return list(LABELS[:max(2, min(len(LABELS), n))])


def _opt_num(raw: dict, key: str, lo: float, hi: float) -> float | None:
    """Número opcional; devolve None quando ausente ou inválido."""
    v = raw.get(key)
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    try:
        return max(lo, min(hi, float(v)))
    except (TypeError, ValueError):
        return None


def _blocks_from_spec(spec: dict) -> list[dict]:
    """Lê `spec['blocks']` (múltiplos blocos) com valores seguros."""
    raw = spec.get("blocks")
    if not isinstance(raw, list):
        return []
    out: list[dict] = []
    for source_index, b in enumerate(raw):
        if not isinstance(b, dict):
            continue
        try:
            n_q = int(float(b.get("n_questions") or 0))
        except (TypeError, ValueError):
            n_q = 0
        if n_q <= 0:
            continue
        try:
            start = int(float(b.get("start_question") or 1))
        except (TypeError, ValueError):
            start = 1
        try:
            cols = int(float(b.get("columns") or 1))
        except (TypeError, ValueError):
            cols = 1
        dist_raw = str(b.get("distribution") or "column").strip().lower()
        if dist_raw in ("horizontal", "row"):
            # Questões lado a lado: `columns` = nº de questões por linha.
            distribution = "row"
            block_cols = max(1, min(MAX_COLUMNS, cols))
        elif dist_raw == "vertical":
            # Empilhadas (uma questão por linha).
            distribution = "column"
            block_cols = 1
        else:
            distribution = "column"
            block_cols = max(1, min(MAX_COLUMNS, cols))
        out.append({
            "source_index": source_index,
            "title": str(b.get("title") or "").strip()[:80],
            "n_questions": max(1, min(MAX_QUESTIONS, n_q)),
            "labels": _block_labels(b, spec),
            "columns": block_cols,
            "start_question": max(1, min(10000, start)),
            "distribution": distribution,
            "show_title": bool(b.get("show_title", True)),
            "hidden": bool(b.get("hidden", False)),
            # Posição livre opcional (mm). O editor grava estes campos quando
            # o usuário arrasta/redimensiona um bloco no canvas.
            "x_mm": _opt_num(b, "x_mm", 0.0, 1000.0),
            "y_mm": _opt_num(b, "y_mm", 0.0, 1000.0),
            "w_mm": _opt_num(b, "w_mm", 10.0, 1000.0),
            "h_mm": _opt_num(b, "h_mm", 10.0, 1000.0),
        })
    return out


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
    gap_x = mm2px(_num(s, "option_gap_mm", 1.0, 20.0))
    gap_y = mm2px(_num(s, "row_gap_mm", 0.5, 20.0))

    block_specs = _blocks_from_spec(s)
    blocks_config: list[dict] = []
    block_layout: list[dict] = []
    block_gap = mm2px(4.0)
    title_h = small_px * 2.0

    def px_to_mm(v: float) -> float:
        return v / mm2px(1.0)

    # Uma lista de blocos só entra no modo livre quando TODOS têm posição.
    # Sem posições, o layout automático (empilhado) continua valendo.
    absolute_blocks = bool(block_specs) and all(
        b["x_mm"] is not None and b["y_mm"] is not None for b in block_specs
    )

    if absolute_blocks:
        # ── Blocos posicionados livremente (x/y/w/h em mm) ─────────────────
        for b in block_specs:
            if b["hidden"]:
                continue
            labels_b = b["labels"]
            n_opts_b = len(labels_b)
            bx0 = mm2px(b["x_mm"])
            by0 = mm2px(b["y_mm"])
            bw = mm2px(b["w_mm"]) if b["w_mm"] is not None else grid_w
            bh = mm2px(b["h_mm"]) if b["h_mm"] is not None else None
            th = title_h if b["title"] else 0.0

            chosen_abs = None
            for cols in range(b["columns"], MAX_COLUMNS + 1):
                col_w = (bw - (cols - 1) * col_gap) / cols
                if col_w <= num_w + d_req * 1.2:
                    continue
                step_x = (col_w - num_w) / n_opts_b
                if step_x - gap_x < min_d:
                    continue
                rows_b = math.ceil(b["n_questions"] / cols)
                if bh is not None:
                    step_y = max(0.0, (bh - th - label_row_h) / rows_b)
                else:
                    step_y = d_req + gap_y
                d = min(d_req, step_x - gap_x, step_y - gap_y)
                if d < min_d:
                    continue
                chosen_abs = (cols, col_w, step_x, rows_b, step_y, d)
                break

            if chosen_abs is None:
                raise ValueError(
                    f"Não cabe: o bloco de {b['n_questions']} questões não cabe na "
                    "posição/tamanho escolhidos. Aumente o bloco ou reduza as questões."
                )

            cols, col_w, step_x, rows_b, step_y, d = chosen_abs
            if cols > b["columns"]:
                warnings.append(
                    f"O bloco {b['start_question']}–"
                    f"{b['start_question'] + b['n_questions'] - 1} usa {cols} colunas "
                    "para caber com bolhas legíveis."
                )
            if d < d_req - 0.5:
                warnings.append(f"Bolhas reduzidas para {px_to_mm(d):.1f} mm para caber no bloco.")
            if bh is None:
                bh = th + label_row_h + rows_b * step_y

            if b["title"] and b["show_title"]:
                draw.text((bx0, by0), _fit_text(draw, b["title"], small_font, bw),
                          font=small_font, fill=(60, 60, 60))
            label_cy = by0 + th + label_row_h / 2
            first_cy = by0 + th + label_row_h + step_y / 2
            first_cx = bx0 + num_w + step_x / 2
            col_pitch = col_w + col_gap
            r = d / 2
            outline_b = max(3, int(round(d * 0.09)))
            label_font = load_font(max(9, int(d * 0.55)))
            number_font = load_font(max(8, int(d * 0.55)))

            for col in range(cols):
                for i, label in enumerate(labels_b):
                    bx = first_cx + col * col_pitch + i * step_x
                    _center_text(draw, (bx, label_cy), label, label_font, (0, 0, 0))

            for idx in range(b["n_questions"]):
                if b["distribution"] == "row":
                    row = idx // cols
                    col = idx % cols
                else:
                    row = idx % rows_b
                    col = idx // rows_b
                cy = first_cy + row * step_y
                num_x = bx0 + col * col_pitch + num_w - mm2px(2.0)
                draw.text((num_x, cy), str(b["start_question"] + idx), font=number_font,
                          fill=(0, 0, 0), anchor="rm")
                for i in range(n_opts_b):
                    bx = first_cx + col * col_pitch + i * step_x
                    if shape == "square":
                        draw.rectangle((bx - r, cy - r, bx + r, cy + r),
                                       outline=(0, 0, 0), width=outline_b)
                    else:
                        draw.ellipse((bx - r, cy - r, bx + r, cy + r),
                                     outline=(0, 0, 0), width=outline_b)

            blocks_config.append({
                "id": f"blk_{len(blocks_config) + 1}",
                "type": "bubble_block",
                "page": 0,
                "first_x": first_cx / pw,
                "first_y": first_cy / ph,
                "option_step_x": step_x / pw,
                "question_step_y": step_y / ph,
                "column_step_x": col_pitch / pw,
                "columns": cols,
                "n_questions": b["n_questions"],
                "labels": labels_b,
                "radius": r / max(pw, ph),
                "shape": shape,
                "start_question": b["start_question"],
                "distribution": b["distribution"],
                "show_title": bool(b["show_title"]),
            })
            block_layout.append({
                "index": b["source_index"],
                "x_mm": round(px_to_mm(bx0), 2),
                "y_mm": round(px_to_mm(by0), 2),
                "w_mm": round(px_to_mm(bw), 2),
                "h_mm": round(px_to_mm(bh), 2),
                "columns": cols,
                "rows": rows_b,
                "start_question": b["start_question"],
                "end_question": b["start_question"] + b["n_questions"] - 1,
            })

    elif block_specs:
        # ── Múltiplos blocos: divide a altura disponível entre os blocos ──
        total_q = sum(b["n_questions"] for b in block_specs)
        layout: list[dict] = []

        # Aumenta as colunas de todos os blocos juntos até caber. Como cada
        # bloco usa a largura inteira, o número de colunas é o que controla a
        # altura necessária.
        for extra in range(0, MAX_COLUMNS):
            trials: list[dict] = []
            ok = True
            for b in block_specs:
                labels_b = b["labels"]
                n_opts_b = len(labels_b)
                cols = min(MAX_COLUMNS, b["columns"] + extra)
                col_w = (grid_w - (cols - 1) * col_gap) / cols
                if col_w <= num_w + d_req * 1.2:
                    ok = False
                    break
                step_x = (col_w - num_w) / n_opts_b
                if step_x - gap_x < min_d:
                    ok = False
                    break
                rows_b = math.ceil(b["n_questions"] / cols)
                th = title_h if b["title"] else 0.0
                natural = th + label_row_h + rows_b * (d_req + gap_y)
                trials.append({
                    "spec": b, "labels": labels_b, "cols": cols,
                    "col_w": col_w, "step_x": step_x, "rows": rows_b,
                    "natural": natural, "title_h": th,
                })
            if not ok or not trials:
                continue
            total_h = sum(t["natural"] for t in trials) + block_gap * (len(trials) - 1)
            if total_h > grid_h:
                continue
            slack = grid_h - total_h
            layout = []
            for t in trials:
                band_h = t["natural"] + slack * (t["natural"] / total_h)
                content_h = band_h - t["title_h"] - label_row_h
                step_y = content_h / t["rows"]
                d = min(d_req, t["step_x"] - gap_x, step_y - gap_y)
                if d < min_d:
                    ok = False
                    break
                t["step_y"] = step_y
                t["d"] = d
                layout.append(t)
            if ok and layout:
                break
            layout = []

        if not layout:
            raise ValueError(
                f"Não cabe: {total_q} questões distribuídas em {len(block_specs)} bloco(s) "
                "nesta página. Reduza as questões, use outro formato ou menos margem."
            )

        y_cursor = header_bottom
        for t in layout:
            b = t["spec"]
            labels_b = t["labels"]
            cols = t["cols"]
            col_w = t["col_w"]
            step_x = t["step_x"]
            rows_b = t["rows"]
            step_y = t["step_y"]
            d = t["d"]
            block_top = y_cursor
            block_h = t["title_h"] + label_row_h + rows_b * step_y
            # O layout inclui blocos ocultos: o editor precisa da geometria
            # deles para congelar as posições ao arrastar os visíveis.
            block_layout.append({
                "index": b["source_index"],
                "x_mm": round(px_to_mm(cx0), 2),
                "y_mm": round(px_to_mm(block_top), 2),
                "w_mm": round(px_to_mm(grid_w), 2),
                "h_mm": round(px_to_mm(block_h), 2),
                "columns": cols,
                "rows": rows_b,
                "start_question": b["start_question"],
                "end_question": b["start_question"] + b["n_questions"] - 1,
            })
            if b["hidden"]:
                y_cursor = block_top + block_h + block_gap
                continue
            if cols > b["columns"]:
                warnings.append(
                    f"O bloco {b['start_question']}–"
                    f"{b['start_question'] + b['n_questions'] - 1} usa {cols} colunas "
                    "para caber com bolhas legíveis."
                )
            if d < d_req - 0.5:
                warnings.append(f"Bolhas reduzidas para {d / mm2px(1):.1f} mm para caber no espaço.")
            if b["title"] and b["show_title"]:
                draw.text((cx0, y_cursor), _fit_text(draw, b["title"], small_font, grid_w),
                          font=small_font, fill=(60, 60, 60))
                y_cursor += t["title_h"]
            label_cy = y_cursor + label_row_h / 2
            y_cursor += label_row_h
            first_cy = y_cursor + step_y / 2
            x_start = cx0
            first_cx = x_start + num_w + step_x / 2
            col_pitch = col_w + col_gap
            r = d / 2
            outline_b = max(3, int(round(d * 0.09)))
            label_font = load_font(max(9, int(d * 0.55)))
            number_font = load_font(max(8, int(d * 0.55)))

            for col in range(cols):
                for i, label in enumerate(labels_b):
                    bx = first_cx + col * col_pitch + i * step_x
                    _center_text(draw, (bx, label_cy), label, label_font, (0, 0, 0))

            for idx in range(b["n_questions"]):
                if b["distribution"] == "row":
                    # Horizontal: questões lado a lado (row-major; colunas = q/linha).
                    row = idx // t["cols"]
                    col = idx % t["cols"]
                else:
                    # Vertical (column-major): uma questão por linha quando 1 coluna.
                    row = idx % rows_b
                    col = idx // rows_b
                cy = first_cy + row * step_y
                num_x = x_start + col * col_pitch + num_w - mm2px(2.0)
                draw.text((num_x, cy), str(b["start_question"] + idx), font=number_font,
                          fill=(0, 0, 0), anchor="rm")
                for i in range(len(labels_b)):
                    bx = first_cx + col * col_pitch + i * step_x
                    if shape == "square":
                        draw.rectangle((bx - r, cy - r, bx + r, cy + r),
                                       outline=(0, 0, 0), width=outline_b)
                    else:
                        draw.ellipse((bx - r, cy - r, bx + r, cy + r),
                                     outline=(0, 0, 0), width=outline_b)

            y_cursor += rows_b * step_y + block_gap
            blocks_config.append({
                "id": f"blk_{len(blocks_config) + 1}",
                "type": "bubble_block",
                "page": 0,
                "first_x": first_cx / pw,
                "first_y": first_cy / ph,
                "option_step_x": step_x / pw,
                "question_step_y": step_y / ph,
                "column_step_x": col_pitch / pw,
                "columns": t["cols"],
                "n_questions": b["n_questions"],
                "labels": labels_b,
                "radius": r / max(pw, ph),
                "shape": shape,
                "start_question": b["start_question"],
                "distribution": b["distribution"],
                "show_title": bool(b["show_title"]),
            })
    else:
        # ── Bloco único (comportamento clássico do spec plano) ──
        grid_h_avail = grid_h - label_row_h
        if grid_h_avail < mm2px(15):
            raise ValueError("Sobra pouco espaço para as questões: reduza o cabeçalho ou as margens.")

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

        blocks_config.append({
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
        })
        block_layout.append({
            "index": 0,
            "x_mm": round(px_to_mm(x_start), 2),
            "y_mm": round(px_to_mm(header_bottom), 2),
            "w_mm": round(px_to_mm(used_w), 2),
            "h_mm": round(px_to_mm(label_row_h + rows * step_y), 2),
            "columns": cols,
            "rows": rows,
            "start_question": start_q,
            "end_question": start_q + n_q - 1,
        })

    # ── Elementos decorativos (texto/linha) ─────────────────────────────────
    elements_config: list[dict] = []
    for e in s.get("elements") or []:
        if not isinstance(e, dict):
            continue
        if bool(e.get("hidden", False)):
            continue
        kind = e.get("kind") if e.get("kind") in ("text", "line") else "text"
        if e.get("kind") == "image":
            warnings.append("Imagens decorativas não são suportadas no gerador do zero.")
            continue
        try:
            ex = max(0.0, min(1.0, float(e.get("x") or 0.0)))
            ey = max(0.0, min(1.0, float(e.get("y") or 0.0)))
            ew = max(0.0, min(1.0 - ex, float(e.get("w") or 0.0)))
            eh = max(0.0, min(1.0 - ey, float(e.get("h") or 0.0)))
        except (TypeError, ValueError):
            continue
        if ew <= 0 or eh <= 0:
            continue
        text = str(e.get("text") or "")[:200]
        align = e.get("align") if e.get("align") in ("left", "center", "right") else "left"
        try:
            font_mm = max(1.5, min(30.0, float(e.get("font_mm") or 4.0)))
        except (TypeError, ValueError):
            font_mm = 4.0
        font_px = max(6, int(round(mm2px(font_mm))))
        x_px, y_px = ex * pw, ey * ph
        w_px, h_px = ew * pw, eh * ph
        fill = (40, 40, 40)

        if kind == "text":
            font = load_font(font_px)
            line_h = font_px * 1.25
            lines = text.splitlines() or [""]
            for li, line in enumerate(lines):
                if line_h * (li + 1) > h_px + 1:
                    break
                fitted = _fit_text(draw, line, font, w_px)
                tw = draw.textlength(fitted, font=font)
                tx = x_px
                if align == "center":
                    tx = x_px + (w_px - tw) / 2
                elif align == "right":
                    tx = x_px + w_px - tw
                ty = y_px + li * line_h
                if bool(e.get("bold", False)):
                    draw.text((tx, ty), fitted, font=font, fill=fill,
                              stroke_width=1, stroke_fill=fill)
                else:
                    draw.text((tx, ty), fitted, font=font, fill=fill)
        else:  # linha horizontal
            ly = y_px + h_px / 2
            draw.line((x_px, ly, x_px + w_px, ly), fill=(90, 90, 90),
                      width=max(1, int(round(mm2px(0.25)))))

        elements_config.append({
            "id": f"el_{len(elements_config) + 1}",
            "kind": kind,
            "page": 0,
            "x": ex,
            "y": ey,
            "w": ew,
            "h": eh,
            "text": text,
            "font_size": font_px,
            "align": align,
            "bold": bool(e.get("bold", False)),
            "asset": None,
        })

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
        "elements": elements_config,
        "questions": blocks_config,
        "print_fields": print_fields,
        "omr_params": {},
    }

    issues = validate_config(config)
    if has_errors(issues):
        raise ValueError("; ".join(i["message"] for i in issues if i.get("level") == "error"))
    warnings.extend(i["message"] for i in issues if i.get("level") == "warning")

    return GeneratedCard(image=img, config=config, warnings=warnings, layout=block_layout)


# ── Ponte PIL (texto/linhas) ↔ numpy (ArUco) ──────────────────────────────

def _PIL(img: np.ndarray):
    from PIL import Image

    return Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))


def _draw(pil):
    from PIL import ImageDraw

    return ImageDraw.Draw(pil)


def _BGR(pil) -> np.ndarray:
    return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
