"""Cenários de aceitação do fluxo operacional (enumerados no plano).

Cada teste abaixo é um cenário do enunciado, executado ponta a ponta pela API:

1. Criar avaliação completa (prova + turma + alunos + gabarito)
2. Gerar cartões (identificação única + QR vinculado)
3. Corrigir pela câmera (leitura registrada com identificação)
4. Corrigir em lote (vários cartões, sem duplicação)
5. Revisar leitura (correção manual auditada)
6. Consultar resultados (por aluno, turma e avaliação)
7. Reutilizar prova/modelo em avaliação nova
8. Integridade e histórico (gabarito versionado, reprocessamento preservado)

Executar: python -m pytest test_aceitacao_fluxo.py -q
"""
from __future__ import annotations

from fastapi.testclient import TestClient

import main as main_module
from conftest import TEST_PASSWORD


def _authed(c, email):
    r = c.post("/api/auth/register", json={"email": email, "nome": "Aceite", "password": TEST_PASSWORD})
    if r.status_code == 400:
        r = c.post("/api/auth/login", data={"username": email, "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    c.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    return c


def _turma(c, nome, alunos):
    t = c.post("/api/turmas", json={"nome": nome}).json()
    c.post(f"/api/turmas/{t['id']}/alunos/import", json={"alunos": alunos})
    return t


def _prova(c, **kw):
    base = {"titulo": "Prova Aceite", "subjectLP": "MATEMÁTICA", "subjectMat": "MATEMÁTICA",
            "questionsPerSubject": 4, "layoutMode": "dual", "gradeScale": "0-10"}
    base.update(kw)
    return c.post("/api/provas", json=base).json()


def _avaliacao(c, titulo, prova_id, turma_id):
    return c.post("/api/avaliacoes", json={
        "titulo": titulo, "prova_id": prova_id, "turma_ids": [turma_id],
    }).json()


def _preparar(c, ext, turma_id, questoes=8):
    """Sincroniza, materializa alunos, cadastra gabarito e gera cartões."""
    c.post("/api/exams/sync", json={"external_id": ext, "titulo": ext, "turma_id": turma_id})
    c.post(f"/api/exams/{ext}/students/from-turma", json={"turma_id": turma_id})
    c.post(f"/api/avaliacoes/{ext}/gabarito",
           json={"answer_key": {str(i): "ABCD"[i % 4] for i in range(1, questoes + 1)}})
    return c.post(f"/api/exams/{ext}/gabaritos/generate").json()


def _corrigir(c, codigo, respostas, **extra):
    certo = 0
    return c.post(f"/api/gabaritos/{codigo}/resultado", json={
        "respostas": respostas, "acertos": certo, "erros": 0,
        "brancos": 8 - certo, "nota": certo, **extra,
    })


GABARITO = {str(i): "ABCD"[i % 4] for i in range(1, 9)}   # 1:A 2:B 3:C 4:D 5:A ...


# ─── Cenário 1: criar avaliação completa ───

def test_cenario1_avaliacao_completa(isolated, client):
    c = _authed(client, "c1@example.com")
    t = _turma(c, "9º A", [{"nome": f"Aluno {i}", "matricula": str(i)} for i in range(1, 6)])
    prova = _prova(c)
    av = _avaliacao(c, "Avaliação completa", prova["id"], t["id"])

    # relacionamentos
    det = c.get(f"/api/avaliacoes/{av['external_id']}").json()
    assert det["prova"]["id"] == prova["id"], "avaliação → prova"
    assert [x["id"] for x in det["turmas"]] == [t["id"]], "avaliação → turma"

    gen = _preparar(c, av["external_id"], t["id"])
    assert gen["total_alunos"] == 5 and gen["total_gabaritos"] == 5, gen

    det = c.get(f"/api/avaliacoes/{av['external_id']}").json()
    assert det["answer_key"]["1"] == "B", "gabarito oficial salvo (1:B, 2:C, 3:D, 4:A)"
    assert det["gabarito_versao"] == 1
    assert det["etapas"][0]["status"] == "concluida", "preparação pronta"
    assert det["proxima_acao"]["acao"] == "Iniciar leitura"
    # aluno vinculado a cartão e avaliação
    alunos = c.get(f"/api/exams/{av['external_id']}/students").json()
    assert len(alunos) == 5 and all(a["tem_gabarito"] for a in alunos)


# ─── Cenário 2: gerar cartões ───

def test_cenario2_cartoes_identificacao_unica(isolated, client):
    c = _authed(client, "c2@example.com")
    t = _turma(c, "9º A", [{"nome": f"Aluno {i}", "matricula": str(i)} for i in range(1, 6)])
    prova = _prova(c)
    av = _avaliacao(c, "Cartões", prova["id"], t["id"])
    _preparar(c, av["external_id"], t["id"])

    gabaritos = c.get(f"/api/exams/{av['external_id']}/gabaritos").json()["gabaritos"]
    codigos = [g["codigo_unico"] for g in gabaritos]
    payloads = [g["qr_code_payload"] for g in gabaritos]
    assert len(set(codigos)) == len(codigos), "código único por cartão"
    assert set(codigos) == set(payloads), "QR = código impresso"

    # cada código resolve para o aluno certo DESTA avaliação
    for g in gabaritos:
        look = c.get(f"/api/gabaritos/{g['codigo_unico']}/lookup").json()
        assert look["found"] is True, look
        assert look["avaliacao"]["external_id"] == av["external_id"], "QR amarrado à avaliação"
        assert look["aluno"]["id"] == g["aluno"]["id"], "QR amarrado ao aluno"

    # reimprimir não cria vínculo novo
    gen2 = c.post(f"/api/exams/{av['external_id']}/gabaritos/generate")
    assert gen2.json()["novos_gabaritos"] == 0, "idempotente"
    codigos2 = [g["codigo_unico"]
                for g in c.get(f"/api/exams/{av['external_id']}/gabaritos").json()["gabaritos"]]
    assert sorted(codigos) == sorted(codigos2), "mesmos códigos"


# ─── Cenário 3: corrigir pela câmera ───

def test_cenario3_corrigir_pela_camera(isolated, client):
    c = _authed(client, "c3@example.com")
    t = _turma(c, "9º A", [{"nome": "Aluno 1", "matricula": "1"}])
    prova = _prova(c)
    av = _avaliacao(c, "Correção", prova["id"], t["id"])
    _preparar(c, av["external_id"], t["id"])
    g = c.get(f"/api/exams/{av['external_id']}/gabaritos").json()["gabaritos"][0]

    # leitura "da câmera": respostas certas, sem dúvida → leitura nasce revisada
    r = c.post(f"/api/gabaritos/{g['codigo_unico']}/resultado", json={
        "respostas": GABARITO, "acertos": 8, "erros": 0, "brancos": 0, "nota": 10,
        "qr_ok": True, "baixa_confianca": [], "duplicadas": [],
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["leitura_id"] > 0, "leitura registrada"
    assert body["leitura_status"] == "revisada", "sem dúvida não gera pendência"

    leituras = c.get(f"/api/avaliacoes/{av['external_id']}/leituras").json()["leituras"]
    assert len(leituras) == 1 and leituras[0]["status"] == "revisada"
    assert leituras[0]["nota"] == 10

    # resultado disponível para consulta
    res = c.get("/api/resultados").json()
    assert any(x["codigo_unico"] == g["codigo_unico"] and x["nota"] == 10 for x in res)


# ─── Cenário 4: corrigir em lote ───

def test_cenario4_lote_sem_duplicar(isolated, client):
    c = _authed(client, "c4@example.com")
    t = _turma(c, "9º A", [{"nome": f"Aluno {i}", "matricula": str(i)} for i in range(1, 6)])
    prova = _prova(c)
    av = _avaliacao(c, "Lote", prova["id"], t["id"])
    _preparar(c, av["external_id"], t["id"])
    gabaritos = c.get(f"/api/exams/{av['external_id']}/gabaritos").json()["gabaritos"]

    for g in gabaritos:
        c.post(f"/api/gabaritos/{g['codigo_unico']}/resultado", json={
            "respostas": GABARITO, "acertos": 8, "erros": 0, "brancos": 0,
            "nota": 10, "qr_ok": True,
        })
    # uma falha não interrompe: cartão já corrigido devolve 409, não erro 500
    conflito = c.post(f"/api/gabaritos/{gabaritos[0]['codigo_unico']}/resultado", json={
        "respostas": GABARITO, "acertos": 8, "erros": 0, "brancos": 0, "nota": 10})
    assert conflito.status_code == 409, conflito.text

    # um resultado por cartão, sem duplicação
    res = [x for x in c.get("/api/resultados").json()
           if x["avaliacao"]["external_id"] == av["external_id"]]
    assert len(res) == 5, f"5 resultados, vieram {len(res)}"
    leituras = c.get(f"/api/avaliacoes/{av['external_id']}/leituras").json()["leituras"]
    assert len(leituras) == 5, "uma leitura por cartão"

    det = c.get(f"/api/avaliacoes/{av['external_id']}").json()
    assert det["status_derivado"] == "corrigida", det["status_derivado"]
    assert det["progresso"] == 83


# ─── Cenário 5: revisar leitura ───

def test_cenario5_revisao_manual_auditada(isolated, client):
    c = _authed(client, "c5@example.com")
    t = _turma(c, "9º A", [{"nome": "Aluno 1", "matricula": "1"}])
    prova = _prova(c)
    av = _avaliacao(c, "Revisão", prova["id"], t["id"])
    _preparar(c, av["external_id"], t["id"])
    g = c.get(f"/api/exams/{av['external_id']}/gabaritos").json()["gabaritos"][0]

    # leitura com dúvida: duplicada + baixa confiança
    r = c.post(f"/api/gabaritos/{g['codigo_unico']}/resultado", json={
        "respostas": {**GABARITO, "1": "B"}, "acertos": 7, "erros": 1, "brancos": 0, "nota": 8.75,
        "qr_ok": True, "duplicadas": [2], "duplas_marcacoes": {"2": ["B", "C"]},
        "baixa_confianca": [3],
        "corrections": {"1": "A"}, "observacao_revisao": "marca fraca",
    })
    assert r.status_code == 200, r.text
    assert r.json()["leitura_status"] == "pendente", "dúvida vai para a fila"

    det = c.get(f"/api/avaliacoes/{av['external_id']}").json()
    assert det["status_derivado"] == "aguardando_revisao"
    assert det["proxima_acao"]["acao"] == "Revisar correções"

    # publicar bloqueado com revisão pendente
    pub = c.post(f"/api/avaliacoes/{av['external_id']}/publicar")
    assert pub.status_code == 400 and "revisão" in pub.json()["detail"].lower()

    # correção manual auditada
    leitura = c.get(f"/api/avaliacoes/{av['external_id']}/leituras").json()["leituras"][0]
    rev = c.post(f"/api/leituras/{leitura['id']}/revisar", json={
        "respostas": {**GABARITO}, "observacao": "conferido na foto",
    })
    assert rev.status_code == 200 and rev.json()["status"] == "revisada"

    tl = c.get(f"/api/avaliacoes/{av['external_id']}/timeline").json()["eventos"]
    assert any(e["tipo"] == "revisao_manual" for e in tl), "auditoria da revisão"
    assert any(e["tipo"] == "correcao_manual" for e in tl), "auditoria do override"

    # depois da revisão, publicar passa
    pub2 = c.post(f"/api/avaliacoes/{av['external_id']}/publicar")
    assert pub2.status_code == 200, pub2.text
    assert pub2.json()["resultados_publicados_em"]
    det2 = c.get(f"/api/avaliacoes/{av['external_id']}").json()
    assert det2["status_derivado"] == "publicados" and det2["progresso"] == 100


# ─── Cenário 6: consultar resultados ───

def test_cenario6_resultados_por_aluno_turma_avaliacao(isolated, client):
    c = _authed(client, "c6@example.com")
    t = _turma(c, "9º A", [{"nome": f"Aluno {i}", "matricula": str(i)} for i in range(1, 4)])
    prova = _prova(c)
    av = _avaliacao(c, "Resultados", prova["id"], t["id"])
    _preparar(c, av["external_id"], t["id"])
    gabaritos = c.get(f"/api/exams/{av['external_id']}/gabaritos").json()["gabaritos"]
    notas = [10, 6, 2]
    for g, nota in zip(gabaritos, notas):
        acertos = nota  # escala 0-10 com 8 questões: nota = acertos
        c.post(f"/api/gabaritos/{g['codigo_unico']}/resultado", json={
            "respostas": GABARITO, "acertos": acertos, "erros": 0,
            "brancos": 8 - acertos, "nota": nota, "qr_ok": True,
        })

    # por avaliação
    res = [x for x in c.get("/api/resultados").json()
           if x["avaliacao"]["external_id"] == av["external_id"]]
    assert sorted(x["nota"] for x in res) == [2.0, 6.0, 10.0]
    assert {x["aluno"]["nome"] for x in res} == {"Aluno 1", "Aluno 2", "Aluno 3"}

    # por aluno (histórico)
    aluno = c.get(f"/api/exams/{av['external_id']}/students").json()[0]
    hist = c.get(f"/api/alunos/{aluno['aluno_id']}/historico").json()
    assert hist["aluno"]["nome"] == "Aluno 1"
    item = hist["avaliacoes"][0]
    assert item["external_id"] == av["external_id"] and item["ultima_nota"] == 10

    # resumo operacional (painel)
    op = c.get("/api/operacao/resumo").json()
    assert op["avaliacoes"] >= 1 and op["por_status"]["corrigida"] >= 1


# ─── Cenário 7: reutilizar prova e modelo ───

def test_cenario7_reutilizar_prova_e_modelo(isolated, client):
    c = _authed(client, "c7@example.com")
    ta = _turma(c, "8º A", [{"nome": "Ana de A", "matricula": "a1"}])
    tb = _turma(c, "8º B", [{"nome": "Caio de B", "matricula": "b1"}])
    prova = _prova(c, titulo="Prova Reutilizável")

    a1 = _avaliacao(c, "Avaliação A", prova["id"], ta["id"])
    a2 = _avaliacao(c, "Avaliação B", prova["id"], tb["id"])
    assert a1["external_id"] != a2["external_id"]
    assert a1["prova"]["id"] == a2["prova"]["id"] == prova["id"]

    for av, turma in ((a1, ta["id"]), (a2, tb["id"])):
        ext = av["external_id"]
        c.post("/api/exams/sync", json={"external_id": ext, "titulo": ext, "turma_id": turma})
        c.post(f"/api/exams/{ext}/students/from-turma", json={"turma_id": turma})
        c.post(f"/api/avaliacoes/{ext}/gabarito", json={"answer_key": GABARITO})
        c.post(f"/api/exams/{ext}/gabaritos/generate")

    # participantes e códigos isolados
    alunos_a1 = {x["aluno_id"] for x in c.get(f"/api/exams/{a1['external_id']}/students").json()}
    alunos_a2 = {x["aluno_id"] for x in c.get(f"/api/exams/{a2['external_id']}/students").json()}
    assert alunos_a1 and alunos_a2 and not (alunos_a1 & alunos_a2), "participantes não se misturam"

    cod1 = {g["codigo_unico"] for g in c.get(f"/api/exams/{a1['external_id']}/gabaritos").json()["gabaritos"]}
    cod2 = {g["codigo_unico"] for g in c.get(f"/api/exams/{a2['external_id']}/gabaritos").json()["gabaritos"]}
    assert not (cod1 & cod2), "identificadores exclusivos por avaliação"

    # correção em A não aparece em B
    c.post(f"/api/gabaritos/{sorted(cod1)[0]}/resultado", json={
        "respostas": GABARITO, "acertos": 8, "erros": 0, "brancos": 0, "nota": 10, "qr_ok": True})
    res_b = c.get("/api/resultados").json()
    for x in res_b:
        if x["avaliacao"]["external_id"] == a2["external_id"]:
            assert x["nota"] != 10 or x["codigo_unico"] in cod2, "resultado de B é só de B"

    # catálogo de provas mostra o reuso
    provas = {p["id"]: p for p in c.get("/api/provas").json()["provas"]}
    assert provas[prova["id"]]["avaliacoes_usando"] == 2

    # gabarito independente por avaliação (cada uma tem a sua versão 1)
    assert c.get(f"/api/avaliacoes/{a1['external_id']}").json()["gabarito_versao"] == 1
    assert c.get(f"/api/avaliacoes/{a2['external_id']}").json()["gabarito_versao"] == 1


# ─── Cenário 8: integridade e histórico ───

def test_cenario8_gabarito_versionado_e_reprocessamento(isolated, client):
    c = _authed(client, "c8@example.com")
    t = _turma(c, "9º A", [{"nome": "Aluno 1", "matricula": "1"}])
    prova = _prova(c)
    av = _avaliacao(c, "Integridade", prova["id"], t["id"])
    ext = av["external_id"]
    _preparar(c, ext, t["id"])
    g = c.get(f"/api/exams/{ext}/gabaritos").json()["gabaritos"][0]

    # versão 1 do gabarito + primeira correção
    c.post(f"/api/gabaritos/{g['codigo_unico']}/resultado", json={
        "respostas": {"1": "A"}, "acertos": 1, "erros": 0, "brancos": 7, "nota": 1,
        "qr_ok": True, "baixa_confianca": [2],
    })
    leitura_v1 = c.get(f"/api/avaliacoes/{ext}/leituras").json()["leituras"][0]

    # alterar o gabarito gera versão 2 (a 1 fica no histórico)
    c.post(f"/api/avaliacoes/{ext}/gabarito", json={
        "answer_key": {str(i): "ABCD"[(i + 1) % 4] for i in range(1, 9)},   # tudo diferente
        "observacao": "gabarito corrigido pela coordenação"})
    det = c.get(f"/api/avaliacoes/{ext}").json()
    assert det["gabarito_versao"] == 2 and det["answer_key"]["1"] == "C"
    tl = c.get(f"/api/avaliacoes/{ext}/timeline").json()["eventos"]
    assert sum(1 for e in tl if e["tipo"] == "gabarito_versao") == 2

    # reprocessar cria NOVA leitura ligada à anterior (histórico preservado)
    c.post(f"/api/gabaritos/{g['codigo_unico']}/resultado", json={
        "respostas": {"1": "A"}, "acertos": 0, "erros": 1, "brancos": 7, "nota": 0,
        "qr_ok": True,
    }, params={"overwrite": True})
    leituras = c.get(f"/api/avaliacoes/{ext}/leituras").json()["leituras"]
    nova = [x for x in leituras if x["id"] != leitura_v1["id"]]
    assert len(nova) == 1 and nova[0]["parent_id"] == leitura_v1["id"], \
        "reprocessamento preserva a leitura anterior"

    # resultado vigente é o mais recente
    res = [x for x in c.get("/api/resultados").json()
           if x["codigo_unico"] == g["codigo_unico"]]
    assert len(res) == 1 and res[0]["nota"] == 0, "sem resultado duplicado"

    # Transicao manual auditada + bloqueada fora de sequencia.
    # A avaliacao esta corrigida: pode arquivar/publicar, nunca voltar.
    arq = c.patch(f"/api/avaliacoes/{ext}/status", json={"status": "arquivada"})
    assert arq.status_code == 200, arq.text
    assert arq.json()["status_efetivo"] == "arquivada"
    assert c.patch(f"/api/avaliacoes/{ext}/status", json={"status": "rascunho"}).status_code == 400
    tl = c.get(f"/api/avaliacoes/{ext}/timeline").json()["eventos"]
    assert any(e["tipo"] == "status_alterado" for e in tl)


# ─── Isolamento entre usuários (regra 14 do enunciado) ───

def test_isolamento_entre_usuarios(isolated, client):
    c = _authed(client, "iso-dono@example.com")
    t = _turma(c, "9º A", [{"nome": "Só Meu", "matricula": "1"}])
    prova = _prova(c)
    av = _avaliacao(c, "Minha Avaliação", prova["id"], t["id"])
    ext = av["external_id"]
    _preparar(c, ext, t["id"])

    c2 = TestClient(main_module.app)
    _authed(c2, "iso-intruso@example.com")
    assert c2.get("/api/avaliacoes").json()["avaliacoes"] == []
    assert c2.get(f"/api/avaliacoes/{ext}").status_code == 403
    assert c2.get(f"/api/avaliacoes/{ext}/leituras").status_code == 403
    assert c2.post(f"/api/avaliacoes/{ext}/publicar").status_code == 403
    assert c2.post(f"/api/avaliacoes/{ext}/gabarito",
                   json={"answer_key": {"1": "A"}}).status_code == 403
    codigo = c.get(f"/api/exams/{ext}/gabaritos").json()["gabaritos"][0]["codigo_unico"]
    assert c2.post(f"/api/gabaritos/{codigo}/resultado", json={
        "respostas": {"1": "A"}, "acertos": 1, "erros": 0, "brancos": 7, "nota": 1,
    }).status_code == 403, "intruso não corrige cartão alheio"
