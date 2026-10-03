"""
Pareamento manual por nome (sem QR):
- GET /api/exams/{id}/students lista TODOS os alunos, inclusive sem cartao
- POST .../resultados/avulso casa o nome digitado com o aluno persistido
  (comparacao normalizada: ignora caixa, acentos e espacos)

Executar: python -m pytest test_manual_name.py -q
"""
from fastapi.testclient import TestClient

import main as main_module
from conftest import TEST_PASSWORD
from omr.names import normalize_nome


def _new_client(email: str, db_session_factory) -> TestClient:
    c = TestClient(main_module.app)
    r = c.post("/api/auth/register", json={"email": email, "nome": email, "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    r = c.post("/api/auth/login", data={"username": email, "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    c.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    return c


def _setup_exam(owner, external_id, nomes):
    r = owner.post("/api/exams/sync", json={"external_id": external_id, "titulo": external_id})
    assert r.status_code == 200, r.text
    r = owner.post(f"/api/exams/{external_id}/students/import",
                   json={"alunos": [{"nome": n} for n in nomes]})
    assert r.status_code == 200, r.text
    return r.json()


def test_normalize_nome():
    assert normalize_nome("José  da SILVA") == "jose da silva"
    assert normalize_nome("  MARIA SANTOS ") == "maria santos"
    assert normalize_nome("João-Paulo Ça") == "joao-paulo ca"
    assert normalize_nome("") == ""
    assert normalize_nome(None) == ""
    assert normalize_nome("ÉÇÃÕ") == "ecao"


def test_students_list_inclui_sem_cartao(isolated, db_session):
    owner = _new_client("lista@manual.com", db_session)
    _setup_exam(owner, "ex-manual-lista", ["Com Cartao", "Sem Cartao"])
    gen = owner.post("/api/exams/ex-manual-lista/gabaritos/generate").json()
    # importa mais um DEPOIS de gerar: fica sem cartao
    owner.post("/api/exams/ex-manual-lista/students/import", json={"alunos": [{"nome": "Tardio"}]})
    assert len(gen["gabaritos"]) == 2, f"2 cartoes gerados: {gen}"

    lst = owner.get("/api/exams/ex-manual-lista/students")
    assert lst.status_code == 200, lst.text
    rows = {s["nome"]: s for s in lst.json()}
    assert set(rows) == {"Com Cartao", "Sem Cartao", "Tardio"}, f"todos os alunos: {sorted(rows)}"
    assert rows["Com Cartao"]["tem_gabarito"] is True
    assert rows["Com Cartao"]["codigo_unico"], "com cartao tem codigo"
    assert rows["Com Cartao"]["status"] == "gerado"
    assert rows["Tardio"]["tem_gabarito"] is False
    assert rows["Tardio"]["codigo_unico"] is None
    assert rows["Tardio"]["status"] is None
    assert rows["Tardio"]["aluno_id"] > 0


def test_avulso_casa_por_nome_existente(isolated, db_session):
    owner = _new_client("casa@manual.com", db_session)
    _setup_exam(owner, "ex-manual-casa", ["Maria Santos"])
    codigo = owner.post("/api/exams/ex-manual-casa/gabaritos/generate").json()["gabaritos"][0]["codigo_unico"]

    r = owner.post("/api/exams/ex-manual-casa/resultados/avulso",
                   json={"nome": "  maria SANTOS ", "acertos": 8, "nota": 8.0})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["matched"] is True and j["created"] is False, f"casou com existente: {j}"
    assert j["gabarito"]["codigo_unico"] == codigo, "reusa o cartao impresso da aluna"
    assert j["aluno"]["nome"] == "Maria Santos", "nome canonico persistido"

    from models import Aluno, Avaliacao
    db = db_session()
    try:
        av_id = db.query(Avaliacao).filter_by(external_id="ex-manual-casa").one().id
        n = db.query(Aluno).filter_by(avaliacao_id=av_id).count()
    finally:
        db.close()
    assert n == 1, f"nao duplica aluno: n={n}"


def test_avulso_sem_match_cria_como_antes(isolated, db_session):
    owner = _new_client("cria@manual.com", db_session)
    _setup_exam(owner, "ex-manual-cria", ["Existente"])
    r = owner.post("/api/exams/ex-manual-cria/resultados/avulso",
                   json={"nome": "Totalmente Novo", "acertos": 5, "nota": 5.0})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["created"] is True and j["matched"] is False
    assert j["aluno"]["nome"] == "Totalmente Novo"

    r = owner.post("/api/exams/ex-manual-cria/resultados/avulso", json={"nome": "   "})
    assert r.status_code == 400, "nome vazio continua 400"


def test_avulso_homonimos_devolve_candidatos(isolated, db_session):
    owner = _new_client("homo@manual.com", db_session)
    _setup_exam(owner, "ex-manual-homo", ["José Silva", "JOSE  SILVA"])
    owner.post("/api/exams/ex-manual-homo/gabaritos/generate")

    r = owner.post("/api/exams/ex-manual-homo/resultados/avulso",
                   json={"nome": "José silva", "acertos": 6, "nota": 6.0})
    assert r.status_code == 409, f"homonimos → 409: {r.status_code}"
    j = r.json()
    assert j.get("ambiguous") is True, f"marca ambiguous: {j}"
    assert len(j["candidates"]) == 2, f"2 candidatos: {j}"
    assert all(c["aluno_id"] and c["codigo_unico"] for c in j["candidates"])

    # escolhe um candidato pelo aluno_id
    escolhido = j["candidates"][0]["aluno_id"]
    r = owner.post("/api/exams/ex-manual-homo/resultados/avulso",
                   params={"aluno_id": escolhido},
                   json={"nome": "qualquer coisa", "acertos": 7, "nota": 7.0})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["matched"] is True and j["aluno"]["id"] == escolhido
    assert j["gabarito"]["acertos"] == 7

    # aluno_id de outra prova/outro id → 404
    r = owner.post("/api/exams/ex-manual-homo/resultados/avulso",
                   params={"aluno_id": 999999}, json={"nome": "x"})
    assert r.status_code == 404, f"aluno inexistente → 404: {r.status_code}"


def test_avulso_match_ja_corrigido_exige_overwrite(isolated, db_session):
    owner = _new_client("conf@manual.com", db_session)
    _setup_exam(owner, "ex-manual-conf", ["Paulo Conf"])
    owner.post("/api/exams/ex-manual-conf/gabaritos/generate")
    r = owner.post("/api/exams/ex-manual-conf/resultados/avulso",
                   json={"nome": "paulo conf", "acertos": 4, "nota": 4.0})
    assert r.status_code == 200, r.text

    r = owner.post("/api/exams/ex-manual-conf/resultados/avulso",
                   json={"nome": "PAULO CONF", "acertos": 9, "nota": 9.0})
    assert r.status_code == 409, f"ja corrigido → 409: {r.status_code}"
    j = r.json()
    assert j.get("already_graded") is True and j.get("matched") is True
    assert j["previous"]["nota"] == 4.0 and j["previous"]["nome"] == "Paulo Conf"

    r = owner.post("/api/exams/ex-manual-conf/resultados/avulso",
                   params={"overwrite": True},
                   json={"nome": "paulo conf", "acertos": 9, "nota": 9.0})
    assert r.status_code == 200, r.text
    assert r.json()["gabarito"]["nota"] == 9.0, "overwrite atualiza"


def test_avulso_match_sem_cartao_cria_para_o_aluno(isolated, db_session):
    owner = _new_client("semcart@manual.com", db_session)
    _setup_exam(owner, "ex-manual-semcart", ["Com Cartao", "Sem Cartao"])
    owner.post("/api/exams/ex-manual-semcart/gabaritos/generate")
    owner.post("/api/exams/ex-manual-semcart/students/import", json={"alunos": [{"nome": "Tardio"}]})

    r = owner.post("/api/exams/ex-manual-semcart/resultados/avulso",
                   json={"nome": "tardio", "acertos": 3, "nota": 3.0})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["matched"] is True and j.get("novo_cartao") is True
    assert j["aluno"]["nome"] == "Tardio" and j["gabarito"]["codigo_unico"]

    # agora ele aparece na lista COM cartao
    rows = {s["nome"]: s for s in owner.get("/api/exams/ex-manual-semcart/students").json()}
    assert rows["Tardio"]["tem_gabarito"] is True


def test_students_e_avulso_respeitam_dono(isolated, db_session):
    owner = _new_client("dono2@manual.com", db_session)
    _setup_exam(owner, "ex-manual-priv", ["Privado"])
    stranger = _new_client("estranho2@manual.com", db_session)
    assert stranger.get("/api/exams/ex-manual-priv/students").status_code == 403, "lista alunos: estranho 403"
    r = stranger.post("/api/exams/ex-manual-priv/resultados/avulso", json={"nome": "Privado"})
    assert r.status_code == 403, f"avulso: estranho 403: {r.status_code}"
    assert owner.get("/api/exams/ex-manual-priv/students").status_code == 200, "dono lista ok"


if __name__ == "__main__":
    import pytest as _pytest
    import sys as _sys
    _sys.exit(_pytest.main([__file__, "-q"]))
