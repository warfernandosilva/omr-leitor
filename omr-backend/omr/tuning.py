"""Tuning por modelo como DADOS (não branches espalhados).

Cada modelo declara como calcula o divisor marcado/vazio:
- floor_method: 'otsu' (padrão) ou 'gap' (first-large-gap; Simulado);
- score_set: 'flat' (todos os scores) ou 'bests' (melhor por questão);
- hi: teto do divisor adaptativo;
- force_adaptive: ignora o default OFF (hoje só SAEV, com evidência real).

Evidências (de onde veio cada número):
- FLOOR=0.30 (config.py): A/B first-large-gap x Otsu em 19 fotos
  reais (compare_floors.py: Otsu gap médio 0.349) — fixo vence sem adaptativo.
- MARGIN global=0.22 (config.py); Herby usa margin=0.15 própria (grid 28/09).
- SAEV bests/hi=0.55/force_adaptive: fotos reais 43-44/44 no adaptativo vs
  18/41 no fixo (evidência de campo; bolhas quadradas têm contraste menor).
- Demais modelos: default conservador até haver evidência contrária.
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
    margin: float = 0.22  # gap 1º-2º p/ duplicada (Herby: 0.15, evidência abaixo)
    # Pico mínimo para confiar no adaptativo: se nenhum score chega lá
    # (folha em branco/ruído), usa o fixo. Herby: 0.45 (virgem top ~0.28).
    min_peak: float | None = None


MODEL_TUNING: dict[str, ModelTuning] = {
    "padrao": ModelTuning(),
    "sae": ModelTuning(),
    "colar": ModelTuning(),
    "saev": ModelTuning(score_set="bests", hi=0.55, force_adaptive=True),
    # Herby: calibrado em 5 folhas preenchidas reais (220 questões, ground
    # truth CSV 28/09/2026) — grid hi x score_set x MARGIN: hi=0.40/bests/
    # margin=0.15 → 59.1% auto + 0.5% erro (vs 35.5% com hi=0.55).
    # Alinhamento: warp afim + refino pela grade (refine_herby_grid).
    "herby": ModelTuning(score_set="bests", hi=0.40, force_adaptive=True, margin=0.15, min_peak=0.45),
    # Simulado: 88 scores medidos na foto real (IMG/20261008_203236.jpg, Fase 0)
    # — vazias 0,156-0,247, preenchidas 0,619-0,836, lacuna 0,372. Otsu(flat)
    # = 0,248 cai colado no teto das vazias (frágil); first_large_gap = 0,4329,
    # estável em 22/22 em todas as variações de pré-processamento testadas.
    "simulado": ModelTuning(floor_method="gap", score_set="flat", hi=0.55,
                            force_adaptive=True, margin=0.22, min_peak=0.45),
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
    if t.min_peak is not None and (not scores or max(scores) < t.min_peak):
        return FLOOR, "fixed"
    if t.floor_method == "gap":
        return compute_floor(scores, method="gap", hi=t.hi)
    return adaptive_floor(scores, hi=t.hi)
