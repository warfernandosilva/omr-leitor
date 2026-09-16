import sqlite3
import os
from pathlib import Path
from sqlalchemy import text
from database import engine as pg_engine  # já é Postgres por causa do .env

sqlite_path = Path("data/omr.db")
if not sqlite_path.exists():
    print("SQLite não encontrado, nada para migrar.")
    exit(0)

print(f"SQLite: {sqlite_path}")
print(f"Postgres: {pg_engine.url}")

# Verifica se Postgres já tem dados — não sobrescrever sem confirmação
from sqlalchemy import text as t
pg_counts = {}
with pg_engine.connect() as c:
    for tbl in ["avaliacoes", "alunos", "gabaritos_nomeados"]:
        pg_counts[tbl] = c.execute(t(f"SELECT COUNT(*) FROM {tbl}")).scalar()
print(f"Postgres antes: {pg_counts}")
if any(v > 0 for v in pg_counts.values()):
    print("Postgres já contém dados — abortando para não duplicar. Apague manualmente se quiser re-migrar.")
    exit(0)

conn = sqlite3.connect(str(sqlite_path))
conn.row_factory = sqlite3.Row

with pg_engine.begin() as pg:
    # 1. avaliacoes
    rows = conn.execute("SELECT * FROM avaliacoes").fetchall()
    print(f"Migrando {len(rows)} avaliacoes...")
    for r in rows:
        pg.execute(text("""
            INSERT INTO avaliacoes (id, external_id, titulo, turma, modelo_omr, subject_lp, subject_mat, questions_per_subject, layout_mode, created_at, updated_at)
            VALUES (:id, :external_id, :titulo, :turma, :modelo_omr, :subject_lp, :subject_mat, :questions_per_subject, :layout_mode, :created_at, :updated_at)
        """), dict(r))
    # 2. alunos
    rows = conn.execute("SELECT * FROM alunos").fetchall()
    print(f"Migrando {len(rows)} alunos...")
    for r in rows:
        pg.execute(text("""
            INSERT INTO alunos (id, avaliacao_id, nome, matricula, identificador_externo, created_at, updated_at)
            VALUES (:id, :avaliacao_id, :nome, :matricula, :identificador_externo, :created_at, :updated_at)
        """), dict(r))
    # 3. gabaritos
    rows = conn.execute("SELECT * FROM gabaritos_nomeados").fetchall()
    print(f"Migrando {len(rows)} gabaritos...")
    for r in rows:
        d = dict(r)
        # JSON col respostas pode ser string no SQLite
        pg.execute(text("""
            INSERT INTO gabaritos_nomeados (id, avaliacao_id, aluno_id, codigo_unico, qr_code_payload, numero_pagina, status, respostas, acertos, erros, brancos, nota, observacoes, data_geracao, data_leitura, data_correcao, created_at, updated_at)
            VALUES (:id, :avaliacao_id, :aluno_id, :codigo_unico, :qr_code_payload, :numero_pagina, :status, CAST(:respostas AS JSON), :acertos, :erros, :brancos, :nota, :observacoes, :data_geracao, :data_leitura, :data_correcao, :created_at, :updated_at)
        """), d)
    # Ajusta sequences
    for tbl, col in [("avaliacoes","id"), ("alunos","id"), ("gabaritos_nomeados","id")]:
        pg.execute(text(f"SELECT setval(pg_get_serial_sequence('{tbl}','{col}'), COALESCE((SELECT MAX({col}) FROM {tbl}), 1))"))

print("Migração concluída.")
with pg_engine.connect() as c:
    for tbl in ["avaliacoes", "alunos", "gabaritos_nomeados"]:
        cnt = c.execute(t(f"SELECT COUNT(*) FROM {tbl}")).scalar()
        print(f"  {tbl}: {cnt}")

# Backup do SQLite
import shutil
bak = Path("data/omr.db.sqlite.bak")
if not bak.exists():
    shutil.copy(str(sqlite_path), str(bak))
    print(f"Backup SQLite em {bak}")
