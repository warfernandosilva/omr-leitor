"""Rotas admin de backup: download, restore com confirmação, pré-restore.

Executar: python -m pytest test_backup_routes.py -q
"""
from fastapi.testclient import TestClient

import main as main_module
from conftest import TEST_PASSWORD


def _make_client(email, role="professor", db_session_factory=None):
    c = TestClient(main_module.app)
    r = c.post('/api/auth/register', json={'email': email, 'nome': 'T', 'password': TEST_PASSWORD})
    if r.status_code == 400:
        r = c.post('/api/auth/login', data={'username': email, 'password': TEST_PASSWORD})
    assert r.status_code == 200, r.text
    tok = r.json()['access_token']
    if role == "admin":
        # promove via banco isolado do módulo
        from models import User
        db = db_session_factory()
        try:
            u = db.query(User).filter_by(email=email).one()
            u.role = "admin"
            db.commit()
        finally:
            db.close()
        r = c.post('/api/auth/login', data={'username': email, 'password': TEST_PASSWORD})
        tok = r.json()['access_token']
    c.headers.update({'Authorization': f"Bearer {tok}"})
    return c


def test_backup_routes(isolated, db_session):
    admin = _make_client('adm@example.com', 'admin', db_session)
    prof = _make_client('prof@example.com', 'professor', db_session)

    # cria 1 avaliação p/ ter conteúdo
    s = admin.post('/api/exams/sync', json={'external_id': 'exam-bk', 'titulo': 'BK',
                                            'turma': '9A', 'template': 'padrao'})
    assert s.status_code == 200, s.text

    b = admin.get('/api/admin/backup')
    assert b.status_code == 200 and all(k in b.json() for k in ("users", "avaliacoes", "alunos", "gabaritos")), \
        f"download: 200 + JSON com 4 tabelas: status={b.status_code}"
    assert "backup-omr-" in (b.headers.get("content-disposition") or ""), "download: filename"

    dump = b.content

    p403 = prof.get('/api/admin/backup')
    assert p403.status_code == 403, "não-admin: 403"

    r0 = admin.post('/api/admin/restore', files={'file': ('bk.json', dump, 'application/json')})
    assert r0.status_code == 400, f"restore sem confirm → 400: status={r0.status_code}"

    r1 = admin.post('/api/admin/restore', files={'file': ('bk.json', dump, 'application/json')},
                    data={'confirm': 'true'})
    j1 = r1.json()
    assert j1.get("restored") is True and j1.get("counts", {}).get("avaliacoes", 0) >= 1, \
        f"restore com confirm: ok + contagens: {j1.get('counts')}"
    assert bool(j1.get("pre_restore")), f"pré-restore registrado: {j1.get('pre_restore')}"

    r2 = admin.post('/api/admin/restore', files={'file': ('x.txt', b'nao-json', 'text/plain')},
                    data={'confirm': 'true'})
    assert r2.status_code == 400, f"arquivo inválido → 400: status={r2.status_code}"

    r3 = prof.post('/api/admin/restore', files={'file': ('bk.json', dump, 'application/json')},
                   data={'confirm': 'true'})
    assert r3.status_code == 403, "restore não-admin: 403"


if __name__ == "__main__":
    import pytest as _pytest
    import sys as _sys
    _sys.exit(_pytest.main([__file__, "-q"]))
