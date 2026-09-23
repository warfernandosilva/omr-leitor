"""
Servidor FastAPI para OMR.

Endpoints:
- POST /api/omr/process — recebe imagem, retorna respostas + card_id (QR)
- POST /api/omr/grade — corrige respostas contra gabarito
- POST /api/card/generate — gera cartão PNG/PDF em branco
- GET  /api/health, /api/template/coords

Persistência (banco SQLite):
- POST /api/exams/sync — sincroniza a prova do frontend como Avaliação
- POST /api/exams/{external_id}/students/import — importa e persiste alunos
- POST /api/exams/{external_id}/gabaritos/generate — cria GabaritosNomeados
- POST /api/exams/{external_id}/gabaritos/pdf — PDF oficial a partir do banco
- GET  /api/exams/{external_id}/gabaritos — lista para gerenciamento
- GET  /api/gabaritos/{codigo}/lookup — resolve QR → gabarito → aluno
- POST /api/gabaritos/{codigo}/resultado — persiste resultado da correção
"""

from __future__ import annotations

import io
from datetime import datetime

import cv2
import numpy as np
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session
from collections import deque
from datetime import datetime, timezone
import logging
import json as _json

from database import DB_LABEL, get_db, init_db
from models import Aluno, Avaliacao, GabaritoNomeado, User
import auth

logger = logging.getLogger("omr")

# ─── Observabilidade: buffer circular das últimas correções (sem PII, sem DB) ───
OPS_BUFFER: deque = deque(maxlen=200)


def _ops_record(rec: dict) -> None:
    OPS_BUFFER.append(rec)
    try:
        logger.info("OMR %s", _json.dumps(rec, ensure_ascii=False))
    except Exception:
        pass

from omr.template import (
    generate_card, generate_card_png,
    generate_card_bytes, build_batch_pdf, TEMPLATE_COORDS,
)
from omr.template_sae import (
    SaeSpec, generate_sae_card_bytes, build_sae_batch_pdf, SAE_COORDS,
    generate_colar_card_bytes, COLAR_COORDS,
)
from omr.template_saev import (
    SaevSpec, generate_saev_card_bytes, build_saev_batch_pdf, SAEV_COORDS,
    SAEV_MIN_QPS, SAEV_MAX_QPS,
)
from omr.reader import process_image, OMRResult
from omr.reader_sae import process_sae_image
from omr.reader_saev import process_saev_image
from omr.config import MARGIN
from omr.grading import grade, GradingResult

app = FastAPI(title="OMR Backend", version="2.0.0")

import os as _os_cors
_CORS_ORIGINS = [o.strip() for o in _os_cors.environ.get("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173").split(",") if o.strip()]
# libera acesso via IP da rede local (celular) + Capacitor (capacitor://localhost)
_CORS_REGEX = _os_cors.environ.get("CORS_ORIGIN_REGEX", r"(https?://(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.1[6-9]\.\d+\.\d+|172\.2\d\.\d+\.\d+|172\.3[0-1]\.\d+\.\d+)(:\d+)?|capacitor://.*|http://localhost(:\d+)?)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_origin_regex=_CORS_REGEX if _CORS_REGEX else None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()


class ProcessResponse(BaseModel):
    success: bool
    answers: dict[int, str] | None = None
    blank_questions: list[int] | None = None
    duplicate_questions: list[int] | None = None
    duplicate_marks: dict[int, list[str]] | None = None
    low_confidence: list[int] | None = None
    all_ratios: dict[int, dict[str, float]] | None = None
    card_id: str | None = None
    rectified_image: str | None = None  # base64 dataURL da imagem retificada (para overlay perfeito)
    template_used: str | None = None  # "padrao" | "sae" — modelo detectado (fallback cruzado)
    thresholds_used: dict | None = None  # {floor, margin, source: fixed|adaptive}
    warnings: list[str] | None = None  # sanity pós-leitura (não bloqueia)
    n_frames: int | None = None  # frames usados na votação (process-multi)
    debug_images: dict | None = None  # heatmap de diagnóstico (só com debug=true)
    error: str | None = None


class GradeRequest(BaseModel):
    answers: dict[int, str]
    answer_key: dict[int, str]
    grade_scale: str = "0-10"
    questions_per_subject: int = 22
    layout_mode: str = "dual"


class GradeResponse(BaseModel):
    portugues: dict
    matematica: dict
    total_correct: int
    total_incorrect: int
    total_blank: int
    total_duplicate: int
    total_questions: int


class SaeSpecRequest(BaseModel):
    """Todos os campos editáveis do cartão SAE (defaults = imagem de referência)."""
    ano: str = "2026"
    programa_linha1: str = "AVALIAÇÃO CONTÍNUA DA APRENDIZAGEM"
    programa_linha2: str = "NOS ANOS FINAIS - CICLO II"
    titulo: list[str] = ["AVALIAÇÃO CONTÍNUA", "DA APRENDIZAGEM", "NOS ANOS FINAIS", "CICLO II"]
    caderno: str = "M0901"
    disciplina: str = "MATEMÁTICA"
    serie: str = "9º ano do Ensino Fundamental"
    qr_payload: str = "2269M0901"
    n_questoes: int = 26
    codigo_barras: str = "6357256532"

    def to_spec(self) -> SaeSpec:
        return SaeSpec(
            ano=self.ano, programa_linha1=self.programa_linha1,
            programa_linha2=self.programa_linha2, titulo=list(self.titulo or []),
            caderno=self.caderno, disciplina=self.disciplina, serie=self.serie,
            qr_payload=self.qr_payload, n_questoes=self.n_questoes,
            codigo_barras=self.codigo_barras,
        )


class CardRequest(BaseModel):
    subject_lp: str = "LÍNGUA PORTUGUESA"
    subject_mat: str = "MATEMÁTICA"
    format: str = "PNG"  # PNG ou PDF
    questions_per_subject: int = 22
    layout_mode: str = "dual"  # dual | single
    template: str = "padrao"  # padrao | sae | colar | saev
    sae: SaeSpecRequest | None = None


class BatchStudent(BaseModel):
    id: str
    name: str


class BatchCardRequest(BaseModel):
    students: list[BatchStudent]
    subject_lp: str = "PORTUGUÊS"
    subject_mat: str = "MATEMÁTICA"


# ─── Persistência ───

class ExamSyncRequest(BaseModel):
    external_id: str
    titulo: str
    turma: str | None = None
    subject_lp: str = "PORTUGUÊS"
    subject_mat: str = "MATEMÁTICA"
    questions_per_subject: int = 22
    layout_mode: str = "dual"  # dual | single
    template: str = "padrao"  # padrao | sae | colar | saev
    sae: SaeSpecRequest | None = None  # cabeçalho editável (só SAE)
    grade_scale: str | None = None
    answer_key: dict | None = None


class ImportAluno(BaseModel):
    nome: str
    matricula: str | None = None
    identificador_externo: str | None = None


class ImportStudentsRequest(BaseModel):
    alunos: list[ImportAluno]


class ResultadoRequest(BaseModel):
    respostas: dict[str, str] | None = None
    acertos: int | None = None
    erros: int | None = None
    brancos: int | None = None
    nota: float | None = None
    observacoes: str | None = None


def _next_codigo(db: Session) -> str:
    """Gera o próximo codigo_unico sequencial do ano (OMR-AAAA-NNNNNN)."""
    year = datetime.now().year
    prefix = f"OMR-{year}-"
    # Postgres não permite FOR UPDATE com max() — usa SELECT simples + retry em IntegrityError no insert
    try:
        last = db.scalar(
            select(func.max(GabaritoNomeado.codigo_unico)).where(
                GabaritoNomeado.codigo_unico.like(prefix + "%")
            )
        )
    except Exception:
        db.rollback()
        last = db.scalar(
            select(func.max(GabaritoNomeado.codigo_unico)).where(
                GabaritoNomeado.codigo_unico.like(prefix + "%")
            )
        )
    seq = int(last[len(prefix):]) + 1 if last else 1
    return f"{prefix}{seq:06d}"


@app.get("/api/health")
def health():
    return {"status": "ok", "version": "2.0.0", "db": DB_LABEL}


@app.get("/api/ops/stats")
def ops_stats(current_user: User = Depends(auth.get_current_user)):
    """Métricas das últimas correções (buffer em memória, sem PII).

    Detecta drift operacional: ex. "turma com 40% low" = problema de
    impressão/luz, não do algoritmo.
    """
    recs = list(OPS_BUFFER)
    n = len(recs)
    out: dict = {"n_calls": n}
    if n:
        ok_calls = [r for r in recs if r.get("success")]
        out["success_rate"] = round(len(ok_calls) / n, 3)
        by_model: dict[str, dict] = {}
        for r in ok_calls:
            m = by_model.setdefault(r.get("model") or "?", {
                "n": 0, "dup": 0, "low": 0, "answers": 0,
                "t_total_ms": 0, "t_detect_ms": 0, "adaptive": 0,
            })
            m["n"] += 1
            m["dup"] += r.get("dup", 0)
            m["low"] += r.get("low", 0)
            m["answers"] += r.get("answers", 0)
            m["t_total_ms"] += r.get("t_total_ms", 0)
            m["t_detect_ms"] += r.get("t_detect_ms", 0)
            m["adaptive"] += 1 if r.get("floor_source") == "adaptive" else 0
        for m in by_model.values():
            if m["n"]:
                m["t_total_ms_avg"] = round(m.pop("t_total_ms") / m["n"])
                m["t_detect_ms_avg"] = round(m.pop("t_detect_ms") / m["n"])
                m["dup_rate"] = round(m["dup"] / max(1, m["answers"]), 3)
                m["low_rate"] = round(m["low"] / max(1, m["answers"]), 3)
        out["by_model"] = by_model
        out["rejected"] = sum(1 for r in recs if r.get("rejected"))
        out["last"] = recs[-1]
    return out


@app.get("/api/template/coords")
def template_coords():
    return TEMPLATE_COORDS


@app.get("/api/template/sae-coords")
def template_sae_coords():
    return SAE_COORDS


@app.get("/api/template/colar-coords")
def template_colar_coords():
    return COLAR_COORDS


@app.get("/api/template/saev-coords")
def template_saev_coords():
    return SAEV_COORDS


# ─── Auth ───

class RegisterRequest(BaseModel):
    email: str
    nome: str
    password: str
    role: str = "professor"


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


@app.post("/api/auth/register", response_model=TokenResponse)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    # Primeiro usuário vira admin automaticamente
    existing = db.scalar(select(User).where(User.email == req.email.strip().lower()))
    if existing:
        raise HTTPException(status_code=400, detail="E-mail já cadastrado")
    role = req.role if req.role in ("admin", "professor") else "professor"
    # Se é o primeiro usuário do sistema, força admin
    total = db.scalar(select(func.count()).select_from(User)) or 0
    if total == 0:
        role = "admin"
    user = User(
        email=req.email.strip().lower(),
        nome=req.nome.strip(),
        hashed_password=auth.hash_password(req.password),
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = auth.create_access_token(data={"sub": user.email})
    return TokenResponse(access_token=token, user={"id": user.id, "email": user.email, "nome": user.nome, "role": user.role})


@app.post("/api/auth/login", response_model=TokenResponse)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    # OAuth2 form usa 'username' para o e-mail
    user = db.scalar(select(User).where(User.email == form_data.username.strip().lower()))
    if not user or not auth.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="E-mail ou senha incorretos")
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Usuário inativo")
    token = auth.create_access_token(data={"sub": user.email})
    return TokenResponse(access_token=token, user={"id": user.id, "email": user.email, "nome": user.nome, "role": user.role})


@app.get("/api/auth/me")
def me(current_user: User = Depends(auth.get_current_user)):
    return {"id": current_user.id, "email": current_user.email, "nome": current_user.nome, "role": current_user.role}


def _require_admin(current_user: User = Depends(auth.get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores")
    return current_user


@app.get("/api/admin/users")
def admin_list_users(admin: User = Depends(_require_admin), db: Session = Depends(get_db)):
    users = db.scalars(select(User).order_by(User.created_at)).all()
    # conta avaliações por dono para o painel
    counts = dict(db.execute(select(Avaliacao.owner_id, func.count()).group_by(Avaliacao.owner_id)).all())
    return [
        {
            "id": u.id,
            "email": u.email,
            "nome": u.nome,
            "role": u.role,
            "is_active": u.is_active,
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "avaliacoes": counts.get(u.id, 0),
        }
        for u in users
    ]


class AdminUpdateUserRequest(BaseModel):
    role: str | None = None
    is_active: bool | None = None
    password: str | None = None


@app.patch("/api/admin/users/{user_id}")
def admin_update_user(user_id: int, req: AdminUpdateUserRequest, admin: User = Depends(_require_admin), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if user.id == admin.id and req.is_active is False:
        raise HTTPException(status_code=400, detail="Não é possível desativar a própria conta")
    if req.role is not None:
        if req.role not in ("admin", "professor"):
            raise HTTPException(status_code=400, detail="role deve ser 'admin' ou 'professor'")
        # impede remover o último admin
        if user.role == "admin" and req.role != "admin":
            admin_count = db.scalar(select(func.count()).select_from(User).where(User.role == "admin")) or 0
            if admin_count <= 1:
                raise HTTPException(status_code=400, detail="Deve haver ao menos um administrador")
        user.role = req.role
    if req.is_active is not None:
        user.is_active = req.is_active
    if req.password is not None:
        if len(req.password.strip()) < 4:
            raise HTTPException(status_code=400, detail="Senha deve ter ao menos 4 caracteres")
        user.hashed_password = auth.hash_password(req.password.strip())
    db.commit()
    db.refresh(user)
    return {"id": user.id, "email": user.email, "nome": user.nome, "role": user.role, "is_active": user.is_active}


@app.delete("/api/admin/users/{user_id}")
def admin_delete_user(user_id: int, admin: User = Depends(_require_admin), db: Session = Depends(get_db)):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Não é possível excluir a própria conta")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    # avaliações do usuário viram órfãs (visíveis para todos) em vez de apagar dados de provas
    db.execute(select(Avaliacao).where(Avaliacao.owner_id == user_id))
    for av in db.scalars(select(Avaliacao).where(Avaliacao.owner_id == user_id)).all():
        av.owner_id = None
    db.delete(user)
    db.commit()
    return {"deleted": True, "id": user_id}


def _decode_image_bytes(contents: bytes) -> np.ndarray | None:
    """Decodifica bytes de imagem com correção de orientação EXIF (celular)
    + fallback HEIC/WEBP via Pillow. Usado por /api/omr/process e process-multi."""
    try:
        nparr = np.frombuffer(contents, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        # Se falhou e Pillow disponível, tenta com EXIF transpose (iPhone HEIC/WEBP rotacionado)
        if image is None:
            raise ValueError("cv2 imdecode falhou")
        # Corrige rotação EXIF se Pillow detectar
        try:
            from PIL import Image, ImageOps
            import io as _io
            pil = Image.open(_io.BytesIO(contents))
            pil = ImageOps.exif_transpose(pil)
            if pil is not None and pil.size != (image.shape[1], image.shape[0]):
                # EXIF indicou rotação — reconverte
                pil = pil.convert("RGB")
                image = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
        except Exception:
            pass
        return image
    except (cv2.error, ValueError):
        # fallback Pillow puro
        try:
            from PIL import Image, ImageOps
            import io as _io
            pil = Image.open(_io.BytesIO(contents))
            pil = ImageOps.exif_transpose(pil).convert("RGB")
            return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
        except Exception:
            return None


def _debug_images(result: OMRResult, want: bool) -> dict | None:
    """Heatmap de diagnóstico (só quando debug=true)."""
    if not want or result.rectified is None or not result.debug_points:
        return None
    try:
        from omr.debug import render_heatmap
        heat = render_heatmap(result.rectified, result.debug_points)
        return {"heatmap": heat} if heat else None
    except Exception:
        return None


@app.post("/api/omr/process", response_model=ProcessResponse)
async def process_omr(
    file: UploadFile = File(...),
    questions_per_subject: int = Form(22),
    layout_mode: str = Form("dual"),
    template: str = Form("padrao"),  # padrao | sae | colar (colar: mesma grade do sae, sem QR)
    adaptive: bool = Form(False),  # limiar adaptativo por foto (experimental, default OFF)
    debug: bool = Form(False),  # heatmap de diagnóstico (default off = zero custo)
    current_user: User = Depends(auth.get_current_user),
):
    """Processa uma imagem (foto/scan) do cartão preenchido."""
    contents = await file.read()

    # Validação defensiva
    if not contents or len(contents) < 100:
        return ProcessResponse(success=False, error="Imagem vazia recebida. Aguarde a câmera inicializar e capture novamente.")
    if len(contents) > 10 * 1024 * 1024:
        return ProcessResponse(success=False, error="Imagem muito grande (limite 10MB).")
    ctype = (file.content_type or "").lower()
    if ctype and ctype not in ("image/jpeg", "image/png", "image/webp", "image/jpg"):
        return ProcessResponse(success=False, error=f"Formato não suportado: {ctype}. Use JPG ou PNG.")

    # Correção de orientação EXIF (celular) + fallback HEIC/WEBP via Pillow
    image = _decode_image_bytes(contents)

    if image is None:
        return ProcessResponse(success=False, error="Não foi possível decodificar a imagem")

    result: OMRResult | None
    template_used = template if template in ("padrao", "sae", "colar", "saev") else "padrao"
    if template_used in ("sae", "colar"):
        result = process_sae_image(image, n_questions=questions_per_subject, adaptive=adaptive, debug=debug)
    elif template_used == "saev":
        result = process_saev_image(image, questions_per_subject=questions_per_subject, adaptive=adaptive, debug=debug)
    else:
        result = process_image(
            image,
            questions_per_subject=questions_per_subject,
            layout_mode=layout_mode,
            adaptive=adaptive,
            debug=debug,
        )

    # Fallback cruzado: clientes antigos (app de captura no celular, Flutter)
    # não enviam `template` — se o modelo pedido falhar, tenta os outros antes
    # de desistir. A resposta indica qual foi usado (template_used).
    # (colar tem a mesma geometria do sae: o fallback "sae" o cobre.)
    if result is None and template_used == "padrao":
        sae_result = process_sae_image(image, n_questions=questions_per_subject, adaptive=adaptive, debug=debug)
        if sae_result is not None:
            result = sae_result
            template_used = "sae"
        else:
            saev_result = process_saev_image(image, questions_per_subject=questions_per_subject, adaptive=adaptive, debug=debug)
            if saev_result is not None:
                result = saev_result
                template_used = "saev"
    elif template_used in ("sae", "colar", "saev"):
        std_result = process_image(
            image,
            questions_per_subject=questions_per_subject,
            layout_mode=layout_mode,
            adaptive=adaptive,
            debug=debug,
        )
        if std_result is not None:
            result = std_result
            template_used = "padrao"

    if result is None:
        if template_used in ("sae", "colar"):
            try:
                from omr.detector_sae import detect_sae_corners as _dm_sae
                det = _dm_sae(image)
                if not det.found:
                    return ProcessResponse(success=False, error=f"Quadrados dos cantos não encontrados (faltam: {', '.join(det.missing)}). Garanta que os 4 quadrados pretos estão visíveis, foto nítida e sem sombra.")
                return ProcessResponse(success=False, error="Falha ao retificar a imagem SAE (foto muito borrada ou escura). Tente com melhor iluminação.")
            except Exception:
                return ProcessResponse(success=False, error="Âncoras SAE não detectadas ou geometria inválida")
        if template_used == "saev":
            try:
                from omr.detector_saev import detect_saev_corners as _dm_saev
                det = _dm_saev(image)
                if not det.found:
                    return ProcessResponse(success=False, error=f"Quadrados SAEV não encontrados (faltam: {', '.join(det.missing)}). Garanta que os 4 quadrados pretos (2 na altura dos títulos, 2 no rodapé) estão visíveis, foto nítida e sem sombra.")
                return ProcessResponse(success=False, error="Falha ao retificar a imagem SAEV (foto muito borrada ou escura). Tente com melhor iluminação.")
            except Exception:
                return ProcessResponse(success=False, error="Âncoras SAEV não detectadas ou geometria inválida")
        # diagnóstico fino para UX (padrão falhou E fallbacks falharam)
        try:
            from omr.detector import detect_markers as _dm, validate_geometry as _vg
            from omr.detector_sae import detect_sae_corners as _dm_sae
            from omr.detector_saev import detect_saev_corners as _dm_saev
            det = _dm(image)
            sae_det = _dm_sae(image)
            saev_det = _dm_saev(image)
            if det.missing_ids and not sae_det.found and not saev_det.found:
                return ProcessResponse(success=False, error=f"Nenhum cartão detectado: faltam ArUco {det.missing_ids}, quadrados SAE ({', '.join(sae_det.missing)}) e quadrados SAEV ({', '.join(saev_det.missing)}). Garanta que os 4 cantos estão visíveis, foto nítida e sem sombra.")
            if not _vg(det.markers):
                return ProcessResponse(success=False, error="Geometria dos marcadores inválida — foto torta ou cartão dobrado. Tente de cima, com o cartão plano.")
            # marcadores ok mas falha no warp/QR — ainda processa? aqui é caso de blur extremo
            return ProcessResponse(success=False, error="Falha ao retificar a imagem (foto muito borrada ou escura). Tente com melhor iluminação.")
        except Exception:
            return ProcessResponse(success=False, error="Marcadores não detectados ou geometria inválida")

    # gera dataURL da retificada para overlay perfeito (círculos alinham 1:1 com template 1448x2048)
    rectified_b64 = None
    try:
        if result.rectified is not None:
            import base64
            _, buf = cv2.imencode('.jpg', result.rectified, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
            b64 = base64.b64encode(buf.tobytes()).decode('ascii')
            rectified_b64 = f"data:image/jpeg;base64,{b64}"
    except Exception:
        rectified_b64 = None

    # Sanity pós-leitura: duplicadas fantasmas (modelo/versão errado) bloqueiam;
    # brancas/baixa confiança viram warnings (cartão em branco é legítimo).
    from omr.sanity import sanity_check
    total_lido = len(result.blank_questions) + len(result.duplicate_questions) + len(result.answers)
    sanity = sanity_check(
        result.duplicate_questions,
        result.blank_questions,
        result.low_confidence,
        total_lido,
    )
    if not sanity.ok:
        _ops_record({
            "ts": datetime.now(timezone.utc).isoformat(),
            "model": template_used,
            "success": False,
            "rejected": "sanity",
            "answers": len(result.answers),
            "blank": len(result.blank_questions),
            "dup": len(result.duplicate_questions),
            "low": len(result.low_confidence),
            "t_detect_ms": round(result.t_detect * 1000),
            "t_total_ms": round((result.t_detect + result.t_warp + result.t_qr + result.t_score) * 1000),
            "floor": round(result.floor_used, 3),
            "floor_source": result.floor_source,
        })
        return ProcessResponse(
            success=False,
            error=sanity.message,
            warnings=sanity.warnings or None,
            rectified_image=rectified_b64,
            template_used=template_used,
            thresholds_used={
                "floor": round(result.floor_used, 3),
                "margin": MARGIN,
                "source": result.floor_source,
            },
        )

    _ops_record({
        "ts": datetime.now(timezone.utc).isoformat(),
        "model": template_used,
        "success": True,
        "answers": len(result.answers),
        "blank": len(result.blank_questions),
        "dup": len(result.duplicate_questions),
        "low": len(result.low_confidence),
        "t_detect_ms": round(result.t_detect * 1000),
        "t_total_ms": round((result.t_detect + result.t_warp + result.t_qr + result.t_score) * 1000),
        "floor": round(result.floor_used, 3),
        "floor_source": result.floor_source,
    })

    return ProcessResponse(
        success=True,
        answers={str(k): v for k, v in result.answers.items()},
        blank_questions=result.blank_questions,
        duplicate_questions=result.duplicate_questions,
        duplicate_marks={
            str(q): marks for q, marks in (result.duplicate_marks or {}).items()
        },
        low_confidence=result.low_confidence,
        all_ratios={str(k): v for k, v in result.all_ratios.items()},
        card_id=result.qr_id,
        rectified_image=rectified_b64,
        template_used=template_used,
        thresholds_used={
            "floor": round(result.floor_used, 3),
            "margin": MARGIN,
            "source": result.floor_source,
        },
        warnings=sanity.warnings or None,
        debug_images=_debug_images(result, debug),
    )


@app.post("/api/omr/process-multi", response_model=ProcessResponse)
async def process_omr_multi(
    files: list[UploadFile] = File(...),
    questions_per_subject: int = Form(22),
    layout_mode: str = Form("dual"),
    template: str = Form("padrao"),
    adaptive: bool = Form(False),
    debug: bool = Form(False),
    current_user: User = Depends(auth.get_current_user),
):
    """Processa N frames do mesmo cartão e vota por questão.

    Divergência entre frames vira low_confidence (conferência manual) —
    foto tremida/luz variando lê diferente por frame. 1 frame válido se
    comporta exatamente como /api/omr/process.
    """
    if not files or len(files) > 4:
        return ProcessResponse(success=False, error="Envie de 1 a 4 frames do mesmo cartão.")

    results: list[OMRResult] = []
    template_used = template if template in ("padrao", "sae", "colar", "saev") else "padrao"
    first_image: np.ndarray | None = None

    for f in files:
        contents = await f.read()
        if not contents or len(contents) < 100 or len(contents) > 10 * 1024 * 1024:
            continue
        image = _decode_image_bytes(contents)
        if image is None:
            continue
        if first_image is None:
            first_image = image
        if template_used in ("sae", "colar"):
            r = process_sae_image(image, n_questions=questions_per_subject, adaptive=adaptive, debug=debug)
        elif template_used == "saev":
            r = process_saev_image(image, questions_per_subject=questions_per_subject, adaptive=adaptive, debug=debug)
        else:
            r = process_image(image, questions_per_subject=questions_per_subject,
                              layout_mode=layout_mode, adaptive=adaptive, debug=debug)
        if r is not None:
            results.append(r)

    if not results:
        # mesmos diagnósticos do endpoint single (usa a 1ª imagem decodificada)
        if first_image is None:
            return ProcessResponse(success=False, error="Nenhum frame decodificável. Capture novamente.")
        try:
            from omr.detector import detect_markers as _dm, validate_geometry as _vg
            det = _dm(first_image)
            if det.missing_ids:
                return ProcessResponse(success=False, error=f"Cartão não detectado nos frames (faltam ArUco {det.missing_ids}). Garanta que os 4 cantos estão visíveis, foto nítida e sem sombra.")
            if not _vg(det.markers):
                return ProcessResponse(success=False, error="Geometria dos marcadores inválida — foto torta ou cartão dobrado. Tente de cima, com o cartão plano.")
            return ProcessResponse(success=False, error="Falha ao retificar (foto muito borrada ou escura). Tente com melhor iluminação.")
        except Exception:
            return ProcessResponse(success=False, error="Marcadores não detectados ou geometria inválida")

    from omr.vote import vote_frames
    result = vote_frames(results)
    if result is None:  # inalcançável (results não-vazio), defesa
        return ProcessResponse(success=False, error="Falha na votação dos frames")

    rectified_b64 = None
    try:
        if result.rectified is not None:
            import base64
            _, buf = cv2.imencode('.jpg', result.rectified, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
            b64 = base64.b64encode(buf.tobytes()).decode('ascii')
            rectified_b64 = f"data:image/jpeg;base64,{b64}"
    except Exception:
        rectified_b64 = None

    from omr.sanity import sanity_check
    total_lido = len(result.blank_questions) + len(result.duplicate_questions) + len(result.answers)
    sanity = sanity_check(result.duplicate_questions, result.blank_questions,
                          result.low_confidence, total_lido)
    if not sanity.ok:
        _ops_record({
            "ts": datetime.now(timezone.utc).isoformat(),
            "model": template_used, "success": False, "rejected": "sanity",
            "frames": len(results),
            "answers": len(result.answers), "blank": len(result.blank_questions),
            "dup": len(result.duplicate_questions), "low": len(result.low_confidence),
            "t_total_ms": round((result.t_detect + result.t_warp + result.t_qr + result.t_score) * 1000),
            "floor": round(result.floor_used, 3), "floor_source": result.floor_source,
        })
        return ProcessResponse(
            success=False, error=sanity.message, warnings=sanity.warnings or None,
            rectified_image=rectified_b64, template_used=template_used,
            n_frames=len(results),
            thresholds_used={"floor": round(result.floor_used, 3), "margin": MARGIN,
                             "source": result.floor_source},
        )

    _ops_record({
        "ts": datetime.now(timezone.utc).isoformat(),
        "model": template_used, "success": True, "frames": len(results),
        "answers": len(result.answers), "blank": len(result.blank_questions),
        "dup": len(result.duplicate_questions), "low": len(result.low_confidence),
        "t_total_ms": round((result.t_detect + result.t_warp + result.t_qr + result.t_score) * 1000),
        "floor": round(result.floor_used, 3), "floor_source": result.floor_source,
    })

    return ProcessResponse(
        success=True,
        answers={str(k): v for k, v in result.answers.items()},
        blank_questions=result.blank_questions,
        duplicate_questions=result.duplicate_questions,
        duplicate_marks={str(q): marks for q, marks in (result.duplicate_marks or {}).items()},
        low_confidence=result.low_confidence,
        all_ratios={str(k): v for k, v in result.all_ratios.items()},
        card_id=result.qr_id,
        rectified_image=rectified_b64,
        template_used=template_used,
        n_frames=len(results),
        thresholds_used={"floor": round(result.floor_used, 3), "margin": MARGIN,
                         "source": result.floor_source},
        warnings=sanity.warnings or None,
        debug_images=_debug_images(result, debug),
    )


@app.post("/api/omr/grade", response_model=GradeResponse)
def grade_omr(req: GradeRequest, current_user: User = Depends(auth.get_current_user)):
    """Corrige respostas OMR contra gabarito."""
    from omr.reader import OMRResult as OMRResultClass
    from omr.template import QUESTIONS_PER_SUBJECT

    # Reconstruir OMRResult a partir das respostas
    omr = OMRResultClass(
        answers={int(k): v for k, v in req.answers.items()},
        blank_questions=[],
        duplicate_questions=[],
        low_confidence=[],
        all_ratios={},
    )

    result = grade(omr, {int(k): v for k, v in req.answer_key.items()}, req.grade_scale,
                   questions_per_subject=req.questions_per_subject,
                   layout_mode=req.layout_mode)

    return GradeResponse(
        portugues={
            "correct": result.portugues.correct,
            "incorrect": result.portugues.incorrect,
            "blank": result.portugues.blank,
            "duplicate": result.portugues.duplicate,
            "total": result.portugues.total,
            "grade": result.portugues.grade,
        },
        matematica={
            "correct": result.matematica.correct,
            "incorrect": result.matematica.incorrect,
            "blank": result.matematica.blank,
            "duplicate": result.matematica.duplicate,
            "total": result.matematica.total,
            "grade": result.matematica.grade,
        },
        total_correct=result.total_correct,
        total_incorrect=result.total_incorrect,
        total_blank=result.total_blank,
        total_duplicate=result.total_duplicate,
        total_questions=result.total_questions,
    )


@app.post("/api/card/generate")
def generate_card_endpoint(req: CardRequest, current_user: User = Depends(auth.get_current_user)):
    """Gera cartão-resposta EM BRANCO como imagem — mesmo desenho dos oficiais."""
    fmt = req.format.upper()

    if req.template == "colar":
        # "Colar em Avaliação": só âncoras + grade, sem cabeçalho/QR
        from omr.template_sae import SAE_MAX_QUESTIONS
        n = max(1, min(SAE_MAX_QUESTIONS, int(req.questions_per_subject or 26)))
        if fmt == "PDF":
            data = generate_colar_card_bytes("PDF", n)
            media, fname = "application/pdf", "colar-avaliacao.pdf"
        else:
            data = generate_colar_card_bytes("PNG", n)
            media, fname = "image/png", "colar-avaliacao.png"
        return StreamingResponse(
            io.BytesIO(data),
            media_type=media,
            headers={"Content-Disposition": f'attachment; filename="{fname}"'},
        )

    if req.template == "sae":
        spec = (req.sae or SaeSpecRequest()).to_spec()
        if fmt == "PDF":
            data = generate_sae_card_bytes("PDF", spec)
            media, fname = "application/pdf", "cartao-sae.pdf"
        else:
            data = generate_sae_card_bytes("PNG", spec)
            media, fname = "image/png", "cartao-sae.png"
        return StreamingResponse(
            io.BytesIO(data),
            media_type=media,
            headers={"Content-Disposition": f'attachment; filename="{fname}"'},
        )

    if req.template == "saev":
        qps = max(SAEV_MIN_QPS, min(SAEV_MAX_QPS, int(req.questions_per_subject or 22)))
        spec = SaevSpec(n_questoes=qps)
        if fmt == "PDF":
            data = generate_saev_card_bytes("PDF", spec)
            media, fname = "application/pdf", "cartao-saev.pdf"
        else:
            data = generate_saev_card_bytes("PNG", spec)
            media, fname = "image/png", "cartao-saev.png"
        return StreamingResponse(
            io.BytesIO(data),
            media_type=media,
            headers={"Content-Disposition": f'attachment; filename="{fname}"'},
        )

    kw = dict(
        questions_per_subject=req.questions_per_subject,
        layout_mode=req.layout_mode,
    )
    fmt = req.format.upper()

    if fmt == "PDF":
        data = generate_card_bytes("PDF", subject_lp=req.subject_lp, subject_mat=req.subject_mat, **kw)
        media, fname = "application/pdf", "cartao-resposta.pdf"
    else:
        data = generate_card_bytes("PNG", subject_lp=req.subject_lp, subject_mat=req.subject_mat, **kw)
        media, fname = "image/png", "cartao-resposta.png"

    return StreamingResponse(
        io.BytesIO(data),
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@app.post("/api/cards/generate-batch")
def generate_cards_batch(req: BatchCardRequest, current_user: User = Depends(auth.get_current_user)):
    """DEPRECIADO: use o fluxo persistido (exams/sync + students/import +
    gabaritos/generate). Mantido apenas para compatibilidade de testes antigos."""
    students = [s for s in req.students if s.name.strip()]

    if not students:
        raise HTTPException(status_code=400, detail="Lista de alunos vazia")

    ids = [s.id for s in students]
    if len(set(ids)) != len(ids):
        raise HTTPException(status_code=400, detail="IDs duplicados na lista")

    out_buf = io.BytesIO()
    pages_drawn = build_batch_pdf(
        [
            {"codigo_unico": s.id, "nome": s.name.strip(), "matricula": None}
            for s in students
        ],
        req.subject_lp, req.subject_mat, out_buf,
    )

    # ─── Regra fundamental: nada é disponibilizado se os valores divergirem ───
    if not (len(students) == len(set(ids)) == pages_drawn):
        raise HTTPException(
            status_code=500,
            detail=(
                f"Validação falhou: {len(students)} nomes, "
                f"{len(set(ids))} IDs únicos, {pages_drawn} páginas."
            ),
        )

    out_buf.seek(0)
    return StreamingResponse(
        out_buf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'attachment; filename="gabaritos_personalizados.pdf"',
            "X-Generated-Pages": str(pages_drawn),
        },
    )


# ════════════════════════════════════════════════════════════════════════
# Persistência: Avaliação → Alunos → GabaritosNomeados → PDF → Resultado
# ════════════════════════════════════════════════════════════════════════


def _get_avaliacao(db: Session, external_id: str) -> Avaliacao:
    av = db.scalar(select(Avaliacao).where(Avaliacao.external_id == external_id))
    if av is None:
        raise HTTPException(status_code=404, detail="Avaliação não encontrada no banco")
    return av


@app.post("/api/exams/sync")
def sync_exam(req: ExamSyncRequest, db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user)):
    """Cria ou atualiza a Avaliação correspondente à prova do frontend."""
    av = db.scalar(select(Avaliacao).where(Avaliacao.external_id == req.external_id))
    if av is None:
        av = Avaliacao(external_id=req.external_id, titulo=req.titulo, owner_id=current_user.id)
        db.add(av)
    else:
        if av.owner_id is not None:
            auth.require_owner_or_admin(av, current_user)
        elif av.owner_id is None:
            av.owner_id = current_user.id
        av.titulo = req.titulo
    av.turma = req.turma
    av.subject_lp = req.subject_lp
    av.subject_mat = req.subject_mat
    av.questions_per_subject = max(1, int(req.questions_per_subject))
    if req.layout_mode not in ("dual", "single"):
        raise HTTPException(status_code=400, detail="layout_mode deve ser 'dual' ou 'single'")
    av.layout_mode = req.layout_mode
    if req.template not in ("padrao", "sae", "colar", "saev"):
        raise HTTPException(status_code=400, detail="template deve ser 'padrao', 'sae', 'colar' ou 'saev'")
    av.template = req.template
    if req.sae is not None:
        spec = req.sae.to_spec()
        av.sae_spec = {
            "ano": spec.ano, "programa_linha1": spec.programa_linha1,
            "programa_linha2": spec.programa_linha2, "titulo": spec.titulo,
            "caderno": spec.caderno, "disciplina": spec.disciplina,
            "serie": spec.serie, "qr_payload": spec.qr_payload,
            "codigo_barras": spec.codigo_barras,
        }
    elif req.template != "sae":
        av.sae_spec = None
    if req.grade_scale is not None:
        av.grade_scale = req.grade_scale
    if req.answer_key is not None:
        # normaliza chaves para string (JSON)
        av.answer_key = {str(k): v for k, v in req.answer_key.items()} if req.answer_key else None
    db.commit()
    db.refresh(av)
    return {
        "avaliacao_id": av.id,
        "external_id": av.external_id,
        "titulo": av.titulo,
        "turma": av.turma,
        "questions_per_subject": av.questions_per_subject,
        "layout_mode": av.layout_mode,
        "template": av.template,
        "sae_spec": av.sae_spec,
        "grade_scale": av.grade_scale,
        "answer_key": av.answer_key,
    }


@app.post("/api/exams/{external_id}/students/import")
def import_students(external_id: str, req: ImportStudentsRequest, db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user)):
    """
    Importa alunos do arquivo XLSX/CSV (já parseado pelo frontend) e persiste.

    - Cada linha válida vira um registro Aluno permanente.
    - Nomes duplicados NÃO são unidos: cada um recebe aluno_id próprio.
    - Retorna os IDs internos persistentes gerados pelo banco.
    """
    av = _get_avaliacao(db, external_id)
    auth.require_owner_or_admin(av, current_user)

    alunos_payload = [a for a in req.alunos if a.nome and a.nome.strip()]
    if not alunos_payload:
        raise HTTPException(status_code=400, detail="Nenhum aluno válido para importar")

    criados: list[dict] = []
    for item in alunos_payload:
        nome = item.nome.strip()
        aluno = Aluno(
            avaliacao_id=av.id,
            nome=nome,
            matricula=(item.matricula or "").strip() or None,
            identificador_externo=item.identificador_externo,
        )
        db.add(aluno)
        db.flush()
        criados.append({
            "id": aluno.id,
            "nome": aluno.nome,
            "matricula": aluno.matricula,
        })

    db.commit()
    return {
        "avaliacao_id": av.id,
        "external_id": av.external_id,
        "total_importados": len(criados),
        "alunos": criados,
    }


@app.post("/api/exams/{external_id}/gabaritos/generate")
def generate_gabaritos(external_id: str, db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user)):
    """
    Cria os GabaritosNomeados persistentes para todos os alunos da avaliação.

    Idempotente: aluno com gabarito existente mantém o mesmo codigo_unico.
    Valida antes de retornar: todos os alunos possuem gabarito + código único.
    """
    av = _get_avaliacao(db, external_id)
    auth.require_owner_or_admin(av, current_user)
    alunos = db.scalars(
        select(Aluno).where(Aluno.avaliacao_id == av.id).order_by(Aluno.id)
    ).all()

    if not alunos:
        raise HTTPException(status_code=400, detail="Avaliação sem alunos importados")

    existentes = {
        g.aluno_id: g
        for g in db.scalars(select(GabaritoNomeado).where(GabaritoNomeado.avaliacao_id == av.id)).all()
    }

    novos = 0
    for idx, aluno in enumerate(alunos, start=1):
        g = existentes.get(aluno.id)
        if g is None:
            codigo = _next_codigo(db)
            g = GabaritoNomeado(
                avaliacao_id=av.id,
                aluno_id=aluno.id,
                codigo_unico=codigo,
                qr_code_payload=codigo,
                numero_pagina=idx,
            )
            db.add(g)
            db.flush()
            novos += 1
        g.numero_pagina = idx

    db.commit()

    # ─── Validação obrigatória (§10) ───
    gabaritos = db.scalars(
        select(GabaritoNomeado).where(GabaritoNomeado.avaliacao_id == av.id).order_by(GabaritoNomeado.numero_pagina)
    ).all()
    codigos = {g.codigo_unico for g in gabaritos}
    if not (len(gabaritos) == len(alunos) == len(codigos)):
        raise HTTPException(
            status_code=500,
            detail=(
                f"Validação falhou: {len(alunos)} alunos, {len(gabaritos)} gabaritos, "
                f"{len(codigos)} códigos únicos."
            ),
        )

    return {
        "avaliacao_id": av.id,
        "total_alunos": len(alunos),
        "total_gabaritos": len(gabaritos),
        "novos_gabaritos": novos,
        "gabaritos": [g.to_dict() for g in gabaritos],
    }


@app.post("/api/exams/{external_id}/gabaritos/pdf")
def generate_gabaritos_pdf(external_id: str, db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user)):
    """
    Gera o PDF oficial a partir dos registros PERSISTIDOS no banco (§11).
    Nunca a partir de listas temporárias do frontend.
    """
    av = _get_avaliacao(db, external_id)
    auth.require_owner_or_admin(av, current_user)
    if (av.template or "padrao") == "colar":
        raise HTTPException(
            status_code=400,
            detail="Modelo 'Colar em Avaliação' é avulso (sem QR/nome): gere o cartão em branco em Gerar Cartão em vez do lote por alunos.",
        )
    gabaritos = db.scalars(
        select(GabaritoNomeado)
        .where(GabaritoNomeado.avaliacao_id == av.id)
        .order_by(GabaritoNomeado.numero_pagina)
    ).all()
    alunos_count = db.scalar(
        select(func.count()).select_from(Aluno).where(Aluno.avaliacao_id == av.id)
    )
    codigos = {g.codigo_unico for g in gabaritos}

    # ─── §10: alunos persistidos = gabaritos = códigos únicos ───
    if not alunos_count or not gabaritos or alunos_count != len(gabaritos) or len(codigos) != len(gabaritos):
        raise HTTPException(
            status_code=500,
            detail=(
                f"Validação falhou antes do PDF: {alunos_count} alunos, "
                f"{len(gabaritos)} gabaritos, {len(codigos)} códigos únicos. "
                "Gere os gabaritos primeiro."
            ),
        )

    registros = [
        {"codigo_unico": g.codigo_unico, "nome": g.aluno.nome, "matricula": g.aluno.matricula}
        for g in gabaritos
    ]

    out_buf = io.BytesIO()
    if (av.template or "padrao") == "sae":
        # Cartão Avaliação Contínua com o cabeçalho editado no frontend
        stored = dict(av.sae_spec or {})
        spec = SaeSpec(
            ano=stored.get("ano", "2026"),
            programa_linha1=stored.get("programa_linha1", "AVALIAÇÃO CONTÍNUA DA APRENDIZAGEM"),
            programa_linha2=stored.get("programa_linha2", "NOS ANOS FINAIS - CICLO II"),
            titulo=stored.get("titulo") or ["AVALIAÇÃO CONTÍNUA", "DA APRENDIZAGEM", "NOS ANOS FINAIS", "CICLO II"],
            caderno=stored.get("caderno", "M0901"),
            disciplina=stored.get("disciplina") or av.subject_lp,
            serie=stored.get("serie", "9º ano do Ensino Fundamental"),
            qr_payload=stored.get("qr_payload", "2269M0901"),
            n_questoes=av.questions_per_subject,
            codigo_barras=stored.get("codigo_barras", "6357256532"),
        )
        pages_drawn = build_sae_batch_pdf(registros, spec, out_buf)
    elif (av.template or "padrao") == "saev":
        # Gabarito SAEV: grade 16+16 a 26+26, QR do sistema + Nome impresso
        spec = SaevSpec(n_questoes=max(SAEV_MIN_QPS, min(SAEV_MAX_QPS, int(av.questions_per_subject or 22))))
        pages_drawn = build_saev_batch_pdf(registros, spec, out_buf)
    else:
        pages_drawn = build_batch_pdf(
            registros, av.subject_lp, av.subject_mat, out_buf,
            questions_per_subject=av.questions_per_subject,
            layout_mode=av.layout_mode,
        )

    if pages_drawn != len(registros):
        raise HTTPException(
            status_code=500,
            detail=f"Validação falhou: {pages_drawn} páginas para {len(registros)} registros.",
        )

    out_buf.seek(0)
    return StreamingResponse(
        out_buf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'attachment; filename="gabaritos_personalizados.pdf"',
            "X-Generated-Pages": str(pages_drawn),
        },
    )


@app.get("/api/exams/{external_id}/gabaritos")
def list_gabaritos(external_id: str, db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user)):
    """Tela de gerenciamento: alunos + gabaritos + status (§21)."""
    av = _get_avaliacao(db, external_id)
    auth.require_owner_or_admin(av, current_user)
    gabaritos = db.scalars(
        select(GabaritoNomeado)
        .where(GabaritoNomeado.avaliacao_id == av.id)
        .order_by(GabaritoNomeado.numero_pagina)
    ).all()
    alunos_sem_gabarito = db.scalar(
        select(func.count())
        .select_from(Aluno)
        .outerjoin(GabaritoNomeado, GabaritoNomeado.aluno_id == Aluno.id)
        .where(Aluno.avaliacao_id == av.id, GabaritoNomeado.id.is_(None))
    ) or 0

    lidos = sum(1 for g in gabaritos if g.status in (GabaritoNomeado.STATUS_LIDO, GabaritoNomeado.STATUS_CORRIGIDO))
    corrigidos = sum(1 for g in gabaritos if g.status == GabaritoNomeado.STATUS_CORRIGIDO)

    return {
        "avaliacao": {
            "id": av.id,
            "external_id": av.external_id,
            "titulo": av.titulo,
            "turma": av.turma,
            "layout_mode": av.layout_mode,
        },
        "stats": {
            "alunos_cadastrados": len(gabaritos) + alunos_sem_gabarito,
            "gabaritos_gerados": len(gabaritos),
            "gabaritos_lidos": lidos,
            "gabaritos_corrigidos": corrigidos,
            "pendentes": len(gabaritos) - corrigidos,
        },
        "gabaritos": [g.to_dict() for g in gabaritos],
    }


@app.get("/api/exams")
def list_exams(limit: int = 100, offset: int = 0, db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user)):
    """Lista avaliações do usuário (admin vê todas) — paginado."""
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    q = select(Avaliacao).order_by(Avaliacao.created_at.desc()).limit(limit).offset(offset)
    if current_user.role != "admin":
        q = q.where((Avaliacao.owner_id == current_user.id) | (Avaliacao.owner_id.is_(None)))
    avaliacoes = db.scalars(q).all()
    return [
        {
            "id": av.id,
            "external_id": av.external_id,
            "titulo": av.titulo,
            "turma": av.turma,
            "subject_lp": av.subject_lp,
            "subject_mat": av.subject_mat,
            "questions_per_subject": av.questions_per_subject,
            "layout_mode": av.layout_mode,
            "template": av.template or "padrao",
            "sae_spec": av.sae_spec,
            "grade_scale": av.grade_scale,
            "answer_key": av.answer_key,
            "created_at": av.created_at.isoformat() if av.created_at else None,
        }
        for av in avaliacoes
    ]


@app.get("/api/exams/{external_id}")
def get_exam(external_id: str, db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user)):
    av = _get_avaliacao(db, external_id)
    auth.require_owner_or_admin(av, current_user)
    total_alunos = db.scalar(select(func.count()).select_from(Aluno).where(Aluno.avaliacao_id == av.id)) or 0
    return {
        "id": av.id,
        "external_id": av.external_id,
        "titulo": av.titulo,
        "turma": av.turma,
        "subject_lp": av.subject_lp,
        "subject_mat": av.subject_mat,
        "questions_per_subject": av.questions_per_subject,
        "layout_mode": av.layout_mode,
        "template": av.template or "padrao",
        "sae_spec": av.sae_spec,
        "grade_scale": av.grade_scale,
        "answer_key": av.answer_key,
        "total_alunos": total_alunos,
    }


@app.delete("/api/exams/{external_id}")
def delete_exam(external_id: str, db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user)):
    """Apaga a avaliação e tudo vinculado (alunos, gabaritos, resultados)."""
    av = db.scalar(select(Avaliacao).where(Avaliacao.external_id == external_id))
    if av is None:
        raise HTTPException(status_code=404, detail="Avaliação não encontrada")
    auth.require_owner_or_admin(av, current_user)
    # cascade via FK + manual para garantir
    db.execute(delete(GabaritoNomeado).where(GabaritoNomeado.avaliacao_id == av.id))
    db.execute(delete(Aluno).where(Aluno.avaliacao_id == av.id))
    db.delete(av)
    db.commit()
    return {"deleted": True, "external_id": external_id, "titulo": av.titulo}


class AnswerKeyRequest(BaseModel):
    answer_key: dict
    grade_scale: str | None = None


@app.put("/api/exams/{external_id}/answer-key")
def put_answer_key(external_id: str, req: AnswerKeyRequest, db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user)):
    av = _get_avaliacao(db, external_id)
    auth.require_owner_or_admin(av, current_user)
    av.answer_key = {str(k): v for k, v in req.answer_key.items()}
    if req.grade_scale is not None:
        av.grade_scale = req.grade_scale
    db.commit()
    db.refresh(av)
    return {"external_id": av.external_id, "answer_key": av.answer_key, "grade_scale": av.grade_scale}


@app.get("/api/resultados")
def list_resultados(limit: int = 100, offset: int = 0, db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user)):
    """Lista gabaritos corrigidos do usuário (admin vê todos) — paginado."""
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    q = select(GabaritoNomeado).where(GabaritoNomeado.status == GabaritoNomeado.STATUS_CORRIGIDO).order_by(GabaritoNomeado.data_correcao.desc()).limit(limit).offset(offset)
    if current_user.role != "admin":
        q = q.join(Avaliacao, GabaritoNomeado.avaliacao_id == Avaliacao.id).where(
            (Avaliacao.owner_id == current_user.id) | (Avaliacao.owner_id.is_(None))
        )
    gabaritos = db.scalars(q).all()
    return [
        {
            "codigo_unico": g.codigo_unico,
            "numero_pagina": g.numero_pagina,
            "status": g.status,
            "respostas": g.respostas,
            "acertos": g.acertos,
            "erros": g.erros,
            "brancos": g.brancos,
            "nota": g.nota,
            "observacoes": g.observacoes,
            "data_correcao": g.data_correcao.isoformat() if g.data_correcao else None,
            "aluno": {"id": g.aluno.id, "nome": g.aluno.nome, "matricula": g.aluno.matricula},
            "avaliacao": {
                "id": g.avaliacao.id,
                "external_id": g.avaliacao.external_id,
                "titulo": g.avaliacao.titulo,
                "questions_per_subject": g.avaliacao.questions_per_subject,
                "layout_mode": g.avaliacao.layout_mode,
                "grade_scale": g.avaliacao.grade_scale,
            },
        }
        for g in gabaritos
    ]


@app.delete("/api/gabaritos/{codigo}/resultado")
def delete_resultado(codigo: str, db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user)):
    """Apaga apenas o resultado da correção, mantendo aluno e gabarito (volta para 'gerado')."""
    g = db.scalar(select(GabaritoNomeado).where(GabaritoNomeado.codigo_unico == codigo.strip()))
    if g is None:
        raise HTTPException(status_code=404, detail="Gabarito não encontrado")
    auth.require_owner_or_admin(g.avaliacao, current_user)
    g.respostas = None
    g.acertos = None
    g.erros = None
    g.brancos = None
    g.nota = None
    g.observacoes = None
    g.status = GabaritoNomeado.STATUS_GERADO
    g.data_leitura = None
    g.data_correcao = None
    db.commit()
    return {"deleted": True, "codigo_unico": g.codigo_unico, "status": g.status}


class AvulsoResultadoRequest(BaseModel):
    nome: str
    matricula: str | None = None
    respostas: dict | None = None
    acertos: int | None = None
    erros: int | None = None
    brancos: int | None = None
    nota: float | None = None
    observacoes: str | None = None


@app.post("/api/exams/{external_id}/resultados/avulso")
def post_avulso(external_id: str, req: AvulsoResultadoRequest, db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user)):
    """
    Cria um aluno+gabarito avulso (sem importação prévia) e já salva o resultado.
    Usado pela correção manual quando o QR não foi identificado.
    """
    av = _get_avaliacao(db, external_id)
    auth.require_owner_or_admin(av, current_user)
    if not req.nome or not req.nome.strip():
        raise HTTPException(status_code=400, detail="Nome do aluno é obrigatório")
    from sqlalchemy.exc import IntegrityError
    for attempt in range(2):
        try:
            if attempt == 0:
                aluno = Aluno(avaliacao_id=av.id, nome=req.nome.strip(), matricula=(req.matricula or "").strip() or None)
                db.add(aluno)
                db.flush()
            codigo = _next_codigo(db)
            g = GabaritoNomeado(
                avaliacao_id=av.id,
                aluno_id=aluno.id,
                codigo_unico=codigo,
                qr_code_payload=codigo,
                numero_pagina=db.scalar(select(func.count()).select_from(GabaritoNomeado).where(GabaritoNomeado.avaliacao_id == av.id)) + 1,
                status=GabaritoNomeado.STATUS_CORRIGIDO,
                respostas=req.respostas,
                acertos=req.acertos,
                erros=req.erros,
                brancos=req.brancos,
                nota=req.nota,
                observacoes=req.observacoes,
                data_leitura=datetime.now(),
                data_correcao=datetime.now(),
            )
            db.add(g)
            db.commit()
            db.refresh(g)
            return {"created": True, "aluno": {"id": aluno.id, "nome": aluno.nome}, "gabarito": g.to_dict()}
        except IntegrityError:
            db.rollback()
            if attempt == 1:
                raise HTTPException(status_code=409, detail="Código duplicado — tente novamente")
            # re-busca aluno se rollback limpou
            aluno = db.scalar(select(Aluno).where(Aluno.id == aluno.id)) if 'aluno' in locals() and hasattr(aluno, 'id') else Aluno(avaliacao_id=av.id, nome=req.nome.strip(), matricula=(req.matricula or "").strip() or None)
            if aluno not in db:
                db.add(aluno)
                db.flush()


@app.delete("/api/exams/{external_id}/students")
def reset_exam_students(external_id: str, db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user)):
    """
    Reseta a avaliação: apaga TODOS os alunos e gabaritos (com resultados).
    A avaliação em si permanece cadastrada.
    Cartões impressos deixam de ser identificados pelo QR.
    """
    av = _get_avaliacao(db, external_id)
    auth.require_owner_or_admin(av, current_user)

    total_alunos = db.scalar(
        select(func.count()).select_from(Aluno).where(Aluno.avaliacao_id == av.id)
    ) or 0
    total_gabaritos = db.scalar(
        select(func.count()).select_from(GabaritoNomeado).where(GabaritoNomeado.avaliacao_id == av.id)
    ) or 0

    db.execute(delete(GabaritoNomeado).where(GabaritoNomeado.avaliacao_id == av.id))
    db.execute(delete(Aluno).where(Aluno.avaliacao_id == av.id))
    db.commit()

    return {
        "avaliacao_id": av.id,
        "deleted_alunos": total_alunos,
        "deleted_gabaritos": total_gabaritos,
    }


@app.delete("/api/alunos/{aluno_id}")
def delete_aluno(aluno_id: int, db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user)):
    """Apaga um aluno individualmente junto com seu gabarito/resultado."""
    aluno = db.get(Aluno, aluno_id)
    if aluno is None:
        raise HTTPException(status_code=404, detail="Aluno não encontrado")
    av = db.get(Avaliacao, aluno.avaliacao_id)
    if av:
        auth.require_owner_or_admin(av, current_user)

    nome = aluno.nome
    removidos = db.execute(
        delete(GabaritoNomeado).where(GabaritoNomeado.aluno_id == aluno_id)
    ).rowcount
    db.delete(aluno)
    db.commit()

    return {"deleted": True, "aluno_id": aluno_id, "nome": nome, "gabaritos_removidos": removidos}


@app.get("/api/gabaritos/{codigo}/lookup")
def lookup_codigo(codigo: str, db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user)):
    """
    Resolve QR Code → GabaritoNomeado → Aluno (§12-13).
    Nunca busca por nome: somente pelo codigo_unico.
    """
    g = db.scalar(
        select(GabaritoNomeado).where(GabaritoNomeado.codigo_unico == codigo.strip())
    )
    if g is None:
        return JSONResponse(status_code=404, content={"found": False, "reason": "not_found"})
    auth.require_owner_or_admin(g.avaliacao, current_user)

    return {
        "found": True,
        "codigo_unico": g.codigo_unico,
        "status": g.status,
        "numero_pagina": g.numero_pagina,
        "aluno": {"id": g.aluno.id, "nome": g.aluno.nome, "matricula": g.aluno.matricula},
        "avaliacao": {
            "id": g.avaliacao.id,
            "external_id": g.avaliacao.external_id,
            "titulo": g.avaliacao.titulo,
            "turma": g.avaliacao.turma,
            "layout_mode": g.avaliacao.layout_mode,
            "template": g.avaliacao.template or "padrao",
        },
    }


@app.post("/api/gabaritos/{codigo}/resultado")
def post_resultado(codigo: str, req: ResultadoRequest, overwrite: bool = False, db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user)):
    """
    Persiste o resultado da correção no GabaritoNomeado (§24).

    Se já existe resultado e overwrite=False → 409 (frontend pede confirmação).
    """
    g = db.scalar(select(GabaritoNomeado).where(GabaritoNomeado.codigo_unico == codigo.strip()))
    if g is None:
        return JSONResponse(status_code=404, content={"found": False, "reason": "not_found"})
    auth.require_owner_or_admin(g.avaliacao, current_user)

    agora = datetime.now()
    if g.status == GabaritoNomeado.STATUS_CORRIGIDO and not overwrite:
        return JSONResponse(
            status_code=409,
            content={
                "found": True,
                "already_graded": True,
                "detail": "Gabarito já possui resultado salvo",
                "previous": {
                    "nota": g.nota,
                    "acertos": g.acertos,
                    "data_correcao": g.data_correcao.isoformat() if g.data_correcao else None,
                    "aluno": {"id": g.aluno.id, "nome": g.aluno.nome},
                },
            },
        )

    g.respostas = req.respostas
    g.acertos = req.acertos
    g.erros = req.erros
    g.brancos = req.brancos
    g.nota = req.nota
    g.observacoes = req.observacoes
    g.status = GabaritoNomeado.STATUS_CORRIGIDO
    if g.data_leitura is None:
        g.data_leitura = agora
    g.data_correcao = agora
    db.commit()
    db.refresh(g)
    return {"found": True, "saved": True, "gabarito": g.to_dict()}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8010)

