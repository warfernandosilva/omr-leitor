"""
Gerador de cartão-resposta OMR — modelo "Gabarito Herby".

Canvas: 1448×2048 px (mesmo dos demais modelos).
Âncoras: 2 QR Codes (cabeçalho + rodapé) + bordas da página — SEM ArUco
(modelo espelhado na folha oficial Herby/SAEV 2026 - Av. Formativa 3).
Grade: 4 subcolunas × ceil(qps/2) linhas (LP 1..N / MAT 1..N),
quadrados A-D. Dual 1+1 a 26+26 por disciplina (faixa vertical fixa).
Identificação:
- QR cabeçalho (grande): magic link — por padrão o próprio codigo_unico;
  se HerbySpec.magic_base definido, `{base}?codigo={codigo}` (abrir resultado
  quando houver rota pública; hoje só armazenado);
- QR rodapé (menor): codigo_unico puro (chave oficial de lookup).

Geometria calibrada na folha real 2026_MAT__POR_5ano_1.jpg (4958×7016 @600dpi,
escala fx=1448/4958, fy=2048/7016 para o canvas).
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

from .template import PAGE_W, PAGE_H, load_font, _fit_text, make_qr_image


# ─── QRs (posições no canvas 1448×2048) ───
HERBY_QR_HEAD_SIZE = 243
HERBY_QR_HEAD_POS = (121, 76)      # canto superior esquerdo (magic link)
HERBY_QR_FOOT_SIZE = 142
HERBY_QR_FOOT_POS = (458, 1849)    # rodapé centro-esquerda (ID puro)

# ─── Cabeçalho ───
HERBY_RULER_Y = 337                # linha azul grossa (esp. ~7px)
HERBY_TITLE_Y = 500
HERBY_NOME_BOX = (440, 110, 1360, 200)

# ─── Grade de respostas (quadrados; calibrado na folha real) ───
HERBY_MIN_QPS = 1
HERBY_MAX_QPS = 26
HERBY_COLS_X = [193, 504, 815, 1127]  # origem de cada subcoluna
HERBY_NUM_W = 16
HERBY_PITCH = 40                       # passo entre alternativas
HERBY_SIDE = 28                        # lado externo do quadrado
HERBY_STROKE = 3
HERBY_Y0 = 650
HERBY_Y1 = 1785

HERBY_LETTERS = ["A", "B", "C", "D"]


def herby_rows_for(qps: int) -> int:
    """Linhas por subcoluna (2 subcolunas por disciplina)."""
    qps = max(1, min(HERBY_MAX_QPS, int(qps)))
    return (qps + 1) // 2


def herby_row_ys(qps: int) -> list[float]:
    """Ys das linhas, distribuídas na faixa fixa (cabe 1..13 linhas)."""
    rows = herby_rows_for(qps)
    if rows == 1:
        return [float(HERBY_Y0)]
    step = (HERBY_Y1 - HERBY_Y0) / (rows - 1)
    return [round(HERBY_Y0 + i * step, 1) for i in range(rows)]


def herby_block_rows(qps: int):
    """Itera (questao_global, coluna 0..3, linha) — LP=1..qps, MAT=qps+1..2*qps."""
    qps = max(1, min(HERBY_MAX_QPS, int(qps)))
    rows = herby_rows_for(qps)
    for col in range(4):
        base = 0 if col < 2 else qps          # LP | MAT
        off = 0 if col % 2 == 0 else rows     # 1ª | 2ª subcoluna
        for r in range(rows):
            q = base + off + r + 1
            if q > base + qps:
                continue
            yield q, col, r


def herby_bubble_center(col: int, row: int, alt: int, qps: int = 22) -> tuple[float, float]:
    """Centro do quadrado (coluna, linha, alternativa 0..3)."""
    ys = herby_row_ys(qps)
    x0 = HERBY_COLS_X[col]
    cx = x0 + HERBY_NUM_W + alt * HERBY_PITCH + HERBY_PITCH / 2
    return (cx, ys[row])


def herby_magic_link(codigo: str, magic_base: str = "") -> str:
    """Conteúdo do QR do cabeçalho: magic link ou o próprio código."""
    codigo = (codigo or "").strip()
    base = (magic_base or "").strip().rstrip("/")
    if base and codigo:
        return f"{base}?codigo={codigo}"
    return codigo


def normalize_herby_qr(data: str) -> str:
    """Normaliza QR lido (URL magic link ou ID puro) para o codigo_unico.

    'https://hby.app?i4=GEW6...' → 'GEW6...'; 'OMR-2026-000001' inalterado.
    """
    s = (data or "").strip()
    if "?" in s:
        s = s.split("?", 1)[1]
    if "=" in s:
        s = s.rsplit("=", 1)[1]
    return s.strip()


@dataclass
class HerbySpec:
    """Cabeçalho/editáveis do cartão Herby."""

    titulo_lp: str = "Língua Portuguesa"
    titulo_mat: str = "Matemática"
    frase: str = "Marque suas respostas. Boa prova!"
    evento: str = ""          # ex.: "2026 - Av. Formativa 3"
    serie: str = ""           # ex.: "5º ano"
    caderno: str = ""         # ex.: "2026_MAT__POR_5ano"
    n_questoes: int = 22      # por disciplina (1..26)
    turma: str = ""
    magic_base: str = ""      # base do magic link (vazio = QR cabeça = código)

    def clamped_qps(self) -> int:
        return max(HERBY_MIN_QPS, min(HERBY_MAX_QPS, int(self.n_questoes or 22)))


def _draw_herby_header(
    d: ImageDraw.ImageDraw,
    pil: Image.Image,
    spec: HerbySpec,
    name: str,
    qr_head: str,
    qr_foot: str,
) -> None:
    black = (0, 0, 0)
    blue = (30, 90, 180)
    gray_text = (90, 102, 102)

    # QR do cabeçalho (magic link) + QR do rodapé (ID)
    try:
        head_img = make_qr_image(qr_head or "HERBY", size=HERBY_QR_HEAD_SIZE)
        pil.paste(head_img, HERBY_QR_HEAD_POS)
    except (ImportError, ValueError):
        pass
    try:
        foot_img = make_qr_image(qr_foot or "HERBY", size=HERBY_QR_FOOT_SIZE)
        pil.paste(foot_img, HERBY_QR_FOOT_POS)
    except (ImportError, ValueError):
        pass

    # Nome impresso
    font_label = load_font(34)
    d.text((440, 70), "Nome do(a) aluno(a)", fill=black, font=font_label)
    x0, y0, x1, y1 = HERBY_NOME_BOX
    d.rectangle([x0, y0, x1, y1], outline=black, width=2)
    if name:
        fitted, fitted_font = _fit_text(d, name, x1 - x0 - 20, start_size=36)
        d.text((x0 + 12, y0 + 12), fitted, fill=black, font=fitted_font)

    # Linha azul + frase + evento/série
    d.rectangle([121, HERBY_RULER_Y, 1327, HERBY_RULER_Y + 7], fill=blue)
    font_phrase = load_font(30)
    head_line = " / ".join(p for p in (spec.evento, spec.serie) if p) or spec.frase
    bbox = d.textbbox((0, 0), head_line, font=font_phrase)
    d.text(((PAGE_W - (bbox[2] - bbox[0])) // 2, 380), head_line, fill=black, font=font_phrase)
    if head_line != spec.frase and spec.frase:
        bbox2 = d.textbbox((0, 0), spec.frase, font=font_phrase)
        d.text(((PAGE_W - (bbox2[2] - bbox2[0])) // 2, 420), spec.frase, fill=gray_text, font=font_phrase)


def generate_herby_card(
    spec: HerbySpec | None = None,
    student_name: str | None = None,
    qr_override: str | None = None,
    header: bool = True,
) -> np.ndarray:
    spec = spec or HerbySpec()
    qps = spec.clamped_qps()
    name = (student_name or "").strip()
    codigo = (qr_override or "").strip() or "HERBY"
    qr_head = herby_magic_link(codigo, spec.magic_base)

    img = np.ones((PAGE_H, PAGE_W, 3), dtype=np.uint8) * 255
    pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    d = ImageDraw.Draw(pil)

    black = (0, 0, 0)
    gray_text = (90, 102, 102)

    if header:
        _draw_herby_header(d, pil, spec, name, qr_head, codigo)

    # ─── Títulos das disciplinas ───
    font_title = load_font(40)
    for text, cx in ((spec.titulo_lp, 480), (spec.titulo_mat, 1030)):
        bbox = d.textbbox((0, 0), text, font=font_title)
        d.text((cx - (bbox[2] - bbox[0]) // 2, HERBY_TITLE_Y), text, fill=black, font=font_title)

    # ─── Grade ───
    font_head = load_font(22)
    font_num = load_font(26)
    ys = herby_row_ys(qps)
    for q, col, r in herby_block_rows(qps):
        y = ys[r]
        x0 = HERBY_COLS_X[col]
        # rótulo: LP "(n)" | MAT "n.)"
        num = f"({q})" if col < 2 else f"{q - qps}.)"
        bbox = d.textbbox((0, 0), num, font=font_num)
        d.text((x0 + HERBY_NUM_W - (bbox[2] - bbox[0]) - 6, y - 20), num, fill=black, font=font_num)
        for i, letter in enumerate(HERBY_LETTERS):
            cx = x0 + HERBY_NUM_W + i * HERBY_PITCH + HERBY_PITCH / 2
            # letra acima
            bbox = d.textbbox((0, 0), letter, font=font_head)
            d.text((cx - (bbox[2] - bbox[0]) / 2, y - HERBY_SIDE / 2 - 30),
                   letter, fill=gray_text, font=font_head)
            # quadrado vazado
            h = HERBY_SIDE / 2
            d.rectangle([cx - h, y - h, cx + h, y + h], outline=black, width=HERBY_STROKE)

    return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)


def generate_herby_card_png(output_path: str | Path, spec: HerbySpec | None = None, **kw) -> Path:
    img = generate_herby_card(spec, **kw)
    p = Path(output_path); p.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(p), img); return p


def generate_herby_card_bytes(fmt: str = "PNG", spec: HerbySpec | None = None, **kw) -> bytes:
    img = generate_herby_card(spec, **kw)
    pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    buf = io.BytesIO(); pil.save(buf, format=fmt); return buf.getvalue()


def build_herby_batch_pdf(
    students: list[dict],
    spec: HerbySpec,
    out_buf: io.BytesIO,
) -> int:
    """1 página por aluno (nome impresso + QRs do código do aluno)."""
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas as pdf_canvas
    from reportlab.lib.utils import ImageReader

    pages_drawn = 0
    c = pdf_canvas.Canvas(out_buf, pagesize=A4)
    w_pt, h_pt = A4

    for s in students:
        card = generate_herby_card(
            spec,
            student_name=s.get("nome"),
            qr_override=s.get("codigo_unico") or "HERBY",
        )
        pil = Image.fromarray(cv2.cvtColor(card, cv2.COLOR_BGR2RGB))
        jbuf = io.BytesIO()
        pil.save(jbuf, "JPEG", quality=90)
        jbuf.seek(0)
        del card, pil

        c.drawImage(ImageReader(jbuf), 0, 0, width=w_pt, height=h_pt)
        c.showPage()
        pages_drawn += 1

    c.save()
    return pages_drawn


HERBY_COORDS = {
    "page_w": PAGE_W, "page_h": PAGE_H,
    "cols_x": HERBY_COLS_X, "num_w": HERBY_NUM_W,
    "pitch": HERBY_PITCH, "side": HERBY_SIDE, "stroke": HERBY_STROKE,
    "y0": HERBY_Y0, "y1": HERBY_Y1,
    "min_qps": HERBY_MIN_QPS, "max_qps": HERBY_MAX_QPS,
    "qr_head_size": HERBY_QR_HEAD_SIZE, "qr_head_pos": list(HERBY_QR_HEAD_POS),
    "qr_foot_size": HERBY_QR_FOOT_SIZE, "qr_foot_pos": list(HERBY_QR_FOOT_POS),
    "nome_box": list(HERBY_NOME_BOX),
}


if __name__ == "__main__":
    out = Path(__file__).parent / "output"
    generate_herby_card_png(out / "gabarito-herby.png",
                            HerbySpec(evento="2026 - Av. Formativa 3", serie="5º ano"),
                            student_name="ALUNA EXEMPLO",
                            qr_override="OMR-2026-000001")
