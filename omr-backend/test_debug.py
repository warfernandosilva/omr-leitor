"""Flag debug: heatmap só quando pedida, decodificável, com N marcações."""
import sys
sys.path.insert(0, '.')
import os
import tempfile
import base64

_tmp = tempfile.mkdtemp(prefix='omr_debug_')
os.environ['OMR_DB_PATH'] = os.path.join(_tmp, 'd.db')

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import cv2
import numpy as np
from fastapi.testclient import TestClient
import main as main_module
from omr.template import generate_card, QUESTION_Y, PORT_X, BUBBLE_RADIUS
from omr.debug import build_debug_points, render_heatmap, score_color

fails = []


def check(name, cond, extra=""):
    print(f"   {'OK ' if cond else 'FALHA'}  {name} {extra}")
    if not cond:
        fails.append(name)


# unidade: build + render
geom = {1: [(100.0, 200.0, 19.5, "A"), (140.0, 200.0, 19.5, "B")]}
ratios = {1: {"A": 0.7, "B": 0.1}}
pts = build_debug_points(geom, ratios, {1: "A"}, [], [], [])
check("build: 2 pontos com verdict ok", len(pts) == 2 and all(p["verdict"] == "ok" for p in pts), str(pts[0]))
check("score_color: marcada verde", score_color(0.7)[1] > 150)
canvas = np.full((300, 300, 3), 255, dtype=np.uint8)
url = render_heatmap(canvas, pts)
check("render: dataURL", url is not None and url.startswith("data:image/jpeg;base64,"))
raw = base64.b64decode(url.split(",", 1)[1])
img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
check("render: JPEG decodificável 720px-", img is not None and max(img.shape[:2]) <= 720, str(None if img is None else img.shape[:2]))

# endpoint
c = TestClient(main_module.app)
r = c.post("/api/auth/register", json={"email": "dbg@example.com", "nome": "Dbg", "password": "123456"})
if r.status_code == 400:
    r = c.post("/api/auth/login", data={"username": "dbg@example.com", "password": "123456"})
assert r.status_code == 200, r.text
c.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})

card = generate_card()
for q in range(22):
    cv2.circle(card, (int(PORT_X[q % 4]), int(QUESTION_Y[q])), int(BUBBLE_RADIUS) - 2, (0, 0, 0), -1)
_, buf = cv2.imencode('.png', card)
payload = buf.tobytes()

p0 = c.post("/api/omr/process", files={"file": ("c.png", payload, "image/png")},
            data={"questions_per_subject": "22", "layout_mode": "dual", "template": "padrao"})
check("debug=false: sem debug_images", p0.json().get("debug_images") is None)

p1 = c.post("/api/omr/process", files={"file": ("c.png", payload, "image/png")},
            data={"questions_per_subject": "22", "layout_mode": "dual", "template": "padrao", "debug": "true"})
j1 = p1.json()
hm = (j1.get("debug_images") or {}).get("heatmap")
check("debug=true: heatmap presente", isinstance(hm, str) and hm.startswith("data:image/jpeg"),
      f"keys={list((j1.get('debug_images') or {}).keys())}")
check("debug=true: leitura intacta", j1.get("success") and len(j1.get("answers") or {}) == 22)

print("\nDEBUG:", "PASS" if not fails else f"FAIL {fails}")
sys.exit(1 if fails else 0)
