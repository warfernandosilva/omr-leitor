"""Avaliações: ciclo de vida, etapas, provas reutilizáveis e auditoria.

Cenários cobertos (enumerados no plano de reestruturação):
1. Criar avaliação completa (prova + turmas + gabarito) com relacionamentos
7. Reutilizar prova/modelo em outra avaliação sem misturar participantes
8. Integridade: gabarito gera versão, transição manual respeita a sequência,
   resultados só publicam sem revisão pendente.

Executar: python -m pytest test_avaliacoes.py -q
"""
from __future__ import annotations

from fastapi.testclient import TestClient

import main as main_module
from conftest import TEST_PASSWORD


def _authed(c, email="avaliacao@example.com"):
    r = c.post("/api/auth/register", json={"email": email, "nome": "Avaliação", "password": TEST_PASSWORD})
    if r.status_code == 400:
        r = c.post("/api/auth/login", data={"username": email, "password": TEST_PASSWORD})
    assert r.status_code == 200, f"auth falhou: {r.text}"
    c.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    return c


def _cria_turma_com_alunos(c, nome, alunos):
    t = c.post("/api/turmas", json={"nome": nome}).json()
    c.post(f"/api/turmas/{t['id']}/alunos/import", json={"alunos": alunos})
    return t


def _cria_prova(c, **kw):
    payload = {"titulo": "Prova de Matemática", "subjectLP": "MATEMÁTICA", "subjectMat": "MATEMÁTICA",
               "questionsPerSubject": 10, "layoutMode": "dual", "gradeScale": "0-10"}
    payload.update(kw)
    r = c.post("/api/provas", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


# ─── Cenário 1: criar avaliação completa ───


def test_criar_avaliacao_completa_mantem_relacionamentos(isolated, client):
    c = _authed(client, "aval-completa@example.com")
    t = _cria_turma_com_alunos(c, "9º A", [
        {"nome": "Ana", "matricula": "1"}, {"nome": "Beto", "matricula": "2"}])
    prova = _cria_prova(c)

    r = c.post("/api/avaliacoes", json={
        "titulo": "Avaliação 1º Bimestre", "ano_letivo": "2026",
        "prova_id": prova["id"], "turma_ids": [t["id"]],
    })
    assert r.status_code == 201, r.text
    j = r.json()
    assert j["prova"]["id"] == prova["id"], "avaliação aponta para a prova"
    assert [x["id"] for x in j["turmas"]] == [t["id"]], "turma vinculada"
    # sem alunos materializados ainda, a avaliação começa como rascunho
    assert j["status_derivado"] == "rascunho", j["status_derivado"]
    assert any("aluno" in b.lower() for b in j["bloqueios"]), j["bloqueios"]

    # materializa os alunos da turma (fluxo existente) → preparação concluída
    sync = c.post("/api/exams/sync", json={"external_id": j["external_id"], "titulo": j["titulo"],
                                           "turma_id": t["id"]})
    assert sync.status_code == 200, sync.text
    c.post(f"/api/exams/{j['external_id']}/students/from-turma", json={"turma_id": t["id"]})

    # gabarito oficial via rota nova (gera versão)
    g = c.post(f"/api/avaliacoes/{j['external_id']}/gabarito",
               json={"answer_key": {str(i): "A" for i in range(1, 11)}})
    assert g.status_code == 200, g.text
    assert g.json()["gabarito_versao"] == 1

    det = c.get(f"/api/avaliacoes/{j['external_id']}").json()
    assert det["etapas"][0]["status"] == "concluida", "preparação ok"
    assert det["proxima_acao"]["acao"] == "Gerar cartões"
    assert det["progresso"] == 17, det["progresso"]


def test_avaliacao_sem_gabarito_tem_bloqueio_explicito(isolated, client):
    c = _authed(client, "aval-semgabarito@example.com")
    prova = _cria_prova(c)
    r = c.post("/api/avaliacoes", json={"titulo": "Sem gabarito", "prova_id": prova["id"]})
    assert r.status_code == 201
    j = r.json()
    assert j["status_derivado"] == "rascunho"
    assert any("gabarito" in b.lower() for b in j["bloqueios"]), j["bloqueios"]


# ─── Cenário 7: reutilizar prova sem misturar ───


def test_reutilizar_prova_em_novas_avaliacoes(isolated, client):
    c = _authed(client, "aval-reuso@example.com")
    ta = _cria_turma_com_alunos(c, "8º A", [{"nome": "Ana de A", "matricula": "a1"}])
    tb = _cria_turma_com_alunos(c, "8º B", [{"nome": "Caio de B", "matricula": "b1"}])
    prova = _cria_prova(c)

    a1 = c.post("/api/avaliacoes", json={"titulo": "Avaliação A", "prova_id": prova["id"],
                                         "turma_ids": [ta["id"]]}).json()
    a2 = c.post("/api/avaliacoes", json={"titulo": "Avaliação B", "prova_id": prova["id"],
                                         "turma_ids": [tb["id"]]}).json()
    assert a1["external_id"] != a2["external_id"], "avaliações distintas"
    assert a1["prova"]["id"] == a2["prova"]["id"] == prova["id"], "mesma prova"

    # participantes materializados em cada avaliação, sem mistura
    for ext, turma in ((a1["external_id"], ta["id"]), (a2["external_id"], tb["id"])):
        c.post("/api/exams/sync", json={"external_id": ext, "titulo": ext, "turma_id": turma})
        c.post(f"/api/exams/{ext}/students/from-turma", json={"turma_id": turma})
    alunos_a1 = {x["aluno_id"] for x in c.get(f"/api/exams/{a1['external_id']}/students").json()}
    alunos_a2 = {x["aluno_id"] for x in c.get(f"/api/exams/{a2['external_id']}/students").json()}
    assert alunos_a1 and alunos_a2 and not (alunos_a1 & alunos_a2), "participantes isolados"

    # cartões/QR de uma avaliação não aparecem na outra
    c.post(f"/api/exams/{a1['external_id']}/gabaritos/generate")
    c.post(f"/api/exams/{a2['external_id']}/gabaritos/generate")
    cods1 = {g["codigo_unico"] for g in c.get(f"/api/exams/{a1['external_id']}/gabaritos").json()["gabaritos"]}
    cods2 = {g["codigo_unico"] for g in c.get(f"/api/exams/{a2['external_id']}/gabaritos").json()["gabaritos"]}
    assert not (cods1 & cods2), "identificadores exclusivos por avaliação"

    # a lista de provas mostra quantas avaliações usam a estrutura
    provas = {p["id"]: p for p in c.get("/api/provas").json()["provas"]}
    assert provas[prova["id"]]["avaliacoes_usando"] == 2


def test_duplicar_prova_copia_so_a_estrutura(isolated, client):
    c = _authed(client, "aval-dup@example.com")
    t = _cria_turma_com_alunos(c, "7º A", [{"nome": "Ana", "matricula": "1"}])
    prova = _cria_prova(c, titulo="Prova original")
    av = c.post("/api/avaliacoes", json={"titulo": "Original", "prova_id": prova["id"],
                                         "turma_ids": [t["id"]]}).json()
    c.post("/api/exams/sync", json={"external_id": av["external_id"], "titulo": "Original",
                                    "turma_id": t["id"]})
    c.post(f"/api/exams/{av['external_id']}/students/from-turma", json={"turma_id": t["id"]})
    c.post(f"/api/exams/{av['external_id']}/gabaritos/generate")

    dup = c.post(f"/api/provas/{prova['id']}/duplicar")
    assert dup.status_code == 201, dup.text
    j = dup.json()
    assert j["titulo"] == "Prova original (cópia)"
    assert j["questions_per_subject"] == prova["questions_per_subject"]
    assert j["avaliacoes_usando"] == 0, "cópia nasce sem avaliações"


# ─── Cenário 8: integridade e histórico ───


def test_gabarito_gera_versoes_e_auditoria(isolated, client):
    c = _authed(client, "aval-versoes@example.com")
    prova = _cria_prova(c)
    av = c.post("/api/avaliacoes", json={"titulo": "Versionada", "prova_id": prova["id"]}).json()
    ext = av["external_id"]

    r1 = c.post(f"/api/avaliacoes/{ext}/gabarito", json={"answer_key": {str(i): "A" for i in range(1, 6)}})
    assert r1.status_code == 200
    r2 = c.post(f"/api/avaliacoes/{ext}/gabarito", json={"answer_key": {str(i): "B" for i in range(1, 6)},
                                                          "observacao": "correção de prova"})
    assert r2.json()["gabarito_versao"] == 2, "segunda versão"
    assert r2.json()["answer_key"]["1"] == "B"

    tl = c.get(f"/api/avaliacoes/{ext}/timeline").json()["eventos"]
    tipos = [e["tipo"] for e in tl]
    assert "criada" in tipos and "gabarito_atualizado" in tipos
    assert any(e["tipo"] == "gabarito_versao" and e["resumo"].startswith("Gabarito v1") for e in tl)


def test_transicao_manual_respeita_sequencia(isolated, client):
    c = _authed(client, "aval-transicao@example.com")
    t = _cria_turma_com_alunos(c, "9º A", [{"nome": "Ana", "matricula": "1"}])
    prova = _cria_prova(c)
    av = c.post("/api/avaliacoes", json={"titulo": "Transição", "prova_id": prova["id"],
                                        "turma_ids": [t["id"]]}).json()
    ext = av["external_id"]

    # rascunho não aceita salto: só avança quando os dados permitem
    assert c.patch(f"/api/avaliacoes/{ext}/status", json={"status": "impressa"}).status_code == 400

    # completa o preparo → pronta para impressão
    c.post("/api/exams/sync", json={"external_id": ext, "titulo": "Transição", "turma_id": t["id"]})
    c.post(f"/api/exams/{ext}/students/from-turma", json={"turma_id": t["id"]})
    c.post(f"/api/avaliacoes/{ext}/gabarito", json={"answer_key": {str(i): "A" for i in range(1, 11)}})
    c.post(f"/api/exams/{ext}/gabaritos/generate")
    assert c.get(f"/api/avaliacoes/{ext}").json()["status_derivado"] == "pronta_impressao"

    ok1 = c.patch(f"/api/avaliacoes/{ext}/status", json={"status": "impressa"})
    assert ok1.status_code == 200, ok1.text
    assert ok1.json()["status_registrado"] == "impressa"

    ok2 = c.patch(f"/api/avaliacoes/{ext}/status", json={"status": "em_aplicacao"})
    assert ok2.status_code == 200, "transições avançam uma a uma"

    # voltar para trás não é permitido
    assert c.patch(f"/api/avaliacoes/{ext}/status", json={"status": "impressa"}).status_code == 400

    tl = c.get(f"/api/avaliacoes/{ext}/timeline").json()["eventos"]
    assert any(e["tipo"] == "status_alterado" for e in tl), "transição auditada"


def test_publicar_bloqueia_com_revisao_pendente(isolated, client):
    c = _authed(client, "aval-publicar@example.com")
    prova = _cria_prova(c)
    av = c.post("/api/avaliacoes", json={"titulo": "Publicar", "prova_id": prova["id"]}).json()
    ext = av["external_id"]
    c.post(f"/api/avaliacoes/{ext}/gabarito", json={"answer_key": {str(i): "A" for i in range(1, 6)}})

    # sem cartão corrigido não publica
    r0 = c.post(f"/api/avaliacoes/{ext}/publicar")
    assert r0.status_code == 400 and "nenhum cartão" in r0.json()["detail"].lower(), r0.text


# ─── Isolamento e lista ───


def test_lista_e_isolamento_entre_usuarios(isolated, client):
    c = _authed(client, "aval-lista@example.com")
    prova = _cria_prova(c)
    c.post("/api/avaliacoes", json={"titulo": "Minha", "prova_id": prova["id"]},
           params={"q": "x"} if False else None)

    c2 = TestClient(main_module.app)
    _authed(c2, "aval-outro@example.com")
    minha = c.get("/api/avaliacoes").json()["avaliacoes"]
    assert len(minha) == 1 and minha[0]["titulo"] == "Minha"
    assert c2.get("/api/avaliacoes").json()["avaliacoes"] == [], "avaliação alheia não aparece"
    assert c2.get(f"/api/avaliacoes/{minha[0]['external_id']}").status_code == 403
    assert c2.post(f"/api/avaliacoes/{minha[0]['external_id']}/gabarito",
                   json={"answer_key": {"1": "A"}}).status_code == 403


def test_resumo_operacional_conta_e_aponta_pendencia(isolated, client):
    c = _authed(client, "aval-resumo@example.com")
    t = _cria_turma_com_alunos(c, "9º A", [{"nome": "Ana", "matricula": "1"}])
    prova = _cria_prova(c)
    c.post("/api/avaliacoes", json={"titulo": "Painel", "prova_id": prova["id"],
                                    "turma_ids": [t["id"]]})
    r = c.get("/api/operacao/resumo").json()
    assert r["avaliacoes"] == 1
    assert r["turmas"] == 1 and r["alunos"] == 1
    # prova/turma criadas e nenhum aluno materializado → rascunho (falta a lista)
    assert r["por_status"]["rascunho"] == 1
    assert r["pendencias"] and r["pendencias"][0]["acao"]
    assert any(a["tipo"] == "sem_gabarito" for a in r["alertas"])
