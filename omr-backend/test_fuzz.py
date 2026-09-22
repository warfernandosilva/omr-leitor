"""
Fuzz nos detectores: distratores aleatórios (seed fixa) para os 4 modelos.

Replica a lógica do test_saev_busy p/ Padrão, SAE e Colar, com asserts
de TEMPO além do acerto. O SAEV já tem o próprio (test_saev_busy).
"""
import sys
sys.path.insert(0, '.')
import time
import cv2
import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from omr.template import generate_card, QUESTION_Y, PORT_X, MAT_X, BUBBLE_RADIUS, ARUCO_CENTERS
from omr.template_sae import generate_sae_card, SaeSpec, CORNER_CENTERS as SAE_CORNERS
from omr.template_saev import (
    SaevSpec, generate_saev_card, saev_block_rows, saev_bubble_center,
    SAEV_SIDE, SAEV_CORNER_CENTERS, SAEV_NUM_W, SAEV_COLS_X, SAEV_Y0, SAEV_Y1,
)
from omr.reader import process_image
from omr.reader_sae import process_sae_image
from omr.reader_saev import process_saev_image

BUDGET = 15.0
PASS, FAIL = [], []


def check(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(f"   {'OK ' if cond else 'FALHA'}  {name} {extra}")


def degrade(img, seed=7):
    r = np.random.default_rng(seed)
    h, w = img.shape[:2]
    n = img.astype(np.int16) + r.integers(-12, 13, (h, w, 3), dtype=np.int16)
    n = np.clip(n, 0, 255).astype(np.uint8)
    n = cv2.GaussianBlur(n, (3, 3), 0.8)
    _, buf = cv2.imencode('.jpg', n, [int(cv2.IMWRITE_JPEG_QUALITY), 55])
    return cv2.imdecode(buf, cv2.IMREAD_COLOR)


def distract(img, anchors, n_distract=40, seed=7, avoid=None):
    """Espalha quadriláteros falsos (preserva âncoras e grade).

    Zona de proteção das âncoras: centro a ≥280px (euclidiano) de cada
    âncora — distratores não invadem a zona quieta do marcador (conteúdo
    SOBRE a âncora = foto rejeitada com erro, comportamento correto;
    o teste de fuzz cobre sujeira espalhada, não âncoras destruídas).
    """
    out = img.copy()
    h, w = out.shape[:2]
    rng = np.random.default_rng(seed)
    placed, tries = 0, 0
    while placed < n_distract and tries < 2000:
        tries += 1
        cx, cy = int(rng.integers(0, w)), int(rng.integers(0, h))
        if min(np.hypot(cx - sx, cy - sy) for sx, sy in anchors) < 280:
            continue
        if avoid and avoid[0] <= cx <= avoid[2] and avoid[1] <= cy <= avoid[3]:
            continue
        s = int(rng.integers(15, 90))
        color = (0, 0, 0) if rng.random() < 0.5 else (255, 255, 255)
        thick = -1 if rng.random() < 0.4 else int(rng.integers(2, 6))
        cv2.rectangle(out, (cx - s, cy - s), (cx + s, cy + s), color, thick)
        placed += 1
    return out


def run_case(name, make_image, reader, kw, expect_ok, n_expected=None):
    img, expected = make_image()
    t0 = time.perf_counter()
    res = reader(img, **kw)
    dt = time.perf_counter() - t0
    if expect_ok:
        if res is None:
            check(f"{name}: detectado", False, f"None em {dt:.1f}s")
            return
        check(f"{name}: pipeline < {BUDGET:.0f}s", dt < BUDGET, f"{dt:.1f}s")
        target = n_expected if n_expected is not None else expected
        if target is not None:
            ok = sum(1 for q, l in target.items() if res.answers.get(q) == l)
            check(f"{name}: acerto >= {int(0.9 * len(target))}/{len(target)}",
                  ok >= 0.9 * len(target), f"{ok}/{len(target)}")
    else:
        check(f"{name}: falha rápida < {BUDGET:.0f}s", res is None and dt < BUDGET, f"{dt:.1f}s")


# ─── Padrão (ArUco) ───
def make_padrao():
    card = generate_card()
    expected = {}
    for q in range(22):
        l = "ABCD"[q % 4]
        expected[q + 1] = l
        cv2.circle(card, (int(PORT_X[q % 4]), int(QUESTION_Y[q])), int(BUBBLE_RADIUS) - 2, (0, 0, 0), -1)
        cv2.circle(card, (int(MAT_X[q % 4]), int(QUESTION_Y[q])), int(BUBBLE_RADIUS) - 2, (0, 0, 0), -1)
    grid = (min(PORT_X) - 60, QUESTION_Y[0] - 60, max(MAT_X) + 60, QUESTION_Y[-1] + 60)
    return degrade(distract(card, list(ARUCO_CENTERS.values()), seed=11, avoid=grid), seed=12), expected


run_case("padrão+suja", make_padrao, process_image,
         {"questions_per_subject": 22, "layout_mode": "dual"}, True)

# ─── SAE ───
def make_sae():
    card = generate_sae_card(SaeSpec())
    expected = {}
    import omr.template_sae as TS
    for q, b, r in TS.sae_block_rows(26):
        l = "ABCD"[(q * 5 + 1) % 4]
        expected[q] = l
        y = TS.SAE_FIRST_ROW_Y + r * TS.SAE_ROW_STEP
        x = TS.SAE_BLOCKS_X[b] + TS.SAE_BUBBLE_DX["ABCD".index(l)]
        cv2.circle(card, (int(x), int(y)), int(TS.SAE_BUBBLE_RADIUS) - 2, (0, 0, 0), -1)
    gx = [TS.SAE_BLOCKS_X[b] + d for b in range(4) for d in TS.SAE_BUBBLE_DX]
    gy = [TS.SAE_FIRST_ROW_Y + r * TS.SAE_ROW_STEP for r in range(7)]
    grid = (min(gx) - 60, min(gy) - 60, max(gx) + 60, max(gy) + 60)
    return degrade(distract(card, list(SAE_CORNERS.values()), seed=21, avoid=grid), seed=22), expected


run_case("sae+suja", make_sae, process_sae_image, {"n_questions": 26}, True)

# ─── SAEV ───
def make_saev():
    card = generate_saev_card(SaevSpec(n_questoes=22), student_name="X")
    expected = {}
    hh = int(SAEV_SIDE / 2) - 6
    for q, col, r in saev_block_rows(22):
        l = "ABCD"[(q * 7 + 2) % 4]
        expected[q] = l
        cx, cy = saev_bubble_center(col, r, "ABCD".index(l), 22)
        cx, cy = int(cx), int(cy)
        cv2.rectangle(card, (cx - hh, cy - hh), (cx + hh, cy + hh), (20, 20, 20), -1)
    gx = [c + SAEV_NUM_W + i * 41 for c in SAEV_COLS_X for i in range(4)]
    grid = (min(gx) - 60, SAEV_Y0 - 60, max(gx) + 60, SAEV_Y1 + 60)
    return degrade(distract(card, list(SAEV_CORNER_CENTERS.values()), seed=31, avoid=grid), seed=32), expected


run_case("saev+suja", make_saev, process_saev_image,
         {"questions_per_subject": 22, "adaptive": True}, True)

# ─── Sem cartão (só distratores): falha rápida nos 3 leitores ───
def make_blank_noise():
    noise = np.full((1200, 900, 3), 200, dtype=np.uint8)
    return degrade(distract(noise, [(600, 300)], seed=41), seed=42), None

run_case("sem cartão/padrão", make_blank_noise, process_image, {}, False)
run_case("sem cartão/sae", make_blank_noise, process_sae_image, {"n_questions": 26}, False)
run_case("sem cartão/saev", make_blank_noise, process_saev_image, {"questions_per_subject": 22}, False)

print(f"\nFUZZ: {len(PASS)} OK | {len(FAIL)} FALHA")
if FAIL:
    print("FALHAS:", FAIL)
    sys.exit(1)
print("FUZZ PASS")
