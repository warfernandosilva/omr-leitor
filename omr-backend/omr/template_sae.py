"""
Gerador de cartão-resposta OMR — modelo "Avaliação Contínua" (SAE).

Canvas: 1448×2048 px (mesmo do modelo padrão).
Âncoras: 4 quadrados pretos nos cantos (sem ArUco).
Grade: 4 blocos × 7 linhas (questões 01–28, A–D), linhas tracejadas.
Identificação: cartão cinza com QR Code, linha de nome e caixinhas de
data de nascimento (apenas visuais — não lidas).

Todas as informações do cabeçalho são editáveis via SaeSpec.
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

from .template import PAGE_W, PAGE_H, load_font, _fit_text, make_qr_image


# ─── Âncoras (quadrados pretos) ───
CORNER_SIZE = 40
CORNER_MARGIN = 64
CORNER_TOP = 1140
CORNER_BOTTOM = 1860
CORNER_CENTERS = {
    "TL": (CORNER_MARGIN + CORNER_SIZE // 2, CORNER_TOP + CORNER_SIZE // 2),
    "TR": (PAGE_W - CORNER_MARGIN - CORNER_SIZE // 2, CORNER_TOP + CORNER_SIZE // 2),
    "BR": (PAGE_W - CORNER_MARGIN - CORNER_SIZE // 2, CORNER_BOTTOM + CORNER_SIZE // 2),
    "BL": (CORNER_MARGIN + CORNER_SIZE // 2, CORNER_BOTTOM + CORNER_SIZE // 2),
}

# ─── Grade de bolhas ───
SAE_BLOCKS_X = [100, 431, 762, 1093]
SAE_BLOCK_W = 270
SAE_NUM_W = 48
SAE_FIRST_ROW_Y = 1265
SAE_ROW_STEP = 84
SAE_ROWS_PER_BLOCK = 7
SAE_BUBBLE_DX = [80, 132, 184, 236]   # offsets a partir do início do bloco
SAE_BUBBLE_RADIUS = 13.5
SAE_HEADER_Y = 1178
SAE_FRAME_TOP_PAD = 47
SAE_MAX_QUESTIONS = SAE_ROWS_PER_BLOCK * len(SAE_BLOCKS_X)  # 28

SAE_LETTERS = ["A", "B", "C", "D"]

# ─── QR Code ───
SAE_QR_SIZE = 150
SAE_QR_POS = (120, 650)  # canto superior esquerdo


@dataclass
class SaeSpec:
    """Todas as informações editáveis do cartão SAE."""

    ano: str = "2026"
    programa_linha1: str = "AVALIAÇÃO CONTÍNUA DA APRENDIZAGEM"
    programa_linha2: str = "NOS ANOS FINAIS - CICLO II"
    titulo: list[str] = field(default_factory=lambda: [
        "AVALIAÇÃO CONTÍNUA",
        "DA APRENDIZAGEM",
        "NOS ANOS FINAIS",
        "CICLO II",
    ])
    caderno: str = "M0901"
    disciplina: str = "MATEMÁTICA"
    serie: str = "9º ano do Ensino Fundamental"
    qr_payload: str = "2269M0901"
    n_questoes: int = 26
    codigo_barras: str = "6357256532"
    nome_aluno: str | None = None

    def clamped_questions(self) -> int:
        return max(1, min(SAE_MAX_QUESTIONS, int(self.n_questoes or 26)))


def sae_block_rows(n: int) -> list[tuple[int, int, int]]:
    """Retorna [(questao, bloco, linha)] para as n primeiras questões."""
    n = max(1, min(SAE_MAX_QUESTIONS, int(n)))
    out = []
    for q in range(1, n + 1):
        b, r = divmod(q - 1, SAE_ROWS_PER_BLOCK)
        out.append((q, b, r))
    return out


def sae_bubble_center(bloco: int, linha: int, alternativa: int) -> tuple[int, int]:
    """Centro (x, y) da bolha. alternativa: 0=A..3=D."""
    bx = SAE_BLOCKS_X[bloco]
    return (bx + SAE_BUBBLE_DX[alternativa], SAE_FIRST_ROW_Y + linha * SAE_ROW_STEP)


def _draw_tracked(
    d: ImageDraw.ImageDraw, cx: int, y: int, text: str,
    font, fill: tuple[int, int, int], tracking: int,
) -> None:
    """Texto centralizado em cx com espaçamento entre letras."""
    widths = [d.textlength(ch, font=font) for ch in text]
    total = sum(widths) + tracking * (len(text) - 1)
    x = cx - total / 2
    for ch, w in zip(text, widths):
        d.text((x, y), ch, fill=fill, font=font)
        x += w + tracking


def _dashed_hline(d: ImageDraw.ImageDraw, x0: int, x1: int, y: int,
                  fill: tuple[int, int, int], dash: int = 8, gap: int = 6) -> None:
    x = x0
    while x < x1:
        d.line([(x, y), (min(x + dash, x1), y)], fill=fill, width=2)
        x += dash + gap


def _dashed_rect(d: ImageDraw.ImageDraw, box: tuple[int, int, int, int],
                 fill: tuple[int, int, int]) -> None:
    x0, y0, x1, y1 = box
    _dashed_hline(d, x0, x1, y0, fill)
    _dashed_hline(d, x0, x1, y1, fill)
    y = y0
    while y < y1:
        d.line([(x0, y), (x0, min(y + 8, y1))], fill=fill, width=2)
        d.line([(x1, y), (x1, min(y + 8, y1))], fill=fill, width=2)
        y += 14


def _draw_sae_header(
    d: ImageDraw.ImageDraw,
    pil: Image.Image,
    spec: SaeSpec,
    name: str,
    qr_data: str,
) -> None:
    """Desenha todo o cabeçalho (topo, badge, ficha cinza, QR, nome, nascimento)."""
    black = (0, 0, 0)
    gray_text = (90, 102, 102)
    card_bg = (238, 241, 241)
    card_line = (154, 165, 165)
    accent = (125, 139, 140)
    badge_dark = (58, 69, 82)

    # ─── Topo: ano + programa ───
    font_year = load_font(46)
    _draw_tracked(d, 230, 92, spec.ano or "2026", font_year, black, tracking=14)

    font_prog = load_font(32)
    for i, line in enumerate([spec.programa_linha1, spec.programa_linha2]):
        if not line:
            continue
        bbox = d.textbbox((0, 0), line, font=font_prog)
        tw = bbox[2] - bbox[0]
        d.text((1300 - tw, 92 + i * 46), line, fill=black, font=font_prog)

    # ─── Título grande ───
    font_title = load_font(76)
    ty = 212
    for line in (spec.titulo or [])[:4]:
        d.text((150, ty), line, fill=black, font=font_title)
        ty += 102

    # ─── Badge CADERNO ───
    bx0, bx1 = 940, 1330
    d.rounded_rectangle([bx0, 498, bx1, 592], radius=14, fill=black)
    d.rounded_rectangle([bx0, 425, bx1, 512], radius=16, fill=badge_dark)
    font_badge = load_font(52)
    _draw_tracked(d, (bx0 + bx1) // 2, 432, "CADERNO", font_badge, (255, 255, 255), tracking=16)
    font_cad = load_font(72)
    _draw_tracked(d, (bx0 + bx1) // 2, 505, spec.caderno or "", font_cad,
                  (255, 255, 255), tracking=18)

    # ─── Cartão cinza de identificação ───
    d.rectangle([70, 600, 1378, 1075], fill=card_bg)
    d.rectangle([140, 1075, 1378, 1092], fill=accent)

    try:
        qr_img = make_qr_image(qr_data, size=SAE_QR_SIZE)
        pil.paste(qr_img, SAE_QR_POS)
    except (ImportError, ValueError):
        pass
    font_qr = load_font(28)
    caption, caption_font = _fit_text(d, qr_data, 280, start_size=28, min_size=16)
    d.text((SAE_QR_POS[0], SAE_QR_POS[1] + SAE_QR_SIZE + 8), caption,
           fill=black, font=caption_font)

    font_disc = load_font(48)
    bbox = d.textbbox((0, 0), spec.disciplina or "", font=font_disc)
    d.text((1320 - (bbox[2] - bbox[0]), 700), spec.disciplina or "", fill=black, font=font_disc)
    font_serie = load_font(42)
    bbox = d.textbbox((0, 0), spec.serie or "", font=font_serie)
    d.text((1320 - (bbox[2] - bbox[0]), 768), spec.serie or "", fill=black, font=font_serie)

    # Nome do estudante
    d.ellipse([112, 872, 128, 888], fill=gray_text)
    font_label = load_font(34)
    d.text((145, 858), "Nome do(a) estudante", fill=black, font=font_label)
    d.rectangle([150, 905, 1320, 965], outline=card_line, width=2)
    if name:
        fitted, fitted_font = _fit_text(d, name, 1320 - 150 - 20, start_size=36)
        d.text((165, 912), fitted, fill=black, font=fitted_font)

    # Data de nascimento (visual)
    font_dn = load_font(30)
    for i, line in enumerate(["Data de Nascimento", "do(a) estudante"]):
        bbox = d.textbbox((0, 0), line, font=font_dn)
        tw = bbox[2] - bbox[0]
        d.text((560 - tw // 2, 985 + i * 38), line, fill=black, font=font_dn)
    box_y0, box_y1, box_s = 975, 1033, 58
    groups = [2, 2, 4]
    gx = 800
    for g in groups:
        gw = g * box_s
        d.rectangle([gx, box_y0, gx + gw, box_y1], outline=card_line, width=2)
        for k in range(1, g):
            lx = gx + k * box_s
            d.line([(lx, box_y0), (lx, box_y1)], fill=card_line, width=2)
        gx += gw + 24


def generate_sae_card(
    spec: SaeSpec | None = None,
    student_name: str | None = None,
    qr_override: str | None = None,
    header: bool = True,
) -> np.ndarray:
    spec = spec or SaeSpec()
    n = spec.clamped_questions()
    name = (student_name or spec.nome_aluno or "").strip()
    qr_data = (qr_override or spec.qr_payload or "").strip() or "SAE"

    img = np.ones((PAGE_H, PAGE_W, 3), dtype=np.uint8) * 255
    pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    d = ImageDraw.Draw(pil)

    black = (0, 0, 0)
    gray_text = (90, 102, 102)
    num_bg = (215, 219, 219)
    card_line = (154, 165, 165)

    if header:
        _draw_sae_header(d, pil, spec, name, qr_data)

    # ─── Âncoras ───
    for cx, cy in CORNER_CENTERS.values():
        x0, y0 = cx - CORNER_SIZE // 2, cy - CORNER_SIZE // 2
        d.rectangle([x0, y0, x0 + CORNER_SIZE, y0 + CORNER_SIZE], fill=black)

    # ─── Grade de respostas ───
    font_head = load_font(30)
    font_num = load_font(26)
    rows_by_block: dict[int, list[tuple[int, int]]] = {}
    for q, b, r in sae_block_rows(n):
        rows_by_block.setdefault(b, []).append((q, r))

    for b, bx in enumerate(SAE_BLOCKS_X):
        rows = rows_by_block.get(b, [])
        if not rows:
            continue
        for i, letter in enumerate(SAE_LETTERS):
            lx = bx + SAE_BUBBLE_DX[i]
            bbox = d.textbbox((0, 0), letter, font=font_head)
            lw = bbox[2] - bbox[0]
            d.text((lx - lw // 2, SAE_HEADER_Y), letter, fill=gray_text, font=font_head)
        # moldura tracejada do bloco (até a última linha usada)
        last_r = max(r for _, r in rows)
        y_bot = SAE_FIRST_ROW_Y + last_r * SAE_ROW_STEP + SAE_ROW_STEP // 2
        y_top = SAE_FIRST_ROW_Y - SAE_FRAME_TOP_PAD
        _dashed_rect(d, (bx, y_top, bx + SAE_BLOCK_W, y_bot), card_line)
        for q, r in rows:
            y = SAE_FIRST_ROW_Y + r * SAE_ROW_STEP
            # célula do número
            d.rectangle([bx, y - 26, bx + SAE_NUM_W, y + 26], fill=num_bg)
            num = f"{q:02d}"
            bbox = d.textbbox((0, 0), num, font=font_num)
            nw = bbox[2] - bbox[0]
            d.text((bx + (SAE_NUM_W - nw) // 2, y - 20), num, fill=gray_text, font=font_num)
            for i in range(4):
                x = bx + SAE_BUBBLE_DX[i]
                rr = SAE_BUBBLE_RADIUS
                d.ellipse([x - rr, y - rr, x + rr, y + rr], outline=black, width=3)
            # separador tracejado (exceto após a última linha do bloco)
            if r < last_r:
                _dashed_hline(d, bx, bx + SAE_BLOCK_W, y + SAE_ROW_STEP // 2, card_line)

    # ─── Código de barras (texto, só com cabeçalho) ───
    if header:
        font_bar = load_font(34)
        bbox = d.textbbox((0, 0), spec.codigo_barras or "", font=font_bar)
        d.text((1300 - (bbox[2] - bbox[0]), 1900), spec.codigo_barras or "",
               fill=black, font=font_bar)

    return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)


def generate_colar_card(n_questoes: int = 26) -> np.ndarray:
    """Cartão 'Colar em Avaliação': só âncoras + grade (sem cabeçalho/QR)."""
    return generate_sae_card(SaeSpec(n_questoes=n_questoes), header=False)


def generate_colar_card_bytes(fmt: str = "PNG", n_questoes: int = 26) -> bytes:
    img = generate_colar_card(n_questoes)
    pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    buf = io.BytesIO(); pil.save(buf, format=fmt); return buf.getvalue()


def generate_sae_card_png(output_path: str | Path, spec: SaeSpec | None = None, **kw) -> Path:
    img = generate_sae_card(spec, **kw)
    p = Path(output_path); p.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(p), img); return p


def generate_sae_card_bytes(fmt: str = "PNG", spec: SaeSpec | None = None, **kw) -> bytes:
    img = generate_sae_card(spec, **kw)
    pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    buf = io.BytesIO(); pil.save(buf, format=fmt); return buf.getvalue()


def build_sae_batch_pdf(
    students: list[dict],
    spec: SaeSpec,
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
        card = generate_sae_card(
            spec,
            student_name=s.get("nome"),
            qr_override=s.get("codigo_unico") or spec.qr_payload,
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


SAE_COORDS = {
    "page_w": PAGE_W, "page_h": PAGE_H,
    "corner_centers": {k: list(v) for k, v in CORNER_CENTERS.items()},
    "corner_size": CORNER_SIZE,
    "blocks_x": SAE_BLOCKS_X, "block_w": SAE_BLOCK_W,
    "bubble_dx": SAE_BUBBLE_DX, "bubble_radius": SAE_BUBBLE_RADIUS,
    "first_row_y": SAE_FIRST_ROW_Y, "row_step": SAE_ROW_STEP,
    "rows_per_block": SAE_ROWS_PER_BLOCK,
    "max_questions": SAE_MAX_QUESTIONS,
    "qr_size": SAE_QR_SIZE, "qr_pos": list(SAE_QR_POS),
}

# "Colar em Avaliação": mesma geometria do SAE (só âncoras + grade).
COLAR_COORDS = dict(SAE_COORDS)


if __name__ == "__main__":
    out = Path(__file__).parent / "output"
    generate_sae_card_png(out / "gabarito-sae.png")
    print(f"Gerado: {out / 'gabarito-sae.png'}")
