"""Contrato: ProcessResponse nunca remove campo (evolução segura p/ o app).

O app mapeia snake_case → camelCase; remover/renomear campo quebra o
frontend em produção silenciosamente. Este teste trava o contrato.

Executar: python -m pytest test_contract.py -q
"""
import cv2
import numpy as np

from omr.template import generate_card, QUESTION_Y, PORT_X, BUBBLE_RADIUS
from conftest import TEST_PASSWORD

# Campos obrigatórios do contrato (cada um é mapeado no app/utils/api.ts).
# n_frames/debug_images são opcionais por resposta (só com multi-frame/debug),
# mas a CHAVE deve existir — ausência quebra o mapeamento do app.
REQUIRED = {
    "success", "answers", "blank_questions", "duplicate_questions",
    "duplicate_marks", "low_confidence", "all_ratios", "card_id",
    "rectified_image", "template_used", "thresholds_used", "warnings", "error",
    "n_frames", "debug_images",
}


def test_process_response_contract(client):
    c = client
    r = c.post("/api/auth/register", json={"email": "c@example.com", "nome": "C", "password": TEST_PASSWORD})
    if r.status_code == 400:
        r = c.post("/api/auth/login", data={"username": "c@example.com", "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    c.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})

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
    assert not missing, f"CONTRATO QUEBRADO — campo removido/renomeado: {sorted(missing)}"


if __name__ == "__main__":
    import pytest as _pytest
    import sys as _sys
    _sys.exit(_pytest.main([__file__, "-q"]))
