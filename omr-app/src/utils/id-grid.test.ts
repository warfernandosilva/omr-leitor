import { describe, expect, it } from 'vitest';
import type { CustomIdGrid } from './custom-template-api';
import { idGridBubbles } from '../pages/CustomTemplatePage';

const grid = (over: Partial<CustomIdGrid> = {}): CustomIdGrid => ({
  id: 'idg_1', x: 0.1, y: 0.2, w: 0.4, h: 0.2,
  digits: 4, radius: 0.014, shape: 'circle', ...over,
});

describe('idGridBubbles', () => {
  it('gera 10 bolhas por dígito, dentro da caixa', () => {
    const out = idGridBubbles(grid());
    expect(out).toHaveLength(40);
    expect(new Set(out.map((b) => b.digit))).toEqual(new Set([1, 2, 3, 4]));
    expect(new Set(out.map((b) => b.value))).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    for (const b of out) {
      expect(b.x).toBeGreaterThanOrEqual(0.1);
      expect(b.x).toBeLessThanOrEqual(0.5);
      expect(b.y).toBeGreaterThanOrEqual(0.2);
      expect(b.y).toBeLessThanOrEqual(0.4);
    }
  });

  it('as linhas ficam em ordem crescente de valor', () => {
    const col1 = idGridBubbles(grid()).filter((b) => b.digit === 1);
    const ys = [...col1].sort((a, b) => a.value - b.value).map((b) => b.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    // linhas igualmente espaçadas (1/10 da altura)
    const gaps = col1.slice(1).map((b, i) => +(b.y - col1[i].y).toFixed(6));
    expect(new Set(gaps).size).toBe(1);
    expect(gaps[0]).toBeCloseTo(0.02);
  });

  it('as colunas ficam igualmente espaçadas e à direita', () => {
    const out = idGridBubbles(grid({ w: 0.4, digits: 4 }));
    const colW = 0.4 / 4;
    const first = out.filter((b) => b.digit === 1)[0];
    const second = out.filter((b) => b.digit === 2)[0];
    expect(second.x - first.x).toBeCloseTo(colW);
    // encostada na direita da coluna (centro + raio ≈ borda da coluna)
    expect(first.x + 0.014).toBeLessThanOrEqual(0.1 + colW);
  });

  it('limita dígitos absurdos', () => {
    expect(idGridBubbles(grid({ digits: 99 })).length).toBe(140); // 14 × 10
    expect(idGridBubbles(grid({ digits: 0 })).length).toBe(80);   // 0 cai no default 8
  });
});
