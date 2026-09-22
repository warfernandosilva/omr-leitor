"""Limiar adaptativo por foto: divisor orientado pelos dados.

Os scores de bolha são bimodais por construção (vazias ~0.05–0.27,
marcadas ~0.5+). Otsu sobre a distribuição 1D encontra o vale entre os
dois modos; travas de segurança devolvem o FLOOR fixo quando a foto não
tem sinal suficiente (ex.: cartão em branco ou foto inutilizável).
"""
import numpy as np

from .config import FLOOR

ADAPT_MIN = 0.20  # o divisor adaptativo nunca sai desta faixa
ADAPT_MAX = 0.45
MIN_MARKED_FRAC = 0.05  # fração mínima acima do candidato para confiar
MIN_SCORES = 8  # abaixo disso não há estatística — usa o fixo


def otsu_1d(values: list[float]) -> float:
    """Limiar de Otsu sobre valores em [0, 1] (histograma de 256 bins)."""
    arr = np.clip(np.asarray(values, dtype=np.float64), 0.0, 1.0)
    hist, edges = np.histogram(arr, bins=256, range=(0.0, 1.0))
    total = arr.size
    if total == 0:
        return FLOOR
    centers = (edges[:-1] + edges[1:]) / 2.0
    w = hist.astype(np.float64) / total
    cum_w = np.cumsum(w)
    cum_mean = np.cumsum(w * centers)
    total_mean = cum_mean[-1]
    # variância entre-classes; denominador 0 nas bordas -> ignora
    denom = cum_w * (1.0 - cum_w)
    with np.errstate(divide="ignore", invalid="ignore"):
        between = np.where(denom > 0, (total_mean * cum_w - cum_mean) ** 2 / denom, -1.0)
    return float(centers[int(np.argmax(between))])


def adaptive_floor(
    scores: list[float], hi: float = ADAPT_MAX
) -> tuple[float, str]:
    """Devolve (floor, source) com source 'adaptive' ou 'fixed'.

    Regras de segurança (fallback ao fixo):
    - poucas amostras;
    - candidato fora da faixa [ADAPT_MIN, hi] é clampado, e se
      quase nada fica acima dele (cartão em branco), usa o fixo.
    `hi` permite ao chamador alargar o teto (ex.: SAEV com fundo
    texturizado tem vazias ~0.40 e precisa de divisor ~0.55).
    """
    if len(scores) < MIN_SCORES:
        return FLOOR, "fixed"
    candidate = min(hi, max(ADAPT_MIN, otsu_1d(scores)))
    above = sum(1 for s in scores if s >= candidate)
    if above / len(scores) < MIN_MARKED_FRAC:
        return FLOOR, "fixed"
    return candidate, "adaptive"
