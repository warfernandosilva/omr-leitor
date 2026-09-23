"""Tuning por modelo como DADOS (não branches espalhados).

Cada modelo declara como calcula o divisor marcado/vazio:
- floor_method: 'otsu' (único implementado; 'gap' chega na Fase 2);
- score_set: 'flat' (todos os scores) ou 'bests' (melhor por questão);
- hi: teto do divisor adaptativo;
- force_adaptive: ignora o default OFF (hoje só SAEV, com evidência real).
"""
from dataclasses import dataclass

from .adaptive import adaptive_floor
from .config import FLOOR
from .thresholds import compute_floor


@dataclass(frozen=True)
class ModelTuning:
    floor_method: str = "otsu"
    score_set: str = "flat"
    hi: float = 0.45
    force_adaptive: bool = False


MODEL_TUNING: dict[str, ModelTuning] = {
    "padrao": ModelTuning(),
    "sae": ModelTuning(),
    "colar": ModelTuning(),
    "saev": ModelTuning(score_set="bests", hi=0.55, force_adaptive=True),
}


def get_tuning(template: str | None) -> ModelTuning:
    """Tabela por modelo; desconhecido cai no padrão (comportamento atual)."""
    return MODEL_TUNING.get(template or "padrao", MODEL_TUNING["padrao"])


def compute_floor_for(
    template: str | None,
    all_ratios: dict[int, dict[str, float]],
    adaptive: bool,
) -> tuple[float, str]:
    """Divisor desta foto segundo a tabela do modelo.

    Centraliza o que era branch por reader: conjunto de scores, teto e
    force_adaptive. Comportamento idêntico aos branches originais.
    """
    t = get_tuning(template)
    if not (adaptive or t.force_adaptive):
        return FLOOR, "fixed"
    if t.score_set == "bests":
        scores = [max(qr.values()) for qr in all_ratios.values() if qr]
    else:
        scores = [s for qr in all_ratios.values() for s in qr.values()]
    if t.floor_method == "gap":
        return compute_floor(scores, method="gap", hi=t.hi)
    return adaptive_floor(scores, hi=t.hi)
