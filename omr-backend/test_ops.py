"""
Observabilidade: tempos por etapa + stats do buffer.

1. Leitores populam t_detect/t_warp/t_qr/t_score nos 3 modelos.
2. /api/ops/stats agrega o buffer (requer auth).

Executar: python -m pytest test_ops.py -q
"""
import cv2
from fastapi.testclient import TestClient

import main as main_module
from omr.template import generate_card, QUESTION_Y, PORT_X, BUBBLE_RADIUS
from omr.template_saev import SaevSpec, generate_saev_card, saev_block_rows, saev_bubble_center, SAEV_SIDE
from conftest import TEST_PASSWORD


def test_ops_stats(client):
    c = client
    r = c.post("/api/auth/register", json={"email": "ops@example.com", "nome": "Ops", "password": TEST_PASSWORD})
    if r.status_code == 400:
        r = c.post("/api/auth/login", data={"username": "ops@example.com", "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    c.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})

    # /api/ops/stats sem dados (buffer zerado pelo conftest por módulo)
    s0 = c.get("/api/ops/stats")
    assert s0.status_code == 200 and s0.json()["n_calls"] == 0, "stats vazio: 200"

    # stats sem auth -> 401
    s1 = TestClient(main_module.app).get("/api/ops/stats")
    assert s1.status_code == 401, "stats sem auth: 401"

    # correção padrão (foto gerada, padrão) via TestClient
    card = generate_card()
    half = int(BUBBLE_RADIUS) - 2
    for q in range(22):
        cx, cy = PORT_X[q % 4], int(QUESTION_Y[q])
        cv2.circle(card, (int(cx), cy), half, (0, 0, 0), -1)
    _, buf = cv2.imencode('.png', card)
    p1 = c.post("/api/omr/process", files={"file": ("card.png", buf.tobytes(), "image/png")},
                data={"questions_per_subject": "22", "layout_mode": "dual", "template": "padrao"})
    assert p1.status_code == 200 and p1.json().get("success"), \
        f"process padrão: 200: {(p1.json().get('error') or '')[:80]}"

    s2 = c.get("/api/ops/stats").json()
    assert s2["n_calls"] == 1, "stats: 1 chamada"
    rec = s2.get("last") or {}
    assert rec.get("t_total_ms", 0) > 0 and rec.get("t_detect_ms", 0) > 0, \
        f"stats: tempos populados: {rec}"
    assert "nome" not in rec and "answers_map" not in rec, \
        "stats: sem PII (sem nome/answers de conteúdo)"

    # SAEV
    saev = generate_saev_card(SaevSpec(n_questoes=22), student_name="X")
    hh = int(SAEV_SIDE / 2) - 6
    for q, col, rr in saev_block_rows(22):
        cx, cy = saev_bubble_center(col, rr, (q * 7 + 2) % 4, 22)
        cx, cy = int(cx), int(cy)
        cv2.rectangle(saev, (cx - hh, cy - hh), (cx + hh, cy + hh), (20, 20, 20), -1)
    _, buf2 = cv2.imencode('.png', saev)
    p2 = c.post("/api/omr/process", files={"file": ("saev.png", buf2.tobytes(), "image/png")},
                data={"questions_per_subject": "22", "layout_mode": "dual", "template": "saev", "adaptive": "true"})
    assert p2.status_code == 200 and p2.json().get("success"), \
        f"process SAEV: 200: {(p2.json().get('error') or '')[:80]}"

    s3 = c.get("/api/ops/stats").json()
    assert s3["n_calls"] == 2 and set(s3["by_model"]) >= {"padrao", "saev"}, \
        f"stats: 2 chamadas, 2 modelos: {s3.get('by_model', {}).keys()}"
    sa = s3["by_model"].get("saev") or {}
    assert "t_total_ms_avg" in sa and "dup_rate" in sa and "low_rate" in sa, \
        f"by_model: médias e taxas: {sa}"
    assert s3.get("success_rate") == 1.0, "success_rate: 1.0"


if __name__ == "__main__":
    import pytest as _pytest
    import sys as _sys
    _sys.exit(_pytest.main([__file__, "-q"]))
