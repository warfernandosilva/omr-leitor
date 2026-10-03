"""Normalizacao de nomes de alunos (pareamento manual por nome).

O pareamento ignora caixa, acentos e espacos extras: 'jose  da SILVA'
casa com 'JOSE DA SILVA'. Implementacao: casefold + remocao de
diacriticos (NFKD) + colapso de espacos.
"""

from __future__ import annotations

import unicodedata


def normalize_nome(s: str | None) -> str:
    """Nome canonico p/ comparacao: minusculo, sem acentos, espacos unicos."""
    if not s:
        return ""
    decomposed = unicodedata.normalize("NFKD", s)
    no_accents = "".join(c for c in decomposed if not unicodedata.combining(c))
    return " ".join(no_accents.casefold().split())
