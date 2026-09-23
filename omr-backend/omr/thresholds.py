"""Métodos de divisor marcado/vazio (A/B contra o Otsu).

- 'otsu': Otsu sobre a distribuição 1D (método atual, ver omr/adaptive.py);
- 'gap': first-large-gap do OMRChecker (ideia adaptada): ordena os scores
  e corta no meio do PRIMEIRO gap >= MIN_JUMP dentro da janela looseness.
  Sem gap confiante, devolve None (chamador aplica o fallback fixo).
"""
from .adaptive import ADAPT_MIN, otsu_1d

MIN_JUMP = 0.08  # gap mínimo para ser "grande" (escala 0..1 de score)


def first_large_gap(scores: list[float], min_jump: float = MIN_JUMP, looseness: int = 1) -> float | None:
    """Meio do primeiro gap >= min_jump (janela `looseness`). None se não há."""
    vals = sorted(max(0.0, min(1.0, s)) for s in scores)
    if len(vals) < 2:
        return None
    ls = max(1, (looseness + 1) // 2)
    # primeiro gap grande: corta no meio do par central da janela
    for i in range(ls, len(vals)):
        lo = vals[i - ls]
        hi = vals[min(i + ls - 1, len(vals) - 1)]
        if hi - lo >= min_jump:
            a, b = vals[i - 1], vals[i]
            if b - a <= 0:
                continue
            return (a + b) / 2.0
    return None


def compute_floor(
    scores: list[float], method: str = "otsu", hi: float = 0.45,
) -> tuple[float, str]:
    """Divisor por método, com as mesmas travas do adaptive.

    Retorna (floor, source) com source 'otsu' | 'gap' | 'fixed'.
    'gap' sem gap confiante -> fallback fixo (nunca chuta).
    """
    from .config import FLOOR
    from .adaptive import MIN_MARKED_FRAC, MIN_SCORES

    if len(scores) < MIN_SCORES:
        return FLOOR, "fixed"
    if method == "gap":
        cut = first_large_gap(scores)
        if cut is None:
            return FLOOR, "fixed"
        floor = min(hi, max(ADAPT_MIN, cut))
    else:
        floor = min(hi, max(ADAPT_MIN, otsu_1d(scores)))
    above = sum(1 for s in scores if s >= floor)
    if above / len(scores) < MIN_MARKED_FRAC:
        return FLOOR, "fixed"
    return floor, method if method in ("otsu", "gap") else "adaptive"
