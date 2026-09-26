"""Backup: export/restore roundtrip em banco isolado (SQLite).

Executar: python -m pytest test_backup.py -q
"""
import json


def test_backup_roundtrip(db_session, tmp_path):
    from models import Aluno, Avaliacao, DeletedExam, GabaritoNomeado, User

    db = db_session()
    try:
        u = User(email="b@example.com", nome="Backup", hashed_password="x", role="admin")
        db.add(u)
        db.flush()
        av = Avaliacao(external_id="exam-bk", titulo="Prova BK", turma="9A", owner_id=u.id,
                       answer_key={"1": "A", "2": "B"})
        db.add(av)
        db.flush()
        al = Aluno(avaliacao_id=av.id, nome="Aluno BK", matricula="101")
        db.add(al)
        db.flush()
        g = GabaritoNomeado(avaliacao_id=av.id, aluno_id=al.id, codigo_unico="OMR-2026-000001",
                            qr_code_payload="OMR-2026-000001", status="gerado")
        db.add(g)
        t = DeletedExam(external_id="exam-morta", owner_id=u.id)
        db.add(t)
        db.commit()
    finally:
        db.close()

    from backup import export_all, backup_to_file, restore_all

    data = export_all()
    assert data["counts"] == {"users": 1, "avaliacoes": 1, "alunos": 1, "gabaritos": 1, "tombstones": 1}, \
        f"export: contagens corretas: {data['counts']}"

    # roundtrip via arquivo: grava, restaura por cima (upsert)
    p, _ = backup_to_file(tmp_path / "dump.json")
    raw = json.loads(p.read_text(encoding="utf-8"))
    assert raw["avaliacoes"][0]["answer_key"] == {"1": "A", "2": "B"}, \
        "arquivo: JSON fiel (answer_key preservada)"

    n = restore_all(raw)
    assert n == {"users": 1, "avaliacoes": 1, "alunos": 1, "gabaritos": 1, "tombstones": 1}, \
        f"restore: upsert sem duplicar: {n}"

    # upsert de novo (idempotente)
    n2 = restore_all(raw)
    assert n2 == n, f"restore idempotente: {n2}"

    # conferência: dados continuam lá
    db = db_session()
    try:
        av2 = db.query(Avaliacao).filter_by(external_id="exam-bk").one()
        assert av2.answer_key == {"1": "A", "2": "B"}
        assert db.query(GabaritoNomeado).filter_by(codigo_unico="OMR-2026-000001").count() == 1
    finally:
        db.close()


if __name__ == "__main__":
    import pytest as _pytest
    import sys as _sys
    _sys.exit(_pytest.main([__file__, "-q"]))
