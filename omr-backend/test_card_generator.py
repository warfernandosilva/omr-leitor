"""Testes do gerador de cartões do zero (omr/card_generator.py).

O ponto central é a compatibilidade: o cartão desenhado precisa ser lido pelo
MESMO motor do Gabarito Personalizado, com as coordenadas que ele mesmo gerou.
"""

from __future__ import annotations

import cv2
import numpy as np
import pytest

from omr import custom_template as ct
from omr.card_generator import generate_card


def _mark(img: np.ndarray, cfg: dict, marks: dict[int, str]) -> np.ndarray:
    out = img.copy()
    h, w = out.shape[:2]
    bubbles = {(b["question"], b["option"]): b for b in ct.expand_bubbles(cfg)}
    for (q, letter) in marks.items():
        b = bubbles[(q, letter)]
        r = max(3, int(b["r"] * max(w, h)) - 4)
        cv2.circle(out, (int(b["x"] * w), int(b["y"] * h)), r, (0, 0, 0), -1)
    return out


def test_generated_card_is_valid_and_complete():
    card = generate_card({"n_questions": 20, "n_options": 4})
    assert not ct.has_errors(ct.validate_config(card.config))
    summary = ct.config_summary(card.config)
    assert summary["n_questions"] == 20
    assert summary["n_anchors"] == 4
    assert summary["has_qr"] is True
    assert card.image.shape[:2] == (card.config["page_h"], card.config["page_w"])


def test_school_teacher_and_multiline_instructions_are_drawn():
    """Escola/professor são texto fixo; instruções aceitam várias linhas."""
    plain = generate_card({"n_questions": 10})
    full = generate_card({
        "n_questions": 10,
        "school": "Escola Estadual Central",
        "teacher": "Prof. Ana",
        "instructions": "Preencha com caneta preta.\nNão rasure.",
    })
    assert not ct.has_errors(ct.validate_config(full.config))
    assert np.any(plain.image != full.image)
    marked = _mark(full.image, full.config, {1: "A", 10: "D"})
    result = ct.process_custom_image(marked, full.config)
    assert result is not None
    assert result.answers == {1: "A", 10: "D"}


def test_generated_card_reads_answers_and_qr():
    """Compatibilidade real: imprime (overlay), marca e lê com o motor OMR."""
    card = generate_card({
        "n_questions": 10, "n_options": 5, "columns": 1,
        "fields": ["student_name", "matricula"],
    })
    printed = ct.render_overlay(
        card.config, card.image,
        fields={"student_name": "Ana Souza", "matricula": "2026001"},
        qr_payload="ALUNO-42",
    )
    marks = {1: "A", 4: "C", 7: "E", 10: "B"}
    result = ct.process_custom_image(_mark(printed, card.config, marks), card.config, debug=True)

    assert result is not None
    assert result.answers == marks
    assert result.blank_questions == [2, 3, 5, 6, 8, 9]
    assert result.duplicate_questions == []
    assert result.qr_id == "ALUNO-42"


def test_100_questions_fit_with_automatic_columns():
    card = generate_card({"n_questions": 100, "columns": 1})
    block = card.config["questions"][0]
    assert block["columns"] > 1
    assert ct.total_questions(card.config) == 100
    assert not ct.has_errors(ct.validate_config(card.config))
    assert any("colunas" in w for w in card.warnings)


def test_custom_numbering_and_labels():
    card = generate_card({
        "n_questions": 5, "start_question": 51, "labels": ["A", "B", "C"],
    })
    nums = {b["question"] for b in ct.expand_bubbles(card.config)}
    assert nums == {51, 52, 53, 54, 55}
    assert card.config["questions"][0]["labels"] == ["A", "B", "C"]


def test_multiple_blocks_are_readable():
    """Vários blocos na mesma folha: cada um tem numeração e alternativas próprias."""
    card = generate_card({
        "blocks": [
            {"title": "Parte 1", "n_questions": 8, "labels": ["A", "B", "C", "D"], "columns": 2},
            {"title": "Parte 2", "n_questions": 8, "n_options": 5, "columns": 2,
             "start_question": 9},
        ],
        "fields": ["student_name"],
    })
    cfg = card.config
    assert not ct.has_errors(ct.validate_config(cfg))
    assert len(cfg["questions"]) == 2
    assert ct.total_questions(cfg) == 16
    marks = {1: "A", 8: "D", 9: "C", 16: "E"}
    result = ct.process_custom_image(_mark(card.image, cfg, marks), cfg)
    assert result is not None
    assert result.answers == marks


def test_hidden_block_keeps_geometry_in_layout():
    """Bloco oculto: não entra na leitura, mas o layout precisa cobrir a
    geometria que o editor usará ao congelar posições de arraste."""
    card = generate_card({
        "blocks": [
            {"n_questions": 5, "labels": ["A", "B", "C", "D"], "start_question": 1},
            {"n_questions": 5, "labels": ["A", "B", "C", "D"], "start_question": 6,
             "hidden": True},
        ],
    })
    assert len(card.layout) == 2
    assert card.layout[1]["start_question"] == 6
    assert not ct.has_errors(ct.validate_config(card.config))
    assert len(card.config["questions"]) == 1


def test_decorative_elements_are_kept_in_config():
    """Texto/linha decorativos são desenhados e preservados na config."""
    card = generate_card({
        "n_questions": 5,
        "elements": [
            {"kind": "text", "text": "Leia com atenção", "x": 0.1, "y": 0.9,
             "w": 0.6, "h": 0.04, "font_mm": 4},
            {"kind": "line", "x": 0.1, "y": 0.95, "w": 0.8, "h": 0.004},
        ],
    })
    assert not ct.has_errors(ct.validate_config(card.config))
    assert [e["kind"] for e in card.config["elements"]] == ["text", "line"]
    assert ct.config_summary(card.config)["n_elements"] == 2


# ── Tamanhos de fonte em pontos (pt) ────────────────────────────────────────

def test_font_pt_keys_override_defaults():
    """`*_font_pt` do editor mandam no tamanho da fonte do cartão."""
    base = {"n_questions": 5, "title": "T", "subtitle": "S",
            "instructions": "Instrua", "school": "Escola", "teacher": "Prof",
            "fields": ["student_name"]}

    default_card = generate_card(base)
    assert default_card.config["print_fields"][0]["font_size"] == 25

    # O rótulo dos campos segue `field_font_pt` (18 pt a 200 dpi = 50 px).
    card_field = generate_card({**base, "field_font_pt": 18})
    assert card_field.config["print_fields"][0]["font_size"] == 50

    # Os demais tamanhos não quebram a validação nem mudam os campos.
    with_pt = generate_card({
        **base,
        "title_font_pt": 32,
        "subtitle_font_pt": 25,
        "school_font_pt": 23,
        "teacher_font_pt": 22,
        "instructions_font_pt": 20,
        "question_font_pt": 17,
        "label_font_pt": 16,
    })
    assert not ct.has_errors(ct.validate_config(with_pt.config))
    assert with_pt.config["print_fields"][0]["font_size"] == 25


def test_font_pt_is_clamped_when_out_of_range():
    """Valores fora da faixa são limitados em 6..400 px equivalentes."""
    clamped = generate_card({"n_questions": 5, "field_font_pt": 99999,
                             "fields": ["student_name"]})
    assert clamped.config["print_fields"][0]["font_size"] == 400

    tiny = generate_card({"n_questions": 5, "field_font_pt": 1,
                          "fields": ["student_name"]})
    assert tiny.config["print_fields"][0]["font_size"] == 6


def test_font_pt_honors_card_dpi():
    """O mesmo pt rende px diferente conforme o dpi do cartão."""
    low = generate_card({"n_questions": 5, "field_font_pt": 18, "dpi": 96,
                         "fields": ["student_name"]})
    high = generate_card({"n_questions": 5, "field_font_pt": 18, "dpi": 400,
                          "fields": ["student_name"]})
    assert low.config["print_fields"][0]["font_size"] == 24   # 18/72*96
    assert high.config["print_fields"][0]["font_size"] == 100  # 18/72*400


def test_legacy_font_px_still_applies():
    """Modelos gravados em px continuam sendo lidos como px."""
    legacy = generate_card({"n_questions": 5, "field_font_px": 50,
                             "fields": ["student_name"]})
    assert legacy.config["print_fields"][0]["font_size"] == 50


def test_element_font_pt_wins_over_font_mm():
    """`font_pt` do elemento tem prioridade sobre `font_mm` legado."""
    by_pt = generate_card({
        "n_questions": 5,
        "elements": [{"kind": "text", "text": "x", "x": 0.1, "y": 0.9,
                      "w": 0.5, "h": 0.04, "font_mm": 4, "font_pt": 29}],
    })
    assert by_pt.config["elements"][0]["font_size"] == 81  # 29 pt a 200 dpi

    by_mm = generate_card({
        "n_questions": 5,
        "elements": [{"kind": "text", "text": "x", "x": 0.1, "y": 0.9,
                      "w": 0.5, "h": 0.04, "font_mm": 4}],
    })
    assert by_mm.config["elements"][0]["font_size"] == 31  # 4 mm a 200 dpi


def test_block_orientation_horizontal_and_vertical():
    """Orientação do bloco: horizontal (lado a lado) ou vertical (empilhada)."""
    horiz = generate_card({
        "blocks": [{"title": "T", "n_questions": 6, "labels": ["A", "B", "C", "D"],
                    "columns": 2, "distribution": "horizontal", "show_title": True}],
    })
    assert horiz.config["questions"][0]["distribution"] == "row"
    assert horiz.config["questions"][0]["columns"] == 2
    assert not ct.has_errors(ct.validate_config(horiz.config))

    vert = generate_card({
        "blocks": [{"title": "T", "n_questions": 6, "labels": ["A", "B", "C", "D"],
                    "columns": 1, "distribution": "vertical", "show_title": True}],
    })
    assert vert.config["questions"][0]["distribution"] == "column"
    assert vert.config["questions"][0]["columns"] == 1
    assert not ct.has_errors(ct.validate_config(vert.config))

    # Bloco vertical continua legível (bolhas em fileira única).
    marks = {1: "A", 4: "B"}
    result = ct.process_custom_image(_mark(vert.image, vert.config, marks), vert.config)
    assert result is not None and result.answers == marks


def test_spec_that_does_not_fit_raises():
    with pytest.raises(ValueError):
        generate_card({
            "page_format": "A5", "n_questions": 200, "n_options": 10,
            "columns": 1, "margin_mm": 20,
        })


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

def test_api_preview_requires_auth(client):
    """A prévia usa o mesmo desenhista oficial — exige sessão."""
    r = client.post("/api/custom-templates/generate-preview",
                    json={"spec": {"n_questions": 20, "n_options": 4}})
    assert r.status_code in (401, 403), r.text


def test_api_preview_does_not_persist(authed):
    before = len(authed.get("/api/custom-templates").json()["templates"])
    r = authed.post("/api/custom-templates/generate-preview",
                    json={"spec": {"n_questions": 30, "n_options": 5}})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["image"].startswith("data:image")
    assert body["summary"]["n_questions"] == 30
    after = len(authed.get("/api/custom-templates").json()["templates"])
    assert after == before


def test_api_generate_creates_readable_template(authed):
    r = authed.post("/api/custom-templates/generate", json={
        "nome": "Cartão gerado",
        "spec": {"n_questions": 30, "n_options": 5},
    })
    assert r.status_code == 201, r.text
    detail = r.json()
    assert detail["nome"] == "Cartão gerado"
    assert detail["status"] == "validado"
    assert detail["config_summary"]["n_questions"] == 30
    assert detail["config_summary"]["n_anchors"] == 4

    img_r = authed.get(f"/api/custom-templates/{detail['id']}/image")
    assert img_r.status_code == 200
    img = cv2.imdecode(np.frombuffer(img_r.content, np.uint8), cv2.IMREAD_COLOR)
    assert img is not None

    result = ct.process_custom_image(img, detail["config"])
    assert result is not None
    assert set(result.blank_questions) == set(range(1, 31))


def test_api_generate_rejects_impossible_spec(authed):
    r = authed.post("/api/custom-templates/generate", json={
        "spec": {"page_format": "A5", "n_questions": 200, "n_options": 10, "margin_mm": 20},
    })
    assert r.status_code == 400
    assert "Não cabe" in r.json()["detail"]
