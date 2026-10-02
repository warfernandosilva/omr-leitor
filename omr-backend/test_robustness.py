"""
Fase 4 — regressão de legibilidade sob degradações fortes.

Trava o BASELINE medido em `python -m omr.robustness` (2026-10-01): o reader
REAL de produção (`omr.reader.process_image`) acerta 44/44 em todas as
condições do dataset — rotação 0–180°, escala até 0,18×, perspectiva até
500px, JPEG q5 e combinações.

Se um ajuste de threshold/CLAHE/pesos quebrar qualquer condição, este teste
falha com a condição e as questões divergentes. Não há pipeline paralelo:
o que este teste lê é exatamente o que roda no app.

Executar: python -m pytest test_robustness.py -q
"""

from __future__ import annotations

import pytest

from omr.reader import process_image
from omr.robustness import build_variants, cover_marker, filled_card, measure

SEED = 42


def test_dataset_completo_44_44():
    """Toda variante degradada deve ler as 44 questões corretas."""
    key, conds = build_variants(seed=SEED)
    assert len(conds) >= 15, f"dataset encolheu: {len(conds)} condições"

    failures: list[str] = []
    for cond in conds:
        acc = measure(cond, key)
        if not acc.read:
            failures.append(f"{cond.name}: pipeline retornou None")
        elif acc.errors:
            piores = ", ".join(
                f"q{q} esperado {exp} lido {got}" for q, (exp, got) in list(acc.errors.items())[:5]
            )
            failures.append(f"{cond.name}: {acc.correct}/{acc.total} — {piores}")

    assert not failures, "regressão de legibilidade:\n" + "\n".join(failures)


def test_cartao_limpo_preenchido_44_44():
    """Sanidade: o cartão-base (sem degradação) lê 100%."""
    card, key = filled_card()
    result = process_image(card)
    assert result is not None, "cartão limpo preenchido retornou None"
    assert result.answers == key, (
        f"diferenças: {[(q, key[q], result.answers.get(q)) for q in key if result.answers.get(q) != key[q]]}"
    )
    assert result.blank_questions == [] and result.duplicate_questions == []


@pytest.mark.parametrize("marker_id", [0, 1, 2, 3])
def test_aruco_coberto_retorna_none(marker_id: int):
    """Faltando 1 dos 4 ArUco, o pipeline rejeita a foto (retorna None)."""
    card, _ = filled_card()
    assert process_image(cover_marker(card, marker_id)) is None
