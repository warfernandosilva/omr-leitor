"""
Testes de persistência — fluxo completo obrigatório (§23):

1. Importar 5 alunos → 5 alunos + 5 gabaritos + 5 códigos únicos + 5 páginas
2. Fechar e reabrir o sistema → dados continuam disponíveis
3. Ler os 5 QR Codes → cada QR identifica seu aluno
4. Ler em ordem aleatória → resultado vinculado ao aluno correto
5. Dois alunos com o mesmo nome → aluno_id e codigo_unico distintos
6. QR Code inexistente → não identificado, nenhum aluno atribuído
7. Reprocessar gabarito corrigido → 409 pedindo confirmação

Executar: python test_persistence.py
"""

import os
import sys
import tempfile

# Console Windows (cp1252): evita UnicodeEncodeError nos nomes dos testes
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Banco isolado ANTES de importar main/database
_TMP_DIR = tempfile.mkdtemp(prefix="omr_test_")
os.environ["OMR_DB_PATH"] = os.path.join(_TMP_DIR, "test_omr.db")

sys.path.insert(0, ".")

from fastapi.testclient import TestClient  # noqa: E402
import main as main_module  # noqa: E402
import omr.template as template  # noqa: E402
from omr.reader import process_image  # noqa: E402

PASS = []
FAIL = []


def check(name: str, cond: bool, extra: str = ""):
    if cond:
        PASS.append(name)
        print(f"   PASS  {name} {extra}")
    else:
        FAIL.append(name)
        print(f"   FAIL  {name} {extra}")


def client() -> TestClient:
    return TestClient(main_module.app)


def authed_client(c: TestClient) -> TestClient:
    # Registra (ou loga se já existe) um usuário de teste e injeta o token
    r = c.post("/api/auth/register", json={"email": "test@example.com", "nome": "Teste", "password": "123456"})
    if r.status_code == 400:
        r = c.post("/api/auth/login", data={"username": "test@example.com", "password": "123456"})
    assert r.status_code == 200, f"auth falhou: {r.text}"
    token = r.json()["access_token"]
    c.headers.update({"Authorization": f"Bearer {token}"})
    return c


print("=" * 60)
print("TESTE 1 — Importar 5 alunos")
print("=" * 60)
c = authed_client(client())
sync = c.post("/api/exams/sync", json={
    "external_id": "exam-test-001",
    "titulo": "Prova Bimestral",
    "turma": "8A",
})
assert sync.status_code == 200, sync.text
av_id = sync.json()["avaliacao_id"]
check("sync cria avaliação", av_id > 0)

nomes = ["João da Silva", "Maria Oliveira", "Pedro Santos", "Ana Souza", "Carlos Lima"]
imp = c.post("/api/exams/exam-test-001/students/import", json={
    "alunos": [{"nome": n, "matricula": str(100 + i)} for i, n in enumerate(nomes)]
})
assert imp.status_code == 200, imp.text
imp_j = imp.json()
aluno_ids = [a["id"] for a in imp_j["alunos"]]
check("5 alunos persistidos", imp_j["total_importados"] == 5 and len(set(aluno_ids)) == 5,
      f"ids={aluno_ids}")

gen = c.post("/api/exams/exam-test-001/gabaritos/generate")
assert gen.status_code == 200, gen.text
gen_j = gen.json()
codigos = [g["codigo_unico"] for g in gen_j["gabaritos"]]
check("5 gabaritos persistidos", gen_j["total_gabaritos"] == 5)
check("5 códigos únicos", len(set(codigos)) == 5 and all(c.startswith("OMR-") for c in codigos),
      f"{codigos[0]}...")

pdf = c.post("/api/exams/exam-test-001/gabaritos/pdf")
pages = pdf.content.count(b"/Type /Page") - pdf.content.count(b"/Type /Pages")
check("PDF com 5 páginas", pdf.status_code == 200 and pages == 5, f"pages={pages}")

# Reimpressão é idempotente (mesmos códigos)
gen2 = c.post("/api/exams/exam-test-001/gabaritos/generate").json()
codigos2 = [g["codigo_unico"] for g in gen2["gabaritos"]]
check("regenerar mantém códigos", codigos2 == codigos)

print()
print("=" * 60)
print("TESTE 2 — Fechar e reabrir o sistema")
print("=" * 60)
# Simula reabrir: descarta engine/sessões e reabre conexão no mesmo arquivo
from database import engine  # noqa: E402
engine.dispose()
c = authed_client(client())

lst = c.get("/api/exams/exam-test-001/gabaritos").json()
check("alunos/gabaritos persistem após reabrir", lst["stats"]["alunos_cadastrados"] == 5
      and lst["stats"]["gabaritos_gerados"] == 5)

lk0 = c.get(f"/api/gabaritos/{codigos[0]}/lookup").json()
check("lookup após reabrir resolve aluno", lk0["found"] is True and lk0["aluno"]["nome"] == nomes[0])

print()
print("=" * 60)
print("TESTE 3 — Ler os 5 QR Codes (imagem real)")
print("=" * 60)
ok_qr = 0
for i, codigo in enumerate(codigos):
    img = template.generate_card(student_name=nomes[i], student_id=codigo,
                                 student_matricula=str(100 + i))
    r = process_image(img)
    if r and r.qr_id == codigo:
        ok_qr += 1
check("QR decodificado na imagem para os 5", ok_qr == 5, f"{ok_qr}/5")

lookups_ok = all(
    c.get(f"/api/gabaritos/{cod}/lookup").json()["aluno"]["nome"] == nomes[i]
    for i, cod in enumerate(codigos)
)
check("lookup código→aluno correto", lookups_ok)

print()
print("=" * 60)
print("TESTE 4 — Leitura em ordem aleatória")
print("=" * 60)
import random  # noqa: E402
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
check("resultados vinculados aos alunos certos", correto, f"ordem={ordem}")

lst = c.get("/api/exams/exam-test-001/gabaritos").json()
by_nome = {g["aluno"]["nome"]: g for g in lst["gabaritos"]}
vinculado = all(
    by_nome[nomes[idx]]["acertos"] == idx + 10 for idx in ordem
)
check("acertos batem com cada aluno", vinculado)

print()
print("=" * 60)
print("TESTE 5 — Dois alunos com o mesmo nome")
print("=" * 60)
dup = c.post("/api/exams/exam-test-001/students/import", json={
    "alunos": [{"nome": "João Duplicado"}, {"nome": "João Duplicado"}]
}).json()
ids_dup = [a["id"] for a in dup["alunos"]]
check("mesmo nome → aluno_id diferente", dup["total_importados"] == 2 and ids_dup[0] != ids_dup[1],
      f"ids={ids_dup}")

gen3 = c.post("/api/exams/exam-test-001/gabaritos/generate").json()
gs_dup = [g for g in gen3["gabaritos"] if g["aluno"]["id"] in ids_dup]
check("mesmo nome → codigo_unico diferente",
      len(gs_dup) == 2 and gs_dup[0]["codigo_unico"] != gs_dup[1]["codigo_unico"])

pdf3 = c.post("/api/exams/exam-test-001/gabaritos/pdf")
pages3 = pdf3.content.count(b"/Type /Page") - pdf3.content.count(b"/Type /Pages")
check("PDF regenerado com 7 páginas (5+2)", pdf3.status_code == 200 and pages3 == 7, f"pages={pages3}")

print()
print("=" * 60)
print("TESTE 6 — QR Code inexistente")
print("=" * 60)
r6 = c.get("/api/gabaritos/OMR-2026-999999/lookup")
check("lookup retorna found=False (404)", r6.status_code == 404 and r6.json()["found"] is False)

r6b = c.post("/api/gabaritos/OMR-2026-999999/resultado", json={"acertos": 0})
check("resultado para código inexistente → 404", r6b.status_code == 404)

print()
print("=" * 60)
print("TESTE 7 — Reprocessar gabarito já corrigido")
print("=" * 60)
codigo0 = codigos[0]
r7a = c.post(f"/api/gabaritos/{codigo0}/resultado", json={"acertos": 99, "nota": 5.0})
check("segunda correção sem overwrite → 409", r7a.status_code == 409
      and r7a.json().get("already_graded") is True)

prev = r7a.json().get("previous", {})
check("409 traz resultado anterior p/ conferência", prev.get("nota") is not None)

r7b = c.post(f"/api/gabaritos/{codigo0}/resultado?overwrite=true", json={"acertos": 44, "nota": 10.0})
check("overwrite=true substitui resultado", r7b.status_code == 200 and r7b.json()["gabarito"]["nota"] == 10.0)

print()
print("=" * 60)
print("EXTRA — Validações de integridade")
print("=" * 60)
check("health expõe db", "db" in c.get("/api/health").json())
stats = c.get("/api/exams/exam-test-001/gabaritos").json()["stats"]
# 7 alunos/gabaritos; apenas os 5 do Teste 4 (+ overwrite) foram corrigidos
check("stats coerentes", stats["alunos_cadastrados"] == 7 and stats["gabaritos_gerados"] == 7
      and stats["gabaritos_corrigidos"] == 5 and stats["pendentes"] == 2, str(stats))

print()
print("=" * 60)
print("TESTE 8 — Resetar avaliação e apagar aluno individual")
print("=" * 60)
c.post("/api/exams/sync", json={"external_id": "exam-test-002", "titulo": "Recuperação", "turma": "9B"})
c.post("/api/exams/exam-test-002/students/import", json={
    "alunos": [{"nome": "Aluno A"}, {"nome": "Aluno B"}, {"nome": "Aluno C"}]
})
gen8 = c.post("/api/exams/exam-test-002/gabaritos/generate").json()
cod_b = [g for g in gen8["gabaritos"] if g["aluno"]["nome"] == "Aluno B"][0]

# Exclusão individual
r8a = c.delete(f"/api/alunos/{cod_b['aluno']['id']}")
check("aluno individual apagado", r8a.status_code == 200 and r8a.json()["deleted"] is True
      and r8a.json()["nome"] == "Aluno B")
lst8 = c.get("/api/exams/exam-test-002/gabaritos").json()
check("lista cai para 2 após exclusão", lst8["stats"]["alunos_cadastrados"] == 2)
check("QR do aluno apagado vira 404",
      c.get(f"/api/gabaritos/{cod_b['codigo_unico']}/lookup").status_code == 404)

# Reset total da avaliação
r8b = c.delete("/api/exams/exam-test-002/students")
j8 = r8b.json()
check("reset apaga todos os alunos/gabaritos", r8b.status_code == 200
      and j8["deleted_alunos"] == 2 and j8["deleted_gabaritos"] == 2, str(j8))
lst8b = c.get("/api/exams/exam-test-002/gabaritos").json()
check("avaliação fica vazia após reset", lst8b["stats"]["alunos_cadastrados"] == 0
      and lst8b["stats"]["gabaritos_gerados"] == 0)
# Códigos antigos não resolvem mais
check("códigos do reset viram 404",
      all(c.get(f"/api/gabaritos/{g['codigo_unico']}/lookup").status_code == 404
          for g in gen8["gabaritos"] if g["aluno"]["nome"] != "Aluno B"))

# Aluno inexistente → 404
check("excluir aluno inexistente → 404",
      c.delete("/api/alunos/999999").status_code == 404)

print()
print("=" * 60)
print(f"RESULTADO: {len(PASS)} passou | {len(FAIL)} falhou")
if FAIL:
    print("FALHAS:", FAIL)
    sys.exit(1)
print("TODOS OS TESTES DE PERSISTÊNCIA PASSARAM ✔")
