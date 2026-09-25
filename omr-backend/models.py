"""
Modelos de persistência do sistema OMR.

Entidades:
- Avaliacao: prova/turma (espelha a prova criada no frontend via external_id)
- Aluno: aluno importado por XLSX/CSV, vinculado a uma avaliação
- GabaritoNomeado: gabarito individual — codigo_unico (QR) → aluno_id

Regra fundamental: o QR Code é apenas a chave de identificação do
GabaritoNomeado; quem resolve codigo_unico → aluno é o banco de dados.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    nome: Mapped[str] = mapped_column(String(120), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="professor")
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(), nullable=False)


def _now() -> datetime:
    return datetime.now()


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now, nullable=False)


class Avaliacao(Base, TimestampMixin):
    __tablename__ = "avaliacoes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    external_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)  # id da prova no frontend
    titulo: Mapped[str] = mapped_column(String(200), nullable=False)
    turma: Mapped[str | None] = mapped_column(String(100), nullable=True)
    modelo_omr: Mapped[str] = mapped_column(String(50), nullable=False, default="GABARITO_01")
    subject_lp: Mapped[str] = mapped_column(String(120), nullable=False, default="PORTUGUÊS")
    subject_mat: Mapped[str] = mapped_column(String(120), nullable=False, default="MATEMÁTICA")
    questions_per_subject: Mapped[int] = mapped_column(Integer, nullable=False, default=22)
    layout_mode: Mapped[str] = mapped_column(String(10), nullable=False, default="dual")  # dual | single
    template: Mapped[str] = mapped_column(String(10), nullable=False, default="padrao")  # padrao | sae
    sae_spec: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # cabeçalho editável do cartão SAE
    herby_spec: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # evento/serie/caderno/turma/magic_base do Herby
    grade_scale: Mapped[str] = mapped_column(String(10), nullable=False, default="0-10")
    answer_key: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)

    owner: Mapped["User | None"] = relationship()

    alunos: Mapped[list["Aluno"]] = relationship(
        back_populates="avaliacao", cascade="all, delete-orphan"
    )
    gabaritos: Mapped[list["GabaritoNomeado"]] = relationship(
        back_populates="avaliacao", cascade="all, delete-orphan"
    )


class Aluno(Base, TimestampMixin):
    __tablename__ = "alunos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    avaliacao_id: Mapped[int] = mapped_column(ForeignKey("avaliacoes.id"), index=True)
    nome: Mapped[str] = mapped_column(String(200), nullable=False)
    matricula: Mapped[str | None] = mapped_column(String(60), nullable=True)
    identificador_externo: Mapped[str | None] = mapped_column(String(120), nullable=True)

    avaliacao: Mapped["Avaliacao"] = relationship(back_populates="alunos")
    gabaritos: Mapped[list["GabaritoNomeado"]] = relationship(back_populates="aluno")


class GabaritoNomeado(Base, TimestampMixin):
    __tablename__ = "gabaritos_nomeados"
    __table_args__ = (
        UniqueConstraint("codigo_unico", name="uq_gabarito_codigo_unico"),
        UniqueConstraint("aluno_id", "avaliacao_id", name="uq_gabarito_aluno_avaliacao"),
    )

    STATUS_GERADO = "gerado"
    STATUS_LIDO = "lido"
    STATUS_CORRIGIDO = "corrigido"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    avaliacao_id: Mapped[int] = mapped_column(ForeignKey("avaliacoes.id"), index=True)
    aluno_id: Mapped[int] = mapped_column(ForeignKey("alunos.id"), index=True)

    # ID impresso + payload do QR Code (sempre iguais)
    codigo_unico: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    qr_code_payload: Mapped[str] = mapped_column(String(120))
    # Herby: conteúdo integral do QR do cabeçalho (magic link; só armazenado)
    magic_link: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Herby: estado da foto (Successful/QrNotRead/AnswerFieldsCut/PageCut)
    photo_status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    numero_pagina: Mapped[int] = mapped_column(Integer, default=0)

    status: Mapped[str] = mapped_column(String(30), nullable=False, default=STATUS_GERADO)

    # Resultado da leitura/correção
    respostas: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    acertos: Mapped[int | None] = mapped_column(Integer, nullable=True)
    erros: Mapped[int | None] = mapped_column(Integer, nullable=True)
    brancos: Mapped[int | None] = mapped_column(Integer, nullable=True)
    nota: Mapped[float | None] = mapped_column(Float, nullable=True)
    observacoes: Mapped[str | None] = mapped_column(Text, nullable=True)

    data_geracao: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
    data_leitura: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    data_correcao: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    avaliacao: Mapped["Avaliacao"] = relationship(back_populates="gabaritos")
    aluno: Mapped["Aluno"] = relationship(back_populates="gabaritos")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "codigo_unico": self.codigo_unico,
            "qr_code_payload": self.qr_code_payload,
            "magic_link": self.magic_link,
            "photo_status": self.photo_status,
            "numero_pagina": self.numero_pagina,
            "status": self.status,
            "respostas": self.respostas,
            "acertos": self.acertos,
            "erros": self.erros,
            "brancos": self.brancos,
            "nota": self.nota,
            "data_geracao": self.data_geracao.isoformat() if self.data_geracao else None,
            "data_leitura": self.data_leitura.isoformat() if self.data_leitura else None,
            "data_correcao": self.data_correcao.isoformat() if self.data_correcao else None,
            "aluno": {
                "id": self.aluno.id,
                "nome": self.aluno.nome,
                "matricula": self.aluno.matricula,
            },
        }


class DeletedExam(Base):
    """Lápide de avaliação excluída (anti-ressurreição multi-aparelho).

    Quando uma prova é apagada num aparelho, os outros ainda a têm no
    localStorage e tentariam recriá-la no servidor via /api/exams/sync.
    A lápide marca o external_id como morto: o sync recusa recriar (410)
    e os aparelhos removem a cópia local. Lápides expiram após 30 dias
    (limpeza no GET /api/exams/deleted).
    """

    __tablename__ = "deleted_exams"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    external_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    deleted_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
