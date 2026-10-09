"""Campo "Turma:" preenchido + matrícula realocada fora da caixa.

Regressões cobertas:
- o valor da prova/turma entra em TURMA_BOX sem estourar a moldura (x<=723);
- a matrícula sai da caixa Turma e para 10px antes do QR do aluno (x<=1173);
- cartão legado (sem turma) continua idêntico — só rótulo, como sempre;
- com o cabeçalho ocupado, o QR segue decodificando e o OMR lê igual.

Executar: python -m pytest test_card_turma.py -q
"""
import cv2
import numpy as np

from conftest import TEST_PASSWORD
from omr.reader import process_image
from omr.template import (
    BUBBLE_RADIUS, MATRICULA_POS, PORT_X, QR_CENTER, QR_SIZE, QUESTION_Y,
    TURMA_BOX, generate_card,
)

QR_LEFT = QR_CENTER[0] - QR_SIZE // 2
Y0, Y1 = 240, 302  # faixa vertical do cabeçalho (Turma/Matrícula)


def _text_span(img, x0, x1):
    """(x_ini, x_fim) do texto dentro da janela, ou None se não há texto.

    x0/x1 são as bordas JÁ recuadas para fora da moldura da caixa, de modo
    que o traço da moldura nunca apareça como se fosse texto.
    """
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    cols = np.where((g[Y0:Y1, x0:x1] < 160).any(axis=0))[0]
    if len(cols) == 0:
        return None
    return (x0 + int(cols.min()), x0 + int(cols.max()))


def _turma_span(img):
    return _text_span(img, 226, TURMA_BOX[2] - 2)


def _matricula_span(img):
    return _text_span(img, TURMA_BOX[2] + 2, QR_LEFT - 2)


def test_turma_valor_cabe_dentro_da_caixa():
    img = generate_card(turma="2026 - Av. Formativa 3")
    span = _turma_span(img)
    assert span is not None, "valor da turma/prova não foi impresso"
    assert span[0] >= TURMA_BOX[0] + 100, f"texto colidindo com o rótulo: {span}"
    assert span[1] <= TURMA_BOX[2] - 2, f"texto estourou a moldura: {span}"


def test_turma_longa_e_truncada_dentro_da_caixa():
    longo = "Nome de prova bem longo para testar truncamento no cabecalho"
    img = generate_card(turma=longo)
    span = _turma_span(img)
    assert span is not None
    assert span[1] <= TURMA_BOX[2] - 2, f"nome longo vazou da caixa: {span}"


def test_matricula_saiu_da_caixa_e_para_antes_do_qr():
    img = generate_card(student_matricula="12345678")
    span = _matricula_span(img)
    assert span is not None, "matrícula não foi impressa"
    assert span[0] >= TURMA_BOX[2] + 2, f"matrícula voltou para a caixa Turma: {span}"
    assert span[1] <= QR_LEFT - 2, f"matrícula invadiu o QR: {span}"


def test_matricula_longa_tambem_antes_do_qr():
    img = generate_card(student_matricula="1234567890123")
    span = _matricula_span(img)
    assert span is not None
    assert span[1] <= QR_LEFT - 2, f"matrícula de 13 dígitos invadiu o QR: {span}"


def test_cartao_legado_sem_turma_inalterado():
    """Sem turma e sem matrícula o cabeçalho fica como sempre ficou."""
    img = generate_card()
    assert _turma_span(img) is None, "valor fantasma impresso na caixa Turma"
    assert _matricula_span(img) is None, "matrícula fantasma impressa fora da caixa"


def test_qr_e_omr_continuam_com_cabecalho_ocupado():
    img = generate_card(
        turma="Recuperacao Parcial",
        student_matricula="12345678",
        student_id="OMR-2026-000001",
    )
    r = process_image(img)
    assert r is not None, "leitura falhou com o cabeçalho ocupado"
    assert r.qr_id == "OMR-2026-000001", f"QR não decodificou: {r.qr_id!r}"
    assert len(r.blank_questions) == 44, "cartão em branco deixou de ser branco"

    # 3 marcas preenchidas continuam lendo
    marcado = img.copy()
    for x, y in ((349, 653), (528, 705), (618, 758)):
        cv2.circle(marcado, (x, y), int(BUBBLE_RADIUS) - 3, (0, 0, 0), -1)
    r2 = process_image(marcado)
    assert r2.answers == {1: "A", 2: "C", 3: "D"}, r2.answers
    assert r2.duplicate_questions == []
    assert len(r2.blank_questions) == 41


def test_api_card_generate_aceita_turma(client):
    r = client.post("/api/auth/register", json={
        "email": "turma@example.com", "nome": "Turma", "password": TEST_PASSWORD})
    if r.status_code == 400:
        r = client.post("/api/auth/login",
                        data={"username": "turma@example.com", "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    client.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})

    resp = client.post("/api/card/generate", json={
        "subject_lp": "PORTUGUÊS", "subject_mat": "MATEMÁTICA",
        "format": "PNG", "turma": "Prova Bimestral de Matematica",
        "template": "padrao",
    })
    assert resp.status_code == 200, resp.text
    img = cv2.imdecode(np.frombuffer(resp.content, np.uint8), cv2.IMREAD_COLOR)
    assert img is not None, "PNG inválido"
    span = _turma_span(img)
    assert span is not None, "a API ignorou o campo turma"
    assert span[1] <= TURMA_BOX[2] - 2, f"texto estourou a moldura: {span}"


if __name__ == "__main__":
    import sys

    import pytest as _pytest
    sys.exit(_pytest.main([__file__, "-q"]))
