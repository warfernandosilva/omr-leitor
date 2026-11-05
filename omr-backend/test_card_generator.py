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


def test_spec_that_does_not_fit_raises():
    with pytest.raises(ValueError):
        generate_card({
            "page_format": "A5", "n_questions": 200, "n_options": 10,
            "columns": 1, "margin_mm": 20,
        })


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

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
