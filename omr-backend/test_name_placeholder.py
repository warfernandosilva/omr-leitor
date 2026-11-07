"""Testes do `{{nome}}` no lote de impressão.

O texto fixo do cartão pode citar o aluno. A garantia principal é que a config
GRAVADA nunca é alterada — ela é compartilhada por todas as folhas do lote.
"""

from __future__ import annotations

import cv2
import numpy as np

from omr import custom_template as ct
from omr.card_generator import generate_card


def _fill(img: np.ndarray, cfg: dict, marks: dict[int, str]) -> np.ndarray:
    out = img.copy()
    h, w = out.shape[:2]
    bubbles = {(b["question"], b["option"]): b for b in ct.expand_bubbles(cfg)}
    for (q, letter) in marks.items():
        b = bubbles[(q, letter)]
        r = max(3, int(b["r"] * max(w, h)) - 4)
        cv2.circle(out, (int(b["x"] * w), int(b["y"] * h)), r, (0, 0, 0), -1)
    return out


def test_placeholder_substitutes_and_keeps_the_original_config():
    cfg = ct.normalize_config({
        "page_w": 800, "page_h": 1200,
        "elements": [
            {"id": "a", "kind": "text", "text": "Aluno: {{nome}}", "font_size": 30},
            {"id": "b", "kind": "text", "text": "Sem marcador", "font_size": 30},
            {"id": "c", "kind": "line", "text": ""},
        ],
    })
    out = ct.apply_name_placeholders(cfg, "Ana Souza")
    texts = [e["text"] for e in out["elements"]]
    assert texts[0] == "Aluno: Ana Souza"
    assert texts[1] == "Sem marcador"
    assert texts[2] == ""
    # a config original continua intacta
    assert cfg["elements"][0]["text"] == "Aluno: {{nome}}"
    assert out["elements"][0]["id"] == cfg["elements"][0]["id"]


def test_placeholder_empty_name_is_a_noop():
    cfg = ct.normalize_config({
        "page_w": 800, "page_h": 1200,
        "elements": [{"id": "a", "kind": "text", "text": "Aluno: {{nome}}"}],
    })
    assert ct.apply_name_placeholders(cfg, "")["elements"][0]["text"] == "Aluno: {{nome}}"
    assert ct.apply_name_placeholders(cfg, "   ")["elements"][0]["text"] == "Aluno: {{nome}}"


def test_name_long_is_truncated():
    cfg = ct.normalize_config({
        "page_w": 800, "page_h": 1200,
        "elements": [{"id": "a", "kind": "text", "text": "{{nome}}"}],
    })
    out = ct.apply_name_placeholders(cfg, "x" * 500)
    assert out["elements"][0]["text"] == "x" * 120


def test_printing_a_batch_renders_each_name():
    """Duas folhas do mesmo lote: o texto muda e a leitura não muda."""
    card = generate_card({"n_questions": 8, "n_options": 4})
    cfg = dict(card.config)
    cfg["elements"] = [
        {"id": "t", "kind": "text", "page": 0, "x": 0.1, "y": 0.9, "w": 0.4, "h": 0.04,
         "text": "Aluno: {{nome}}", "font_size": 40, "align": "left", "bold": False, "asset": None},
    ]
    marked = _fill(card.image, cfg, {1: "A", 8: "C"})

    page1 = ct.render_overlay(ct.apply_name_placeholders(cfg, "Ana"),
                              marked, fields={"student_name": "Ana"}, qr_payload="COD-1")
    page2 = ct.render_overlay(ct.apply_name_placeholders(cfg, "Bruno"),
                              marked, fields={"student_name": "Bruno"}, qr_payload="COD-2")

    assert np.any(page1 != page2), "as duas folhas saíram iguais"
    # onde o texto foi desenhado, as duas páginas diferem
    y0, y1 = int(0.9 * page1.shape[0]), int(0.94 * page1.shape[0])
    assert np.any(page1[y0:y1] != page2[y0:y1])

    # e a leitura continua igual nas duas
    r1 = ct.process_custom_image(page1, cfg)
    r2 = ct.process_custom_image(page2, cfg)
    assert r1 is not None and r2 is not None
    assert r1.answers == r2.answers == {1: "A", 8: "C"}
    assert r1.qr_id == "COD-1" and r2.qr_id == "COD-2"
