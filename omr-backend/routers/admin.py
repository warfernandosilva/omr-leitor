"""Rotas administrativas: backup/restore do banco e gestão de usuários.

Montado em main.py via `app.include_router(admin_router)` — paths inalterados (/api/admin/*).
"""
from __future__ import annotations

import json as _json
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

import auth
from database import get_db
from models import Avaliacao, User

router = APIRouter()


def _require_admin(current_user: User = Depends(auth.get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores")
    return current_user


def _json_dumps(obj: dict) -> str:
    return _json.dumps(obj, ensure_ascii=False)


@router.get("/api/admin/backup")
def admin_backup(admin: User = Depends(_require_admin)):
    """Gera o dump portátil na hora e devolve para download.

    O arquivo contém hashes de senha — nunca commitar, nunca expor.
    """
    from backup import BACKUP_DIR, backup_to_file
    stamp = datetime.now().strftime("%Y-%m-%d-%H%M%S")
    path, counts = backup_to_file(BACKUP_DIR / f"backup-omr-{stamp}.json")
    return FileResponse(
        path,
        media_type="application/json",
        filename=path.name,
        headers={"X-Backup-Counts": _json_dumps(counts)},
    )


@router.post("/api/admin/restore")
async def admin_restore(
    file: UploadFile = File(...),
    confirm: bool = Form(False),
    admin: User = Depends(_require_admin),
):
    """Restaura um dump (upsert por id). Exige confirm=true.

    Antes de restaurar, grava backup pré-restore automático em backups/.
    """
    if not confirm:
        return {"restored": False,
                "error": "Confirmação exigida: reenvie com confirm=true. O restore atualiza registros existentes."}
    contents = await file.read()
    if not contents or len(contents) > 50 * 1024 * 1024:
        return {"restored": False, "error": "Arquivo vazio ou maior que 50MB."}
    try:
        data = _json.loads(contents.decode("utf-8"))
    except Exception:
        return {"restored": False, "error": "Arquivo inválido (não é um JSON de backup)."}
    if not isinstance(data, dict) or "avaliacoes" not in data:
        return {"restored": False, "error": "JSON não parece um backup OMR (sem tabela 'avaliacoes')."}
    try:
        from backup import BACKUP_DIR, backup_to_file, restore_all
        pre, _ = backup_to_file(
            BACKUP_DIR / f"pre-restore-{datetime.now().strftime('%Y-%m-%d-%H%M%S')}.json")
    except Exception as e:
        return {"restored": False, "error": f"Falha no backup pré-restore ({type(e).__name__}) — nada foi alterado."}
    try:
        counts = restore_all(data)
    except ValueError as e:
        return {"restored": False, "error": str(e)}
    except Exception as e:
        return {"restored": False, "error": f"Falha no restore ({type(e).__name__}) — rollback aplicado."}
    return {"restored": True, "counts": counts, "pre_restore": pre.name}


@router.get("/api/admin/users")
def admin_list_users(admin: User = Depends(_require_admin), db: Session = Depends(get_db)):
    users = db.scalars(select(User).order_by(User.created_at)).all()
    # conta avaliações por dono para o painel
    counts = dict(db.execute(select(Avaliacao.owner_id, func.count()).group_by(Avaliacao.owner_id)).all())
    return [
        {
            "id": u.id,
            "email": u.email,
            "nome": u.nome,
            "role": u.role,
            "is_active": u.is_active,
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "avaliacoes": counts.get(u.id, 0),
        }
        for u in users
    ]


class AdminUpdateUserRequest(BaseModel):
    role: str | None = None
    is_active: bool | None = None
    password: str | None = None


@router.patch("/api/admin/users/{user_id}")
def admin_update_user(user_id: int, req: AdminUpdateUserRequest, admin: User = Depends(_require_admin), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if user.id == admin.id and req.is_active is False:
        raise HTTPException(status_code=400, detail="Não é possível desativar a própria conta")
    if req.role is not None:
        if req.role not in ("admin", "professor"):
            raise HTTPException(status_code=400, detail="role deve ser 'admin' ou 'professor'")
        # impede remover o último admin
        if user.role == "admin" and req.role != "admin":
            admin_count = db.scalar(select(func.count()).select_from(User).where(User.role == "admin")) or 0
            if admin_count <= 1:
                raise HTTPException(status_code=400, detail="Deve haver ao menos um administrador")
        user.role = req.role
    if req.is_active is not None:
        user.is_active = req.is_active
    if req.password is not None:
        if len(req.password.strip()) < 4:
            raise HTTPException(status_code=400, detail="Senha deve ter ao menos 4 caracteres")
        user.hashed_password = auth.hash_password(req.password.strip())
    db.commit()
    db.refresh(user)
    return {"id": user.id, "email": user.email, "nome": user.nome, "role": user.role, "is_active": user.is_active}


@router.delete("/api/admin/users/{user_id}")
def admin_delete_user(user_id: int, admin: User = Depends(_require_admin), db: Session = Depends(get_db)):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Não é possível excluir a própria conta")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    # avaliações do usuário viram órfãs (visíveis para todos) em vez de apagar dados de provas
    db.execute(update(Avaliacao).where(Avaliacao.owner_id == user_id).values(owner_id=None))
    db.delete(user)
    db.commit()
    return {"deleted": True, "id": user_id}
