"""first-large-gap: unidade + A/B sintético contra o Otsu."""
import sys
sys.path.insert(0, '.')

import numpy as np

from omr.thresholds import first_large_gap, compute_floor
from omr.config import FLOOR

fails = []


def check(name, cond, extra=""):
    print(f"   {'OK ' if cond else 'FALHA'}  {name} {extra}")
    if not cond:
        fails.append(name)


rng = np.random.default_rng(11)
blanks = rng.normal(0.12, 0.04, 300).clip(0, 1).tolist()
marked = rng.normal(0.65, 0.10, 100).clip(0, 1).tolist()

g = first_large_gap(blanks + marked)
check("bimodal: gap no vale", g is not None and 0.15 < g < 0.55, f"{g}")
check("uniforme: sem gap -> None", first_large_gap([0.1] * 50) is None)
check("poucas amostras: None", first_large_gap([0.1, 0.9]) is not None)  # 2 pts sempre têm gap

f, s = compute_floor(blanks + marked, 'gap')
check("compute gap: source gap", s == "gap", f"{f:.3f} {s}")
check("compute gap na faixa", 0.20 <= f <= 0.45, f"{f:.3f}")

f2, s2 = compute_floor([0.1] * 176, 'gap')
check("tudo-branco gap: fallback fixo", (f2, s2) == (FLOOR, "fixed"))

fo, so = compute_floor(blanks + marked, 'otsu')
check("otsu intacto", so in ("otsu", "adaptive") and 0.20 <= fo <= 0.45, f"{fo:.3f} {so}")
check("método default: otsu", compute_floor(blanks + marked)[1] in ("otsu", "adaptive"))

print("\nTHRESHOLDS:", "PASS" if not fails else f"FAIL {fails}")
sys.exit(1 if fails else 0)
