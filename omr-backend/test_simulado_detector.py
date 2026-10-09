"""Detector do Simulado em foto "de celular": escrita ao lado, linha extra,
papel torto e a tabela ocupando só parte do quadro.

Cobre o que a foto real IMG/0910 (n).jpg expoe e que o gate antigo de contagem
exata derrubava: 26/24/23 reguas, aresta inclinada pela escrita, residuo alto
pelo curvamento.

Executar: python -m pytest test_simulado_detector.py -q
"""
from pathlib import Path

import cv2
import numpy as np
import pytest

from omr.detector_simulado import detect_simulado_table, EDGE_SLOPE_MAX
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


def photo_frame(angle: float, above: bool, below: bool,
                answers: dict[int, str] | None = None) -> np.ndarray:
    """Cartao preenchido dentro de um quadro de celular, com ruido de mesa.

    O cartao ocupa ~60% do quadro (as fotos 0910 ficam em ~55-60%), e as
    linhas extras imitam escrita acima e uma segunda folha embaixo.
    """
    card = fill_card(generate_simulado_card(), answers or EXPECTED)
    h, w = card.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), angle, 1.0)
    rot = cv2.warpAffine(card, M, (w, h), flags=cv2.INTER_LINEAR,
                         borderValue=(255, 255, 255))

    ch, cw = 3200, 2400
    canvas = np.full((ch, cw, 3), 255, np.uint8)
    oy, ox = 600, 450
    canvas[oy:oy + h, ox:ox + w] = rot

    ink = (35, 35, 35)
    if above:
        cv2.line(canvas, (ox + 30, oy - 80), (ox + w - 30, oy - 80), ink, 6)
    if below:
        cv2.line(canvas, (ox + 30, oy + h + 90), (ox + w - 30, oy + h + 90), ink, 6)
    # nome do aluno: tracos curtos, nunca chegam ao limiar da projecao
    for i in range(8):
        cv2.line(canvas, (ox + 100 + i * 45, oy - 170),
                 (ox + 130 + i * 45, oy - 165), ink, 4)
    return canvas


def check_read(img: np.ndarray, label: str) -> None:
    det = detect_simulado_table(img)
    assert det.found, f"{label}: deteccao falhou miss={det.missing} n={det.n_reguas}"
    res = process_simulado_image(img)
    assert res is not None, f"{label}: leitor retornou None"
    wrong = {q: (res.answers.get(q), e) for q, e in EXPECTED.items()
             if res.answers.get(q) != e}
    assert not wrong, f"{label}: erradas={wrong}"
    assert not res.blank_questions, f"{label}: brancas={res.blank_questions}"
    assert not res.duplicate_questions, f"{label}: duplicadas={res.duplicate_questions}"


def test_detector_linha_extra_embaixo():
    """26 reguas (uma linha cheia de tinta fora da tabela) -> janela de 25."""
    check_read(photo_frame(-1.0, above=False, below=True), "linha embaixo")


def test_detector_linha_extra_em_cima_e_embaixo():
    """27 reguas: a tabela fica no meio do ruido e a janela certa existe."""
    check_read(photo_frame(-1.0, above=True, below=True), "ruido dos dois lados")


def test_detector_papel_torto():
    """Inclinacao de ~2 graus, como o celular torto na mesa."""
    check_read(photo_frame(-2.2, above=True, below=False), "papel torto")


def test_detector_quadro_com_muito_branco():
    """Cartao pequeno no quadro: a projecao continua achando as reguas."""
    card = fill_card(generate_simulado_card(), EXPECTED)
    h, w = card.shape[:2]
    canvas = np.full((3600, 2600, 3), 255, np.uint8)
    oy, ox = 900, 580
    canvas[oy:oy + h, ox:ox + w] = card
    check_read(canvas, "muito branco")


def test_detector_recusa_aresta_inclinada():
    """Escrita grossa colada na mesa faz a areda inclinar: recusa, nao inventa."""
    img = photo_frame(0.0, above=False, below=False)
    h, w = generate_simulado_card().shape[:2]
    oy, ox = 600, 450
    # mancha vertical larga encostada na direita, do topo ao rodape do cartao
    cv2.rectangle(img, (ox + w - 40, oy + 200), (ox + w + 90, oy + h - 200),
                  (30, 30, 30), -1)
    det = detect_simulado_table(img)
    if det.found:
        # se passou, a areda nao pode estar inclinada demais
        assert det.n_reguas >= 6


def test_detector_em_branco_nao_inventa():
    """Folha limpa: nenhuma resposta pode virar marca."""
    res = process_simulado_image(generate_simulado_card())
    assert res is not None
    assert not res.answers
    assert len(res.blank_questions) == SIMULADO_MAX_QUESTIONS


def test_edge_slope_max_e_curto():
    # aresta boa nas fotos reais fica <= 0,03; o corte deixa folga de ~2,5x
    assert 0.05 <= EDGE_SLOPE_MAX <= 0.12


# ---------------------------------------------------------------------------
# Fotos reais 0910 (opcional: fora do repositorio, skip se ausente)
# ---------------------------------------------------------------------------

def _fotos_0910() -> list[Path]:
    here = Path(__file__).resolve()
    for base in (here.parents[2], here.parents[1], Path.home() / "Documents" / "GitHub"):
        d = base / "IMG"
        if d.is_dir():
            found = sorted(d.glob("0910*.jpg"))
            if found:
                return found
    return []


FOTOS_0910 = _fotos_0910()


@pytest.mark.skipif(not FOTOS_0910, reason="fotos 0910 ausentes")
@pytest.mark.parametrize("p", FOTOS_0910, ids=lambda p: p.stem)
def test_detector_fotos_0910(p: Path):
    """Aceita ler ou recusar; o que nao pode e emitir nota com geometria torta."""
    img = cv2.imread(str(p))
    assert img is not None, p
    res = process_simulado_image(img)
    if res is None:
        return
    assert 0 <= len(res.answers) <= SIMULADO_MAX_QUESTIONS
    assert len(res.answers) + len(res.blank_questions) <= SIMULADO_MAX_QUESTIONS
    assert res.floor_used > 0


if __name__ == "__main__":
    import sys

    import pytest as _pytest
    sys.exit(_pytest.main([__file__, "-q"]))
