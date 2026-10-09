"""E2E Simulado: gera cartão, preenche bolhas, lê e confere 22/22.

Cobre o caminho completo (réguas -> 4 quinas -> homografia -> floor 'gap'),
inclusive na foto real da Fase 0 quando ela existe ao lado do repositório.

Executar: python -m pytest test_simulado_e2e.py -q
"""
from pathlib import Path

import cv2
import numpy as np
import pytest

from omr.template_simulado import (
    generate_simulado_card, SIMULADO_MAX_QUESTIONS, SIMULADO_INNER_R,
    simulado_bubble_center,
)
from omr.reader_simulado import process_simulado_image

GABARITO = "DBBCBCBCCBDCADABAACBCD"
EXPECTED = {q: GABARITO[q - 1] for q in range(1, SIMULADO_MAX_QUESTIONS + 1)}


def fill_card(img: np.ndarray, answers: dict[int, str]) -> np.ndarray:
    out = img.copy()
    letters = ["A", "B", "C", "D"]
    r = int(SIMULADO_INNER_R) + 2
    for q, letter in answers.items():
        cx, cy = simulado_bubble_center(q, letters.index(letter))
        cv2.circle(out, (int(round(cx)), int(round(cy))), r, (20, 20, 20), -1)
    return out


def check(img: np.ndarray, label: str) -> None:
    res = process_simulado_image(img)
    assert res is not None, f"{label}: process_simulado_image retornou None"
    wrong = {q: (res.answers.get(q), e) for q, e in EXPECTED.items()
             if res.answers.get(q) != e}
    assert not wrong, f"{label}: erradas={wrong}"
    assert not res.blank_questions, f"{label}: brancas={res.blank_questions}"
    assert not res.duplicate_questions, f"{label}: duplicadas={res.duplicate_questions}"
    assert res.floor_source == "gap", f"{label}: floor_source={res.floor_source!r}"


def test_simulado_e2e_clean():
    check(fill_card(generate_simulado_card(), EXPECTED), "limpo")


def test_simulado_e2e_branco():
    """Cartão sem marcação: todas brancas (nada pode virar resposta)."""
    res = process_simulado_image(generate_simulado_card())
    assert res is not None, "cartão em branco: leitor retornou None"
    assert not res.answers, f"em branco veio resposta: {res.answers}"
    assert len(res.blank_questions) == SIMULADO_MAX_QUESTIONS, res.blank_questions


def test_simulado_e2e_perspective_noise():
    filled = fill_card(generate_simulado_card(), EXPECTED)
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


def test_simulado_e2e_rotacao():
    """Rotação de ~2° (a foto real tem -1,4°)."""
    filled = fill_card(generate_simulado_card(), EXPECTED)
    h, w = filled.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), -2.0, 1.0)
    rot = cv2.warpAffine(filled, M, (w, h), flags=cv2.INTER_LINEAR,
                         borderValue=(255, 255, 255))
    check(rot, "rotacao -2 graus")


# ---------------------------------------------------------------------------
# Foto real da Fase 0 (opcional: não é commitada no repositório)
# ---------------------------------------------------------------------------

def _real_photo() -> Path | None:
    here = Path(__file__).resolve()
    for base in (here.parents[2], here.parents[1], Path.home() / "Documents" / "GitHub"):
        p = base / "IMG" / "20261008_203236.jpg"
        if p.exists():
            return p
    return None


PHOTO = _real_photo()


@pytest.mark.skipif(PHOTO is None, reason="foto real 20261008_203236.jpg ausente")
def test_simulado_foto_real():
    img = cv2.imread(str(PHOTO))
    assert img is not None, PHOTO
    res = process_simulado_image(img)
    assert res is not None, "foto real: leitor retornou None"
    wrong = {q: (res.answers.get(q), e) for q, e in EXPECTED.items()
             if res.answers.get(q) != e}
    assert not wrong, f"foto real: erradas={wrong}"
    assert not res.blank_questions, res.blank_questions
    assert not res.duplicate_questions, res.duplicate_questions


if __name__ == "__main__":
    import pytest as _pytest
    import sys as _sys
    _sys.exit(_pytest.main([__file__, "-q"]))
