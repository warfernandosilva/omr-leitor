"""
Lápides anti-ressurreição (multi-aparelho): prova excluída NÃO volta via sync.

1. Sync + importa aluno + DELETE prova → 200
2. GET /api/exams/deleted lista a lápide
3. POST /api/exams/sync com o mesmo id → 410 (não recria)
4. Sync com id novo → 200 (não bloqueia o resto)
5. Backup exporta as lápides (restore não ressuscita)

Executar: python -m pytest test_tombstones.py -q
"""
from conftest import TEST_PASSWORD


def test_tombstone_flow(client):
    c = client
    r = c.post("/api/auth/register", json={"email": "tomb@t.com", "nome": "Tomb", "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    c.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})

    c.post("/api/exams/sync", json={"external_id": "ex-t1", "titulo": "Morta"})
    c.post("/api/exams/ex-t1/students/import", json={"alunos": [{"nome": "A UM"}]})
    d = c.delete("/api/exams/ex-t1")
    assert d.status_code == 200, f"DELETE prova → 200: {d.text[:100]}"

    gone = c.get("/api/exams/deleted")
    assert gone.status_code == 200, f"GET deleted → 200: {gone.text[:100]}"
    assert any(t["external_id"] == "ex-t1" for t in gone.json()), "lápide de ex-t1 listada"

    re = c.post("/api/exams/sync", json={"external_id": "ex-t1", "titulo": "Ressuscitada?"})
    assert re.status_code == 410, f"sync do id lapidado → 410: status={re.status_code}"

    ok = c.post("/api/exams/sync", json={"external_id": "ex-t2", "titulo": "Viva"})
    assert ok.status_code == 200, f"sync de id novo → 200: {ok.text[:100]}"

    import backup as backup_module
    counts = backup_module.export_all()["counts"]
    assert counts.get("tombstones", 0) >= 1, f"backup exporta tombstones: {counts}"

    lst = c.get("/api/exams").json()
    assert all(e["external_id"] != "ex-t1" for e in lst), "ex-t1 fora da listagem"


if __name__ == "__main__":
    import pytest as _pytest
    import sys as _sys
    _sys.exit(_pytest.main([__file__, "-q"]))
