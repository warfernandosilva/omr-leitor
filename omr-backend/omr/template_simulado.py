"""
Gerador de cartão-resposta OMR — modelo "Simulado" (réguas da tabela).

Canvas: 1448×2048 px (mesmo dos demais modelos).
Âncoras: NENHUM marcador dedicado — as próprias réguas da tabela servem de
referência (o detector encontra 4 quinas a partir delas).
Identificação: NENHUMA (sem QR, sem nome, sem turma, sem caixa de título).

Geometria calibrada pixel a pixel no gabarito de referência
`IMG/Gabarito simulado.jpg` (768×1796), medido em Fase 0:

    JPG (centros de linha)
      V      = 7.0, 188.0, 328.5, 474.5, 613.5, 756.5   (caixa de dados)
      V5_cab = 750.5                                     (degrau de 6 px)
      H      = 5.5, 73.5, 90.0, ..., 1785.0   (25 réguas)
               topo→cabeçalho 68 | cabeçalho→dados 16.5 | pitch 77.045454
      caixa cabeçalho = x 4..753, y 4..75   (retângulo SEPARADO: y 76..87 sem tinta)
      caixa dados     = x 4..759, y 88..1788
      88/88 bolhas; anel externo r≈24.5, interno r≈20.4, traço 4-5 px

Escala para o canvas (margem vertical 40, altura útil 1968):
      s = 1968 / (1785 - 5.5) = 1.10592863
      tabela = (309.53, 40.00) → (1138.47, 2008.00)   828.94 × 1968
"""

from __future__ import annotations

import io
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

from .template import PAGE_W, PAGE_H, load_font


# ─── Medidas do gabarito de referência (JPG, centros de linha) ───
JPG_W, JPG_H = 768, 1796
JPG_V = [7.0, 188.0, 328.5, 474.5, 613.5, 756.5]
JPG_V5_HEADER = 750.5
JPG_H_TOP = 5.5
JPG_H_HEADER_BOT = 73.5
JPG_H_DATA_TOP = 90.0
JPG_H_BOTTOM = 1785.0
JPG_ROW_PITCH = (JPG_H_BOTTOM - JPG_H_DATA_TOP) / 22.0   # 77.045454...

# ─── Escala para o canvas ───
SIMULADO_MARGIN_Y = 40
SIMULADO_SCALE = (PAGE_H - 2 * SIMULADO_MARGIN_Y) / (JPG_H_BOTTOM - JPG_H_TOP)  # 1.10592863
_SIM_W = (JPG_V[5] - JPG_V[0]) * SIMULADO_SCALE                                # 828.89
SIMULADO_X0 = round((PAGE_W - _SIM_W) / 2.0, 2)                                 # 309.55
SIMULADO_Y0 = float(SIMULADO_MARGIN_Y)                                          # 40.0


def _x(jpg_x: float) -> float:
    return round(SIMULADO_X0 + SIMULADO_SCALE * (jpg_x - JPG_V[0]), 2)


def _y(jpg_y: float) -> float:
    return round(SIMULADO_Y0 + SIMULADO_SCALE * (jpg_y - JPG_H_TOP), 2)


# ─── Grade no canvas ───
SIMULADO_V = [_x(v) for v in JPG_V]                  # 309.53 … 1138.47
SIMULADO_V5_HEADER = _x(JPG_V5_HEADER)               # 1131.81
SIMULADO_H_TOP = _y(JPG_H_TOP)                       # 40.00
SIMULADO_H_HEADER_BOT = _y(JPG_H_HEADER_BOT)         # 115.20
SIMULADO_H_DATA_TOP = _y(JPG_H_DATA_TOP)             # 133.45
SIMULADO_H_BOTTOM = _y(JPG_H_BOTTOM)                 # 2008.00
SIMULADO_ROW_PITCH = round(JPG_ROW_PITCH * SIMULADO_SCALE, 4)   # 85.2069
SIMULADO_TABLE = (SIMULADO_V[0], SIMULADO_H_TOP, SIMULADO_V[5], SIMULADO_H_BOTTOM)

# ─── Bolhas ───
# Célula 0 (V0..V1) guarda os números; A..D ficam nas células 1..4.
SIMULADO_COLS = [round((SIMULADO_V[i] + SIMULADO_V[i + 1]) / 2.0, 2) for i in range(1, 5)]
SIMULADO_NUM_X = round((SIMULADO_V[0] + SIMULADO_V[1]) / 2.0, 2)          # 409.64
SIMULADO_HEADER_LABEL_Y = round((SIMULADO_H_TOP + SIMULADO_H_HEADER_BOT) / 2.0, 2)  # 77.60
SIMULADO_BUBBLE_R = 27.0          # raio externo do anel (desenho)
SIMULADO_BUBBLE_STROKE = 5        # espessura do anel
SIMULADO_INNER_R = 20             # raio do disco amostrado pelo leitor

# ─── Traço ───
SIMULADO_LINE_W = 7

SIMULADO_MAX_QUESTIONS = 22
SIMULADO_LAYOUT = "single"
SIMULADO_LETTERS = ["A", "B", "C", "D"]


def simulado_row_top(q: int) -> float:
    """Y da régua superior da questão q (1..22)."""
    q = max(1, min(SIMULADO_MAX_QUESTIONS, int(q)))
    return round(SIMULADO_H_DATA_TOP + (q - 1) * SIMULADO_ROW_PITCH, 2)


def simulado_row_center(q: int) -> float:
    """Y do centro da célula da questão q (1..22)."""
    q = max(1, min(SIMULADO_MAX_QUESTIONS, int(q)))
    return round(SIMULADO_H_DATA_TOP + (q - 0.5) * SIMULADO_ROW_PITCH, 2)


def simulado_bubble_center(q: int, ci: int) -> tuple[float, float]:
    """Centro (x, y) da bolha da questão q (1..22) na coluna ci (0=A..3=D)."""
    ci = max(0, min(3, int(ci)))
    return (SIMULADO_COLS[ci], simulado_row_center(q))


def _grid(img: np.ndarray) -> np.ndarray:
    """Desenha as duas caixas (cabeçalho + dados) com cv2 (traço centrado)."""
    t = SIMULADO_LINE_W
    v, v5h = SIMULADO_V, SIMULADO_V5_HEADER
    y0, y1 = SIMULADO_H_TOP, SIMULADO_H_HEADER_BOT
    y2, y3 = SIMULADO_H_DATA_TOP, SIMULADO_H_BOTTOM

    # caixa do cabeçalho (mais estreita à direita: degrau de 6 px no JPG)
    cv2.line(img, (int(round(v[0])), int(round(y0))), (int(round(v5h)), int(round(y0))), (0, 0, 0), t)
    cv2.line(img, (int(round(v[0])), int(round(y1))), (int(round(v5h)), int(round(y1))), (0, 0, 0), t)
    for i in range(5):
        cv2.line(img, (int(round(v[i])), int(round(y0))), (int(round(v[i])), int(round(y1))), (0, 0, 0), t)
    cv2.line(img, (int(round(v5h)), int(round(y0))), (int(round(v5h)), int(round(y1))), (0, 0, 0), t)

    # caixa de dados (23 réguas horizontais: topo + 22 passos)
    for k in range(23):
        y = y2 + k * SIMULADO_ROW_PITCH
        cv2.line(img, (int(round(v[0])), int(round(y))), (int(round(v[5])), int(round(y))), (0, 0, 0), t)
    for i in range(6):
        cv2.line(img, (int(round(v[i])), int(round(y2))), (int(round(v[i])), int(round(y3))), (0, 0, 0), t)
    return img


def _text(pil: Image.Image) -> Image.Image:
    d = ImageDraw.Draw(pil)
    black = (0, 0, 0)

    # cabeçalho: QUESTÃO | A | B | C | D
    # (só reduz a fonte — nunca trunca, ao contrário de _fit_text)
    cell_w = int(SIMULADO_V[1] - SIMULADO_V[0] - 50)
    label = "QUESTÃO"
    size = 44
    label_font = load_font(size)
    while size > 16 and d.textlength(label, font=label_font) > cell_w:
        size -= 2
        label_font = load_font(size)
    bbox = d.textbbox((0, 0), label, font=label_font)
    d.text((SIMULADO_NUM_X - (bbox[2] - bbox[0]) / 2,
            SIMULADO_HEADER_LABEL_Y - (bbox[3] - bbox[1]) / 2 - bbox[1]),
           label, fill=black, font=label_font)

    font_letter = load_font(64)
    for i, letter in enumerate(SIMULADO_LETTERS):
        bbox = d.textbbox((0, 0), letter, font=font_letter)
        d.text((SIMULADO_COLS[i] - (bbox[2] - bbox[0]) / 2,
                SIMULADO_HEADER_LABEL_Y - (bbox[3] - bbox[1]) / 2 - bbox[1]),
               letter, fill=black, font=font_letter)

    # números das questões
    font_num = load_font(64)
    for q in range(1, SIMULADO_MAX_QUESTIONS + 1):
        num = str(q)
        bbox = d.textbbox((0, 0), num, font=font_num)
        y = simulado_row_center(q)
        d.text((SIMULADO_NUM_X - (bbox[2] - bbox[0]) / 2,
                y - (bbox[3] - bbox[1]) / 2 - bbox[1]),
               num, fill=black, font=font_num)
    return pil


def generate_simulado_card(n_questoes: int | None = None) -> np.ndarray:
    """Cartão 'Simulado': só a tabela (sem identificação). Sempre 22 questões."""
    img = np.full((PAGE_H, PAGE_W, 3), 255, dtype=np.uint8)
    _grid(img)

    # cv2.circle(R, espessura t) cobre o raio [R - t/2, R + t/2] -> externo = R + t//2
    r_draw = int(SIMULADO_BUBBLE_R) - SIMULADO_BUBBLE_STROKE // 2
    for q in range(1, SIMULADO_MAX_QUESTIONS + 1):
        for ci in range(4):
            cx, cy = simulado_bubble_center(q, ci)
            cv2.circle(img, (int(round(cx)), int(round(cy))), r_draw,
                       (0, 0, 0), SIMULADO_BUBBLE_STROKE)

    pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    pil = _text(pil)
    return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)


def generate_simulado_card_png(output_path: str | Path) -> Path:
    img = generate_simulado_card()
    p = Path(output_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(p), img)
    return p


def generate_simulado_card_bytes(fmt: str = "PNG") -> bytes:
    img = generate_simulado_card()
    pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    buf = io.BytesIO()
    pil.save(buf, format=fmt)
    return buf.getvalue()


def build_simulado_batch_pdf(registros: list[dict], out_buf: io.BytesIO) -> int:
    """1 página por registro (cartão idêntico: sem identificação impressa).

    O modelo não tem QR/nome/turma, então não há o que personalizar por
    aluno — mas o lote é gerado por consistência com os demais templates.
    """
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas as pdf_canvas
    from reportlab.lib.utils import ImageReader

    card = generate_simulado_card()
    pil = Image.fromarray(cv2.cvtColor(card, cv2.COLOR_BGR2RGB))
    jbuf = io.BytesIO()
    pil.save(jbuf, "JPEG", quality=90)
    jbuf.seek(0)
    del card, pil

    pages_drawn = 0
    c = pdf_canvas.Canvas(out_buf, pagesize=A4)
    w_pt, h_pt = A4
    for _s in registros:
        c.drawImage(ImageReader(jbuf), 0, 0, width=w_pt, height=h_pt)
        c.showPage()
        pages_drawn += 1
    c.save()
    return pages_drawn


SIMULADO_COORDS = {
    "page_w": PAGE_W,
    "page_h": PAGE_H,
    "table": list(SIMULADO_TABLE),
    "v_x": SIMULADO_V,
    "v5_header": SIMULADO_V5_HEADER,
    "h_top": SIMULADO_H_TOP,
    "h_header_bot": SIMULADO_H_HEADER_BOT,
    "h_data_top": SIMULADO_H_DATA_TOP,
    "h_bottom": SIMULADO_H_BOTTOM,
    "row_pitch": SIMULADO_ROW_PITCH,
    "cols": SIMULADO_COLS,
    "num_x": SIMULADO_NUM_X,
    "header_label_y": SIMULADO_HEADER_LABEL_Y,
    "bubble_r": SIMULADO_BUBBLE_R,
    "bubble_stroke": SIMULADO_BUBBLE_STROKE,
    "inner_r": SIMULADO_INNER_R,
    "line_w": SIMULADO_LINE_W,
    "max_questions": SIMULADO_MAX_QUESTIONS,
    "layout": SIMULADO_LAYOUT,
    "letters": SIMULADO_LETTERS,
}


if __name__ == "__main__":
    out = Path(__file__).parent / "output"
    generate_simulado_card_png(out / "gabarito-simulado.png")
    print(f"Gerado: {out / 'gabarito-simulado.png'}")
