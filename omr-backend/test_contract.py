"""Contrato: ProcessResponse nunca remove campo (evolução segura p/ o app).

O app mapeia snake_case → camelCase; remover/renomear campo quebra o
frontend em produção silenciosamente. Este teste trava o contrato.
"""
import sys
import os
import tempfile

sys.path.insert(0, '.')
_tmp = tempfile.mkdtemp(prefix="omr_contract_")
os.environ["OMR_DB_PATH"] = os.path.join(_tmp, "contract.db")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from fastapi.testclient import TestClient
import main as main_module

# Campos obrigatórios do contrato (cada um é mapeado no app/utils/api.ts).
# n_frames/debug_images são opcionais por resposta (só com multi-frame/debug),
# mas a CHAVE deve existir — ausência quebra o mapeamento do app.
REQUIRED = {
    "success", "answers", "blank_questions", "duplicate_questions",
    "duplicate_marks", "low_confidence", "all_ratios", "card_id",
    "rectified_image", "template_used", "thresholds_used", "warnings", "error",
    "n_frames", "debug_images",
}

c = TestClient(main_module.app)
r = c.post("/api/auth/register", json={"email": "c@example.com", "nome": "C", "password": "123456"})
if r.status_code == 400:
    r = c.post("/api/auth/login", data={"username": "c@example.com", "password": "123456"})
assert r.status_code == 200, r.text
c.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})

import cv2
import numpy as np
from omr.template import generate_card, QUESTION_Y, PORT_X, BUBBLE_RADIUS

card = generate_card()
for q in range(22):
    cx, cy = PORT_X[q % 4], int(QUESTION_Y[q])
    cv2.circle(card, (int(cx), cy), int(BUBBLE_RADIUS) - 2, (0, 0, 0), -1)
_, buf = cv2.imencode('.png', card)

resp = c.post("/api/omr/process", files={"file": ("card.png", buf.tobytes(), "image/png")},
              data={"questions_per_subject": "22", "layout_mode": "dual", "template": "padrao"})
assert resp.status_code == 200, resp.text
keys = set(resp.json().keys())

missing = REQUIRED - keys
print(f"campos no contrato: {len(REQUIRED)} | presentes: {len(keys & REQUIRED)} | ausentes: {sorted(missing) or 'nenhum'}")
if missing:
    print("CONTRATO QUEBRADO — campo removido/renomeado:", sorted(missing))
    sys.exit(1)
extra = keys - REQUIRED
print(f"extras (ok, novos): {sorted(extra) or 'nenhum'}")
print("CONTRATO OK")
