"""Backup portátil do banco (SQLAlchemy, sem pg_dump): export/restore JSON.

O dump é um dict JSON com todas as tabelas — portátil entre Postgres e
SQLite, restaurável por id. Segredos de senha (hashes) vão junto para
preservar logins; o arquivo NUNCA deve ir para o Git.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select

from database import SessionLocal
from models import Aluno, Avaliacao, DeletedExam, GabaritoNomeado, User

BACKUP_VERSION = 1

# Dir absoluta (não depende do CWD: Agendador/Docker/systemd mudam o cwd)
BASE_DIR = Path(__file__).resolve().parent
BACKUP_DIR = BASE_DIR / "backups"


def _dt(v: datetime | None) -> str | None:
    return v.isoformat() if v else None


def export_all() -> dict:
    """Serializa todas as tabelas para um dict JSON portátil."""
    db = SessionLocal()
    try:
        users = []
        for u in db.scalars(select(User)).all():
            users.append({
                "id": u.id, "email": u.email, "nome": u.nome,
                "hashed_password": u.hashed_password, "role": u.role,
                "is_active": bool(u.is_active), "created_at": _dt(u.created_at),
            })
        avaliacoes = []
        for a in db.scalars(select(Avaliacao)).all():
            avaliacoes.append({
                "id": a.id, "external_id": a.external_id, "titulo": a.titulo,
                "turma": a.turma, "modelo_omr": a.modelo_omr,
                "subject_lp": a.subject_lp, "subject_mat": a.subject_mat,
                "questions_per_subject": a.questions_per_subject,
                "layout_mode": a.layout_mode, "template": a.template,
                "sae_spec": a.sae_spec, "grade_scale": a.grade_scale,
                "answer_key": a.answer_key, "owner_id": a.owner_id,
                "created_at": _dt(a.created_at), "updated_at": _dt(a.updated_at),
            })
        alunos = []
        for al in db.scalars(select(Aluno)).all():
            alunos.append({
                "id": al.id, "avaliacao_id": al.avaliacao_id, "nome": al.nome,
                "matricula": al.matricula,
                "identificador_externo": al.identificador_externo,
                "created_at": _dt(al.created_at), "updated_at": _dt(al.updated_at),
            })
        gabaritos = []
        for g in db.scalars(select(GabaritoNomeado)).all():
            gabaritos.append({
                "id": g.id, "avaliacao_id": g.avaliacao_id, "aluno_id": g.aluno_id,
                "codigo_unico": g.codigo_unico, "qr_code_payload": g.qr_code_payload,
                "numero_pagina": g.numero_pagina, "status": g.status,
                "respostas": g.respostas, "acertos": g.acertos, "erros": g.erros,
                "brancos": g.brancos, "nota": g.nota, "observacoes": g.observacoes,
                "data_geracao": _dt(g.data_geracao), "data_leitura": _dt(g.data_leitura),
                "data_correcao": _dt(g.data_correcao),
                "created_at": _dt(g.created_at), "updated_at": _dt(g.updated_at),
            })
        tombstones = []
        for t in db.scalars(select(DeletedExam)).all():
            tombstones.append({
                "id": t.id, "external_id": t.external_id, "owner_id": t.owner_id,
                "deleted_at": _dt(t.deleted_at),
            })
        return {
            "backup_version": BACKUP_VERSION,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "counts": {
                "users": len(users), "avaliacoes": len(avaliacoes),
                "alunos": len(alunos), "gabaritos": len(gabaritos),
                "tombstones": len(tombstones),
            },
            "users": users,
            "avaliacoes": avaliacoes,
            "alunos": alunos,
            "gabaritos": gabaritos,
            "tombstones": tombstones,
        }
    finally:
        db.close()


def backup_to_file(path: str | Path) -> tuple[Path, dict]:
    """Exporta e grava o backup. Devolve (arquivo, resumo)."""
    data = export_all()
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return p, data["counts"]


def restore_all(data: dict) -> dict:
    """Restaura registros por id (upsert). Devolve contagens.

    - Registro que já existe é ATUALIZADO (não duplicado);
    -FKs são restauradas como vieram (users → avaliacoes → alunos/gabaritos).
    """
    if int(data.get("backup_version", 0)) > BACKUP_VERSION:
        raise ValueError("Backup de versão mais nova que o sistema")
    db = SessionLocal()
    n = {"users": 0, "avaliacoes": 0, "alunos": 0, "gabaritos": 0, "tombstones": 0}
    try:
        for u in data.get("users", []):
            obj = db.get(User, u["id"])
            if obj is None:
                obj = User(id=u["id"])
                db.add(obj)
            obj.email = u["email"]
            obj.nome = u["nome"]
            obj.hashed_password = u["hashed_password"]
            obj.role = u.get("role", "professor")
            obj.is_active = bool(u.get("is_active", True))
            n["users"] += 1
        db.flush()
        for a in data.get("avaliacoes", []):
            obj = db.get(Avaliacao, a["id"])
            if obj is None:
                obj = Avaliacao(id=a["id"])
                db.add(obj)
            obj.external_id = a["external_id"]
            obj.titulo = a["titulo"]
            obj.turma = a.get("turma")
            obj.modelo_omr = a.get("modelo_omr", "GABARITO_01")
            obj.subject_lp = a.get("subject_lp", "PORTUGUÊS")
            obj.subject_mat = a.get("subject_mat", "MATEMÁTICA")
            obj.questions_per_subject = a.get("questions_per_subject", 22)
            obj.layout_mode = a.get("layout_mode", "dual")
            obj.template = a.get("template", "padrao")
            obj.sae_spec = a.get("sae_spec")
            obj.grade_scale = a.get("grade_scale", "0-10")
            obj.answer_key = a.get("answer_key")
            obj.owner_id = a.get("owner_id")
            n["avaliacoes"] += 1
        db.flush()
        for al in data.get("alunos", []):
            obj = db.get(Aluno, al["id"])
            if obj is None:
                obj = Aluno(id=al["id"])
                db.add(obj)
            obj.avaliacao_id = al["avaliacao_id"]
            obj.nome = al["nome"]
            obj.matricula = al.get("matricula")
            obj.identificador_externo = al.get("identificador_externo")
            n["alunos"] += 1
        db.flush()
        for g in data.get("gabaritos", []):
            obj = db.get(GabaritoNomeado, g["id"])
            if obj is None:
                obj = GabaritoNomeado(id=g["id"])
                db.add(obj)
            obj.avaliacao_id = g["avaliacao_id"]
            obj.aluno_id = g["aluno_id"]
            obj.codigo_unico = g["codigo_unico"]
            obj.qr_code_payload = g["qr_code_payload"]
            obj.numero_pagina = g.get("numero_pagina", 0)
            obj.status = g.get("status", "gerado")
            obj.respostas = g.get("respostas")
            obj.acertos = g.get("acertos")
            obj.erros = g.get("erros")
            obj.brancos = g.get("brancos")
            obj.nota = g.get("nota")
            obj.observacoes = g.get("observacoes")
            n["gabaritos"] += 1
        db.flush()
        for t in data.get("tombstones", []):
            obj = db.scalar(select(DeletedExam).where(DeletedExam.external_id == t["external_id"]))
            if obj is None:
                try:
                    obj = DeletedExam(external_id=t["external_id"], owner_id=t.get("owner_id"))
                    db.add(obj)
                    db.flush()
                except Exception:
                    db.rollback()
                    continue
            n["tombstones"] += 1
        db.commit()
        return n
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def restore_from_file(path: str | Path) -> dict:
    return restore_all(json.loads(Path(path).read_text(encoding="utf-8")))


def _backup_lock():
    """Lock anti-concorrência (2 agendadores / boot duplo). Devolve o Path ou None.

    Lock obsoleto (>1h, ex.: PC desligou no meio) é considerado órfão e roubado.
    """
    import os
    import time
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    lock = BACKUP_DIR / "backup.lock"
    try:
        os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        return lock
    except FileExistsError:
        pass
    try:
        age = time.time() - lock.stat().st_mtime
    except OSError:
        age = 0
    if age < 3600:
        return None  # outro backup em andamento
    lock.unlink(missing_ok=True)
    try:
        os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        return lock
    except FileExistsError:
        return None


def daily_backup(keep: int = 30) -> tuple[Path, dict]:
    """Backup diário com rotação: backups/omr-AAAA-MM-DD.json, mantém `keep`."""
    from datetime import date
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    lock = _backup_lock()
    if lock is None:
        raise RuntimeError("outro backup em andamento (backup.lock) — pulando")
    try:
        stamp = date.today().isoformat()
        path, counts = backup_to_file(BACKUP_DIR / f"omr-{stamp}.json")
        kept = sorted(BACKUP_DIR.glob("omr-*.json"))
        for old in kept[:max(0, len(kept) - keep)]:
            try:
                old.unlink()
            except OSError:
                pass
        return path, counts
    finally:
        lock.unlink(missing_ok=True)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="Backup portátil do banco OMR")
    ap.add_argument("--daily", action="store_true", help="backup diário com rotação (backups/omr-AAAA-MM-DD.json)")
    ap.add_argument("--file", default="", help="caminho do dump (default: backups/omr-<data>.json)")
    ap.add_argument("--keep", type=int, default=30, help="dumps diários a manter")
    args = ap.parse_args()
    if args.daily:
        p, counts = daily_backup(keep=args.keep)
    else:
        from datetime import datetime
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        p, counts = backup_to_file(args.file or str(BACKUP_DIR / f"omr-{datetime.now().strftime('%Y-%m-%d-%H%M')}.json"))
    print(f"backup: {p} {counts}")
