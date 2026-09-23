"""Rotas admin de backup: download, restore com confirmação, pré-restore."""
import sys
sys.path.insert(0, '.')
import os
import tempfile

_tmp = tempfile.mkdtemp(prefix='omr_bkroutes_')
os.environ['OMR_DB_PATH'] = os.path.join(_tmp, 'r.db')

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from fastapi.testclient import TestClient
import main as main_module

PASS, FAIL = [], []


def check(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(f"   {'OK ' if cond else 'FALHA'}  {name} {extra}")


def make_client(email, role="professor"):
    c = TestClient(main_module.app)
    r = c.post('/api/auth/register', json={'email': email, 'nome': 'T', 'password': '123456'})
    if r.status_code == 400:
        r = c.post('/api/auth/login', data={'username': email, 'password': '123456'})
    assert r.status_code == 200, r.text
    tok = r.json()['access_token']
    if role == "admin":
        # promove via banco isolado
        from database import SessionLocal
        from models import User
        db = SessionLocal()
        u = db.query(User).filter_by(email=email).one()
        u.role = "admin"
        db.commit(); db.close()
        r = c.post('/api/auth/login', data={'username': email, 'password': '123456'})
        tok = r.json()['access_token']
    c.headers.update({'Authorization': f"Bearer {tok}"})
    return c


admin = make_client('adm@example.com', 'admin')
prof = make_client('prof@example.com', 'professor')

# cria 1 avaliação p/ ter conteúdo
s = admin.post('/api/exams/sync', json={'external_id': 'exam-bk', 'titulo': 'BK',
                                        'turma': '9A', 'template': 'padrao'})
assert s.status_code == 200, s.text

b = admin.get('/api/admin/backup')
check("download: 200 + JSON com 4 tabelas",
      b.status_code == 200 and all(k in b.json() for k in ("users", "avaliacoes", "alunos", "gabaritos")),
      f"status={b.status_code}")
check("download: filename", "backup-omr-" in (b.headers.get("content-disposition") or ""))

dump = b.content

p403 = prof.get('/api/admin/backup')
check("não-admin: 403", p403.status_code == 403)

r0 = admin.post('/api/admin/restore', files={'file': ('bk.json', dump, 'application/json')})
check("restore sem confirm: recusado", r0.json().get("restored") is False and "confirm" in (r0.json().get("error") or "").lower())

r1 = admin.post('/api/admin/restore', files={'file': ('bk.json', dump, 'application/json')},
                data={'confirm': 'true'})
j1 = r1.json()
check("restore com confirm: ok + contagens", j1.get("restored") is True and j1.get("counts", {}).get("avaliacoes", 0) >= 1, str(j1.get("counts")))
check("pré-restore registrado", bool(j1.get("pre_restore")), str(j1.get("pre_restore")))

r2 = admin.post('/api/admin/restore', files={'file': ('x.txt', b'nao-json', 'text/plain')},
                data={'confirm': 'true'})
check("arquivo inválido: recusado", r2.json().get("restored") is False)

r3 = prof.post('/api/admin/restore', files={'file': ('bk.json', dump, 'application/json')},
               data={'confirm': 'true'})
check("restore não-admin: 403", r3.status_code == 403)

print(f"\nBACKUP ROUTES: {len(PASS)} OK | {len(FAIL)} FALHA")
if FAIL:
    print("FALHAS:", FAIL)
    sys.exit(1)
print("BACKUP ROUTES PASS")
