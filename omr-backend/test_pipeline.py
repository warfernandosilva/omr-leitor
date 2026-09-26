"""Pipeline padrão: gerar → detectar marcadores → validar geometria → ler.

Executar: python -m pytest test_pipeline.py -q
"""
import cv2  # noqa: F401 — garante backend de imagem carregado
import numpy as np  # noqa: F401

from omr.template import generate_card
from omr.detector import detect_markers, validate_geometry
from omr.reader import process_image


def test_pipeline_blank_card():
    card = generate_card()
    assert card.shape == (2048, 1448, 3), f"shape: {card.shape}"

    det = detect_markers(card)
    assert len(det.markers) == 4 and not det.missing_ids, \
        f"marcadores: encontrados {len(det.markers)}/4, faltantes: {det.missing_ids}"

    assert validate_geometry(det.markers), "geometria válida"

    result = process_image(card)
    assert result is not None, "process_image retornou None no cartão vazio"
    blank_ratio = len(result.blank_questions) / 44
    assert blank_ratio > 0.9, \
        f"cartão vazio ~100% em branco: respostas={len(result.answers)} brancas={len(result.blank_questions)}"


if __name__ == "__main__":
    import pytest as _pytest
    import sys as _sys
    _sys.exit(_pytest.main([__file__, "-q"]))
