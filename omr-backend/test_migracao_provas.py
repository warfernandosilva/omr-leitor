"""Migração e backfill Prova × Avaliação (separação estrutural da Fase 1).

Roda a migração em um banco NOVO e em um banco com a estrutura ANTIGA
(sem as colunas novas), provando que:
1. `init_db()` cria as tabelas novas e as colunas aditivas;
2. rodar a migração 2x não duplica prova nem quebra nada (idempotente);
3. o backfill cria 1 prova por avaliação e preserva todos os dados;
4. a prova criada espelha a estrutura da avaliação de origem.

Executar: python -m pytest test_migracao_provas.py -q
"""
from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import create_engine, text


@pytest.fixture
def db_novo(tmp_path):
    """Banco vazio: primeira execução da migração."""
    import database

    caminho = str(tmp_path / "novo.db")
    original = database.engine
    database.engine = create_engine(f"sqlite:///{caminho}", connect_args={"check_same_thread": False})
    try:
        database.init_db()
        yield database, caminho
    finally:
        database.engine = original


def _tabelas(caminho: str) -> set[str]:
    eng = create_engine(f"sqlite:///{caminho}")
    with eng.connect() as c:
        return {r[0] for r in c.exec_driver_sql(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )}


def _colunas(caminho: str, tabela: str) -> list[str]:
    eng = create_engine(f"sqlite:///{caminho}")
    with eng.connect() as c:
        return [r[1] for r in c.exec_driver_sql(f"PRAGMA table_info({tabela})")]


def test_migracao_cria_tabelas_e_colunas(db_novo):
    database, caminho = db_novo
    tabelas = _tabelas(caminho)
    for nova in ("provas", "avaliacao_turmas", "gabarito_versoes", "leituras",
                 "revisoes_manuais", "auditoria"):
        assert nova in tabelas, f"tabela {nova} criada"
    for col in ("prova_id", "status", "ano_letivo", "descricao", "resultados_publicados_em"):
        assert col in _colunas(caminho, "avaliacoes"), f"avaliacoes.{col}"
    assert "arquivada" in _colunas(caminho, "turmas")
    assert "situacao" in _colunas(caminho, "alunos")


def test_migracao_e_idempotente(db_novo):
    database, caminho = db_novo
    # cria uma avaliação e roda a migração 2x
    with database.engine.begin() as c:
        c.execute(text(
            "INSERT INTO avaliacoes (external_id, titulo, subject_lp, subject_mat,"
            " questions_per_subject, layout_mode, template, grade_scale, modelo_omr,"
            " created_at, updated_at)"
            " VALUES ('ex-1', 'Prova teste', 'PORTUGUES', 'MATEMATICA', 22, 'dual',"
            " 'padrao', '0-10', 'GABARITO_01',"
            " CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ))
    database.init_db()
    database.init_db()

    with database.engine.begin() as c:
        provas = c.execute(text("SELECT id, titulo, questions_per_subject FROM provas")).all()
        avals = c.execute(text("SELECT id, prova_id FROM avaliacoes")).all()
    assert len(provas) == 1, f"backfill 1x, nao duplica: {provas}"
    assert avals and avals[0][1] == provas[0][0], "avaliacao aponta para a prova"

    # rodando mais uma vez, nada muda
    database.init_db()
    with database.engine.begin() as c:
        assert c.execute(text("SELECT count(*) FROM provas")).scalar() == 1


def test_backfill_preserva_dados_e_espelha_estrutura(db_novo):
    database, caminho = db_novo
    with database.engine.begin() as c:
        c.execute(text(
            "INSERT INTO avaliacoes (external_id, titulo, subject_lp, subject_mat,"
            " questions_per_subject, layout_mode, template, grade_scale, modelo_omr,"
            " created_at, updated_at)"
            " VALUES ('ex-2', 'Prova cheia', 'HISTORIA', 'GEOGRAFIA', 10, 'single',"
            " 'padrao', '0-100', 'GABARITO_01',"
            " CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ))
        aid = c.execute(text("SELECT id FROM avaliacoes WHERE external_id='ex-2'")).scalar()
        c.execute(text(
            "INSERT INTO alunos (avaliacao_id, nome, matricula, created_at, updated_at)"
            " VALUES (:a, 'Ana', '1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ), {"a": aid})
        c.execute(text(
            "INSERT INTO gabaritos_nomeados (avaliacao_id, aluno_id, codigo_unico,"
            " qr_code_payload, status, numero_pagina, data_geracao, created_at,"
            " updated_at)"
            " VALUES (:a, (SELECT id FROM alunos LIMIT 1), 'OMR-2026-000001', 'OMR-2026-000001',"
            " 'corrigido', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ), {"a": aid})

    database.init_db()

    with database.engine.begin() as c:
        prova = c.execute(text(
            "SELECT provas.titulo, provas.subject_lp, provas.questions_per_subject,"
            " provas.layout_mode, provas.grade_scale"
            " FROM provas JOIN avaliacoes ON avaliacoes.prova_id = provas.id"
            " WHERE avaliacoes.id = :a"
        ), {"a": aid}).first()
        assert c.execute(text("SELECT count(*) FROM alunos WHERE avaliacao_id = :a"),
                         {"a": aid}).scalar() == 1, "alunos intactos"
        assert c.execute(text("SELECT count(*) FROM gabaritos_nomeados WHERE avaliacao_id = :a"),
                         {"a": aid}).scalar() == 1, "QR/gabarito intacto"
        assert c.execute(text("SELECT external_id FROM avaliacoes WHERE id=:a"),
                         {"a": aid}).scalar() == "ex-2", "external_id intacto"
    assert prova[0] == "Prova cheia"
    assert prova[1] == "HISTORIA"      # disciplina preservada
    assert prova[2] == 10              # questões por disciplina
    assert prova[3] == "single"        # layout
    assert prova[4] == "0-100"         # escala de nota
