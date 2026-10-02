"""Fase 0 — Paridade do override de parâmetros (Laboratório OMR).

Garante que adicionar `overrides: OmrParams` não muda nada quando vazio:
process_image/process_sae_image/process_saev_image com overrides=None devem
produzir respostas idênticas a OmrParams() (tudo None). Também cobre os
componentes do score (BubbleMetrics) e a leitura da config ativa publicada.

Executar: python -m pytest test_params.py -q
"""
import json
import cv2
import numpy as np

from omr.params import OmrParams, params_for, get_params_override
from omr.reader import process_image, classify_question, _bubble_metrics, _bubble_score
from omr.reader_sae import process_sae_image
from omr.reader_saev import process_saev_image, _square_metrics, _square_score
from omr.template import generate_card, QUESTION_Y, PORT_X, BUBBLE_RADIUS
from omr.template_sae import (
    generate_sae_card, SaeSpec, sae_block_rows,
    SAE_BLOCKS_X, SAE_BUBBLE_DX, SAE_FIRST_ROW_Y, SAE_ROW_STEP,
    SAE_BUBBLE_RADIUS,
)
from omr.template_saev import (
    generate_saev_card, SaevSpec, saev_block_rows, saev_bubble_center,
    SAEV_COLS_X, SAEV_NUM_W, SAEV_PITCH, SAEV_SIDE,
)
from omr import params as params_module


def _fill_padrao():
    card = generate_card()
    letters = ["A", "B", "C", "D"]
    for q in range(22):
        alt = letters[(q * 7 + 3) % 4]
        x = PORT_X[q % 4]
        cv2.circle(card, (int(x), int(QUESTION_Y[q])), int(BUBBLE_RADIUS) - 2, (15, 15, 15), -1)
    return card


def _fill_sae():
    base = generate_sae_card(SaeSpec())
    r = int(round(SAE_BUBBLE_RADIUS)) - 3
    for q, b, row in sae_block_rows(26):
        y = SAE_FIRST_ROW_Y + row * SAE_ROW_STEP
        cx = SAE_BLOCKS_X[b] + SAE_BUBBLE_DX[(q * 7 + 3) % 4]
        cv2.ellipse(base, (cx, y), (r, r), 0, 0, 360, (20, 20, 20), -1)
    return base


def _fill_saev():
    base = generate_saev_card(SaevSpec())
    half = int(SAEV_SIDE / 2) - 3
    for q, col, r in saev_block_rows(22):
        alt = (q * 7 + 3) % 4
        cx, cy = saev_bubble_center(col, r, alt, 22)
        cv2.rectangle(base, (int(cx) - half, int(cy) - half),
                      (int(cx) + half, int(cy) + half), (15, 15, 15), -1)
    return base


def _snapshot(r: object) -> str:
    return json.dumps(
        (r.answers, r.blank_questions, r.duplicate_questions, r.low_confidence,
         r.floor_used, r.floor_source, r.qr_id),
        default=lambda o: None,
        sort_keys=True,
    )


# ---------------------------------------------------------------------------
# Paridade dos readers: sem overrides == OmrParams() vazio == payload degradado
# ---------------------------------------------------------------------------

def test_padrao_parity_empty_override():
    card = _fill_padrao()
    r0 = process_image(card)
    assert r0 is not None
    r1 = process_image(card, overrides=OmrParams())
    assert r1 is not None
    assert _snapshot(r0) == _snapshot(r1)
    assert r0.answers == r1.answers and r0.all_ratios == r1.all_ratios


def test_padrao_parity_matching_values():
    """Override com os MESMOS valores de produção não altera as respostas."""
    card = _fill_padrao()
    r0 = process_image(card)
    assert r0 is not None
    r1 = process_image(
        card,
        overrides=OmrParams(floor=r0.floor_used, margin=0.22, inner_radius=23),
    )
    assert r1 is not None
    # inner_radius 23 == max(6, int(19.5) - 2); floor/margin já são os de produção
    assert r0.answers == r1.answers


def test_sae_saev_parity_empty_override():
    sae = _fill_sae()
    rs0 = process_sae_image(sae, n_questions=26)
    rs1 = process_sae_image(sae, n_questions=26, overrides=OmrParams())
    assert rs0 is not None and rs1 is not None
    assert _snapshot(rs0) == _snapshot(rs1)

    saev = _fill_saev()
    rv0 = process_saev_image(saev, questions_per_subject=22)
    rv1 = process_saev_image(saev, questions_per_subject=22, overrides=OmrParams())
    assert rv0 is not None and rv1 is not None
    assert _snapshot(rv0) == _snapshot(rv1)


# ---------------------------------------------------------------------------
# Componentes do score preservados (base do LabOptionScore)
# ---------------------------------------------------------------------------

def test_bubble_metrics_components_decompose():
    card = _fill_padrao()
    gray = cv2.cvtColor(card, cv2.COLOR_BGR2GRAY)
    x, y = int(PORT_X[0]), int(QUESTION_Y[0])
    m = _bubble_metrics(gray, x, y, radius=int(BUBBLE_RADIUS) - 2)
    expected = 0.4 * m.mean_intensity + 0.4 * m.dark_ratio + 0.2 * m.contrast
    assert abs(m.score - expected) < 1e-9
    assert abs(m.score - _bubble_score(gray, x, y, radius=int(BUBBLE_RADIUS) - 2)) < 1e-12
    assert 0 <= m.otsu_threshold <= 255


def test_bubble_metrics_rescore_new_weights():
    card = _fill_padrao()
    gray = cv2.cvtColor(card, cv2.COLOR_BGR2GRAY)
    m = _bubble_metrics(gray, int(PORT_X[0]), int(QUESTION_Y[0]),
                        radius=int(BUBBLE_RADIUS) - 2)
    r = m.rescore((0.2, 0.2, 0.6))
    expected = 0.2 * m.mean_intensity + 0.2 * m.dark_ratio + 0.6 * m.contrast
    assert abs(r.score - expected) < 1e-9
    assert r.mean_intensity == m.mean_intensity  # componentes preservados


def test_square_metrics_components_decompose():
    saev = _fill_saev()
    gray = cv2.cvtColor(saev, cv2.COLOR_BGR2GRAY)
    q, col, r = next(iter(saev_block_rows(22)))
    cy = saev_bubble_center(col, r, 0, 22)[1]
    cx = SAEV_COLS_X[col] + SAEV_NUM_W + SAEV_PITCH / 2
    m = _square_metrics(gray, cx, cy, side=SAEV_SIDE)
    expected = 0.4 * m.mean_intensity + 0.4 * m.dark_ratio + 0.2 * m.contrast
    assert abs(m.score - expected) < 1e-9
    assert abs(m.score - _square_score(gray, cx, cy, side=SAEV_SIDE)) < 1e-12


# ---------------------------------------------------------------------------
# classify_question com low_thr explícito (override de calibração)
# ---------------------------------------------------------------------------

def test_classify_question_low_thr_override():
    ratios = {"A": 0.32, "B": 0.10, "C": 0.08, "D": 0.06}
    # sem override: low_thr = floor + 0.05 = 0.35 -> melhor 0.32 < 0.35 -> low
    status, letter, _ = classify_question(ratios, floor=0.30, margin=0.22)
    assert status == "low" and letter == "A"
    # low_thr baixo: 0.32 passa -> ok
    status, letter, _ = classify_question(ratios, floor=0.30, margin=0.22, low_thr=0.30)
    assert status == "ok" and letter == "A"


# ---------------------------------------------------------------------------
# Leitura da configuração ativa publicada (data/active_config.json)
# ---------------------------------------------------------------------------

def test_params_for_production_is_empty():
    assert params_for(active=False).is_empty()


def test_get_params_override_reads_active_config(tmp_path, monkeypatch):
    cfg = {
        "floor": 0.35,
        "margin": 0.18,
        "low_conf_threshold": 0.38,
        "weights": [0.3, 0.4, 0.3],
        "inner_radius": 18,
        "clahe_clip": 3.0,
    }
    active = tmp_path / "active_config.json"
    active.write_text(json.dumps(cfg), encoding="utf-8")
    monkeypatch.setattr(params_module, "_ACTIVE_PATH", active)

    p = get_params_override()
    assert p.floor == 0.35 and p.margin == 0.18
    assert p.low_conf_threshold == 0.38
    assert p.weights == (0.3, 0.4, 0.3)
    assert p.inner_radius == 18 and p.clahe_clip == 3.0
    assert p.square_inset is None and p.clahe_tiles is None


def test_get_params_override_defaults_when_empty(tmp_path, monkeypatch):
    active = tmp_path / "active_config.json"
    active.write_text(json.dumps({}), encoding="utf-8")
    monkeypatch.setattr(params_module, "_ACTIVE_PATH", active)
    assert get_params_override().is_empty()


if __name__ == "__main__":
    import pytest as _pytest
    import sys as _sys
    _sys.exit(_pytest.main([__file__, "-q"]))