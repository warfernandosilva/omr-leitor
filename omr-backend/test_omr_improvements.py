"""Melhorias de visão opt-in portadas do amazingOMR.

Cobrem os módulos novos (preprocess, offset_field, mark_style,
second_opinion) e a integração deles no leitor, sempre verificando que o
comportamento padrão (OmrParams vazio) não muda.
"""

import json

import cv2
import numpy as np
import pytest

from omr.config import CANCEL_REPLACE_GAP, FAINT_DARKNESS
from omr.mark_style import classify, mark_stats
from omr.offset_field import OffsetField, estimate_offset_field
from omr.params import OmrParams, get_params_override
from omr.preprocess import InvalidImage, ensure_gray, prepare_image
from omr.reader import _bubble_metrics, classify_question, process_image
from omr.second_opinion import (
    N_FEATURES,
    SecondOpinionModel,
    features_from_stats,
    is_available,
    second_opinion,
)
from omr.template import PAGE_H, PAGE_W, generate_card


# ─── Entrada de imagem ─────────────────────────────────────────────────────

def test_prepare_image_rejects_invalid():
    with pytest.raises(InvalidImage):
        prepare_image(None)
    with pytest.raises(InvalidImage):
        prepare_image(np.zeros((4, 4), dtype=np.uint8))
    with pytest.raises(InvalidImage):
        prepare_image(np.zeros((10, 10, 5), dtype=np.uint8))


def test_prepare_image_normalizes_dtype_and_keeps_channels():
    assert prepare_image(np.ones((20, 20), dtype=np.bool_)).dtype == np.uint8
    assert prepare_image(np.ones((20, 20), dtype=np.bool_)).max() == 255

    u16 = prepare_image(np.full((20, 20), 65535, dtype=np.uint16))
    assert u16.dtype == np.uint8 and u16.max() == 255

    f01 = prepare_image(np.full((20, 20), 0.5, dtype=np.float32))
    assert f01.dtype == np.uint8 and abs(int(f01[0, 0]) - 127) <= 1

    rgba = prepare_image(np.zeros((20, 20, 4), dtype=np.uint8))
    assert rgba.shape == (20, 20, 4)
    assert ensure_gray(rgba).shape == (20, 20)


def test_prepare_image_downscales_giant_photo():
    giant = np.zeros((7001, 12, 3), dtype=np.uint8)
    out = prepare_image(giant)
    assert max(out.shape[:2]) == 7000


def test_detector_respects_upscale_pixel_budget(monkeypatch):
    import omr.detector as detector_mod

    monkeypatch.setattr(detector_mod, "UPSCALE_PIXEL_BUDGET", 10)
    # Acima do orçamento: nem chama o detector (None) e devolve vazio.
    assert detector_mod._collect(np.zeros((5, 5), np.uint8), 1.25, None) == ([], None)


# ─── Offset field ──────────────────────────────────────────────────────────

def test_offset_field_fit_recovers_second_degree_surface():
    samples = [(x, y, 0.1 * x - 0.05 * y + 2.0, -0.08 * y + 1.0)
               for x in range(0, 1000, 50) for y in range(0, 2000, 100)]
    field = OffsetField.fit(samples, 1000, 2000)
    dx, dy = field(500, 600)
    assert abs(dx - (0.1 * 500 - 0.05 * 600 + 2.0)) < 1e-6
    assert abs(dy - (-0.08 * 600 + 1.0)) < 1e-6


def test_offset_field_constant_without_samples():
    dx, dy = OffsetField.fit([], PAGE_W, PAGE_H)(123, 456)
    assert (dx, dy) == (0.0, 0.0)
    assert OffsetField.constant(2.0, -3.0)(10, 10) == (2.0, -3.0)


def test_estimate_offset_field_finds_shifted_rings():
    gray = np.full((PAGE_H, PAGE_W), 245, dtype=np.uint8)
    cells = []
    for yy in range(200, 1900, 260):
        for xx in range(200, 1300, 220):
            cells.append((float(xx), float(yy), 10.0))
            # contorno real deslocado (3, -2) da posição prevista
            cv2.circle(gray, (xx + 3, yy - 2), 10, 40, 2, cv2.LINE_AA)

    dx, dy = estimate_offset_field(gray, cells)(PAGE_W / 2.0, PAGE_H / 2.0)
    assert abs(dx - 3.0) <= 1.0
    assert abs(dy + 2.0) <= 1.0


# ─── Estilo de marca ───────────────────────────────────────────────────────

def _stats(draw=None):
    patch = np.full((44, 44), 245, dtype=np.uint8)
    if draw is not None:
        draw(patch)
    return mark_stats(patch, paper=245.0, ink=20.0, r_px=10.0)


def test_mark_style_classifies_common_strokes():
    assert classify(_stats()) == "blank"
    assert classify(_stats(
        lambda p: cv2.circle(p, (22, 22), 9, 20, -1, cv2.LINE_AA))) == "fill"
    assert classify(_stats(
        lambda p: cv2.circle(p, (22, 22), 10, 20, 2, cv2.LINE_AA))) == "circle"
    assert classify(_stats(
        lambda p: (cv2.line(p, (12, 12), (32, 32), 20, 3, cv2.LINE_AA),
                   cv2.line(p, (32, 12), (12, 32), 20, 3, cv2.LINE_AA)))) == "cross"


def test_mark_style_darkness_scale():
    assert _stats().darkness < 0.10
    assert _stats(
        lambda p: cv2.circle(p, (22, 22), 9, 20, -1, cv2.LINE_AA)).darkness > 0.6


# ─── Segunda opinião ───────────────────────────────────────────────────────

def test_features_shape_and_absent_model_is_safe():
    stats = _stats()
    feats = features_from_stats(stats, fill=0.25)
    assert feats.shape == (N_FEATURES,)

    out = second_opinion(feats)
    assert out["available"] is is_available()
    if not out["available"]:
        assert out["label"] == "blank" and out["prob"] == 0.0


def test_second_opinion_model_roundtrip(tmp_path):
    rng = np.random.default_rng(3)
    model = SecondOpinionModel(
        W1=rng.normal(size=(N_FEATURES, 4)),
        b1=np.zeros(4),
        W2=rng.normal(size=(4, 1)),
        b2=np.zeros(1),
        mean=np.zeros(N_FEATURES),
        std=np.ones(N_FEATURES),
        val_accuracy=0.9,
    )
    path = tmp_path / "model.npz"
    model.save(path)
    loaded = SecondOpinionModel.load(path)

    x = rng.normal(size=(5, N_FEATURES))
    np.testing.assert_allclose(loaded.prob(x), model.prob(x))
    assert loaded.val_accuracy == pytest.approx(0.9)


# ─── Decisão por questão ───────────────────────────────────────────────────

def test_cancel_replace_only_with_large_gap():
    # Margem mais rígida (bloco personalizado): a dupla não é aceita sem a regra.
    ratios = {"A": 0.80, "B": 0.40, "C": 0.05, "D": 0.04}
    assert classify_question(ratios, floor=0.30, margin=0.50)[0] == "duplicate"
    assert classify_question(ratios, floor=0.30, margin=0.50,
                             cancel_replace=True) == ("darkest", "A", ["A"])

    close = {"A": 0.70, "B": 0.60, "C": 0.05, "D": 0.04}
    assert classify_question(close, floor=0.30, margin=0.50,
                             cancel_replace=True)[0] == "duplicate"
    assert CANCEL_REPLACE_GAP > 0.70 - 0.60


def test_faint_darkness_never_becomes_blank():
    ratios = {"A": 0.12, "B": 0.05, "C": 0.04, "D": 0.03}
    darkness = {"A": FAINT_DARKNESS + 0.05, "B": 0.0, "C": 0.0, "D": 0.0}

    assert classify_question(ratios, floor=0.30, margin=0.22)[0] == "blank"
    assert classify_question(ratios, floor=0.30, margin=0.22,
                             faint_darkness=FAINT_DARKNESS,
                             darkness=darkness) == ("low", "A", [])


# ─── Métricas da bolha ─────────────────────────────────────────────────────

def test_local_snap_finds_offset_mark_and_darkness_is_reported():
    blank = np.full((80, 80), 245, dtype=np.uint8)
    assert _bubble_metrics(blank, 40, 40, radius=10).darkness < 0.1

    marked = blank.copy()
    cv2.circle(marked, (43, 42), 9, 30, -1, cv2.LINE_AA)
    plain = _bubble_metrics(marked, 40, 40, radius=10)
    snapped = _bubble_metrics(marked, 40, 40, radius=10, snap=3)

    assert snapped.score >= plain.score
    assert plain.darkness > 0.5
    assert plain.rescore((0.4, 0.4, 0.2)).darkness == plain.darkness


# ─── Parâmetros opt-in ─────────────────────────────────────────────────────

def test_new_params_are_opt_in():
    assert OmrParams().is_empty()
    assert not OmrParams(offset_field=True).is_empty()
    assert not OmrParams(local_snap=2).is_empty()
    assert not OmrParams(cancel_replace=True).is_empty()
    assert not OmrParams(faint_darkness=0.18).is_empty()
    assert not OmrParams(second_opinion=True).is_empty()
    assert not OmrParams(mark_styles=True).is_empty()


def test_get_params_override_reads_vision_keys(tmp_path, monkeypatch):
    import omr.params as params_mod

    path = tmp_path / "active_config.json"
    path.write_text(json.dumps({
        "params": {
            "offset_field": True,
            "local_snap": 2,
            "cancel_replace": True,
            "faint_darkness": 0.2,
            "second_opinion": True,
            "mark_styles": True,
        }
    }), encoding="utf-8")
    monkeypatch.setattr(params_mod, "_ACTIVE_PATH", path)

    p = get_params_override()
    assert p.offset_field is True
    assert p.local_snap == 2
    assert p.cancel_replace is True
    assert p.faint_darkness == 0.2
    assert p.second_opinion is True
    assert p.mark_styles is True


# ─── Integração no leitor ──────────────────────────────────────────────────

def test_reader_default_unchanged_and_opt_ins_work():
    card = generate_card()

    base = process_image(card)
    assert base is not None
    assert len(base.blank_questions) / 44 > 0.9
    assert base.mark_styles is None
    assert base.second_opinion is None
    assert base.offset_applied is None

    opt = process_image(card, overrides=OmrParams(
        offset_field=True,
        local_snap=2,
        cancel_replace=True,
        faint_darkness=FAINT_DARKNESS,
        second_opinion=True,
        mark_styles=True,
    ))
    assert opt is not None
    assert len(opt.blank_questions) / 44 > 0.85
    assert opt.offset_applied is not None
    assert opt.mark_styles is not None
    if not is_available():
        assert opt.second_opinion is None  # sem .npz => nada muda


def test_custom_reader_opt_ins_do_not_change_answers():
    from omr import custom_template as ct
    from omr.card_generator import generate_card

    card = generate_card({"n_questions": 12, "n_options": 4})
    bubbles = {(b["question"], b["option"]): b for b in ct.expand_bubbles(card.config)}
    marked = card.image.copy()
    expected = {1: "A", 5: "C", 12: "D"}
    for (q, letter) in expected.items():
        b = bubbles[(q, letter)]
        h, w = marked.shape[:2]
        r = max(3, int(b["r"] * max(w, h)) - 4)
        cv2.circle(marked, (int(b["x"] * w), int(b["y"] * h)), r, (0, 0, 0), -1)

    base = ct.process_custom_image(marked, card.config)
    opt = ct.process_custom_image(marked, card.config, overrides=OmrParams(
        offset_field=True, local_snap=2, mark_styles=True))

    assert base is not None and opt is not None
    for q, letter in expected.items():
        assert base.answers.get(q) == letter
        assert opt.answers.get(q) == letter
    assert opt.offset_applied is not None
    assert opt.mark_styles is not None
