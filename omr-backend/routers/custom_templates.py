"""Gabarito Personalizado — CRUD, editor (config), validação, teste e impressão.

Reusa o motor de produção via `omr.custom_template.process_custom_image`.
A imagem importada é guardada em data/custom_templates/<id>/original.png e
as regiões ficam em `custom_templates.config` (coordenadas normalizadas).
"""

from __future__ import annotations

import base64
import io
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

import auth
from database import get_db
from models import (
    Aluno, Avaliacao, CustomTemplate, CustomTemplateVersion, GabaritoNomeado, User,
)
from omr.custom_template import (
    config_summary,
    default_config,
    detect_grid,
    expand_bubbles,
    has_errors,
    normalize_config,
    process_custom_image,
    render_overlay,
    render_preview_overlay,
    validate_config,
)

router = APIRouter()

_ROOT = Path(__file__).resolve().parent.parent / "data" / "custom_templates"

TEMPLATE_STATUSES = (
    CustomTemplate.STATUS_RASCUNHO,
    CustomTemplate.STATUS_VALIDADO,
    CustomTemplate.STATUS_ATIVO,
)


# ---------------------------------------------------------------------------
# Modelos de entrada
# ---------------------------------------------------------------------------

class TemplatePatch(BaseModel):
    nome: str | None = None
    config: dict | None = None


class PrintStudent(BaseModel):
    nome: str
    matricula: str | None = None
    codigo: str | None = None


class PrintRequest(BaseModel):
    mode: str = "blank"  # blank | students | avaliacao
    format: str = "PDF"  # PDF | PNG
    students: list[PrintStudent] | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_template(db: Session, tid: int, user: User | None = None) -> CustomTemplate:
    tpl = db.get(CustomTemplate, tid)
    if tpl is None:
        raise HTTPException(status_code=404, detail="Gabarito personalizado não encontrado")
    if user is not None and tpl.owner_id is not None and tpl.owner_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="Sem permissão para este gabarito")
    return tpl


def _template_dir(tid: int) -> Path:
    d = _ROOT / str(tid)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _decode_image_bytes(contents: bytes) -> np.ndarray | None:
    """Decodifica com correção EXIF + fallback Pillow (mesmo do main.py)."""
    try:
        nparr = np.frombuffer(contents, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("cv2 imdecode falhou")
        try:
            from PIL import Image, ImageOps
            pil = ImageOps.exif_transpose(Image.open(io.BytesIO(contents)))
            if pil is not None and pil.size != (image.shape[1], image.shape[0]):
                image = cv2.cvtColor(np.array(pil.convert("RGB")), cv2.COLOR_RGB2BGR)
        except Exception:
            pass
        return image
    except (cv2.error, ValueError):
        try:
            from PIL import Image, ImageOps
            pil = ImageOps.exif_transpose(Image.open(io.BytesIO(contents))).convert("RGB")
            return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
        except Exception:
            return None


def _data_url_jpeg(bgr: np.ndarray, quality: int = 85, max_side: int = 1400) -> str | None:
    if bgr is None:
        return None
    try:
        h, w = bgr.shape[:2]
        scale = min(1.0, max_side / float(max(h, w)))
        img = bgr if scale >= 1.0 else cv2.resize(bgr, None, fx=scale, fy=scale,
                                                   interpolation=cv2.INTER_AREA)
        _, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
        return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode("ascii")
    except Exception:
        return None


def _load_image(tpl: CustomTemplate) -> np.ndarray | None:
    p = Path(tpl.image_path)
    if not p.exists():
        return None
    return cv2.imread(str(p))


def _next_codigo(db: Session) -> str:
    year = datetime.now().year
    prefix = f"OMR-{year}-"
    last = db.scalar(
        select(func.max(GabaritoNomeado.codigo_unico)).where(
            GabaritoNomeado.codigo_unico.like(prefix + "%")
        )
    )
    seq = int(last[len(prefix):]) + 1 if last else 1
    return f"{prefix}{seq:06d}"


def _summary(tpl: CustomTemplate) -> dict:
    return {
        "id": tpl.id,
        "nome": tpl.nome,
        "version": tpl.version,
        "status": tpl.status,
        "avaliacao_id": tpl.avaliacao_id,
        "image_w": tpl.image_w,
        "image_h": tpl.image_h,
        "config_summary": config_summary(tpl.config or {}),
        "created_at": tpl.created_at.isoformat() if tpl.created_at else None,
        "updated_at": tpl.updated_at.isoformat() if tpl.updated_at else None,
    }


def _detail(tpl: CustomTemplate) -> dict:
    d = _summary(tpl)
    d["config"] = normalize_config(tpl.config or {})
    d["issues"] = tpl.last_issues
    d["image_url"] = f"/api/custom-templates/{tpl.id}/image"
    d["preview_url"] = f"/api/custom-templates/{tpl.id}/preview"
    return d


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

@router.post("/api/custom-templates", status_code=201)
def create_template(
    file: UploadFile = File(...),
    nome: str = Form("Gabarito personalizado"),
    avaliacao_external_id: str | None = Form(None),
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    """Importa a imagem de referência e cria o modelo (rascunho)."""
    contents = file.file.read()
    if not contents or len(contents) < 100:
        raise HTTPException(status_code=400, detail="Imagem vazia ou inválida.")
    if len(contents) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Imagem muito grande (limite 20MB).")

    image = _decode_image_bytes(contents)
    if image is None:
        raise HTTPException(status_code=400, detail="Não foi possível decodificar a imagem (use PNG ou JPG).")

    h, w = image.shape[:2]
    avaliacao = None
    if avaliacao_external_id:
        avaliacao = db.scalar(select(Avaliacao).where(Avaliacao.external_id == avaliacao_external_id))
        if avaliacao is None:
            raise HTTPException(status_code=404, detail="Avaliação não encontrada")
        auth.require_owner_or_admin(avaliacao, current_user)

    tpl = CustomTemplate(
        nome=(nome or "Gabarito personalizado").strip()[:200],
        config=default_config(w, h),
        image_path="",
        image_w=w,
        image_h=h,
        status=CustomTemplate.STATUS_RASCUNHO,
        owner_id=current_user.id,
        avaliacao_id=avaliacao.id if avaliacao else None,
    )
    db.add(tpl)
    db.flush()  # garante tpl.id

    img_path = _template_dir(tpl.id) / "original.png"
    cv2.imwrite(str(img_path), image)
    tpl.image_path = str(img_path)
    db.commit()
    db.refresh(tpl)
    return _detail(tpl)


@router.get("/api/custom-templates")
def list_templates(current_user: User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    stmt = select(CustomTemplate).order_by(CustomTemplate.updated_at.desc())
    rows = db.execute(stmt).scalars().all()
    rows = [t for t in rows if t.owner_id is None or t.owner_id == current_user.id or current_user.role == "admin"]
    return {"templates": [_summary(t) for t in rows]}


@router.get("/api/custom-templates/{tid}")
def get_template(tid: int, current_user: User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    return _detail(_get_template(db, tid, current_user))


@router.put("/api/custom-templates/{tid}")
def update_template(
    tid: int,
    patch: TemplatePatch,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    tpl = _get_template(db, tid, current_user)
    if patch.nome is not None:
        tpl.nome = patch.nome.strip()[:200] or tpl.nome
    if patch.config is not None:
        cfg = normalize_config(patch.config)
        # Preserva as dimensões reais da imagem importada
        cfg["page_w"] = tpl.image_w
        cfg["page_h"] = tpl.image_h
        tpl.config = cfg
        issues = validate_config(cfg)
        tpl.last_issues = issues
        if not has_errors(issues) and tpl.status == CustomTemplate.STATUS_VALIDADO:
            pass  # mantém validado
        elif has_errors(issues) and tpl.status == CustomTemplate.STATUS_VALIDADO:
            tpl.status = CustomTemplate.STATUS_RASCUNHO
    db.commit()
    db.refresh(tpl)
    return _detail(tpl)


@router.post("/api/custom-templates/{tid}/image")
def replace_image(
    tid: int,
    file: UploadFile = File(...),
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    tpl = _get_template(db, tid, current_user)
    contents = file.file.read()
    image = _decode_image_bytes(contents)
    if image is None:
        raise HTTPException(status_code=400, detail="Não foi possível decodificar a imagem.")
    h, w = image.shape[:2]
    img_path = _template_dir(tpl.id) / "original.png"
    cv2.imwrite(str(img_path), image)
    tpl.image_path = str(img_path)
    tpl.image_w = w
    tpl.image_h = h
    cfg = normalize_config(tpl.config or {})
    cfg["page_w"] = w
    cfg["page_h"] = h
    tpl.config = cfg
    db.commit()
    db.refresh(tpl)
    return _detail(tpl)


@router.delete("/api/custom-templates/{tid}")
def delete_template(tid: int, current_user: User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    tpl = _get_template(db, tid, current_user)
    db.delete(tpl)
    db.commit()
    return {"deleted": tid}


# ---------------------------------------------------------------------------
# Imagem / prévia
# ---------------------------------------------------------------------------

@router.get("/api/custom-templates/{tid}/image")
def template_image(tid: int, current_user: User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    tpl = _get_template(db, tid, current_user)
    p = Path(tpl.image_path)
    if not p.exists():
        raise HTTPException(status_code=404, detail="Imagem original não encontrada")
    return FileResponse(str(p), media_type="image/png")


@router.get("/api/custom-templates/{tid}/preview")
def template_preview(
    tid: int,
    draw: bool = True,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    """PNG da imagem original; com `draw=1`, sobrepõe as regiões configuradas."""
    tpl = _get_template(db, tid, current_user)
    image = _load_image(tpl)
    if image is None:
        raise HTTPException(status_code=404, detail="Imagem original não encontrada")
    if draw:
        image = render_preview_overlay(tpl.config or {}, image)
    ok, buf = cv2.imencode(".png", image)
    if not ok:
        raise HTTPException(status_code=500, detail="Falha ao gerar a prévia")
    return StreamingResponse(io.BytesIO(buf.tobytes()), media_type="image/png")


# ---------------------------------------------------------------------------
# Validação
# ---------------------------------------------------------------------------

@router.post("/api/custom-templates/{tid}/validate")
def validate_template(tid: int, current_user: User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    tpl = _get_template(db, tid, current_user)
    issues = validate_config(tpl.config or {})
    tpl.last_issues = issues
    if not has_errors(issues) and tpl.status == CustomTemplate.STATUS_RASCUNHO:
        tpl.status = CustomTemplate.STATUS_VALIDADO
    db.commit()
    return {
        "ok": not has_errors(issues),
        "issues": issues,
        "status": tpl.status,
        "summary": config_summary(tpl.config or {}),
    }


# ---------------------------------------------------------------------------
# Teste com foto real (seção 9/10)
# ---------------------------------------------------------------------------

@router.post("/api/custom-templates/{tid}/test")
def test_template(
    tid: int,
    file: UploadFile = File(...),
    ground_truth: str | None = Form(None),
    adaptive: bool = Form(False),
    debug: bool = Form(True),
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    """Lê uma foto real com este modelo e compara com o gabarito informado."""
    tpl = _get_template(db, tid, current_user)
    contents = file.file.read()
    image = _decode_image_bytes(contents)
    if image is None:
        raise HTTPException(status_code=400, detail="Não foi possível decodificar a foto.")

    diag: dict = {}
    result = process_custom_image(image, tpl.config or {}, adaptive=adaptive, debug=debug,
                                  diagnostics=diag)
    if result is None:
        detail = diag.get("detail") or ""
        return {
            "success": False,
            "error": ("Não foi possível alinhar/ler o cartão. Verifique as âncoras, "
                      "a nitidez da foto e se o cartão ocupa o quadro."),
            "failure": {"reason": diag.get("reason"), "detail": detail},
            "alignment": diag.get("alignment"),
        }

    truth: dict[str, str] = {}
    if ground_truth:
        try:
            raw = json.loads(ground_truth)
            if isinstance(raw, dict):
                truth = {str(k): str(v).strip().upper() for k, v in raw.items()}
        except (ValueError, TypeError):
            truth = {}

    mismatches: list[dict] = []
    blanks_truth: list[str] = []
    correct = 0
    evaluated = 0
    for q, expected in truth.items():
        evaluated += 1
        got = result.answers.get(int(q)) if str(q).isdigit() else None
        if got is None and (str(q).isdigit() and int(q) in result.blank_questions):
            blanks_truth.append(q)
            continue
        if got == expected:
            correct += 1
        else:
            mismatches.append({"question": q, "expected": expected, "got": got})

    return {
        "success": True,
        "answers": {str(k): v for k, v in result.answers.items()},
        "blank_questions": result.blank_questions,
        "duplicate_questions": result.duplicate_questions,
        "duplicate_marks": {str(k): v for k, v in (result.duplicate_marks or {}).items()},
        "low_confidence": result.low_confidence,
        "darkest_marks": result.darkest_marks or [],
        "fallback_marks": result.fallback_marks or [],
        "multi_marks": {str(k): v for k, v in (result.multi_marks or {}).items()},
        "all_ratios": {str(k): v for k, v in result.all_ratios.items()},
        "qr_id": result.qr_id,
        "alignment": result.alignment,
        "floor_used": round(result.floor_used, 3),
        "floor_source": result.floor_source,
        "timings_ms": {
            "detect": round(result.t_detect * 1000),
            "warp": round(result.t_warp * 1000),
            "qr": round(result.t_qr * 1000),
            "score": round(result.t_score * 1000),
            "total": round((result.t_detect + result.t_warp + result.t_qr + result.t_score) * 1000),
        },
        "rectified_image": _data_url_jpeg(result.rectified),
        "overlay_image": _debug_overlay(result, debug),
        "comparison": {
            "evaluated": evaluated,
            "correct": correct,
            "accuracy": round(correct / evaluated, 4) if evaluated else None,
            "mismatches": mismatches,
            "blank_expected": blanks_truth,
            "false_positives": [m for m in mismatches if m.get("got")],
        },
    }


def _debug_overlay(result, want: bool) -> str | None:
    if not want or result.rectified is None or not result.debug_points:
        return None
    try:
        from omr.debug import render_heatmap
        return render_heatmap(result.rectified, result.debug_points)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Ativação + versionamento (seção 8/9)
# ---------------------------------------------------------------------------

@router.post("/api/custom-templates/{tid}/activate")
def activate_template(tid: int, current_user: User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    tpl = _get_template(db, tid, current_user)
    issues = validate_config(tpl.config or {})
    tpl.last_issues = issues
    if has_errors(issues):
        db.commit()
        return JSONResponse(
            status_code=400,
            content={"ok": False, "detail": "Corrija os erros antes de ativar.", "issues": issues},
        )

    tpl.version = int(db.scalar(
        select(func.max(CustomTemplateVersion.version)).where(
            CustomTemplateVersion.template_id == tpl.id
        )
    ) or 0) + 1
    version = CustomTemplateVersion(
        template_id=tpl.id,
        version=tpl.version,
        config=normalize_config(tpl.config or {}),
    )
    db.add(version)
    tpl.status = CustomTemplate.STATUS_ATIVO
    if tpl.avaliacao_id:
        av = db.get(Avaliacao, tpl.avaliacao_id)
        if av is not None:
            av.template = "custom"
            av.custom_template_id = tpl.id
    db.commit()
    db.refresh(version)
    return {"ok": True, "status": tpl.status, "version_id": version.id, "version": version.version}


@router.get("/api/custom-templates/{tid}/versions")
def list_versions(tid: int, current_user: User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    _get_template(db, tid, current_user)
    rows = db.execute(
        select(CustomTemplateVersion).where(CustomTemplateVersion.template_id == tid)
        .order_by(CustomTemplateVersion.version.desc())
    ).scalars().all()
    return {"versions": [
        {"id": v.id, "version": v.version,
         "created_at": v.created_at.isoformat() if v.created_at else None,
         "summary": config_summary(v.config or {})}
        for v in rows
    ]}


# ---------------------------------------------------------------------------
# Impressão (seção 7)
# ---------------------------------------------------------------------------

def _render_pages(tpl: CustomTemplate, req: PrintRequest, db: Session,
                  persist: bool = True, max_pages: int | None = None
                  ) -> list[tuple[str, str, np.ndarray]]:
    """Devolve [(titulo, codigo, imagem_bgr)] — uma página por cartão.

    `persist=False` é usado pela PRÉVIA: não cria/atualiza `GabaritoNomeado`
    (códigos temporários para quem ainda não tem gabarito). `max_pages` limita
    a renderização (a contagem total é feita à parte em `_print_count`).
    """
    base = _load_image(tpl)
    if base is None:
        raise HTTPException(status_code=404, detail="Imagem original não encontrada")

    if req.mode == "blank":
        return [("Cartão em branco", "", base)]

    if req.mode == "avaliacao":
        if not tpl.avaliacao_id:
            raise HTTPException(status_code=400, detail="Modelo sem avaliação vinculada")
        alunos = db.execute(
            select(Aluno).where(Aluno.avaliacao_id == tpl.avaliacao_id).order_by(Aluno.nome)
        ).scalars().all()
        if not alunos:
            raise HTTPException(status_code=400, detail="Nenhum aluno importado nesta avaliação")
        if max_pages is not None:
            alunos = alunos[:max_pages]
        pages = []
        av = db.get(Avaliacao, tpl.avaliacao_id)
        for aluno in alunos:
            gab = db.scalar(
                select(GabaritoNomeado).where(
                    GabaritoNomeado.aluno_id == aluno.id,
                    GabaritoNomeado.avaliacao_id == tpl.avaliacao_id,
                )
            )
            if gab is not None:
                codigo = gab.codigo_unico
            elif persist:
                gab = GabaritoNomeado(
                    avaliacao_id=tpl.avaliacao_id,
                    aluno_id=aluno.id,
                    codigo_unico=_next_codigo(db),
                    qr_code_payload="",
                    custom_template_version_id=None,
                )
                gab.qr_code_payload = gab.codigo_unico
                db.add(gab)
                db.flush()
                codigo = gab.codigo_unico
            else:  # prévia: código temporário, nada é gravado
                codigo = f"TMP-{uuid.uuid4().hex[:8].upper()}"
            fields = {
                "student_name": aluno.nome,
                "matricula": aluno.matricula or "",
                "turma": (av.turma if av else "") or "",
                "exam_title": (av.titulo if av else "") or "",
            }
            img = render_overlay(tpl.config or {}, base, fields=fields, qr_payload=codigo)
            pages.append((aluno.nome, codigo, img))
        if persist:
            db.commit()
        return pages

    # mode == students (lista enviada pelo cliente)
    students = [s for s in (req.students or []) if s.nome.strip()]
    if not students:
        raise HTTPException(status_code=400, detail="Lista de alunos vazia")
    if max_pages is not None:
        students = students[:max_pages]
    pages = []
    for s in students:
        codigo = (s.codigo or "").strip() or f"TMP-{uuid.uuid4().hex[:8].upper()}"
        fields = {
            "student_name": s.nome.strip(),
            "matricula": s.matricula or "",
            "code": codigo,
        }
        img = render_overlay(tpl.config or {}, base, fields=fields, qr_payload=codigo)
        pages.append((s.nome.strip(), codigo, img))
    return pages


def _print_count(tpl: CustomTemplate, req: PrintRequest, db: Session) -> int:
    """Nº de cartões que `req` geraria (sem renderizar)."""
    if req.mode == "blank":
        return 1
    if req.mode == "avaliacao":
        if not tpl.avaliacao_id:
            raise HTTPException(status_code=400, detail="Modelo sem avaliação vinculada")
        n = db.scalar(
            select(func.count()).select_from(Aluno).where(Aluno.avaliacao_id == tpl.avaliacao_id)
        ) or 0
        if not n:
            raise HTTPException(status_code=400, detail="Nenhum aluno importado nesta avaliação")
        return int(n)
    n = len([s for s in (req.students or []) if s.nome.strip()])
    if not n:
        raise HTTPException(status_code=400, detail="Lista de alunos vazia")
    return n


def _fit_page_rect(img_w: int, img_h: int, page_w: float, page_h: float) -> tuple[float, float, float, float]:
    """Retângulo `(x, y, w, h)` para desenhar a imagem SEM distorção, centrada.

    O cartão personalizado pode ter proporção diferente de A4; esticá-lo para a
    página inteira deformaria a geometria impressa (e a leitura). Aqui ele é
    escalado uniformemente para caber e centralizado na página.
    """
    if img_w <= 0 or img_h <= 0 or page_w <= 0 or page_h <= 0:
        return 0.0, 0.0, page_w, page_h
    scale = min(page_w / img_w, page_h / img_h)
    w = img_w * scale
    h = img_h * scale
    return (page_w - w) / 2.0, (page_h - h) / 2.0, w, h


@router.post("/api/custom-templates/{tid}/print")
def print_template(
    tid: int,
    req: PrintRequest,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    """Gera PNG (1 cartão) ou PDF (1 por cartão) preservando a geometria."""
    tpl = _get_template(db, tid, current_user)
    pages = _render_pages(tpl, req, db)
    fmt = (req.format or "PDF").upper()
    safe = "".join(c for c in tpl.nome if c.isascii() and (c.isalnum() or c in "-_")) or "gabarito"

    if fmt == "PNG":
        _, _, img = pages[0]
        ok, buf = cv2.imencode(".png", img)
        return StreamingResponse(io.BytesIO(buf.tobytes()), media_type="image/png",
                                 headers={"Content-Disposition": f'attachment; filename="{safe}.png"'})

    from reportlab.lib.pagesizes import A4
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas as pdf_canvas

    out = io.BytesIO()
    c = pdf_canvas.Canvas(out, pagesize=A4)
    w_pt, h_pt = A4
    for _title, _code, img in pages:
        ok, jbuf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
        if not ok:
            continue
        ih, iw = img.shape[:2]
        x, y, dw, dh = _fit_page_rect(iw, ih, w_pt, h_pt)
        c.drawImage(ImageReader(io.BytesIO(jbuf.tobytes())), x, y, width=dw, height=dh)
        c.showPage()
    c.save()
    out.seek(0)
    return StreamingResponse(out, media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{safe}.pdf"'})


@router.post("/api/custom-templates/{tid}/print-preview")
def print_preview(
    tid: int,
    req: PrintRequest,
    limit: int = 6,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    """Prévia dos cartões que seriam impressos (NÃO grava nada).

    Devolve a contagem total e miniaturas (JPEG) das primeiras `limit` páginas
    para o usuário conferir antes de gerar o lote.
    """
    tpl = _get_template(db, tid, current_user)
    try:
        total = _print_count(tpl, req, db)
        pages = _render_pages(tpl, req, db, persist=False, max_pages=max(1, min(limit, 24)))
    except HTTPException as e:
        return {"ok": False, "error": str(e.detail), "count": 0, "shown": 0,
                "mode": req.mode, "pages": []}

    shown = [
        {"title": title, "code": code, "image": _data_url_jpeg(img, max_side=520)}
        for title, code, img in pages
    ]
    return {"ok": True, "error": None, "count": total, "shown": len(shown),
            "mode": req.mode, "pages": shown}


# ---------------------------------------------------------------------------
# Expansão de bolhas (para o editor exibir a numeração)
# ---------------------------------------------------------------------------

@router.get("/api/custom-templates/{tid}/bubbles")
def template_bubbles(tid: int, current_user: User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    tpl = _get_template(db, tid, current_user)
    return {"bubbles": expand_bubbles(tpl.config or {}), "summary": config_summary(tpl.config or {})}


# ---------------------------------------------------------------------------
# Auto-detecção da grade (sugestão para o editor — NÃO persiste)
# ---------------------------------------------------------------------------

@router.post("/api/custom-templates/{tid}/detect-grid")
def detect_grid_endpoint(
    tid: int,
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    """Analisa a imagem importada e propõe bloco(s) de bolhas (o usuário ajusta)."""
    tpl = _get_template(db, tid, current_user)
    image = _load_image(tpl)
    if image is None:
        raise HTTPException(status_code=404, detail="Imagem original não encontrada")
    return detect_grid(image, tpl.config or {})


# ---------------------------------------------------------------------------
# Benchmark / golden (seção 10) — registra respostas esperadas e compara
# ---------------------------------------------------------------------------

class GoldenSample(BaseModel):
    ground_truth: dict[str, str]


@router.post("/api/custom-templates/{tid}/benchmark")
def benchmark(
    tid: int,
    file: UploadFile = File(...),
    ground_truth: str = Form(...),
    current_user: User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    """Compara respostas detectadas × esperadas e devolve as métricas de erro.

    É a mesma leitura do `/test`, com foco no banco de testes (falsos
    positivos/negativos, brancos, múltiplas, confiança por questão).
    """
    return test_template(tid, file=file, ground_truth=ground_truth, adaptive=False,
                         debug=True, current_user=current_user, db=db)
