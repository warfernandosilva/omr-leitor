"""Testes dos elementos decorativos (texto/linha/imagem) do cartão.

Eles são desenhados só na impressão: o motor OMR continua lendo âncoras, QR e
bolhas pelas coordenadas. O que garantimos aqui é que (a) a config preserva os
elementos e o `locked`, (b) a impressão desenha, (c) a leitura não muda.
"""

from __future__ import annotations

import cv2
import numpy as np

from omr import custom_template as ct
from omr.card_generator import generate_card


def _element(**over) -> dict:
    base = {
        "id": "el_txt", "kind": "text", "page": 0,
        "x": 0.30, "y": 0.04, "w": 0.40, "h": 0.04,
        "text": "Escola Estadual", "font_size": 40, "align": "left",
        "bold": False, "asset": None, "locked": False,
    }
    return {**base, **over}


def test_normalize_keeps_elements_and_locked():
    cfg = ct.normalize_config({
        "page_w": 1000, "page_h": 1400,
        "elements": [
            _element(),
            _element(id="el_line", kind="line", text="", h=0.002),
            _element(id="el_img", kind="image", text="", asset="ast_0123456789ab"),
            _element(id="el_bad", kind="zzz", asset="../../etc/passwd", font_size=9999),
        ],
        "anchors": [{"type": "aruco", "aruco_id": 0, "corner": "TL",
                     "x": 0.1, "y": 0.1, "size": 0.05, "locked": True}],
        "info_regions": [{"id": "i1", "x": 0.1, "y": 0.1, "w": 0.2, "h": 0.05, "locked": True}],
        "questions": [{"id": "b1", "first_x": 0.2, "first_y": 0.3, "n_questions": 2, "locked": True}],
    })
    assert [e["kind"] for e in cfg["elements"]] == ["text", "line", "image", "text"]
    assert cfg["elements"][2]["asset"] == "ast_0123456789ab"
    # asset inválido não escapa do diretório e fonte absurda é limitada
    assert cfg["elements"][3]["asset"] is None
    assert cfg["elements"][3]["font_size"] == 400
    assert cfg["anchors"][0]["locked"] is True
    assert cfg["info_regions"][0]["locked"] is True
    assert cfg["questions"][0]["locked"] is True


def test_normalize_roundtrip_is_stable():
    once = ct.normalize_config({"page_w": 100, "page_h": 100, "elements": [_element()]})
    twice = ct.normalize_config(once)
    assert once["elements"] == twice["elements"]


def test_render_overlay_draws_text_and_line():
    img = np.ones((1000, 700, 3), dtype=np.uint8) * 255
    cfg = ct.normalize_config({
        "page_w": 700, "page_h": 1000,
        "elements": [_element(), _element(id="el_l", kind="line", text="",
                                          y=0.5, h=0.01)],
    })
    out = ct.render_overlay(cfg, img)
    assert out.shape == img.shape
    text_area = out[int(0.04 * 1000):int(0.08 * 1000), int(0.30 * 700):int(0.70 * 700)]
    line_area = out[int(0.50 * 1000):int(0.51 * 1000), int(0.30 * 700):int(0.70 * 700)]
    assert (text_area < 128).any(), "texto não foi desenhado"
    assert (line_area < 128).mean() > 0.9, "linha não foi desenhada"
    # nada fora dos elementos foi tocado
    assert (out[800:, :] == 255).all()


def test_render_overlay_draws_image_and_respects_page():
    from PIL import Image

    img = np.ones((400, 300, 3), dtype=np.uint8) * 255
    logo = Image.new("RGBA", (20, 10), (255, 0, 0, 255))
    cfg = ct.normalize_config({
        "page_w": 300, "page_h": 400, "n_pages": 2,
        "elements": [
            _element(id="el_img", kind="image", text="", asset="ast_0123456789ab"),
            _element(id="el_p2", page=1, y=0.6, h=0.05),
        ],
    })
    out = ct.render_overlay(cfg, img, page=0, assets={"ast_0123456789ab": logo})
    assert (out[16:32, 90:210] < 128).any(), "logo não foi desenhado"
    assert (out[240:260, 90:210] == 255).all(), "elemento da página 2 vazou"


def test_validate_warns_when_element_covers_a_bubble():
    card = generate_card({"n_questions": 10, "n_options": 4})
    bubble = ct.expand_bubbles(card.config)[0]
    cfg = ct.normalize_config({
        **card.config,
        "elements": [_element(id="el_ruim", x=bubble["x"] - 0.02,
                              y=bubble["y"] - 0.01, w=0.2, h=0.04)],
    })
    issues = ct.validate_config(cfg)
    assert any(i["code"] == "element_over_bubble" for i in issues)
    assert not ct.has_errors(issues)


def test_validate_rejects_element_outside_page():
    card = generate_card({"n_questions": 10})
    cfg = ct.normalize_config({
        **card.config, "elements": [_element(x=0.9, w=0.3)],
    })
    assert any(i["code"] == "element_bounds" for i in ct.validate_config(cfg))


def test_card_with_elements_is_still_readable():
    """O elemento não pode atrapalhar a leitura das bolhas nem do QR."""
    card = generate_card({"n_questions": 10, "n_options": 5})
    cfg = ct.normalize_config({
        **card.config,
        "elements": [
            _element(id="el_escola", text="Escola Estadual", y=0.045),
            _element(id="el_linha", kind="line", text="", y=0.075, h=0.002),
        ],
    })
    printed = ct.render_overlay(cfg, card.image, fields={"student_name": "Ana"},
                                qr_payload="ALUNO-7")
    h, w = printed.shape[:2]
    marks = {1: "A", 5: "C", 10: "E"}
    bubbles = {(b["question"], b["option"]): b for b in ct.expand_bubbles(cfg)}
    for (q, letter) in marks.items():
        b = bubbles[(q, letter)]
        cv2.circle(printed, (int(b["x"] * w), int(b["y"] * h)),
                   max(3, int(b["r"] * max(w, h)) - 4), (0, 0, 0), -1)

    result = ct.process_custom_image(printed, cfg, debug=True)
    assert result is not None
    assert result.answers == marks
    assert result.qr_id == "ALUNO-7"
