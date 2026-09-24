"""
Lápides anti-ressurreição (multi-aparelho): prova excluída NÃO volta via sync.

1. Sync + importa aluno + DELETE prova → 200
2. GET /api/exams/deleted lista a lápide
3. POST /api/exams/sync com o mesmo id → 410 (não recria)
4. Sync com id novo → 200 (não bloqueia o resto)
5. Backup exporta as lápides (restore não ressuscita)

Executar: python test_tombstones.py
"""

import os
import sys
import tempfile

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_TMP_DIR = tempfile.mkdtemp(prefix="omr_test_tomb_")
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
r = c.post("/api/auth/register", json={"email": "tomb@t.com", "nome": "Tomb", "password": "123456"})
assert r.status_code == 200, r.text
c.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})

c.post("/api/exams/sync", json={"external_id": "ex-t1", "titulo": "Morta"})
c.post("/api/exams/ex-t1/students/import", json={"alunos": [{"nome": "A UM"}]})
d = c.delete("/api/exams/ex-t1")
check("DELETE prova → 200", d.status_code == 200, d.text[:100])

gone = c.get("/api/exams/deleted")
check("GET deleted → 200", gone.status_code == 200, gone.text[:100])
check("lápide de ex-t1 listada", any(t["external_id"] == "ex-t1" for t in gone.json()))

re = c.post("/api/exams/sync", json={"external_id": "ex-t1", "titulo": "Ressuscitada?"})
check("sync do id lapidado → 410", re.status_code == 410, f"status={re.status_code}")

ok = c.post("/api/exams/sync", json={"external_id": "ex-t2", "titulo": "Viva"})
check("sync de id novo → 200", ok.status_code == 200, ok.text[:100])

import backup as backup_module
counts = backup_module.export_all()["counts"]
check("backup exporta tombstones", counts.get("tombstones", 0) >= 1, str(counts))

lst = c.get("/api/exams").json()
check("ex-t1 fora da listagem", all(e["external_id"] != "ex-t1" for e in lst))

print(f"TOMBSTONES: {len(PASS)} pass, {len(FAIL)} fail")
sys.exit(1 if FAIL else 0)
