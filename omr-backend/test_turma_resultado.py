"""Turma de um resultado corrigido: a do ALUNO, não a da avaliação.

Cobre a regressão "todos os alunos corrigidos ficavam em uma única turma":
uma avaliação pode atender VÁRIAS turmas (`avaliacao_turmas`) e o campo legado
`avaliacoes.turma` guarda apenas a primeira — usá-lo como "turma do resultado"
 atribuía todos os cartões da avaliação a essa turma.

Executar: python -m pytest test_turma_resultado.py -q
"""
from __future__ import annotations

from sqlalchemy import func, select

from conftest import TEST_PASSWORD
from models import Aluno, Avaliacao, AvaliacaoTurma, GabaritoNomeado
from routers.avaliacoes import alunos_da_turma, turmas_de_origem, turmas_de_varias_avaliacoes

RESPOSTAS = {str(i): "ABCD"[(i - 1) % 4] for i in range(1, 9)}


def _authed(c, email):
    r = c.post("/api/auth/register", json={"email": email, "nome": "Turma", "password": TEST_PASSWORD})
    if r.status_code == 400:
        r = c.post("/api/auth/login", data={"username": email, "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    c.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    return c


def _turma(c, nome):
    r = c.post("/api/turmas", json={"nome": nome})
    assert r.status_code == 201, r.text
    return r.json()


def _corrigir(c, codigo, nota=10.0):
    r = c.post(f"/api/gabaritos/{codigo}/resultado", json={
        "respostas": RESPOSTAS, "acertos": 8, "erros": 0, "brancos": 0,
        "nota": nota, "qr_ok": True})
    assert r.status_code == 200, r.text
    return r.json()


def _criar_cenario(c):
    """Duas turmas, uma prova e UMA avaliação atendendo as duas (multi-turma)."""
    ta = _turma(c, "Turma A")
    tb = _turma(c, "Turma B")
    c.post(f"/api/turmas/{ta['id']}/alunos/import", json={"alunos": [
        {"nome": "Ana de A", "matricula": "a1"}, {"nome": "Beto de A", "matricula": "a2"}]})
    c.post(f"/api/turmas/{tb['id']}/alunos/import", json={"alunos": [
        {"nome": "Caio de B", "matricula": "b1"}]})
    prova = c.post("/api/provas", json={"titulo": "Prova Multi", "questionsPerSubject": 4}).json()
    av = c.post("/api/avaliacoes", json={"titulo": "Avaliação Multi", "prova_id": prova["id"]}).json()
    ext = av["external_id"]
    for tid in (ta["id"], tb["id"]):
        c.post(f"/api/avaliacoes/{ext}/turmas", json={"turma_id": tid})
    c.post("/api/exams/sync", json={"external_id": ext, "titulo": ext})
    for tid in (ta["id"], tb["id"]):
        c.post(f"/api/exams/{ext}/students/from-turma", json={"turma_id": tid})
    c.post(f"/api/avaliacoes/{ext}/gabarito", json={"answer_key": RESPOSTAS})
    c.post(f"/api/exams/{ext}/gabaritos/generate")
    return ext, ta, tb


def _gabaritos_por_aluno(c, ext):
    gabs = c.get(f"/api/exams/{ext}/gabaritos").json()["gabaritos"]
    return {g["aluno"]["nome"]: g for g in gabs}


def test_resultado_traz_a_turma_do_aluno(isolated, client):
    c = _authed(client, "multiturma@example.com")
    ext, ta, tb = _criar_cenario(c)

    por_nome = _gabaritos_por_aluno(c, ext)
    _corrigir(c, por_nome["Ana de A"]["codigo_unico"], 10)
    _corrigir(c, por_nome["Caio de B"]["codigo_unico"], 6)

    res = c.get("/api/resultados").json()
    por_aluno = {r["aluno"]["nome"]: r for r in res}
    assert set(por_aluno) == {"Ana de A", "Caio de B"}, sorted(por_aluno)

    ana, caio = por_aluno["Ana de A"], por_aluno["Caio de B"]
    # turma do ALUNO (catálogo), não a primeira turma vinculada à avaliação
    assert ana["aluno"]["turma"] == "Turma A" and ana["aluno"]["turma_id"] == ta["id"]
    assert caio["aluno"]["turma"] == "Turma B" and caio["aluno"]["turma_id"] == tb["id"]
    # o nome do aluno nunca é sobrescrito pelo nome da turma
    assert ana["aluno"]["nome"] == "Ana de A" and caio["aluno"]["nome"] == "Caio de B"
    # a avaliação expõe a lista completa de turmas
    assert {t["nome"] for t in ana["avaliacao"]["turmas"]} == {"Turma A", "Turma B"}


def test_pdf_por_turma_recorta_os_alunos_da_turma(isolated, client, db_session):
    c = _authed(client, "multiturma-pdf@example.com")
    ext, ta, tb = _criar_cenario(c)
    por_nome = _gabaritos_por_aluno(c, ext)
    _corrigir(c, por_nome["Ana de A"]["codigo_unico"], 10)
    _corrigir(c, por_nome["Caio de B"]["codigo_unico"], 6)

    db = db_session()
    try:
        av = db.scalar(select(Avaliacao).where(Avaliacao.external_id == ext))
        nomes = {}
        for rotulo, turma in (("A", ta["id"]), ("B", tb["id"]), ("C", 999)):
            ids = alunos_da_turma(db, av, turma)
            nomes[rotulo] = {a.nome for a in db.scalars(
                select(Aluno).where(Aluno.id.in_(ids or [-1]))).all()}
        assert nomes["A"] == {"Ana de A", "Beto de A"}, nomes
        assert nomes["B"] == {"Caio de B"}, nomes
        assert nomes["C"] == set(), "turma que não é da avaliação não seleciona ninguém"
    finally:
        db.close()

    r = c.post("/api/relatorios/pdf", json={"avaliacao_external_id": ext, "turma_id": ta["id"]})
    assert r.status_code == 200 and r.content[:5] == b"%PDF-"


def test_helpers_de_turma_em_lote(isolated, client, db_session):
    c = _authed(client, "multiturma-lote@example.com")
    ext, ta, _ = _criar_cenario(c)
    for g in c.get(f"/api/exams/{ext}/gabaritos").json()["gabaritos"]:
        _corrigir(c, g["codigo_unico"], 8)

    db = db_session()
    try:
        av = db.scalar(select(Avaliacao).where(Avaliacao.external_id == ext))
        vinculos = db.scalars(
            select(AvaliacaoTurma).where(AvaliacaoTurma.avaliacao_id == av.id)).all()
        assert [v.turma_id for v in vinculos] == [ta["id"], _outra_turma(db, av.id, ta["id"])]
        assert db.scalar(select(func.count()).select_from(AvaliacaoTurma)) >= 2

        gabs = db.scalars(select(GabaritoNomeado).where(GabaritoNomeado.avaliacao_id == av.id)).all()
        por_aluno = turmas_de_origem(db, [g.aluno_id for g in gabs])
        por_avaliacao = turmas_de_varias_avaliacoes(db, [av.id])
        assert por_avaliacao[av.id] == [
            {"id": ta["id"], "nome": "Turma A"},
            {"id": _outra_turma(db, av.id, ta["id"]), "nome": "Turma B"},
        ]
        for g in gabs:
            esperado = "Turma A" if g.aluno.nome.endswith("de A") else "Turma B"
            assert por_aluno[g.aluno_id]["nome"] == esperado, g.aluno.nome
    finally:
        db.close()


def _outra_turma(db, avaliacao_id, nao_eh_id):
    return db.scalar(
        select(func.min(AvaliacaoTurma.turma_id)).where(
            AvaliacaoTurma.avaliacao_id == avaliacao_id,
            AvaliacaoTurma.turma_id != nao_eh_id,
        ))


def test_sem_origem_cai_na_turma_unica_da_avaliacao(isolated, client, db_session):
    """Aluno importado por XLSX (sem catálogo) herda a turma única da avaliação."""
    c = _authed(client, "xlsx-direto@example.com")
    t = _turma(c, "Turma Unica")
    c.post(f"/api/turmas/{t['id']}/alunos/import", json={"alunos": [
        {"nome": "Dani do XLSX", "matricula": "x1"}]})
    prova = c.post("/api/provas", json={"titulo": "Prova XLSX", "questionsPerSubject": 4}).json()
    av = c.post("/api/avaliacoes", json={"titulo": "Sem catalago", "prova_id": prova["id"],
                                         "turma_ids": [t["id"]]}).json()
    ext = av["external_id"]
    c.post("/api/exams/sync", json={"external_id": ext, "titulo": ext})
    # alunos direto por XLSX (sem from-turma) → sem origem no catálogo
    r = c.post(f"/api/exams/{ext}/students/import", json={"alunos": [
        {"nome": "Elena do XLSX", "matricula": "x2"}]})
    assert r.status_code == 200, r.text
    c.post(f"/api/avaliacoes/{ext}/gabarito", json={"answer_key": RESPOSTAS})
    c.post(f"/api/exams/{ext}/gabaritos/generate")
    g = c.get(f"/api/exams/{ext}/gabaritos").json()["gabaritos"][0]
    _corrigir(c, g["codigo_unico"], 9)

    res = c.get("/api/resultados").json()
    assert res, "resultado publicado"
    assert res[0]["aluno"]["nome"] == "Elena do XLSX", res[0]["aluno"]
    assert res[0]["aluno"]["turma"] == "Turma Unica", res[0]["aluno"]