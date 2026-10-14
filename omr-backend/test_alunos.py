"""Lista global de alunos (GET /api/alunos): agregação somente-leitura.

Fluxos cobertos:
1. Lista vazia no início; agrega alunos de várias turmas com turma_nome
2. Filtro por turma_id e busca por nome/matrícula
3. Isolamento: outro usuário não vê os alunos alheios
4. Sem token → 401/403

Executar: python -m pytest test_alunos.py -q
"""
from fastapi.testclient import TestClient

import main as main_module
from conftest import TEST_PASSWORD


def _authed(c, email="alunos@example.com"):
    r = c.post("/api/auth/register", json={"email": email, "nome": "Alunos", "password": TEST_PASSWORD})
    if r.status_code == 400:
        r = c.post("/api/auth/login", data={"username": email, "password": TEST_PASSWORD})
    assert r.status_code == 200, f"auth falhou: {r.text}"
    c.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    return c


def _outro_usuario():
    c2 = TestClient(main_module.app)
    return _authed(c2, "outro-alunos@example.com")


def _cria_turma_com_alunos(c, nome, alunos):
    t = c.post("/api/turmas", json={"nome": nome}).json()
    r = c.post(f"/api/turmas/{t['id']}/alunos/import", json={"alunos": alunos})
    assert r.status_code == 200, r.text
    return t


def test_lista_global_agrega_turmas(isolated, client):
    c = _authed(client, "alunos-lista@example.com")
    assert c.get("/api/alunos").json() == {"alunos": []}, "começa vazia"

    t1 = _cria_turma_com_alunos(c, "9º A", [
        {"nome": "Ana Beatriz Lima", "matricula": "0012"},
        {"nome": "Bruno Henrique Silva", "matricula": "0013"},
    ])
    t2 = _cria_turma_com_alunos(c, "9º B", [
        {"nome": "Carla Oliveira Santos", "matricula": "0014"},
    ])

    j = c.get("/api/alunos").json()
    assert len(j["alunos"]) == 3, j
    por_nome = {a["nome"]: a for a in j["alunos"]}
    assert por_nome["Ana Beatriz Lima"]["turma_nome"] == "9º A"
    assert por_nome["Ana Beatriz Lima"]["turma_id"] == t1["id"]
    assert por_nome["Ana Beatriz Lima"]["matricula"] == "0012"
    assert por_nome["Carla Oliveira Santos"]["turma_nome"] == "9º B"
    assert por_nome["Carla Oliveira Santos"]["turma_id"] == t2["id"]


def test_filtro_turma_e_busca(isolated, client):
    c = _authed(client, "alunos-filtro@example.com")
    t1 = _cria_turma_com_alunos(c, "8º A", [
        {"nome": "Ana Beatriz Lima", "matricula": "0012"},
        {"nome": "Bruno Henrique Silva", "matricula": "0013"},
    ])
    _cria_turma_com_alunos(c, "8º B", [{"nome": "Ana Paula", "matricula": "0099"}])

    so_turma = c.get("/api/alunos", params={"turma_id": t1["id"]}).json()["alunos"]
    assert {a["nome"] for a in so_turma} == {"Ana Beatriz Lima", "Bruno Henrique Silva"}

    busca = c.get("/api/alunos", params={"search": "ana"}).json()["alunos"]
    assert {a["nome"] for a in busca} == {"Ana Beatriz Lima", "Ana Paula"}

    por_mat = c.get("/api/alunos", params={"search": "0013"}).json()["alunos"]
    assert [a["nome"] for a in por_mat] == ["Bruno Henrique Silva"]


def test_isolamento_entre_usuarios(isolated, client):
    c = _authed(client, "alunos-dona@example.com")
    _cria_turma_com_alunos(c, "7º A", [{"nome": "Só Minha", "matricula": "0001"}])

    c2 = _outro_usuario()
    nomes = [a["nome"] for a in c2.get("/api/alunos").json()["alunos"]]
    assert "Só Minha" not in nomes, "aluno alheio fora da listagem"


def test_sem_token_recusado(isolated, client):
    # cliente fresco: o `client` do módulo carrega o Authorization dos testes
    # anteriores nos headers — aqui queremos ausência real de token.
    anon = TestClient(main_module.app)
    r = anon.get("/api/alunos")
    assert r.status_code in (401, 403), r.status_code
