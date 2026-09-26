"""Trava da tabela de tuning por modelo (refactor puro: mesmos valores).

Executar: python -m pytest test_tuning.py -q
"""
from omr.tuning import MODEL_TUNING, get_tuning, compute_floor_for
from omr.config import FLOOR


def test_tuning_table():
    assert set(MODEL_TUNING) == {"padrao", "sae", "colar", "saev", "herby"}, "5 modelos na tabela"
    saev = get_tuning("saev")
    assert saev.score_set == "bests" and saev.hi == 0.55 and saev.force_adaptive, \
        "saev: bests + hi=0.55 + force"
    herby = get_tuning("herby")
    assert herby.score_set == "bests" and herby.hi == 0.55 and herby.force_adaptive, \
        "herby: ponto de partida SAEV"
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


if __name__ == "__main__":
    import pytest as _pytest
    import sys as _sys
    _sys.exit(_pytest.main([__file__, "-q"]))
