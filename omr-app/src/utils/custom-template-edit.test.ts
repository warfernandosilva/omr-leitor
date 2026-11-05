import { describe, expect, it } from 'vitest';
import {
  alignRects, clampRect, distributeRects, snapDelta,
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
