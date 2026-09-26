"""
Gabarito Herby — template: geração, geometria, QRs duplos e lote.

Executar: python -m pytest test_herby_template.py -q
"""
import io

import cv2

from omr.template_herby import (
    generate_herby_card, build_herby_batch_pdf, HerbySpec,
    herby_rows_for, herby_row_ys, herby_block_rows, herby_bubble_center,
    normalize_herby_qr, herby_magic_link,
    HERBY_COLS_X, HERBY_Y0, HERBY_Y1, HERBY_COORDS,
    HERBY_QR_HEAD_POS, HERBY_QR_HEAD_SIZE, HERBY_QR_FOOT_POS, HERBY_QR_FOOT_SIZE,
)
from omr.reader import _decode_qr_from


def test_herby_geometry():
    # geometria: 22+22 em 11 fileiras por subcoluna
    assert herby_rows_for(22) == 11, "rows(22)=11"
    assert herby_rows_for(1) == 1, "rows(1)=1"
    assert herby_rows_for(26) == 13, "rows(26)=13"
    ys = herby_row_ys(22)
    assert abs(ys[0] - 650) < 1 and abs(ys[-1] - 1785) < 1, f"faixa y 650..1785: {ys[0]}, {ys[-1]}"
    qs = list(herby_block_rows(22))
    assert len(qs) == 44, f"44 questoes no bloco: n={len(qs)}"
    assert min(q for q, _, _ in qs) == 1 and max(q for q, _, _ in qs) == 44, "LP=1..22 MAT=23..44"
    cx, cy = herby_bubble_center(0, 0, 0)
    assert abs(cx - (HERBY_COLS_X[0] + 16 + 20)) < 1 and abs(cy - HERBY_Y0) < 1, "origem coerente"


def test_herby_qr_normalization():
    # normalização QR (URL Herby real + ID puro + nosso código)
    assert normalize_herby_qr("https://hby.app?i4=GEW6rmMbj6oE") == "GEW6rmMbj6oE", "url herby → id"
    assert normalize_herby_qr("i4=GEW6rmMbj6oE") == "GEW6rmMbj6oE", "id puro intacto"
    assert normalize_herby_qr("OMR-2026-000001") == "OMR-2026-000001", "codigo nosso intacto"
    assert herby_magic_link("OMR-2026-7") == "OMR-2026-7", "magic link vazio = codigo"
    assert herby_magic_link("OMR-2026-7", "https://omr.exemplo") == "https://omr.exemplo?codigo=OMR-2026-7", \
        "magic link com base"


def test_herby_qr_decodable():
    # cartão gerado: QRs decodificáveis nas posições do template
    hx, hy = HERBY_QR_HEAD_POS
    fx, fy = HERBY_QR_FOOT_POS
    img = generate_herby_card(HerbySpec(n_questoes=22), student_name="ALUNA X", qr_override="OMR-2026-000042")
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    head = gray[hy - 20:hy + HERBY_QR_HEAD_SIZE + 20, hx - 20:hx + HERBY_QR_HEAD_SIZE + 20]
    foot = gray[fy - 15:fy + HERBY_QR_FOOT_SIZE + 15, fx - 15:fx + HERBY_QR_FOOT_SIZE + 15]
    got_head = _decode_qr_from(head)
    got_foot = _decode_qr_from(foot)
    assert got_head == "OMR-2026-000042", f"QR cabeca decodifica: {got_head!r}"
    assert got_foot == "OMR-2026-000042", f"QR rodape decodifica: {got_foot!r}"

    # magic_base no cartão
    img2 = generate_herby_card(HerbySpec(magic_base="https://omr.exemplo"), qr_override="OMR-2026-5")
    gray2 = cv2.cvtColor(img2, cv2.COLOR_BGR2GRAY)
    head2 = gray2[hy - 20:hy + HERBY_QR_HEAD_SIZE + 20, hx - 20:hx + HERBY_QR_HEAD_SIZE + 20]
    got2 = _decode_qr_from(head2)
    assert got2 == "https://omr.exemplo?codigo=OMR-2026-5", f"QR cabeca magic link: {got2!r}"
    assert normalize_herby_qr(got2 or "") == "OMR-2026-5", "normaliza magic nosso"


def test_herby_variable_qps_and_batch():
    # qps variável: 1, 5 e 26 geram sem erro, contagens certas
    for qps in (1, 5, 26):
        im = generate_herby_card(HerbySpec(n_questoes=qps), qr_override="OMR-2026-1")
        n = len(list(herby_block_rows(qps)))
        assert n == 2 * max(1, min(26, qps)) and im.shape == (2048, 1448, 3), f"qps={qps}: {n} questoes"

    # lote: 2 alunos → 2 páginas
    buf = io.BytesIO()
    n = build_herby_batch_pdf(
        [{"codigo_unico": "OMR-2026-000001", "nome": "ALUNA UM"},
         {"codigo_unico": "OMR-2026-000002", "nome": "ALUNO DOIS"}],
        HerbySpec(), buf)
    assert n == 2, f"lote 2 paginas: n={n}"

    # coords expostas
    assert set(HERBY_COORDS) >= {"cols_x", "pitch", "side", "y0", "y1", "qr_head_pos", "qr_foot_pos", "min_qps", "max_qps"}, \
        "HERBY_COORDS chaves"
    assert HERBY_COORDS["min_qps"] == 1 and HERBY_COORDS["max_qps"] == 26, "min/max 1..26"


def test_herby_coords_endpoint(client):
    r = client.get("/api/template/herby-coords")
    assert r.status_code == 200 and r.json()["pitch"] == 40, \
        f"GET herby-coords 200: status={r.status_code}"


if __name__ == "__main__":
    import pytest as _pytest
    import sys as _sys
    _sys.exit(_pytest.main([__file__, "-q"]))
