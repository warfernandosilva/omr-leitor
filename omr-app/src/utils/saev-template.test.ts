import { describe, it, expect } from 'vitest';
import {
  saevRowsFor, saevRowYs, saevBlockRows, saevBubbleCenter,
  SAEV_COLS_X, SAEV_PITCH, SAEV_SIDE, SAEV_Y0, SAEV_Y1,
  SAEV_MIN_QPS, SAEV_MAX_QPS,
} from './saev-template';

describe('saev-template (espelha omr/template_saev.py)', () => {
  it('22+22: 44 questões, 11 linhas, LP=1..22 MAT=23..44', () => {
    const rows = saevBlockRows(22);
    expect(rows).toHaveLength(44);
    expect(saevRowsFor(22)).toBe(11);
    const ys = saevRowYs(22);
    expect(ys).toHaveLength(11);
    expect(ys[0]).toBe(SAEV_Y0);
    expect(ys[10]).toBe(SAEV_Y1);
    expect(rows.filter(([q]) => q <= 22)).toHaveLength(22);
    expect(rows.filter(([q]) => q > 22)).toHaveLength(22);
  });

  it('16+16 e 26+26 cabem na faixa', () => {
    expect(saevBlockRows(16)).toHaveLength(32);
    expect(saevBlockRows(26)).toHaveLength(52);
    expect(SAEV_MIN_QPS).toBe(16);
    expect(SAEV_MAX_QPS).toBe(26);
    for (const qps of [16, 22, 26]) {
      for (const y of saevRowYs(qps)) {
        expect(y).toBeGreaterThanOrEqual(SAEV_Y0);
        expect(y).toBeLessThanOrEqual(SAEV_Y1);
      }
    }
  });

  it('centros dentro do canvas e sem sobreposição', () => {
    for (const col of [0, 1, 2, 3]) {
      for (let r = 0; r < 11; r++) {
        const [xa, ya] = saevBubbleCenter(col, r, 0, 22);
        const [xd] = saevBubbleCenter(col, r, 3, 22);
        expect(xa).toBeGreaterThan(0);
        expect(xd).toBeLessThan(1448);
        expect(xd - xa).toBeCloseTo(3 * SAEV_PITCH, 6);
        expect(ya).toBeGreaterThanOrEqual(SAEV_Y0);
        expect(ya).toBeLessThanOrEqual(SAEV_Y1);
      }
      expect(SAEV_COLS_X[col + 1] ?? 1448).toBeGreaterThan(SAEV_COLS_X[col]);
    }
    expect(SAEV_SIDE).toBe(30);
  });
});
