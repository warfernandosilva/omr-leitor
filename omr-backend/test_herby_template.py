"""
Gabarito Herby — template: geração, geometria, QRs duplos e lote.
"""
import sys
sys.path.insert(0, '.')
import os
import tempfile
import io

_tmp = tempfile.mkdtemp(prefix="omr_herby_tpl_")
os.environ["OMR_DB_PATH"] = os.path.join(_tmp, "t.db")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import cv2
from omr.template_herby import (
    generate_herby_card, build_herby_batch_pdf, HerbySpec,
    herby_rows_for, herby_row_ys, herby_block_rows, herby_bubble_center,
    normalize_herby_qr, herby_magic_link,
    HERBY_COLS_X, HERBY_Y0, HERBY_Y1, HERBY_COORDS,
    HERBY_QR_HEAD_POS, HERBY_QR_HEAD_SIZE, HERBY_QR_FOOT_POS, HERBY_QR_FOOT_SIZE,
)
from omr.reader import _decode_qr_from

PASS = []
FAIL = []


def check(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(f"   {'PASS' if cond else 'FAIL'}  {name} {extra}")


# geometria: 22+22 em 11 fileiras por subcoluna
check("rows(22)=11", herby_rows_for(22) == 11)
check("rows(1)=1", herby_rows_for(1) == 1)
check("rows(26)=13", herby_rows_for(26) == 13)
ys = herby_row_ys(22)
check("faixa y 650..1785", abs(ys[0] - 650) < 1 and abs(ys[-1] - 1785) < 1, f"{ys[0]}, {ys[-1]}")
qs = list(herby_block_rows(22))
check("44 questoes no bloco", len(qs) == 44, f"n={len(qs)}")
check("LP=1..22 MAT=23..44", min(q for q, _, _ in qs) == 1 and max(q for q, _, _ in qs) == 44)
cx, cy = herby_bubble_center(0, 0, 0)
check("origem coerente", abs(cx - (HERBY_COLS_X[0] + 16 + 20)) < 1 and abs(cy - HERBY_Y0) < 1)

# normalização QR (URL Herby real + ID puro + nosso código)
check("url herby → id", normalize_herby_qr("https://hby.app?i4=GEW6rmMbj6oE") == "GEW6rmMbj6oE")
check("id puro intacto", normalize_herby_qr("i4=GEW6rmMbj6oE") == "GEW6rmMbj6oE")
check("codigo nosso intacto", normalize_herby_qr("OMR-2026-000001") == "OMR-2026-000001")
check("magic link vazio = codigo", herby_magic_link("OMR-2026-7") == "OMR-2026-7")
check("magic link com base", herby_magic_link("OMR-2026-7", "https://omr.exemplo") == "https://omr.exemplo?codigo=OMR-2026-7")

# cartão gerado: QRs decodificáveis nas posições do template
img = generate_herby_card(HerbySpec(n_questoes=22), student_name="ALUNA X", qr_override="OMR-2026-000042")
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
hx, hy = HERBY_QR_HEAD_POS
head = gray[hy - 20:hy + HERBY_QR_HEAD_SIZE + 20, hx - 20:hx + HERBY_QR_HEAD_SIZE + 20]
fx, fy = HERBY_QR_FOOT_POS
foot = gray[fy - 15:fy + HERBY_QR_FOOT_SIZE + 15, fx - 15:fx + HERBY_QR_FOOT_SIZE + 15]
got_head = _decode_qr_from(head)
got_foot = _decode_qr_from(foot)
check("QR cabeca decodifica", got_head == "OMR-2026-000042", repr(got_head))
check("QR rodape decodifica", got_foot == "OMR-2026-000042", repr(got_foot))

# magic_base no cartão
img2 = generate_herby_card(HerbySpec(magic_base="https://omr.exemplo"), qr_override="OMR-2026-5")
gray2 = cv2.cvtColor(img2, cv2.COLOR_BGR2GRAY)
head2 = gray2[hy - 20:hy + HERBY_QR_HEAD_SIZE + 20, hx - 20:hx + HERBY_QR_HEAD_SIZE + 20]
got2 = _decode_qr_from(head2)
check("QR cabeca magic link", got2 == "https://omr.exemplo?codigo=OMR-2026-5", repr(got2))
check("normaliza magic nosso", normalize_herby_qr(got2 or "") == "OMR-2026-5")

# qps variável: 5 e 26 geram sem erro, contagens certas
for qps in (1, 5, 26):
    im = generate_herby_card(HerbySpec(n_questoes=qps), qr_override="OMR-2026-1")
    n = len(list(herby_block_rows(qps)))
    check(f"qps={qps}: {n} questoes", n == 2 * max(1, min(26, qps)) and im.shape == (2048, 1448, 3))

# lote: 2 alunos → 2 páginas
buf = io.BytesIO()
n = build_herby_batch_pdf(
    [{"codigo_unico": "OMR-2026-000001", "nome": "ALUNA UM"},
     {"codigo_unico": "OMR-2026-000002", "nome": "ALUNO DOIS"}],
    HerbySpec(), buf)
check("lote 2 paginas", n == 2, f"n={n}")

# coords expostas
check("HERBY_COORDS chaves", set(HERBY_COORDS) >= {"cols_x", "pitch", "side", "y0", "y1", "qr_head_pos", "qr_foot_pos", "min_qps", "max_qps"})
check("min/max 1..26", HERBY_COORDS["min_qps"] == 1 and HERBY_COORDS["max_qps"] == 26)

from fastapi.testclient import TestClient
import main as M
c = TestClient(M.app)
r = c.get("/api/template/herby-coords")
check("GET herby-coords 200", r.status_code == 200 and r.json()["pitch"] == 40, f"status={r.status_code}")

print(f"HERBY TEMPLATE: {len(PASS)} pass, {len(FAIL)} fail")
sys.exit(1 if FAIL else 0)
