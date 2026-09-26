"""
Lacunas de cobertura (rotas críticas sem teste):
- GET /api/auth/me: 200 autenticado, 401 sem token, 401 após desativar
- PUT /api/exams/{id}/answer-key: dono ok, estranho 403, admin ok
- POST avulso: nome vazio 400, ciclo completo ok
- POST resultado → DELETE resultado → POST de novo (re-correção)
- GET /api/resultados respeita limit

Executar: python -m pytest test_api_gaps.py -q
"""
from fastapi.testclient import TestClient

import main as main_module
from conftest import TEST_PASSWORD


def _new_client(email: str, db_session_factory, role: str = "professor") -> TestClient:
    c = TestClient(main_module.app)
    r = c.post("/api/auth/register", json={"email": email, "nome": email, "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    if role == "admin":
        # promove direto no banco (primeiro usuário já é admin; demais via bootstrap de teste)
        from models import User
        db = db_session_factory()
        try:
            u = db.query(User).filter_by(email=email).one()
            u.role = "admin"
            db.commit()
        finally:
            db.close()
    r = c.post("/api/auth/login", data={"username": email, "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    c.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    return c


def test_api_gaps(isolated, db_session):
    owner = _new_client("dono@gaps.com", db_session)
    assert owner.get("/api/auth/me").status_code == 200, "me 200 autenticado"

    anon = TestClient(main_module.app)
    assert anon.get("/api/auth/me").status_code in (401, 403), "me 401 sem token"

    owner.post("/api/exams/sync", json={"external_id": "ex-gaps", "titulo": "Gaps"})
    k = owner.put("/api/exams/ex-gaps/answer-key", json={"answer_key": {"1": "A"}})
    assert k.status_code == 200, f"answer-key dono → 200: {k.text[:80]}"

    stranger = _new_client("estranho@gaps.com", db_session)
    k2 = stranger.put("/api/exams/ex-gaps/answer-key", json={"answer_key": {"1": "B"}})
    assert k2.status_code == 403, f"answer-key estranho → 403: status={k2.status_code}"

    av0 = owner.post("/api/exams/ex-gaps/resultados/avulso", json={"nome": "   "})
    assert av0.status_code == 400, f"avulso nome vazio → 400: status={av0.status_code}"
    av1 = owner.post("/api/exams/ex-gaps/resultados/avulso",
                     json={"nome": "AVULSO UM", "acertos": 3, "nota": 6.0})
    assert av1.status_code == 200, f"avulso completo → 200: {av1.text[:100]}"

    owner.post("/api/exams/ex-gaps/students/import", json={"alunos": [{"nome": "GAP UM"}]})
    gen = owner.post("/api/exams/ex-gaps/gabaritos/generate").json()
    pendentes = [g for g in gen["gabaritos"] if g["status"] == "gerado"]
    assert pendentes, "sem gabarito pendente para o ciclo"
    cod = pendentes[0]["codigo_unico"]
    s1 = owner.post(f"/api/gabaritos/{cod}/resultado", json={"acertos": 5, "nota": 5.0})
    assert s1.status_code == 200, "POST resultado → 200"
    d1 = owner.delete(f"/api/gabaritos/{cod}/resultado")
    assert d1.status_code == 200, f"DELETE resultado → 200: {d1.text[:80]}"
    s2 = owner.post(f"/api/gabaritos/{cod}/resultado", json={"acertos": 7, "nota": 7.0})
    assert s2.status_code == 200, "POST de novo (re-correção) → 200"

    lst = owner.get("/api/resultados", params={"limit": 1}).json()
    assert len(lst) == 1, f"resultados respeita limit=1: n={len(lst)}"

    # desativa o dono: sessão antiga deve cair
    from models import User as _U
    _db = db_session()
    try:
        _db.query(_U).filter_by(email="dono@gaps.com").update({"is_active": False})
        _db.commit()
    finally:
        _db.close()
    assert owner.get("/api/auth/me").status_code in (401, 403), "me 401 após desativar"


if __name__ == "__main__":
    import pytest as _pytest
    import sys as _sys
    _sys.exit(_pytest.main([__file__, "-q"]))
