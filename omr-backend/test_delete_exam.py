"""
Exclusão de avaliação — contrato travado (regressão):
prova deletada NÃO pode continuar no banco.

1. Sync + importa 2 alunos + gera gabaritos + salva 1 resultado
2. DELETE /api/exams/{id} → 200
3. GET /api/exams → prova sumiu; lookup do gabarito → 404
4. DELETE de prova inexistente → 404 (app trata como "só-local")

Executar: python -m pytest test_delete_exam.py -q
"""
from conftest import TEST_PASSWORD


def test_delete_exam_contract(client):
    c = client
    r = c.post("/api/auth/register", json={"email": "delexam@t.com", "nome": "Del", "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    c.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})

    c.post("/api/exams/sync", json={"external_id": "ex-del", "titulo": "Apagar"})
    c.post("/api/exams/ex-del/students/import", json={"alunos": [{"nome": "A UM"}, {"nome": "A DOIS"}]})
    gen = c.post("/api/exams/ex-del/gabaritos/generate").json()
    cod = gen["gabaritos"][0]["codigo_unico"]
    c.post(f"/api/gabaritos/{cod}/resultado", json={"acertos": 5, "nota": 5.0})

    d = c.delete("/api/exams/ex-del")
    assert d.status_code == 200, f"DELETE prova → 200: {d.text[:120]}"

    lst = c.get("/api/exams").json()
    assert all(e["external_id"] != "ex-del" for e in lst), "prova sumiu da listagem"

    lk = c.get(f"/api/gabaritos/{cod}/lookup")
    assert lk.status_code == 404, f"lookup do gabarito → 404: status={lk.status_code}"

    d2 = c.delete("/api/exams/ex-del")
    assert d2.status_code == 404, f"DELETE repetido → 404 (só-local): status={d2.status_code}"


if __name__ == "__main__":
    import pytest as _pytest
    import sys as _sys
    _sys.exit(_pytest.main([__file__, "-q"]))
