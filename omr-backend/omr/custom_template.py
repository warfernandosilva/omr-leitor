"""Gabarito Personalizado — configuração e leitura de cartões arbitrários.

O usuário importa a imagem de um cartão-resposta próprio, desenha as
regiões no editor visual (frontend) e o sistema passa a ler esse modelo
usando O MESMO motor OMR de produção (omr/reader*.py), sem criar um
pipeline paralelo.

Diferenças em relação aos modelos nativos:
- As âncoras, o QR e as bolhas vêm da CONFIGURAÇÃO (JSON), não de
  constantes fixas no código.
- As coordenadas são NORMALIZADAS (0..1) relativas à imagem importada —
  converter para pixel só na renderização/leitura evita deslocamento
  quando a imagem é exibida em tamanhos diferentes.

Estratégia de alinhamento (em ordem, para no primeiro que fecha 4 cantos):
1. Âncoras ArUco configuradas (as mesmas DICT_4X4_50 dos cartões nativos).
2. Âncoras quadradas/retangulares configuradas (mesmo candidato do SAE).
3. Borda da página (maior quadrilátero) como método alternativo — cobre
   cartões que não tenham âncoras próprias.

A leitura reusa `_bubble_metrics`/`_square_metrics`, `classify_question`
e `compute_floor_for`, então os scores e a classificação batem com os
modelos nativos.
"""

from __future__ import annotations

import math
from typing import Any

import cv2
import numpy as np

from .config import BLUR_BLOCK, MARGIN
from .detector import detect_markers
from .detector_sae import _square_candidates
from .params import OmrParams
from .reader import (
    DEFAULT_WEIGHTS,
    OMRResult,
    _bubble_metrics,
    _decode_qr_from,
    classify_question,
)
from .reader_saev import _square_metrics
from .tuning import compute_floor_for

SCHEMA_VERSION = 1

CORNERS = ("TL", "TR", "BR", "BL")

# Teto do lado maior do alvo de retificação (evita warp gigante com foto 12MP)
MAX_CANON_SIDE = 2600

DEFAULT_RADIUS = 0.013

# --- Confiança de alinhamento (P0) -----------------------------------------
# Depois da retificação, confirmamos que a GRADE REALMENTE CAIU SOBRE as
# bolhas. Sem isso, um alinhamento plausível-mas-errado (âncora trocada,
# borda da página pegando a mesa, 4ª âncora inferida com perspectiva forte)
# produziria respostas silenciosamente erradas.
#
# Sinal 1 (grade): detecta centros de bolha na imagem retificada e mede a
#   fração que cai sobre a grade prevista (precisão). Robusto a folha cheia,
#   parcialmente preenchida ou com contornos impressos.
ALIGN_MIN_CENTER_PRECISION = 0.6   # dos centros detectados, fração sobre a grade
ALIGN_MIN_CENTERS = 3              # mínimo de centros p/ confiar no sinal de grade
# Sinal 2 (tinta): usado quando há pouco contorno — a tinta deve estar
#   concentrada dentro das ROIs das bolhas, não espalhada.
ALIGN_MIN_ENRICHMENT = 1.2         # tinta dentro das ROIs vs tinta média da imagem
ALIGN_MIN_INK_FRAC = 0.0005        # abaixo disso não há tinta p/ julgar (não rejeita)
# Limiares mais duros quando alguma âncora foi INFERIDA (regra do FormRead:
# "inferred anchors not confirmed by bubbles").
ALIGN_INFERRED_CENTER_PRECISION = 0.7
ALIGN_INFERRED_MIN_ENRICHMENT = 1.5

# --- Regras alternativas de decisão (P1) -----------------------------------
# Dupla marcação com uma marca claramente mais escura (Gabarito Personalizado).
# O gap mínimo fica em config.DARKEST_MARK_GAP_FACTOR × MARGIN por padrão,
# podendo ser sobreposto por bloco (`darkest_mark_threshold`).
#
# Questão VAZIA relida com limiar mais permissivo (fallbackOnEmpty): exige
# vencedor CLARO para não inventar resposta a partir de ruído. Como é uma
# releitura deliberadamente agressiva, o gap exigido é próprio (e não o
# `margin` da classificação normal).
FALLBACK_FLOOR_FACTOR = 0.65   # piso alternativo = floor × fator
FALLBACK_MIN_SCORE = 0.20      # e nunca abaixo deste absoluto
FALLBACK_MIN_GAP = 0.12        # 1ª marca precisa abrir isto sobre a 2ª


# ---------------------------------------------------------------------------
# Normalização / esquema
# ---------------------------------------------------------------------------

def default_config(page_w: int = 0, page_h: int = 0) -> dict:
    """Configuração vazia (esqueleto) para um cartão recém-importado."""
    return {
        "schema_version": SCHEMA_VERSION,
        "page_w": int(page_w),
        "page_h": int(page_h),
        "anchors": [],
        "qr": None,
        "info_regions": [],
        "questions": [],
        "print_fields": [],
        "omr_params": {},
    }


def _clamp01(v: Any, default: float = 0.0) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(1.0, f))


def _opt_clamp01(v: Any) -> float | None:
    """Como `_clamp01`, mas preserva None (campo opcional não informado)."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return max(0.0, min(1.0, f))


def normalize_config(config: dict | None) -> dict:
    """Normaliza a configuração recebida do editor (defaults + tipos).

    Tolerante: campos ausentes/ inválidos caem no default em vez de
    estourar — a validação formal fica em `validate_config`.
    """
    cfg = dict(config or {})
    out = default_config(cfg.get("page_w") or 0, cfg.get("page_h") or 0)
    out["schema_version"] = int(cfg.get("schema_version") or SCHEMA_VERSION)

    anchors = []
    for a in cfg.get("anchors") or []:
        if not isinstance(a, dict):
            continue
        anchors.append({
            "id": str(a.get("id") or f"anc_{len(anchors) + 1}"),
            "type": a.get("type") if a.get("type") in ("aruco", "quad") else "quad",
            "corner": a.get("corner") if a.get("corner") in CORNERS else None,
            "aruco_id": int(a["aruco_id"]) if a.get("aruco_id") is not None else None,
            "x": _clamp01(a.get("x")),
            "y": _clamp01(a.get("y")),
            "size": _clamp01(a.get("size"), 0.05) or 0.05,
            "tolerance": _clamp01(a.get("tolerance"), 0.15) or 0.15,
            "required": bool(a.get("required", True)),
        })
    out["anchors"] = anchors

    qr = cfg.get("qr")
    if isinstance(qr, dict):
        out["qr"] = {
            "id": str(qr.get("id") or "qr"),
            "x": _clamp01(qr.get("x")),
            "y": _clamp01(qr.get("y")),
            "w": _clamp01(qr.get("w")),
            "h": _clamp01(qr.get("h")),
            "required": bool(qr.get("required", False)),
            "purpose": str(qr.get("purpose") or "card"),
            "field": str(qr.get("field") or "codigo_unico"),
        }
    else:
        out["qr"] = None

    infos = []
    for r in cfg.get("info_regions") or []:
        if not isinstance(r, dict):
            continue
        infos.append({
            "id": str(r.get("id") or f"info_{len(infos) + 1}"),
            "kind": str(r.get("kind") or "info"),
            "x": _clamp01(r.get("x")),
            "y": _clamp01(r.get("y")),
            "w": _clamp01(r.get("w")),
            "h": _clamp01(r.get("h")),
        })
    out["info_regions"] = infos

    questions = []
    for b in cfg.get("questions") or []:
        if not isinstance(b, dict):
            continue
        labels = b.get("labels")
        if not isinstance(labels, list) or not labels:
            labels = ["A", "B", "C", "D"]
        labels = [str(x).strip().upper()[:2] for x in labels if str(x).strip()]
        overrides = b.get("overrides") if isinstance(b.get("overrides"), dict) else {}
        questions.append({
            "id": str(b.get("id") or f"block_{len(questions) + 1}"),
            "type": "bubble_block",
            "first_x": _clamp01(b.get("first_x")),
            "first_y": _clamp01(b.get("first_y")),
            "option_step_x": _clamp01(b.get("option_step_x"), 0.05) or 0.05,
            "question_step_y": _clamp01(b.get("question_step_y"), 0.03) or 0.03,
            "column_step_x": _clamp01(b.get("column_step_x")) or None,
            "columns": max(1, int(b.get("columns") or 1)),
            "n_questions": max(0, int(b.get("n_questions") or 0)),
            "labels": labels,
            "radius": _clamp01(b.get("radius"), DEFAULT_RADIUS) or DEFAULT_RADIUS,
            "shape": b.get("shape") if b.get("shape") in ("circle", "square") else "circle",
            "start_question": max(1, int(b.get("start_question") or 1)),
            "distribution": b.get("distribution") if b.get("distribution") in ("column", "row") else "column",
            "multi_answer": bool(b.get("multi_answer", False)),
            "points": float(b.get("points", 1.0) or 0.0),
            "annulled": bool(b.get("annulled", False)),
            # Regras alternativas de decisão (P1)
            "pick_darkest_mark": bool(b.get("pick_darkest_mark", False)),
            "darkest_mark_threshold": _opt_clamp01(b.get("darkest_mark_threshold")),
            "fallback_on_empty": bool(b.get("fallback_on_empty", False)),
            "fallback_floor": _opt_clamp01(b.get("fallback_floor")),
            "overrides": overrides,
        })
    out["questions"] = questions

    pf = []
    for f in cfg.get("print_fields") or []:
        if not isinstance(f, dict):
            continue
        pf.append({
            "region_id": str(f.get("region_id") or ""),
            "source": str(f.get("source") or ""),
            "font_size": int(f.get("font_size") or 34),
            "align": f.get("align") if f.get("align") in ("left", "center", "right") else "left",
        })
    out["print_fields"] = pf

    op = cfg.get("omr_params") if isinstance(cfg.get("omr_params"), dict) else {}
    out["omr_params"] = {
        "floor": op.get("floor"),
        "margin": op.get("margin"),
        "low_conf_threshold": op.get("low_conf_threshold"),
        "adaptive": bool(op.get("adaptive", False)),
    }
    return out


# ---------------------------------------------------------------------------
# Expansão das bolhas
# ---------------------------------------------------------------------------

def expand_block(block: dict) -> list[dict]:
    """Bolhas de um bloco (questão × alternativa) em coords NORMALIZADAS."""
    labels = block.get("labels") or ["A", "B", "C", "D"]
    n_opts = len(labels)
    n_q = int(block.get("n_questions") or 0)
    columns = max(1, int(block.get("columns") or 1))
    fx = float(block.get("first_x") or 0.0)
    fy = float(block.get("first_y") or 0.0)
    osx = float(block.get("option_step_x") or 0.0)
    qsy = float(block.get("question_step_y") or 0.0)
    csx = block.get("column_step_x")
    csx = float(csx) if csx else osx * n_opts
    radius = float(block.get("radius") or DEFAULT_RADIUS)
    shape = block.get("shape") or "circle"
    start = max(1, int(block.get("start_question") or 1))
    distribution = block.get("distribution") or "column"
    overrides = block.get("overrides") or {}

    if n_q <= 0 or not labels:
        return []

    if distribution == "row":
        rows = math.ceil(n_q / columns)
        def _rc(idx: int) -> tuple[int, int]:
            return idx // columns, idx % columns
    else:  # column
        rows = math.ceil(n_q / columns)
        def _rc(idx: int) -> tuple[int, int]:
            return idx % rows, idx // rows

    bubbles: list[dict] = []
    for idx in range(n_q):
        row, col = _rc(idx)
        q_num = start + idx
        for i, label in enumerate(labels):
            x = fx + col * csx + i * osx
            y = fy + row * qsy
            ov = overrides.get(str(q_num)) if isinstance(overrides, dict) else None
            if isinstance(ov, dict) and isinstance(ov.get(label), dict):
                o = ov[label]
                if o.get("x") is not None:
                    x = float(o["x"])
                if o.get("y") is not None:
                    y = float(o["y"])
            bubbles.append({
                "question": q_num,
                "option": label,
                "x": x,
                "y": y,
                "r": radius,
                "shape": shape,
            })
    bubbles.sort(key=lambda b: (b["question"], labels.index(b["option"])))
    return bubbles


def expand_bubbles(config: dict) -> list[dict]:
    """Todas as bolhas de todos os blocos (dedup por questão+letra)."""
    cfg = normalize_config(config)
    seen: set[tuple[int, str]] = set()
    out: list[dict] = []
    for block in cfg["questions"]:
        for b in expand_block(block):
            key = (b["question"], b["option"])
            if key in seen:
                continue
            seen.add(key)
            out.append(b)
    return out


def total_questions(config: dict) -> int:
    nums = {b["question"] for b in expand_bubbles(config)}
    return len(nums)


def question_block_map(config: dict) -> dict[int, dict]:
    """Mapa questão → bloco que a define (para regras de decisão por bloco)."""
    cfg = normalize_config(config)
    out: dict[int, dict] = {}
    for block in cfg["questions"]:
        for b in expand_block(block):
            out.setdefault(b["question"], block)
    return out


def _block_bbox(block: dict) -> tuple[float, float, float, float] | None:
    bs = expand_block(block)
    if not bs:
        return None
    xs = [b["x"] for b in bs]
    ys = [b["y"] for b in bs]
    r = max(b["r"] for b in bs)
    return (min(xs) - r, min(ys) - r, max(xs) + r, max(ys) + r)


# ---------------------------------------------------------------------------
# Validação (seção 9 do contrato)
# ---------------------------------------------------------------------------

def validate_config(config: dict) -> list[dict]:
    """Lista de problemas: {level, code, message, region_id}."""
    cfg = normalize_config(config)
    issues: list[dict] = []

    def add(level: str, code: str, message: str, region_id: str | None = None) -> None:
        issues.append({"level": level, "code": code, "message": message, "region_id": region_id})

    if not cfg["page_w"] or not cfg["page_h"]:
        add("error", "page_size", "Dimensões da imagem não definidas (reimporte a imagem).", None)

    anchors = cfg["anchors"]
    if len(anchors) != 4:
        add("warning", "anchors_count",
            f"{len(anchors)} âncora(s) configurada(s); o ideal são 4 (uma por canto). "
            "Sem 4 âncoras o sistema tenta a borda da página como alinhamento alternativo.",
            None)
    corners_seen: list[str] = []
    for a in anchors:
        corner = a["corner"] or _infer_corner(anchors, a["id"])
        if corner:
            corners_seen.append(corner)
        if a["type"] == "aruco" and a["aruco_id"] is None:
            add("error", "anchor_aruco_id", "Âncora ArUco sem identificador (aruco_id).", a["id"])
        if not (0.0 <= a["x"] <= 1.0 and 0.0 <= a["y"] <= 1.0):
            add("error", "anchor_bounds", "Âncora fora dos limites da imagem.", a["id"])
    dup = {c for c in corners_seen if corners_seen.count(c) > 1}
    if dup:
        add("error", "anchors_duplicate", f"Cantos duplicados nas âncoras: {', '.join(sorted(dup))}.", None)

    qr = cfg["qr"]
    if qr is not None and (qr["w"] <= 0 or qr["h"] <= 0):
        add("error", "qr_size", "Região de QR Code sem largura/altura.", qr["id"])

    for r in cfg["info_regions"]:
        if r["w"] <= 0 or r["h"] <= 0:
            add("error", "info_size", "Região informativa sem largura/altura.", r["id"])
        if r["x"] + r["w"] > 1.0001 or r["y"] + r["h"] > 1.0001:
            add("warning", "info_overflow", "Região informativa ultrapassa a borda da imagem.", r["id"])

    if not cfg["questions"]:
        add("error", "no_questions", "Nenhuma questão configurada — desenhe ao menos um bloco de bolhas.", None)

    question_numbers: dict[int, str] = {}
    bboxes: list[tuple[str, tuple[float, float, float, float]]] = []
    for b in cfg["questions"]:
        if b["n_questions"] <= 0:
            add("error", "block_empty", "Bloco de questões sem número de questões.", b["id"])
        if len(set(b["labels"])) != len(b["labels"]):
            add("error", "block_labels", "Rótulos de alternativas repetidos no bloco.", b["id"])
        if b["option_step_x"] <= 0 or b["question_step_y"] <= 0:
            add("error", "block_steps", "Espaçamento horizontal/vertical deve ser maior que zero.", b["id"])
        if b["radius"] <= 0:
            add("error", "block_radius", "Raio das bolhas deve ser maior que zero.", b["id"])

        # Regras alternativas de decisão (P1) — avisos, não bloqueiam geometria.
        if b["pick_darkest_mark"] and b["multi_answer"]:
            add("warning", "block_darkest_multi",
                "Bloco com 'múltiplas marcações' e 'marca mais escura': a regra da "
                "marca mais escura é ignorada (o bloco aceita múltiplas respostas).",
                b["id"])
        if b["darkest_mark_threshold"] is not None and b["darkest_mark_threshold"] <= 0:
            add("warning", "block_darkest_threshold",
                "Limiar da marca mais escura deve ser maior que zero.", b["id"])
        if b["fallback_floor"] is not None and b["fallback_floor"] <= 0:
            add("warning", "block_fallback_floor",
                "Piso do fallback de questão vazia deve ser maior que zero.", b["id"])

        for bubble in expand_block(b):
            if not (0.0 <= bubble["x"] <= 1.0 and 0.0 <= bubble["y"] <= 1.0):
                add("error", "bubble_bounds",
                    f"Bolha Q{bubble['question']} {bubble['option']} fora da imagem.",
                    b["id"])
                break

        for bubble in expand_block(b):
            prev = question_numbers.get(bubble["question"])
            if prev is not None and prev != b["id"]:
                add("error", "question_duplicate",
                    f"Questão {bubble['question']} aparece em mais de um bloco.", b["id"])
                break
            question_numbers[bubble["question"]] = b["id"]

        bb = _block_bbox(b)
        if bb is not None:
            bboxes.append((b["id"], bb))

    # Sobreposição suspeita entre blocos (retângulos se tocam muito)
    for i in range(len(bboxes)):
        for j in range(i + 1, len(bboxes)):
            a_id, a = bboxes[i]
            b_id, b = bboxes[j]
            inter_w = min(a[2], b[2]) - max(a[0], b[0])
            inter_h = min(a[3], b[3]) - max(a[1], b[1])
            if inter_w > 0 and inter_h > 0:
                area_inter = inter_w * inter_h
                area_a = max(1e-9, (a[2] - a[0]) * (a[3] - a[1]))
                area_b = max(1e-9, (b[2] - b[0]) * (b[3] - b[1]))
                if area_inter / min(area_a, area_b) > 0.15:
                    add("warning", "blocks_overlap",
                        "Blocos de questões com sobreposição suspeita.", b_id)

    if not cfg["print_fields"] and qr is None:
        add("warning", "no_print_fields",
            "Sem campos de impressão nem QR: os cartões gerados saem como a imagem original "
            "(sem nome/turma/código).", None)

    return issues


def has_errors(issues: list[dict]) -> bool:
    return any(i.get("level") == "error" for i in issues)


def _infer_corner(anchors: list[dict], anchor_id: str) -> str | None:
    """Deduz o canto (TL/TR/BR/BL) pela posição normalizada (soma/diferença)."""
    a = next((x for x in anchors if x["id"] == anchor_id), None)
    if a is None:
        return None
    xs = [x["x"] for x in anchors]
    ys = [x["y"] for x in anchors]
    if len(anchors) != 4:
        return _corner_by_quadrant(a["x"], a["y"])
    order_tl = min(anchors, key=lambda x: x["x"] + x["y"])
    order_br = max(anchors, key=lambda x: x["x"] + x["y"])
    order_tr = max(anchors, key=lambda x: x["x"] - x["y"])
    order_bl = min(anchors, key=lambda x: x["x"] - x["y"])
    _ = (xs, ys)
    for cand, name in ((order_tl, "TL"), (order_tr, "TR"), (order_br, "BR"), (order_bl, "BL")):
        if cand["id"] == anchor_id:
            return name
    return None


def _corner_by_quadrant(x: float, y: float) -> str:
    if x < 0.5 and y < 0.5:
        return "TL"
    if x >= 0.5 and y < 0.5:
        return "TR"
    if x >= 0.5 and y >= 0.5:
        return "BR"
    return "BL"


def canonical_size(config: dict) -> tuple[int, int]:
    cfg = normalize_config(config)
    w = max(1, int(cfg["page_w"] or 1))
    h = max(1, int(cfg["page_h"] or 1))
    scale = min(1.0, MAX_CANON_SIDE / float(max(w, h)))
    return max(1, int(round(w * scale))), max(1, int(round(h * scale)))


# ---------------------------------------------------------------------------
# Detecção de âncoras + homografia
# ---------------------------------------------------------------------------

def _expected_corners_px(config: dict, w: int, h: int) -> dict[str, tuple[float, float]]:
    cfg = normalize_config(config)
    out: dict[str, tuple[float, float]] = {}
    for a in cfg["anchors"]:
        corner = a["corner"] or _infer_corner(cfg["anchors"], a["id"])
        if corner and corner not in out:
            out[corner] = (a["x"] * w, a["y"] * h)
    return out


def _detect_page_corners(gray: np.ndarray) -> dict[str, tuple[float, float]] | None:
    """Maior quadrilátero da imagem como borda da página (método alternativo)."""
    h, w = gray.shape[:2]
    try:
        blur = cv2.GaussianBlur(gray, (5, 5), 0)
        _, bw = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        cnts, _ = cv2.findContours(bw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    except cv2.error:
        return None
    best = None
    best_area = 0.0
    for c in cnts:
        area = float(cv2.contourArea(c))
        if area < 0.25 * w * h:
            continue
        peri = float(cv2.arcLength(c, True))
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)
        if len(approx) != 4:
            continue
        if area > best_area:
            best_area = area
            best = approx.reshape(-1, 2).astype(np.float64)
    if best is None:
        return None
    return _order_corners(best)


def _order_corners(pts: np.ndarray) -> dict[str, tuple[float, float]]:
    p = np.asarray(pts, dtype=np.float64).reshape(-1, 2)
    s = p.sum(axis=1)
    d = np.diff(p, axis=1).reshape(-1)
    tl = p[int(np.argmin(s))]
    br = p[int(np.argmax(s))]
    tr = p[int(np.argmin(d))]
    bl = p[int(np.argmax(d))]
    return {"TL": (float(tl[0]), float(tl[1])), "TR": (float(tr[0]), float(tr[1])),
            "BR": (float(br[0]), float(br[1])), "BL": (float(bl[0]), float(bl[1]))}


def _quad_area(pts: list[tuple[float, float]]) -> float:
    """Área (shoelace) de um polígono de 4 pontos, em px²."""
    area = 0.0
    n = len(pts)
    for i in range(n):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        area += x0 * y1 - x1 * y0
    return abs(area) / 2.0


def _is_convex_quad(pts: list[tuple[float, float]]) -> bool:
    """True se os 4 pontos (em ordem) formam um quadrilátero convexo não degenerado."""
    if len(pts) != 4:
        return False
    area = _quad_area(pts)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    bbox = (max(xs) - min(xs)) * (max(ys) - min(ys))
    if area <= 0.0 or bbox <= 0.0 or area < 0.05 * bbox:
        return False
    signs: list[float] = []
    for i in range(4):
        ax, ay = pts[i]
        bx, by = pts[(i + 1) % 4]
        cx, cy = pts[(i + 2) % 4]
        cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx)
        signs.append(cross)
    if any(abs(s) < 1e-6 for s in signs):
        return False
    return all(s > 0 for s in signs) or all(s < 0 for s in signs)


def _infer_missing_corner(
    found: dict[str, tuple[float, float]],
    w: int,
    h: int,
    tol: float = 0.05,
) -> tuple[str, tuple[float, float]] | None:
    """Deduz a 4ª âncora pelo paralelepípedo (TL+BR = TR+BL).

    Só faz sentido quando 3 dos 4 cantos previstos foram detectados e a
    configuração espera os 4. Devolve (canto, (x, y)) ou None se a dedução
    sair da imagem ou degenerar o quadrilátero.
    """
    if len(found) != 3:
        return None
    missing = [c for c in CORNERS if c not in found]
    if len(missing) != 1:
        return None
    m = missing[0]
    i = CORNERS.index(m)
    opp = CORNERS[(i + 2) % 4]
    a = CORNERS[(i + 1) % 4]
    b = CORNERS[(i + 3) % 4]
    if opp not in found or a not in found or b not in found:
        return None
    mx = found[a][0] + found[b][0] - found[opp][0]
    my = found[a][1] + found[b][1] - found[opp][1]
    if not (-tol * w <= mx <= (1 + tol) * w and -tol * h <= my <= (1 + tol) * h):
        return None
    cand = dict(found)
    cand[m] = (mx, my)
    if not _is_convex_quad([cand[c] for c in CORNERS]):
        return None
    return m, (mx, my)


def _detect_anchor_corners_ex(
    image: np.ndarray, config: dict
) -> tuple[dict[str, tuple[float, float]] | None, str, dict]:
    """Como `detect_anchor_corners`, mas devolve também metadados de alinhamento.

    meta = {"method": "anchors"|"page"|"none", "detected": [...],
            "inferred": [...]}
    """
    cfg = normalize_config(config)
    h, w = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image

    found: dict[str, tuple[float, float]] = {}
    missing: list[str] = []
    inferred: list[str] = []
    expected = _expected_corners_px(cfg, w, h)

    aruco_anchors = [a for a in cfg["anchors"] if a["type"] == "aruco" and a["aruco_id"] is not None]
    if aruco_anchors:
        try:
            det = detect_markers(image)
            by_id = {m.id: m.center for m in det.markers}
        except Exception:
            by_id = {}
        for a in aruco_anchors:
            corner = a["corner"] or _infer_corner(cfg["anchors"], a["id"])
            c = by_id.get(a["aruco_id"])
            if c is not None and corner and corner not in found:
                found[corner] = (float(c[0]), float(c[1]))

    quad_anchors = [a for a in cfg["anchors"] if a["type"] == "quad"]
    if quad_anchors and len(found) < 4:
        try:
            cands = _square_candidates(gray)
        except Exception:
            cands = []
        centers = [(float(c[:, 0].mean()), float(c[:, 1].mean())) for c in cands]
        for a in quad_anchors:
            corner = a["corner"] or _infer_corner(cfg["anchors"], a["id"])
            if not corner or corner in found:
                continue
            ex, ey = a["x"] * w, a["y"] * h
            tol = max(10.0, a["tolerance"] * max(w, h))
            best = None
            best_d = tol
            for (cx, cy) in centers:
                d = math.hypot(cx - ex, cy - ey)
                if d < best_d:
                    best_d = d
                    best = (cx, cy)
            if best is not None:
                found[corner] = best

    found = {c: (float(p[0]), float(p[1])) for c, p in found.items()}
    missing = [c for c in CORNERS if c not in found]
    if not missing:
        return found, "", {"method": "anchors", "detected": sorted(found), "inferred": []}

    # 4ª âncora inferida pelo paralelepípedo — só quando a config espera os
    # 4 cantos e exatamente um faltou. Evita cair na borda da página (que
    # perde precisão quando o cartão não preenche o quadro da foto).
    if len(expected) == 4 and len(missing) == 1:
        inferred_pair = _infer_missing_corner(found, w, h)
        if inferred_pair is not None:
            corner, xy = inferred_pair
            found[corner] = xy
            found = {c: (float(p[0]), float(p[1])) for c, p in found.items()}
            inferred.append(corner)
            return found, "", {"method": "anchors", "detected": sorted(set(found) - set(inferred)),
                               "inferred": sorted(inferred)}

    # Fallback: borda da página (método alternativo confiável)
    page = _detect_page_corners(gray)
    if page is not None:
        return page, "", {"method": "page", "detected": sorted(page), "inferred": []}

    return None, ("Âncoras não detectadas (faltam: " + ", ".join(missing)
                  + ") e a borda da página não pôde ser usada como alinhamento."), \
        {"method": "none", "detected": sorted(found), "inferred": sorted(inferred)}


def detect_anchor_corners(image: np.ndarray, config: dict) -> tuple[dict[str, tuple[float, float]] | None, str]:
    """Devolve {corner: (x, y) em px da foto} ou (None, motivo)."""
    corners, reason, _meta = _detect_anchor_corners_ex(image, config)
    return corners, reason


def build_homography_ex(
    image: np.ndarray, config: dict
) -> tuple[np.ndarray | None, int, int, str, dict]:
    """Como `build_homography`, mas devolve também os metadados de detecção."""
    corners, reason, meta = _detect_anchor_corners_ex(image, config)
    cw, ch = canonical_size(config)
    if corners is None:
        return None, cw, ch, reason, meta

    cfg = normalize_config(config)
    # Pontos de destino: as posições médias das âncoras (se houver) ou a
    # página inteira quando o alinhamento veio da borda.
    expected = _expected_corners_px(cfg, cw, ch)
    if len(expected) == 4:
        dst_map = expected
    else:
        dst_map = {"TL": (0.0, 0.0), "TR": (float(cw), 0.0),
                   "BR": (float(cw), float(ch)), "BL": (0.0, float(ch))}

    src = np.array([corners[c] for c in CORNERS], dtype=np.float32)
    dst = np.array([dst_map[c] for c in CORNERS], dtype=np.float32)
    try:
        M = cv2.getPerspectiveTransform(src, dst)
    except cv2.error:
        return None, cw, ch, "Geometria inválida das âncoras (não foi possível retificar).", meta
    return M, cw, ch, "", meta


def build_homography(image: np.ndarray, config: dict) -> tuple[np.ndarray | None, int, int, str]:
    """Matriz foto→canônico + dimensões do alvo. (None, 0, 0, motivo) em falha."""
    M, cw, ch, reason, _meta = build_homography_ex(image, config)
    return M, cw, ch, reason


# ---------------------------------------------------------------------------
# Leitura
# ---------------------------------------------------------------------------

def omr_params_from_config(config: dict) -> tuple[OmrParams, bool]:
    cfg = normalize_config(config)
    op = cfg["omr_params"]
    params = OmrParams(
        floor=op.get("floor"),
        margin=op.get("margin"),
        low_conf_threshold=op.get("low_conf_threshold"),
    )
    return params, bool(op.get("adaptive", False))


def _decode_custom_qr(gray: np.ndarray, config: dict) -> str | None:
    cfg = normalize_config(config)
    qr = cfg["qr"]
    if qr is None:
        return None
    h, w = gray.shape[:2]
    pad_x = 0.02 * w
    pad_y = 0.02 * h
    x0 = max(0, int(qr["x"] * w - pad_x))
    y0 = max(0, int(qr["y"] * h - pad_y))
    x1 = min(w, int((qr["x"] + qr["w"]) * w + pad_x))
    y1 = min(h, int((qr["y"] + qr["h"]) * h + pad_y))
    if x1 <= x0 or y1 <= y0:
        return None
    crop = gray[y0:y1, x0:x1]
    data = _decode_qr_from(crop)
    if data:
        return data
    if crop.size:
        big = cv2.resize(crop, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
        data = _decode_qr_from(big)
        if data:
            return data
    return None


def _min_bubble_spacing_px(cfg: dict, w: int, h: int) -> float:
    """Menor espaçamento previsto entre centros de bolhas (px)."""
    cands: list[float] = []
    for b in cfg["questions"]:
        if b["option_step_x"] > 0:
            cands.append(b["option_step_x"] * w)
        if b["question_step_y"] > 0:
            cands.append(b["question_step_y"] * h)
        if b["column_step_x"]:
            cands.append(b["column_step_x"] * w)
    positive = [c for c in cands if c > 0]
    return min(positive) if positive else 0.0


def _roi_radius_px(cfg: dict, w: int, h: int) -> float:
    bubbles = expand_bubbles(cfg)
    if not bubbles:
        return 0.0
    return float(np.median([b["r"] for b in bubbles])) * max(w, h)


def detect_bubble_centers(gray: np.ndarray, config: dict) -> list[tuple[float, float]]:
    """Centros de bolha candidatos na imagem retificada (contornos do tamanho esperado).

    Não depende de a bolha estar marcada: pega tanto o contorno impresso
    quanto a marca preenchida. Filtra por área (0.25×–4× a área esperada),
    proporção e circularidade — descarta texto e linhas.
    """
    cfg = normalize_config(config)
    h, w = gray.shape[:2]
    r_px = _roi_radius_px(cfg, w, h)
    if r_px <= 0:
        return []
    exp_area = math.pi * r_px * r_px
    if exp_area <= 0:
        return []
    try:
        blur = cv2.GaussianBlur(gray, (3, 3), 0)
        _, bw = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    except cv2.error:
        return []
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    try:
        bw = cv2.morphologyEx(bw, cv2.MORPH_OPEN, k)
        cnts, _ = cv2.findContours(bw, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    except cv2.error:
        return []

    out: list[tuple[float, float]] = []
    for c in cnts:
        area = float(cv2.contourArea(c))
        if area < 0.25 * exp_area or area > 4.0 * exp_area:
            continue
        x, y, ww, hh = cv2.boundingRect(c)
        if ww <= 0 or hh <= 0:
            continue
        aspect = ww / float(hh)
        if aspect < 0.4 or aspect > 2.5:
            continue
        peri = float(cv2.arcLength(c, True))
        if peri <= 0:
            continue
        circularity = 4.0 * math.pi * area / (peri * peri)
        if circularity < 0.25:
            continue
        out.append((x + ww / 2.0, y + hh / 2.0))
    return out


def _nearest_dist(pts: list[tuple[float, float]], x: float, y: float) -> float:
    best = float("inf")
    for (px, py) in pts:
        d = (px - x) ** 2 + (py - y) ** 2
        if d < best:
            best = d
    return math.sqrt(best)


def check_alignment(
    image: np.ndarray,
    config: dict,
    inferred: list[str] | None = None,
    strict: bool = False,
) -> dict:
    """Confirma que a GRADE CAIU SOBRE as bolhas na imagem já retificada.

    Dois sinais complementares:
    - grade: precisão dos centros de bolha detectados sobre a grade prevista;
    - tinta: concentração de tinta dentro das ROIs (quando há poucos contornos).

    Devolve um dict com `ok` e as métricas. Nunca rejeita por ausência de
    tinta (folha em branco é uma leitura legítima).
    """
    cfg = normalize_config(config)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    h, w = gray.shape[:2]
    bubbles = expand_bubbles(cfg)
    if not bubbles:
        return {"ok": True, "method": "empty", "centers": 0, "matched": 0,
                "precision": None, "enrichment": None, "ink_frac": 0.0, "detail": "sem bolhas"}

    inferred = list(inferred or [])
    strict = strict or bool(inferred)
    min_precision = ALIGN_INFERRED_CENTER_PRECISION if strict else ALIGN_MIN_CENTER_PRECISION
    min_enrichment = ALIGN_INFERRED_MIN_ENRICHMENT if strict else ALIGN_MIN_ENRICHMENT

    exp = [(b["x"] * w, b["y"] * h) for b in bubbles]
    r_px = _roi_radius_px(cfg, w, h)
    spacing = _min_bubble_spacing_px(cfg, w, h)
    tol = max(0.6 * r_px, (0.30 * spacing) if spacing > 0 else 0.0, 3.0)

    # --- Sinal 1: centros de bolha sobre a grade ---------------------------
    centers = detect_bubble_centers(gray, cfg)
    # Remove candidatos que na verdade são âncoras ou QR (não são bolhas).
    excl: list[tuple[float, float, float]] = []
    for a in cfg["anchors"]:
        er = max(1.5 * a["size"] * max(w, h), 1.5 * r_px)
        excl.append((a["x"] * w, a["y"] * h, er))
    _qr = cfg["qr"]
    if _qr is not None:
        er = 0.75 * math.hypot(_qr["w"] * w, _qr["h"] * h)
        excl.append(((_qr["x"] + _qr["w"] / 2.0) * w, (_qr["y"] + _qr["h"] / 2.0) * h, er))
    if excl:
        centers = [c for c in centers
                   if not any((c[0] - ex) ** 2 + (c[1] - ey) ** 2 <= er ** 2
                              for (ex, ey, er) in excl)]
    min_centers = max(ALIGN_MIN_CENTERS, int(round(0.15 * len(bubbles))))
    precision = None
    matched = 0
    if len(centers) >= min_centers:
        for (cx, cy) in centers:
            if _nearest_dist(exp, cx, cy) <= tol:
                matched += 1
        precision = matched / float(len(centers))
        ok = precision >= min_precision
        return {
            "ok": bool(ok), "method": "grid", "centers": len(centers),
            "matched": matched, "precision": round(precision, 4), "tol_px": round(tol, 1),
            "enrichment": None, "ink_frac": None,
            "detail": ("grade alinhada" if ok else
                       f"grade desalinhada ({matched}/{len(centers)} centros sobre a grade)"),
        }

    # --- Sinal 2: tinta concentrada nas ROIs -------------------------------
    try:
        _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    except cv2.error:
        return {"ok": True, "method": "error", "centers": len(centers), "matched": 0,
                "precision": None, "enrichment": None, "ink_frac": None,
                "detail": "binarização falhou"}
    ink = bw > 0
    ink_frac = float(ink.sum()) / float(h * w)
    if ink_frac < ALIGN_MIN_INK_FRAC:
        return {"ok": True, "method": "insufficient_ink", "centers": len(centers),
                "matched": 0, "precision": None, "enrichment": None,
                "ink_frac": round(ink_frac, 5), "detail": "pouca tinta: não há como julgar"}

    mask = np.zeros((h, w), dtype=np.uint8)
    rr = int(max(3.0, r_px))
    for (x, y) in exp:
        cv2.circle(mask, (int(round(x)), int(round(y))), rr, 255, -1)
    roi = mask > 0
    roi_area = float(roi.sum())
    if roi_area <= 0:
        return {"ok": True, "method": "error", "centers": len(centers), "matched": 0,
                "precision": None, "enrichment": None, "ink_frac": round(ink_frac, 5),
                "detail": "ROIs vazias"}
    ink_in = float((ink & roi).sum())
    enrichment = (ink_in / roi_area) / max(1e-9, ink_frac)
    ok = enrichment >= min_enrichment
    return {
        "ok": bool(ok), "method": "ink", "centers": len(centers), "matched": 0,
        "precision": None, "enrichment": round(enrichment, 3),
        "ink_frac": round(ink_frac, 5), "detail": (
            "tinta concentrada nas bolhas" if ok else
            f"tinta não cai nas bolhas (enriquecimento {enrichment:.2f})"),
    }


def process_custom_image(
    image: np.ndarray,
    config: dict,
    adaptive: bool = False,
    debug: bool = False,
    overrides: OmrParams | None = None,
    strict_alignment: bool = True,
    diagnostics: dict | None = None,
) -> OMRResult | None:
    """Lê um cartão personalizado. None = não foi possível retificar/ler.

    `diagnostics`, se fornecido, recebe {"reason", "detail", "alignment"} para
    explicar a falha (None = sucesso).
    """
    import time as _time

    def _fail(reason: str, detail: str = "", alignment: dict | None = None) -> None:
        if diagnostics is not None:
            diagnostics["reason"] = reason
            diagnostics["detail"] = detail
            diagnostics["alignment"] = alignment

    cfg = normalize_config(config)
    p_base, cfg_adaptive = omr_params_from_config(cfg)
    p = overrides if overrides is not None else p_base
    adaptive = adaptive or cfg_adaptive

    _t0 = _time.perf_counter()
    M, cw, ch, reason, anchor_meta = build_homography_ex(image, cfg)
    t_detect = _time.perf_counter() - _t0
    if M is None:
        _fail("anchors", reason)
        return None

    _t1 = _time.perf_counter()
    try:
        rectified = cv2.warpPerspective(image, M, (cw, ch))
    except cv2.error:
        _fail("warp")
        return None
    t_warp = _time.perf_counter() - _t1

    gray = cv2.cvtColor(rectified, cv2.COLOR_BGR2GRAY) if len(rectified.shape) == 3 else rectified
    blur_var = cv2.Laplacian(gray, cv2.CV_64F).var()
    if blur_var < BLUR_BLOCK:
        _fail("blur", f"foto borrada (variância {blur_var:.1f} < {BLUR_BLOCK})")
        return None

    clahe = cv2.createCLAHE(
        clipLimit=p.clahe_clip if p.clahe_clip is not None else 2.0,
        tileGridSize=p.clahe_tiles if p.clahe_tiles is not None else (8, 8),
    )
    gray = clahe.apply(gray)

    # Confiança de alinhamento: a grade realmente caiu sobre as bolhas?
    # (P0) Rejeita alinhamento plausível-mas-errado antes de produzir respostas.
    alignment = check_alignment(gray, cfg, inferred=anchor_meta.get("inferred"))
    alignment["anchor_method"] = anchor_meta.get("method")
    alignment["inferred_corners"] = anchor_meta.get("inferred", [])
    if strict_alignment and not alignment["ok"]:
        _fail("alignment", alignment.get("detail", ""), alignment)
        return None

    _t2 = _time.perf_counter()
    qr_id = _decode_custom_qr(gray, cfg)
    t_qr = _time.perf_counter() - _t2
    _t3 = _time.perf_counter()

    weights = p.weights if p.weights is not None else DEFAULT_WEIGHTS
    all_ratios: dict[int, dict[str, float]] = {}
    geom: dict[int, list] = {}

    for b in expand_bubbles(cfg):
        q = b["question"]
        cx = b["x"] * cw
        cy = b["y"] * ch
        r_px = max(3.0, b["r"] * max(cw, ch))
        if b["shape"] == "square":
            inset = p.square_inset if p.square_inset is not None else 6
            m = _square_metrics(gray, cx, cy, side=r_px * 2.0, inset=inset, weights=weights)
        else:
            inner = p.inner_radius if p.inner_radius is not None else max(3, int(round(r_px)) - 2)
            m = _bubble_metrics(gray, int(round(cx)), int(round(cy)), radius=inner, weights=weights)
        all_ratios.setdefault(q, {})[b["option"]] = m.score
        if debug:
            geom.setdefault(q, []).append((cx, cy, r_px, b["option"]))

    floor, floor_source = compute_floor_for("custom", all_ratios, adaptive)
    if p.floor is not None:
        floor, floor_source = p.floor, "override"
    margin = p.margin if p.margin is not None else MARGIN

    answers: dict[int, str] = {}
    blank: list[int] = []
    duplicates: list[int] = []
    dup_marks: dict[int, list[str]] = {}
    low_conf: list[int] = []
    darkest: list[int] = []
    fallback_resolved: list[int] = []

    qmap = question_block_map(cfg)

    for q_num, ratios in all_ratios.items():
        blk = qmap.get(q_num) or {}
        # Marca mais escura só resolve dupla quando o bloco NÃO aceita
        # múltiplas respostas (senão múltiplas é o esperado).
        pick_darkest = bool(blk.get("pick_darkest_mark")) and not bool(blk.get("multi_answer"))
        status, best_letter, marks = classify_question(
            ratios, floor=floor, margin=margin, low_thr=p.low_conf_threshold,
            pick_darkest=pick_darkest,
            darkest_gap=blk.get("darkest_mark_threshold"),
        )
        # Fallback de questão vazia: relê com limiar mais permissivo, exigindo
        # vencedor claro (gap próprio) para não inventar resposta.
        if status == "blank" and blk.get("fallback_on_empty"):
            fb_floor = blk.get("fallback_floor")
            if fb_floor is None:
                fb_floor = max(FALLBACK_MIN_SCORE, floor * FALLBACK_FLOOR_FACTOR)
            ordered = sorted(ratios.items(), key=lambda kv: kv[1], reverse=True)
            if ordered:
                fb_letter, fb_best = ordered[0]
                fb_second = ordered[1][1] if len(ordered) > 1 else 0.0
                if fb_best >= fb_floor and (fb_best - fb_second) >= FALLBACK_MIN_GAP:
                    status, best_letter = "fallback", fb_letter

        if status == "blank":
            blank.append(q_num)
        elif status == "duplicate":
            duplicates.append(q_num)
            dup_marks[q_num] = marks
        elif status == "darkest":
            darkest.append(q_num)
            if best_letter:
                answers[q_num] = best_letter
        elif status == "fallback":
            fallback_resolved.append(q_num)
            if best_letter:
                answers[q_num] = best_letter
        elif status == "low":
            low_conf.append(q_num)
            if best_letter:
                answers[q_num] = best_letter
        else:
            if best_letter:
                answers[q_num] = best_letter

    t_score = _time.perf_counter() - _t3

    debug_points = None
    if debug:
        from .debug import build_debug_points
        debug_points = build_debug_points(geom, all_ratios, answers, blank, duplicates, low_conf)

    return OMRResult(
        answers=answers,
        blank_questions=sorted(blank),
        duplicate_questions=sorted(duplicates),
        low_confidence=sorted(low_conf),
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
        alignment=alignment,
        darkest_marks=sorted(darkest),
        fallback_marks=sorted(fallback_resolved),
    )


# ---------------------------------------------------------------------------
# Impressão (seção 7) — usa a imagem original como fundo
# ---------------------------------------------------------------------------

def render_overlay(config: dict, base_bgr: np.ndarray, fields: dict[str, str] | None = None,
                   qr_payload: str | None = None) -> np.ndarray:
    """Desenha os campos dinâmicos + QR sobre a imagem original do cartão.

    `fields`: valores por origem (student_name, turma, matricula, exam_title,
    subject, date, code, ...). Nunca altera a geometria das regiões.
    """
    from PIL import Image, ImageDraw

    from .template import load_font, make_qr_image

    cfg = normalize_config(config)
    img = base_bgr.copy()
    h, w = img.shape[:2]

    # QR (se configurado e payload disponível)
    qr = cfg["qr"]
    if qr is not None and qr_payload:
        try:
            size = max(24, int(min(qr["w"] * w, qr["h"] * h)))
            qr_img = make_qr_image(qr_payload, size=size)
            pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
            x = int(qr["x"] * w)
            y = int(qr["y"] * h)
            pil.paste(qr_img, (x, y))
            img = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
        except Exception:
            pass

    # Texto por região informativa
    pf = cfg["print_fields"]
    if pf and fields:
        info = {r["id"]: r for r in cfg["info_regions"]}
        pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        d = ImageDraw.Draw(pil)
        for f in pf:
            region = info.get(f["region_id"])
            if region is None:
                continue
            text = (fields.get(f["source"]) or "").strip()
            if not text:
                continue
            font = load_font(max(10, int(f["font_size"])))
            rx = int(region["x"] * w)
            ry = int(region["y"] * h)
            rw = int(region["w"] * w)
            rh = int(region["h"] * h)
            align = f["align"]
            tw = d.textlength(text, font=font)
            if align == "center":
                tx = rx + max(0, (rw - tw) // 2)
            elif align == "right":
                tx = rx + max(0, rw - tw)
            else:
                tx = rx
            ty = ry + max(0, (rh - f["font_size"]) // 2)
            d.text((tx, ty), text, fill=(0, 0, 0), font=font)
        img = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)

    return img


def render_preview_overlay(config: dict, base_bgr: np.ndarray) -> np.ndarray:
    """Desenha as regiões configuradas sobre a imagem (prévia do editor)."""
    cfg = normalize_config(config)
    img = base_bgr.copy()
    h, w = img.shape[:2]

    def _rect(x, y, ww, hh, color, label):
        x0, y0 = int(x * w), int(y * h)
        x1, y1 = int((x + ww) * w), int((y + hh) * h)
        cv2.rectangle(img, (x0, y0), (x1, y1), color, 2)
        if label:
            cv2.putText(img, label, (x0 + 3, max(14, y0 - 4)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2, cv2.LINE_AA)

    for a in cfg["anchors"]:
        s = a["size"]
        _rect(a["x"] - s / 2, a["y"] - s / 2, s, s, (0, 165, 255), f"A:{a['id']}")
    qr = cfg["qr"]
    if qr is not None:
        _rect(qr["x"], qr["y"], qr["w"], qr["h"], (255, 0, 0), "QR")
    for r in cfg["info_regions"]:
        _rect(r["x"], r["y"], r["w"], r["h"], (0, 200, 0), f"I:{r['id']}")
    for b in expand_bubbles(cfg):
        cx, cy = int(b["x"] * w), int(b["y"] * h)
        r_px = max(3, int(b["r"] * max(w, h)))
        cv2.circle(img, (cx, cy), r_px, (0, 0, 200), 2)
    return img


def config_summary(config: dict) -> dict:
    cfg = normalize_config(config)
    return {
        "n_anchors": len(cfg["anchors"]),
        "has_qr": cfg["qr"] is not None,
        "n_info_regions": len(cfg["info_regions"]),
        "n_blocks": len(cfg["questions"]),
        "n_questions": total_questions(cfg),
        "n_print_fields": len(cfg["print_fields"]),
        "page_w": cfg["page_w"],
        "page_h": cfg["page_h"],
    }
