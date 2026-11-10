"""Seed isolado para validar o redesign do Gabarito+.

Cria um banco SQLite descartável com dados realistas para inspecionar
dashboard, provas, alunos, gabaritos, avaliações, resultados, relatórios,
Gabarito Personalizado e telas administrativas.

Uso:

    python tools/seed_demo.py --reset

O banco padrão é `data/dev-demo.db`. A variável `OMR_DB_PATH` tem prioridade
sobre `DATABASE_URL`, então o seed nunca aponta para o banco de produção.
"""

from __future__ import annotations

import argparse
import os
import random
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path

# Permite rodar como `python tools/seed_demo.py` dentro de omr-backend/.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

DEFAULT_DB = ROOT / "data" / "dev-demo.db"
DEMO_PASSWORD = "Demo1234"


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed isolado do Gabarito+")
    parser.add_argument(
        "--db",
        default=str(DEFAULT_DB),
        help="Caminho do banco SQLite isolado (padrão: data/dev-demo.db)",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Apaga o banco antes de criar os dados",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=20261110,
        help="Semente do gerador aleatório para resultados reprodutíveis",
    )
    return parser.parse_args()


ARGS = _parse_args()
DB_PATH = Path(ARGS.db).resolve()

if ARGS.reset:
    for suffix in ("", "-wal", "-shm"):
        target = Path(str(DB_PATH) + suffix)
        if target.exists():
            target.unlink()

DB_PATH.parent.mkdir(parents=True, exist_ok=True)
# OMR_DB_PATH tem prioridade no database.py e isola o seed de produção.
os.environ["OMR_DB_PATH"] = str(DB_PATH)
os.environ.pop("DATABASE_URL", None)

import cv2  # noqa: E402

import auth  # noqa: E402
from database import Base, engine, init_db, SessionLocal  # noqa: E402
from models import (  # noqa: E402
    Aluno,
    Avaliacao,
    CustomTemplate,
    CustomTemplateVersion,
    GabaritoNomeado,
    Turma,
    TurmaAluno,
    User,
)
from omr.card_generator import generate_card  # noqa: E402
from omr.custom_template import normalize_config, validate_config  # noqa: E402

OPTIONS = ["A", "B", "C", "D"]
TURMAS = [
    ("5 ANO A", 34),
    ("5 ANO B", 28),
    ("5 ANO C", 32),
]


def _answer_key(total: int, rng: random.Random) -> dict:
    return {str(i): rng.choice(OPTIONS) for i in range(1, total + 1)}


def _answers_from_key(key: dict, total: int, rng: random.Random) -> dict:
    """Respostas plausíveis: maioria correta, alguns erros e brancos."""
    out: dict[str, str] = {}
    for i in range(1, total + 1):
        expected = key.get(str(i), "A")
        roll = rng.random()
        if roll < 0.72:
            out[str(i)] = expected
        elif roll < 0.90:
            out[str(i)] = rng.choice([o for o in OPTIONS if o != expected])
        # 10% ficam em branco de propósito
    return out


def _nota(acertos: int, total: int) -> float:
    return round(acertos / total * 10, 1) if total else 0.0


def _codigo(seq: int) -> str:
    return f"OMR-2026-{seq:06d}"


def seed() -> None:
    rng = random.Random(ARGS.seed)
    init_db()
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        admin = User(
            email="demo@example.com",
            nome="Checkpoint UI",
            hashed_password=auth.hash_password(DEMO_PASSWORD),
            role="admin",
            is_active=True,
        )
        professor = User(
            email="professor@example.com",
            nome="Professora Demo",
            hashed_password=auth.hash_password(DEMO_PASSWORD),
            role="professor",
            is_active=True,
        )
        db.add_all([admin, professor])
        db.flush()

        turmas: list[Turma] = []
        for nome, total in TURMAS:
            turma = Turma(nome=nome, owner_id=admin.id)
            db.add(turma)
            db.flush()
            for i in range(1, total + 1):
                db.add(TurmaAluno(
                    turma_id=turma.id,
                    nome=f"Aluno {nome.split()[-1]}{i:02d} Demonstração",
                    matricula=f"2026{i:04d}",
                    identificador_externo=f"ext-{turma.id}-{i}",
                ))
            turmas.append(turma)
        db.flush()

        # ─── Prova padrão com resultados completos ───
        padrao = Avaliacao(
            external_id=str(uuid.uuid5(uuid.NAMESPACE_URL, "demo-prova-padrao")),
            titulo="5 ANO A - ATIVIDADE DEMO",
            turma="5 ANO A",
            turma_id=turmas[0].id,
            subject_lp="LÍNGUA PORTUGUESA",
            subject_mat="MATEMÁTICA",
            questions_per_subject=22,
            layout_mode="dual",
            template="padrao",
            grade_scale="0-10",
            owner_id=admin.id,
        )
        key = _answer_key(44, rng)
        padrao.answer_key = key
        db.add(padrao)
        db.flush()

        alunos_padrao = [
            Aluno(
                avaliacao_id=padrao.id,
                nome=a.nome,
                matricula=a.matricula,
                identificador_externo=a.identificador_externo,
                origem_turma_aluno_id=a.id,
            )
            for a in turmas[0].alunos
        ]
        db.add_all(alunos_padrao)
        db.flush()

        seq = 1
        now = datetime.now()
        for idx, aluno in enumerate(alunos_padrao):
            respostas = _answers_from_key(key, 44, rng)
            acertos = sum(1 for q, a in key.items() if respostas.get(q) == a)
            erros = len([q for q, a in key.items() if q in respostas and respostas[q] != a])
            brancos = 44 - len(respostas)
            if idx % 11 == 0:
                status = GabaritoNomeado.STATUS_LIDO
                data_leitura = now - timedelta(days=2)
                data_correcao = None
                nota = None
                acertos_db = erros_db = brancos_db = None
            else:
                status = GabaritoNomeado.STATUS_CORRIGIDO
                data_leitura = now - timedelta(days=2)
                data_correcao = data_leitura + timedelta(minutes=1)
                nota = _nota(acertos, 44)
                acertos_db, erros_db, brancos_db = acertos, erros, brancos
            gab = GabaritoNomeado(
                avaliacao_id=padrao.id,
                aluno_id=aluno.id,
                codigo_unico=_codigo(seq),
                qr_code_payload=_codigo(seq),
                numero_pagina=idx + 1,
                status=status,
                respostas=respostas,
                acertos=acertos_db,
                erros=erros_db,
                brancos=brancos_db,
                nota=nota,
                data_leitura=data_leitura,
                data_correcao=data_correcao,
                photo_status="Successful",
            )
            db.add(gab)
            seq += 1
        db.flush()

        # ─── Prova com pendências e status variados ───
        pendentes = Avaliacao(
            external_id=str(uuid.uuid5(uuid.NAMESPACE_URL, "demo-prova-pendentes")),
            titulo="5 ANO B - REVISÃO DEMO",
            turma="5 ANO B",
            turma_id=turmas[1].id,
            subject_lp="LÍNGUA PORTUGUESA",
            subject_mat="MATEMÁTICA",
            questions_per_subject=22,
            layout_mode="dual",
            template="padrao",
            grade_scale="0-10",
            owner_id=admin.id,
        )
        key_pendentes = _answer_key(44, rng)
        pendentes.answer_key = key_pendentes
        db.add(pendentes)
        db.flush()

        alunos_pendentes = [
            Aluno(
                avaliacao_id=pendentes.id,
                nome=a.nome,
                matricula=a.matricula,
                identificador_externo=a.identificador_externo,
                origem_turma_aluno_id=a.id,
            )
            for a in turmas[1].alunos
        ]
        db.add_all(alunos_pendentes)
        db.flush()

        for idx, aluno in enumerate(alunos_pendentes):
            # 8 corrigidos, 6 lidos, 5 gerados e o restante com problemas.
            if idx < 8:
                status = GabaritoNomeado.STATUS_CORRIGIDO
                respostas = _answers_from_key(key_pendentes, 44, rng)
                acertos = sum(1 for q, a in key_pendentes.items() if respostas.get(q) == a)
                db.add(GabaritoNomeado(
                    avaliacao_id=pendentes.id,
                    aluno_id=aluno.id,
                    codigo_unico=_codigo(seq),
                    qr_code_payload=_codigo(seq),
                    numero_pagina=idx + 1,
                    status=status,
                    respostas=respostas,
                    acertos=acertos,
                    erros=44 - len(respostas) - acertos,
                    brancos=44 - len(respostas),
                    nota=_nota(acertos, 44),
                    data_leitura=now - timedelta(days=4),
                    data_correcao=now - timedelta(days=4),
                    photo_status="Successful",
                ))
                seq += 1
            elif idx < 14:
                db.add(GabaritoNomeado(
                    avaliacao_id=pendentes.id,
                    aluno_id=aluno.id,
                    codigo_unico=_codigo(seq),
                    qr_code_payload=_codigo(seq),
                    numero_pagina=idx + 1,
                    status=GabaritoNomeado.STATUS_LIDO,
                    data_leitura=now - timedelta(days=1),
                    photo_status="Successful",
                ))
                seq += 1
            elif idx < 19:
                db.add(GabaritoNomeado(
                    avaliacao_id=pendentes.id,
                    aluno_id=aluno.id,
                    codigo_unico=_codigo(seq),
                    qr_code_payload=_codigo(seq),
                    numero_pagina=idx + 1,
                    status=GabaritoNomeado.STATUS_GERADO,
                    photo_status=None,
                ))
                seq += 1
            else:
                observacao = (
                    "dupla marcação em Q3 e Q7"
                    if idx % 3 == 0
                    else "leitura incerta em Q12"
                    if idx % 3 == 1
                    else "QR não lido na foto"
                )
                db.add(GabaritoNomeado(
                    avaliacao_id=pendentes.id,
                    aluno_id=aluno.id,
                    codigo_unico=_codigo(seq),
                    qr_code_payload=_codigo(seq),
                    numero_pagina=idx + 1,
                    status=GabaritoNomeado.STATUS_LIDO,
                    observacoes=observacao,
                    data_leitura=now - timedelta(hours=6),
                    photo_status="QrNotRead" if "QR" in observacao else "Successful",
                ))
                seq += 1
        db.flush()

        # ─── Gabarito Personalizado ativo + prova vinculada ───
        spec = {
            "n_questions": 12,
            "n_options": 4,
            "columns": 1,
            "page_format": "A4",
            "orientation": "portrait",
            "title": "GABARITO PERSONALIZADO DEMO",
            "subtitle": "Modelo ativo para validação do editor",
            "school": "Escola Demo",
            "teacher": "Prof. Demo",
            "instructions": "Preencha com caneta preta.\nNão rasure.",
        }
        card = generate_card(spec)
        cfg = normalize_config(card.config)
        issues = validate_config(cfg)
        tpl_dir = ROOT / "data" / "custom_templates"
        tpl_dir.mkdir(parents=True, exist_ok=True)

        custom_exam = Avaliacao(
            external_id=str(uuid.uuid5(uuid.NAMESPACE_URL, "demo-prova-custom")),
            titulo="5 ANO C - PERSONALIZADO DEMO",
            turma="5 ANO C",
            turma_id=turmas[2].id,
            subject_lp="GABARITO PERSONALIZADO DEMO",
            subject_mat="GABARITO PERSONALIZADO DEMO",
            questions_per_subject=12,
            layout_mode="single",
            template="custom",
            grade_scale="0-10",
            owner_id=admin.id,
        )
        custom_key = _answer_key(12, rng)
        custom_exam.answer_key = custom_key
        db.add(custom_exam)
        db.flush()

        # Precisa do id do template para montar o path da imagem.
        tpl = CustomTemplate(
            nome="DEMO - Gabarito Personalizado",
            config=cfg,
            image_path="",
            image_w=int(card.image.shape[1]),
            image_h=int(card.image.shape[0]),
            status=CustomTemplate.STATUS_ATIVO,
            version=1,
            last_issues=issues,
            owner_id=admin.id,
            avaliacao_id=custom_exam.id,
        )
        db.add(tpl)
        db.flush()
        custom_exam.custom_template_id = tpl.id
        db.flush()

        tpl_path = tpl_dir / str(tpl.id) / "original.png"
        tpl_path.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(tpl_path), card.image)
        tpl.image_path = str(tpl_path)
        db.add(CustomTemplateVersion(
            template_id=tpl.id,
            version=1,
            config=normalize_config(cfg),
        ))
        db.flush()

        alunos_custom = [
            Aluno(
                avaliacao_id=custom_exam.id,
                nome=a.nome,
                matricula=a.matricula,
                identificador_externo=a.identificador_externo,
                origem_turma_aluno_id=a.id,
            )
            for a in turmas[2].alunos
        ]
        db.add_all(alunos_custom)
        db.flush()

        for idx, aluno in enumerate(alunos_custom):
            respostas = _answers_from_key(custom_key, 12, rng)
            acertos = sum(1 for q, a in custom_key.items() if respostas.get(q) == a)
            if idx % 9 == 0:
                db.add(GabaritoNomeado(
                    avaliacao_id=custom_exam.id,
                    aluno_id=aluno.id,
                    codigo_unico=_codigo(seq),
                    qr_code_payload=_codigo(seq),
                    numero_pagina=idx + 1,
                    status=GabaritoNomeado.STATUS_GERADO,
                    photo_status=None,
                ))
            else:
                db.add(GabaritoNomeado(
                    avaliacao_id=custom_exam.id,
                    aluno_id=aluno.id,
                    codigo_unico=_codigo(seq),
                    qr_code_payload=_codigo(seq),
                    numero_pagina=idx + 1,
                    status=GabaritoNomeado.STATUS_CORRIGIDO,
                    respostas=respostas,
                    acertos=acertos,
                    erros=12 - len(respostas) - acertos,
                    brancos=12 - len(respostas),
                    nota=_nota(acertos, 12),
                    data_leitura=now - timedelta(days=3),
                    data_correcao=now - timedelta(days=3),
                    photo_status="Successful",
                ))
            seq += 1

        db.commit()

        print("Seed concluído.")
        print(f"Banco: {DB_PATH}")
        print("Usuários:")
        print(f"  admin       {admin.email} / {DEMO_PASSWORD}")
        print(f"  professor   {professor.email} / {DEMO_PASSWORD}")
        print("Provas:")
        print(f"  {padrao.titulo}")
        print(f"  {pendentes.titulo}")
        print(f"  {custom_exam.titulo}")
        print(f"Gabarito Personalizado: {tpl.nome} (id {tpl.id}, versão {tpl.version})")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
