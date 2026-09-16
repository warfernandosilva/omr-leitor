"""
Teste end-to-end: gera cartão com bolhas preenchidas, processa e verifica.
"""
import sys
sys.path.insert(0, '.')
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


def main():
    # 1. Gerar cartão vazio
    print("1. Gerando cartao...")
    card = generate_card()

    # 2. Preencher respostas conhecidas
    print("2. Preenchendo respostas...")
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

    # Salvar cartão preenchido para debug
    cv2.imwrite("output/test_filled_card.png", card)
    print("   Cartao preenchido salvo em output/test_filled_card.png")

    # 3. Processar com OMR
    print("3. Processando com OMR...")
    result = process_image(card)

    if result is None:
        print("   ERRO: process_image retornou None!")
        sys.exit(1)

    print(f"   Respostas detectadas: {len(result.answers)}/44")
    print(f"   Em branco: {len(result.blank_questions)}")
    print(f"   Duplicadas: {len(result.duplicate_questions)}")

    # 4. Verificar acertos
    print("4. Verificando acertos...")
    correct = 0
    wrong = 0
    for q, expected in answer_key.items():
        got = result.answers.get(q)
        if got == expected:
            correct += 1
        else:
            wrong += 1
            if q <= QUESTIONS_PER_SUBJECT:
                subj = "PORT"
            else:
                subj = "MAT"
            print(f"   Q{q:2d} ({subj}): esperado={expected}, lido={got}")

    print(f"\n   Acertos: {correct}/44 ({correct/44*100:.1f}%)")
    print(f"   Erros: {wrong}/44")

    # 5. Testar grading
    print("\n5. Testando grading...")
    grading = grade(result, answer_key, "0-10")
    print(f"   Portugues: {grading.portugues.correct}/{grading.portugues.total} = {grading.portugues.grade}")
    print(f"   Matematica: {grading.matematica.correct}/{grading.matematica.total} = {grading.matematica.grade}")

    # Verificar resultado
    if correct >= 40:  # Tolerância para possíveis erros de detecção
        print("\n   TESTE PASSOU!")
    else:
        print(f"\n   TESTE FALHOU: apenas {correct}/44 corretas")
        sys.exit(1)


if __name__ == "__main__":
    main()
