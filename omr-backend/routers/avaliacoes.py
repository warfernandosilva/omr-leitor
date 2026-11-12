"""Avaliações: ciclo de vida, etapas, provas reutilizáveis e auditoria.

Montado em main.py — paths /api/avaliacoes/* e /api/provas/*.

Separação de papéis:
- PROVA (`provas`): estrutura reutilizável (questões, layout, escala).
- AVALIAÇÃO (`avaliacoes`): aplicação da prova a uma ou várias turmas, com
  participantes, cartões, leituras e resultados.

Os endpoints existentes (/api/exams/*) são preservados — este router apenas
adiciona a visão de processo (status/etapas/próxima ação) e a reutilização.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

import auth
from database import get_db
from models import (
    Aluno,
    Avaliacao,
    AvaliacaoTurma,
    Auditoria,
    GabaritoNomeado,
    GabaritoVersao,
    Leitura,
    Prova,
    RevisaoManual,
    Turma,
    TurmaAluno,
    User,
)
from workflow import status as wf

router = APIRouter()


# ─── Schemas ───


class AvaliacaoCreate(BaseModel):
    titulo: str
    descricao: str | None = None
    ano_letivo: str | None = None
    # Criação a partir de uma prova existente (reutilização)…
    prova_id: int | None = None
    prova_external_id: str | None = None
    # …ou criando a prova junto (estrutura embutida).
    subjectLP: str | None = None
    subjectMat: str | None = None
    questionsPerSubject: int | None = None
    layoutMode: str | None = None
    template: str | None = None
    gradeScale: str | None = None
    customTemplateId: int | None = None
    turma_ids: list[int] = []


class AvaliacaoUpdate(BaseModel):
    titulo: str | None = None
    descricao: str | None = None
    ano_letivo: str | None = None


class StatusUpdate(BaseModel):
    status: str


class TurmaVinculo(BaseModel):
    turma_id: int


class GabaritoUpdate(BaseModel):
    answer_key: dict[int, str]
    observacao: str | None = None


class RevisaoPayload(BaseModel):
    respostas: dict[int, str] = {}
    observacao: str | None = None


# ─── Helpers ───


def _prova_to_dict(p: Prova) -> dict:
    return {
        "id": p.id,
        "external_id": p.external_id,
        "titulo": p.titulo,
        "descricao": p.descricao,
        "disciplina": p.disciplina,
        "subject_lp": p.subject_lp,
        "subject_mat": p.subject_mat,
        "questions_per_subject": p.questions_per_subject,
        "total_questions": (
            p.questions_per_subject if p.layout_mode == "single" else p.questions_per_subject * 2
        ),
        "layout_mode": p.layout_mode,
        "template": p.template,
        "grade_scale": p.grade_scale,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


def _auditar(
    db: Session,
    user: User | None,
    entidade: str,
    entidade_id: str,
    acao: str,
    resumo: str | None = None,
    antes: dict | None = None,
    depois: dict | None = None,
) -> None:
    db.add(Auditoria(
        entidade=entidade,
        entidade_id=str(entidade_id),
        acao=acao,
        resumo=resumo,
        antes=antes,
        depois=depois,
        autor_id=user.id if user else None,
        autor_nome=user.nome if user else None,
    ))


def _get_avaliacao(db: Session, external_id: str) -> Avaliacao:
    av = db.scalar(select(Avaliacao).where(Avaliacao.external_id == external_id))
    if av is None:
        raise HTTPException(status_code=404, detail="Avaliação não encontrada")
    return av


def _status_efetivo(av: Avaliacao, derivado: str) -> str:
    """Estado que o usuário vê: o mais avançado entre o registrado e o derivado.

    O status derivado vem dos dados (cartões, leituras, correções) e avança
    sozinho; o registrado cobre o que os dados não provam (cartão impresso,
    prova em aplicação, arquivamento). Comparar os dois evita recusar uma
    transição que a tela já mostra como disponível.
    """
    registrado = (av.status or wf.RASCUNHO).strip()
    if registrado == wf.ARQUIVADA or derivado == wf.ARQUIVADA:
        return wf.ARQUIVADA
    try:
        return registrado if wf.STATUS_ORDEM.index(registrado) > wf.STATUS_ORDEM.index(derivado) else derivado
    except ValueError:
        return derivado


def _turmas_da_avaliacao(db: Session, av: Avaliacao) -> list[dict]:
    """Turmas participantes: da junção N:N, com fallback para o vínculo legado."""
    vinculos = db.scalars(
        select(AvaliacaoTurma).where(AvaliacaoTurma.avaliacao_id == av.id)
    ).all()
    ids = [v.turma_id for v in vinculos]
    if not ids and av.turma_id is not None:
        ids = [av.turma_id]
    if not ids:
        return []
    turmas = db.scalars(select(Turma).where(Turma.id.in_(ids))).all()
    return [{"id": t.id, "nome": t.nome, "ano_letivo": t.ano_letivo, "arquivada": t.arquivada}
            for t in turmas]


def _revisoes_pendentes(db: Session, avaliacao_id: int) -> int:
    """Leituras pendentes que ainda importam: a MAIS RECENTE de cada cartão.

    Regra: reprocessar um cartão cria uma leitura nova (com `parent_id`) que
    substitui a anterior — a leitura antiga, mesmo pendente, não conta mais.
    `id` autoincremento é a ordem confiável: `created_at` pode repetir no
    mesmo segundo entre duas leituras do mesmo cartão.
    """
    linhas = db.execute(
        select(Leitura.id, Leitura.gabarito_id, Leitura.status)
        .where(Leitura.avaliacao_id == avaliacao_id)
        .order_by(Leitura.id)
    ).all()
    ultima_por_cartao: dict[str, str] = {}
    for leitura_id, gabarito_id, status in linhas:
        # cartão sem gabarito (leitura avulsa) conta individualmente
        chave = str(gabarito_id) if gabarito_id is not None else f"solto-{leitura_id}"
        ultima_por_cartao[chave] = status          # id crescente: o último vence
    return sum(1 for st in ultima_por_cartao.values() if st == Leitura.STATUS_PENDENTE)


def _contadores(db: Session, av: Avaliacao) -> wf.Contadores:
    turmas = _turmas_da_avaliacao(db, av)
    probe = db.get(Prova, av.prova_id) if av.prova_id else None
    gab = db.scalar(select(func.count()).select_from(GabaritoNomeado)
                    .where(GabaritoNomeado.avaliacao_id == av.id)) or 0
    lidos = db.scalar(select(func.count()).select_from(GabaritoNomeado).where(
        GabaritoNomeado.avaliacao_id == av.id,
        GabaritoNomeado.status.in_([GabaritoNomeado.STATUS_LIDO, GabaritoNomeado.STATUS_CORRIGIDO]),
    )) or 0
    corrigidos = db.scalar(select(func.count()).select_from(GabaritoNomeado).where(
        GabaritoNomeado.avaliacao_id == av.id,
        GabaritoNomeado.status == GabaritoNomeado.STATUS_CORRIGIDO,
    )) or 0
    recebidos = db.scalar(select(func.count()).select_from(GabaritoNomeado).where(
        GabaritoNomeado.avaliacao_id == av.id,
        GabaritoNomeado.data_leitura.is_not(None),
    )) or 0
    # Leituras registradas pelo fluxo novo. A pendencia e da leitura MAIS
    # RECENTE de cada cartao: reprocessar um cartao nao pode deixar pendencia
    # fantasma da leitura anterior (a nova e a vigente).
    revisoes = _revisoes_pendentes(db, av.id)
    versao = db.scalar(select(func.max(GabaritoVersao.versao))
                       .where(GabaritoVersao.avaliacao_id == av.id))
    return wf.Contadores(
        alunos=db.scalar(select(func.count()).select_from(Aluno)
                         .where(Aluno.avaliacao_id == av.id)) or 0,
        turmas=len(turmas),
        tem_gabarito=bool(av.answer_key),
        gabarito_versao=versao,
        cartoes_gerados=gab,
        cartoes_recebidos=recebidos or lidos,
        cartoes_lidos=lidos,
        cartoes_corrigidos=corrigidos,
        revisoes_pendentes=revisoes,
        resultados_publicados=1 if av.resultados_publicados_em else 0,
        resultados_publicados_em=av.resultados_publicados_em.isoformat() if av.resultados_publicados_em else None,
        arquivada=av.status == wf.ARQUIVADA,
    )


def _avaliacao_to_dict(db: Session, av: Avaliacao, com_etapas: bool = True) -> dict:
    fluxo = wf.calcular_fluxo(_contadores(db, av))
    d: dict = {
        "id": av.id,
        "external_id": av.external_id,
        "titulo": av.titulo,
        "descricao": av.descricao,
        "ano_letivo": av.ano_letivo,
        "turma": av.turma,
        "turma_id": av.turma_id,
        "custom_template_id": av.custom_template_id,
        "modelo_omr": getattr(av, "modelo_omr", None),
        "template": av.template,
        "layout_mode": av.layout_mode,
        "questions_per_subject": av.questions_per_subject,
        "subject_lp": av.subject_lp,
        "subject_mat": av.subject_mat,
        "grade_scale": av.grade_scale,
        "answer_key": av.answer_key,
        "gabarito_versao": fluxo_gabarito_versao(db, av),
        "status_derivado": fluxo.status,
        "status_label": wf.STATUS_LABEL[fluxo.status],
        "status_registrado": av.status,
        "status_efetivo": _status_efetivo(av, fluxo.status),
        "etapas": [
            {
                "id": e.id,
                "label": e.label,
                "status": e.status,
                "detalhe": e.detalhe,
                "acao": e.acao,
                "habilitada": e.habilitada,
                "bloqueio": e.bloqueio,
            }
            for e in fluxo.etapas
        ] if com_etapas else None,
        "proxima_acao": (
            {"etapa": fluxo.proxima_acao.id, "acao": fluxo.proxima_acao.acao}
            if fluxo.proxima_acao else None
        ),
        "bloqueios": fluxo.bloqueios,
        "progresso": fluxo.progresso,
        "resultados_publicados_em": (
            av.resultados_publicados_em.isoformat() if av.resultados_publicados_em else None
        ),
        "created_at": av.created_at.isoformat() if av.created_at else None,
        "updated_at": av.updated_at.isoformat() if av.updated_at else None,
    }
    if com_etapas:
        d["prova"] = _prova_to_dict(db.get(Prova, av.prova_id)) if av.prova_id else None
        d["turmas"] = _turmas_da_avaliacao(db, av)
    return d


def fluxo_gabarito_versao(db: Session, av: Avaliacao) -> int | None:
    return db.scalar(select(func.max(GabaritoVersao.versao))
                     .where(GabaritoVersao.avaliacao_id == av.id))


# ─── Provas (estrutura reutilizável) ───


@router.get("/api/provas")
def list_provas(
    q: str | None = Query(default=None, max_length=120),
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """Provas visíveis ao usuário — estrutura reutilizável entre avaliações."""
    query = select(Prova).where(auth.owner_clause(Prova, current_user)).order_by(Prova.created_at.desc())
    if q and q.strip():
        like = f"%{q.strip()}%"
        query = query.where(Prova.titulo.ilike(like))
    provas = db.scalars(query).all()
    uso = dict(
        db.execute(
            select(Avaliacao.prova_id, func.count())
            .where(Avaliacao.prova_id.in_([p.id for p in provas] or [-1]))
            .group_by(Avaliacao.prova_id)
        ).all()
    ) if provas else {}
    return {"provas": [{**_prova_to_dict(p), "avaliacoes_usando": uso.get(p.id, 0)} for p in provas]}


@router.post("/api/provas", status_code=201)
def create_prova(
    req: AvaliacaoCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """Cria uma prova avulsa (estrutura) para reutilizar em avaliações."""
    titulo = (req.titulo or "").strip()
    if not titulo:
        raise HTTPException(status_code=400, detail="Título da prova é obrigatório")
    prova = Prova(
        external_id=f"prova-{uuid.uuid4()}",
        titulo=titulo[:200],
        descricao=req.descricao,
        disciplina=(req.subjectLP or "").strip() or None,
        subject_lp=(req.subjectLP or "PORTUGUÊS").strip(),
        subject_mat=(req.subjectMat or req.subjectLP or "MATEMÁTICA").strip(),
        questions_per_subject=req.questionsPerSubject or 22,
        layout_mode=req.layoutMode or "dual",
        template=req.template or "padrao",
        grade_scale=req.gradeScale or "0-10",
        owner_id=current_user.id,
    )
    db.add(prova)
    db.commit()
    db.refresh(prova)
    return _prova_to_dict(prova)


@router.post("/api/provas/{prova_id}/duplicar", status_code=201)
def duplicar_prova(
    prova_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """Duplica a estrutura de uma prova (participantes/resultados NUNCA vêm junto)."""
    original = db.get(Prova, prova_id)
    if original is None:
        raise HTTPException(status_code=404, detail="Prova não encontrada")
    auth.require_owner_or_admin(original, current_user)
    copia = Prova(
        external_id=f"prova-{uuid.uuid4()}",
        titulo=f"{original.titulo} (cópia)",
        descricao=original.descricao,
        disciplina=original.disciplina,
        subject_lp=original.subject_lp,
        subject_mat=original.subject_mat,
        questions_per_subject=original.questions_per_subject,
        layout_mode=original.layout_mode,
        template=original.template,
        grade_scale=original.grade_scale,
        owner_id=original.owner_id or current_user.id,
    )
    db.add(copia)
    db.commit()
    db.refresh(copia)
    return {**_prova_to_dict(copia), "avaliacoes_usando": 0}


# ─── Avaliações ───


@router.get("/api/avaliacoes")
def list_avaliacoes(
    status: str | None = Query(default=None),
    turma_id: int | None = Query(default=None),
    q: str | None = Query(default=None, max_length=120),
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """Lista as avaliações com etapa, status e próxima ação (base do painel)."""
    query = select(Avaliacao).where(auth.owner_clause(Avaliacao, current_user)).order_by(
        Avaliacao.created_at.desc()
    )
    if q and q.strip():
        query = query.where(Avaliacao.titulo.ilike(f"%{q.strip()}%"))
    avaliacoes = db.scalars(query).all()

    saida = []
    for av in avaliacoes:
        item = _avaliacao_to_dict(db, av)
        if turma_id is not None and turma_id not in [t["id"] for t in item["turmas"]]:
            continue
        if status and item["status_derivado"] != status:
            continue
        saida.append(item)
    return {"avaliacoes": saida}


@router.post("/api/avaliacoes", status_code=201)
def create_avaliacao(
    req: AvaliacaoCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """Cria uma avaliação a partir de uma prova (ou criando a estrutura junto)."""
    titulo = (req.titulo or "").strip()
    if not titulo:
        raise HTTPException(status_code=400, detail="Título da avaliação é obrigatório")

    prova: Prova | None = None
    if req.prova_id is not None:
        prova = db.get(Prova, req.prova_id)
        if prova is None:
            raise HTTPException(status_code=404, detail="Prova não encontrada")
        auth.require_owner_or_admin(prova, current_user)
    elif req.prova_external_id:
        prova = db.scalar(select(Prova).where(Prova.external_id == req.prova_external_id))
        if prova is None:
            raise HTTPException(status_code=404, detail="Prova não encontrada")
    else:
        prova = Prova(
            external_id=f"prova-{uuid.uuid4()}",
            titulo=titulo[:200],
            descricao=req.descricao,
            disciplina=(req.subjectLP or "").strip() or None,
            subject_lp=(req.subjectLP or "PORTUGUÊS").strip(),
            subject_mat=(req.subjectMat or req.subjectLP or "MATEMÁTICA").strip(),
            questions_per_subject=req.questionsPerSubject or 22,
            layout_mode=req.layoutMode or "dual",
            template=req.template or "padrao",
            grade_scale=req.gradeScale or "0-10",
            owner_id=current_user.id,
        )
        db.add(prova)
        db.flush()

    turma_legado = None
    if req.turma_ids:
        comboio = db.scalars(select(Turma).where(Turma.id.in_(req.turma_ids))).all()
        for t in comboio:
            auth.require_turma_owner_or_admin(t, current_user)
        turma_legado = comboio[0] if comboio else None

    av = Avaliacao(
        external_id=f"aval-{uuid.uuid4()}",
        titulo=titulo[:200],
        descricao=req.descricao,
        ano_letivo=req.ano_letivo,
        status=wf.RASCUNHO,
        prova_id=prova.id,
        subject_lp=prova.subject_lp,
        subject_mat=prova.subject_mat,
        questions_per_subject=prova.questions_per_subject,
        layout_mode=prova.layout_mode,
        template=prova.template,
        grade_scale=prova.grade_scale,
        custom_template_id=req.customTemplateId,
        turma=turma_legado.nome if turma_legado else None,
        turma_id=turma_legado.id if turma_legado else None,
        owner_id=current_user.id,
    )
    db.add(av)
    db.flush()
    for tid in req.turma_ids:
        db.add(AvaliacaoTurma(avaliacao_id=av.id, turma_id=tid))
    _auditar(db, current_user, "avaliacao", av.external_id, "criada",
             resumo=f"Avaliação '{av.titulo}' criada", depois={"prova_id": prova.id})
    db.commit()
    db.refresh(av)
    return _avaliacao_to_dict(db, av)


@router.get("/api/avaliacoes/{external_id}")
def get_avaliacao(
    external_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """Detalhe da avaliação: etapas visuais, contadores, bloqueios e ação contextual."""
    av = _get_avaliacao(db, external_id)
    auth.require_owner_or_admin(av, current_user)
    return _avaliacao_to_dict(db, av)


@router.patch("/api/avaliacoes/{external_id}")
def update_avaliacao(
    external_id: str,
    req: AvaliacaoUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """Edita dados cadastrais da avaliação (título, descrição, ano letivo)."""
    av = _get_avaliacao(db, external_id)
    auth.require_owner_or_admin(av, current_user)
    antes = {"titulo": av.titulo, "descricao": av.descricao, "ano_letivo": av.ano_letivo}
    if req.titulo is not None:
        if not req.titulo.strip():
            raise HTTPException(status_code=400, detail="Título é obrigatório")
        av.titulo = req.titulo.strip()[:200]
    if req.descricao is not None:
        av.descricao = req.descricao
    if req.ano_letivo is not None:
        av.ano_letivo = req.ano_letivo
    _auditar(db, current_user, "avaliacao", av.external_id, "editada", antes=antes,
             depois={"titulo": av.titulo, "descricao": av.descricao, "ano_letivo": av.ano_letivo})
    db.commit()
    db.refresh(av)
    return _avaliacao_to_dict(db, av)


@router.get("/api/avaliacoes/{external_id}/timeline")
def avaliacao_timeline(
    external_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """Histórico/auditoria da avaliação (transições, gabarito, publicações)."""
    av = _get_avaliacao(db, external_id)
    auth.require_owner_or_admin(av, current_user)

    eventos: list[dict] = []
    for a in db.scalars(
        select(Auditoria).where(
            Auditoria.entidade == "avaliacao", Auditoria.entidade_id == av.external_id
        ).order_by(Auditoria.created_at.desc())
    ).all():
        eventos.append({
            "tipo": a.acao,
            "resumo": a.resumo,
            "autor": a.autor_nome,
            "antes": a.antes,
            "depois": a.depois,
            "data": a.created_at.isoformat(),
        })

    # Auditoria das leituras desta avaliacao (correcao manual e revisao):
    # sem isso a timeline so mostrava eventos da propria avaliacao.
    leitura_ids = db.scalars(
        select(Leitura.id).where(Leitura.avaliacao_id == av.id)
    ).all()
    if leitura_ids:
        textos = [str(x) for x in leitura_ids]
        for a in db.scalars(
            select(Auditoria).where(
                Auditoria.entidade == "leitura",
                Auditoria.entidade_id.in_(textos),
            ).order_by(Auditoria.created_at.desc())
        ).all():
            eventos.append({
                "tipo": a.acao,
                "resumo": a.resumo,
                "autor": a.autor_nome,
                "antes": a.antes,
                "depois": a.depois,
                "data": a.created_at.isoformat(),
            })
        for rm in db.scalars(
            select(RevisaoManual).where(RevisaoManual.leitura_id.in_(leitura_ids))
            .order_by(RevisaoManual.created_at.desc())
        ).all():
            antes_txt = rm.resposta_anterior or "—"
            depois_txt = rm.resposta_corrigida or "—"
            obs = f" ({rm.observacao})" if rm.observacao else ""
            eventos.append({
                "tipo": "revisao_manual",
                "resumo": f"Q{rm.questao}: {antes_txt} → {depois_txt}{obs}",
                "autor": rm.autor_nome,
                "data": rm.created_at.isoformat(),
            })
    for gv in db.scalars(
        select(GabaritoVersao).where(GabaritoVersao.avaliacao_id == av.id)
        .order_by(GabaritoVersao.created_at.desc())
    ).all():
        eventos.append({
            "tipo": "gabarito_versao",
            "resumo": f"Gabarito v{gv.versao} {'ativo' if gv.ativa else 'substituído'}",
            "autor": gv.autor_nome,
            "data": gv.created_at.isoformat(),
        })
    eventos.sort(key=lambda e: e["data"] or "", reverse=True)
    return {"eventos": eventos}


@router.patch("/api/avaliacoes/{external_id}/status")
def update_status(
    external_id: str,
    req: StatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """Transição MANUAL autorizada (ex.: marcar impressa/em aplicação/arquivada)."""
    av = _get_avaliacao(db, external_id)
    auth.require_owner_or_admin(av, current_user)
    fluxo = wf.calcular_fluxo(_contadores(db, av))
    efetivo = _status_efetivo(av, fluxo.status)
    try:
        novo = wf.aplicar_status_manual(efetivo, req.status.strip())
    except wf.TransicaoInvalidaError as e:
        raise HTTPException(status_code=400, detail=str(e))
    antes = {"status": av.status}
    av.status = novo
    _auditar(db, current_user, "avaliacao", av.external_id, "status_alterado",
             resumo=f"{wf.STATUS_LABEL.get(antes['status'], antes['status'])} → "
                    f"{wf.STATUS_LABEL.get(novo, novo)}",
             antes=antes, depois={"status": novo})
    db.commit()
    db.refresh(av)
    return _avaliacao_to_dict(db, av)


@router.post("/api/avaliacoes/{external_id}/publicar")
def publicar_resultados(
    external_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """Publica os resultados — bloqueado enquanto houver revisão pendente."""
    av = _get_avaliacao(db, external_id)
    auth.require_owner_or_admin(av, current_user)
    contadores = _contadores(db, av)
    if contadores.revisoes_pendentes > 0:
        raise HTTPException(
            status_code=400,
            detail=f"{contadores.revisoes_pendentes} leitura(s) aguardando revisão. "
                   "Conclua a revisão antes de publicar.",
        )
    if contadores.cartoes_corrigidos == 0:
        raise HTTPException(status_code=400, detail="Nenhum cartão corrigido ainda.")
    av.resultados_publicados_em = datetime.now()
    av.publicado_por = current_user.nome or current_user.email
    if av.status not in (wf.PUBLICADOS, wf.ARQUIVADA):
        av.status = wf.PUBLICADOS
    _auditar(db, current_user, "avaliacao", av.external_id, "resultados_publicados",
             resumo=f"{contadores.cartoes_corrigidos} cartao(es) publicados por {av.publicado_por}")
    db.commit()
    db.refresh(av)
    return _avaliacao_to_dict(db, av)


@router.post("/api/avaliacoes/{external_id}/turmas")
def vincular_turma(
    external_id: str,
    req: TurmaVinculo,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """Vincula uma turma à avaliação (avaliação multi-turma, N:N)."""
    av = _get_avaliacao(db, external_id)
    auth.require_owner_or_admin(av, current_user)
    turma = db.get(Turma, req.turma_id)
    if turma is None:
        raise HTTPException(status_code=404, detail="Turma não encontrada")
    auth.require_turma_owner_or_admin(turma, current_user)
    existe = db.scalar(select(AvaliacaoTurma).where(
        AvaliacaoTurma.avaliacao_id == av.id, AvaliacaoTurma.turma_id == turma.id
    ))
    if existe is None:
        db.add(AvaliacaoTurma(avaliacao_id=av.id, turma_id=turma.id))
        if av.turma_id is None:
            av.turma_id, av.turma = turma.id, turma.nome
        _auditar(db, current_user, "avaliacao", av.external_id, "turma_vinculada",
                 resumo=f"Turma {turma.nome}")
        db.commit()
    db.refresh(av)
    return _avaliacao_to_dict(db, av)


@router.delete("/api/avaliacoes/{external_id}/turmas/{turma_id}")
def desvincular_turma(
    external_id: str,
    turma_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """Desvincula uma turma da avaliação (alunos já materializados permanecem)."""
    av = _get_avaliacao(db, external_id)
    auth.require_owner_or_admin(av, current_user)
    vinculo = db.scalar(select(AvaliacaoTurma).where(
        AvaliacaoTurma.avaliacao_id == av.id, AvaliacaoTurma.turma_id == turma_id
    ))
    if vinculo is not None:
        db.delete(vinculo)
        _auditar(db, current_user, "avaliacao", av.external_id, "turma_desvinculada",
                 resumo=f"Turma {turma_id}")
        db.commit()
    db.refresh(av)
    return {"ok": True, **_avaliacao_to_dict(db, av)}


@router.post("/api/avaliacoes/{external_id}/gabarito")
def registrar_gabarito(
    external_id: str,
    req: GabaritoUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """Cadastra/atualiza o gabarito OFICIAL gerando uma nova versão (histórico)."""
    av = _get_avaliacao(db, external_id)
    auth.require_owner_or_admin(av, current_user)
    chaves = {int(k): str(v).strip().upper() for k, v in req.answer_key.items()}
    if not chaves:
        raise HTTPException(status_code=400, detail="Gabarito vazio")
    ultima = db.scalar(select(func.max(GabaritoVersao.versao))
                       .where(GabaritoVersao.avaliacao_id == av.id)) or 0
    for gv in db.scalars(select(GabaritoVersao).where(
        GabaritoVersao.avaliacao_id == av.id, GabaritoVersao.ativa.is_(True)
    )).all():
        gv.ativa = False
    av.answer_key = chaves
    db.add(GabaritoVersao(
        avaliacao_id=av.id,
        versao=ultima + 1,
        answer_key=chaves,
        autor_id=current_user.id,
        autor_nome=current_user.nome or current_user.email,
        observacao=req.observacao,
        ativa=True,
    ))
    _auditar(db, current_user, "avaliacao", av.external_id, "gabarito_atualizado",
             resumo=f"Versão {ultima + 1} ({len(chaves)} questões)")
    db.commit()
    db.refresh(av)
    return _avaliacao_to_dict(db, av)


@router.get("/api/avaliacoes/{external_id}/leituras")
def list_leituras(
    external_id: str,
    status: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """Leituras registradas da avaliação (histórico auditável)."""
    av = _get_avaliacao(db, external_id)
    auth.require_owner_or_admin(av, current_user)
    q = select(Leitura).where(Leitura.avaliacao_id == av.id).order_by(Leitura.created_at.desc())
    if status:
        q = q.where(Leitura.status == status)
    return {
        "leituras": [
            {
                "id": l.id,
                "codigo_unico": l.codigo_unico,
                "status": l.status,
                "respostas": l.respostas,
                "baixa_confianca": l.baixa_confianca,
                "duplicadas": l.duplicadas,
                "acertos": l.acertos,
                "erros": l.erros,
                "brancos": l.brancos,
                "nota": l.nota,
                "parent_id": l.parent_id,
                "operador": l.operador_nome,
                "criada_em": l.created_at.isoformat() if l.created_at else None,
                "revisada_em": l.revisada_em.isoformat() if l.revisada_em else None,
                "aluno": ({"id": l.aluno_id} if l.aluno_id else None),
            }
            for l in db.scalars(q).all()
        ]
    }


@router.post("/api/leituras/{leitura_id}/revisar")
def revisar_leitura(
    leitura_id: int,
    req: RevisaoPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """Correção manual de uma leitura — registra cada alteração em auditoria."""
    leitura = db.get(Leitura, leitura_id)
    if leitura is None:
        raise HTTPException(status_code=404, detail="Leitura não encontrada")
    av = db.get(Avaliacao, leitura.avaliacao_id) if leitura.avaliacao_id else None
    if av is not None:
        auth.require_owner_or_admin(av, current_user)

    antes = dict(leitura.respostas or {})
    novo: dict[int, str] = {}
    for k, v in req.respostas.items():
        if v and str(v).strip():
            novo[int(k)] = str(v).strip().upper()
    leitura.respostas = novo
    leitura.status = Leitura.STATUS_REVISADA
    leitura.revisada_em = datetime.now()
    leitura.operador_id = current_user.id
    leitura.operador_nome = current_user.nome or current_user.email

    for q, resp in novo.items():
        anterior = antes.get(q) or antes.get(str(q))
        if anterior == resp:
            continue
        db.add(RevisaoManual(
            leitura_id=leitura.id,
            questao=q,
            resposta_anterior=anterior,
            resposta_corrigida=resp,
            autor_id=current_user.id,
            autor_nome=current_user.nome or current_user.email,
            observacao=req.observacao,
        ))
    _auditar(db, current_user, "leitura", str(leitura.id), "revisao_manual",
             resumo=req.observacao or f"{len(novo)} resposta(s) conferida(s)",
             antes={"respostas": antes}, depois={"respostas": novo})
    db.commit()
    db.refresh(leitura)
    return {"ok": True, "leitura_id": leitura.id, "status": leitura.status}


# ─── Histórico do aluno ───


@router.get("/api/alunos/{aluno_id}/historico")
def aluno_historico(
    aluno_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """Desempenho do aluno em todas as avaliações visíveis (por período letivo)."""
    aluno = db.get(Aluno, aluno_id)
    if aluno is None:
        raise HTTPException(status_code=404, detail="Aluno não encontrado")
    av = db.get(Avaliacao, aluno.avaliacao_id)
    if av is not None:
        auth.require_owner_or_admin(av, current_user)

    linhas = db.scalars(
        select(GabaritoNomeado).where(GabaritoNomeado.aluno_id == aluno_id)
        .order_by(GabaritoNomeado.data_correcao.desc())
    ).all()
    avaliacoes = {}
    for g in linhas:
        a = g.avaliacao
        avaliacoes.setdefault(a.id, {**avaliacao_resumo(db, a), "ultima_nota": None,
                                     "melhor_nota": None, "notas": []})
    saida = []
    for aid, info in avaliacoes.items():
        notas = [g.nota for g in linhas if g.avaliacao_id == aid and g.nota is not None]
        if notas:
            info["notas"] = notas
            info["ultima_nota"] = notas[0]
            info["melhor_nota"] = max(notas)
        saida.append(info)
    return {
        "aluno": {"id": aluno.id, "nome": aluno.nome, "matricula": aluno.matricula,
                  "situacao": aluno.situacao},
        "avaliacoes": saida,
    }


def avaliacao_resumo(db: Session, av: Avaliacao) -> dict:
    fluxo = wf.calcular_fluxo(_contadores(db, av))
    return {
        "avaliacao_id": av.id,
        "external_id": av.external_id,
        "titulo": av.titulo,
        "ano_letivo": av.ano_letivo,
        "turma": av.turma,
        "status": fluxo.status,
        "status_label": wf.STATUS_LABEL[fluxo.status],
        "progresso": fluxo.progresso,
    }


# ─── Resumo operacional (painel) ───


@router.get("/api/operacao/resumo")
def operacao_resumo(
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """Números do painel: contadores por status, alertas e próximas ações."""
    onde = auth.owner_clause(Avaliacao, current_user)
    avals = db.scalars(select(Avaliacao).where(onde).order_by(Avaliacao.created_at.desc())).all()

    contagem: dict[str, int] = {}
    pendencias: list[dict] = []
    avisar: list[dict] = []
    for av in avals:
        item = _avaliacao_to_dict(db, av)
        contagem[item["status_derivado"]] = contagem.get(item["status_derivado"], 0) + 1
        if item["proxima_acao"] and item["progresso"] < 100:
            pendencias.append({
                "external_id": av.external_id,
                "titulo": av.titulo,
                "etapa": item["proxima_acao"]["etapa"],
                "acao": item["proxima_acao"]["acao"],
                "status": item["status_derivado"],
                "status_label": item["status_label"],
                "progresso": item["progresso"],
            })
        if not item["answer_key"]:
            avisar.append({"tipo": "sem_gabarito", "external_id": av.external_id,
                           "titulo": av.titulo,
                           "mensagem": "Avaliação sem gabarito oficial."})
        c = _contadores(db, av)
        if c.cartoes_gerados > 0 and c.cartoes_recebidos == 0:
            avisar.append({"tipo": "cartoes_nao_recebidos", "external_id": av.external_id,
                           "titulo": av.titulo,
                           "mensagem": f"{c.cartoes_gerados} cartão(ões) gerado(s) e nenhuma leitura."})

    turmas_ativas = db.scalar(
        select(func.count()).select_from(Turma).where(
            auth.owner_clause(Turma, current_user), Turma.arquivada.is_(False))
    ) or 0
    alunos_ativos = db.scalar(
        select(func.count()).select_from(TurmaAluno).join(
            Turma, Turma.id == TurmaAluno.turma_id
        ).where(auth.owner_clause(Turma, current_user), TurmaAluno.situacao == "ativo")
    ) or 0

    return {
        "turmas": turmas_ativas,
        "alunos": alunos_ativos,
        "avaliacoes": len(avals),
        "por_status": contagem,
        "pendencias": pendencias[:8],
        "alertas": avisar[:8],
    }
