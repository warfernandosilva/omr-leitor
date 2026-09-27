"""
Herby 1 disciplina (single): grade só na metade esquerda, leitura 1..qps.

Executar: python -m pytest test_herby_single.py -q
"""
import cv2
import numpy as np

from omr.template_herby import (
    generate_herby_card, HerbySpec, herby_block_rows, herby_bubble_center,
    HERBY_SIDE, HERBY_COLS_X,
)
from omr.reader_herby import process_herby_image
from conftest import TEST_PASSWORD

COD = "OMR-2026-000078"
QPS = 10


def test_single_block_rows_left_half_only():
    rows = list(herby_block_rows(QPS, "single"))
    assert rows, "single gera linhas"
    assert all(col in (0, 1) for _, col, _ in rows), "single: só cols 0-1"
    qs = sorted(q for q, _, _ in rows)
    assert qs == list(range(1, QPS + 1)), f"single: Q 1..{QPS}: {qs}"
    # dual inalterado
    dual_qs = sorted(q for q, _, _ in herby_block_rows(QPS))
    assert dual_qs == list(range(1, 2 * QPS + 1)), "dual: Q 1..2*qps"


def test_single_card_right_half_blank():
    img = generate_herby_card(HerbySpec(n_questoes=QPS, layout_mode="single"), qr_override=COD)
    assert img.shape == (2048, 1448, 3)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # metade direita (x > 750) na faixa da grade deve estar quase toda branca
    right = gray[650:1785, 780:1448]
    assert float((right > 200).mean()) > 0.97, "single: metade direita em branco"
    # metade esquerda tem quadrados (tinta preta presente)
    left = gray[650:1785, 100:700]
    assert float((left < 128).mean()) > 0.005, "single: grade desenhada à esquerda"


def test_single_read_marked():
    img = generate_herby_card(
        HerbySpec(n_questoes=QPS, layout_mode="single"),
        student_name="HERBY SINGLE", qr_override=COD)
    half = int(HERBY_SIDE / 2) - 6
    for q, col, r in herby_block_rows(QPS, "single"):
        cx, cy = herby_bubble_center(col, r, 1, QPS)  # marca B em tudo
        cv2.rectangle(img, (int(cx) - half, int(cy) - half), (int(cx) + half, int(cy) + half), (10, 10, 10), -1)

    res = process_herby_image(img, questions_per_subject=QPS, layout_mode="single")
    assert res is not None, "pipeline single ok"
    assert res.qr_id == COD, f"qr: {res.qr_id!r}"
    ok = sum(1 for q in range(1, QPS + 1) if res.answers.get(q) == "B")
    assert ok == QPS, f"B {QPS}/{QPS}: {ok}/{QPS}"
    assert all(q <= QPS for q in list(res.answers) + res.blank_questions), "sem Q além do qps"


def test_single_blank():
    img = generate_herby_card(HerbySpec(n_questoes=QPS, layout_mode="single"), qr_override=COD)
    rb = process_herby_image(img, questions_per_subject=QPS, layout_mode="single")
    assert rb is not None and len(rb.blank_questions) == QPS and not rb.duplicate_questions, \
        f"branco single: {QPS} blanks"


def test_single_via_api(client):
    c = client
    r = c.post("/api/auth/register", json={"email": "single@herby.com", "nome": "S", "password": TEST_PASSWORD})
    if r.status_code == 400:
        r = c.post("/api/auth/login", data={"username": "single@herby.com", "password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    c.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})

    img = generate_herby_card(
        HerbySpec(n_questoes=QPS, layout_mode="single"), qr_override=COD)
    half = int(HERBY_SIDE / 2) - 6
    for q, col, rr in herby_block_rows(QPS, "single"):
        cx, cy = herby_bubble_center(col, rr, 0, QPS)  # marca A em tudo
        cv2.rectangle(img, (int(cx) - half, int(cy) - half), (int(cx) + half, int(cy) + half), (10, 10, 10), -1)
    _, buf = cv2.imencode(".png", img)

    resp = c.post("/api/omr/process", files={"file": ("single.png", buf.tobytes(), "image/png")},
                  data={"questions_per_subject": str(QPS), "layout_mode": "single", "template": "herby"})
    assert resp.status_code == 200, resp.text
    j = resp.json()
    assert j.get("success") and j.get("template_used") == "herby", f"leitura single: {j.get('error')}"
    assert len(j.get("answers") or {}) == QPS, f"{QPS} respostas: {len(j.get('answers') or {})}"
    assert j.get("card_id") == COD, f"QR: {j.get('card_id')!r}"

    # cartão em branco oficial segue single
    r2 = c.post("/api/card/generate", json={"template": "herby", "subject_lp": "CIÊNCIAS",
                                            "questions_per_subject": QPS, "layout_mode": "single",
                                            "format": "PNG"})
    assert r2.status_code == 200, r2.text[:200]
    assert r2.content[:8] == b"\x89PNG\r\n\x1a\n"


if __name__ == "__main__":
    import pytest as _pytest
    import sys as _sys
    _sys.exit(_pytest.main([__file__, "-q"]))
