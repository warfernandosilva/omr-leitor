"""Trava da tabela de tuning por modelo (refactor puro: mesmos valores)."""
import sys
sys.path.insert(0, '.')

from omr.tuning import MODEL_TUNING, get_tuning, compute_floor_for
from omr.config import FLOOR

fails = []


def check(name, cond, extra=""):
    print(f"   {'OK ' if cond else 'FALHA'}  {name} {extra}")
    if not cond:
        fails.append(name)


check("5 modelos na tabela", set(MODEL_TUNING) == {"padrao", "sae", "colar", "saev", "herby"})
saev = get_tuning("saev")
check("saev: bests + hi=0.55 + force", saev.score_set == "bests" and saev.hi == 0.55 and saev.force_adaptive)
herby = get_tuning("herby")
check("herby: ponto de partida SAEV", herby.score_set == "bests" and herby.hi == 0.55 and herby.force_adaptive)
check("padrao/sae/colar: flat + hi=0.45 sem force",
      all(get_tuning(m).score_set == "flat" and get_tuning(m).hi == 0.45
          and not get_tuning(m).force_adaptive for m in ("padrao", "sae", "colar")))
check("desconhecido cai no padrão", get_tuning("xyz") == get_tuning("padrao"))

# comportamento preservado
f, s = compute_floor_for("padrao", {1: {"A": 0.1, "B": 0.1}}, False)
check("padrao sem flag: fixo", (f, s) == (FLOOR, "fixed"))
marked = {q: {"A": 0.65, "B": 0.1, "C": 0.1, "D": 0.1} for q in range(1, 45)}
marked.update({q: {"A": 0.1, "B": 0.1, "C": 0.1, "D": 0.1} for q in range(45, 89)})
f2, s2 = compute_floor_for("saev", marked, False)
check("saev sem flag: force liga o adaptativo", s2 == "adaptive", f"{f2:.3f} {s2}")
f3, s3 = compute_floor_for("padrao", marked, True)
check("padrao com flag: adaptativo", s3 == "adaptive", f"{f3:.3f} {s3}")

print("\nTUNING:", "PASS" if not fails else f"FAIL {fails}")
sys.exit(1 if fails else 0)
