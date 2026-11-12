"""Catálogo de turmas: CRUD + lista de alunos reutilizável entre provas.

Montado em main.py via `app.include_router(turmas_router)` — paths /api/turmas/*.

A materialização (turma → alunos da prova) vive em main.py
(POST /api/exams/{external_id}/students/from-turma), ao lado do import.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
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
    nome: str | None = None
    ano_letivo: str | None = None
    arquivada: bool | None = None


class TurmaAlunoIn(BaseModel):
    nome: str
    matricula: str | None = None
    identificador_externo: str | None = None


class TurmaAlunosImport(BaseModel):
    alunos: list[TurmaAlunoIn]


class TurmaAlunoUpdate(BaseModel):
    """Edição de um aluno do catálogo.

    Campo ausente (None) mantém o valor atual; campo com string vazia limpa
    (matrícula/identificador voltam a NULL). `nova_turma_id` move o aluno.
    """

    nome: str | None = None
    matricula: str | None = None
    identificador_externo: str | None = None
    nova_turma_id: int | None = None


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
    """Lista as turmas visíveis ao usuário (dono ou admin) com contagem de alunos.

    `arquivadas=false` (padrão) esconde as arquivadas; `arquivadas=true` lista
    só as arquivadas; `arquivadas=all` traz as duas coisas.
    """
    arquivadas = Query(default="false", max_length=5)
    q = select(Turma).where(auth.owner_clause(Turma, current_user)).order_by(Turma.nome)
    if arquivadas == "true":
        q = q.where(Turma.arquivada.is_(True))
    elif arquivadas == "false":
        q = q.where(Turma.arquivada.is_(False))
    turmas = db.scalars(q).all()
    counts = dict(
        db.execute(
            select(TurmaAluno.turma_id, func.count())
            .where(TurmaAluno.turma_id.in_([t.id for t in turmas] or [-1]))
            .group_by(TurmaAluno.turma_id)
        ).all()
    )
    saida = []
    for t in turmas:
        d = _turma_to_dict(t, counts.get(t.id, 0))
        d["ano_letivo"] = t.ano_letivo
        d["arquivada"] = t.arquivada
        saida.append(d)
    return {"turmas": saida}


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
    """Edita a turma: nome, ano letivo e arquivamento (um ou vários campos)."""
    turma = _get_turma(db, turma_id, current_user)
    if req.nome is not None:
        nome = (req.nome or "").strip()
        if not nome:
            raise HTTPException(status_code=400, detail="Nome da turma é obrigatório")
        turma.nome = nome[:120]
    if req.ano_letivo is not None:
        turma.ano_letivo = (req.ano_letivo or "").strip() or None
    if req.arquivada is not None:
        turma.arquivada = req.arquivada
    db.commit()
    db.refresh(turma)
    d = _turma_to_dict(turma)
    d["ano_letivo"] = turma.ano_letivo
    d["arquivada"] = turma.arquivada
    return d


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


class TurmaAlunoSituacao(BaseModel):
    situacao: str  # ativo | inativo | transferido


@router.patch("/api/turmas/{turma_id}/alunos/{aluno_id}/situacao")
def set_turma_aluno_situacao(
    turma_id: int, aluno_id: int, req: TurmaAlunoSituacao,
    db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user),
):
    """Marca a situação do aluno no catálogo (ativo, inativo ou transferido)."""
    turma = _get_turma(db, turma_id, current_user)
    aluno = db.get(TurmaAluno, aluno_id)
    if aluno is None or aluno.turma_id != turma.id:
        raise HTTPException(status_code=404, detail="Aluno não encontrado nesta turma")
    situacao = (req.situacao or "").strip().lower()
    if situacao not in ("ativo", "inativo", "transferido"):
        raise HTTPException(status_code=400, detail="Situação deve ser ativo, inativo ou transferido")
    aluno.situacao = situacao
    db.commit()
    db.refresh(aluno)
    return _aluno_to_dict(aluno)


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


@router.patch("/api/turmas/{turma_id}/alunos/{aluno_id}")
def update_turma_aluno(
    turma_id: int, aluno_id: int, req: TurmaAlunoUpdate,
    db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user),
):
    """Edita nome/matrícula/identificador e, opcionalmente, move de turma.

    Regras (espelham o import):
    - nome vazio → 400 (não existe aluno sem nome).
    - matrícula vazia limpa o campo; matrícula já usada por OUTRO aluno da
      turma de destino → 400 (evita duplicidade silenciosa no catálogo).
    - `nova_turma_id` aceita só turma visível ao usuário (dono ou admin).

    A materialização é cópia: alunos já importados em provas NÃO são alterados
    aqui — apenas o catálogo muda (ver students/from-turma).
    """
    turma = _get_turma(db, turma_id, current_user)
    aluno = db.get(TurmaAluno, aluno_id)
    if aluno is None or aluno.turma_id != turma.id:
        raise HTTPException(status_code=404, detail="Aluno não encontrado nesta turma")

    destino = turma
    if req.nova_turma_id is not None and req.nova_turma_id != turma.id:
        destino = _get_turma(db, req.nova_turma_id, current_user)

    nome = aluno.nome if req.nome is None else (req.nome or "").strip()
    if not nome:
        raise HTTPException(status_code=400, detail="Nome do aluno é obrigatório")
    matricula = aluno.matricula if req.matricula is None else ((req.matricula or "").strip() or None)

    if matricula:
        choque = db.scalar(
            select(TurmaAluno.id).where(
                TurmaAluno.turma_id == destino.id,
                TurmaAluno.matricula == matricula,
                TurmaAluno.id != aluno.id,
            )
        )
        if choque is not None:
            raise HTTPException(
                status_code=400,
                detail="Já existe outro aluno com esta matrícula na turma de destino",
            )

    aluno.nome = nome[:200]
    aluno.matricula = matricula
    if req.identificador_externo is not None:
        aluno.identificador_externo = (req.identificador_externo or "").strip() or None
    aluno.turma_id = destino.id
    db.commit()
    db.refresh(aluno)
    return {**_aluno_to_dict(aluno), "turma_nome": destino.nome}
