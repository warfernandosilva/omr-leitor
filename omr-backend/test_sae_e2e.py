"""E2E SAE: gera cartão, preenche bolhas, lê e confere 26/26 + QR."""

import cv2
import numpy as np

from omr.template_sae import (
    SaeSpec, generate_sae_card, sae_block_rows,
    SAE_BLOCKS_X, SAE_BUBBLE_DX, SAE_FIRST_ROW_Y, SAE_ROW_STEP,
    SAE_BUBBLE_RADIUS,
)
from omr.reader_sae import process_sae_image

EXPECTED = {q: "ABCD"[(q * 7 + 3) % 4] for q in range(1, 27)}


def fill_card(img: np.ndarray, answers: dict[int, str]) -> np.ndarray:
    out = img.copy()
    letters = ["A", "B", "C", "D"]
    r = int(round(SAE_BUBBLE_RADIUS)) - 3
    for q, b, row in sae_block_rows(26):
        y = SAE_FIRST_ROW_Y + row * SAE_ROW_STEP
        x = SAE_BLOCKS_X[b] + SAE_BUBBLE_DX[letters.index(answers[q])]
        cv2.ellipse(out, (x, y), (r, r), 0, 0, 360, (20, 20, 20), -1)
    return out


def check(img: np.ndarray, label: str) -> bool:
    res = process_sae_image(img, n_questions=26)
    assert res is not None, f"{label}: process_sae_image retornou None"
    wrong = {q: (res.answers.get(q), e) for q, e in EXPECTED.items()
             if res.answers.get(q) != e}
    assert not wrong, f"{label}: erradas={wrong}"
    assert res.qr_id == "2269M0901", f"{label}: QR={res.qr_id!r}"
    assert not res.blank_questions, f"{label}: brancas={res.blank_questions}"
    print(f"{label}: OK 26/26 QR={res.qr_id}")
    return True


def main() -> None:
    base = generate_sae_card(SaeSpec())
    filled = fill_card(base, EXPECTED)
    check(filled, "limpo")

    # Robustez: perspectiva leve + reescala + ruído
    h, w = filled.shape[:2]
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    dst = np.float32([[18, 30], [w - 25, 12], [w - 10, h - 22], [15, h - 15]])
    M = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(filled, M, (w, h), borderValue=(255, 255, 255))
    small = cv2.resize(warped, (w * 3 // 4, h * 3 // 4), interpolation=cv2.INTER_AREA)
    rng = np.random.default_rng(7)
    noise = rng.integers(-8, 9, small.shape, dtype=np.int16)
    noisy = np.clip(small.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    check(noisy, "perspectiva+ruido")

    print("E2E SAE: PASS")


if __name__ == "__main__":
    main()
