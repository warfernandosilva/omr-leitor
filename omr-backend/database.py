"""
Conexão e sessão do banco de dados (SQLite ou PostgreSQL via SQLAlchemy).

Prioridade:
1. DATABASE_URL env (ex: postgresql+psycopg://... ) — se definido, usa Postgres
2. Arquivo .env ao lado deste arquivo com linha DATABASE_URL=...
3. Fallback SQLite em data/omr.db (ou OMR_DB_PATH para testes)
"""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

_DEFAULT_DB = Path(__file__).resolve().parent / "data" / "omr.db"

try:
    from dotenv import load_dotenv  # type: ignore
    load_dotenv(Path(__file__).resolve().parent / ".env", override=False)
except ImportError:
    # fallback manual se python-dotenv não instalado
    def _load_dotenv():
        env_path = Path(__file__).resolve().parent / ".env"
        if env_path.exists():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                if k not in os.environ:
                    os.environ[k] = v.strip().strip('"').strip("'")
    _load_dotenv()

# OMR_DB_PATH tem prioridade (isolamento de testes)
if os.environ.get("OMR_DB_PATH"):
    DB_PATH = os.environ["OMR_DB_PATH"]
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(
        f"sqlite:///{DB_PATH}",
        connect_args={"check_same_thread": False},
    )
    DB_LABEL = f"sqlite:///{DB_PATH}"
    DATABASE_URL = ""
else:
    DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
    if DATABASE_URL:
        engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_size=10, max_overflow=20)
        try:
            parsed = urlparse(DATABASE_URL)
            DB_LABEL = f"{parsed.scheme}://{parsed.hostname}:{parsed.port or ''}/{parsed.path.lstrip('/')}"
        except Exception:
            DB_LABEL = DATABASE_URL.split("@")[-1]
    else:
        DB_PATH = str(_DEFAULT_DB)
        Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
        engine = create_engine(
            f"sqlite:///{DB_PATH}",
            connect_args={"check_same_thread": False},
        )
        DB_LABEL = f"sqlite:///{DB_PATH}"

def _sqlite_wal(dbapi_conn, _record) -> None:
    """WAL + busy_timeout: leitores não bloqueiam escritores; espera até 5s em lock."""
    try:
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA busy_timeout=5000")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.close()
    except Exception:
        pass


if engine.dialect.name == "sqlite":
    event.listen(engine, "connect", _sqlite_wal)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    """Cria as tabelas se nao existirem + migracoes leves de colunas."""
    import models  # noqa: F401 - registra os models no Base.metadata

    Base.metadata.create_all(bind=engine)

    # Migracao: colunas adicionadas apos a primeira versao do banco.
    # `_bool_default` existe porque Postgres rejeita `DEFAULT 0` em coluna
    # BOOLEAN (exige `false`), enquanto SQLite aceita os dois.
    is_pg = engine.dialect.name != "sqlite"
    _bool_default = "false" if is_pg else "0"

    # Cada coluna e uma migracao independente e tolerante a falha: um banco ja
    # modificado (ou um DDL especifico do dialeto) nao pode impedir o boot.
    _ensure_coluna("avaliacoes", "questions_per_subject", "INTEGER NOT NULL DEFAULT 22")
    _ensure_coluna("avaliacoes", "layout_mode", "VARCHAR(10) NOT NULL DEFAULT 'dual'")
    _ensure_coluna("avaliacoes", "template", "VARCHAR(10) NOT NULL DEFAULT 'padrao'")
    _ensure_coluna("avaliacoes", "sae_spec", "JSON")
    _ensure_coluna("avaliacoes", "grade_scale", "VARCHAR(10) NOT NULL DEFAULT '0-10'")
    _ensure_coluna("avaliacoes", "answer_key", "JSON")
    _ensure_coluna("avaliacoes", "owner_id", "INTEGER REFERENCES users(id)")
    _ensure_coluna("avaliacoes", "herby_spec", "JSON")
    _ensure_coluna("avaliacoes", "turma_id", "INTEGER")
    _ensure_coluna("gabaritos_nomeados", "magic_link", "VARCHAR(255)")
    _ensure_coluna("gabaritos_nomeados", "photo_status", "VARCHAR(30)")
    _ensure_coluna("gabaritos_nomeados", "custom_template_version_id", "INTEGER")
    _ensure_coluna("alunos", "origem_turma_aluno_id", "INTEGER")
    _ensure_coluna("avaliacoes", "custom_template_id", "INTEGER")

    # ─── Ciclo de vida da avaliacao (Fase 1 da reestruturacao) ───
    _ensure_coluna("avaliacoes", "prova_id", "INTEGER")
    _ensure_coluna("avaliacoes", "status", "VARCHAR(30) NOT NULL DEFAULT 'rascunho'")
    _ensure_coluna("avaliacoes", "ano_letivo", "VARCHAR(10)")
    _ensure_coluna("avaliacoes", "descricao", "TEXT")
    _ensure_coluna("avaliacoes", "resultados_publicados_em", "TIMESTAMP")
    _ensure_coluna("avaliacoes", "publicado_por", "VARCHAR(120)")
    _ensure_coluna("turmas", "ano_letivo", "VARCHAR(10)")
    _ensure_coluna("turmas", "arquivada", f"BOOLEAN DEFAULT {_bool_default}")
    _ensure_coluna("alunos", "situacao", "VARCHAR(20) NOT NULL DEFAULT 'ativo'")
    _ensure_coluna("turma_alunos", "situacao", "VARCHAR(20) NOT NULL DEFAULT 'ativo'")
    _backfill_provas(engine)


def _ensure_coluna(table: str, column: str, ddl_type: str) -> None:
    """Aplica UMA migracao aditiva sem derrubar o boot se ela falhar."""
    try:
        _ensure_column(table, column, ddl_type)
    except Exception as e:  # pragma: no cover - so em banco ja modificado
        print(f"[migracao] falha ao adicionar {table}.{column}: {e}")


def _backfill_provas(engine) -> dict:
    """Cria uma `provas` para cada avaliacao ainda sem prova_id (idempotente).

    Separacao Prova x Avaliacao: a estrutura que hoje vive em `avaliacoes`
    ganha a sua propria linha em `provas`, e a avaliacao passa a apontar para
    ela. Nada e movido nem removido - `external_id`, alunos, gabaritos, QR e
    resultados continuam exatamente onde estavam; so ganham o ponteiro.
    """
    from sqlalchemy import text

    criadas = 0
    with engine.begin() as conn:
        pendentes = conn.execute(
            text("SELECT id FROM avaliacoes WHERE prova_id IS NULL")
        ).scalars().all()
        for aid in pendentes:
            import uuid as _uuid
            ext = f"prova-{_uuid.uuid4()}"
            conn.execute(
                text(
                    "INSERT INTO provas "
                    "(external_id, titulo, descricao, disciplina, subject_lp, subject_mat,"
                    " questions_per_subject, layout_mode, template, sae_spec, herby_spec,"
                    " grade_scale, owner_id, created_at, updated_at) "
                    "SELECT :ext, titulo, descricao, subject_lp, subject_lp, subject_mat,"
                    " questions_per_subject, layout_mode, template, sae_spec, herby_spec,"
                    " grade_scale, owner_id, created_at, created_at FROM avaliacoes WHERE id = :id"
                ),
                {"ext": ext, "id": aid},
            )
            nova_id = conn.execute(
                text("SELECT id FROM provas WHERE external_id = :ext"), {"ext": ext}
            ).scalar()
            conn.execute(
                text("UPDATE avaliacoes SET prova_id = :prova WHERE id = :id"),
                {"prova": nova_id, "id": aid},
            )
            criadas += 1
    if criadas:
        print(f"[migracao] {criadas} prova(s) criada(s) a partir de avaliacoes existentes")
    return {"criadas": criadas}


def _ensure_column(table: str, column: str, ddl_type: str) -> None:
    is_postgres = engine.dialect.name != "sqlite"
    with engine.begin() as conn:
        if is_postgres:
            exists = conn.execute(
                text("SELECT 1 FROM information_schema.columns WHERE table_name=:t AND column_name=:c"),
                {"t": table, "c": column},
            ).first()
            if not exists:
                # Postgres não aceita DEFAULT em ADD COLUMN com NOT NULL se tabela tem dados?
                # Usa valor default e depois seta NOT NULL — mas como ddl_type já inclui, tentamos direto
                try:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"))
                except Exception:
                    # fallback sem NOT NULL
                    base_type = ddl_type.split()[0]
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {base_type}"))
        else:
            cols = [row[1] for row in conn.exec_driver_sql(f"PRAGMA table_info({table})")]
            if cols and column not in cols:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
