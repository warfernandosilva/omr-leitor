"""
Exclusão de avaliação — contrato travado (regressão):
prova deletada NÃO pode continuar no banco.

1. Sync + importa 2 alunos + gera gabaritos + salva 1 resultado
2. DELETE /api/exams/{id} → 200
3. GET /api/exams → prova sumiu; lookup do gabarito → 404
4. DELETE de prova inexistente → 404 (app trata como "só-local")

Executar: python test_delete_exam.py
"""

import os
import sys
import tempfile

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_TMP_DIR = tempfile.mkdtemp(prefix="omr_test_del_exam_")
os.environ["OMR_DB_PATH"] = os.path.join(_TMP_DIR, "test_omr.db")

sys.path.insert(0, ".")

from fastapi.testclient import TestClient  # noqa: E402
import main as main_module  # noqa: E402

PASS = []
FAIL = []


def check(name: str, cond: bool, extra: str = ""):
    if cond:
        PASS.append(name)
        print(f"   PASS  {name} {extra}")
    else:
        FAIL.append(name)
        print(f"   FAIL  {name} {extra}")


c = TestClient(main_module.app)
r = c.post("/api/auth/register", json={"email": "delexam@t.com", "nome": "Del", "password": "123456"})
assert r.status_code == 200, r.text
c.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})

c.post("/api/exams/sync", json={"external_id": "ex-del", "titulo": "Apagar"})
c.post("/api/exams/ex-del/students/import", json={"alunos": [{"nome": "A UM"}, {"nome": "A DOIS"}]})
gen = c.post("/api/exams/ex-del/gabaritos/generate").json()
cod = gen["gabaritos"][0]["codigo_unico"]
c.post(f"/api/gabaritos/{cod}/resultado", json={"acertos": 5, "nota": 5.0})

d = c.delete("/api/exams/ex-del")
check("DELETE prova → 200", d.status_code == 200, d.text[:120])

lst = c.get("/api/exams").json()
check("prova sumiu da listagem", all(e["external_id"] != "ex-del" for e in lst))

lk = c.get(f"/api/gabaritos/{cod}/lookup")
check("lookup do gabarito → 404", lk.status_code == 404, f"status={lk.status_code}")

d2 = c.delete("/api/exams/ex-del")
check("DELETE repetido → 404 (só-local)", d2.status_code == 404, f"status={d2.status_code}")

print(f"DELETE EXAM: {len(PASS)} pass, {len(FAIL)} fail")
sys.exit(1 if FAIL else 0)
