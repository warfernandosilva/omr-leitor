"""Infra compartilhada do pytest: DB isolado por módulo + cliente HTTP.

- Cada módulo test_*.py ganha um SQLite temporário PRÓPRIO: `database.SessionLocal`
  é religado a ele e `get_db` é sobrescrito via `dependency_overrides` — o mesmo
  isolamento que cada script tinha com OMR_DB_PATH, sem o boilerplate repetido.
- `main.OPS_BUFFER` é zerado por módulo (test_ops.py conta chamadas do zero).
- OMR_DB_PATH da sessão aponta para um banco descartável: o engine criado no
  import de main.py (retry de 60s + purga de boot) nunca toca o data/omr.db real.
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

_BACKEND_DIR = Path(__file__).resolve().parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

# Console Windows (cp1252): evita UnicodeEncodeError nos nomes dos testes
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Banco descartável da SESSÃO — lido por database.py no import de main.
_SESSION_DIR = tempfile.mkdtemp(prefix="omr_pytest_session_")
os.environ.setdefault("OMR_DB_PATH", os.path.join(_SESSION_DIR, "session.db"))

import pytest  # noqa: E402

# Senha padrão dos usuários de teste (mínimo do /api/auth/register: 8 chars)
TEST_PASSWORD = "12345678"


@pytest.fixture(scope="module")
def isolated(tmp_path_factory):
    """DB + app isolados por módulo. Devolve namespace com:
    db_file, engine, Session, client e reopen() (simula fechar e reabrir)."""
    import database
    from database import Base, get_db
    import models  # noqa: F401 — registra as tabelas no Base.metadata
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    db_file = str(tmp_path_factory.mktemp("omr_db") / "test.db")
    holder: dict = {}

    def _build_engine(path: str):
        eng = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
        with eng.begin() as conn:
            conn.exec_driver_sql("PRAGMA journal_mode=WAL")
            conn.exec_driver_sql("PRAGMA busy_timeout=5000")
        return eng

    engine = _build_engine(db_file)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    holder["engine"] = engine
    holder["Session"] = Session

    prev_session_local = database.SessionLocal
    database.SessionLocal = Session

    import main as main_module

    def _override():
        db = holder["Session"]()
        try:
            yield db
        finally:
            db.close()

    main_module.app.dependency_overrides[get_db] = _override
    main_module.OPS_BUFFER.clear()

    from fastapi.testclient import TestClient
    client = TestClient(main_module.app)

    def reopen():
        """Fecha e reabre a conexão no MESMO arquivo (simula restart do sistema)."""
        holder["engine"].dispose()
        eng2 = _build_engine(db_file)
        holder["engine"] = eng2
        S2 = sessionmaker(bind=eng2, autoflush=False, autocommit=False, expire_on_commit=False)
        holder["Session"] = S2
        database.SessionLocal = S2

    ns = SimpleNamespace(db_file=db_file, engine=engine, Session=Session,
                         client=client, reopen=reopen, holder=holder)
    yield ns

    main_module.app.dependency_overrides.pop(get_db, None)
    database.SessionLocal = prev_session_local
    holder["engine"].dispose()


@pytest.fixture(scope="module")
def client(isolated):
    """TestClient ligado ao DB isolado do módulo."""
    return isolated.client


@pytest.fixture(scope="module")
def db_session(isolated):
    """Fábrica de sessões no DB do módulo (promoção a admin, asserts diretos)."""
    return isolated.Session


@pytest.fixture(scope="module")
def authed(client):
    """Cliente autenticado (registra ou loga o usuário padrão do módulo)."""
    r = client.post("/api/auth/register", json={
        "email": "test@example.com", "nome": "Teste", "password": TEST_PASSWORD})
    if r.status_code == 400:
        r = client.post("/api/auth/login",
                        data={"username": "test@example.com", "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    client.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    return client
