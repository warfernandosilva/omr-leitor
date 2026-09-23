"""Smoke test do /api/omr/process-multi (3 frames idênticos + 1 frame)."""
import sys
sys.path.insert(0, '.')
import os
import tempfile

_tmp = tempfile.mkdtemp(prefix='omr_multi_')
os.environ['OMR_DB_PATH'] = os.path.join(_tmp, 'm.db')

from fastapi.testclient import TestClient
import main as main_module
import cv2
from omr.template import generate_card, QUESTION_Y, PORT_X, BUBBLE_RADIUS

c = TestClient(main_module.app)
r = c.post('/api/auth/register', json={'email': 'm@example.com', 'nome': 'M', 'password': '123456'})
if r.status_code == 400:
    r = c.post('/api/auth/login', data={'username': 'm@example.com', 'password': '123456'})
c.headers.update({'Authorization': f"Bearer {r.json()['access_token']}"})

card = generate_card()
for q in range(22):
    cv2.circle(card, (int(PORT_X[q % 4]), int(QUESTION_Y[q])), int(BUBBLE_RADIUS) - 2, (0, 0, 0), -1)


def png(img):
    _, buf = cv2.imencode('.png', img)
    return buf.tobytes()


p = c.post('/api/omr/process-multi',
           files=[('files', ('a.png', png(card), 'image/png')),
                  ('files', ('b.png', png(card), 'image/png')),
                  ('files', ('c.png', png(card), 'image/png'))],
           data={'questions_per_subject': '22', 'layout_mode': 'dual', 'template': 'padrao'})
j = p.json()
ok = p.status_code == 200 and j.get('success') and j.get('n_frames') == 3 and len(j.get('answers') or {}) == 22
print(f"multi 3 frames: status={p.status_code} success={j.get('success')} n_frames={j.get('n_frames')} answers={len(j.get('answers') or {})} warn={j.get('warnings')}")
p1 = c.post('/api/omr/process-multi',
            files=[('files', ('a.png', png(card), 'image/png'))],
            data={'questions_per_subject': '22', 'layout_mode': 'dual', 'template': 'padrao'})
j1 = p1.json()
ok1 = p1.status_code == 200 and j1.get('success') and j1.get('n_frames') == 1 and len(j1.get('answers') or {}) == 22
print(f"multi 1 frame: status={p1.status_code} success={j1.get('success')} n_frames={j1.get('n_frames')} answers={len(j1.get('answers') or {})}")
sys.exit(0 if ok and ok1 else 1)
