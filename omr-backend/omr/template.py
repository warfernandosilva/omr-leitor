"""
Gerador de cartão-resposta OMR — coordenadas exatas da imagem de referência.

Canvas: 1448×2048 px (≈A4 vertical)
1 px ≈ 0.145 mm
ArUco: DICT_4X4_50, IDs 0-3

Cartões personalizados por aluno: nome impresso, ID textual e QR Code.
"""

from __future__ import annotations

import io
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

# ─── Canvas ───
PAGE_W = 1448
PAGE_H = 2048

# ─── ArUco DICT_4X4_50 ───
ARUCO_DICT = cv2.aruco.DICT_4X4_50
ARUCO_IDS = [0, 1, 2, 3]  # TL, TR, BR, BL
ARUCO_SIZE = 104

# Centros dos marcadores
ARUCO_CENTERS = {
    0: (138, 531),    # TL: 86 + 104/2, 479 + 104/2
    1: (1310, 531),   # TR: 1258 + 104/2, 479 + 104/2
    2: (1310, 1876),  # BR: 1258 + 104/2, 1824 + 104/2
    3: (138, 1876),   # BL: 86 + 104/2, 1824 + 104/2
}

HALF_MK = ARUCO_SIZE // 2

# ─── Layout ───
ALUNO_BOX = (85, 137, 1140, 221) #ALUNO_BOX = (85, 137, 1363, 221)
TURMA_BOX = (85, 229, 725, 313)

DIVIDER_X = 723
DIVIDER_Y0 = 584
DIVIDER_Y1 = 1825

TITLE_Y = 489
TITLE_PORT_X = 483
TITLE_MAT_X = 1034

HEADER_Y = 577

# ─── Grid de bolhas ───
QUESTIONS_PER_SUBJECT = 22          # padrão/legado (cartões já impressos)
MAX_QUESTIONS_PER_SUBJECT = 26      # limite físico: espaçamento mínimo entre bolhas

BUBBLE_RADIUS = 19.5
FIRST_QUESTION_Y = 653.0
LAST_QUESTION_Y = 1756.0

PORT_NUM_X = 280
PORT_X = [349, 438.5, 528, 618]

MAT_NUM_X = 832
MAT_X = [900, 990.5, 1080, 1169.5]


def question_y_for(n: int) -> list[float]:
    """
    Posições Y das n primeiras questões de cada disciplina.

    n=22 reproduz EXATAMENTE o layout legado (cartões antigos continuam lendo).
    Outros valores distribuem as linhas uniformemente na mesma faixa vertical.
    """
    n = max(1, min(MAX_QUESTIONS_PER_SUBJECT, int(n)))
    if n == 22:
        return list(LEGACY_QUESTION_Y_22)
    if n == 1:
        return [FIRST_QUESTION_Y]
    step = (LAST_QUESTION_Y - FIRST_QUESTION_Y) / (n - 1)
    return [round(FIRST_QUESTION_Y + i * step, 1) for i in range(n)]


LEGACY_QUESTION_Y_22 = [
    653, 705, 758, 810, 863, 915, 968, 1020, 1073, 1126,
    1178, 1231, 1283, 1336, 1388, 1441, 1494, 1546, 1599, 1651,
    1704, 1756,
]

# Compatibilidade: grid padrão (22)
QUESTION_Y = LEGACY_QUESTION_Y_22

# ─── Modo coluna única (1 disciplina) ───
LAYOUT_DUAL = "dual"
LAYOUT_SINGLE = "single"

SINGLE_TITLE_CENTER_X = 724
SINGLE_NUM_X = 404
SINGLE_X = [514.0, 654.0, 794.0, 934.0]   # A B C D compactos, centrados na página (passo 140px)
SINGLE_FIRST_Y = 635.0
SINGLE_LAST_Y = 1805.0
SINGLE_BUBBLE_RADIUS = 15.0                # bolhas menores cabem mais linhas
_MIN_STEP_SINGLE = 34.0                    # espaçamento mínimo seguro para leitura
MAX_QUESTIONS_SINGLE = int((SINGLE_LAST_Y - SINGLE_FIRST_Y) // _MIN_STEP_SINGLE) + 1  # 35


def single_question_y_for(n: int) -> list[float]:
    """Posições Y das n questões no modo coluna única."""
    n = max(1, min(MAX_QUESTIONS_SINGLE, int(n)))
    if n == 1:
        return [SINGLE_FIRST_Y]
    step = (SINGLE_LAST_Y - SINGLE_FIRST_Y) / (n - 1)
    return [round(SINGLE_FIRST_Y + i * step, 1) for i in range(n)]


LETTERS = ["A", "B", "C", "D"]

# ─── Cartão personalizado (por aluno) ───
QR_SIZE = 180     # QR_SIZE = 104
QR_CENTER = (1265, 230)  # faixa superior central, acima da caixa Aluno (y=137) QR_CENTER = (724, 69)
STUDENT_NAME_X = 320
ID_TEXT_POS = (95, 1782)  # abaixo da última linha de bolhas, à esquerda do divisor


def _generate_aruco_marker(dict_type: int, marker_id: int, size: int) -> np.ndarray:
    dictionary = cv2.aruco.getPredefinedDictionary(dict_type)
    # OpenCV >= 4.9 removeu generateImageMarker do módulo; tenta API nova e legada
    gen = getattr(cv2.aruco, "generateImageMarker", None)
    if gen is not None:
        return gen(dictionary, marker_id, size)
    generate = getattr(dictionary, "generateImageMarker", None)
    if generate is not None:
        return generate(marker_id, size)
    raise RuntimeError("Esta versão do OpenCV não oferece generateImageMarker (aruco)")


def make_qr_image(data: str, size: int = QR_SIZE) -> Image.Image:
    """Gera um QR Code (PIL) para os dados informados."""
    import qrcode

    qr = qrcode.QRCode(
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=1,
    )
    qr.add_data(data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    return img.resize((size, size), Image.NEAREST)


def load_font(size: int):
    for path in [
        "arial.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _fit_text(d: ImageDraw.ImageDraw, text: str, max_w: int, start_size: int, min_size: int = 20):
    """Reduz a fonte e trunca com reticências até o texto caber em max_w."""
    name = text
    size = start_size
    font = load_font(size)
    while size > min_size and d.textlength(name, font=font) > max_w:
        size -= 2
        font = load_font(size)
    while len(name) > 3 and d.textlength(name + "…", font=font) > max_w:
        name = name[:-1].rstrip()
    if d.textlength(name, font=font) > max_w:
        name = name.rstrip(" …") + "…"
    return name, font


def generate_card(
    subject_lp: str = "PORTUGUÊS",
    subject_mat: str = "MATEMÁTICA",
    student_name: str | None = None,
    student_id: str | None = None,
    student_matricula: str | None = None,
    questions_per_subject: int | None = None,
    layout_mode: str = LAYOUT_DUAL,
) -> np.ndarray:
    single = layout_mode == LAYOUT_SINGLE
    qps = questions_per_subject or QUESTIONS_PER_SUBJECT
    if single:
        qps = max(1, min(MAX_QUESTIONS_SINGLE, int(qps)))
        question_y = single_question_y_for(qps)
        xs = SINGLE_X
        radius = SINGLE_BUBBLE_RADIUS
        num_x = SINGLE_NUM_X
    else:
        qps = max(1, min(MAX_QUESTIONS_PER_SUBJECT, int(qps)))
        question_y = question_y_for(qps)
        xs = PORT_X
        radius = BUBBLE_RADIUS
        num_x = PORT_NUM_X
    img = np.ones((PAGE_H, PAGE_W, 3), dtype=np.uint8) * 255

    # ─── ArUco markers ───
    for mid in ARUCO_IDS:
        m = _generate_aruco_marker(ARUCO_DICT, mid, ARUCO_SIZE)
        cx, cy = ARUCO_CENTERS[mid]
        x0, y0 = cx - HALF_MK, cy - HALF_MK
        if len(m.shape) == 2:
            m = cv2.cvtColor(m, cv2.COLOR_GRAY2BGR)
        img[y0:y0 + ARUCO_SIZE, x0:x0 + ARUCO_SIZE] = m

    # ─── PIL for text ───
    pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    d = ImageDraw.Draw(pil)

    font_title = load_font(36)
    font_header = load_font(40)
    font_label = load_font(38)
    font_num = load_font(28)

    black = (0, 0, 0)

    # ─── Caixas ───
    d.rectangle(ALUNO_BOX, outline=black, width=2)
    d.text((95, 161), "Aluno (a):", fill=black, font=font_label)
    if student_name:
        max_w = ALUNO_BOX[2] - STUDENT_NAME_X - 10
        name, name_font = _fit_text(d, student_name.strip(), max_w, start_size=38)
        d.text((STUDENT_NAME_X, 161), name, fill=black, font=name_font)
    if student_matricula:
        mat_x = 320
        max_w = TURMA_BOX[2] - mat_x - 10
        mat, mat_font = _fit_text(d, f"Matrícula: {student_matricula}", max_w, start_size=34)
        d.text((mat_x, 254), mat, fill=black, font=mat_font)

    d.rectangle(TURMA_BOX, outline=black, width=2)
    d.text((95, 254), "Turma:", fill=black, font=font_label)

    # ─── Títulos ───
    if single:
        bbox = d.textbbox((0, 0), subject_lp, font=font_title)
        tw = bbox[2] - bbox[0]
        d.text((SINGLE_TITLE_CENTER_X - tw // 2, TITLE_Y - 18), subject_lp, fill=black, font=font_title)
    else:
        bbox = d.textbbox((0, 0), subject_lp, font=font_title)
        tw = bbox[2] - bbox[0]
        d.text((TITLE_PORT_X - tw // 2, TITLE_Y - 18), subject_lp, fill=black, font=font_title)

        bbox = d.textbbox((0, 0), subject_mat, font=font_title)
        tw = bbox[2] - bbox[0]
        d.text((TITLE_MAT_X - tw // 2, TITLE_Y - 18), subject_mat, fill=black, font=font_title)

    # ─── Headers A B C D ───
    for i, letter in enumerate(LETTERS):
        bbox = d.textbbox((0, 0), letter, font=font_header)
        lw = bbox[2] - bbox[0]
        if single:
            d.text((int(SINGLE_X[i]) - lw // 2, HEADER_Y - 20), letter, fill=black, font=font_header)
        else:
            d.text((PORT_X[i] - lw // 2, HEADER_Y - 20), letter, fill=black, font=font_header)
            d.text((MAT_X[i] - lw // 2, HEADER_Y - 20), letter, fill=black, font=font_header)

    # ─── Divisor (apenas modo duplo) ───
    if not single:
        d.line([(DIVIDER_X, DIVIDER_Y0), (DIVIDER_X, DIVIDER_Y1)], fill=black, width=5)

    # ─── Questões e bolhas ───
    for q, y in enumerate(question_y):
        q_str = str(q + 1)

        bbox = d.textbbox((0, 0), q_str, font=font_num)
        nw = bbox[2] - bbox[0]

        if single:
            d.text((num_x - nw // 2, int(y) - 14), q_str, fill=black, font=font_num)
            for x in xs:
                d.ellipse([x - radius, y - radius, x + radius, y + radius],
                          outline=black, width=3)
        else:
            # Português (coluna esquerda)
            d.text((PORT_NUM_X - nw // 2, int(y) - 14), q_str, fill=black, font=font_num)
            for x in PORT_X:
                d.ellipse([x - BUBBLE_RADIUS, y - BUBBLE_RADIUS, x + BUBBLE_RADIUS, y + BUBBLE_RADIUS],
                          outline=black, width=3)
            # Matemática (coluna direita)
            d.text((MAT_NUM_X - nw // 2, int(y) - 14), q_str, fill=black, font=font_num)
            for x in MAT_X:
                d.ellipse([x - BUBBLE_RADIUS, y - BUBBLE_RADIUS, x + BUBBLE_RADIUS, y + BUBBLE_RADIUS],
                          outline=black, width=3)

    # ─── Identificação do aluno (cartão personalizado) ───
    if student_id:
        d.text(ID_TEXT_POS, f"ID: {student_id}", fill=black, font=font_num)
        try:
            qr_img = make_qr_image(student_id)
            qx = QR_CENTER[0] - QR_SIZE // 2
            qy = QR_CENTER[1] - QR_SIZE // 2
            pil.paste(qr_img, (qx, qy))
        except ImportError:
            pass  # biblioteca qrcode não instalada — cartão sai apenas com o ID textual

    return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)


def generate_card_png(output_path: str | Path, **kw) -> Path:
    img = generate_card(**kw)
    p = Path(output_path); p.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(p), img); return p


def generate_card_pdf(output_path: str | Path, **kw) -> Path:
    img = generate_card(**kw)
    pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    p = Path(output_path); p.parent.mkdir(parents=True, exist_ok=True)
    pil.save(str(p), "PDF", resolution=300.0); return p


def generate_card_bytes(fmt: str = "PNG", **kw) -> bytes:
    img = generate_card(**kw)
    pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    buf = io.BytesIO(); pil.save(buf, format=fmt); return buf.getvalue()


def build_batch_pdf(
    students: list[dict],
    subject_lp: str,
    subject_mat: str,
    out_buf: io.BytesIO,
    questions_per_subject: int | None = None,
    layout_mode: str = LAYOUT_DUAL,
) -> int:
    """
    Gera 1 página por aluno em um único PDF (reportlab, baixo uso de memória).

    students: lista de dicts {codigo, nome, matricula?} — SEMPRE vindos do banco.
    Retorna a quantidade de páginas gravadas.
    """
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas as pdf_canvas
    from reportlab.lib.utils import ImageReader

    pages_drawn = 0
    buf = out_buf
    c = pdf_canvas.Canvas(buf, pagesize=A4)
    w_pt, h_pt = A4

    for s in students:
        card = generate_card(
            subject_lp, subject_mat,
            student_name=s["nome"],
            student_id=s["codigo_unico"],
            student_matricula=s.get("matricula"),
            questions_per_subject=questions_per_subject,
            layout_mode=layout_mode,
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


TEMPLATE_COORDS = {
    "page_w": PAGE_W, "page_h": PAGE_H,
    "aruco_centers": {str(k): list(v) for k, v in ARUCO_CENTERS.items()},
    "aruco_size": ARUCO_SIZE, "aruco_ids": ARUCO_IDS,
    "bubble_radius": BUBBLE_RADIUS,
    "question_y": QUESTION_Y,
    "port_x": PORT_X, "mat_x": MAT_X,
    "port_num_x": PORT_NUM_X, "mat_num_x": MAT_NUM_X,
    "questions_per_subject": QUESTIONS_PER_SUBJECT,
    "qr_size": QR_SIZE, "qr_center": list(QR_CENTER),
    "student_name_x": STUDENT_NAME_X, "id_text_pos": list(ID_TEXT_POS),
}


if __name__ == "__main__":
    out = Path(__file__).parent / "output"
    generate_card_png(out / "gabarito.png")
    generate_card_pdf(out / "gabarito.pdf")
    print(f"Gerado: {out / 'gabarito.png'}")
