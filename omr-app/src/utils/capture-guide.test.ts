import { describe, it, expect } from 'vitest';
import {
  guideRectFor, anchorTargetsFor, thresholdsFor, captureTemplateFor,
  fallbackGuide, CARD_ASPECT,
} from './capture-guide';
import { DEFAULT_THRESHOLDS } from './frame-guides';

// Proporção A4 em pixels a partir do guia + tamanho do visor
function pixelAspect(g: { x: number; y: number; w: number; h: number }, vw: number, vh: number): number {
  return ((g.w / 100) * vw) / ((g.h / 100) * vh);
}

describe('guideRectFor', () => {
  it('celular retrato: guia preserva a proporção A4 e cabe no visor', () => {
    const g = guideRectFor(360, 640);
    expect(pixelAspect(g, 360, 640)).toBeCloseTo(CARD_ASPECT, 3);
    expect(g.x).toBeGreaterThanOrEqual(0);
    expect(g.y).toBeGreaterThanOrEqual(0);
    expect(g.x + g.w).toBeLessThanOrEqual(100);
    expect(g.y + g.h).toBeLessThanOrEqual(100);
    // ocupa quase toda a largura no retrato
    expect(g.w).toBeGreaterThan(85);
  });

  it('celular paisagem: guia preserva A4 e cabe no visor', () => {
    const g = guideRectFor(640, 360);
    expect(pixelAspect(g, 640, 360)).toBeCloseTo(CARD_ASPECT, 3);
    expect(g.x + g.w).toBeLessThanOrEqual(100);
    expect(g.y + g.h).toBeLessThanOrEqual(100);
    expect(g.h).toBeGreaterThan(85);
  });

  it('visor quadrado: guia centralizado e sem distorção', () => {
    const g = guideRectFor(500, 500);
    expect(pixelAspect(g, 500, 500)).toBeCloseTo(CARD_ASPECT, 3);
    expect(g.x).toBeCloseTo((100 - g.w) / 2, 6);
    expect(g.y).toBeCloseTo((100 - g.h) / 2, 6);
  });

  it('visor inválido usa o fallback', () => {
    expect(guideRectFor(0, 0)).toEqual(fallbackGuide());
  });
});

describe('anchorTargetsFor', () => {
  const guide = guideRectFor(360, 640);

  it('alvos dos 3 modelos ficam dentro do guia', () => {
    for (const t of ['padrao', 'sae', 'colar'] as const) {
      const a = anchorTargetsFor(t, guide);
      for (const k of ['TL', 'TR', 'BR', 'BL'] as const) {
        expect(a[k].x).toBeGreaterThanOrEqual(guide.x);
        expect(a[k].x).toBeLessThanOrEqual(guide.x + guide.w);
        expect(a[k].y).toBeGreaterThanOrEqual(guide.y);
        expect(a[k].y).toBeLessThanOrEqual(guide.y + guide.h);
      }
    }
  });

  it('SAE/Colar têm alvos iguais (mesma geometria) e mais baixos que o padrão', () => {
    const sae = anchorTargetsFor('sae', guide);
    const colar = anchorTargetsFor('colar', guide);
    const pad = anchorTargetsFor('padrao', guide);
    expect(sae).toEqual(colar);
    // quadrados SAE ficam na zona da grade (metade inferior da folha)
    expect(sae.TL.y).toBeGreaterThan(50);
    // ArUco do padrão começa mais acima (cabeçalho com QR do aluno)
    expect(pad.TL.y).toBeLessThan(sae.TL.y);
    expect(pad.BL.y).toBeGreaterThan(sae.BL.y);
  });
});

describe('thresholdsFor / captureTemplateFor', () => {
  it('padrão usa os limiares genéricos', () => {
    expect(thresholdsFor('padrao')).toEqual(DEFAULT_THRESHOLDS);
  });

  it('SAE aceita âncoras menores e faixa de cobertura do quad menor', () => {
    const sae = thresholdsFor('sae');
    expect(sae.minAreaFrac).toBeLessThan(DEFAULT_THRESHOLDS.minAreaFrac);
    expect(sae.minCoverage).toBeLessThan(DEFAULT_THRESHOLDS.minCoverage);
    expect(sae.maxCoverage).toBeLessThan(DEFAULT_THRESHOLDS.maxCoverage);
    expect(thresholdsFor('colar')).toEqual(sae);
  });

  it('mapeia templateType da prova (legado = padrão)', () => {
    expect(captureTemplateFor(undefined)).toBe('padrao');
    expect(captureTemplateFor('padrao')).toBe('padrao');
    expect(captureTemplateFor('sae')).toBe('sae');
    expect(captureTemplateFor('colar')).toBe('colar');
  });
});
