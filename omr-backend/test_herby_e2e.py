"""
Herby e2e: detector (QRs+borda) + reader (quadrados) + QR normalizado.
"""
import sys
sys.path.insert(0, '.')

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import cv2
import numpy as np
from omr.template_herby import (
    generate_herby_card, HerbySpec, herby_block_rows, herby_bubble_center,
    HERBY_SIDE, normalize_herby_qr,
)
from omr.detector_herby import detect_herby_anchors, herby_homography
from omr.reader_herby import process_herby_image

PASS = []
FAIL = []


def check(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(f"   {'PASS' if cond else 'FAIL'}  {name} {extra}")


COD = "OMR-2026-000077"
img = generate_herby_card(HerbySpec(n_questoes=22), student_name="HERBY UM", qr_override=COD)

det = detect_herby_anchors(img)
# cartão borderless (sem fundo): só os QRs ancoram; 'page' é bônus de foto real
check("ancoras via QRs (page é bônus)", det.found and det.missing == ["page"], str(det.missing))
check("QRs decodificados na deteccao",
      det.qr_data.get("qr_head") == COD and det.qr_data.get("qr_foot") == COD, str(det.qr_data))
M = herby_homography(det)
check("homografia valida", M is not None and M.shape == (3, 3))

# marca A em tudo (LP) + C em tudo (MAT)
half = int(HERBY_SIDE / 2) - 6
for q, col, r in herby_block_rows(22):
    alt = 0 if q <= 22 else 2
    cx, cy = herby_bubble_center(col, r, alt, 22)
    cv2.rectangle(img, (int(cx) - half, int(cy) - half), (int(cx) + half, int(cy) + half), (10, 10, 10), -1)

res = process_herby_image(img, questions_per_subject=22)
check("pipeline ok", res is not None)
check("qr normalizado", res.qr_id == COD if res else False, repr(res.qr_id if res else None))
ok_lp = sum(1 for q in range(1, 23) if res.answers.get(q) == "A") if res else 0
ok_mat = sum(1 for q in range(23, 45) if res.answers.get(q) == "C") if res else 0
check("LP=A 22/22", ok_lp == 22, f"{ok_lp}/22")
check("MAT=C 22/22", ok_mat == 22, f"{ok_mat}/22")

# cartão em branco: tudo blank, sem duplicada
blank_img = generate_herby_card(HerbySpec(n_questoes=22), qr_override=COD)
rb = process_herby_image(blank_img, questions_per_subject=22)
check("branco: 44 blanks", rb is not None and len(rb.blank_questions) == 44 and not rb.duplicate_questions,
      f"b={len(rb.blank_questions) if rb else '?'}" if rb else "None")

# foto com fundo (simula papel sobre a mesa): borda da página ancora junto
bg = np.full((2400, 1700, 3), 120, dtype=np.uint8)
bg[150:150 + 2048, 120:120 + 1448] = img
det_bg = detect_herby_anchors(bg)
check("com fundo: page ancora junto", det_bg.found and "page" not in det_bg.missing, str(det_bg.missing))
res_bg = process_herby_image(bg, questions_per_subject=22)
check("com fundo: qr", res_bg is not None and res_bg.qr_id == COD,
      repr(res_bg.qr_id if res_bg else None))

# foto torta simulada ainda ancora
h, w = img.shape[:2]
src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
dst = (src + np.array([[-30, 20], [40, 30], [-25, -35], [35, -25]], dtype=np.float32)).astype(np.float32)
M2 = cv2.getPerspectiveTransform(src, dst)
tilt = cv2.warpPerspective(img, M2, (w, h), borderValue=(255, 255, 255))
det2 = detect_herby_anchors(tilt)
check("foto torta: ancoras", det2.found, str(det2.missing))
res2 = process_herby_image(tilt, questions_per_subject=22)
check("foto torta: qr", res2 is not None and res2.qr_id == COD,
      repr(res2.qr_id if res2 else None))

print(f"HERBY E2E: {len(PASS)} pass, {len(FAIL)} fail")
sys.exit(1 if FAIL else 0)
