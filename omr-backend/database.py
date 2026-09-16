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

from sqlalchemy import create_engine, text
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

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    """Cria as tabelas se não existirem + migrações leves de colunas."""
    import models  # noqa: F401  (registra os models no Base.metadata)

    Base.metadata.create_all(bind=engine)

    # Migração: colunas adicionadas após a primeira versão do banco
    _ensure_column("avaliacoes", "questions_per_subject", "INTEGER NOT NULL DEFAULT 22")
    _ensure_column("avaliacoes", "layout_mode", "VARCHAR(10) NOT NULL DEFAULT 'dual'")
    _ensure_column("avaliacoes", "grade_scale", "VARCHAR(10) NOT NULL DEFAULT '0-10'")
    _ensure_column("avaliacoes", "answer_key", "JSON")
    _ensure_column("avaliacoes", "owner_id", "INTEGER REFERENCES users(id)")


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
