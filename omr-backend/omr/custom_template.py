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
modelos nativos. Blocos podem optar pelo estilo de marcação "marks"
(check/X esparso), que usa uma métrica de tinta interior com limiar
absoluto reescalada para a mesma faixa do estilo "filled".
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

# --- Estilo de marcação (P2) -----------------------------------------------
# "filled": bolha preenchida — score = `_bubble_metrics` (comportamento atual).
# "marks": marca esparsa (check/X). Uma marca em X cobre pouca área, então a
#   média de intensidade fica alta (clara) e o score atual cai ABAIXO do piso;
#   além disso o Otsu é instável numa ROI quase uniforme. Por isso o estilo
#   "marks" mede a fração de tinta no INTERIOR da bolha com limiar ABSOLUTO
#   relativo ao papel local, e a reescala para a mesma faixa do "filled"
#   (vazio ≈ 0, marca clara ≈ 1) — assim piso/margem seguem válidos.
MARKS_INNER_FACTOR = 0.72        # região interna (ignora o contorno impresso)
MARKS_INK_DELTA = 40             # quão mais escuro que o papel conta como tinta (0-255)
MARKS_REFERENCE_COVERAGE = 0.35  # cobertura de referência de uma marca clara

# --- Múltipla resposta (P2) -------------------------------------------------
# Mínimo de marcas de uma questão de múltipla resposta quando o bloco não
# informa `multi_marks_min`; o máximo default é o nº de alternativas do bloco.
MULTI_MARKS_MIN_DEFAULT = 2


# ---------------------------------------------------------------------------
# Normalização / esquema
# ---------------------------------------------------------------------------

def default_config(page_w: int = 0, page_h: int = 0) -> dict:
    """Configuração vazia (esqueleto) para um cartão recém-importado."""
    return {
        "schema_version": SCHEMA_VERSION,
        "page_w": int(page_w),
        "page_h": int(page_h),
        # Multi-página: o modelo pode ter N páginas sobre a MESMA folha
        # importada. Âncoras/blocos carregam `page` (0-based); QR, regiões
        # informativas, campos de impressão e parâmetros são compartilhados.
        "n_pages": 1,
        "anchors": [],
        # Cantos da FOLHA dentro da imagem do modelo (normalizados, TL/TR/BR/BL).
        # Servem de DESTINO da homografia quando não há 4 âncoras de canto —
        # indicam onde a folha está na imagem importada (que pode ter margens).
        "page_corners": None,
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


def _opt_int(v: Any) -> int | None:
    """Inteiro opcional; None/'' preservam a ausência (o default é resolvido no uso)."""
    if v is None or v == "":
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _page_index(v: Any) -> int:
    """Índice de página (0-based) tolerante a ausência/valor inválido."""
    try:
        return max(0, int(v))
    except (TypeError, ValueError):
        return 0


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
            "page": _page_index(a.get("page")),
            "x": _clamp01(a.get("x")),
            "y": _clamp01(a.get("y")),
            "size": _clamp01(a.get("size"), 0.05) or 0.05,
            "tolerance": _clamp01(a.get("tolerance"), 0.15) or 0.15,
            "required": bool(a.get("required", True)),
        })
    out["anchors"] = anchors

    # page_corners: lista de 4 {x, y} normalizados (ou None).
    pc = cfg.get("page_corners")
    if isinstance(pc, list) and len(pc) == 4:
        out["page_corners"] = []
        for p in pc:
            if isinstance(p, dict):
                out["page_corners"].append({
                    "x": _clamp01(p.get("x")),
                    "y": _clamp01(p.get("y")),
                })
            elif isinstance(p, (list, tuple)) and len(p) >= 2:
                out["page_corners"].append({
                    "x": _clamp01(p[0]),
                    "y": _clamp01(p[1]),
                })
            else:
                out["page_corners"] = None
                break
        if out["page_corners"] is None or len(out["page_corners"]) != 4:
            out["page_corners"] = None
    else:
        out["page_corners"] = None

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
            "page": _page_index(b.get("page")),
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
            # Múltipla resposta (P2): nº de marcas aceitas quando multi_answer=True
            "multi_marks_min": _opt_int(b.get("multi_marks_min")),
            "multi_marks_max": _opt_int(b.get("multi_marks_max")),
            "points": float(b.get("points", 1.0) or 0.0),
            "annulled": bool(b.get("annulled", False)),
            # Regras alternativas de decisão (P1)
            "pick_darkest_mark": bool(b.get("pick_darkest_mark", False)),
            "darkest_mark_threshold": _opt_clamp01(b.get("darkest_mark_threshold")),
            "fallback_on_empty": bool(b.get("fallback_on_empty", False)),
            "fallback_floor": _opt_clamp01(b.get("fallback_floor")),
            # Estilo de marcação (P2): "filled" (bolha preenchida) | "marks" (check/X)
            "mark_style": b.get("mark_style") if b.get("mark_style") in ("filled", "marks") else "filled",
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

    # Multi-página: respeita o nº declarado pelo editor e nunca "corta" uma
    # página que ainda tenha âncora/bloco (evita regiões inalcançáveis).
    used = [a["page"] for a in out["anchors"]] + [b["page"] for b in out["questions"]]
    out["n_pages"] = max(1, _page_index(cfg.get("n_pages") or 1),
                         (max(used) + 1) if used else 1)
    return out


# ---------------------------------------------------------------------------
# Multi-página (mesma folha, N páginas)
# ---------------------------------------------------------------------------

def n_pages(config: dict | None) -> int:
    """Nº de páginas do modelo (>= 1). Modelos antigos = 1 página."""
    return max(1, int(normalize_config(config).get("n_pages") or 1))


def config_for_page(config: dict | None, page: int = 0) -> dict:
    """Recorte da config relativo a UMA página (mesma folha importada).

    Cada âncora/bloco carrega `page`; a leitura e a validação por página usam
    só as regiões da página pedida. QR, regiões informativas, campos de
    impressão e `omr_params` são compartilhados entre as páginas.
    """
    cfg = normalize_config(config)
    total = max(1, int(cfg.get("n_pages") or 1))
    idx = max(0, min(total - 1, int(page or 0)))
    out = dict(cfg)
    out["anchors"] = [a for a in cfg["anchors"] if int(a.get("page") or 0) == idx]
    out["questions"] = [q for q in cfg["questions"] if int(q.get("page") or 0) == idx]
    return out


def question_offset_before_page(config: dict | None, page: int) -> int:
    """Menor número de questão livre considerando as páginas ANTERIORES.

    Usado para numerar blocos detectados numa página sem repetir questões
    já existentes nas páginas anteriores (numeração contínua no cartão).
    """
    cfg = normalize_config(config)
    idx = max(0, int(page or 0))
    used: set[int] = set()
    for b in cfg["questions"]:
        if int(b.get("page") or 0) >= idx:
            continue
        for bubble in expand_block(b):
            used.add(int(bubble["question"]))
    return (max(used) + 1) if used else 1


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


def multi_bounds(block: dict) -> tuple[int, int]:
    """(mínimo, máximo) de marcas aceitas numa questão de múltipla resposta.

    `multi_marks_min` default = 2 ("múltiplas" implica mais de uma) e
    `multi_marks_max` default = nº de alternativas do bloco. O máximo nunca
    fica abaixo do mínimo.
    """
    lo = block.get("multi_marks_min")
    hi = block.get("multi_marks_max")
    labels = block.get("labels") or []
    lo_i = int(lo) if lo is not None else MULTI_MARKS_MIN_DEFAULT
    hi_i = int(hi) if hi is not None else len(labels)
    lo_i = max(1, lo_i)
    hi_i = max(lo_i, hi_i)
    return lo_i, hi_i


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

    pc = cfg.get("page_corners")
    if isinstance(pc, list) and len(pc) == 4:
        pts = [(float(p["x"]), float(p["y"])) for p in pc]
        if not _is_convex_quad(pts):
            add("warning", "page_corners_invalid",
                "Cantos da folha não formam um quadrilátero convexo; "
                "redetecte ou ajuste os pontos.", None)

    total_pages = max(1, int(cfg.get("n_pages") or 1))
    multi = total_pages > 1

    # Âncoras são POR PÁGINA (cada página tem o próprio conjunto de 4 cantos).
    for p in range(total_pages):
        page_tag = f" (página {p + 1})" if multi else ""
        anchors = [a for a in cfg["anchors"] if int(a.get("page") or 0) == p]
        if len(anchors) != 4:
            add("warning", "anchors_count",
                f"{len(anchors)} âncora(s) configurada(s){page_tag}; o ideal são 4 (uma por canto). "
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
            add("error", "anchors_duplicate",
                f"Cantos duplicados nas âncoras{page_tag}: {', '.join(sorted(dup))}.", None)

    qr = cfg["qr"]
    if qr is not None and (qr["w"] <= 0 or qr["h"] <= 0):
        add("error", "qr_size", "Região de QR Code sem largura/altura.", qr["id"])

    for r in cfg["info_regions"]:
        if r["w"] <= 0 or r["h"] <= 0:
            add("error", "info_size", "Região informativa sem largura/altura.", r["id"])
        if r["x"] + r["w"] > 1.0001 or r["y"] + r["h"] > 1.0001:
            add("warning", "info_overflow", "Região informativa ultrapassa a borda da imagem.", r["id"])

    # Cada página precisa de pelo menos um bloco de questões.
    for p in range(total_pages):
        blocks_p = [b for b in cfg["questions"] if int(b.get("page") or 0) == p]
        if blocks_p:
            continue
        if multi:
            add("error", "page_no_questions",
                f"Página {p + 1} não tem nenhum bloco de questões — desenhe ao menos um.",
                None)
        else:
            add("error", "no_questions",
                "Nenhuma questão configurada — desenhe ao menos um bloco de bolhas.", None)

    question_numbers: dict[int, str] = {}
    bboxes: dict[int, list[tuple[str, tuple[float, float, float, float]]]] = {}
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

        # Múltipla resposta (P2) — avisos, não bloqueiam geometria.
        lo, hi = b["multi_marks_min"], b["multi_marks_max"]
        n_labels = len(b["labels"])
        if not b["multi_answer"] and (lo is not None or hi is not None):
            add("warning", "block_multi_bounds_unused",
                "Limites de 'múltiplas marcações' definidos, mas o bloco não aceita "
                "múltiplas respostas.", b["id"])
        if lo is not None and lo < MULTI_MARKS_MIN_DEFAULT:
            add("warning", "block_multi_min",
                f"Mínimo de marcas de uma múltipla resposta deve ser ≥ {MULTI_MARKS_MIN_DEFAULT} "
                "(uma só marca já é resposta normal).", b["id"])
        if hi is not None and hi > n_labels:
            add("warning", "block_multi_max",
                f"Máximo de marcas ({hi}) maior que o número de alternativas ({n_labels}).", b["id"])
        if lo is not None and hi is not None and lo > hi:
            add("warning", "block_multi_range",
                f"Mínimo ({lo}) maior que o máximo ({hi}) de marcas aceitas.", b["id"])

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
            # Sobreposição só faz sentido entre blocos da MESMA página (num
            # modelo multi-página as páginas usam a mesma folha e, portanto,
            # se sobrepõem por construção).
            bboxes.setdefault(int(b.get("page") or 0), []).append((b["id"], bb))

    # Sobreposição suspeita entre blocos (retângulos se tocam muito)
    for page_bboxes in bboxes.values():
        for i in range(len(page_bboxes)):
            for j in range(i + 1, len(page_bboxes)):
                a_id, a = page_bboxes[i]
                b_id, b = page_bboxes[j]
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


def _sheet_region_from_blocks(cfg: dict, w: int, h: int) -> tuple[float, float, float, float] | None:
    """Bounding box (x0, y0, x1, y1) em px dos blocos de bolhas, ou None.

    A geometria dos blocos é normalizada (0..1) relativa à IMAGEM, então a
    conversão para px usa as dimensões reais da imagem — independe de
    `page_w/page_h` (que podem estar defasados após trocar a imagem).
    """
    nx0: list[float] = []
    ny0: list[float] = []
    nx1: list[float] = []
    ny1: list[float] = []
    for b in cfg.get("questions") or []:
        if not isinstance(b, dict):
            continue
        try:
            fx = float(b["first_x"])
            fy = float(b["first_y"])
            n_q = max(1, int(b.get("n_questions") or 1))
            labels = b.get("labels") or ["A", "B", "C", "D"]
            n_opt = max(1, len(labels))
            cols = max(1, int(b.get("columns") or 1))
            step_x = float(b.get("option_step_x") or 0)
            step_y = float(b.get("question_step_y") or 0)
            col_step = b.get("column_step_x")
            col_step = float(col_step) if col_step else step_x * n_opt
            rows = max(1, (n_q + cols - 1) // cols)
            c_lo = min(fx, fx + col_step * (cols - 1))
            c_hi = max(fx, fx + col_step * (cols - 1)) + step_x * (n_opt - 1)
            nx0.append(c_lo); ny0.append(fy)
            nx1.append(c_hi); ny1.append(fy + step_y * (rows - 1))
        except (KeyError, TypeError, ValueError):
            continue
    if not nx0:
        return None
    return (min(nx0) * w, min(ny0) * h, max(nx1) * w, max(ny1) * h)


def _point_in_quad(pt: tuple[float, float], quad: np.ndarray) -> bool:
    """True se o ponto está dentro do quadrilátero (convexo, em ordem)."""
    if pt is None:
        return False
    return cv2.pointPolygonTest(quad.reshape(-1, 1, 2).astype(np.float32),
                                (float(pt[0]), float(pt[1])), False) >= 0


def _detect_page_corners(gray: np.ndarray,
                         config: dict | None = None
                         ) -> dict[str, tuple[float, float]] | None:
    """Maior quadrilátero da imagem como borda da página (método alternativo).

    Tenta Otsu (vários blurs), threshold adaptativo e Canny. Aceita cartão
    ocupando >= 5% do frame. Quando `config` traz blocos de bolhas, prefere o
    quadrilátero que CONTÉM a região dos blocos (evita pegar uma coluna).
    Se nada for encontrado, devolve None (o chamador pode usar os cantos da
    imagem como último recurso).
    """
    h, w = gray.shape[:2]
    region = _sheet_region_from_blocks(normalize_config(config), w, h) if config else None
    region_center = None
    if region is not None:
        region_center = ((region[0] + region[2]) / 2.0, (region[1] + region[3]) / 2.0)

    quad_best: list[tuple[float, np.ndarray]] = []
    candidates_bw = []
    for blur_k in ((3, 3), (5, 5), (7, 7)):
        try:
            blur = cv2.GaussianBlur(gray, blur_k, 0)
        except cv2.error:
            continue
        for thr in (cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU, None):
            try:
                if thr is None:
                    bw = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                               cv2.THRESH_BINARY_INV, 31, 5)
                else:
                    _, bw = cv2.threshold(blur, 0, 255, thr)
                candidates_bw.append(bw)
            except cv2.error:
                continue
    # Canny
    try:
        edges = cv2.Canny(gray, 50, 150)
        edges = cv2.dilate(edges, None, iterations=2)
        candidates_bw.append(edges)
    except cv2.error:
        pass

    for bw in candidates_bw:
        try:
            cnts, _ = cv2.findContours(bw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        except cv2.error:
            continue
        for c in cnts:
            area = float(cv2.contourArea(c))
            if area < 0.05 * w * h:
                continue
            peri = float(cv2.arcLength(c, True))
            if peri <= 0:
                continue
            found_quad = None
            for eps in (0.015, 0.02, 0.03, 0.05):
                approx = cv2.approxPolyDP(c, eps * peri, True)
                if len(approx) == 4:
                    found_quad = approx.reshape(-1, 2).astype(np.float64)
                    break
            if found_quad is None:
                # Convex hull fallback: aproxima o invólucro do contorno
                hull = cv2.convexHull(c)
                peri_h = float(cv2.arcLength(hull, True))
                if peri_h > 0:
                    approx = cv2.approxPolyDP(hull, 0.02 * peri_h, True)
                    if len(approx) == 4:
                        found_quad = approx.reshape(-1, 2).astype(np.float64)
            if found_quad is not None:
                quad_best.append((area, found_quad))

    if not quad_best:
        return None

    if region_center is not None:
        # Prefere o maior quadrilátero que contém o centro dos blocos de bolhas
        # (a folha), descartando quadros internos que não englobam o conteúdo.
        containing = [(a, q) for a, q in quad_best if _point_in_quad(region_center, q)]
        if containing:
            containing.sort(key=lambda t: t[0], reverse=True)
            return _order_corners(containing[0][1])

    quad_best.sort(key=lambda t: t[0], reverse=True)
    return _order_corners(quad_best[0][1])


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


def manual_corners_px(
    corners: list, w: int, h: int
) -> dict[str, tuple[float, float]] | None:
    """4 cantos (TL, TR, BR, BL) em coords NORMALIZADAS 0..1 → dict em px.

    Usado quando o usuário marca os cantos da PÁGINA à mão (foto torta / falha
    do alinhamento automático). Devolve None se não forem 4 pontos convexos.
    """
    if not corners or len(corners) != 4:
        return None
    pts: list[tuple[float, float]] = []
    for p in corners:
        try:
            x = float(p[0])
            y = float(p[1])
        except (TypeError, ValueError, IndexError):
            return None
        if not (math.isfinite(x) and math.isfinite(y)):
            return None
        pts.append((min(1.0, max(0.0, x)) * w, min(1.0, max(0.0, y)) * h))
    if not _is_convex_quad(pts):
        return None
    return {c: pts[i] for i, c in enumerate(CORNERS)}


def _page_rect_dst(cw: int, ch: int) -> dict[str, tuple[float, float]]:
    """Destino canônico: a PÁGINA inteira (cantos da folha)."""
    return {"TL": (0.0, 0.0), "TR": (float(cw), 0.0),
            "BR": (float(cw), float(ch)), "BL": (0.0, float(ch))}


def _page_corners_dst(cfg: dict, cw: int, ch: int
                      ) -> dict[str, tuple[float, float]] | None:
    """Destino canônico a partir de `page_corners` (folha dentro do modelo)."""
    pc = cfg.get("page_corners")
    if not isinstance(pc, list) or len(pc) != 4:
        return None
    dst: dict[str, tuple[float, float]] = {}
    for i, corner in enumerate(CORNERS):
        p = pc[i]
        try:
            dst[corner] = (float(p["x"]) * cw, float(p["y"]) * ch)
        except (KeyError, TypeError, ValueError):
            return None
    return dst


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


def _detect_anchor_corners_once(
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


def _detect_anchor_corners_ex(
    image: np.ndarray, config: dict
) -> tuple[dict[str, tuple[float, float]] | None, str, dict]:
    """Tenta a detecção em 0°, 90°, 180° e 270° (fotos de celular rotacionadas).

    Remapeia os cantos para o referencial original. Devolve o primeiro resultado
    que encontrar as 4 âncoras (ou a borda da página).
    """
    if image is None:
        return None, "imagem inválida", {"method": "none", "detected": [], "inferred": []}
    h, w = image.shape[:2]
    rotations = [
        (None, lambda pt: pt),  # 0°
        (cv2.ROTATE_90_CLOCKWISE, lambda pt: (pt[1], h - 1 - pt[0])),
        (cv2.ROTATE_180, lambda pt: (w - 1 - pt[0], h - 1 - pt[1])),
        (cv2.ROTATE_90_COUNTERCLOCKWISE, lambda pt: (w - 1 - pt[1], pt[0])),
    ]
    last = None
    for code, remap in rotations:
        img = image if code is None else cv2.rotate(image, code)
        corners, reason, meta = _detect_anchor_corners_once(img, config)
        if corners is not None:
            # remapeia para o referencial original
            remapped = {c: (float(remap(pt)[0]), float(remap(pt)[1])) for c, pt in corners.items()}
            # atualiza dimensões para o remapeamento? já feito via remap
            meta = dict(meta)
            meta["rotation"] = 0 if code is None else int(code)
            return remapped, reason, meta
    # nenhuma rotação funcionou: mantém falha (cantos manuais são o fallback
    # do usuário). Limiares mais baixos acima já tentaram o possível.
    return None, ("Âncoras não detectadas. Aproxime a câmera, melhore a "
                  "iluminação ou use 'Marcar cantos manualmente'."), \
        {"method": "none", "detected": [], "inferred": []}


def detect_anchor_corners(image: np.ndarray, config: dict) -> tuple[dict[str, tuple[float, float]] | None, str]:
    """Devolve {corner: (x, y) em px da foto} ou (None, motivo)."""
    corners, reason, _meta = _detect_anchor_corners_ex(image, config)
    return corners, reason


def _corners_from_anchors(config: dict) -> dict[str, tuple[float, float]] | None:
    """Cantos da folha (NORMALIZADOS 0..1) a partir dos 4 marcadores de canto.

    Em modelos personalizados a folha costuma ser delimitada pelos marcadores
    (e não por uma borda visível). Só devolve quando os 4 cantos TL/TR/BR/BL
    estão presentes.
    """
    cfg = normalize_config(config)
    out: dict[str, tuple[float, float]] = {}
    for a in cfg["anchors"]:
        corner = a.get("corner") or _infer_corner(cfg["anchors"], a.get("id"))
        if corner in CORNERS and corner not in out:
            out[corner] = (float(a["x"]), float(a["y"]))
    if len(out) != 4:
        return None
    return out


def detect_page_corners_ex(image: np.ndarray,
                           config: dict | None = None
                           ) -> tuple[list[dict] | None, bool]:
    """Cantos da folha normalizados (0..1) + flag `inferred`.

    Prioridade: (1) marcadores de canto configurados; (2) maior quadrilátero
    que contém os blocos de bolhas; (3) borda da página. Se nada for detectado
    devolve os cantos da imagem com `inferred=True` (a UI avisa para ajustar).
    """
    if image is None:
        return None, False
    h, w = image.shape[:2]

    norm = _corners_from_anchors(config) if config else None
    if norm is not None:
        return ([{"x": _clamp01(norm[c][0]), "y": _clamp01(norm[c][1])}
                 for c in CORNERS], False)

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
    corners = _detect_page_corners(gray, config)
    inferred = False
    if corners is None:
        # Último recurso: a folha preenchendo o frame.
        corners = {"TL": (0.0, 0.0), "TR": (float(w), 0.0),
                   "BR": (float(w), float(h)), "BL": (0.0, float(h))}
        inferred = True
    out = [{"x": _clamp01(corners[c][0] / w), "y": _clamp01(corners[c][1] / h)}
           for c in CORNERS]
    return out, inferred


def detect_page_corners(image: np.ndarray,
                        config: dict | None = None) -> list[dict] | None:
    """Detecta os 4 cantos da folha (normalizados) ou None.

    Compat: usa apenas a detecção geométrica (sem o fallback dos cantos da
    imagem). Prefira `detect_page_corners_ex` quando quiser o fallback.
    """
    if image is None:
        return None
    h, w = image.shape[:2]
    norm = _corners_from_anchors(config) if config else None
    if norm is not None:
        return [{"x": _clamp01(norm[c][0]), "y": _clamp01(norm[c][1])} for c in CORNERS]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
    corners = _detect_page_corners(gray, config)
    if corners is None:
        return None
    return [{"x": _clamp01(corners[c][0] / w), "y": _clamp01(corners[c][1] / h)}
            for c in CORNERS]


def detect_anchors_auto(image: np.ndarray, page: int = 0) -> list[dict]:
    """Detecta até 4 âncoras de canto e devolve configs normalizadas.

    Cascata: ArUco (ids detectados) → quadrados (cantos da imagem) → borda da
    página. Cada âncora vem centralizada (x, y = centro do marcador) com
    tamanho estimado. Rótulo de canto (TL/TR/BR/BL) atribuído por quadrante.

    Usado pelo editor para popular a configuração automaticamente a partir da
    imagem importada.
    """
    if image is None:
        return []
    h, w = image.shape[:2]
    if h <= 0 or w <= 0:
        return []
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
    max_side = float(max(w, h))

    found: dict[str, tuple[float, float, float, str, int | None]] = {}
    # (cx, cy, size_norm, type, aruco_id)

    # 1) ArUco
    try:
        det = detect_markers(image)
        for m in det.markers:
            nx = float(m.center[0]) / w
            ny = float(m.center[1]) / h
            corner = _corner_by_quadrant(nx, ny)
            if corner is None or corner in found:
                continue
            corners = np.asarray(m.corners, dtype=np.float64).reshape(-1, 2)
            side = float(np.mean([
                np.linalg.norm(corners[0] - corners[1]),
                np.linalg.norm(corners[1] - corners[2]),
                np.linalg.norm(corners[2] - corners[3]),
                np.linalg.norm(corners[3] - corners[0]),
            ]))
            size = max(0.01, min(0.2, side / max_side))
            found[corner] = (float(m.center[0]), float(m.center[1]), size, "aruco", int(m.id))
    except Exception:
        pass

    # 2) quadrados (para cantos ainda não ocupados)
    if len(found) < 4:
        try:
            cands = _square_candidates(gray)
        except Exception:
            cands = []
        # candidatos com centro + área
        cand_list = []
        for c in cands:
            pts = np.asarray(c, dtype=np.float64).reshape(-1, 2)
            cx = float(pts[:, 0].mean())
            cy = float(pts[:, 1].mean())
            area = float(cv2.contourArea(pts.astype(np.float32)))
            side = math.sqrt(max(area, 1.0))
            cand_list.append((cx, cy, side, pts))
        # atribui cada candidato ao canto livre mais próximo
        free_corners = [c for c in CORNERS if c not in found]
        # ordena candidatos por distância ao centro esperado do canto? usa nearest
        used_idx: set[int] = set()
        for corner in free_corners:
            # posição esperada aproximada do canto
            if corner == "TL":
                ex, ey = 0.15 * w, 0.15 * h
            elif corner == "TR":
                ex, ey = 0.85 * w, 0.15 * h
            elif corner == "BR":
                ex, ey = 0.85 * w, 0.85 * h
            else:
                ex, ey = 0.15 * w, 0.85 * h
            best_i = None
            best_d = max(w, h) * 0.25
            for i, (cx, cy, side, pts) in enumerate(cand_list):
                if i in used_idx:
                    continue
                d = math.hypot(cx - ex, cy - ey)
                if d < best_d:
                    best_d = d
                    best_i = i
            if best_i is not None:
                cx, cy, side, pts = cand_list[best_i]
                used_idx.add(best_i)
                size = max(0.01, min(0.2, side / max_side))
                found[corner] = (cx, cy, size, "quad", None)

    # 3) borda da página (fallback) para cantos faltantes
    if len(found) < 4:
        try:
            page = _detect_page_corners(gray)
        except Exception:
            page = None
        if page is not None:
            for corner in CORNERS:
                if corner in found:
                    continue
                px_, py_ = page[corner]
                # tamanho estimado: 5% do lado maior, clampado
                found[corner] = (float(px_), float(py_), 0.05, "quad", None)

    # monta lista de anchors normalizados
    anchors: list[dict] = []
    for corner in CORNERS:
        if corner not in found:
            continue
        cx, cy, size, typ, aruco_id = found[corner]
        # Infla o tamanho detectado (~25%) para cobrir o marcador por completo
        # na renderização/overlay; a leitura usa apenas o centro + tolerância.
        size_inflated = max(0.02, min(0.2, size * 1.25))
        tolerance = max(0.15, min(0.35, size_inflated * 1.5))
        anchors.append({
            "id": f"anc_{corner.lower()}",
            "type": typ,
            "corner": corner,
            "aruco_id": aruco_id,
            "page": int(page),
            "x": _clamp01(cx / w),
            "y": _clamp01(cy / h),
            "size": _clamp01(size_inflated, 0.05) or 0.05,
            "tolerance": tolerance,
            "required": typ != "quad" or aruco_id is not None,
        })
    return anchors


def build_homography_ex(
    image: np.ndarray, config: dict,
    manual_corners: dict[str, tuple[float, float]] | None = None,
) -> tuple[np.ndarray | None, int, int, str, dict]:
    """Como `build_homography`, mas devolve também os metadados de detecção.

    `manual_corners` (px, {TL,TR,BR,BL}) tem prioridade sobre a detecção: são os
    4 cantos da PÁGINA marcados pelo usuário, mapeados para a página canônica.
    """
    cw, ch = canonical_size(config)
    if manual_corners is not None:
        meta = {"method": "manual", "detected": list(CORNERS), "inferred": []}
        dst_map = _page_rect_dst(cw, ch)
        src = np.array([manual_corners[c] for c in CORNERS], dtype=np.float32)
        dst = np.array([dst_map[c] for c in CORNERS], dtype=np.float32)
        try:
            M = cv2.getPerspectiveTransform(src, dst)
        except cv2.error:
            return None, cw, ch, "Cantos manuais inválidos (não foi possível retificar).", meta
        return M, cw, ch, "", meta

    corners, reason, meta = _detect_anchor_corners_ex(image, config)
    if corners is None:
        return None, cw, ch, reason, meta

    cfg = normalize_config(config)
    # Pontos de destino: as posições médias das âncoras (se houver) ou a
    # região da folha dentro da imagem do modelo (`page_corners`). Sem
    # `page_corners`, assume-se que a imagem do modelo é a folha inteira.
    expected = _expected_corners_px(cfg, cw, ch)
    if len(expected) == 4:
        dst_map = expected
    else:
        dst_map = _page_corners_dst(cfg, cw, ch) or _page_rect_dst(cw, ch)

    src = np.array([corners[c] for c in CORNERS], dtype=np.float32)
    dst = np.array([dst_map[c] for c in CORNERS], dtype=np.float32)
    try:
        M = cv2.getPerspectiveTransform(src, dst)
    except cv2.error:
        return None, cw, ch, "Geometria inválida das âncoras (não foi possível retificar).", meta
    return M, cw, ch, "", meta


def build_homography(
    image: np.ndarray, config: dict,
    manual_corners: dict[str, tuple[float, float]] | None = None,
) -> tuple[np.ndarray | None, int, int, str]:
    """Matriz foto→canônico + dimensões do alvo. (None, 0, 0, motivo) em falha."""
    M, cw, ch, reason, _meta = build_homography_ex(image, config, manual_corners)
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


# ---------------------------------------------------------------------------
# Auto-detecção da grade (editor do Gabarito Personalizado)
# ---------------------------------------------------------------------------
# Dado o cartão IMPORTADO (que é a própria referência de coordenadas do
# modelo), localiza as bolhas por contorno e propõe bloco(s) `bubble_block`
# — uma SUGESTÃO que o usuário ajusta no editor. Não depende de config prévia
# (raio/âncoras ainda podem não existir no início da edição).
#
# Estratégia: contornos com cara de bolha → raio dominante (descarta âncoras,
# texto e ruído) → agrupa em linhas → separa colunas pelo maior gap → propõe um
# bloco por coluna de questões. Funciona tanto para foto digitalizada quanto
# para foto de celular aproximadamente alinhada; não retifica perspectiva.
GRID_MIN_CANDIDATES = 6          # menos candidatos que isto não formam grade
GRID_AREA_MIN_FRAC = 0.000005    # fração da área da imagem (contorno de bolha)
GRID_AREA_MAX_FRAC = 0.03
GRID_MIN_CIRCULARITY = 0.30
GRID_ASPECT_MIN = 0.5
GRID_ASPECT_MAX = 2.0
GRID_RADIUS_BAND = (0.7, 1.4)    # faixa aceita em torno do raio dominante
GRID_ROW_TOL_FACTOR = 0.9        # tol. de linha (y) = fator × diâmetro mediano
GRID_COLUMN_TOL_FACTOR = 1.5     # tol. de coluna de grupo = fator × raio
GRID_GAP_FACTOR = 2.5            # gap que separa áreas (entre alternativas)
GRID_MIN_LABELS = 2              # menos alternativas que isto não é questão
GRID_SQUARE_EXTENT_MIN = 0.89    # área/preenche-bbox acima disto ⇒ bolha quadrada
GRID_MIN_QUESTIONS = 3           # menos questões que isto é ruído, não um bloco


def _grid_candidates(gray: np.ndarray) -> list[tuple[float, float, float, bool]]:
    """Contornos com cara de bolha em px: `(cx, cy, raio, quadrado)`.

    Usa `RETR_LIST` (todos os contornos, não só os externos) para que a grade
    seja encontrada mesmo quando o cartão está sobre um fundo escuro, dentro de
    uma moldura/borda ou com as bolhas encaixadas numa caixa — situações em que
    `RETR_EXTERNAL` devolveria só o contorno externo e engoliria as bolhas.
    A forma (círculo vs quadrado) sai da circularidade do contorno.
    """
    h, w = gray.shape[:2]
    if h < 8 or w < 8:
        return []
    area_img = float(h * w)
    try:
        blur = cv2.GaussianBlur(gray, (3, 3), 0)
        _, bw = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        # Abertura suave: remove ruído sem apagar anéis finos de bolhas pequenas.
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2, 2))
        bw = cv2.morphologyEx(bw, cv2.MORPH_OPEN, k)
        cnts, _ = cv2.findContours(bw, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    except cv2.error:
        return []

    out: list[tuple[float, float, float, bool]] = []
    for c in cnts:
        area = float(cv2.contourArea(c))
        if area <= 0:
            continue
        frac = area / area_img
        if frac < GRID_AREA_MIN_FRAC or frac > GRID_AREA_MAX_FRAC:
            continue
        x, y, ww, hh = cv2.boundingRect(c)
        if ww <= 0 or hh <= 0:
            continue
        aspect = ww / float(hh)
        if aspect < GRID_ASPECT_MIN or aspect > GRID_ASPECT_MAX:
            continue
        peri = float(cv2.arcLength(c, True))
        if peri <= 0:
            continue
        circ = 4.0 * math.pi * area / (peri * peri)
        if circ < GRID_MIN_CIRCULARITY:
            continue
        # Forma por "extent" (área ÷ bbox), invariante à escala: círculo ≈ π/4 ≈
        # 0,785 e quadrado ≈ 1,0. A circularidade sozinha erra bolhas pequenas,
        # em que a discretização do perímetro a empurra para valores de quadrado.
        extent = area / float(ww * hh)
        square = extent >= GRID_SQUARE_EXTENT_MIN
        out.append((x + ww / 2.0, y + hh / 2.0, (ww + hh) / 4.0, square))
    return out


def _dominant_radius(cands: list[tuple[float, float, float, bool]]
                     ) -> tuple[float, list[tuple[float, float, float, bool]]]:
    """Raio do grupo que melhor "se parece com as bolhas" e os candidatos nele.

    Escolhe o tamanho por `apoio × raio²`: as bolhas são o conjunto circular
    grande E numeroso. Isso descarta marcações de âncora (grandes, mas poucas)
    e células internas do ArUco/texto (numerosas, mas pequenas). O raio devolvido
    é a MEDIANA do grupo escolhido (mais fiel que o "seed" arredondado).
    """
    if not cands:
        return 0.0, []
    lo, hi = GRID_RADIUS_BAND
    best_score = -1.0
    best_kept: list = []
    for seed in {round(c[2], 1) for c in cands}:
        if seed <= 0:
            continue
        kept = [c for c in cands if lo * seed <= c[2] <= hi * seed]
        score = len(kept) * seed * seed
        if score > best_score:
            best_score, best_kept = score, kept
    if not best_kept:
        return 0.0, []
    r0 = float(np.median([c[2] for c in best_kept]))
    return r0, best_kept


def _dedupe_points(cands: list[tuple[float, float, float, bool]], min_dist: float
                   ) -> list[tuple[float, float, float, bool]]:
    """Remove candidatos coincidentes (mantém o maior de cada aglomerado)."""
    kept: list[tuple[float, float, float, bool]] = []
    for c in sorted(cands, key=lambda c: -c[2]):
        if all((c[0] - k[0]) ** 2 + (c[1] - k[1]) ** 2 > min_dist * min_dist
               for k in kept):
            kept.append(c)
    return kept


def _group_rows(cands: list[tuple[float, float, float, bool]], tol: float) -> list[dict]:
    """Agrupa candidatos em linhas por proximidade em y."""
    rows: list[dict] = []
    for c in sorted(cands, key=lambda c: c[1]):
        if rows and abs(c[1] - rows[-1]["y"]) <= tol:
            r = rows[-1]
            r["items"].append(c)
            r["y"] = sum(i[1] for i in r["items"]) / len(r["items"])
        else:
            rows.append({"y": c[1], "items": [c]})
    return rows


def _split_by_gap(items: list[tuple[float, float, float, bool]], gap: float
                  ) -> list[list[tuple[float, float, float, bool]]]:
    """Separa itens ordenados por x onde o vão supera `gap`."""
    xs = sorted(items, key=lambda c: c[0])
    groups: list[list] = [[xs[0]]]
    for a, b in zip(xs, xs[1:]):
        if b[0] - a[0] > gap:
            groups.append([])
        groups[-1].append(b)
    return groups


def _cluster_groups(groups: list[dict], tol: float) -> list[dict]:
    """Agrupa segmentos de linha em COLUNAS de questões (x do 1º item)."""
    clusters: list[dict] = []
    for g in sorted(groups, key=lambda g: g["items"][0][0]):
        cx = g["items"][0][0]
        if clusters and abs(cx - clusters[-1]["x"]) <= tol:
            cl = clusters[-1]
            cl["items"].append(g)
            cl["x"] = sum(i["items"][0][0] for i in cl["items"]) / len(cl["items"])
        else:
            clusters.append({"x": cx, "items": [g]})
    return clusters


def _mode_max(vals: list[int]) -> int:
    """Valor mais frequente; empate → o maior."""
    counts: dict[int, int] = {}
    for v in vals:
        counts[v] = counts.get(v, 0) + 1
    return max(counts.items(), key=lambda kv: (kv[1], kv[0]))[0]


def _lattice_step_count(ys: list[float]) -> tuple[float, int]:
    """Ajusta a sequência de y a uma rede regular: `(passo, nº de questões)`.

    Estima o passo pela MEDIANA dos vãos (robusta a uma linha ausente/espúria) e
    projeta o intervalo total na rede. Assim a contagem não é refém de um
    agrupamento que fundiu/partiu uma linha por ruído — o que mais erra o número
    de questões em fotos reais.
    """
    ys = sorted(ys)
    if len(ys) <= 1:
        return 0.0, len(ys)
    gaps = [b - a for a, b in zip(ys, ys[1:]) if b - a > 1e-6]
    if not gaps:
        return 0.0, 1
    step = float(np.median(gaps))
    if step <= 0:
        return 0.0, len(ys)
    count = int(round((ys[-1] - ys[0]) / step)) + 1
    if count < 1:
        count = 1
    # Sanidade: uma rede nunca descreve menos linhas do que as detectadas.
    return step, max(count, 1)


def detect_grid(image: np.ndarray, config: dict | None = None,
                start_question: int = 1) -> dict:
    """Sugere bloco(s) `bubble_block` a partir da imagem do cartão importado.

    `config` é usado apenas para saber as dimensões lógicas (default: as da
    própria imagem). `start_question` numera a primeira questão detectada —
    em modelos multi-página a numeração continua a das páginas anteriores.
    Devolve `{ok, blocks, candidates, rows, columns, radius_px}`.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    h, w = gray.shape[:2]
    if h < 8 or w < 8:
        return {"ok": False, "blocks": [], "reason": "image_too_small",
                "candidates": 0, "rows": 0, "columns": 0, "radius_px": 0.0}

    cands = _grid_candidates(gray)
    if len(cands) < GRID_MIN_CANDIDATES:
        return {"ok": False, "blocks": [], "reason": "no_candidates",
                "candidates": len(cands), "rows": 0, "columns": 0, "radius_px": 0.0}

    r0, kept = _dominant_radius(cands)
    kept = _dedupe_points(kept, 0.6 * r0)
    if len(kept) < GRID_MIN_CANDIDATES:
        return {"ok": False, "blocks": [], "reason": "no_candidates",
                "candidates": len(cands), "rows": 0, "columns": 0, "radius_px": r0}

    rows = _group_rows(kept, GRID_ROW_TOL_FACTOR * 2.0 * r0)

    # Cada linha é dividida em segmentos (uma questão por segmento).
    segments: list[dict] = []
    for r in rows:
        items = sorted(r["items"], key=lambda c: c[0])
        diffs = sorted(b[0] - a[0] for a, b in zip(items, items[1:]))
        mdiff = diffs[len(diffs) // 2] if diffs else 0.0
        gap = max(GRID_GAP_FACTOR * mdiff, GRID_GAP_FACTOR * r0)
        for seg in _split_by_gap(items, gap):
            if len(seg) >= GRID_MIN_LABELS:
                segments.append({"y": r["y"], "items": seg})

    if not segments:
        return {"ok": False, "blocks": [], "reason": "no_grid", "candidates": len(cands),
                "rows": len(rows), "columns": 0, "radius_px": r0}

    columns = _cluster_groups(segments, GRID_COLUMN_TOL_FACTOR * r0)

    blocks: list[dict] = []
    start_question = max(1, int(start_question or 1))
    base_question = start_question
    for cl in sorted(columns, key=lambda c: c["x"]):
        gs = sorted(cl["items"], key=lambda g: g["y"])
        n_opts = _mode_max([len(g["items"]) for g in gs])
        rows_use = [g for g in gs if len(g["items"]) == n_opts]
        if len(rows_use) < 2:  # linhas irregulares: aceita o conjunto maior
            rows_use = gs
            n_opts = _mode_max([len(g["items"]) for g in rows_use])
        if len(rows_use) < 2 or n_opts < GRID_MIN_LABELS:
            continue

        top = min(rows_use, key=lambda g: g["y"])
        fx = top["items"][0][0] / w
        fy = top["y"] / h
        osx_gaps: list[float] = []
        for g in rows_use:
            xs = sorted(b[0] for b in g["items"])
            osx_gaps += [b - a for a, b in zip(xs, xs[1:])]
        ys = sorted(g["y"] for g in rows_use)
        if not osx_gaps:
            continue
        # Contagem/passo por rede regular: não conta linhas, ajusta a grade.
        qsy_px, nq = _lattice_step_count(ys)
        osx = float(np.median(osx_gaps)) / w
        qsy = qsy_px / h
        if osx <= 0 or qsy <= 0:
            continue

        # Forma dominante do bloco (círculo vs quadrado).
        n_sq = sum(1 for g in rows_use for c in g["items"] if c[3])
        n_tot = sum(len(g["items"]) for g in rows_use)
        shape = "square" if n_tot and n_sq * 2 >= n_tot else "circle"

        blocks.append({
            "id": f"blk{len(blocks) + 1}",
            "type": "bubble_block",
            "first_x": round(fx, 4),
            "first_y": round(fy, 4),
            "option_step_x": round(osx, 4),
            "question_step_y": round(qsy, 4),
            "columns": 1,
            "n_questions": nq,
            "labels": [chr(ord("A") + i) for i in range(n_opts)],
            "radius": round(r0 / max(w, h), 4),
            "shape": shape,
            "start_question": start_question,
            "distribution": "column",
        })
        start_question += nq

    # Filtra blocos ruidosos: artefatos de fusão de bolhas viram "colunas" com
    # poucas questões e bem menores que o bloco principal. Colunas reais de um
    # mesmo cartão têm tamanho parecido.
    if blocks:
        max_nq = max(b["n_questions"] for b in blocks)
        min_nq = max(GRID_MIN_QUESTIONS, int(math.ceil(0.5 * max_nq)))
        blocks = [b for b in blocks if b["n_questions"] >= min_nq]
        for i, b in enumerate(blocks, start=1):
            b["id"] = f"blk{i}"
        # Renumera as questões em sequência a partir do offset original
        # (preserva a continuidade da numeração entre páginas).
        q = base_question
        for b in blocks:
            b["start_question"] = q
            q += b["n_questions"]

    return {
        "ok": bool(blocks),
        "blocks": blocks,
        "reason": None if blocks else "no_grid",
        "candidates": len(cands),
        "rows": len(rows),
        "columns": len(columns),
        "radius_px": round(r0, 1),
    }


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


def _local_paper(gray: np.ndarray, x: float, y: float, r_px: float) -> float:
    """Brilho do papel em volta da bolha (mediana do anel FORA do contorno).

    A mediana absorve respingos/sujeira, e o anel fica fora do contorno
    impresso para não escurecer a estimativa.
    """
    h, w = gray.shape[:2]
    ri = int(max(2, round(r_px + 3)))
    ro = int(max(ri + 2, round(r_px + 16)))
    x0, y0 = int(max(0, x - ro)), int(max(0, y - ro))
    x1, y1 = int(min(w, x + ro + 1)), int(min(h, y + ro + 1))
    roi = gray[y0:y1, x0:x1]
    if roi.size == 0:
        return 200.0
    yy, xx = np.ogrid[:roi.shape[0], :roi.shape[1]]
    d2 = (xx - (x - x0)) ** 2 + (yy - (y - y0)) ** 2
    ring = (d2 >= ri * ri) & (d2 <= ro * ro)
    if not ring.any():
        return float(np.median(roi))
    return float(np.median(roi[ring]))


def _mark_coverage(gray: np.ndarray, x: float, y: float, r_px: float,
                   square: bool = False) -> float:
    """Fração de tinta na região INTERNA da bolha (marca esparsa: check/X).

    Usa limiar ABSOLUTO relativo ao papel local (`MARKS_INK_DELTA`), e não o
    Otsu: numa ROI quase uniforme (bolha vazia ou com traço fino) o Otsu
    "inventa" um corte no ruído. A região interna fica num fator do raio para
    ignorar o contorno impresso da bolha.
    """
    h, w = gray.shape[:2]
    r_in = int(max(2, round(MARKS_INNER_FACTOR * r_px)))
    x0, y0 = int(max(0, x - r_in)), int(max(0, y - r_in))
    x1, y1 = int(min(w, x + r_in + 1)), int(min(h, y + r_in + 1))
    roi = gray[y0:y1, x0:x1]
    if roi.size == 0:
        return 0.0
    dx = np.abs(np.arange(roi.shape[1]) - (x - x0))
    dy = np.abs(np.arange(roi.shape[0]) - (y - y0))
    if square:
        inside = (dy[:, None] <= r_in) & (dx[None, :] <= r_in)
    else:
        inside = (dy[:, None] ** 2 + dx[None, :] ** 2) <= (r_in * r_in)
    total = int(inside.sum())
    if total == 0:
        return 0.0
    paper = _local_paper(gray, x, y, r_px)
    ink = (roi < (paper - MARKS_INK_DELTA)) & inside
    return float(ink.sum()) / float(total)


def marks_score(gray: np.ndarray, x: float, y: float, r_px: float,
                square: bool = False) -> float:
    """Score 0..1 da marca esparsa, na MESMA faixa do estilo preenchido.

    Cobertura de tinta no interior reescalada por `MARKS_REFERENCE_COVERAGE`
    (bolha vazia ≈ 0, marca clara ≈ 1), para que piso/margem e as regras de
    decisão continuem válidos sem tratar o estilo "marks" à parte.
    """
    cov = _mark_coverage(gray, x, y, r_px, square=square)
    return float(min(1.0, cov / MARKS_REFERENCE_COVERAGE))


def process_custom_image(
    image: np.ndarray,
    config: dict,
    adaptive: bool = False,
    debug: bool = False,
    overrides: OmrParams | None = None,
    strict_alignment: bool = True,
    corners: list | None = None,
    diagnostics: dict | None = None,
    page: int = 0,
) -> OMRResult | None:
    """Lê um cartão personalizado. None = não foi possível retificar/ler.

    `corners`, se informado, são os 4 cantos (TL, TR, BR, BL) da PÁGINA em
    coords normalizadas 0..1 — alinhamento MANUAL que substitui a detecção de
    âncoras (útil em fotos tortas em que o alinhamento automático falha).

    `page` seleciona a página do modelo (multi-página sobre a mesma folha);
    só as âncoras e os blocos dessa página são usados. Em modelos de 1 página
    o valor é irrelevante.

    `diagnostics`, se fornecido, recebe {"reason", "detail", "alignment"} para
    explicar a falha (None = sucesso).
    """
    import time as _time

    def _fail(reason: str, detail: str = "", alignment: dict | None = None) -> None:
        if diagnostics is not None:
            diagnostics["reason"] = reason
            diagnostics["detail"] = detail
            diagnostics["alignment"] = alignment

    cfg = config_for_page(config, page)
    p_base, cfg_adaptive = omr_params_from_config(cfg)
    p = overrides if overrides is not None else p_base
    adaptive = adaptive or cfg_adaptive

    manual = None
    if corners:
        manual = manual_corners_px(corners, image.shape[1], image.shape[0])
        if manual is None:
            _fail("manual_corners",
                  "Cantos manuais inválidos: marque 4 pontos (TL, TR, BR, BL) "
                  "formando um quadrilátero convexo.")
            return None

    _t0 = _time.perf_counter()
    M, cw, ch, reason, anchor_meta = build_homography_ex(image, cfg, manual_corners=manual)
    t_detect = _time.perf_counter() - _t0
    if M is None:
        _fail("manual_corners" if manual is not None else "anchors", reason)
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

    blk_of = question_block_map(cfg)

    for b in expand_bubbles(cfg):
        q = b["question"]
        cx = b["x"] * cw
        cy = b["y"] * ch
        r_px = max(3.0, b["r"] * max(cw, ch))
        style = (blk_of.get(q) or {}).get("mark_style", "filled")
        if style == "marks":
            # Marca esparsa (check/X): tinta no interior, limiar absoluto.
            score = marks_score(gray, cx, cy, r_px, square=(b["shape"] == "square"))
        elif b["shape"] == "square":
            inset = p.square_inset if p.square_inset is not None else 6
            score = _square_metrics(gray, cx, cy, side=r_px * 2.0, inset=inset, weights=weights).score
        else:
            inner = p.inner_radius if p.inner_radius is not None else max(3, int(round(r_px)) - 2)
            score = _bubble_metrics(gray, int(round(cx)), int(round(cy)), radius=inner, weights=weights).score
        all_ratios.setdefault(q, {})[b["option"]] = score
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
    multi_marks: dict[int, list[str]] = {}

    qmap = blk_of

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
        # Múltipla resposta (P2): bloco que aceita mais de uma marca resolve a
        # questão como CONJUNTO (letras ordenadas) quando o nº de marcas está
        # dentro dos limites; fora dos limites continua sendo dupla.
        if status == "duplicate" and blk.get("multi_answer"):
            lo, hi = multi_bounds(blk)
            if lo <= len(marks) <= hi:
                multi_marks[q_num] = list(marks)
                answers[q_num] = "".join(marks)
                continue
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
        debug_points = build_debug_points(geom, all_ratios, answers, blank, duplicates, low_conf,
                                          multi=sorted(multi_marks))

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
        multi_marks=multi_marks,
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
        "n_pages": max(1, int(cfg.get("n_pages") or 1)),
        "page_w": cfg["page_w"],
        "page_h": cfg["page_h"],
    }
