"""first-large-gap: unidade + A/B sintético contra o Otsu.

Executar: python -m pytest test_thresholds.py -q
"""
import numpy as np

from omr.thresholds import first_large_gap, compute_floor
from omr.config import FLOOR


def test_first_large_gap():
    rng = np.random.default_rng(11)
    blanks = rng.normal(0.12, 0.04, 300).clip(0, 1).tolist()
    marked = rng.normal(0.65, 0.10, 100).clip(0, 1).tolist()

    g = first_large_gap(blanks + marked)
    assert g is not None and 0.15 < g < 0.55, f"bimodal: gap no vale: {g}"
    assert first_large_gap([0.1] * 50) is None, "uniforme: sem gap -> None"
    assert first_large_gap([0.1, 0.9]) is not None, "poucas amostras: 2 pts sempre têm gap"


def test_compute_floor_gap():
    rng = np.random.default_rng(11)
    blanks = rng.normal(0.12, 0.04, 300).clip(0, 1).tolist()
    marked = rng.normal(0.65, 0.10, 100).clip(0, 1).tolist()

    f, s = compute_floor(blanks + marked, 'gap')
    assert s == "gap", f"compute gap: source gap: {f:.3f} {s}"
    assert 0.20 <= f <= 0.45, f"compute gap na faixa: {f:.3f}"

    f2, s2 = compute_floor([0.1] * 176, 'gap')
    assert (f2, s2) == (FLOOR, "fixed"), "tudo-branco gap: fallback fixo"


def test_compute_floor_otsu():
    rng = np.random.default_rng(11)
    blanks = rng.normal(0.12, 0.04, 300).clip(0, 1).tolist()
    marked = rng.normal(0.65, 0.10, 100).clip(0, 1).tolist()

    fo, so = compute_floor(blanks + marked, 'otsu')
    assert so in ("otsu", "adaptive") and 0.20 <= fo <= 0.45, f"otsu intacto: {fo:.3f} {so}"
    assert compute_floor(blanks + marked)[1] in ("otsu", "adaptive"), "método default: otsu"


if __name__ == "__main__":
    import pytest as _pytest
    import sys as _sys
    _sys.exit(_pytest.main([__file__, "-q"]))
