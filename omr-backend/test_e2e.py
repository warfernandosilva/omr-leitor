"""
Teste end-to-end: gera cartão com bolhas preenchidas, processa e verifica.

Executar: python -m pytest test_e2e.py -q
"""
import cv2
import numpy as np

from omr.template import (
    generate_card, QUESTION_Y,
    BUBBLE_RADIUS, PORT_X, MAT_X, QUESTIONS_PER_SUBJECT,
)
from omr.reader import process_image
from omr.grading import grade


def fill_bubble(img, x, y, radius=BUBBLE_RADIUS):
    """Preenche uma bolha no cartão (desenha um círculo preenchido)."""
    cv2.circle(img, (int(x), int(y)), int(radius) - 2, (0, 0, 0), -1)


def test_e2e_filled_card(tmp_path):
    # 1. Gerar cartão vazio
    card = generate_card()

    # 2. Preencher respostas conhecidas
    answer_key = {}
    letters = ["A", "B", "C", "D"]

    # Português: padrão A,B,C,D repetido
    for q in range(QUESTIONS_PER_SUBJECT):
        y = int(QUESTION_Y[q])
        chosen = q % 4  # 0,1,2,3 → A,B,C,D
        fill_bubble(card, PORT_X[chosen], y)
        answer_key[q + 1] = letters[chosen]

    # Matemática: padrão D,C,B,A repetido
    for q in range(QUESTIONS_PER_SUBJECT):
        y = int(QUESTION_Y[q])
        chosen = 3 - (q % 4)  # 3,2,1,0 → D,C,B,A
        fill_bubble(card, MAT_X[chosen], y)
        answer_key[q + QUESTIONS_PER_SUBJECT + 1] = letters[chosen]

    # Salvar cartão preenchido para debug (tmp, fora do repo)
    cv2.imwrite(str(tmp_path / "test_filled_card.png"), card)

    # 3. Processar com OMR
    result = process_image(card)
    assert result is not None, "process_image retornou None!"

    # 4. Verificar acertos
    correct = 0
    wrong = 0
    for q, expected in answer_key.items():
        got = result.answers.get(q)
        if got == expected:
            correct += 1
        else:
            wrong += 1
    assert correct >= 40, f"apenas {correct}/44 corretas (erros: {wrong}/44)"

    # 5. Testar grading
    grading = grade(result, answer_key, "0-10")
    assert grading.portugues.correct == QUESTIONS_PER_SUBJECT
    assert grading.matematica.correct == QUESTIONS_PER_SUBJECT


if __name__ == "__main__":
    import pytest as _pytest
    import sys as _sys
    _sys.exit(_pytest.main([__file__, "-q"]))
