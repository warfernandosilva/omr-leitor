"""
Regressão: branco de "Android ruim" não pode virar duplicada.

Simula foto de celular inferior: ruído de sensor + blur leve + JPEG
recomprimido + luz desigual. Cartão em branco (ou meio-preenchido) deve
sair com ZERO duplicadas; duplicada real continua sendo detectada.
"""
import sys
sys.path.insert(0, '.')
import cv2
import numpy as np
from omr.template import (
    generate_card, QUESTION_Y, BUBBLE_RADIUS, PORT_X, MAT_X,
    QUESTIONS_PER_SUBJECT,
)
from omr.template_sae import generate_sae_card, SaeSpec
from omr.reader import process_image
from omr.reader_sae import process_sae_image


def degrade_android(img: np.ndarray, seed: int = 7) -> np.ndarray:
    """Degradação típica de aparelho simples: ruído + blur + JPEG + sombra."""
    rng = np.random.default_rng(seed)
    h, w = img.shape[:2]
    noisy = img.astype(np.int16) + rng.integers(-12, 13, (h, w, 3), dtype=np.int16)
    noisy = np.clip(noisy, 0, 255).astype(np.uint8)
    noisy = cv2.GaussianBlur(noisy, (3, 3), 0.8)
    # luz desigual: gradiente vertical escurecendo a base
    shade = (np.linspace(0, 25, h, dtype=np.float32))[:, None, None]
    noisy = np.clip(noisy.astype(np.float32) - shade, 0, 255).astype(np.uint8)
    _, buf = cv2.imencode('.jpg', noisy, [int(cv2.IMWRITE_JPEG_QUALITY), 55])
    return cv2.imdecode(buf, cv2.IMREAD_COLOR)


def degrade_android_forte(img: np.ndarray, seed: int = 11) -> np.ndarray:
    """Aparelho simples em sala mal iluminada: o código antigo gerava
    duplicadas fantasmas aqui (Q22, Q44 na sombra da base)."""
    rng = np.random.default_rng(seed)
    h, w = img.shape[:2]
    noisy = img.astype(np.int16) + rng.integers(-30, 31, (h, w, 3), dtype=np.int16)
    noisy = np.clip(noisy, 0, 255).astype(np.uint8)
    noisy = cv2.GaussianBlur(noisy, (5, 5), 1.0)
    shade = (np.linspace(0, 60, h, dtype=np.float32))[:, None, None]
    noisy = np.clip(noisy.astype(np.float32) - shade, 0, 255).astype(np.uint8)
    _, buf = cv2.imencode('.jpg', noisy, [int(cv2.IMWRITE_JPEG_QUALITY), 45])
    return cv2.imdecode(buf, cv2.IMREAD_COLOR)


def fill(img, x, y, radius=BUBBLE_RADIUS):
    cv2.circle(img, (int(x), int(y)), int(radius) - 2, (0, 0, 0), -1)


def check(name: str, cond: bool, detail: str = ""):
    print(f"   {'OK ' if cond else 'FALHA'} {name} {detail}")
    if not cond:
        check.failed = True


check.failed = False

# 1. Padrão totalmente em branco + degradação -> 44 brancas, 0 duplicadas
blank = degrade_android(generate_card())
r = process_image(blank)
assert r is not None, "process_image retornou None no branco degradado"
check("padrao branco: 0 duplicadas", r.duplicate_questions == [], str(r.duplicate_questions))
check("padrao branco: 44 em branco", len(r.blank_questions) == 44, str(len(r.blank_questions)))

# 2. Padrão meio-preenchido (LP toda marcada, MAT em branco) + degradação
half = generate_card()
letters = ["A", "B", "C", "D"]
for q in range(QUESTIONS_PER_SUBJECT):
    fill(half, PORT_X[q % 4], int(QUESTION_Y[q]))
r2 = process_image(degrade_android(half, seed=21))
assert r2 is not None, "process_image retornou None no meio-preenchido"
mat_dups = [q for q in r2.duplicate_questions if q > QUESTIONS_PER_SUBJECT]
check("padrao MAT branca: 0 duplicadas", mat_dups == [], str(mat_dups))
mat_blank = [q for q in r2.blank_questions if q > QUESTIONS_PER_SUBJECT]
check("padrao MAT branca: 22 em branco", len(mat_blank) == 22, str(sorted(set(range(23, 45)) - set(mat_blank))))

# 3. Duplicada REAL continua sendo detectada (LP Q1 = A+B)
dup = generate_card()
fill(dup, PORT_X[0], int(QUESTION_Y[0]))
fill(dup, PORT_X[1], int(QUESTION_Y[0]))
r3 = process_image(degrade_android(dup, seed=33))
assert r3 is not None, "process_image retornou None na duplicada real"
check("padrao duplicada real Q1 detectada", 1 in r3.duplicate_questions,
      f"dups={r3.duplicate_questions} low={r3.low_confidence}")

# 4. SAE em branco + degradação -> 0 duplicadas
sae_blank = degrade_android(generate_sae_card(SaeSpec()))
r4 = process_sae_image(sae_blank, n_questions=26)
assert r4 is not None, "process_sae_image retornou None no branco degradado"
check("sae branco: 0 duplicadas", r4.duplicate_questions == [], str(r4.duplicate_questions))

# 5. Padrão em branco + degradação FORTE (sombra na base) -> 0 duplicadas
forte = degrade_android_forte(generate_card())
r5 = process_image(forte)
assert r5 is not None, "process_image retornou None no branco forte"
check("padrao branco forte: 0 duplicadas", r5.duplicate_questions == [], str(r5.duplicate_questions))
check("padrao branco forte: 44 em branco", len(r5.blank_questions) == 44, str(len(r5.blank_questions)))

print("\nREGRESSAO DUP:", "PASS" if not check.failed else "FAIL")
sys.exit(1 if check.failed else 0)
