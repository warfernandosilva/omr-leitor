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


class LabSession(Base, TimestampMixin):
    """Sessão do Laboratório OMR: um conjunto de fotos + gabarito esperado.

    Reutiliza os MESMOS leitores de produção (omr/reader*.py) — o Lab não
    roda um pipeline paralelo. `ground_truth` é dict {questão: letra};
    `adaptive` espelha o flag dos endpoints de produção.
    """

    __tablename__ = "lab_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    nome: Mapped[str] = mapped_column(String(200), nullable=False)
    descricao: Mapped[str | None] = mapped_column(Text, nullable=True)
    template: Mapped[str] = mapped_column(String(10), nullable=False, default="padrao")
    questions_per_subject: Mapped[int] = mapped_column(Integer, nullable=False, default=22)
    layout_mode: Mapped[str] = mapped_column(String(10), nullable=False, default="dual")
    adaptive: Mapped[bool] = mapped_column(default=False)
    ground_truth: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)

    owner: Mapped["User | None"] = relationship()
    images: Mapped[list["LabImage"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )


class LabImage(Base, TimestampMixin):
    """Uma foto carregada no Lab, com o resultado do leitor de produção.

    Componentes por bolha ficam em LabOptionScore (recalibração sem
    reprocessar a imagem); o estado cru do motor fica aqui para a
    comparação com o gabarito (ver mapeamento em routers/lab.py).
    """

    __tablename__ = "lab_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("lab_sessions.id"), index=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    original_path: Mapped[str] = mapped_column(String(500), nullable=False)
    rectified_path: Mapped[str | None] = mapped_column(String(500), nullable=True)

    status: Mapped[str] = mapped_column(String(20), nullable=False, default="processed")  # processed | error
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    template_used: Mapped[str] = mapped_column(String(10), nullable=False, default="padrao")
    qr_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    floor_used: Mapped[float | None] = mapped_column(Float, nullable=True)
    floor_source: Mapped[str | None] = mapped_column(String(12), nullable=True)  # fixed | adaptive | override
    total_questions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Tempos por etapa (ms) — observabilidade do pipeline
    t_detect: Mapped[float | None] = mapped_column(Float, nullable=True)
    t_warp: Mapped[float | None] = mapped_column(Float, nullable=True)
    t_qr: Mapped[float | None] = mapped_column(Float, nullable=True)
    t_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    session: Mapped["LabSession"] = relationship(back_populates="images")
    questions: Mapped[list["LabQuestion"]] = relationship(
        back_populates="image", cascade="all, delete-orphan"
    )
    options: Mapped[list["LabOptionScore"]] = relationship(
        back_populates="image", cascade="all, delete-orphan"
    )


class LabQuestion(Base, TimestampMixin):
    """Classificação crua do motor por questão (ok | low | duplicate | blank)."""

    __tablename__ = "lab_questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    image_id: Mapped[int] = mapped_column(ForeignKey("lab_images.id"), index=True)
    question_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False)  # ok | low | duplicate | blank
    detected_answer: Mapped[str | None] = mapped_column(String(1), nullable=True)
    duplicate_marks: Mapped[list | None] = mapped_column(JSON, nullable=True)
    truth_answer: Mapped[str | None] = mapped_column(String(1), nullable=True)

    image: Mapped["LabImage"] = relationship(back_populates="questions")
    options: Mapped[list["LabOptionScore"]] = relationship(
        back_populates="question", cascade="all, delete-orphan"
    )


class LabOptionScore(Base, TimestampMixin):
    """Componentes do score de cada bolha (recalibração de pesos/limiares).

    `score` é a ponderação de produção no momento da leitura; os três
    componentes (média, razão escura, contraste) permitem rescore com
    novos pesos SEM reprocessar a imagem (omr.params.BubbleMetrics.rescore).
    """

    __tablename__ = "lab_option_scores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    image_id: Mapped[int] = mapped_column(ForeignKey("lab_images.id"), index=True)
    question_id: Mapped[int | None] = mapped_column(ForeignKey("lab_questions.id"), nullable=True, index=True)
    option: Mapped[str] = mapped_column(String(1), nullable=False)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    mean_intensity: Mapped[float] = mapped_column(Float, nullable=False)
    dark_ratio: Mapped[float] = mapped_column(Float, nullable=False)
    contrast: Mapped[float] = mapped_column(Float, nullable=False)
    otsu_threshold: Mapped[float] = mapped_column(Float, nullable=False)

    image: Mapped["LabImage"] = relationship(back_populates="options")
    question: Mapped["LabQuestion | None"] = relationship(back_populates="options")


class CalibrationRun(Base):
    """Varredura de parâmetros sobre uma sessão do Lab (Fase 2).

    Guardar o grid e o resultado permite comparar calibrações depois e
    não perder a evidência de por que um threshold foi publicado.
    """

    __tablename__ = "calibration_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int | None] = mapped_column(ForeignKey("lab_sessions.id"), nullable=True, index=True)
    template: Mapped[str] = mapped_column(String(10), nullable=False, default="padrao")
    grid: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    best: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    n_candidates: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)

    owner: Mapped["User | None"] = relationship()


class OmrConfig(Base):
    """Configuração de thresholds do OMR, versionada e publicável.

    Nenhuma linha vale por si só: só a marcada `ativa` é lida em
    produção (publicação grava data/active_config.json). O histórico
    completo permite rollback. Uma linha por calibração — mudanças de
    produção NUNCA são automáticas.
    """

    __tablename__ = "omr_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    nome: Mapped[str] = mapped_column(String(200), nullable=False)
    template: Mapped[str | None] = mapped_column(String(10), nullable=True, index=True)  # None = global
    params: Mapped[dict] = mapped_column(JSON, nullable=False)
    metrics: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # acurácia no momento da publicação
    source_session_id: Mapped[int | None] = mapped_column(ForeignKey("lab_sessions.id"), nullable=True, index=True)
    source_run_id: Mapped[int | None] = mapped_column(ForeignKey("calibration_runs.id"), nullable=True, index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    ativa: Mapped[bool] = mapped_column(default=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)

    owner: Mapped["User | None"] = relationship()
