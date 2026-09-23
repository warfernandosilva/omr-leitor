"""Etapa 1 SAEV: geração do cartão — tamanho, âncoras, QR, grade e lote PDF."""

import io

import cv2
import numpy as np

from omr.template_saev import (
    SaevSpec, generate_saev_card, generate_saev_card_bytes,
    build_saev_batch_pdf, saev_block_rows, saev_bubble_center,
    saev_row_ys, SAEV_CORNER_CENTERS, SAEV_SQUARE,
    SAEV_QR_POS, SAEV_QR_SIZE, SAEV_MAX_QPS, SAEV_MIN_QPS,
    PAGE_W, PAGE_H,
)


def _dark_ratio(img, x0, y0, x1, y1):
    crop = img[y0:y1, x0:x1]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    return float((gray < 128).mean())


def test_tamanho_e_ancoras():
    img = generate_saev_card(SaevSpec(n_questoes=22), student_name="ALUNA EXEMPLO",
                             qr_override="OMR-2026-000001")
    assert img.shape == (PAGE_H, PAGE_W, 3), img.shape
    # 4 ArUco DICT_4X4_50 (IDs 0-3) nos cantos SAEV, 104px como no padrão
    from omr.detector import detect_markers
    det = detect_markers(img)
    assert sorted(det.found_ids) == [0, 1, 2, 3], det.found_ids
    assert SAEV_SQUARE == 104
    for k, mid in (("TL", 0), ("TR", 1), ("BR", 2), ("BL", 3)):
        cx, cy = SAEV_CORNER_CENTERS[k]
        m = next(m for m in det.markers if m.id == mid)
        assert abs(m.center[0] - cx) < 3 and abs(m.center[1] - cy) < 3, (k, m.center)
    # QR presente no slot
    qx, qy = SAEV_QR_POS
    r = _dark_ratio(img, qx, qy, qx + SAEV_QR_SIZE, qy + SAEV_QR_SIZE)
    assert 0.15 < r < 0.85, f"QR fora do esperado: {r}"
    # caixa Turma vazia (quase toda branca)
    from omr.template_saev import SAEV_TURMA_BOX
    x0, y0, x1, y1 = SAEV_TURMA_BOX
    r = _dark_ratio(img, x0 + 4, y0 + 4, x1 - 4, y1 - 4)
    assert r < 0.05, f"Turma deveria estar vazia: {r}"


def test_grade_parametrica():
    for qps in (16, 22, 26):
        rows = list(saev_block_rows(qps))
        assert len(rows) == qps * 2, (qps, len(rows))
        ys = saev_row_ys(qps)
        assert len(ys) == (qps + 1) // 2
        assert min(ys) >= 650 and max(ys) <= 1800, (qps, min(ys), max(ys))
        # centros dentro do canvas e sem sobrepor âncoras
        for col in range(4):
            for r in range(len(ys)):
                for a in range(4):
                    cx, cy = saev_bubble_center(col, r, a, qps)
                    assert 0 < cx < PAGE_W and 0 < cy < PAGE_H, (col, r, a, cx, cy)
    assert SAEV_MIN_QPS == 16 and SAEV_MAX_QPS == 26


def test_lote_pdf_2_paginas():
    spec = SaevSpec(n_questoes=22)
    students = [
        {"codigo_unico": "OMR-2026-000001", "nome": "ALUNA UM"},
        {"codigo_unico": "OMR-2026-000002", "nome": "ALUNO DOIS"},
    ]
    buf = io.BytesIO()
    n = build_saev_batch_pdf(students, spec, buf)
    assert n == 2, n
    assert buf.getvalue()[:4] == b"%PDF"


def test_bytes_png():
    data = generate_saev_card_bytes("PNG", SaevSpec(n_questoes=16))
    assert data[:8] == b"\x89PNG\r\n\x1a\n"


def main() -> None:
    test_tamanho_e_ancoras()
    print("tamanho+ancoras+QR+turma-vazia: OK")
    test_grade_parametrica()
    print("grade parametrica 16/22/26: OK")
    test_lote_pdf_2_paginas()
    print("lote PDF 2 paginas: OK")
    test_bytes_png()
    print("bytes PNG: OK")
    print("E2E SAEV-TEMPLATE: PASS")


if __name__ == "__main__":
    main()
