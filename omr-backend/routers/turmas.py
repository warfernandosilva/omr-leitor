"""Catálogo de turmas: CRUD + lista de alunos reutilizável entre provas.

Montado em main.py via `app.include_router(turmas_router)` — paths /api/turmas/*.

A materialização (turma → alunos da prova) vive em main.py
(POST /api/exams/{external_id}/students/from-turma), ao lado do import.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

import auth
from database import get_db
from models import Avaliacao, Turma, TurmaAluno, User

router = APIRouter()


class TurmaCreate(BaseModel):
    nome: str


class TurmaUpdate(BaseModel):
    nome: str


class TurmaAlunoIn(BaseModel):
    nome: str
    matricula: str | None = None
    identificador_externo: str | None = None


class TurmaAlunosImport(BaseModel):
    alunos: list[TurmaAlunoIn]


def _turma_to_dict(t: Turma, total_alunos: int | None = None) -> dict:
    d = {
        "id": t.id,
        "nome": t.nome,
        "owner_id": t.owner_id,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }
    if total_alunos is not None:
        d["total_alunos"] = total_alunos
    return d


def _aluno_to_dict(a: TurmaAluno) -> dict:
    return {
        "id": a.id,
        "turma_id": a.turma_id,
        "nome": a.nome,
        "matricula": a.matricula,
        "identificador_externo": a.identificador_externo,
    }


def _get_turma(db: Session, turma_id: int, current_user: User) -> Turma:
    turma = db.get(Turma, turma_id)
    if turma is None:
        raise HTTPException(status_code=404, detail="Turma não encontrada")
    auth.require_turma_owner_or_admin(turma, current_user)
    return turma


@router.get("/api/turmas")
def list_turmas(db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user)):
    """Lista as turmas visíveis ao usuário (dono ou admin) com contagem de alunos."""
    q = select(Turma).order_by(Turma.nome)
    if current_user.role != "admin":
        q = q.where((Turma.owner_id == current_user.id) | (Turma.owner_id.is_(None)))
    turmas = db.scalars(q).all()
    counts = dict(
        db.execute(
            select(TurmaAluno.turma_id, func.count())
            .where(TurmaAluno.turma_id.in_([t.id for t in turmas] or [-1]))
            .group_by(TurmaAluno.turma_id)
        ).all()
    )
    return {"turmas": [_turma_to_dict(t, counts.get(t.id, 0)) for t in turmas]}


@router.post("/api/turmas", status_code=201)
def create_turma(req: TurmaCreate, db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user)):
    nome = (req.nome or "").strip()
    if not nome:
        raise HTTPException(status_code=400, detail="Nome da turma é obrigatório")
    turma = Turma(nome=nome[:120], owner_id=current_user.id)
    db.add(turma)
    db.commit()
    db.refresh(turma)
    return _turma_to_dict(turma, 0)


@router.get("/api/turmas/{turma_id}")
def get_turma(turma_id: int, db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user)):
    turma = _get_turma(db, turma_id, current_user)
    alunos = db.scalars(
        select(TurmaAluno).where(TurmaAluno.turma_id == turma.id).order_by(TurmaAluno.id)
    ).all()
    d = _turma_to_dict(turma, len(alunos))
    d["alunos"] = [_aluno_to_dict(a) for a in alunos]
    return d


@router.patch("/api/turmas/{turma_id}")
def rename_turma(turma_id: int, req: TurmaUpdate, db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user)):
    turma = _get_turma(db, turma_id, current_user)
    nome = (req.nome or "").strip()
    if not nome:
        raise HTTPException(status_code=400, detail="Nome da turma é obrigatório")
    turma.nome = nome[:120]
    db.commit()
    db.refresh(turma)
    return _turma_to_dict(turma)


@router.delete("/api/turmas/{turma_id}")
def delete_turma(turma_id: int, db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user)):
    """Apaga o catálogo. NÃO apaga alunos/gabaritos já gerados nas provas —
    só desvincula (avaliacao.turma_id = NULL); o rótulo impresso (avaliacao.turma) permanece."""
    turma = _get_turma(db, turma_id, current_user)
    n_alunos = db.scalar(
        select(func.count()).select_from(TurmaAluno).where(TurmaAluno.turma_id == turma.id)
    ) or 0
    db.execute(update(Avaliacao).where(Avaliacao.turma_id == turma.id).values(turma_id=None))
    db.delete(turma)  # cascade apaga os TurmaAluno
    db.commit()
    return {"deleted": turma_id, "alunos_removidos": n_alunos}


@router.post("/api/turmas/{turma_id}/alunos", status_code=201)
def add_turma_aluno(
    turma_id: int, req: TurmaAlunoIn,
    db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user),
):
    turma = _get_turma(db, turma_id, current_user)
    nome = (req.nome or "").strip()
    if not nome:
        raise HTTPException(status_code=400, detail="Nome do aluno é obrigatório")
    aluno = TurmaAluno(
        turma_id=turma.id,
        nome=nome,
        matricula=(req.matricula or "").strip() or None,
        identificador_externo=req.identificador_externo,
    )
    db.add(aluno)
    db.commit()
    db.refresh(aluno)
    return _aluno_to_dict(aluno)


@router.post("/api/turmas/{turma_id}/alunos/import")
def import_turma_alunos(
    turma_id: int, req: TurmaAlunosImport,
    db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user),
):
    """Importa o lote para o catálogo com dedup por matrícula.

    - Linha com matrícula que já existe na turma → ATUALIZA (nome/identificador).
    - Linha sem matrícula → sempre cria (comportamento legado).
    - Linha sem nome válido → ignorada (contada, não falha o lote).
    """
    turma = _get_turma(db, turma_id, current_user)
    por_matricula = {
        a.matricula: a
        for a in db.scalars(
            select(TurmaAluno).where(
                TurmaAluno.turma_id == turma.id, TurmaAluno.matricula.is_not(None)
            )
        ).all()
    }
    criados = atualizados = ignorados = 0
    for item in req.alunos:
        nome = (item.nome or "").strip()
        if not nome:
            ignorados += 1
            continue
        mat = (item.matricula or "").strip() or None
        existente = por_matricula.get(mat) if mat else None
        if existente is not None:
            existente.nome = nome
            existente.identificador_externo = item.identificador_externo
            atualizados += 1
        else:
            novo = TurmaAluno(
                turma_id=turma.id,
                nome=nome,
                matricula=mat,
                identificador_externo=item.identificador_externo,
            )
            db.add(novo)
            criados += 1
            if mat:
                por_matricula[mat] = novo  # dedup também dentro do próprio lote
    db.commit()
    total = db.scalar(
        select(func.count()).select_from(TurmaAluno).where(TurmaAluno.turma_id == turma.id)
    ) or 0
    return {
        "turma_id": turma.id,
        "criados": criados,
        "atualizados": atualizados,
        "ignorados": ignorados,
        "total_alunos": total,
    }


@router.delete("/api/turmas/{turma_id}/alunos/{aluno_id}")
def delete_turma_aluno(
    turma_id: int, aluno_id: int,
    db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user),
):
    """Remove um aluno do catálogo. Não afeta provas (a materialização é cópia)."""
    turma = _get_turma(db, turma_id, current_user)
    aluno = db.get(TurmaAluno, aluno_id)
    if aluno is None or aluno.turma_id != turma.id:
        raise HTTPException(status_code=404, detail="Aluno não encontrado nesta turma")
    db.delete(aluno)
    db.commit()
    return {"deleted": aluno_id}
