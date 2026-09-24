"""Backup: export/restore roundtrip em banco isolado (SQLite)."""
import sys
sys.path.insert(0, '.')
import os
import tempfile
import json

_tmp = tempfile.mkdtemp(prefix="omr_backup_")
os.environ["OMR_DB_PATH"] = os.path.join(_tmp, "bk.db")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from database import init_db, SessionLocal
from models import Aluno, Avaliacao, DeletedExam, GabaritoNomeado, User

init_db()
db = SessionLocal()
u = User(email="b@example.com", nome="Backup", hashed_password="x", role="admin")
db.add(u); db.flush()
av = Avaliacao(external_id="exam-bk", titulo="Prova BK", turma="9A", owner_id=u.id,
               answer_key={"1": "A", "2": "B"})
db.add(av); db.flush()
al = Aluno(avaliacao_id=av.id, nome="Aluno BK", matricula="101")
db.add(al); db.flush()
g = GabaritoNomeado(avaliacao_id=av.id, aluno_id=al.id, codigo_unico="OMR-2026-000001",
                    qr_code_payload="OMR-2026-000001", status="gerado")
db.add(g)
t = DeletedExam(external_id="exam-morta", owner_id=u.id)
db.add(t); db.commit()
db.close()

from backup import export_all, backup_to_file, restore_all, restore_from_file

data = export_all()
assert data["counts"] == {"users": 1, "avaliacoes": 1, "alunos": 1, "gabaritos": 1, "tombstones": 1}, data["counts"]
print("   OK  export: contagens corretas", data["counts"])

# roundtrip via arquivo: grava, limpa o banco, restaura
p, _ = backup_to_file(os.path.join(_tmp, "dump.json"))
raw = json.loads(p.read_text(encoding="utf-8"))
assert raw["avaliacoes"][0]["answer_key"] == {"1": "A", "2": "B"}
print("   OK  arquivo: JSON fiel (answer_key preservada)")

n = restore_all(raw)
assert n == {"users": 1, "avaliacoes": 1, "alunos": 1, "gabaritos": 1, "tombstones": 1}, n
print("   OK  restore: upsert sem duplicar", n)

# upsert de novo (idempotente)
n2 = restore_all(raw)
assert n2 == n, n2
print("   OK  restore idempotente")

# conferência: dados continuam lá
db = SessionLocal()
av2 = db.query(Avaliacao).filter_by(external_id="exam-bk").one()
assert av2.answer_key == {"1": "A", "2": "B"}
assert db.query(GabaritoNomeado).filter_by(codigo_unico="OMR-2026-000001").count() == 1
db.close()
print("   OK  dados íntegros após restore")

print("BACKUP PASS")
