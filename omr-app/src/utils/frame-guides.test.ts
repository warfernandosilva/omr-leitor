import { describe, it, expect } from 'vitest';
import { analyzeFrame, DEFAULT_THRESHOLDS } from './frame-guides';

const W = 320, H = 452;

function blank(): Uint8Array {
  return new Uint8Array(W * H).fill(200); // papel sob exposição normal (< maxBrightness)
}

function square(buf: Uint8Array, cx: number, cy: number, size: number, v = 10): void {
  const h = size >> 1;
  for (let y = Math.max(0, cy - h); y < Math.min(H, cy + h); y++) {
    for (let x = Math.max(0, cx - h); x < Math.min(W, cx + h); x++) {
      buf[y * W + x] = v;
    }
  }
}

function anchors(buf: Uint8Array, m = 30, s = 18): void {
  square(buf, m, m, s);
  square(buf, W - m, m, s);
  square(buf, W - m, H - m, s);
  square(buf, m, H - m, s);
}

describe('frame-guides', () => {
  it('trava com os 4 quadrados bem enquadrados', () => {
    const g = blank();
    anchors(g);
    const a = analyzeFrame(g, W, H);
    expect(a.found).toBe(4);
    expect(a.coverage).toBeGreaterThan(DEFAULT_THRESHOLDS.minCoverage);
    expect(a.locked).toBe(true);
  });

  it('pede os 4 cantos quando faltam', () => {
    const g = blank();
    square(g, 30, 30, 18);
    const a = analyzeFrame(g, W, H);
    expect(a.found).toBe(1);
    expect(a.locked).toBe(false);
    expect(a.hint).toContain('4 cantos');
  });

  it('pede para aproximar quando o cartão está longe', () => {
    const g = blank();
    // quadrados pequenos e juntos no centro (cartão longe)
    const c = 8;
    square(g, W / 2 - 20, H / 2 - 20, c);
    square(g, W / 2 + 20, H / 2 - 20, c);
    square(g, W / 2 + 20, H / 2 + 20, c);
    square(g, W / 2 - 20, H / 2 + 20, c);
    const a = analyzeFrame(g, W, H);
    expect(a.found).toBe(4);
    expect(a.locked).toBe(false);
    expect(a.hint).toContain('Aproxime');
  });

  it('rejeita mancha grande (não quadrado/âncora)', () => {
    const g = blank();
    // retângulo largo escuro no topo (ex.: sombra) — aspecto fora da faixa
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < W; x++) g[y * W + x] = 10;
    }
    const a = analyzeFrame(g, W, H);
    expect(a.found).toBe(0);
    expect(a.locked).toBe(false);
  });

  it('frame vazio não trava', () => {
    const a = analyzeFrame(blank(), W, H);
    expect(a.found).toBe(0);
    expect(a.locked).toBe(false);
  });

  it('buffer inválido não quebra', () => {
    const a = analyzeFrame(new Uint8Array(0), 0, 0);
    expect(a.locked).toBe(false);
  });
});
