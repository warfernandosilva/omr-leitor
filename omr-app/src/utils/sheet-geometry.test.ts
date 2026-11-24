import { describe, expect, it } from 'vitest';
import {
  MM_PX, clampZoom, findSnapMm, fitZoom, mmToPx, pxToMm, resizeRectMm, rulerTicks,
  snapResizeMm, snapToGrid, snapToGridWithin, squareResizeMm, zoomStep, type RectMm,
} from './sheet-geometry';

const r = (x: number, y: number, w = 40, h = 20): RectMm => ({ x, y, w, h });

describe('zoom', () => {
  it('usa níveis discretos do protótipo', () => {
    expect(zoomStep(1, 1)).toBe(1.25);
    expect(zoomStep(1, -1)).toBe(0.85);
    expect(zoomStep(0.25, -1)).toBe(0.25);
    expect(zoomStep(2, 1)).toBe(2);
    expect(clampZoom(9)).toBe(2);
    expect(clampZoom(0.01)).toBe(0.25);
  });

  it('ajusta a folha à tela com folga de 76 px e piso de 2 casas', () => {
    // 800 px de altura útil para 297 mm: 0.63…
    const z = fitZoom(1000, 800, 210, 297);
    expect(z).toBeLessThan(0.7);
    expect(z).toBeGreaterThan(0.5);
    // Arredondado para baixo em duas casas.
    expect(z).toBe(Math.floor(z * 100) / 100);
  });

  it('nunca passa dos limites nem de zero', () => {
    expect(fitZoom(10, 10, 210, 297)).toBe(0.25);
    expect(fitZoom(10000, 10000, 210, 297)).toBe(2);
  });
});

describe('conversão mm ↔ px', () => {
  it('usa 96 dpi e o zoom aplicado', () => {
    expect(mmToPx(10, 1)).toBeCloseTo(10 * MM_PX, 6);
    expect(mmToPx(10, 2)).toBeCloseTo(20 * MM_PX, 6);
    expect(pxToMm(mmToPx(37, 1.5), 1.5)).toBeCloseTo(37, 6);
  });
});

describe('resizeRectMm', () => {
  it('arrasta a alça leste e respeita o mínimo', () => {
    expect(resizeRectMm(r(10, 10), 'e', 12, 0, 18, 14, 210, 297)).toEqual({ x: 10, y: 10, w: 52, h: 20 });
    expect(resizeRectMm(r(10, 10, 20, 20), 'e', -100, 0, 18, 14, 210, 297).w).toBe(18);
  });

  it('arrasta a alça noroeste movendo posição e tamanho', () => {
    expect(resizeRectMm(r(40, 40), 'nw', -10, -5, 2, 2, 210, 297)).toEqual({ x: 30, y: 35, w: 50, h: 25 });
  });

  it('não deixa passar da página', () => {
    const out = resizeRectMm(r(180, 270, 20, 20), 'se', 100, 100, 2, 2, 210, 297);
    expect(out.x + out.w).toBeLessThanOrEqual(210);
    expect(out.y + out.h).toBeLessThanOrEqual(297);
  });
});

describe('findSnapMm', () => {
  it('encosta na borda esquerda da página', () => {
    const s = findSnapMm(r(0.8, 120), [], 210, 297);
    expect(s.dx).toBeCloseTo(-0.8, 6);
    expect(s.guidesX).toEqual([0]);
  });

  it('centraliza no meio da página', () => {
    const s = findSnapMm(r(120, 120, 40, 20), [], 210, 297);
    // bordas em 120/140/160: nenhuma perto de 0, 105 ou 210.
    expect(s.dx).toBe(0);
    const centered = findSnapMm(r(84.2, 120, 40, 20), [], 210, 297);
    // centro em 104,2; meio da página em 105 → encosta.
    expect(centered.dx).toBeCloseTo(0.8, 6);
    expect(centered.guidesX).toEqual([105]);
  });

  it('usa bordas dos outros elementos e devolve guia', () => {
    const other = r(100, 10, 40, 20);
    const s = findSnapMm(r(99.2, 50), [other], 210, 297);
    expect(s.dx).toBeCloseTo(0.8, 6);
    expect(s.guidesX).toEqual([100]);
  });

  it('ignora o que está fora da tolerância', () => {
    const other = r(100, 10, 40, 20);
    const s = findSnapMm(r(90, 50, 4.4, 20), [other], 210, 297);
    expect(s.dx).toBe(0);
    expect(s.guidesX).toEqual([]);
  });
});

describe('grade', () => {
  it('encaixa no quadradinho de 5 mm mais próximo', () => {
    expect(snapToGrid(12.3)).toBe(10);
    expect(snapToGrid(12.6)).toBe(15);
    expect(snapToGrid(52.4)).toBe(50);
    expect(snapToGrid(52.5)).toBe(55);
  });

  it('mantém a folha como limite e continua na grade', () => {
    expect(snapToGridWithin(103, 210)).toBe(105);
    // 205 passaria do limite de 200 mm: o limite domina.
    expect(snapToGridWithin(208, 200)).toBe(200);
    expect(snapToGridWithin(207.4, 200)).toBe(200);
    expect(snapToGridWithin(60, -20)).toBe(0);
  });
});

describe('snapResizeMm', () => {
  it('encaixa só a aresta que a alça mexe', () => {
    // Alça leste: 33 + 20 = 53 mm → encaixa em 55 mm.
    expect(snapResizeMm(r(33, 22, 20, 14), 'e', 18, 14, 210, 297))
      .toEqual({ x: 33, y: 22, w: 22, h: 14 });
    // Alça oeste: esquerda 33 → 35 mm; a direita fica em 90 mm.
    expect(snapResizeMm(r(33, 22, 57, 14), 'w', 18, 14, 210, 297))
      .toEqual({ x: 35, y: 22, w: 55, h: 14 });
  });

  it('encaixa os dois eixos nas alças de canto', () => {
    // 33 + 44 = 77 → 75 mm; 22 + 16 = 38 → 40 mm.
    expect(snapResizeMm(r(33, 22, 44, 16), 'se', 18, 14, 210, 297))
      .toEqual({ x: 33, y: 22, w: 42, h: 18 });
    // 33 → 35 mm; 22 → 20 mm (bordas opostas ficam em 77 e 38 mm).
    expect(snapResizeMm(r(33, 22, 44, 16), 'nw', 18, 14, 210, 297))
      .toEqual({ x: 35, y: 20, w: 42, h: 18 });
  });

  it('respeita o tamanho mínimo e a borda da página', () => {
    const shrink = snapResizeMm(r(33, 22, 42, 16), 'e', 18, 14, 210, 297);
    expect(shrink.w).toBeGreaterThanOrEqual(18);
    // 200 + 42 passaria da folha: encaixa na borda, sem estourar 210 mm.
    const right = snapResizeMm(r(200, 22, 42, 16), 'e', 2, 2, 210, 297);
    expect(right.x + right.w).toBeLessThanOrEqual(210);
  });
});

describe('squareResizeMm', () => {
  it('mantém quadrado a partir do canto e fixa a borda oposta', () => {
    // Original 20 × 20 em (20, 20); alça SE puxa para 34 × 28 → lado 34.
    expect(squareResizeMm(r(20, 20, 34, 28), r(20, 20, 20, 20), 'se', 6, 210, 297))
      .toEqual({ x: 20, y: 20, w: 34, h: 34 });
    // Alça NW: direita/baixo continuam em 40 mm.
    expect(squareResizeMm(r(6, 6, 34, 28), r(20, 20, 20, 20), 'nw', 6, 210, 297))
      .toEqual({ x: 6, y: 6, w: 34, h: 34 });
  });

  it('nas alças de lado preserva o centro do outro eixo', () => {
    // Alça L: lado 30; o centro vertical (30 mm) fica no meio.
    expect(squareResizeMm(r(20, 20, 30, 20), r(20, 20, 20, 20), 'e', 6, 210, 297))
      .toEqual({ x: 20, y: 15, w: 30, h: 30 });
    // Alça N: lado 30; centro horizontal (30 mm) fica no meio.
    expect(squareResizeMm(r(20, 10, 20, 30), r(20, 20, 20, 20), 'n', 6, 210, 297))
      .toEqual({ x: 15, y: 10, w: 30, h: 30 });
  });

  it('respeita o mínimo e a borda da página', () => {
    const small = squareResizeMm(r(20, 20, 2, 2), r(20, 20, 20, 20), 'se', 6, 210, 297);
    expect(small.w).toBe(6);
    const atEdge = squareResizeMm(r(200, 20, 30, 30), r(200, 20, 20, 20), 'e', 6, 210, 297);
    expect(atEdge.x + atEdge.w).toBeLessThanOrEqual(210);
  });
});

describe('rulerTicks', () => {
  it('marca a cada 5 mm com maiores a cada 10', () => {
    const ticks = rulerTicks(21);
    expect(ticks.map((t) => t.mm)).toEqual([0, 5, 10, 15, 20]);
    expect(ticks.filter((t) => t.major).map((t) => t.mm)).toEqual([0, 10, 20]);
  });

  it('em zoom baixo rotula só a cada 20 mm', () => {
    const ticks = rulerTicks(45, 5, 10, 20);
    expect(ticks.filter((t) => t.label).map((t) => t.mm)).toEqual([0, 20, 40]);
  });
});
