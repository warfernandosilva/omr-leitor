"""
Anti-travamento SAEV: foto "suja" (muitos quadriláteros) não pode pendurar
a API. Antes do orçamento no _pick_four, C(80,4)=1.5M combos em Python
puro travava o worker por minutos (UI congelava nos 50%).

Cenário: cartão gerado + degradação de celular + distratores quadrados
(caixas de texto, finders de QR, sujeira) forçando dezenas de candidatos.
Assert de TEMPO (<20s p/ o pipeline) além do acerto.
"""
import sys
sys.path.insert(0, '.')
import time
import cv2
import numpy as np
from omr.template_saev import (
    SaevSpec, generate_saev_card, saev_block_rows, saev_bubble_center,
    SAEV_SIDE, SAEV_CORNER_CENTERS, SAEV_COLS_X, SAEV_NUM_W, SAEV_PITCH,
    SAEV_Y0, SAEV_Y1,
)
from omr.reader_saev import process_saev_image

QPS = 22
N = QPS * 2
BUDGET = 8.0  # era 57s antes do _pick_four vetorizado; pipeline faz ~0.2s local


def check(name: str, cond: bool, detail: str = ""):
    print(f"   {'OK ' if cond else 'FALHA'} {name} {detail}")
    if not cond:
        check.failed = True


check.failed = False
rng = np.random.default_rng(7)


def degrade(img, seed=7):
    r = np.random.default_rng(seed)
    h, w = img.shape[:2]
    n = img.astype(np.int16) + r.integers(-12, 13, (h, w, 3), dtype=np.int16)
    n = np.clip(n, 0, 255).astype(np.uint8)
    n = cv2.GaussianBlur(n, (3, 3), 0.8)
    _, buf = cv2.imencode('.jpg', n, [int(cv2.IMWRITE_JPEG_QUALITY), 55])
    return cv2.imdecode(buf, cv2.IMREAD_COLOR)


# Bbox da grade (não cobrir as respostas: o teste é sobre CANDIDATOS
# falsos, não sobre destruir as marcas)
_gxs = [c + SAEV_NUM_W + i * SAEV_PITCH for c in SAEV_COLS_X for i in range(4)]
GRID = (min(_gxs) - 60, SAEV_Y0 - 60, max(_gxs) + 60, SAEV_Y1 + 60)


def in_grid(cx, cy):
    x0, y0, x1, y1 = GRID
    return x0 <= cx <= x1 and y0 <= cy <= y1


def distract(img):
    """Espalha quadriláteros falsos nas margens (preserva âncoras e grade)."""
    out = img.copy()
    h, w = out.shape[:2]
    safe = [(x, y) for x, y in SAEV_CORNER_CENTERS.values()]
    placed = 0
    tries = 0
    while placed < 45 and tries < 2000:
        tries += 1
        cx, cy = int(rng.integers(0, w)), int(rng.integers(0, h))
        if min(abs(cx - sx) + abs(cy - sy) for sx, sy in safe) < 200:
            continue
        if in_grid(cx, cy):
            continue
        s = int(rng.integers(15, 90))
        color = (0, 0, 0) if rng.random() < 0.5 else (255, 255, 255)
        thick = -1 if rng.random() < 0.4 else int(rng.integers(2, 6))
        cv2.rectangle(out, (cx - s, cy - s), (cx + s, cy + s), color, thick)
        placed += 1
    return out


# 1. Cartão marcado + sujeira + degradação: tem que achar e ler RÁPIDO
card = generate_saev_card(SaevSpec(n_questoes=QPS), student_name="ALUNA SUJA")
half = int(SAEV_SIDE / 2) - 6
expected = {}
for q, col, r in saev_block_rows(QPS):
    letter = "ABCD"[(q * 7 + 2) % 4]
    expected[q] = letter
    cx, cy = saev_bubble_center(col, r, "ABCD".index(letter), QPS)
    cx, cy = int(cx), int(cy)
    cv2.rectangle(card, (cx - half, cy - half), (cx + half, cy + half), (20, 20, 20), -1)

busy = degrade(distract(card), seed=99)

t0 = time.perf_counter()
res = process_saev_image(busy, questions_per_subject=QPS, adaptive=True)
dt = time.perf_counter() - t0
assert res is not None, "pipeline retornou None na foto suja"
check("foto suja: âncoras achadas", True, f"{dt:.1f}s")
check(f"foto suja: pipeline < {BUDGET:.0f}s", dt < BUDGET, f"{dt:.1f}s")
ok = sum(1 for q, l in expected.items() if res.answers.get(q) == l)
check("foto suja: acerto >= 40/44", ok >= 40, f"{ok}/{N}")

# 2. Foto suja SEM cartão (só distratores): tem que FALHAR RÁPIDO, não travar
noise = np.full((1200, 900, 3), 200, dtype=np.uint8)
noise = degrade(distract(noise), seed=5)
t0 = time.perf_counter()
res2 = process_saev_image(noise, questions_per_subject=QPS)
dt2 = time.perf_counter() - t0
check(f"sem cartão: retorna None < {BUDGET:.0f}s", res2 is None and dt2 < BUDGET, f"{dt2:.1f}s")

print("\nSAEV BUSY:", "PASS" if not check.failed else "FAIL")
sys.exit(1 if check.failed else 0)
