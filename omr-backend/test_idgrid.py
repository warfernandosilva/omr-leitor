"""Testes da matrícula em bolhas e do modelo de leitura.

Duas garantias centrais:

1. **O modelo de leitura é fiel ao que o motor lê.** `reading_model()` precisa
   reportar as MESMAS coordenadas que `expand_bubbles()`/`expand_id_bubbles()`
   usam na leitura — se divergir, quem automatizar a correção lê o lugar errado.
2. **A matrícula é lida de verdade**, e `None` (não inventar) quando há empate.
"""

from __future__ import annotations

import cv2
import numpy as np
import pytest

from omr import custom_template as ct
from omr.card_generator import generate_card


def _mark_cells(img: np.ndarray, cells: list[dict]) -> np.ndarray:
    """Pinta de preto os centros das bolhas pedidas (células normalizadas)."""
    out = img.copy()
    h, w = out.shape[:2]
    for b in cells:
        r = max(3, int(b["r"] * max(w, h)) - 4)
        cv2.circle(out, (int(b["x"] * w), int(b["y"] * h)), r, (0, 0, 0), -1)
    return out


def _fill(img: np.ndarray, cfg: dict, marks: dict[int, str]) -> np.ndarray:
    out = img.copy()
    h, w = out.shape[:2]
    bubbles = {(b["question"], b["option"]): b for b in ct.expand_bubbles(cfg)}
    for (q, letter) in marks.items():
        b = bubbles[(q, letter)]
        r = max(3, int(b["r"] * max(w, h)) - 4)
        cv2.circle(out, (int(b["x"] * w), int(b["y"] * h)), r, (0, 0, 0), -1)
    return out


# ─── Schema ───────────────────────────────────────────────────────────────

def test_normalize_keeps_idgrids_and_dpi():
    raw = {
        "page_w": 1000, "page_h": 1400, "page_dpi": 200,
        "idgrids": [
            {"id": "idg_1", "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.15,
             "digits": 6, "radius": 0.02, "shape": "square", "locked": True},
            {"id": "idg_ruim", "digits": 99, "radius": -1, "shape": "triângulo"},
        ],
    }
    cfg = ct.normalize_config(raw)
    assert cfg["page_dpi"] == 200
    assert len(cfg["idgrids"]) == 2
    g = cfg["idgrids"][0]
    assert (g["digits"], g["shape"], g["locked"]) == (6, "square", True)
    # valores absurdos são limitados, não aceitos
    ruim = cfg["idgrids"][1]
    assert ruim["digits"] == 14
    assert ruim["shape"] == "circle"
    assert ruim["locked"] is False


def test_normalize_roundtrip_is_stable():
    once = ct.normalize_config({
        "page_w": 100, "page_h": 100,
        "idgrids": [{"id": "i", "digits": 4, "radius": 0.03}],
    })
    twice = ct.normalize_config(once)
    assert once["idgrids"] == twice["idgrids"]
    assert once["page_dpi"] == twice["page_dpi"] is None


def test_summary_counts_idgrids():
    cfg = ct.normalize_config({
        "page_w": 100, "page_h": 100,
        "idgrids": [{"id": "a", "digits": 4}, {"id": "b", "digits": 6}],
    })
    assert ct.config_summary(cfg)["n_idgrids"] == 2


def test_idgrid_out_of_bounds_is_error_and_over_bubble_is_warning():
    card = generate_card({"n_questions": 6, "student_id_digits": 4})
    bubble = ct.expand_bubbles(card.config)[0]
    fora = ct.normalize_config({**card.config, "idgrids": [{"x": 0.9, "w": 0.3}]})
    assert any(i["code"] == "idgrid_bounds" and i["level"] == "error"
               for i in ct.validate_config(fora))
    sobre = ct.normalize_config({
        **card.config,
        "idgrids": [{"x": bubble["x"] - 0.02, "y": bubble["y"] - 0.02, "w": 0.2, "h": 0.08}],
    })
    issues = ct.validate_config(sobre)
    assert any(i["code"] == "idgrid_over_bubble" for i in issues)
    assert not ct.has_errors(issues)


# ─── Geometria ────────────────────────────────────────────────────────────

def test_expand_id_bubbles_geometry():
    cfg = ct.normalize_config({
        "page_w": 100, "page_h": 100,
        "idgrids": [{"id": "i", "x": 0.1, "y": 0.2, "w": 0.4, "h": 0.2, "digits": 3, "radius": 0.01}],
    })
    cells = ct.expand_id_bubbles(cfg)
    assert len(cells) == 30                       # 3 colunas × 10 valores
    assert {c["digit_position"] for c in cells} == {1, 2, 3}
    assert {c["value"] for c in cells} == set(range(10))
    col1 = [c for c in cells if c["digit_position"] == 1]
    # linhas de cima para baixo, ordenadas por valor
    ys = [c["y"] for c in sorted(col1, key=lambda z: z["value"])]
    assert ys == sorted(ys)
    # todas dentro da caixa
    assert all(0.1 <= c["x"] <= 0.5 and 0.2 <= c["y"] <= 0.4 for c in cells)


def test_id_bubbles_count_pages_toward_n_pages():
    cfg = ct.normalize_config({
        "page_w": 10, "page_h": 10,
        "idgrids": [{"id": "i", "page": 2, "digits": 4}],
    })
    assert ct.n_pages(cfg) == 3


# ─── Modelo de leitura ────────────────────────────────────────────────────

def test_reading_model_matches_what_the_engine_reads():
    """O contrato de impressão tem que bater com a leitura, pixel por pixel."""
    card = generate_card({"n_questions": 12, "n_options": 4, "student_id_digits": 6})
    m = ct.reading_model(card.config)

    # unidade: o gerador sabe o DPI → milímetros
    assert m["page"]["unit"] == "mm"
    assert m["page"]["dpi"] == 200
    assert m["page"]["widthPx"] == card.config["page_w"]
    assert abs(m["page"]["width"] - card.config["page_w"] / 200 * 25.4) < 0.01

    # questões: cada opção bate com a bolha do motor
    by_q: dict[int, dict] = {}
    for b in ct.expand_bubbles(card.config):
        by_q.setdefault(b["question"], {})[b["option"]] = b
    assert m["totals"]["questions"] == 12
    assert m["totals"]["bubbles"] == 48
    for q in m["questions"]:
        engine = by_q[q["number"]]
        for opt in q["options"]:
            b = engine[opt["label"]]
            assert abs(opt["x"] - b["x"] * m["page"]["width"]) < 0.011
            assert abs(opt["y"] - b["y"] * m["page"]["height"]) < 0.011

    # matrícula: mesma conta
    assert m["studentId"]["digits"] == 6
    assert m["totals"]["studentIdBubbles"] == 60
    for cell, out in zip(
        sorted(ct.expand_id_bubbles(card.config), key=lambda c: (c["digit_position"], c["value"])),
        sorted(m["studentId"]["bubbles"], key=lambda c: (c["digitPosition"], c["value"])),
    ):
        assert out["digitPosition"] == cell["digit_position"]
        assert out["value"] == cell["value"]
        assert abs(out["x"] - cell["x"] * m["page"]["width"]) < 0.011
        assert abs(out["y"] - cell["y"] * m["page"]["height"]) < 0.011

    # campos e QR aparecem
    assert len(m["fields"]) == len(card.config["print_fields"])
    assert len(m["qr"]) == 1


def test_reading_model_in_px_without_dpi():
    cfg = ct.normalize_config({"page_w": 800, "page_h": 1200, "idgrids": [{"digits": 4}]})
    m = ct.reading_model(cfg)
    assert m["page"]["unit"] == "px"
    assert m["page"]["width"] == 800 and m["page"]["height"] == 1200
    assert m["page"]["dpi"] is None


def test_reading_model_is_empty_without_regions():
    m = ct.reading_model({"page_w": 800, "page_h": 1200})
    assert m["questions"] == [] and m["fields"] == []
    assert m["studentId"]["bubbles"] == []
    assert m["totals"] == {"questions": 0, "bubbles": 0, "fields": 0, "studentIdBubbles": 0}


def test_api_reading_model(authed):
    r = authed.post("/api/custom-templates/generate",
                    json={"spec": {"n_questions": 5, "student_id_digits": 4}, "nome": "RM"})
    tid = r.json()["id"]
    got = authed.get(f"/api/custom-templates/{tid}/reading-model")
    assert got.status_code == 200
    body = got.json()
    assert body["name"] == "RM"
    assert body["totals"]["bubbles"] == 20      # 5 questões × 4 alternativas
    assert body["totals"]["studentIdBubbles"] == 40


# ─── Leitura da matrícula ─────────────────────────────────────────────────

def test_generator_draws_and_reads_student_id():
    card = generate_card({"n_questions": 8, "student_id_digits": 6})
    assert not ct.has_errors(ct.validate_config(card.config))
    assert ct.config_summary(card.config)["n_idgrids"] == 1

    cells = ct.expand_id_bubbles(card.config)
    # matrícula completa 5-0-0-0-0-0: cada coluna com o seu dígito
    picked = [c for c in cells if (c["digit_position"], c["value"]) ==
              (c["digit_position"], (4, 9, 0, 0, 0, 0)[c["digit_position"] - 1])]
    img = _mark_cells(card.image, picked)
    result = ct.process_custom_image(img, card.config)
    assert result is not None
    assert result.student_id == "490000"


def test_incomplete_student_id_is_not_invented():
    """Só um dígito marcado não vira matrícula: devolve None."""
    card = generate_card({"n_questions": 5, "student_id_digits": 4})
    cells = ct.expand_id_bubbles(card.config)
    one = [c for c in cells if c["digit_position"] == 1 and c["value"] == 5][0]
    result = ct.process_custom_image(_mark_cells(card.image, [one]), card.config)
    assert result is not None
    assert result.student_id is None
    assert result.student_id_detail[1]["value"] == 5      # o dígito foi LIDO


def test_student_id_reads_every_digit():
    card = generate_card({"n_questions": 5, "student_id_digits": 4})
    cells = ct.expand_id_bubbles(card.config)
    # 2026: coluna 1→2, 2→0, 3→2, 4→6
    picked = [c for c in cells if (c["digit_position"], c["value"]) in
              {(1, 2), (2, 0), (3, 2), (4, 6)}]
    img = _mark_cells(card.image, picked)
    result = ct.process_custom_image(img, card.config)
    assert result is not None
    assert result.student_id == "2026"
    assert result.student_id_detail[3]["value"] == 2


def test_student_id_none_when_two_digits_are_marked():
    """Duas bolhas na mesma coluna = ambíguo: devolve None, não um chute."""
    card = generate_card({"n_questions": 5, "student_id_digits": 4})
    cells = ct.expand_id_bubbles(card.config)
    picked = [c for c in cells if c["digit_position"] == 1 and c["value"] in (0, 1)]
    img = _mark_cells(card.image, picked)
    result = ct.process_custom_image(img, card.config)
    assert result is not None
    assert result.student_id is None
    # uma das colunas ficou marcada no diagnóstico
    assert result.student_id_detail[1]["value"] in (0, 1)


def test_student_id_none_when_blank():
    card = generate_card({"n_questions": 5, "student_id_digits": 4})
    result = ct.process_custom_image(card.image, card.config)
    assert result is not None
    assert result.student_id is None


def test_answers_are_unaffected_by_idgrid():
    """A matrícula não pode poluir a leitura das questões (nem o contrário)."""
    card = generate_card({"n_questions": 6, "n_options": 4, "student_id_digits": 5})
    plain = generate_card({"n_questions": 6, "n_options": 4})
    marks = {1: "A", 3: "C", 6: "D"}
    cells = ct.expand_id_bubbles(card.config)
    filled = _mark_cells(_fill(card.image, card.config, marks), [cells[15]])
    a = ct.process_custom_image(filled, card.config)
    b = ct.process_custom_image(_fill(plain.image, plain.config, marks), plain.config)
    assert a is not None and b is not None
    assert a.answers == b.answers == marks
