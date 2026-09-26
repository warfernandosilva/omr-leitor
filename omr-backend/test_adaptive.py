"""
Limiar adaptativo por foto: divisor orientado pelos dados + travas.

1. Unidade (distribuições sintéticas): bimodal clara/escura -> adaptive
   dentro da faixa; tudo-em-branco -> fallback fixo; poucas amostras -> fixo.
2. Integração: cartão gerado + degradação de celular — adaptativo deve dar
   o MESMO resultado do fixo (paridade), sem duplicadas fantasmas, e a
   duplicada real continua detectada.
3. Gate de regressão nos dois modos (espelha test_dup_regression).

Executar: python -m pytest test_adaptive.py -q
"""
import cv2
import numpy as np

from omr.adaptive import adaptive_floor, ADAPT_MIN, ADAPT_MAX
from omr.config import FLOOR
from omr.template import (
    generate_card, QUESTION_Y, BUBBLE_RADIUS, PORT_X, MAT_X,
    QUESTIONS_PER_SUBJECT,
)
from omr.template_sae import generate_sae_card, SaeSpec
from omr.reader import process_image
from omr.reader_sae import process_sae_image


def degrade(img, seed=7):
    r = np.random.default_rng(seed)
    h, w = img.shape[:2]
    n = img.astype(np.int16) + r.integers(-12, 13, (h, w, 3), dtype=np.int16)
    n = np.clip(n, 0, 255).astype(np.uint8)
    n = cv2.GaussianBlur(n, (3, 3), 0.8)
    _, buf = cv2.imencode('.jpg', n, [int(cv2.IMWRITE_JPEG_QUALITY), 55])
    return cv2.imdecode(buf, cv2.IMREAD_COLOR)


def fill(img, x, y, radius=BUBBLE_RADIUS):
    cv2.circle(img, (int(x), int(y)), int(radius) - 2, (0, 0, 0), -1)


def test_adaptive_units():
    rng = np.random.default_rng(42)
    # ─── 1. Unidade ───
    blanks = rng.normal(0.12, 0.05, 300).clip(0, 1).tolist()
    marked = rng.normal(0.65, 0.12, 100).clip(0, 1).tolist()

    f, src = adaptive_floor(blanks + marked)
    assert src == "adaptive", f"bimodal clara: adaptive: floor={f:.3f} src={src}"
    assert ADAPT_MIN <= f <= ADAPT_MAX, f"bimodal clara: dentro da faixa: {f:.3f}"

    dark_blanks = rng.normal(0.12, 0.05, 300).clip(0, 1).tolist()
    dark_marked = rng.normal(0.65, 0.12, 100).clip(0, 1).tolist()
    # foto globalmente mais escura: todos os scores sobem, o vale acompanha
    shifted = [min(1.0, s + 0.08) for s in dark_blanks + dark_marked]
    f2, src2 = adaptive_floor(shifted)
    assert src2 == "adaptive", f"foto escura: adaptive: floor={f2:.3f} src={src2}"
    assert f2 >= f, f"deslocamento global desloca o divisor: {f:.3f} -> {f2:.3f}"

    f3, src3 = adaptive_floor(rng.normal(0.10, 0.04, 176).clip(0, 1).tolist())
    assert src3 == "fixed" and f3 == FLOOR, f"tudo-em-branco: fallback fixo: {f3:.3f} {src3}"

    f4, src4 = adaptive_floor([0.1, 0.6])
    assert src4 == "fixed" and f4 == FLOOR, f"poucas amostras: fixo: {f4:.3f} {src4}"


def test_adaptive_parity():
    # ─── 2. Integração: paridade fixo x adaptativo ───
    half = generate_card()
    for q in range(QUESTIONS_PER_SUBJECT):
        fill(half, PORT_X[q % 4], int(QUESTION_Y[q]))
    img = degrade(half)

    r_fix = process_image(img)
    r_adt = process_image(img, adaptive=True)
    assert r_fix is not None and r_adt is not None, "pipeline retornou None"
    assert r_adt.floor_source in ("fixed", "adaptive"), \
        f"adaptativo roda (source): floor={r_adt.floor_used:.3f} src={r_adt.floor_source}"
    assert r_adt.answers == r_fix.answers, \
        f"paridade respostas: fix={len(r_fix.answers)} adt={len(r_adt.answers)}"
    assert r_adt.duplicate_questions == r_fix.duplicate_questions, \
        f"paridade duplicadas: {r_adt.duplicate_questions}"
    assert [q for q in r_adt.duplicate_questions if q > QUESTIONS_PER_SUBJECT] == [], \
        f"adaptativo: 0 fantasmas na MAT branca: {r_adt.duplicate_questions}"


def test_adaptive_regression_both_modes():
    # ─── 3. Regressão nos dois modos ───
    blank = degrade(generate_card(), seed=99)
    for modo in (False, True):
        r = process_image(blank, adaptive=modo)
        assert r is not None, f"None no branco (adaptive={modo})"
        assert r.duplicate_questions == [], \
            f"branco adaptive={modo}: 0 duplicadas: {r.duplicate_questions}"
        assert len(r.blank_questions) == 44, \
            f"branco adaptive={modo}: 44 em branco: {len(r.blank_questions)}"

    dup = generate_card()
    fill(dup, PORT_X[0], int(QUESTION_Y[0]))
    fill(dup, PORT_X[1], int(QUESTION_Y[0]))
    imgd = degrade(dup, seed=33)
    for modo in (False, True):
        r = process_image(imgd, adaptive=modo)
        assert r is not None, f"None na duplicada (adaptive={modo})"
        assert 1 in r.duplicate_questions, \
            f"duplicada real adaptive={modo} detectada: dups={r.duplicate_questions}"

    sae = degrade(generate_sae_card(SaeSpec()), seed=5)
    for modo in (False, True):
        r = process_sae_image(sae, n_questions=26, adaptive=modo)
        assert r is not None, f"None no SAE (adaptive={modo})"
        assert r.duplicate_questions == [], \
            f"sae adaptive={modo}: 0 duplicadas: {r.duplicate_questions}"


if __name__ == "__main__":
    import pytest as _pytest
    import sys as _sys
    _sys.exit(_pytest.main([__file__, "-q"]))
