"""Relatórios em PDF: turma/avaliação e boletim do aluno.

Executar: python -m pytest test_relatorios_pdf.py -q
"""
from __future__ import annotations

import re

from conftest import TEST_PASSWORD


def _authed(c, email="rel-pdf@example.com"):
    r = c.post("/api/auth/register", json={"email": email, "nome": "Rel", "password": TEST_PASSWORD})
    if r.status_code == 400:
        r = c.post("/api/auth/login", data={"username": email, "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    c.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    return c


def _cria_turma(c, nome="9º A"):
    r = c.post("/api/turmas", json={"nome": nome})
    assert r.status_code == 201, r.text
    return r.json()


def _setup_correcao(c):
    """Turma + prova + alunos + cartões + resultados corrigidos."""
    t = _cria_turma(c)
    c.post(f"/api/turmas/{t['id']}/alunos/import", json={"alunos": [
        {"nome": "Ana Aluna", "matricula": "1"},
        {"nome": "Beto Aluno", "matricula": "2"},
        {"nome": "Caio Aluno", "matricula": "3"},
    ]})
    prova = c.post("/api/provas", json={
        "titulo": "Prova PDF", "subjectLP": "MATEMÁTICA", "subjectMat": "MATEMÁTICA",
        "questionsPerSubject": 5, "gradeScale": "0-10",
    }).json()
    av = c.post("/api/avaliacoes", json={"titulo": "Avaliação PDF", "prova_id": prova["id"],
                                         "turma_ids": [t["id"]]}).json()
    ext = av["external_id"]
    c.post("/api/exams/sync", json={"external_id": ext, "titulo": "Avaliação PDF", "turma_id": t["id"]})
    c.post(f"/api/exams/{ext}/students/from-turma", json={"turma_id": t["id"]})
    c.post(f"/api/avaliacoes/{ext}/gabarito", json={"answer_key": {
        str(i): "A" for i in range(1, 6)}})
    c.post(f"/api/exams/{ext}/gabaritos/generate")

    gabaritos = c.get(f"/api/exams/{ext}/gabaritos").json()["gabaritos"]
    for i, g in enumerate(gabaritos):
        acertos = 5 - i          # notas 1.0, 0.8, 0.6
        c.post(f"/api/gabaritos/{g['codigo_unico']}/resultado", json={
            "respostas": {str(q): "A" for q in range(1, acertos + 1)},
            "acertos": acertos, "erros": 0, "brancos": 5 - acertos,
            "nota": acertos, "observacoes": None,
        })
    return ext, prova


def test_pdf_relatorio_da_turma(isolated, client):
    c = _authed(client, "relpdf-turma@example.com")
    ext, _ = _setup_correcao(c)

    r = c.post("/api/relatorios/pdf", json={"avaliacao_external_id": ext, "tipo": "turma"})
    assert r.status_code == 200, r.text
    assert r.content[:5] == b"%PDF-", "conteúdo é PDF"
    assert len(r.content) > 2000, f"PDF com conteúdo: {len(r.content)} bytes"
    assert "relatorio_" in r.headers.get("content-disposition", ""), "nome do arquivo"
    # O PDF do ReportLab guarda os textos comprimidos; o título fica legível.
    assert b"Relat" in r.content or b"desempenho" in r.content, "título presente"


def test_pdf_boletim_do_aluno(isolated, client):
    c = _authed(client, "relpdf-aluno@example.com")
    ext, _ = _setup_correcao(c)

    alunos = c.get(f"/api/exams/{ext}/students").json()
    alvo = alunos[0]

    r = c.post("/api/relatorios/pdf", json={
        "avaliacao_external_id": ext, "tipo": "aluno", "aluno_id": alvo["aluno_id"],
    })
    assert r.status_code == 200, r.text
    assert r.content[:5] == b"%PDF-"
    assert "boletim_" in r.headers.get("content-disposition", ""), "nome do boletim"


def test_pdf_sem_cartao_corrigido_ainda_gera(isolated, client):
    """Avaliação sem correção: PDF nasce vazio, mas não quebra."""
    c = _authed(client, "relpdf-vazio@example.com")
    t = _cria_turma(c)
    prova = c.post("/api/provas", json={"titulo": "Prova Vazia"}).json()
    av = c.post("/api/avaliacoes", json={"titulo": "Sem correções", "prova_id": prova["id"],
                                         "turma_ids": [t["id"]]}).json()

    r = c.post("/api/relatorios/pdf", json={"avaliacao_external_id": av["external_id"]})
    assert r.status_code == 200, r.text
    assert r.content[:5] == b"%PDF-"


def test_pdf_avaliacao_inexistente_404(isolated, client):
    c = _authed(client, "relpdf-404@example.com")
    r = c.post("/api/relatorios/pdf", json={"avaliacao_external_id": "nao-existe"})
    assert r.status_code == 404, r.text


def test_pdf_de_outro_usuario_403(isolated, client):
    c = _authed(client, "relpdf-dono@example.com")
    ext, _ = _setup_correcao(c)

    from fastapi.testclient import TestClient
    import main as main_module
    c2 = TestClient(main_module.app)
    _authed(c2, "relpdf-intruso@example.com")
    r = c2.post("/api/relatorios/pdf", json={"avaliacao_external_id": ext})
    assert r.status_code == 403, r.text
