"""
Sanity pós-leitura: duplicadas fantasmas bloqueiam; brancas viram aviso.

1. Unidade: 27 dups/44 -> reject; low/blank -> ok com warnings; limpo -> ok.
2. Integração: foto real de layout ANTIGO (WhatsApp 18.21.48, 10Q) processada
   no template atual deve ser REJEITADA (era o caso que salvava lixo).
3. Não bloquear leituras legítimas: e2e dos 4 modelos continua verde.
"""
import sys
sys.path.insert(0, '.')
import os

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from omr.sanity import sanity_check, DUP_MAX_FRAC


def check(name: str, cond: bool, detail: str = ""):
    print(f"   {'OK ' if cond else 'FALHA'} {name} {detail}")
    if not cond:
        check.failed = True


check.failed = False

# ─── 1. Unidade ───
s = sanity_check(list(range(1, 28)), [40, 41, 42, 43, 44], [1, 2], 44)
check("27 dups/44: reject", not s.ok, s.message or "")
check("reject: mensagem orienta modelo/versão", "modelo" in (s.message or ""))

s2 = sanity_check([], [40, 41, 42, 43, 44, 43, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6], [5], 44)
check("brancas+low: NÃO bloqueia", s2.ok)
check("brancas >= 50%: aviso", any("em branco" in w for w in s2.warnings), str(s2.warnings))

s3 = sanity_check([], [], [], 44)
check("leitura limpa: ok sem warnings", s3.ok and not s3.warnings)

s4 = sanity_check([3, 7], [], [], 44)
check("2 dups (reais): ok sem warnings", s4.ok and not s4.warnings)

# ─── 2. Integração: foto real de layout antigo ───
import cv2
from omr.reader import process_image

foto = "calibration/WhatsApp Image 2026-09-18 at 18.21.48.jpeg"
img = cv2.imread(foto)
if img is None:
    # Sem a foto real (ex.: CI limpo): fixture SINTÉTICA equivalente —
    # cartão com 27 duplas marcadas (fantasma de layout antigo) deve REJEITAR.
    from omr.template import generate_card, MAT_X
    ghost = generate_card()
    for q in range(22):
        cv2.circle(ghost, (int(PORT_X[0]), int(QUESTION_Y[q])), 17, (0, 0, 0), -1)
        cv2.circle(ghost, (int(PORT_X[1]), int(QUESTION_Y[q])), 17, (0, 0, 0), -1)
    for q in range(5):
        cv2.circle(ghost, (int(MAT_X[0]), int(QUESTION_Y[q])), 17, (0, 0, 0), -1)
        cv2.circle(ghost, (int(MAT_X[1]), int(QUESTION_Y[q])), 17, (0, 0, 0), -1)
    r = process_image(ghost, questions_per_subject=22, layout_mode="dual")
    if r is None:
        check("fantasma sintético 27 duplas: bloqueado antes (pipeline None)", True)
    else:
        s5 = sanity_check(
            r.duplicate_questions, r.blank_questions, r.low_confidence,
            len(r.blank_questions) + len(r.duplicate_questions) + len(r.answers),
        )
        check("fantasma sintético 27 duplas: REJEITADO pelo sanity (não salva lixo)", not s5.ok,
              f"dups={len(r.duplicate_questions)}")
else:
    r = process_image(img, questions_per_subject=22, layout_mode="dual")
    if r is None:
        check("layout antigo: bloqueado antes (pipeline None)", True)
    else:
        s5 = sanity_check(
            r.duplicate_questions, r.blank_questions, r.low_confidence,
            len(r.blank_questions) + len(r.duplicate_questions) + len(r.answers),
        )
        check("layout antigo: REJEITADA pelo sanity (não salva lixo)", not s5.ok,
              f"dups={len(r.duplicate_questions)} frac={len(r.duplicate_questions)/44:.0%}")

# ─── 3. Leituras legítimas não bloqueiam ───
from omr.template import generate_card, QUESTION_Y, PORT_X, BUBBLE_RADIUS
from omr.template_saev import SaevSpec, generate_saev_card, saev_block_rows, saev_bubble_center, SAEV_SIDE
from omr.reader_saev import process_saev_image


def fill(img, x, y, radius=BUBBLE_RADIUS):
    cv2.circle(img, (int(x), int(y)), int(radius) - 2, (0, 0, 0), -1)


half_card = generate_card()
for q in range(22):
    fill(half_card, PORT_X[q % 4], int(QUESTION_Y[q]))
r6 = process_image(half_card)
assert r6 is not None
s6 = sanity_check(
    r6.duplicate_questions, r6.blank_questions, r6.low_confidence,
    len(r6.blank_questions) + len(r6.duplicate_questions) + len(r6.answers),
)
check("padrão 22 marcadas: ok", s6.ok, f"dups={len(r6.duplicate_questions)}")

saev = generate_saev_card(SaevSpec(n_questoes=22), student_name="X")
half = int(SAEV_SIDE / 2) - 6
for q, col, rr in saev_block_rows(22):
    cx, cy = saev_bubble_center(col, rr, (q * 7 + 2) % 4, 22)
    cx, cy = int(cx), int(cy)
    cv2.rectangle(saev, (cx - half, cy - half), (cx + half, cy + half), (20, 20, 20), -1)
r7 = process_saev_image(saev, questions_per_subject=22, adaptive=True)
assert r7 is not None
s7 = sanity_check(
    r7.duplicate_questions, r7.blank_questions, r7.low_confidence,
    len(r7.blank_questions) + len(r7.duplicate_questions) + len(r7.answers),
)
check("SAEV 44 marcadas: ok", s7.ok, f"dups={len(r7.duplicate_questions)}")

print("\nSANITY:", "PASS" if not check.failed else "FAIL")
sys.exit(1 if check.failed else 0)
