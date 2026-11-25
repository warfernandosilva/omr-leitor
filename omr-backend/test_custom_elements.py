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


# ── Tipos decorativos novos (formas, áreas e linhas de resposta) ───────────

def test_normalize_new_decorative_kinds_and_fields():
    cfg = ct.normalize_config({
        "page_w": 100, "page_h": 100,
        "elements": [
            {"id": "a", "kind": "rect", "x": 0.1, "y": 0.1, "w": 0.2, "h": 0.1,
             "rotation": 270, "fill": True, "stroke_w": 9},
            {"id": "b", "kind": "circle", "x": 0.1, "y": 0.3, "w": 0.1, "h": 0.1},
            {"id": "c", "kind": "written_lines", "x": 0.1, "y": 0.5, "w": 0.5,
             "h": 0.2, "rows": 99},
            {"id": "d", "kind": "box", "label": "Observações", "x": 0.1, "y": 0.8,
             "w": 0.5, "h": 0.1, "rows": 3, "hidden": True},
            {"id": "e", "kind": "instructions", "x": 0.1, "y": 0.9,
             "w": 0.5, "h": 0.05, "text": "Preencha as bolhas."},
        ],
    })
    kinds = [e["kind"] for e in cfg["elements"]]
    assert kinds == ["rect", "circle", "written_lines", "box", "instructions"]
    assert cfg["elements"][0]["rotation"] == 180.0   # rotação limitada
    assert cfg["elements"][0]["fill"] is True
    assert cfg["elements"][0]["stroke_w"] <= 0.02   # espessura limitada
    assert cfg["elements"][2]["rows"] == 30          # linhas limitadas
    assert cfg["elements"][3]["hidden"] is True
    assert cfg["elements"][3]["label"] == "Observações"


def test_render_overlay_draws_new_decorative_kinds():
    img = np.ones((1000, 700, 3), dtype=np.uint8) * 255
    cfg = ct.normalize_config({
        "page_w": 700, "page_h": 1000,
        "elements": [
            {"id": "r", "kind": "rect", "x": 0.1, "y": 0.1, "w": 0.3, "h": 0.1},
            {"id": "c", "kind": "circle", "x": 0.6, "y": 0.1, "w": 0.2, "h": 0.1},
            {"id": "w", "kind": "written_lines", "x": 0.1, "y": 0.3, "w": 0.5,
             "h": 0.15, "rows": 3, "stroke_w": 0.002},
            {"id": "b", "kind": "box", "x": 0.1, "y": 0.55, "w": 0.6, "h": 0.15,
             "label": "Observações", "rows": 2, "font_size": 24},
            {"id": "h", "kind": "rect", "x": 0.1, "y": 0.8, "w": 0.3, "h": 0.1,
             "hidden": True},
        ],
    })
    out = ct.render_overlay(cfg, img)
    # contorno do retângulo (borda superior ~ y=0.1)
    assert (out[95:108, 80:280] < 128).any()
    # círculo desenhado
    assert (out[95:208, 415:555] < 128).any()
    # linhas de resposta na área
    assert (out[300:455, 80:415] < 128).sum() > 300
    # rótulo da caixa de comentário
    assert (out[550:600, 80:500] < 128).any()
    # elemento oculto não aparece
    assert (out[795:905, 80:280] == 255).all()


def test_validate_warns_on_rotated_element_over_anchor():
    card = generate_card({"n_questions": 10})
    anchor = ct.normalize_config(card.config)["anchors"][0]
    cfg = ct.normalize_config({
        **card.config,
        "elements": [_element(
            id="el_rot", kind="rect", x=anchor["x"] - 0.05,
            y=anchor["y"] - 0.05, w=0.1, h=0.1, rotation=30,
        )],
    })
    issues = ct.validate_config(cfg)
    codes = {i["code"] for i in issues}
    assert "element_over_anchor" in codes
    assert "element_rotated" in codes
    assert not ct.has_errors(issues)


def test_validate_warns_for_box_without_label_and_empty_handwriting():
    card = generate_card({"n_questions": 10})
    cfg = ct.normalize_config({
        **card.config,
        "elements": [
            _element(id="bc", kind="box", x=0.1, y=0.80, w=0.4, h=0.08, rows=2),
            _element(id="wl", kind="written_lines", x=0.1, y=0.90, w=0.4,
                     h=0.05, rows=0),
        ],
    })
    codes = {i["code"] for i in ct.validate_config(cfg)}
    assert "element_box_label" in codes
    assert "element_rows" in codes


def test_generate_card_keeps_new_kinds_and_rotation():
    card = generate_card({
        "n_questions": 10, "n_options": 4,
        "elements": [
            {"kind": "rect", "x": 0.05, "y": 0.92, "w": 0.2, "h": 0.04,
             "rotation": 12, "fill": True, "stroke_mm": 0.4},
            {"kind": "written_lines", "x": 0.35, "y": 0.92, "w": 0.5, "h": 0.04,
             "rows": 2},
            {"kind": "rect", "x": 0.05, "y": 0.85, "w": 0.2, "h": 0.03,
             "hidden": True},
        ],
    })
    conftypes = card.config["elements"]
    assert [e["kind"] for e in conftypes] == ["rect", "written_lines"]
    assert conftypes[0]["rotation"] == 12.0
    assert conftypes[0]["fill"] is True
    assert conftypes[1]["rows"] == 2
    assert (card.image < 200).any()
