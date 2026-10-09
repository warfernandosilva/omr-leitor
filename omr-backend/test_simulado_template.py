"""Trava a geometria do template "Simulado" contra o gabarito de referência.

Executar: python -m pytest test_simulado_template.py -q

Fonte de verdade: `IMG/Gabarito simulado.jpg` (768×1796) medido pixel a pixel
em Fase 0 — 25 réguas H, 6 réguas V, degrau de 6 px na borda direita do
cabeçalho, 88 bolhas.
"""
import cv2
import numpy as np

from omr.template import PAGE_W, PAGE_H
from omr.template_simulado import (
    JPG_H_TOP, JPG_H_HEADER_BOT, JPG_H_DATA_TOP, JPG_H_BOTTOM, JPG_ROW_PITCH,
    JPG_V, JPG_V5_HEADER,
    SIMULADO_TABLE, SIMULADO_V, SIMULADO_V5_HEADER,
    SIMULADO_H_TOP, SIMULADO_H_HEADER_BOT, SIMULADO_H_DATA_TOP, SIMULADO_H_BOTTOM,
    SIMULADO_ROW_PITCH, SIMULADO_COLS, SIMULADO_NUM_X, SIMULADO_HEADER_LABEL_Y,
    SIMULADO_BUBBLE_R, SIMULADO_BUBBLE_STROKE, SIMULADO_INNER_R, SIMULADO_LINE_W,
    SIMULADO_MAX_QUESTIONS, SIMULADO_LAYOUT, SIMULADO_COORDS, SIMULADO_SCALE,
    generate_simulado_card, simulado_row_top, simulado_row_center,
    simulado_bubble_center,
)


def _binary(img: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    return cv2.threshold(cv2.GaussianBlur(gray, (5, 5), 0), 0, 255,
                         cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1] > 0


def _groups(idx, gap: int = 6) -> list[np.ndarray]:
    out: list[list[int]] = []
    for i in idx:
        if out and i - out[-1][-1] <= gap:
            out[-1].append(i)
        else:
            out.append([i])
    return [np.asarray(g) for g in out]


def test_constantes_do_gabarito():
    """As constantes batem com as réguas medidas no JPG de referência."""
    assert JPG_V == [7.0, 188.0, 328.5, 474.5, 613.5, 756.5]
    assert JPG_V5_HEADER == 750.5 and JPG_V[5] - JPG_V5_HEADER == 6.0
    assert (JPG_H_TOP, JPG_H_HEADER_BOT, JPG_H_DATA_TOP, JPG_H_BOTTOM) == (5.5, 73.5, 90.0, 1785.0)
    assert abs(JPG_ROW_PITCH - 77.045454545) < 1e-6
    assert PAGE_W == 1448 and PAGE_H == 2048


def test_canonicas_do_canvas():
    """Escala, tabela e colunas do canvas."""
    assert abs(SIMULADO_SCALE - (2048 - 80) / 1779.5) < 1e-9
    x0, y0, x1, y1 = SIMULADO_TABLE
    assert (y0, y1) == (40.0, 2008.0)
    assert abs(x0 - 309.55) < 0.02 and abs(x1 - 1138.44) < 0.02
    assert abs((x1 - x0) - 828.89) < 0.05
    assert [round(v, 2) for v in SIMULADO_V] == [309.55, 509.72, 665.11, 826.57, 980.3, 1138.44]
    assert abs(SIMULADO_V5_HEADER - 1131.81) < 0.05
    assert abs(SIMULADO_ROW_PITCH - 85.2069) < 0.005
    # colunas A..D = centros das células 1..4 (a célula 0 é a dos números)
    assert SIMULADO_COLS == [587.41, 745.84, 903.43, 1059.37]
    assert abs(SIMULADO_NUM_X - 409.64) < 0.02
    assert abs(SIMULADO_HEADER_LABEL_Y - 77.60) < 0.02
    assert SIMULADO_MAX_QUESTIONS == 22 and SIMULADO_LAYOUT == "single"
    assert SIMULADO_INNER_R < SIMULADO_BUBBLE_R - SIMULADO_BUBBLE_STROKE


def test_linhas_de_questao():
    assert simulado_row_top(1) == SIMULADO_H_DATA_TOP
    assert abs(simulado_row_top(22) - (SIMULADO_H_DATA_TOP + 21 * SIMULADO_ROW_PITCH)) < 0.01
    assert abs(simulado_row_top(22) + SIMULADO_ROW_PITCH - SIMULADO_H_BOTTOM) < 0.01
    for q in range(1, 23):
        assert abs(simulado_row_center(q) - (simulado_row_top(q) + SIMULADO_ROW_PITCH / 2)) < 0.01
    assert simulado_bubble_center(1, 0) == (SIMULADO_COLS[0], simulado_row_center(1))
    assert simulado_bubble_center(22, 3) == (SIMULADO_COLS[3], simulado_row_center(22))


def test_cartao_tem_as_25_reguas():
    img = generate_simulado_card()
    assert img.shape == (PAGE_H, PAGE_W, 3)
    b = _binary(img)

    x0, x1 = int(SIMULADO_TABLE[0]), int(SIMULADO_TABLE[2])
    band = b[:, x0:x1]
    thr = 0.45 * band.sum(axis=1).max()
    hs = [float(np.mean(g)) for g in _groups(np.where(band.sum(axis=1) >= thr)[0])]
    expected = [SIMULADO_H_TOP, SIMULADO_H_HEADER_BOT] + [
        round(SIMULADO_H_DATA_TOP + k * SIMULADO_ROW_PITCH, 2) for k in range(23)
    ]
    assert len(hs) == 25, f"25 réguas H: {len(hs)}"
    worst = max(abs(a - e) for a, e in zip(hs, expected))
    assert worst < 1.5, f"réguas com desvio max {worst:.2f}px"


def test_cartao_caixa_e_degrau():
    """Bordas: esquerda única, direita com o degrau de 6 px (cabeçalho < dados)."""
    b = _binary(generate_simulado_card())
    hs = [float(np.mean(g)) for g in _groups(
        np.where(b[:, int(SIMULADO_TABLE[0]):int(SIMULADO_TABLE[2])].sum(axis=1)
                 >= 0.45 * b[:, int(SIMULADO_TABLE[0]):int(SIMULADO_TABLE[2])].sum(axis=1).max())[0])]
    left, right = set(), {"head": set(), "data": set()}
    for i, y in enumerate(hs):
        xs = np.where(b[int(y) - 5:int(y) + 6].any(axis=0))[0]
        left.add(int(xs.min()))
        right["head" if i < 2 else "data"].add(int(xs.max()))
    half = SIMULADO_LINE_W / 2.0
    assert left == {int(round(SIMULADO_V[0] - half))}
    head, data = right["head"], right["data"]
    assert len(head) == 1 and len(data) == 1
    step = data.pop() - head.pop()
    assert abs(step - 6) <= 1, f"degrau de 6 px: {step}"
    # bbox de tinta da caixa de dados == retângulo canônico ± metade do traço
    ys, xs = np.where(b[int(round(SIMULADO_H_TOP)):int(round(SIMULADO_H_BOTTOM)) + SIMULADO_LINE_W])
    assert abs(xs.min() - (SIMULADO_V[0] - half)) <= 1.5
    assert abs(xs.max() - (SIMULADO_V[5] + half)) <= 1.5


def test_cartao_88_bolhas():
    b = _binary(generate_simulado_card())
    missing = []
    for q in range(1, SIMULADO_MAX_QUESTIONS + 1):
        y = int(round(simulado_row_center(q)))
        for ci in range(4):
            cx = int(round(SIMULADO_COLS[ci]))
            if b[y - 31:y + 32, cx - 31:cx + 32].sum() < 800:
                missing.append((q, ci))
    assert not missing, f"bolhas sem anel no centro: {missing}"


def test_cartao_anel_com_raio_correto():
    img = generate_simulado_card()
    b = _binary(img)
    cx, cy = (int(round(v)) for v in simulado_bubble_center(1, 0))
    sub = b[cy - 35:cy + 36, cx - 35:cx + 36]
    ys, xs = np.where(sub)
    d = xs.max() - xs.min() + 1
    assert abs(d - round(2 * SIMULADO_BUBBLE_R + SIMULADO_BUBBLE_STROKE - 1)) <= 2, f"diâmetro {d}"


def test_cartao_sem_identificacao():
    """Sem QR/nome/turma: só a tabela + o rótulo do cabeçalho."""
    img = generate_simulado_card()
    b = _binary(img)
    # nada fora da faixa da tabela (margem superior e inferior limpas)
    top = int(SIMULADO_H_TOP) - SIMULADO_LINE_W // 2 - 1
    assert not b[:top].any(), "margem superior suja"
    bot = int(SIMULADO_H_BOTTOM) + SIMULADO_LINE_W // 2 + 2
    assert not b[bot:].any(), "margem inferior suja"
    # a célula 0 do cabeçalho tem texto completo (não truncado)
    cell = b[int(SIMULADO_H_TOP) + 8:int(SIMULADO_H_HEADER_BOT) - 8,
             int(SIMULADO_V[0]) + 8:int(SIMULADO_V[1]) - 8]
    assert cell.any(), "rótulo QUESTÃO ausente"


def test_coords_exportado():
    c = SIMULADO_COORDS
    assert c["page_w"] == PAGE_W and c["page_h"] == PAGE_H
    assert c["table"] == list(SIMULADO_TABLE)
    assert c["max_questions"] == 22 and c["layout"] == "single"
    assert len(c["v_x"]) == 6 and len(c["cols"]) == 4
    assert c["inner_r"] == SIMULADO_INNER_R


if __name__ == "__main__":
    import pytest as _pytest
    import sys as _sys
    _sys.exit(_pytest.main([__file__, "-q"]))
