"""Flag debug: heatmap só quando pedida, decodificável, com N marcações.

Executar: python -m pytest test_debug.py -q
"""
import base64

import cv2
import numpy as np

from omr.template import generate_card, QUESTION_Y, PORT_X, BUBBLE_RADIUS
from omr.debug import build_debug_points, render_heatmap, score_color
from conftest import TEST_PASSWORD


def test_debug_units():
    geom = {1: [(100.0, 200.0, 19.5, "A"), (140.0, 200.0, 19.5, "B")]}
    ratios = {1: {"A": 0.7, "B": 0.1}}
    pts = build_debug_points(geom, ratios, {1: "A"}, [], [], [])
    assert len(pts) == 2 and all(p["verdict"] == "ok" for p in pts), \
        f"build: 2 pontos com verdict ok: {pts[0]}"
    assert score_color(0.7)[1] > 150, "score_color: marcada verde"
    canvas = np.full((300, 300, 3), 255, dtype=np.uint8)
    url = render_heatmap(canvas, pts)
    assert url is not None and url.startswith("data:image/jpeg;base64,"), "render: dataURL"
    raw = base64.b64decode(url.split(",", 1)[1])
    img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    assert img is not None and max(img.shape[:2]) <= 720, \
        f"render: JPEG decodificável 720px-: {None if img is None else img.shape[:2]}"


def test_debug_endpoint(client):
    c = client
    r = c.post("/api/auth/register", json={"email": "dbg@example.com", "nome": "Dbg", "password": TEST_PASSWORD})
    if r.status_code == 400:
        r = c.post("/api/auth/login", data={"username": "dbg@example.com", "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    c.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})

    card = generate_card()
    for q in range(22):
        cv2.circle(card, (int(PORT_X[q % 4]), int(QUESTION_Y[q])), int(BUBBLE_RADIUS) - 2, (0, 0, 0), -1)
    _, buf = cv2.imencode('.png', card)
    payload = buf.tobytes()

    p0 = c.post("/api/omr/process", files={"file": ("c.png", payload, "image/png")},
                data={"questions_per_subject": "22", "layout_mode": "dual", "template": "padrao"})
    assert p0.json().get("debug_images") is None, "debug=false: sem debug_images"

    p1 = c.post("/api/omr/process", files={"file": ("c.png", payload, "image/png")},
                data={"questions_per_subject": "22", "layout_mode": "dual", "template": "padrao", "debug": "true"})
    j1 = p1.json()
    hm = (j1.get("debug_images") or {}).get("heatmap")
    assert isinstance(hm, str) and hm.startswith("data:image/jpeg"), \
        f"debug=true: heatmap presente: keys={list((j1.get('debug_images') or {}).keys())}"
    assert j1.get("success") and len(j1.get("answers") or {}) == 22, "debug=true: leitura intacta"


if __name__ == "__main__":
    import pytest as _pytest
    import sys as _sys
    _sys.exit(_pytest.main([__file__, "-q"]))
