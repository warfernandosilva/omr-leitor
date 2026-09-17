"""E2E Colar: gera cartão sem cabeçalho, preenche bolhas, lê e confere N/N sem QR."""

import cv2
import numpy as np

from omr.template_sae import generate_colar_card, sae_block_rows
from omr.template_sae import (
    SAE_BLOCKS_X, SAE_BUBBLE_DX, SAE_FIRST_ROW_Y, SAE_ROW_STEP,
    SAE_BUBBLE_RADIUS,
)
from omr.reader_sae import process_sae_image

N = 26
EXPECTED = {q: "ABCD"[(q * 5 + 1) % 4] for q in range(1, N + 1)}


def fill_card(img: np.ndarray, answers: dict[int, str]) -> np.ndarray:
    out = img.copy()
    letters = ["A", "B", "C", "D"]
    r = int(round(SAE_BUBBLE_RADIUS)) - 3
    for q, b, row in sae_block_rows(N):
        y = SAE_FIRST_ROW_Y + row * SAE_ROW_STEP
        x = SAE_BLOCKS_X[b] + SAE_BUBBLE_DX[letters.index(answers[q])]
        cv2.ellipse(out, (x, y), (r, r), 0, 0, 360, (20, 20, 20), -1)
    return out


def main() -> None:
    base = generate_colar_card(N)
    filled = fill_card(base, EXPECTED)
    res = process_sae_image(filled, n_questions=N)
    assert res is not None, "process_sae_image retornou None"
    wrong = {q: (res.answers.get(q), e) for q, e in EXPECTED.items()
             if res.answers.get(q) != e}
    assert not wrong, f"erradas={wrong}"
    assert res.qr_id is None, f"QR deveria ser None, veio {res.qr_id!r}"
    assert not res.blank_questions, f"brancas={res.blank_questions}"
    print(f"limpo: OK {N}/{N} sem QR")

    h, w = filled.shape[:2]
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    dst = np.float32([[15, 25], [w - 20, 10], [w - 12, h - 18], [12, h - 12]])
    M = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(filled, M, (w, h), borderValue=(255, 255, 255))
    res2 = process_sae_image(warped, n_questions=N)
    assert res2 is not None, "perspectiva: retornou None"
    wrong2 = {q: (res2.answers.get(q), e) for q, e in EXPECTED.items()
              if res2.answers.get(q) != e}
    assert not wrong2, f"perspectiva erradas={wrong2}"
    print(f"perspectiva: OK {N}/{N} sem QR")

    print("E2E COLAR: PASS")


if __name__ == "__main__":
    main()
