"""Relatórios em PDF (por turma/avaliação e boletim individual).

Montado em main.py — path /api/relatorios/pdf.

Usa o ReportLab já usado pelo gerador de cartões. Os números saem do banco
(`gabaritos_nomeados` corrigidos + gabarito oficial da avaliação), então o
relatório sempre bate com as correções realizadas — inclusive com as revisões
manuais, que vivem na mesma leitura.
"""
from __future__ import annotations

import io
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import (
    Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)
from reportlab.lib.styles import getSampleStyleSheet
from sqlalchemy import func, select
from sqlalchemy.orm import Session

import auth
from database import get_db
from models import Aluno, Avaliacao, GabaritoNomeado, Turma, User

router = APIRouter()

AZUL = colors.HexColor("#1769F5")
AZUL_ESCURO = colors.HexColor("#1552C0")
CINZA = colors.HexColor("#71809A")
CINZA_CLARO = colors.HexColor("#F4F7FD")


class RelatorioRequest(BaseModel):
    avaliacao_external_id: str
    turma_id: int | None = None
    aluno_id: int | None = None
    tipo: str = "turma"          # 'turma' | 'aluno'


def _estilos():
    st = getSampleStyleSheet()
    return {
        "titulo": st["Title"],
        "subtitulo": st["Normal"],
        "secao": st["Heading2"],
        "texto": st["Normal"],
        "pequeno": st["Normal"],
    }


def _tabela(dados, larguras=None, cabecalho=True):
    t = Table(dados, colWidths=larguras, repeatRows=1 if cabecalho else 0)
    estilo = [
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#172B4D")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, AZUL if cabecalho else CINZA),
    ]
    if cabecalho:
        estilo += [
            ("BACKGROUND", (0, 0), (-1, 0), AZUL),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 9),
        ]
        estilo += [("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, CINZA_CLARO])]
    t.setStyle(TableStyle(estilo))
    return t


def _por_questao(alvos: list[GabaritoNomeado], avaliacao: Avaliacao) -> dict[int, dict[str, int]]:
    """Acertos/erros/brancos por questão, somando os cartões do recorte."""
    chave = avaliacao.answer_key or {}
    stats: dict[int, dict[str, int]] = {}
    for g in alvos:
        respostas = g.respostas or {}
        for q, certo in chave.items():
            qi = int(q)
            item = stats.setdefault(qi, {"acertos": 0, "erros": 0, "brancos": 0, "duplicadas": 0})
            marcado = respostas.get(str(qi)) or respostas.get(qi)
            if not marcado:
                item["brancos"] += 1
            elif marcado.upper() == str(certo).upper():
                item["acertos"] += 1
            else:
                item["erros"] += 1
    return stats


def _relatorio_turma(buffer: io.BytesIO, avaliacao: Avaliacao, turma_nome: str,
                     alvos: list[GabaritoNomeado], aluno_por_id: dict[int, Aluno]) -> None:
    st = _estilos()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm,
        topMargin=16 * mm, bottomMargin=16 * mm,
        title=f"Relatório — {avaliacao.titulo}", author="Gabarito+",
    )
    fluxo = []

    fluxo.append(Paragraph(f"Relatório de desempenho", st["titulo"]))
    fluxo.append(Spacer(1, 4))
    fluxo.append(Paragraph(
        f"<b>{avaliacao.titulo}</b> · {turma_nome}"
        + (f" · {avaliacao.ano_letivo}" if avaliacao.ano_letivo else ""),
        st["subtitulo"],
    ))
    fluxo.append(Paragraph(
        f"Emitido em {datetime.now().strftime('%d/%m/%Y %H:%M')} · "
        f"{len(alvos)} cartão(ões) corrigido(s)",
        st["pequeno"],
    ))
    fluxo.append(Spacer(1, 10))

    notas = [g.nota or 0 for g in alvos]
    if notas:
        media = sum(notas) / len(notas)
        resumo = [
            ["Cartões corrigidos", "Média", "Maior nota", "Menor nota"],
            [str(len(alvos)), f"{media:.1f}".replace(".", ","),
             f"{max(notas):.1f}".replace(".", ","), f"{min(notas):.1f}".replace(".", ",")],
        ]
        fluxo.append(_tabela(resumo, larguras=[45 * mm, 40 * mm, 40 * mm, 40 * mm]))
        fluxo.append(Spacer(1, 12))

    # Distribuição em faixas de 0 a 10 (escala normalizada quando aplicável)
    escala = avaliacao.grade_scale
    if escala == "0-100":
        faixas = [(90, 100), (75, 89.9), (60, 74.9), (40, 59.9), (0, 39.9)]
        rotulos = ["90–100", "75–89", "60–74", "40–59", "0–39"]
    else:
        faixas = [(9, 10), (7.5, 8.9), (6, 7.4), (4, 5.9), (0, 3.9)]
        rotulos = ["9–10", "7,5–8,9", "6–7,4", "4–5,9", "0–3,9"]
    dist = [["Faixa de nota", "Alunos"]]
    for (ini, fim), rotulo in zip(faixas, rotulos):
        # escala "count" nao tem faixas de nota: usa o total de alunos
        n = sum(1 for v in notas if ini <= v <= fim) if escala != "count" else len(notas)
        dist.append([rotulo, str(n)])
    fluxo.append(Paragraph("Distribuição das notas", st["secao"]))
    fluxo.append(_tabela(dist, larguras=[60 * mm, 40 * mm]))
    fluxo.append(Spacer(1, 12))

    # Desempenho por questão (as 10 com mais erro)
    por_q = _por_questao(alvos, avaliacao)
    if por_q:
        linhas = [["Questão", "Acertos", "Erros", "Brancos", "% de acerto"]]
        ordenadas = sorted(
            por_q.items(),
            key=lambda kv: kv[1]["erros"],
            reverse=True,
        )[:10]
        for q, s in ordenadas:
            total = s["acertos"] + s["erros"] + s["brancos"] or 1
            linhas.append([
                str(q), str(s["acertos"]), str(s["erros"]), str(s["brancos"]),
                f"{s['acertos'] * 100 / total:.0f}%",
            ])
        fluxo.append(Paragraph("Desempenho por questão (maior índice de erro)", st["secao"]))
        fluxo.append(_tabela(linhas, larguras=[25 * mm, 25 * mm, 25 * mm, 25 * mm, 30 * mm]))
        fluxo.append(Spacer(1, 12))

    # Tabela nominal
    linhas = [["Aluno", "Matrícula", "Acertos", "Erros", "Brancos", "Nota"]]
    for g in sorted(alvos, key=lambda x: (aluno_por_id.get(x.aluno_id).nome if x.aluno_id in aluno_por_id else "")):
        a = aluno_por_id.get(g.aluno_id)
        linhas.append([
            (a.nome if a else "—"),
            (a.matricula if a and a.matricula else "—"),
            str(g.acertos or 0), str(g.erros or 0), str(g.brancos or 0),
            f"{(g.nota or 0):.1f}".replace(".", ","),
        ])
    fluxo.append(Paragraph("Resultado por aluno", st["secao"]))
    fluxo.append(_tabela(
        linhas,
        larguras=[55 * mm, 22 * mm, 18 * mm, 16 * mm, 18 * mm, 18 * mm],
    ))
    fluxo.append(Spacer(1, 10))
    fluxo.append(Paragraph(
        "Documento gerado pelo Gabarito+ a partir das correções registradas. "
        "Revisões manuais estão incluídas e auditadas no histórico da avaliação.",
        st["pequeno"],
    ))

    doc.build(fluxo)


def _relatorio_aluno(buffer: io.BytesIO, avaliacao: Avaliacao, turma_nome: str,
                     alvos: list[GabaritoNomeado], alunos: list[Aluno]) -> None:
    st = _estilos()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm,
        topMargin=16 * mm, bottomMargin=16 * mm,
        title=f"Boletim — {avaliacao.titulo}", author="Gabarito+",
    )
    fluxo = []
    aluno = alunos[0] if alunos else None
    fluxo.append(Paragraph("Boletim individual", st["titulo"]))
    fluxo.append(Spacer(1, 4))
    fluxo.append(Paragraph(
        f"<b>{aluno.nome if aluno else '—'}</b> · {turma_nome}", st["subtitulo"]))
    fluxo.append(Paragraph(
        f"{avaliacao.titulo}"
        + (f" · {avaliacao.ano_letivo}" if avaliacao.ano_letivo else "")
        + f" · emitido em {datetime.now().strftime('%d/%m/%Y')}",
        st["pequeno"],
    ))
    fluxo.append(Spacer(1, 10))

    g = alvos[0] if alvos else None
    if g:
        resumo = [["Acertos", "Erros", "Brancos", "Nota"]]
        resumo.append([
            str(g.acertos or 0), str(g.erros or 0), str(g.brancos or 0),
            f"{(g.nota or 0):.1f}".replace(".", ","),
        ])
        fluxo.append(_tabela(resumo, larguras=[40 * mm] * 4))
        fluxo.append(Spacer(1, 12))

        chave = avaliacao.answer_key or {}
        respostas = g.respostas or {}
        linhas = [["Questão", "Resposta do aluno", "Gabarito", "Resultado"]]
        for q in sorted(int(x) for x in chave):
            certo = chave.get(str(q)) or chave.get(q)
            marcado = respostas.get(str(q)) or respostas.get(q)
            if not marcado:
                situacao = "Em branco"
            elif str(marcado).upper() == str(certo).upper():
                situacao = "Correta"
            else:
                situacao = "Incorreta"
            linhas.append([str(q), (marcado or "—"), str(certo), situacao])
        fluxo.append(Paragraph("Respostas", st["secao"]))
        fluxo.append(_tabela(linhas, larguras=[22 * mm, 45 * mm, 30 * mm, 30 * mm]))
        fluxo.append(Spacer(1, 10))

    if not alvos:
        fluxo.append(Paragraph(
            "Nenhuma correção registrada para este aluno nesta avaliação.",
            st["texto"]))
    fluxo.append(Spacer(1, 8))
    fluxo.append(Paragraph(
        "Correções manuais ficam registradas no histórico da avaliação (autor, data "
        "e resposta anterior).", st["pequeno"]))
    doc.build(fluxo)


@router.post("/api/relatorios/pdf")
def gerar_relatorio_pdf(
    req: RelatorioRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """Gera PDF do relatório (turma/avaliação) ou boletim do aluno."""
    av = db.scalar(select(Avaliacao).where(Avaliacao.external_id == req.avaliacao_external_id))
    if av is None:
        raise HTTPException(status_code=404, detail="Avaliação não encontrada")
    auth.require_owner_or_admin(av, current_user)

    # Turma do recorte: a do filtro, a vinculada à avaliação ou (aluno) a da avaliação.
    turma_nome = av.turma or "—"
    turma_id = req.turma_id or av.turma_id
    if turma_id is not None:
        turma = db.get(Turma, turma_id)
        if turma is not None:
            turma_nome = turma.nome

    q = select(GabaritoNomeado).where(
        GabaritoNomeado.avaliacao_id == av.id,
        GabaritoNomeado.status == GabaritoNomeado.STATUS_CORRIGIDO,
    )
    if req.aluno_id is not None:
        q = q.where(GabaritoNomeado.aluno_id == req.aluno_id)
    elif turma_id is not None:
        # Restringe aos alunos materializados desta turma quando houver vínculo.
        alunos_turma = db.scalars(
            select(Aluno.id).where(Aluno.avaliacao_id == av.id, Aluno.origem_turma_aluno_id.is_not(None))
        ).all()
        q = q.where(GabaritoNomeado.aluno_id.in_(alunos_turma or [-1]))
    alvos = db.scalars(q).all()

    aluno_ids = {g.aluno_id for g in alvos}
    alunos = db.scalars(select(Aluno).where(Aluno.id.in_(aluno_ids or [-1]))).all()
    aluno_por_id = {a.id: a for a in alunos}

    buffer = io.BytesIO()
    if req.tipo == "aluno":
        _relatorio_aluno(buffer, av, turma_nome, alvos, alunos)
        nome = f"boletim_{av.external_id[:8]}.pdf"
    else:
        _relatorio_turma(buffer, av, turma_nome, alvos, aluno_por_id)
        nome = f"relatorio_{av.external_id[:8]}.pdf"

    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{nome}"'},
    )
