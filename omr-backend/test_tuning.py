"""Trava da tabela de tuning por modelo (refactor puro: mesmos valores).

Executar: python -m pytest test_tuning.py -q
"""
from omr.tuning import MODEL_TUNING, get_tuning, compute_floor_for
from omr.config import FLOOR


def test_tuning_table():
    assert set(MODEL_TUNING) == {"padrao", "sae", "colar", "saev", "herby", "simulado"}, \
        "6 modelos na tabela"
    saev = get_tuning("saev")
    assert saev.score_set == "bests" and saev.hi == 0.55 and saev.force_adaptive, \
        "saev: bests + hi=0.55 + force"
    herby = get_tuning("herby")
    assert herby.score_set == "bests" and herby.hi == 0.40 and herby.force_adaptive \
        and herby.margin == 0.15 and herby.min_peak == 0.45, \
        "herby: calibrado 28/09 (bests/hi=0.40/force/margin=0.15/min_peak=0.45)"
    sim = get_tuning("simulado")
    assert sim.floor_method == "gap" and sim.score_set == "flat" and sim.hi == 0.55 \
        and sim.force_adaptive and sim.margin == 0.22 and sim.min_peak == 0.45, \
        "simulado: gap/flat/hi=0.55/force/margin=0.22/min_peak=0.45 (foto real Fase 0)"
    assert all(get_tuning(m).score_set == "flat" and get_tuning(m).hi == 0.45
               and not get_tuning(m).force_adaptive for m in ("padrao", "sae", "colar")), \
        "padrao/sae/colar: flat + hi=0.45 sem force"
    assert get_tuning("xyz") == get_tuning("padrao"), "desconhecido cai no padrão"


def test_tuning_behavior():
    # comportamento preservado
    f, s = compute_floor_for("padrao", {1: {"A": 0.1, "B": 0.1}}, False)
    assert (f, s) == (FLOOR, "fixed"), "padrao sem flag: fixo"
    marked = {q: {"A": 0.65, "B": 0.1, "C": 0.1, "D": 0.1} for q in range(1, 45)}
    marked.update({q: {"A": 0.1, "B": 0.1, "C": 0.1, "D": 0.1} for q in range(45, 89)})
    f2, s2 = compute_floor_for("saev", marked, False)
    assert s2 == "adaptive", f"saev sem flag: force liga o adaptativo: {f2:.3f} {s2}"
    f3, s3 = compute_floor_for("padrao", marked, True)
    assert s3 == "adaptive", f"padrao com flag: adaptativo: {f3:.3f} {s3}"
    # simulado: SEM a flag o floor de 'gap' continua ligado (force) e corta
    # no meio da lacuna real (vazias ~0,20 x preenchidas ~0,70).
    sim = {q: {"A": 0.70, "B": 0.18, "C": 0.20, "D": 0.19} for q in range(1, 10)}
    sim.update({q: {"A": 0.18, "B": 0.20, "C": 0.19, "D": 0.21} for q in range(10, 23)})
    f4, s4 = compute_floor_for("simulado", sim, False)
    assert s4 == "gap", f"simulado sem flag: force liga o gap: {f4:.3f} {s4}"
    assert 0.40 <= f4 <= 0.50, f"simulado: corte no meio da lacuna: {f4:.3f}"


if __name__ == "__main__":
    import pytest as _pytest
    import sys as _sys
    _sys.exit(_pytest.main([__file__, "-q"]))
