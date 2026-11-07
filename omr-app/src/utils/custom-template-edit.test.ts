import { describe, expect, it } from 'vitest';
import {
  alignRects, alignToMargin, clampRect, distributeRects, organizeRects, snapDelta,
} from './custom-template-edit';

const r = (x: number, y: number, w = 0.1, h = 0.05) => ({ x, y, w, h });

describe('clampRect', () => {
  it('mantém dentro da página', () => {
    expect(clampRect(r(0.95, 0.98))).toEqual({ x: 0.9, y: 0.95, w: 0.1, h: 0.05 });
    expect(clampRect(r(-0.2, -1))).toEqual({ x: 0, y: 0, w: 0.1, h: 0.05 });
  });

  it('encolhe o que é maior que a página', () => {
    const out = clampRect({ x: 0, y: 0, w: 2, h: 3 });
    expect(out.w).toBe(1);
    expect(out.h).toBe(1);
  });
});

describe('alignRects', () => {
  it('alinhar à esquerda usa a borda mais à esquerda', () => {
    const out = alignRects([r(0.3, 0.1), r(0.1, 0.5), r(0.5, 0.9)], 'left');
    expect(out.map((o) => o.x)).toEqual([0.1, 0.1, 0.1]);
    expect(out.map((o) => o.y)).toEqual([0.1, 0.5, 0.9]);
  });

  it('alinhar à direita usa a borda mais à direita', () => {
    const out = alignRects([r(0.1, 0, 0.2), r(0.4, 0, 0.1)], 'right');
    expect(out[0].x).toBeCloseTo(0.3);
    expect(out[1].x).toBeCloseTo(0.4);
  });

  it('centraliza no eixo vertical', () => {
    const out = alignRects([r(0, 0.1), r(0, 0.5, 0.1, 0.1)], 'vcenter');
    const centers = out.map((o) => o.y + o.h / 2);
    expect(centers[0]).toBeCloseTo(centers[1]);
  });

  it('com menos de dois não mexe', () => {
    const one = [r(0.3, 0.3)];
    expect(alignRects(one, 'left')).toEqual(one);
  });
});

describe('distributeRects', () => {
  it('espaça igualmente entre o primeiro e o último', () => {
    const out = distributeRects([r(0.1, 0, 0.1), r(0.2, 0, 0.1), r(0.8, 0, 0.1)], 'x');
    expect(out[0].x).toBeCloseTo(0.1);
    expect(out[2].x).toBeCloseTo(0.8);
    expect(out[1].x).toBeCloseTo(0.45);
  });

  it('não mexe com dois elementos', () => {
    const two = [r(0.1, 0), r(0.6, 0)];
    expect(distributeRects(two, 'x')).toEqual(two);
  });
});

describe('alignToMargin', () => {
  it('ignora a seleção e alinha pela margem da página', () => {
    const out = alignToMargin([r(0.6, 0.7, 0.2, 0.1), r(0.1, 0.2, 0.05, 0.05)], 'left', 0.05);
    expect(out.map((o) => o.x)).toEqual([0.05, 0.05]);
  });

  it('à direita encosta na borda menos a margem', () => {
    const out = alignToMargin([r(0, 0, 0.3, 0.1)], 'right', 0.06);
    expect(out[0].x).toBeCloseTo(1 - 0.06 - 0.3);
  });

  it('topo e base também usam a margem', () => {
    expect(alignToMargin([r(0, 0, 0.1, 0.2)], 'top', 0.04)[0].y).toBeCloseTo(0.04);
    expect(alignToMargin([r(0, 0, 0.1, 0.2)], 'bottom', 0.04)[0].y).toBeCloseTo(0.96 - 0.2);
  });
});

describe('organizeRects', () => {
  it('empilha na ordem visual com folga fixa, a partir da margem', () => {
    const out = organizeRects([r(0.5, 0.5, 0.1, 0.05), r(0.1, 0.1, 0.1, 0.05)], 0.05, 0.02);
    expect(out[1].y).toBeCloseTo(0.05);          // o de cima primeiro
    expect(out[0].y).toBeCloseTo(0.05 + 0.05 + 0.02);
    expect(out.every((o) => o.x === 0.05)).toBe(true);
  });

  it('estourando a altura, começa uma coluna nova', () => {
    const many = Array.from({ length: 12 }, (_, i) => r(0.1, (i * 3) / 100, 0.1, 0.08));
    const out = organizeRects(many, 0.05, 0.02, 0.45);
    expect(out.every((o) => o.y <= 1 - o.h + 1e-9)).toBe(true);
    // pelo menos uma coluna diferente da primeira
    expect(new Set(out.map((o) => o.x)).size).toBeGreaterThan(1);
    // todas dentro da página
    for (const o of out) {
      expect(o.x).toBeGreaterThanOrEqual(0);
      expect(o.x + o.w).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('com um elemento só, apenas o posiciona na margem', () => {
    const out = organizeRects([r(0.8, 0.9)], 0.05, 0.02);
    expect(out[0].x).toBe(0.05);
    expect(out[0].y).toBe(0.05);
  });

  it('lista vazia não estoura', () => {
    expect(organizeRects([])).toEqual([]);
  });
});

describe('snapDelta', () => {
  it('encosta na borda de outro elemento e devolve a guia', () => {
    // borda direita (0.202) está a 0.002 da borda esquerda do vizinho (0.2)
    const out = snapDelta(r(0.102, 0.5), [r(0.2, 0.5)], 0.005, 0.004);
    expect(out.dx).toBeCloseTo(-0.002);
    expect(out.guidesX).toEqual([0.2]);
  });

  it('sem vizinho cai na grade', () => {
    const out = snapDelta(r(0.1012, 0.3031), [], 0.005, 0.004);
    expect(out.dx).toBeCloseTo(0.1 - 0.1012, 5);
    expect(out.dy).toBeCloseTo(0.305 - 0.3031, 5);
    expect(out.guidesX).toEqual([]);
  });

  it('ignora o que está longe', () => {
    const out = snapDelta(r(0.5, 0.5), [r(0.9, 0.9)], 0.5, 0.004);
    expect(out.guidesX).toEqual([]);
    expect(out.guidesY).toEqual([]);
  });
});
