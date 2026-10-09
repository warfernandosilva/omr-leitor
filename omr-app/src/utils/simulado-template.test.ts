import { describe, it, expect } from 'vitest';
import {
  SIMULADO_TABLE, SIMULADO_V, SIMULADO_V5_HEADER,
  SIMULADO_H_TOP, SIMULADO_H_HEADER_BOT, SIMULADO_H_DATA_TOP, SIMULADO_H_BOTTOM,
  SIMULADO_ROW_PITCH, SIMULADO_COLS, SIMULADO_NUM_X, SIMULADO_HEADER_LABEL_Y,
  SIMULADO_BUBBLE_R, SIMULADO_BUBBLE_STROKE, SIMULADO_INNER_R, SIMULADO_MAX_QUESTIONS,
  SIMULADO_LAYOUT,
  simuladoRowTop, simuladoRowCenter, simuladoBubbleCenter, simuladoGridExtent,
} from './simulado-template';
import { CARD_WIDTH, CARD_HEIGHT } from './card-template';

describe('simulado-template — geometria espelhada de omr/template_simulado.py', () => {
  it('tabela canônica centrada com margem vertical 40', () => {
    expect(SIMULADO_TABLE).toEqual([309.55, 40.0, 1138.44, 2008.0]);
    const [x0, y0, x1, y1] = SIMULADO_TABLE;
    expect(y0).toBe(40);
    expect(y1).toBe(CARD_HEIGHT - 40);
    expect((x1 - x0)).toBeCloseTo(828.89, 2);
    expect(Math.abs((CARD_WIDTH - (x1 - x0)) / 2 - x0)).toBeLessThan(0.02);
  });

  it('6 réguas verticais e degrau de 6 px no cabeçalho', () => {
    expect(SIMULADO_V).toHaveLength(6);
    expect(SIMULADO_V[0]).toBe(SIMULADO_TABLE[0]);
    expect(SIMULADO_V[5]).toBe(SIMULADO_TABLE[2]);
    // degrau de 6 px no JPG → 6 * escala ≈ 6.63 no canvas (backend tolera ±1)
    expect(Math.abs(SIMULADO_V[5] - SIMULADO_V5_HEADER - 6)).toBeLessThanOrEqual(1);
  });

  it('réguas horizontais: cabeçalho separado dos dados', () => {
    expect(SIMULADO_H_TOP).toBe(40);
    expect(SIMULADO_H_HEADER_BOT).toBeCloseTo(115.2, 2);
    expect(SIMULADO_H_DATA_TOP).toBeCloseTo(133.45, 2);
    expect(SIMULADO_H_BOTTOM).toBe(2008);
    expect(SIMULADO_H_HEADER_BOT).toBeLessThan(SIMULADO_H_DATA_TOP);
    expect(SIMULADO_ROW_PITCH).toBeCloseTo(85.2069, 3);
    // 22 passos de pitch fecham a caixa de dados
    expect(SIMULADO_H_DATA_TOP + 22 * SIMULADO_ROW_PITCH).toBeCloseTo(SIMULADO_H_BOTTOM, 1);
  });

  it('colunas A..D dentro das células 1..4 (célula 0 = números)', () => {
    expect(SIMULADO_COLS).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      expect(SIMULADO_COLS[i]).toBeGreaterThan(SIMULADO_V[i + 1]);
      expect(SIMULADO_COLS[i]).toBeLessThan(SIMULADO_V[i + 2]);
    }
    expect(SIMULADO_NUM_X).toBeGreaterThan(SIMULADO_V[0]);
    expect(SIMULADO_NUM_X).toBeLessThan(SIMULADO_V[1]);
    expect(SIMULADO_HEADER_LABEL_Y).toBeGreaterThan(SIMULADO_H_TOP);
    expect(SIMULADO_HEADER_LABEL_Y).toBeLessThan(SIMULADO_H_HEADER_BOT);
  });

  it('22 questões, layout single, bolha maior que o disco amostrado', () => {
    expect(SIMULADO_MAX_QUESTIONS).toBe(22);
    expect(SIMULADO_LAYOUT).toBe('single');
    expect(SIMULADO_INNER_R).toBeLessThan(SIMULADO_BUBBLE_R - SIMULADO_BUBBLE_STROKE);
  });

  it('linhas de questão batem com o pitch', () => {
    expect(simuladoRowTop(1)).toBe(SIMULADO_H_DATA_TOP);
    expect(simuladoRowTop(SIMULADO_MAX_QUESTIONS) + SIMULADO_ROW_PITCH)
      .toBeCloseTo(SIMULADO_H_BOTTOM, 1);
    for (let q = 1; q <= SIMULADO_MAX_QUESTIONS; q++) {
      expect(Math.abs(simuladoRowCenter(q) - (simuladoRowTop(q) + SIMULADO_ROW_PITCH / 2)))
        .toBeLessThan(0.01);
      // clamp fora da faixa
      expect(simuladoRowTop(0)).toBe(simuladoRowTop(1));
      expect(simuladoRowTop(99)).toBe(simuladoRowTop(SIMULADO_MAX_QUESTIONS));
    }
  });

  it('centro das bolhas: coluna fixa + linha da questão', () => {
    expect(simuladoBubbleCenter(1, 0)).toEqual([SIMULADO_COLS[0], simuladoRowCenter(1)]);
    expect(simuladoBubbleCenter(22, 3)).toEqual([SIMULADO_COLS[3], simuladoRowCenter(22)]);
    // ci é limitado a 0..3
    expect(simuladoBubbleCenter(1, 9)[0]).toBe(SIMULADO_COLS[3]);
  });

  it('grade de bolhas cabe dentro da tabela (invariante do recorte)', () => {
    const g = simuladoGridExtent();
    const [x0, y0, x1, y1] = SIMULADO_TABLE;
    expect(g.x0).toBeGreaterThanOrEqual(x0);
    expect(g.y0).toBeGreaterThanOrEqual(y0);
    expect(g.x1).toBeLessThanOrEqual(x1);
    expect(g.y1).toBeLessThanOrEqual(y1);
    expect(g.x0).toBeLessThan(g.x1);
    expect(g.y0).toBeLessThan(g.y1);
  });
});
