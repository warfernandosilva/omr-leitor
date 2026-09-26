"""
Testes de persistência — fluxo completo obrigatório (§23):

1. Importar 5 alunos → 5 alunos + 5 gabaritos + 5 códigos únicos + 5 páginas
2. Fechar e reabrir o sistema → dados continuam disponíveis
3. Ler os 5 QR Codes → cada QR identifica seu aluno
4. Ler em ordem aleatória → resultado vinculado ao aluno correto
5. Dois alunos com o mesmo nome → aluno_id e codigo_unico distintos
6. QR Code inexistente → não identificado, nenhum aluno atribuído
7. Reprocessar gabarito corrigido → 409 pedindo confirmação
8. Resetar avaliação e apagar aluno individual

Executar: python -m pytest test_persistence.py -q
"""
import random

import main as main_module
import omr.template as template
from conftest import TEST_PASSWORD
from omr.reader import process_image


def _authed(c):
    # Registra (ou loga se já existe) um usuário de teste e injeta o token
    r = c.post("/api/auth/register", json={"email": "test@example.com", "nome": "Teste", "password": TEST_PASSWORD})
    if r.status_code == 400:
        r = c.post("/api/auth/login", data={"username": "test@example.com", "password": TEST_PASSWORD})
    assert r.status_code == 200, f"auth falhou: {r.text}"
    token = r.json()["access_token"]
    c.headers.update({"Authorization": f"Bearer {token}"})
    return c


def test_persistence_flow(isolated, client):
    # TESTE 1 — Importar 5 alunos
    c = _authed(client)
    sync = c.post("/api/exams/sync", json={
        "external_id": "exam-test-001",
        "titulo": "Prova Bimestral",
        "turma": "8A",
    })
    assert sync.status_code == 200, sync.text
    av_id = sync.json()["avaliacao_id"]
    assert av_id > 0, "sync cria avaliação"

    nomes = ["João da Silva", "Maria Oliveira", "Pedro Santos", "Ana Souza", "Carlos Lima"]
    imp = c.post("/api/exams/exam-test-001/students/import", json={
        "alunos": [{"nome": n, "matricula": str(100 + i)} for i, n in enumerate(nomes)]
    })
    assert imp.status_code == 200, imp.text
    imp_j = imp.json()
    aluno_ids = [a["id"] for a in imp_j["alunos"]]
    assert imp_j["total_importados"] == 5 and len(set(aluno_ids)) == 5, \
        f"5 alunos persistidos: ids={aluno_ids}"

    gen = c.post("/api/exams/exam-test-001/gabaritos/generate")
    assert gen.status_code == 200, gen.text
    gen_j = gen.json()
    codigos = [g["codigo_unico"] for g in gen_j["gabaritos"]]
    assert gen_j["total_gabaritos"] == 5, "5 gabaritos persistidos"
    assert len(set(codigos)) == 5 and all(c.startswith("OMR-") for c in codigos), \
        f"5 códigos únicos: {codigos[0]}..."

    pdf = c.post("/api/exams/exam-test-001/gabaritos/pdf")
    pages = pdf.content.count(b"/Type /Page") - pdf.content.count(b"/Type /Pages")
    assert pdf.status_code == 200 and pages == 5, f"PDF com 5 páginas: pages={pages}"

    # Reimpressão é idempotente (mesmos códigos)
    gen2 = c.post("/api/exams/exam-test-001/gabaritos/generate").json()
    codigos2 = [g["codigo_unico"] for g in gen2["gabaritos"]]
    assert codigos2 == codigos, "regenerar mantém códigos"

    # TESTE 2 — Fechar e reabrir o sistema (mesmo arquivo, nova conexão)
    isolated.reopen()
    c = _authed(client)

    lst = c.get("/api/exams/exam-test-001/gabaritos").json()
    assert lst["stats"]["alunos_cadastrados"] == 5 and lst["stats"]["gabaritos_gerados"] == 5, \
        "alunos/gabaritos persistem após reabrir"

    lk0 = c.get(f"/api/gabaritos/{codigos[0]}/lookup").json()
    assert lk0["found"] is True and lk0["aluno"]["nome"] == nomes[0], \
        "lookup após reabrir resolve aluno"

    # TESTE 3 — Ler os 5 QR Codes (imagem real)
    ok_qr = 0
    for i, codigo in enumerate(codigos):
        img = template.generate_card(student_name=nomes[i], student_id=codigo,
                                     student_matricula=str(100 + i))
        r = process_image(img)
        if r and r.qr_id == codigo:
            ok_qr += 1
    assert ok_qr == 5, f"QR decodificado na imagem para os 5: {ok_qr}/5"

    lookups_ok = all(
        c.get(f"/api/gabaritos/{cod}/lookup").json()["aluno"]["nome"] == nomes[i]
        for i, cod in enumerate(codigos)
    )
    assert lookups_ok, "lookup código→aluno correto"

    # TESTE 4 — Leitura em ordem aleatória
    random.seed(42)
    ordem = list(range(5))
    random.shuffle(ordem)
    correto = True
    for idx in ordem:
        lk = c.get(f"/api/gabaritos/{codigos[idx]}/lookup").json()
        if not lk["found"] or lk["aluno"]["nome"] != nomes[idx]:
            correto = False
        res = c.post(f"/api/gabaritos/{codigos[idx]}/resultado", json={
            "respostas": {"1": "A"},
            "acertos": idx + 10, "erros": 20 - idx, "brancos": 4, "nota": round((idx + 10) / 44 * 10, 1),
        })
        if res.json().get("saved") is not True:
            correto = False
    assert correto, f"resultados vinculados aos alunos certos: ordem={ordem}"

    lst = c.get("/api/exams/exam-test-001/gabaritos").json()
    by_nome = {g["aluno"]["nome"]: g for g in lst["gabaritos"]}
    vinculado = all(
        by_nome[nomes[idx]]["acertos"] == idx + 10 for idx in ordem
    )
    assert vinculado, "acertos batem com cada aluno"

    # TESTE 5 — Dois alunos com o mesmo nome
    dup = c.post("/api/exams/exam-test-001/students/import", json={
        "alunos": [{"nome": "João Duplicado"}, {"nome": "João Duplicado"}]
    }).json()
    ids_dup = [a["id"] for a in dup["alunos"]]
    assert dup["total_importados"] == 2 and ids_dup[0] != ids_dup[1], \
        f"mesmo nome → aluno_id diferente: ids={ids_dup}"

    gen3 = c.post("/api/exams/exam-test-001/gabaritos/generate").json()
    gs_dup = [g for g in gen3["gabaritos"] if g["aluno"]["id"] in ids_dup]
    assert len(gs_dup) == 2 and gs_dup[0]["codigo_unico"] != gs_dup[1]["codigo_unico"], \
        "mesmo nome → codigo_unico diferente"

    pdf3 = c.post("/api/exams/exam-test-001/gabaritos/pdf")
    pages3 = pdf3.content.count(b"/Type /Page") - pdf3.content.count(b"/Type /Pages")
    assert pdf3.status_code == 200 and pages3 == 7, f"PDF regenerado com 7 páginas (5+2): pages={pages3}"

    # TESTE 6 — QR Code inexistente
    r6 = c.get("/api/gabaritos/OMR-2026-999999/lookup")
    assert r6.status_code == 404 and r6.json()["found"] is False, \
        "lookup retorna found=False (404)"

    r6b = c.post("/api/gabaritos/OMR-2026-999999/resultado", json={"acertos": 0})
    assert r6b.status_code == 404, "resultado para código inexistente → 404"

    # TESTE 7 — Reprocessar gabarito já corrigido
    codigo0 = codigos[0]
    r7a = c.post(f"/api/gabaritos/{codigo0}/resultado", json={"acertos": 99, "nota": 5.0})
    assert r7a.status_code == 409 and r7a.json().get("already_graded") is True, \
        "segunda correção sem overwrite → 409"

    prev = r7a.json().get("previous", {})
    assert prev.get("nota") is not None, "409 traz resultado anterior p/ conferência"

    r7b = c.post(f"/api/gabaritos/{codigo0}/resultado?overwrite=true", json={"acertos": 44, "nota": 10.0})
    assert r7b.status_code == 200 and r7b.json()["gabarito"]["nota"] == 10.0, \
        "overwrite=true substitui resultado"

    # EXTRA — Validações de integridade
    assert "db" in c.get("/api/health").json(), "health expõe db"
    stats = c.get("/api/exams/exam-test-001/gabaritos").json()["stats"]
    # 7 alunos/gabaritos; apenas os 5 do Teste 4 (+ overwrite) foram corrigidos
    assert stats["alunos_cadastrados"] == 7 and stats["gabaritos_gerados"] == 7 \
        and stats["gabaritos_corrigidos"] == 5 and stats["pendentes"] == 2, f"stats coerentes: {stats}"

    # TESTE 8 — Resetar avaliação e apagar aluno individual
    c.post("/api/exams/sync", json={"external_id": "exam-test-002", "titulo": "Recuperação", "turma": "9B"})
    c.post("/api/exams/exam-test-002/students/import", json={
        "alunos": [{"nome": "Aluno A"}, {"nome": "Aluno B"}, {"nome": "Aluno C"}]
    })
    gen8 = c.post("/api/exams/exam-test-002/gabaritos/generate").json()
    cod_b = [g for g in gen8["gabaritos"] if g["aluno"]["nome"] == "Aluno B"][0]

    # Exclusão individual
    r8a = c.delete(f"/api/alunos/{cod_b['aluno']['id']}")
    assert r8a.status_code == 200 and r8a.json()["deleted"] is True \
        and r8a.json()["nome"] == "Aluno B", "aluno individual apagado"
    lst8 = c.get("/api/exams/exam-test-002/gabaritos").json()
    assert lst8["stats"]["alunos_cadastrados"] == 2, "lista cai para 2 após exclusão"
    assert c.get(f"/api/gabaritos/{cod_b['codigo_unico']}/lookup").status_code == 404, \
        "QR do aluno apagado vira 404"

    # Reset total da avaliação
    r8b = c.delete("/api/exams/exam-test-002/students")
    j8 = r8b.json()
    assert r8b.status_code == 200 and j8["deleted_alunos"] == 2 and j8["deleted_gabaritos"] == 2, \
        f"reset apaga todos os alunos/gabaritos: {j8}"
    lst8b = c.get("/api/exams/exam-test-002/gabaritos").json()
    assert lst8b["stats"]["alunos_cadastrados"] == 0 and lst8b["stats"]["gabaritos_gerados"] == 0, \
        "avaliação fica vazia após reset"
    # Códigos antigos não resolvem mais
    assert all(c.get(f"/api/gabaritos/{g['codigo_unico']}/lookup").status_code == 404
               for g in gen8["gabaritos"] if g["aluno"]["nome"] != "Aluno B"), \
        "códigos do reset viram 404"

    # Aluno inexistente → 404
    assert c.delete("/api/alunos/999999").status_code == 404, "excluir aluno inexistente → 404"


if __name__ == "__main__":
    import pytest as _pytest
    import sys as _sys
    _sys.exit(_pytest.main([__file__, "-q"]))
