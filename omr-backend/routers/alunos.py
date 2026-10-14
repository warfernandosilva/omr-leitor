"""Lista global de alunos do catálogo (somente leitura).

Agrega os TurmaAluno de todas as turmas visíveis ao usuário — base da
tela "Alunos". A escrita continua nos endpoints de turmas
(POST /api/turmas/{id}/alunos, import etc.).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

import auth
from database import get_db
from models import Turma, TurmaAluno, User

router = APIRouter()


def _aluno_to_dict(a: TurmaAluno, turma_nome: str | None) -> dict:
    return {
        "id": a.id,
        "nome": a.nome,
        "matricula": a.matricula,
        "identificador_externo": a.identificador_externo,
        "turma_id": a.turma_id,
        "turma_nome": turma_nome,
    }


@router.get("/api/alunos")
def list_alunos(
    search: str | None = Query(default=None, max_length=120),
    turma_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """Alunos do catálogo de todas as turmas visíveis (dono ou admin)."""
    q = (
        select(TurmaAluno, Turma.nome)
        .join(Turma, Turma.id == TurmaAluno.turma_id)
        .order_by(Turma.nome, TurmaAluno.nome)
    )
    if current_user.role != "admin":
        q = q.where((Turma.owner_id == current_user.id) | (Turma.owner_id.is_(None)))
    if turma_id is not None:
        q = q.where(TurmaAluno.turma_id == turma_id)
    if search and search.strip():
        like = f"%{search.strip()}%"
        q = q.where(
            or_(
                TurmaAluno.nome.ilike(like),
                TurmaAluno.matricula.ilike(like),
                TurmaAluno.identificador_externo.ilike(like),
            )
        )
    rows = db.execute(q).all()
    return {"alunos": [_aluno_to_dict(a, tn) for a, tn in rows]}
