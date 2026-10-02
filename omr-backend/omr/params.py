"""
Parâmetros de calibração do OMR (Laboratório) — nunca altera produção por padrão.

O motor de produção continua lendo as constantes de omr/config.py e a tabela
por modelo de omr/tuning.py quando chamado SEM `overrides`. O Laboratório/Calibração
pode injetar um `OmrParams` apenas em avaliação; cada campo None cai no valor de
produção (comportamento byte-idêntico ao atual).

Publicar uma configuração (Fase 2) escreve `data/active_config.json` (via
omr/lab de Calibração). get_config() passa a refleti-la para o mundo externo —
o próprio motor continua sendo alimentado pelos `overrides` do chamador, então
publicar NUNCA muda produção sem o fluxo explícito do Laboratório.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

# Caminho da configuração ativa publicada pelo Laboratório (Fase 2).
_DEFAULT_ACTIVE = Path(__file__).resolve().parent.parent / "data" / "active_config.json"
_ACTIVE_PATH = Path(os.environ.get("OMR_ACTIVE_CONFIG", str(_DEFAULT_ACTIVE)))


@dataclass(frozen=True)
class OmrParams:
    """Overrides opcionais dos thresholds de leitura.

    Todos os campos são None por padrão ⇒ produção usa config.py/tuning.py.
    """
    floor: float | None = None          # divisor marcado/vazio
    margin: float | None = None         # gap mínimo 1º-2º p/ "ok" (não duplicada)
    low_conf_threshold: float | None = None  # absoluto; default mantém offset floor+0.05
    weights: tuple[float, float, float] | None = None  # (média, dark_ratio, contraste)
    inner_radius: int | None = None     # raio interno da ROI circular (padrão/SAE)
    square_inset: int | None = None     # inset do quadrado (SAEV/Herby)
    clahe_clip: float | None = None     # clipLimit do CLAHE
    clahe_tiles: tuple[int, int] | None = None  # tileGridSize do CLAHE

    def is_empty(self) -> bool:
        return all(
            v is None
            for v in (
                self.floor, self.margin, self.low_conf_threshold, self.weights,
                self.inner_radius, self.square_inset, self.clahe_clip, self.clahe_tiles,
            )
        )


def _read_active_config() -> dict:
    try:
        if _ACTIVE_PATH.exists():
            data = json.loads(_ACTIVE_PATH.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}
    return {}


def get_active_config() -> dict:
    """Configuração publicada ativa (vazia se nenhuma foi publicada)."""
    return _read_active_config()


def get_params_override() -> OmrParams:
    """OmrParams derivado da configuração ativa publicada (se houver)."""
    cfg = _read_active_config()
    return OmrParams(
        floor=cfg.get("floor"),
        margin=cfg.get("margin"),
        low_conf_threshold=cfg.get("low_conf_threshold"),
        weights=tuple(cfg["weights"]) if isinstance(cfg.get("weights"), list) else None,
        inner_radius=cfg.get("inner_radius"),
        square_inset=cfg.get("square_inset"),
        clahe_clip=cfg.get("clahe_clip"),
        clahe_tiles=tuple(cfg["clahe_tiles"]) if isinstance(cfg.get("clahe_tiles"), list) else None,
    )


def params_for(active: bool = False) -> OmrParams:
    """Overrides a usar pelo pipeline:
    - active=False (produção): sempre Sem overrides.
    - active=True (Laboratório/avaliação): reflete a configuração ativa publicada.
    """
    if not active:
        return OmrParams()
    return get_params_override()


def write_active_config(params: dict) -> None:
    """Grava a configuração ativa publicada (usado pelo endpoint publish).

    Só é chamado pelo fluxo explícito do Laboratório/Calibração — nunca
    automaticamente pela leitura de imagens.
    """
    _ACTIVE_PATH.parent.mkdir(parents=True, exist_ok=True)
    _ACTIVE_PATH.write_text(json.dumps(params, indent=2, ensure_ascii=False), encoding="utf-8")


def clear_active_config() -> None:
    """Remove a configuração publicada (volta ao default do config.py)."""
    try:
        if _ACTIVE_PATH.exists():
            _ACTIVE_PATH.unlink()
    except OSError:
        pass