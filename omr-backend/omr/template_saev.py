"""
Gerador de cartão-resposta OMR — modelo "Gabarito SAEV".

Canvas: 1448×2048 px (mesmo dos modelos padrao/sae).
Âncoras: 4 quadrados pretos (par superior na altura dos títulos,
par inferior no rodapé) — sem ArUco.
Grade: 4 subcolunas × ceil(qps/2) linhas (LP (1)-(N) / MAT 1.)-N.)),
bolhas QUADRADAS A-D. Dual 16+16 a 26+26 por avaliação.
Identificação: QR do sistema (codigo_unico OMR-AAAA-NNNNNN) no slot
superior esquerdo + caixa Nome impressa; caixa Turma mantida vazia.
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

from .template import PAGE_W, PAGE_H, load_font, _fit_text, make_qr_image


# ─── Âncoras (quadrados pretos sólidos) ───
SAEV_SQUARE = 75
SAEV_CORNER_CENTERS = {
    "TL": (110, 545),
    "TR": (1338, 545),
    "BL": (110, 1905),
    "BR": (1338, 1905),
}

# ─── Cabeçalho (calibrado na folha real via novo (4).jpeg) ───
SAEV_QR_SIZE = 250
SAEV_QR_POS = (100, 72)  # canto superior esquerdo
SAEV_NOME_LABEL_POS = (440, 70)
SAEV_NOME_BOX = (440, 110, 1360, 200)   # Nome impresso via _fit_text
SAEV_TURMA_LABEL_POS = (440, 215)
SAEV_TURMA_BOX = (440, 250, 870, 330)   # mantida VAZIA (manuscrita)
SAEV_RULER_Y = 370
SAEV_PHRASE_Y = 440
SAEV_TITLE_Y = 500

# ─── Grade de respostas (bolhas quadradas; calibrado na folha real) ───
SAEV_MIN_QPS = 16
SAEV_MAX_QPS = 26
SAEV_COLS_X = [120, 438, 752, 1068]  # origem de cada subcoluna
SAEV_NUM_W = 55
SAEV_PITCH = 41                      # passo entre alternativas
SAEV_SIDE = 30                       # lado externo do quadrado
SAEV_STROKE = 3
SAEV_Y0 = 660
SAEV_Y1 = 1790

SAEV_LETTERS = ["A", "B", "C", "D"]


def saev_rows_for(qps: int) -> int:
    """Linhas por subcoluna (2 subcolunas por disciplina)."""
    qps = max(1, min(SAEV_MAX_QPS, int(qps)))
    return (qps + 1) // 2


def saev_row_ys(qps: int) -> list[float]:
    """Ys das linhas, distribuídas na faixa fixa (cabe se 8..13 linhas)."""
    rows = saev_rows_for(qps)
    if rows == 1:
        return [float(SAEV_Y0)]
    step = (SAEV_Y1 - SAEV_Y0) / (rows - 1)
    return [round(SAEV_Y0 + i * step, 1) for i in range(rows)]


def saev_block_rows(qps: int):
    """Itera (questao_global, coluna 0..3, linha) — LP=1..qps, MAT=qps+1..2*qps."""
    qps = max(1, min(SAEV_MAX_QPS, int(qps)))
    rows = saev_rows_for(qps)
    for col in range(4):
        base = 0 if col < 2 else qps          # LP | MAT
        off = 0 if col % 2 == 0 else rows     # 1ª | 2ª subcoluna
        for r in range(rows):
            q = base + off + r + 1
            if q > base + qps:
                continue
            yield q, col, r


def saev_bubble_center(col: int, row: int, alt: int, qps: int = 22) -> tuple[float, float]:
    """Centro da bolha (coluna, linha, alternativa 0..3)."""
    ys = saev_row_ys(qps)
    x0 = SAEV_COLS_X[col]
    cx = x0 + SAEV_NUM_W + alt * SAEV_PITCH + SAEV_PITCH / 2
    return (cx, ys[row])


@dataclass
class SaevSpec:
    """Cabeçalho/editáveis do cartão SAEV (rede fixa, poucos campos)."""

    titulo_lp: str = "Língua Portuguesa"
    titulo_mat: str = "Matemática"
    frase: str = "Marque suas respostas. Boa prova!"
    n_questoes: int = 22  # por disciplina (16..26)
    turma: str = ""

    def clamped_qps(self) -> int:
        return max(SAEV_MIN_QPS, min(SAEV_MAX_QPS, int(self.n_questoes or 22)))


def _draw_saev_header(
    d: ImageDraw.ImageDraw,
    pil: Image.Image,
    spec: SaevSpec,
    name: str,
    qr_data: str,
) -> None:
    black = (0, 0, 0)
    gray_text = (90, 102, 102)

    # QR do sistema (identifica o aluno)
    try:
        qr_img = make_qr_image(qr_data, size=SAEV_QR_SIZE)
        pil.paste(qr_img, SAEV_QR_POS)
    except (ImportError, ValueError):
        pass

    # Nome impresso
    font_label = load_font(34)
    d.text(SAEV_NOME_LABEL_POS, "Nome do(a) aluno(s)", fill=black, font=font_label)
    x0, y0, x1, y1 = SAEV_NOME_BOX
    d.rectangle([x0, y0, x1, y1], outline=black, width=2)
    if name:
        fitted, fitted_font = _fit_text(d, name, x1 - x0 - 20, start_size=36)
        d.text((x0 + 12, y0 + 12), fitted, fill=black, font=fitted_font)

    # Turma: moldura VAZIA (manuscrita)
    d.text(SAEV_TURMA_LABEL_POS, "Turma", fill=black, font=font_label)
    tx0, ty0, tx1, ty1 = SAEV_TURMA_BOX
    d.rectangle([tx0, ty0, tx1, ty1], outline=black, width=2)

    # Régua preta + frase
    d.rectangle([85, SAEV_RULER_Y, 1363, SAEV_RULER_Y + 6], fill=black)
    font_phrase = load_font(34)
    bbox = d.textbbox((0, 0), spec.frase or "", font=font_phrase)
    d.text(((PAGE_W - (bbox[2] - bbox[0])) // 2, SAEV_PHRASE_Y),
           spec.frase or "", fill=black, font=font_phrase)


def generate_saev_card(
    spec: SaevSpec | None = None,
    student_name: str | None = None,
    qr_override: str | None = None,
    header: bool = True,
) -> np.ndarray:
    spec = spec or SaevSpec()
    qps = spec.clamped_qps()
    name = (student_name or "").strip()
    qr_data = (qr_override or "").strip() or "SAEV"

    img = np.ones((PAGE_H, PAGE_W, 3), dtype=np.uint8) * 255
    pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    d = ImageDraw.Draw(pil)

    black = (0, 0, 0)
    gray_text = (90, 102, 102)

    if header:
        _draw_saev_header(d, pil, spec, name, qr_data)

    # ─── Âncoras ───
    for cx, cy in SAEV_CORNER_CENTERS.values():
        x0, y0 = cx - SAEV_SQUARE // 2, cy - SAEV_SQUARE // 2
        d.rectangle([x0, y0, x0 + SAEV_SQUARE, y0 + SAEV_SQUARE], fill=black)

    # ─── Títulos das disciplinas ───
    font_title = load_font(40)
    for text, cx in ((spec.titulo_lp, 480), (spec.titulo_mat, 1030)):
        bbox = d.textbbox((0, 0), text, font=font_title)
        d.text((cx - (bbox[2] - bbox[0]) // 2, SAEV_TITLE_Y), text, fill=black, font=font_title)

    # ─── Grade ───
    font_head = load_font(22)
    font_num = load_font(26)
    ys = saev_row_ys(qps)
    rows = saev_rows_for(qps)
    for q, col, r in saev_block_rows(qps):
        y = ys[r]
        x0 = SAEV_COLS_X[col]
        # rótulo: LP "(n)" | MAT "n.)"
        num = f"({q})" if col < 2 else f"{q - qps}.)"
        bbox = d.textbbox((0, 0), num, font=font_num)
        d.text((x0 + SAEV_NUM_W - (bbox[2] - bbox[0]) - 6, y - 20), num, fill=black, font=font_num)
        for i, letter in enumerate(SAEV_LETTERS):
            cx = x0 + SAEV_NUM_W + i * SAEV_PITCH + SAEV_PITCH / 2
            # letra acima
            bbox = d.textbbox((0, 0), letter, font=font_head)
            d.text((cx - (bbox[2] - bbox[0]) / 2, y - SAEV_SIDE / 2 - 30),
                   letter, fill=gray_text, font=font_head)
            # quadrado vazado
            h = SAEV_SIDE / 2
            d.rectangle([cx - h, y - h, cx + h, y + h], outline=black, width=SAEV_STROKE)

    return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)


def generate_saev_card_png(output_path: str | Path, spec: SaevSpec | None = None, **kw) -> Path:
    img = generate_saev_card(spec, **kw)
    p = Path(output_path); p.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(p), img); return p


def generate_saev_card_bytes(fmt: str = "PNG", spec: SaevSpec | None = None, **kw) -> bytes:
    img = generate_saev_card(spec, **kw)
    pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    buf = io.BytesIO(); pil.save(buf, format=fmt); return buf.getvalue()


def build_saev_batch_pdf(
    students: list[dict],
    spec: SaevSpec,
    out_buf: io.BytesIO,
) -> int:
    """1 página por aluno (nome impresso + QR do código do aluno)."""
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas as pdf_canvas
    from reportlab.lib.utils import ImageReader

    pages_drawn = 0
    c = pdf_canvas.Canvas(out_buf, pagesize=A4)
    w_pt, h_pt = A4

    for s in students:
        card = generate_saev_card(
            spec,
            student_name=s.get("nome"),
            qr_override=s.get("codigo_unico") or "SAEV",
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


SAEV_COORDS = {
    "page_w": PAGE_W, "page_h": PAGE_H,
    "corner_centers": {k: list(v) for k, v in SAEV_CORNER_CENTERS.items()},
    "corner_size": SAEV_SQUARE,
    "cols_x": SAEV_COLS_X, "num_w": SAEV_NUM_W,
    "pitch": SAEV_PITCH, "side": SAEV_SIDE, "stroke": SAEV_STROKE,
    "y0": SAEV_Y0, "y1": SAEV_Y1,
    "min_qps": SAEV_MIN_QPS, "max_qps": SAEV_MAX_QPS,
    "qr_size": SAEV_QR_SIZE, "qr_pos": list(SAEV_QR_POS),
    "nome_box": list(SAEV_NOME_BOX), "turma_box": list(SAEV_TURMA_BOX),
}


if __name__ == "__main__":
    out = Path(__file__).parent / "output"
    generate_saev_card_png(out / "gabarito-saev.png",
                           SaevSpec(), student_name="ALUNA EXEMPLO",
                           qr_override="OMR-2026-000001")
