import { describe, it, expect } from 'vitest';
import {
  guideRectFor, guideRectForAspect, anchorTargetsFor, anchorTargetsForBox, customAnchorBox,
  thresholdsFor, captureTemplateFor, fallbackGuide, CARD_ASPECT, tapToFocusPoint,
} from './capture-guide';
import { DEFAULT_THRESHOLDS } from './frame-guides';
import { CARD_WIDTH, CARD_HEIGHT } from './card-template';

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

  it('alvos dos 5 modelos ficam dentro do guia', () => {
    for (const t of ['padrao', 'sae', 'colar', 'saev', 'herby', 'simulado'] as const) {
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

  it('SAEV aponta para os ArUco 104px (58,493 → 1390,1957), não para os quadrados 75px antigos', () => {
    const px = (fx: number) => guide.x + fx * guide.w;
    const py = (fy: number) => guide.y + fy * guide.h;
    const a = anchorTargetsFor('saev', guide);
    expect(a.TL.x).toBeCloseTo(px(58 / CARD_WIDTH), 10);
    expect(a.TL.y).toBeCloseTo(py(493 / CARD_HEIGHT), 10);
    expect(a.TR.x).toBeCloseTo(px(1390 / CARD_WIDTH), 10);
    expect(a.BR.x).toBeCloseTo(px(1390 / CARD_WIDTH), 10);
    expect(a.BR.y).toBeCloseTo(py(1957 / CARD_HEIGHT), 10);
    expect(a.BL.x).toBeCloseTo(px(58 / CARD_WIDTH), 10);
    expect(a.BL.y).toBeCloseTo(py(1957 / CARD_HEIGHT), 10);
    // regressão: o box antigo era 72.5/507.5/1375.5/1942.5
    expect(a.TL.y).not.toBeCloseTo(py(507.5 / CARD_HEIGHT), 10);
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
    expect(captureTemplateFor('saev')).toBe('saev');
    expect(captureTemplateFor('herby')).toBe('herby');
    expect(captureTemplateFor('simulado')).toBe('simulado');
  });

  it('Simulado: modo retângulo único (sem marcador de canto)', () => {
    const s = thresholdsFor('simulado');
    expect(s.singleRect).toBe(true);
    // a malha da tabela tem baixa densidade de tinta e enche o quadro
    expect(s.maxAreaFrac).toBeGreaterThan(DEFAULT_THRESHOLDS.maxAreaFrac);
    expect(s.minFillRatio).toBeLessThan(DEFAULT_THRESHOLDS.minFillRatio);
    expect(captureTemplateFor('simulado')).toBe('simulado');
  });

  it('alvos do Simulado caem sobre as quinas da tabela, dentro do guia', () => {
    const guide = guideRectFor(360, 640);
    const a = anchorTargetsFor('simulado', guide);
    const px = (fx: number) => guide.x + fx * guide.w;
    const py = (fy: number) => guide.y + fy * guide.h;
    expect(a.TL.x).toBeCloseTo(px(309.55 / CARD_WIDTH), 10);
    expect(a.TL.y).toBeCloseTo(py(40 / CARD_HEIGHT), 10);
    expect(a.BR.x).toBeCloseTo(px(1138.44 / CARD_WIDTH), 10);
    expect(a.BR.y).toBeCloseTo(py(2008 / CARD_HEIGHT), 10);
    for (const k of ['TL', 'TR', 'BR', 'BL'] as const) {
      expect(a[k].x).toBeGreaterThanOrEqual(guide.x);
      expect(a[k].x).toBeLessThanOrEqual(guide.x + guide.w);
      expect(a[k].y).toBeGreaterThanOrEqual(guide.y);
      expect(a[k].y).toBeLessThanOrEqual(guide.y + guide.h);
    }
  });

  it('SAEV tem alvos próprios (mais altos que SAE, limiares do padrão)', () => {
    const guide = guideRectFor(360, 640);
    const saev = anchorTargetsFor('saev', guide);
    const sae = anchorTargetsFor('sae', guide);
    expect(saev.TL.y).toBeLessThan(sae.TL.y);
    expect(thresholdsFor('saev')).toEqual(DEFAULT_THRESHOLDS);
  });
});

describe('guideRectForAspect / customAnchorBox / anchorTargetsForBox (Gabarito Personalizado)', () => {
  const anchors = [
    { x: 0.1, y: 0.1, size: 0.05 },
    { x: 0.9, y: 0.1, size: 0.05 },
    { x: 0.9, y: 0.9, size: 0.05 },
    { x: 0.1, y: 0.9, size: 0.05 },
  ];

  it('guideRectForAspect respeita a proporção da página do modelo', () => {
    // página retrato 1000×2000 → aspecto 0.5 (mais estreita que A4 ≈0.707)
    const g = guideRectForAspect(360, 640, 0.5);
    expect(pixelAspect(g, 360, 640)).toBeCloseTo(0.5, 3);
    // mais estreita que o guia A4 no mesmo visor (ambos limitados pela altura)
    expect(g.w).toBeLessThan(guideRectFor(360, 640).w);
  });

  it('guideRectFor equivale a guideRectForAspect com CARD_ASPECT', () => {
    expect(guideRectFor(360, 640)).toEqual(guideRectForAspect(360, 640, CARD_ASPECT));
  });

  it('customAnchorBox: BBox das âncoras com meia-largura (size/2) e clamp 0..1', () => {
    const b = customAnchorBox(anchors);
    expect(b.x0).toBeCloseTo(0.075, 10);
    expect(b.y0).toBeCloseTo(0.075, 10);
    expect(b.x1).toBeCloseTo(0.925, 10);
    expect(b.y1).toBeCloseTo(0.925, 10);
    // sem âncoras → página inteira
    expect(customAnchorBox([])).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
    // âncoras nas bordas não estouram 0..1
    expect(customAnchorBox([{ x: 0.0, y: 0.0, size: 0.1 }]))
      .toEqual({ x0: 0, y0: 0, x1: 0.05, y1: 0.05 });
  });

  it('anchorTargetsForBox projeta o BBox nas bordas do guia', () => {
    const box = customAnchorBox(anchors);
    const g = guideRectForAspect(360, 640, 0.5);
    const a = anchorTargetsForBox(box, g);
    expect(a.TL.x).toBeCloseTo(g.x + box.x0 * g.w, 10);
    expect(a.TL.y).toBeCloseTo(g.y + box.y0 * g.h, 10);
    expect(a.BR.x).toBeCloseTo(g.x + box.x1 * g.w, 10);
    expect(a.BR.y).toBeCloseTo(g.y + box.y1 * g.h, 10);
    for (const k of ['TL', 'TR', 'BR', 'BL'] as const) {
      expect(a[k].x).toBeGreaterThanOrEqual(g.x);
      expect(a[k].x).toBeLessThanOrEqual(g.x + g.w);
      expect(a[k].y).toBeGreaterThanOrEqual(g.y);
      expect(a[k].y).toBeLessThanOrEqual(g.y + g.h);
    }
  });
});

describe('tapToFocusPoint', () => {
  it('normaliza o toque para 0..1 (pointsOfInterest)', () => {
    expect(tapToFocusPoint(360, 640, 90, 160)).toEqual({ x: 0.25, y: 0.25 });
    expect(tapToFocusPoint(360, 640, 360, 640)).toEqual({ x: 1, y: 1 });
    expect(tapToFocusPoint(360, 640, 0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('limita (clamp) toques fora do visor', () => {
    expect(tapToFocusPoint(360, 640, -20, 900)).toEqual({ x: 0, y: 1 });
    expect(tapToFocusPoint(360, 640, 500, -5)).toEqual({ x: 1, y: 0 });
  });

  it('visor inválido: cai no centro', () => {
    expect(tapToFocusPoint(0, 640, 90, 160)).toEqual({ x: 0.5, y: 0.5 });
    expect(tapToFocusPoint(360, 0, 90, 160)).toEqual({ x: 0.5, y: 0.5 });
  });
});
