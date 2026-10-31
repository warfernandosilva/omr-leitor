import { describe, expect, it } from 'vitest';
import { unionBox } from './ai-crop';

describe('unionBox', () => {
  it('une as caixas com margem proporcional', () => {
    const box = unionBox([
      { x: 0.10, y: 0.20, w: 0.02, h: 0.02 },
      { x: 0.30, y: 0.20, w: 0.02, h: 0.02 },
    ], 0.15);
    expect(box).not.toBeNull();
    expect(box!.x).toBeLessThan(0.10);
    expect(box!.x + box!.w).toBeGreaterThan(0.32);
    expect(box!.y).toBeLessThan(0.20);
    expect(box!.y + box!.h).toBeGreaterThan(0.22);
  });

  it('limita ao quadro 0..1', () => {
    const box = unionBox([{ x: 0, y: 0, w: 1, h: 1 }], 0.5);
    expect(box).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('ignora caixas inválidas', () => {
    expect(unionBox([])).toBeNull();
    expect(unionBox([{ x: 0.1, y: 0.1, w: 0, h: 0.2 }])).toBeNull();
    expect(unionBox([{ x: Number.NaN, y: 0.1, w: 0.2, h: 0.2 }])).toBeNull();
  });

  it('aceita uma única caixa', () => {
    const box = unionBox([{ x: 0.5, y: 0.5, w: 0.01, h: 0.01 }], 0);
    expect(box).not.toBeNull();
    expect(box!.x).toBeCloseTo(0.495, 6);
    expect(box!.y).toBeCloseTo(0.495, 6);
    expect(box!.w).toBeCloseTo(0.02, 6);
    expect(box!.h).toBeCloseTo(0.02, 6);
  });
});
