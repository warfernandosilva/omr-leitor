"""E2E SAEV: gera cartão, preenche quadrados, lê e confere N/N + QR."""

import cv2
import numpy as np

from omr.template_saev import (
    SaevSpec, generate_saev_card, saev_block_rows, saev_bubble_center,
    SAEV_SIDE,
)
from omr.reader_saev import process_saev_image

QPS = 22
N = QPS * 2
EXPECTED = {q: "ABCD"[(q * 7 + 2) % 4] for q in range(1, N + 1)}


def fill_card(img: np.ndarray, answers: dict[int, str], qps: int = QPS) -> np.ndarray:
    out = img.copy()
    letters = ["A", "B", "C", "D"]
    half = int(SAEV_SIDE / 2) - 6
    for q, col, r in saev_block_rows(qps):
        cx, cy = saev_bubble_center(col, r, letters.index(answers[q]), qps)
        cx, cy = int(cx), int(cy)
        cv2.rectangle(out, (cx - half, cy - half), (cx + half, cy + half),
                      (20, 20, 20), -1)
    return out


def main() -> None:
    base = generate_saev_card(SaevSpec(n_questoes=QPS), student_name="ALUNA SAEV",
                              qr_override="OMR-2026-000001")
    filled = fill_card(base, EXPECTED)
    res = process_saev_image(filled, questions_per_subject=QPS)
    assert res is not None, "process_saev_image retornou None"
    wrong = {q: (res.answers.get(q), e) for q, e in EXPECTED.items()
             if res.answers.get(q) != e}
    assert not wrong, f"erradas={wrong}"
    assert res.qr_id == "OMR-2026-000001", f"QR veio {res.qr_id!r}"
    assert not res.blank_questions, f"brancas={res.blank_questions}"
    assert not res.duplicate_questions, f"dups={res.duplicate_questions}"
    print(f"limpo: OK {N}/{N} QR={res.qr_id}")

    h, w = filled.shape[:2]
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    dst = np.float32([[15, 25], [w - 20, 10], [w - 12, h - 18], [12, h - 12]])
    M = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(filled, M, (w, h), borderValue=(255, 255, 255))
    res2 = process_saev_image(warped, questions_per_subject=QPS)
    assert res2 is not None, "perspectiva: retornou None"
    wrong2 = {q: (res2.answers.get(q), e) for q, e in EXPECTED.items()
              if res2.answers.get(q) != e}
    assert not wrong2, f"perspectiva erradas={wrong2}"
    print(f"perspectiva: OK {N}/{N} QR={res2.qr_id}")

    print("E2E SAEV: PASS")


if __name__ == "__main__":
    main()
