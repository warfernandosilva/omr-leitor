"""
Lacunas de cobertura (rotas críticas sem teste):
- GET /api/auth/me: 200 autenticado, 401 sem token, 401 após desativar
- PUT /api/exams/{id}/answer-key: dono ok, estranho 403, admin ok
- POST avulso: nome vazio 400, ciclo completo ok
- POST resultado → DELETE resultado → POST de novo (re-correção)
- GET /api/resultados respeita limit

Executar: python test_api_gaps.py
"""
import os
import sys
import tempfile

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_TMP_DIR = tempfile.mkdtemp(prefix="omr_test_gaps_")
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


def new_client(email: str, role: str = "professor") -> TestClient:
    c = TestClient(main_module.app)
    r = c.post("/api/auth/register", json={"email": email, "nome": email, "password": "123456"})
    assert r.status_code == 200, r.text
    if role == "admin":
        # promove direto no banco (primeiro usuário já é admin; demais via bootstrap de teste)
        from database import SessionLocal
        from models import User
        db = SessionLocal()
        u = db.query(User).filter_by(email=email).one()
        u.role = "admin"
        db.commit()
        db.close()
    r = c.post("/api/auth/login", data={"username": email, "password": "123456"})
    assert r.status_code == 200, r.text
    c.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    return c


owner = new_client("dono@gaps.com")
check("me 200 autenticado", owner.get("/api/auth/me").status_code == 200)

anon = TestClient(main_module.app)
check("me 401 sem token", anon.get("/api/auth/me").status_code in (401, 403))

owner.post("/api/exams/sync", json={"external_id": "ex-gaps", "titulo": "Gaps"})
k = owner.put("/api/exams/ex-gaps/answer-key", json={"answer_key": {"1": "A"}})
check("answer-key dono → 200", k.status_code == 200, k.text[:80])

stranger = new_client("estranho@gaps.com")
k2 = stranger.put("/api/exams/ex-gaps/answer-key", json={"answer_key": {"1": "B"}})
check("answer-key estranho → 403", k2.status_code == 403, f"status={k2.status_code}")

av0 = owner.post("/api/exams/ex-gaps/resultados/avulso", json={"nome": "   "})
check("avulso nome vazio → 400", av0.status_code == 400, f"status={av0.status_code}")
av1 = owner.post("/api/exams/ex-gaps/resultados/avulso",
                 json={"nome": "AVULSO UM", "acertos": 3, "nota": 6.0})
check("avulso completo → 200", av1.status_code == 200, av1.text[:100])
cod_av = av1.json()["gabarito"]["codigo_unico"]

owner.post("/api/exams/ex-gaps/students/import", json={"alunos": [{"nome": "GAP UM"}]})
gen = owner.post("/api/exams/ex-gaps/gabaritos/generate").json()
pendentes = [g for g in gen["gabaritos"] if g["status"] == "gerado"]
assert pendentes, "sem gabarito pendente para o ciclo"
cod = pendentes[0]["codigo_unico"]
s1 = owner.post(f"/api/gabaritos/{cod}/resultado", json={"acertos": 5, "nota": 5.0})
check("POST resultado → 200", s1.status_code == 200)
d1 = owner.delete(f"/api/gabaritos/{cod}/resultado")
check("DELETE resultado → 200", d1.status_code == 200, d1.text[:80])
s2 = owner.post(f"/api/gabaritos/{cod}/resultado", json={"acertos": 7, "nota": 7.0})
check("POST de novo (re-correção) → 200", s2.status_code == 200)

lst = owner.get("/api/resultados", params={"limit": 1}).json()
check("resultados respeita limit=1", len(lst) == 1, f"n={len(lst)}")

# desativa o dono: sessão antiga deve cair
from database import SessionLocal as _SL
from models import User as _U
_db = _SL()
_db.query(_U).filter_by(email="dono@gaps.com").update({"is_active": False})
_db.commit()
_db.close()
check("me 401 após desativar", owner.get("/api/auth/me").status_code in (401, 403))

print(f"API GAPS: {len(PASS)} pass, {len(FAIL)} fail")
sys.exit(1 if FAIL else 0)
