"""Turmas: catálogo reutilizável de alunos + materialização em provas.

Fluxos cobertos:
1. CRUD de turma (criar, listar, ler, renomear, apagar) + 400/403/404
2. Import para o catálogo com dedup por matrícula (upsert; sem matrícula cria)
3. Materialização from-turma: cópia idempotente, vínculo turma_id + rótulo turma
4. Apagar turma NÃO apaga alunos/gabaritos das provas (só desvincula)
5. sync com turma_id vincula e carimba o rótulo; sync sem turma_id desvincula
6. Backup roundtrip inclui turmas/turma_alunos + turma_id da avaliação
7. _ensure_column migra banco antigo (sem turma_id) sem perder dados

Executar: python -m pytest test_turmas.py -q
"""
from fastapi.testclient import TestClient

import main as main_module
from conftest import TEST_PASSWORD


def _authed(c, email="turma@example.com"):
    r = c.post("/api/auth/register", json={"email": email, "nome": "Turma", "password": TEST_PASSWORD})
    if r.status_code == 400:
        r = c.post("/api/auth/login", data={"username": email, "password": TEST_PASSWORD})
    assert r.status_code == 200, f"auth falhou: {r.text}"
    c.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    return c


def _outro_usuario():
    c2 = TestClient(main_module.app)
    return _authed(c2, "outro@example.com")


def _cria_turma(c, nome="9º A"):
    r = c.post("/api/turmas", json={"nome": nome})
    assert r.status_code == 201, r.text
    return r.json()


def test_crud_turma(isolated, client):
    c = _authed(client)
    t = _cria_turma(c, "9º A")
    assert t["nome"] == "9º A" and t["total_alunos"] == 0

    lst = c.get("/api/turmas")
    assert lst.status_code == 200, lst.text
    assert any(x["id"] == t["id"] for x in lst.json()["turmas"]), "turma listada"

    det = c.get(f"/api/turmas/{t['id']}")
    assert det.status_code == 200 and det.json()["alunos"] == [], det.text

    ren = c.patch(f"/api/turmas/{t['id']}", json={"nome": "9º B"})
    assert ren.status_code == 200 and ren.json()["nome"] == "9º B", ren.text

    bad = c.post("/api/turmas", json={"nome": "   "})
    assert bad.status_code == 400, "nome vazio → 400"

    missing = c.get("/api/turmas/999999")
    assert missing.status_code == 404, "turma inexistente → 404"

    dele = c.delete(f"/api/turmas/{t['id']}")
    assert dele.status_code == 200, dele.text
    assert c.get(f"/api/turmas/{t['id']}").status_code == 404, "apagada some do GET"


def test_turma_isolamento_entre_usuarios(isolated, client):
    c = _authed(client)
    t = _cria_turma(c, "8º C")
    c2 = _outro_usuario()

    assert c2.get(f"/api/turmas/{t['id']}").status_code == 403, "outro usuário → 403"
    assert c2.delete(f"/api/turmas/{t['id']}").status_code == 403
    ids = [x["id"] for x in c2.get("/api/turmas").json()["turmas"]]
    assert t["id"] not in ids, "turma alheia fora da listagem"


def test_import_dedup_por_matricula(isolated, client):
    c = _authed(client)
    t = _cria_turma(c, "7º A")
    lote = {"alunos": [
        {"nome": "Ana", "matricula": "1"},
        {"nome": "Beto", "matricula": "2"},
        {"nome": "Sem Matrícula"},
    ]}
    r1 = c.post(f"/api/turmas/{t['id']}/alunos/import", json=lote)
    assert r1.status_code == 200, r1.text
    j1 = r1.json()
    assert (j1["criados"], j1["atualizados"], j1["ignorados"]) == (3, 0, 0), j1
    assert j1["total_alunos"] == 3

    # reimport: matrículas repetidas ATUALIZAM, novas criam
    r2 = c.post(f"/api/turmas/{t['id']}/alunos/import", json={"alunos": [
        {"nome": "Ana Souza", "matricula": "1"},
        {"nome": "Beto Santos", "matricula": "2"},
        {"nome": "Caio", "matricula": "3"},
        {"nome": "Sem Matrícula"},  # sem matrícula: sempre cria (legado)
        {"nome": "   "},  # sem nome: ignorada
    ]})
    assert r2.status_code == 200, r2.text
    j2 = r2.json()
    assert (j2["criados"], j2["atualizados"], j2["ignorados"]) == (2, 2, 1), j2
    assert j2["total_alunos"] == 5, j2

    nomes = sorted(a["nome"] for a in c.get(f"/api/turmas/{t['id']}").json()["alunos"])
    assert nomes == ["Ana Souza", "Beto Santos", "Caio", "Sem Matrícula", "Sem Matrícula"], nomes


def test_from_turma_materializa_e_idempotente(isolated, client, db_session):
    c = _authed(client)
    t = _cria_turma(c, "6º A")
    c.post(f"/api/turmas/{t['id']}/alunos/import", json={"alunos": [
        {"nome": "Alfa", "matricula": "10"},
        {"nome": "Beta", "matricula": "11"},
        {"nome": "Gama"},  # sem matrícula: idempotência vem da proveniência
    ]})
    catalogo_ids = {a["id"] for a in c.get(f"/api/turmas/{t['id']}").json()["alunos"]}

    sync = c.post("/api/exams/sync", json={"external_id": "ex-turma-1", "titulo": "Prova 1"})
    assert sync.status_code == 200, sync.text

    m1 = c.post("/api/exams/ex-turma-1/students/from-turma", json={"turma_id": t["id"]})
    assert m1.status_code == 200, m1.text
    j1 = m1.json()
    assert (j1["materializados"], j1["reaproveitados"], j1["total_alunos"]) == (3, 0, 3), j1

    # segunda chamada: tudo reaproveitado, nada duplicado (nem o sem-matrícula)
    m2 = c.post("/api/exams/ex-turma-1/students/from-turma", json={"turma_id": t["id"]})
    j2 = m2.json()
    assert (j2["materializados"], j2["reaproveitados"], j2["total_alunos"]) == (0, 3, 3), j2

    # proveniência gravada: cada Aluno aponta para seu TurmaAluno de origem
    from models import Aluno
    db = db_session()
    try:
        origens = {a.origem_turma_aluno_id for a in
                   db.query(Aluno).filter_by(avaliacao_id=j1["avaliacao_id"]).all()}
    finally:
        db.close()
    assert origens == catalogo_ids, f"proveniência exata: {origens} vs {catalogo_ids}"

    # vínculo + rótulo na prova
    ex = c.get("/api/exams/ex-turma-1").json()
    assert ex["turma"] == "6º A" and ex["turma_id"] == t["id"], ex

    # gabaritos saem 1:1 com os alunos materializados
    gen = c.post("/api/exams/ex-turma-1/gabaritos/generate")
    assert gen.status_code == 200, gen.text
    assert gen.json()["total_gabaritos"] == 3


def test_gerar_da_turma_nao_mistura_outras_turmas(isolated, client):
    """Trocar de turma não pode imprimir nomes da turma anterior.

    Reproduz a tela "Cartões por lista": a prova já tinha alunos da turma A;
    ao gerar pela turma B, só os alunos de B entram no lote/PDF.
    """
    c = _authed(client)
    ta = _cria_turma(c, "Turma A")
    tb = _cria_turma(c, "Turma B")
    c.post(f"/api/turmas/{ta['id']}/alunos/import", json={"alunos": [
        {"nome": "Ana de A", "matricula": "a1"},
        {"nome": "Beto de A", "matricula": "a2"},
    ]})
    c.post(f"/api/turmas/{tb['id']}/alunos/import", json={"alunos": [
        {"nome": "Caio de B", "matricula": "b1"},
    ]})
    c.post("/api/exams/sync", json={"external_id": "ex-turma-mix", "titulo": "Mix"})

    # 1ª geração: turma A (sem filtro = todos os alunos da prova)
    c.post("/api/exams/ex-turma-mix/students/from-turma", json={"turma_id": ta["id"]})
    gen_a = c.post("/api/exams/ex-turma-mix/gabaritos/generate")
    assert gen_a.json()["total_gabaritos"] == 2

    # troca para a turma B e gera SÓ a turma B
    c.post("/api/exams/ex-turma-mix/students/from-turma", json={"turma_id": tb["id"]})
    gen_b = c.post(f"/api/exams/ex-turma-mix/gabaritos/generate?turma_id={tb['id']}")
    assert gen_b.status_code == 200, gen_b.text
    j = gen_b.json()
    assert j["total_alunos"] == 1 and j["total_gabaritos"] == 1, j
    assert [g["aluno"]["nome"] for g in j["gabaritos"]] == ["Caio de B"], j

    # PDF filtrado: 1 página (apenas a turma B)
    pdf = c.post(f"/api/exams/ex-turma-mix/gabaritos/pdf?turma_id={tb['id']}")
    assert pdf.status_code == 200, pdf.text
    pages = pdf.content.count(b"/Type /Page") - pdf.content.count(b"/Type /Pages")
    assert pages == 1, f"PDF da turma B deve ter 1 página, veio {pages}"

    # lista filtrada: só B (painel de conclusão)
    lst = c.get(f"/api/exams/ex-turma-mix/gabaritos?turma_id={tb['id']}")
    assert lst.status_code == 200, lst.text
    nomes = [g["aluno"]["nome"] for g in lst.json()["gabaritos"]]
    assert nomes == ["Caio de B"], nomes

    # sem filtro, o comportamento legado continua: os 3 alunos
    assert c.get("/api/exams/ex-turma-mix/gabaritos").json()["stats"]["gabaritos_gerados"] == 3


def test_from_turma_vazia_ou_inexistente(isolated, client):
    c = _authed(client)
    c.post("/api/exams/sync", json={"external_id": "ex-turma-vazia", "titulo": "V"})
    t = _cria_turma(c, "Vazia")
    r = c.post("/api/exams/ex-turma-vazia/students/from-turma", json={"turma_id": t["id"]})
    assert r.status_code == 400, f"turma sem alunos → 400: {r.text}"
    r2 = c.post("/api/exams/ex-turma-vazia/students/from-turma", json={"turma_id": 999999})
    assert r2.status_code == 404, "turma inexistente → 404"


def test_delete_turma_preserva_provas(isolated, client):
    c = _authed(client)
    t = _cria_turma(c, "5º A")
    c.post(f"/api/turmas/{t['id']}/alunos/import", json={"alunos": [{"nome": "Uno", "matricula": "1"}]})
    c.post("/api/exams/sync", json={"external_id": "ex-turma-del", "titulo": "P"})
    c.post("/api/exams/ex-turma-del/students/from-turma", json={"turma_id": t["id"]})
    c.post("/api/exams/ex-turma-del/gabaritos/generate")

    dele = c.delete(f"/api/turmas/{t['id']}")
    assert dele.status_code == 200 and dele.json()["alunos_removidos"] == 1, dele.text

    ex = c.get("/api/exams/ex-turma-del").json()
    assert ex["turma_id"] is None, "desvincula"
    assert ex["turma"] == "5º A", "rótulo impresso permanece"
    assert ex["total_alunos"] == 1, "alunos da prova intactos"
    gabs = c.get("/api/exams/ex-turma-del/gabaritos").json()
    assert gabs["stats"]["gabaritos_gerados"] == 1, "gabaritos intactos"


def test_sync_com_turma_id(isolated, client):
    c = _authed(client)
    t = _cria_turma(c, "4º A")

    s1 = c.post("/api/exams/sync", json={
        "external_id": "ex-turma-sync", "titulo": "S", "turma_id": t["id"]})
    assert s1.status_code == 200, s1.text
    j1 = s1.json()
    assert j1["turma"] == "4º A" and j1["turma_id"] == t["id"], j1

    # sync sem turma_id desvincula (mesma semântica overwrite do campo turma)
    s2 = c.post("/api/exams/sync", json={"external_id": "ex-turma-sync", "titulo": "S"})
    j2 = s2.json()
    assert j2["turma"] is None and j2["turma_id"] is None, j2

    s3 = c.post("/api/exams/sync", json={
        "external_id": "ex-turma-sync", "titulo": "S", "turma_id": 999999})
    assert s3.status_code == 404, "turma_id inexistente → 404"


def test_sync_turma_id_de_outro_usuario_403(isolated, client):
    c = _authed(client)
    t = _cria_turma(c, "Minha")
    c2 = _outro_usuario()
    c2.post("/api/exams/sync", json={"external_id": "ex-alheia", "titulo": "X"})
    r = c2.post("/api/exams/ex-alheia/students/from-turma", json={"turma_id": t["id"]})
    assert r.status_code == 403, f"materializar turma alheia → 403: {r.text}"


def test_backup_inclui_turmas(isolated, client, db_session):
    c = _authed(client)
    t = _cria_turma(c, "3º A")
    c.post(f"/api/turmas/{t['id']}/alunos/import", json={"alunos": [
        {"nome": "Prime", "matricula": "1"}, {"nome": "Second"}]})
    c.post("/api/exams/sync", json={"external_id": "ex-turma-bk", "titulo": "B",
                                    "turma_id": t["id"]})

    from backup import export_all, restore_all
    data = export_all()
    # DB do módulo acumula entre testes: filtra pelos meus ids (ordem-independente)
    assert [x for x in data["turmas"] if x["id"] == t["id"]], "minha turma exportada"
    assert len([x for x in data["turma_alunos"] if x["turma_id"] == t["id"]]) == 2, \
        "meus 2 alunos do catálogo exportados"
    minha_av = [x for x in data["avaliacoes"] if x["external_id"] == "ex-turma-bk"]
    assert len(minha_av) == 1 and minha_av[0]["turma_id"] == t["id"], "vínculo exportado"

    n = restore_all(data)
    assert n["turmas"] >= 1 and n["turma_alunos"] >= 2, f"restore: {n}"
    n2 = restore_all(data)
    assert n2 == n, "restore idempotente"

    # backup antigo (sem as chaves novas) restaura sem quebrar
    velho = dict(data)
    velho.pop("turmas")
    velho.pop("turma_alunos")
    n3 = restore_all(velho)
    assert n3["turmas"] == 0 and n3["turma_alunos"] == 0, f"backup legado: {n3}"


def test_ensure_column_migra_banco_antigo(tmp_path, monkeypatch):
    """Banco criado antes da feature (sem turma_id) ganha a coluna sem perder dados."""
    import database
    from sqlalchemy import create_engine

    old = tmp_path / "old.db"
    eng = create_engine(f"sqlite:///{old}")
    with eng.begin() as conn:
        conn.exec_driver_sql(
            "CREATE TABLE avaliacoes (id INTEGER PRIMARY KEY, titulo VARCHAR(200))")
        conn.exec_driver_sql("INSERT INTO avaliacoes (titulo) VALUES ('Antiga')")
    monkeypatch.setattr(database, "engine", eng)

    database._ensure_column("avaliacoes", "turma_id", "INTEGER")

    with eng.connect() as conn:
        cols = [row[1] for row in conn.exec_driver_sql("PRAGMA table_info(avaliacoes)").all()]
        assert "turma_id" in cols, f"coluna criada: {cols}"
        titulo = conn.exec_driver_sql("SELECT titulo FROM avaliacoes").scalar()
        assert titulo == "Antiga", "dados preservados"


if __name__ == "__main__":
    import pytest as _pytest
    import sys as _sys
    _sys.exit(_pytest.main([__file__, "-q"]))
