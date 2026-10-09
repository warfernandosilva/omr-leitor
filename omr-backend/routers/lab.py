"""Laboratório OMR — Banco de Testes, Validação e Calibração.

Reusa os leitores de produção via omr/lab_read.py (NENHUM pipeline
paralelo). Coletar = upload de fotos + rodar o motor + guardar respostas,
componentes de score por bolha (LabOptionScore) e metadados por etapa.

Mapeamento de status do motor → leitura (tabela de verdade, usado na
exportação de métricas da Fase 2):
- ok      -> marcada
- low     -> AMBIGUA  (letra candidata preservada em detected_answer)
- duplicate -> AMBIGUA (marcas em duplicate_marks)
- blank   -> BRANCO
- leitura None -> ERRO_PROCESSAMENTO (status='error' na imagem)
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from pathlib import Path

import cv2
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

import auth
from database import get_db
from models import (
    CalibrationRun, LabImage, LabOptionScore, LabQuestion, LabSession, OmrConfig, User,
)
from omr.lab_metrics import OptionComponents
from omr.lab_read import TEMPLATES, normalize_template

router = APIRouter()

_LAB_ROOT = Path(__file__).resolve().parent.parent / "data" / "lab"

STATUS_LABEL = {"ok": "marcada", "low": "AMBIGUA", "duplicate": "AMBIGUA", "blank": "BRANCO"}

# Questões de 1..total; chave no ground_truth como string ("1".."N")
_TRUTH_KEY = re.compile(r"^\d+$")


class SessionCreate(BaseModel):
    nome: str
    descricao: str | None = None
    template: str = "padrao"
    questions_per_subject: int = 22
    layout_mode: str = "dual"
    adaptive: bool = False


class SessionPatch(BaseModel):
    nome: str | None = None
    descricao: str | None = None
    ground_truth: dict[str, str] | None = None


class GroundTruthIn(BaseModel):
    ground_truth: dict[str, str]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_session(db: Session, sid: int, user: User | None = None) -> LabSession:
    """Busca a sessão e aplica a política de acesso (dono ou admin).

    `user=None` é usado só internamente por helpers que já validaram o
    acesso via `auth.get_current_user` (que retorna 401 sozinho).
    """
    session = db.get(LabSession, sid)
    if session is None:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")
    if user is not None:
        auth.require_lab_owner_or_admin(session, user)
    return session


def _get_image(db: Session, iid: int, user: User | None = None) -> LabImage:
    img = db.get(LabImage, iid)
    if img is None:
        raise HTTPException(status_code=404, detail="Imagem não encontrada")
    if user is not None:
        session = db.get(LabSession, img.session_id)
        if session is None:
            raise HTTPException(status_code=404, detail="Sessão não encontrada")
        auth.require_lab_owner_or_admin(session, user)
    return img


def _session_dir(sid: int) -> Path:
    d = _LAB_ROOT / str(sid)
    d.mkdir(parents=True, exist_ok=True)
    (d / "original").mkdir(parents=True, exist_ok=True)
    (d / "_rectified").mkdir(parents=True, exist_ok=True)
    return d


def _safe_filename(name: str) -> str:
    return Path(name or "foto.jpg").name


def _apply_ground_truth(db: Session, session: LabSession) -> None:
    """Propaga o gabarito esperado para as questões já lidas na sessão."""
    truth = session.ground_truth or {}
    for question in db.execute(
        select(LabQuestion).join(LabImage).where(LabImage.session_id == session.id)
    ).scalars():
        key = str(question.question_number)
        question.truth_answer = truth.get(key)


def _image_dict(img: LabImage, include_scores: bool = False) -> dict:
    questions = []
    for q in img.questions:
        item = {
            "question": q.question_number,
            "status": q.status,
            "label": STATUS_LABEL.get(q.status, q.status),
            "detected": q.detected_answer,
            "truth": q.truth_answer,
            "duplicate_marks": q.duplicate_marks,
        }
        if include_scores:
            item["options"] = [
                {
                    "option": o.option, "score": o.score,
                    "mean_intensity": o.mean_intensity,
                    "dark_ratio": o.dark_ratio,
                    "contrast": o.contrast,
                    "otsu_threshold": o.otsu_threshold,
                }
                for o in q.options
            ]
        questions.append(item)
    questions.sort(key=lambda it: it["question"])
    answers = {str(q["question"]): q["detected"] for q in questions if q["detected"]}
    return {
        "id": img.id,
        "filename": img.filename,
        "status": img.status,
        "error": img.error,
        "template_used": img.template_used,
        "qr_id": img.qr_id,
        "total_questions": img.total_questions,
        "floor_used": img.floor_used,
        "floor_source": img.floor_source,
        "t_detect": img.t_detect,
        "t_warp": img.t_warp,
        "t_qr": img.t_qr,
        "t_score": img.t_score,
        "answers": answers,
        "questions": questions,
        "rectified_url": f"/api/lab/images/{img.id}/rectified" if img.rectified_path else None,
    }


# ---------------------------------------------------------------------------
# Sessões
# ---------------------------------------------------------------------------

@router.post("/api/lab/sessions", status_code=201)
def lab_create_session(
    payload: SessionCreate,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    # Rejeita em vez de cair no fallback silencioso de normalize_template:
    # um template desconhecido faria o Lab ler com o motor errado e gravar
    # "resposta errada" como se fosse leitura válida.
    if payload.template not in TEMPLATES:
        raise HTTPException(
            status_code=400,
            detail=f"template inválido: {payload.template!r}. Use um de: {', '.join(TEMPLATES)}",
        )
    session = LabSession(
        nome=payload.nome.strip() or "Sessão sem nome",
        descricao=payload.descricao,
        template=normalize_template(payload.template),
        questions_per_subject=max(1, int(payload.questions_per_subject or 22)),
        layout_mode="single" if payload.layout_mode == "single" else "dual",
        adaptive=bool(payload.adaptive),
        owner_id=current_user.id,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    _session_dir(session.id)
    return {
        "id": session.id,
        "nome": session.nome,
        "template": session.template,
        "questions_per_subject": session.questions_per_subject,
        "layout_mode": session.layout_mode,
        "adaptive": session.adaptive,
        "ground_truth": session.ground_truth,
    }


@router.get("/api/lab/sessions")
def lab_list_sessions(
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    stmt = select(LabSession).options(selectinload(LabSession.images))
    if current_user.role != "admin":
        # professor vê só as próprias sessões (as legadas sem dono também)
        stmt = stmt.where((LabSession.owner_id == current_user.id) | (LabSession.owner_id.is_(None)))
    rows = db.execute(stmt.order_by(LabSession.id.desc())).scalars().all()
    return {
        "sessions": [
            {
                "id": s.id,
                "nome": s.nome,
                "descricao": s.descricao,
                "template": s.template,
                "questions_per_subject": s.questions_per_subject,
                "layout_mode": s.layout_mode,
                "adaptive": s.adaptive,
                "n_images": len(s.images),
                "n_erro": sum(1 for i in s.images if i.status == "error"),
            }
            for s in rows
        ]
    }


@router.get("/api/lab/sessions/{sid}")
def lab_get_session(
    sid: int,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    session = _get_session(db, sid, current_user)
    images = db.execute(
        select(LabImage)
        .options(selectinload(LabImage.questions).selectinload(LabQuestion.options))
        .where(LabImage.session_id == sid)
        .order_by(LabImage.id)
    ).scalars().all()
    return {
        "id": session.id,
        "nome": session.nome,
        "descricao": session.descricao,
        "template": session.template,
        "questions_per_subject": session.questions_per_subject,
        "layout_mode": session.layout_mode,
        "adaptive": session.adaptive,
        "ground_truth": session.ground_truth,
        "images": [_image_dict(img, include_scores=True) for img in images],
    }


@router.patch("/api/lab/sessions/{sid}")
def lab_patch_session(
    sid: int,
    payload: SessionPatch,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    session = _get_session(db, sid, current_user)
    if payload.nome is not None:
        session.nome = payload.nome.strip() or session.nome
    if payload.descricao is not None:
        session.descricao = payload.descricao
    if payload.ground_truth is not None:
        session.ground_truth = payload.ground_truth
        _apply_ground_truth(db, session)
    db.commit()
    return {"ok": True, "id": session.id}


@router.post("/api/lab/sessions/{sid}/ground-truth")
def lab_ground_truth(
    sid: int,
    payload: GroundTruthIn,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    session = _get_session(db, sid, current_user)
    normalized = {k.strip(): v.strip().upper() for k, v in payload.ground_truth.items()}
    bad = [k for k in normalized if not _TRUTH_KEY.match(k)]
    if bad:
        raise HTTPException(
            status_code=400,
            detail=f"Chaves de questão inválidas (esperado '1'..'N'): {bad[:5]}",
        )
    session.ground_truth = normalized
    _apply_ground_truth(db, session)
    db.commit()
    return {"ok": True, "n_questoes": len(normalized)}


@router.delete("/api/lab/sessions/{sid}")
def lab_delete_session(
    sid: int,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    session = _get_session(db, sid, current_user)
    db.delete(session)
    db.commit()
    d = _LAB_ROOT / str(sid)
    try:
        import shutil
        shutil.rmtree(d, ignore_errors=True)
    except Exception:
        pass
    return {"ok": True}


# ---------------------------------------------------------------------------
# Imagens (upload + reprocessamento)
# ---------------------------------------------------------------------------

@router.post("/api/lab/sessions/{sid}/images")
def lab_upload_images(
    sid: int,
    files: list[UploadFile] = File(...),
    adaptive: bool = Form(False),
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    """Coleta fotos: roda o leitor de produção e persiste tudo por bolha.

    `def` (não async): pipeline cv2 bloqueante -> threadpool do FastAPI.
    O override de calibração entra DEPOIS (Fase 2), sempre via
    reprocessamento explícito — upload usa o motor de produção.

    Falhas de leitura (decode vazio, sem marcadores, QR ilegível) são
    persistidas como `LabImage(status='error')`: só assim `n_erro` e a
    métrica `n_erro_processamento` refletem a realidade do lote.
    """
    from main import _decode_image_bytes

    session = _get_session(db, sid, current_user)
    # Template que o leitor VAI usar (não o bruto da linha) — é o que a
    # imagem deve registrar, senão o histórico diz um modelo e o motor
    # rodou outro.
    tpl_used = normalize_template(session.template)
    d = _session_dir(sid)
    results: list[dict] = []

    def _fail(filename: str, error: str, rel_path: str | None) -> None:
        img = LabImage(
            session_id=session.id,
            filename=filename,
            original_path=rel_path or "",
            rectified_path=None,
            status="error",
            error=error,
            template_used=tpl_used,
        )
        db.add(img)
        db.flush()
        results.append({
            "filename": filename, "status": "error", "error": error,
            "image_id": img.id, "saved": rel_path,
        })

    for file in files:
        contents = file.file.read()
        original_name = _safe_filename(file.filename)
        if not contents or len(contents) < 100:
            _fail(original_name, "Imagem vazia", None)
            continue
        stored = f"{uuid.uuid4().hex[:12]}_{original_name}"
        original_path = d / "original" / stored
        original_path.write_bytes(contents)
        rel = str(original_path.relative_to(_LAB_ROOT))

        image = _decode_image_bytes(contents)
        if image is None:
            _fail(original_name, "Não foi possível decodificar a imagem", rel)
            continue

        from omr.lab_read import run_lab_pipeline, collect_option_metrics, failure_reason

        result = run_lab_pipeline(
            image,
            template=tpl_used,
            questions_per_subject=session.questions_per_subject,
            layout_mode=session.layout_mode,
            adaptive=adaptive or session.adaptive,
        )
        if result is None:
            _fail(original_name, failure_reason(image, tpl_used), rel)
            continue

        rectified_path = None
        if result.rectified is not None:
            rp = d / "_rectified" / (Path(stored).stem + ".png")
            cv2.imwrite(str(rp), result.rectified)
            rectified_path = str(rp.relative_to(_LAB_ROOT))

        img = LabImage(
            session_id=session.id,
            filename=original_name,
            original_path=str(original_path.relative_to(_LAB_ROOT)),
            rectified_path=rectified_path,
            status="processed",
            template_used=tpl_used,
            qr_id=result.qr_id,
            floor_used=result.floor_used,
            floor_source=result.floor_source,
            total_questions=len(result.all_ratios),
            t_detect=result.t_detect,
            t_warp=result.t_warp,
            t_qr=result.t_qr,
            t_score=result.t_score,
        )
        db.add(img)
        db.flush()

        duplicates = set(result.duplicate_questions or [])
        blanks = set(result.blank_questions or [])
        low_conf = set(result.low_confidence or [])
        answers_view: dict[str, str] = {}
        # Componentes de TODAS as bolhas numa passada só (o reader já tem a
        # retificada em mãos) — evita recalcular a métrica por questão.
        metrics = collect_option_metrics(
            result.rectified, tpl_used,
            session.questions_per_subject, session.layout_mode,
        )

        for q_num, _ratios in result.all_ratios.items():
            if q_num in duplicates:
                status, detected, marks = "duplicate", None, (result.duplicate_marks or {}).get(q_num, [])
            elif q_num in blanks:
                status, detected, marks = "blank", None, None
            elif q_num in low_conf:
                status, detected, marks = "low", result.answers.get(q_num), None
            else:
                status, detected, marks = "ok", result.answers.get(q_num), None
            if detected:
                answers_view[str(q_num)] = detected

            question = LabQuestion(
                image_id=img.id,
                question_number=int(q_num),
                status=status,
                detected_answer=detected,
                duplicate_marks=marks,
                truth_answer=(session.ground_truth or {}).get(str(q_num)),
            )
            db.add(question)
            db.flush()

            for letter, m in metrics.get(int(q_num), {}).items():
                db.add(LabOptionScore(
                    image_id=img.id,
                    question_id=question.id,
                    option=letter,
                    score=float(m.score),
                    mean_intensity=float(m.mean_intensity),
                    dark_ratio=float(m.dark_ratio),
                    contrast=float(m.contrast),
                    otsu_threshold=float(m.otsu_threshold),
                ))

        results.append({
            "filename": file.filename,
            "status": "processed",
            "image_id": img.id,
            "template_used": img.template_used,
            "qr_id": img.qr_id,
            "total_questions": img.total_questions,
            "floor_used": img.floor_used,
            "floor_source": img.floor_source,
            "answers": answers_view,
            "t_detect": img.t_detect,
            "t_warp": img.t_warp,
            "t_qr": img.t_qr,
            "t_score": img.t_score,
        })

    db.commit()
    return {"n_arquivos": len(files), "results": results}


@router.get("/api/lab/images/{iid}")
def lab_get_image(
    iid: int,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    img = db.get(
        LabImage, iid,
        options=[selectinload(LabImage.questions).selectinload(LabQuestion.options)],
    )
    if img is None:
        raise HTTPException(status_code=404, detail="Imagem não encontrada")
    _get_image(db, iid, current_user)
    return _image_dict(img, include_scores=True)


@router.get("/api/lab/images/{iid}/rectified")
def lab_image_rectified(
    iid: int,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    img = _get_image(db, iid, current_user)
    if not img.rectified_path:
        raise HTTPException(status_code=404, detail="Imagem retificada não disponível")
    path = _LAB_ROOT / img.rectified_path
    if not path.exists():
        raise HTTPException(status_code=404, detail="Arquivo da imagem retificada não encontrado")
    return FileResponse(path, media_type="image/png", filename=path.name)


# ---------------------------------------------------------------------------
# Fase 2 — Métricas, reclassificação, calibração, export, publicação
# ---------------------------------------------------------------------------

def _load_questions(db: Session, sid: int) -> list[LabQuestion]:
    return list(db.execute(
        select(LabQuestion)
        .join(LabImage).where(LabImage.session_id == sid)
        .options(selectinload(LabQuestion.options))
        .order_by(LabImage.id, LabQuestion.question_number)
    ).scalars().all())


def _question_dicts(questions: list[LabQuestion]) -> list[dict]:
    return [
        {
            "question": q.question_number,
            "status": q.status,
            "label": STATUS_LABEL.get(q.status, q.status),
            "detected": q.detected_answer,
            "truth": q.truth_answer,
            "duplicate_marks": q.duplicate_marks,
        }
        for q in questions
    ]


def _comps_for(q: LabQuestion) -> list[OptionComponents]:
    return [
        OptionComponents(
            letter=o.option,
            mean_intensity=o.mean_intensity,
            dark_ratio=o.dark_ratio,
            contrast=o.contrast,
            otsu_threshold=o.otsu_threshold,
        )
        for o in q.options
    ]


class ReclassifyIn(BaseModel):
    floor: float
    margin: float
    weights: list[float] | None = None
    low_conf_threshold: float | None = None
    persist: bool = False


@router.get("/api/lab/sessions/{sid}/metrics")
def lab_session_metrics(
    sid: int,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    """Métricas da sessão usando a classificação armazenada (motor atual)."""
    from omr.lab_metrics import compute_metrics

    session = _get_session(db, sid, current_user)
    questions = _load_questions(db, sid)
    n_images = db.execute(
        select(func.count(LabImage.id)).where(LabImage.session_id == sid)
    ).scalar() or 0
    n_erro = db.execute(
        select(func.count(LabImage.id)).where(LabImage.session_id == sid, LabImage.status == "error")
    ).scalar() or 0
    m = compute_metrics(_question_dicts(questions))
    m.update({
        "session_id": sid,
        "nome": session.nome,
        "template": session.template,
        "n_images": n_images,
        "n_erro_processamento": n_erro,
    })
    return m


@router.post("/api/lab/sessions/{sid}/reclassify")
def lab_reclassify(
    sid: int,
    payload: ReclassifyIn,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    """Reclassifica as questões a partir dos componentes SALVOS (sem reler a foto).

    Útil para "e se o floor fosse X?" rapidamente. Com persist=false (default)
    é simulação: nada muda no banco. Com persist=true grava o novo status.
    """
    from omr.lab_metrics import compute_metrics, reclassify_question

    session = _get_session(db, sid, current_user)
    weights = tuple(payload.weights) if payload.weights else None
    questions = _load_questions(db, sid)
    view = []
    for q in questions:
        comps = _comps_for(q)
        if comps:
            status, letter, marks, gap = reclassify_question(
                comps, payload.floor, payload.margin, weights, payload.low_conf_threshold
            )
        else:
            status, letter, marks, gap = q.status, q.detected_answer, q.duplicate_marks or [], 0.0
        if payload.persist and comps:
            q.status = status
            q.detected_answer = letter
            q.duplicate_marks = marks or None
        view.append({
            "question": q.question_number,
            "status": status,
            "label": STATUS_LABEL.get(status, status),
            "detected": letter,
            "truth": q.truth_answer,
            "confidence": gap,
            "duplicate_marks": marks,
        })
    if payload.persist:
        db.commit()
    m = compute_metrics(view)
    return {"persist": payload.persist, "metrics": m, "questions": view}


class CalibrationIn(BaseModel):
    floor_grid: list[float] | None = None
    margin_grid: list[float] | None = None
    weights_grid: list[list[float]] | None = None
    low_conf_threshold: float | None = None
    notes: str | None = None


@router.post("/api/lab/sessions/{sid}/calibration")
def lab_calibration(
    sid: int,
    payload: CalibrationIn,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    """Varre (floor × margin × pesos) sobre as questões com gabarito.

    Usa os componentes salvos (rápido) e ordena candidatos por acurácia,
    desempate por menos ambíguas. Não altera produção — devolve candidatos
    para publicar depois (endpoint /api/lab/configs/{id}/publish).
    """
    from omr.lab_metrics import grid_search, best_candidate

    session = _get_session(db, sid, current_user)
    questions = _load_questions(db, sid)
    items = [
        {"truth": q.truth_answer, "comps": _comps_for(q)}
        for q in questions if q.truth_answer and _comps_for(q)
    ]
    if not items:
        raise HTTPException(
            status_code=400,
            detail="Sem questões com gabarito e componentes — importe o gabarito (ground-truth) primeiro.",
        )
    floors = payload.floor_grid or [0.20, 0.25, 0.30, 0.35, 0.40, 0.45]
    margins = payload.margin_grid or [0.10, 0.15, 0.20, 0.22, 0.25, 0.30]
    weights = [tuple(w) for w in payload.weights_grid] if payload.weights_grid else [(0.4, 0.4, 0.2)]
    results = grid_search(
        items, floors, margins, weights, payload.low_conf_threshold
    )
    best = best_candidate(results)

    run = CalibrationRun(
        session_id=sid,
        template=normalize_template(session.template),
        grid={
            "floor_grid": floors, "margin_grid": margins,
            "weights_grid": [list(w) for w in weights],
            "low_conf_threshold": payload.low_conf_threshold,
        },
        best=best,
        n_candidates=len(results),
        notes=payload.notes,
        owner_id=current_user.id,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return {
        "run_id": run.id,
        "n_itens": len(items),
        "best": best,
        "results": results[:50],
    }


# ------------------------------- export -----------------------------------

def _export_sheets(db: Session, session: LabSession) -> dict[str, list[list]]:
    from omr.lab_metrics import compute_metrics

    questions = _load_questions(db, session.id)
    sheets: dict[str, list[list]] = {}
    sheets["metricas"] = [["sessao", "template", "total", "com_gabarito", "acertos", "erros",
                           "brancos", "ambiguas", "taxa_acerto", "taxa_erro"]]
    m = compute_metrics(_question_dicts(questions))
    sheets["metricas"].append([
        session.nome, session.template, m["total_questoes"], m["com_gabarito"], m["acertos"],
        m["erros"], m["brancos"], m["ambiguas"],
        m["taxa_acerto"], m["taxa_erro"],
    ])
    sheets["questoes"] = [["imagem", "questao", "status", "label", "detectado", "gabarito", "correta"]]
    for q in questions:
        correta = ""
        if q.truth_answer and q.status == "ok":
            correta = "sim" if q.detected_answer == q.truth_answer else "nao"
        sheets["questoes"].append([
            q.image_id, q.question_number, q.status,
            STATUS_LABEL.get(q.status, q.status), q.detected_answer or "", q.truth_answer or "", correta,
        ])
    sheets["scores"] = [["imagem", "questao", "opcao", "score", "media", "razao_escura", "contraste", "otsu"]]
    for q in questions:
        for o in q.options:
            sheets["scores"].append([
                q.image_id, q.question_number, o.option, o.score,
                o.mean_intensity, o.dark_ratio, o.contrast, o.otsu_threshold,
            ])
    return sheets


@router.get("/api/lab/sessions/{sid}/export")
def lab_export(
    sid: int,
    format: str = "json",
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    """Export da sessão. json traz abas prontas (o XLSX é montado no cliente);
    csv traz a aba de questões (uma linha por questão)."""
    import csv as _csv
    import io as _io
    import json as _json

    session = _get_session(db, sid, current_user)
    sheets = _export_sheets(db, session)
    if format == "csv":
        buf = _io.StringIO()
        writer = _csv.writer(buf)
        for row in sheets["questoes"]:
            writer.writerow(row)
        return PlainTextResponse(buf.getvalue(), media_type="text/csv")
    return _json.loads(_json.dumps({"session": {"id": session.id, "nome": session.nome,
                                                "template": session.template}, "sheets": sheets}))


# ---------------------- publicação / versionamento ------------------------

def _owned_config(db: Session, cid: int, user: User) -> OmrConfig:
    cfg = db.get(OmrConfig, cid)
    if cfg is None:
        raise HTTPException(status_code=404, detail="Configuração não encontrada")
    if cfg.owner_id is not None and cfg.owner_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="Sem permissão para esta configuração")
    return cfg


@router.get("/api/lab/configs")
def lab_list_configs(
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    from omr.params import get_active_config
    stmt = select(OmrConfig)
    if current_user.role != "admin":
        stmt = stmt.where((OmrConfig.owner_id == current_user.id) | (OmrConfig.owner_id.is_(None)))
    rows = db.execute(stmt.order_by(OmrConfig.id.desc())).scalars().all()
    return {
        "active_file": get_active_config(),
        "configs": [
            {
                "id": c.id, "nome": c.nome, "template": c.template, "params": c.params,
                "metrics": c.metrics, "ativa": c.ativa, "notes": c.notes,
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "published_at": c.published_at.isoformat() if c.published_at else None,
            }
            for c in rows
        ],
    }


class ConfigIn(BaseModel):
    nome: str
    template: str | None = None
    params: dict
    metrics: dict | None = None
    source_session_id: int | None = None
    source_run_id: int | None = None
    notes: str | None = None


@router.post("/api/lab/configs", status_code=201)
def lab_create_config(
    payload: ConfigIn,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    """Cria uma configuração (rascunho) — NÃO publica. Publique via /publish."""
    cfg = OmrConfig(
        nome=payload.nome.strip() or "Config",
        template=payload.template,
        params=payload.params,
        metrics=payload.metrics,
        source_session_id=payload.source_session_id,
        source_run_id=payload.source_run_id,
        notes=payload.notes,
        owner_id=current_user.id,
    )
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return {"id": cfg.id, "nome": cfg.nome, "ativa": cfg.ativa}


@router.post("/api/lab/configs/{cid}/publish")
def lab_publish_config(
    cid: int,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    """Publica a configuração: grava data/active_config.json e marca ativa.

    Só uma fica ativa por vez (desmarca as demais). Não altera thresholds
    de produção sem ação explícita — o motor só lê a config publicada
    quando solicitado pelo fluxo de calibração.
    """
    from omr.params import write_active_config

    cfg = _owned_config(db, cid, current_user)
    for other in db.execute(select(OmrConfig)).scalars().all():
        other.ativa = False
    cfg.ativa = True
    cfg.published_at = datetime.now()
    write_active_config(cfg.params)
    db.commit()
    return {"id": cfg.id, "nome": cfg.nome, "ativa": True,
            "published_at": cfg.published_at.isoformat()}


@router.post("/api/lab/configs/{cid}/rollback")
def lab_rollback_config(
    cid: int,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    """Reativa uma configuração anterior (volta a active_config.json)."""
    from omr.params import write_active_config

    cfg = _owned_config(db, cid, current_user)
    for other in db.execute(select(OmrConfig)).scalars().all():
        other.ativa = False
    cfg.ativa = True
    cfg.published_at = datetime.now()
    write_active_config(cfg.params)
    db.commit()
    return {"id": cfg.id, "nome": cfg.nome, "ativa": True}


@router.post("/api/lab/configs/deactivate")
def lab_deactivate_config(
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    """Remove a config publicada (volta ao default do config.py).

    Operação global (afeta o `active_config.json` do servidor): restrita a
    admin. Professor só publica/rollback nas próprias configs.
    """
    from omr.params import clear_active_config

    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Somente administradores podem remover a configuração publicada")
    for cfg in db.execute(select(OmrConfig)).scalars().all():
        cfg.ativa = False
    clear_active_config()
    db.commit()
    return {"ok": True, "ativa": None}