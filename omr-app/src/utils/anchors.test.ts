import { describe, it, expect } from 'vitest';
import { anchorBoxFor, normalizedAnchorBox, type AnchorTemplate } from './anchors';
import { gabaritoGridBox } from './gabarito-crop';
import { CARD_WIDTH, CARD_HEIGHT, ARUCO_CENTERS, ARUCO_MARKER_SIZE } from './card-template';
import { SAE_CORNER_CENTERS, SAE_CORNER_SIZE } from './sae-template';
import { SAEV_CORNER_CENTERS, SAEV_CORNER_SIZE } from './saev-template';

describe('anchorBoxFor — valores absolutos (canvas 1448×2048, 0 px de respiro)', () => {
  it('padrao: ArUco 104px → 86,479 → 1362,1928', () => {
    expect(anchorBoxFor('padrao')).toEqual({ x0: 86, y0: 479, x1: 1362, y1: 1928 });
    expect(ARUCO_MARKER_SIZE).toBe(104);
    expect(ARUCO_CENTERS.TL).toEqual({ x: 138, y: 531 });
    expect(ARUCO_CENTERS.BR).toEqual({ x: 1310, y: 1876 });
  });

  it('saev: ArUco 104px → 58,493 → 1390,1957 (era 75px: 72.5,507.5 → 1375.5,1942.5)', () => {
    expect(anchorBoxFor('saev')).toEqual({ x0: 58, y0: 493, x1: 1390, y1: 1957 });
    expect(SAEV_CORNER_SIZE).toBe(104);
    expect(SAEV_CORNER_CENTERS.TL).toEqual([110, 545]);
    expect(SAEV_CORNER_CENTERS.BR).toEqual([1338, 1905]);
  });

  it('sae/colar: quadrado 40px → 64,1140 → 1384,1900', () => {
    expect(anchorBoxFor('sae')).toEqual({ x0: 64, y0: 1140, x1: 1384, y1: 1900 });
    expect(anchorBoxFor('colar')).toEqual(anchorBoxFor('sae'));
    expect(SAE_CORNER_SIZE).toBe(40);
    expect(SAE_CORNER_CENTERS.TL).toEqual([84, 1160]);
    expect(SAE_CORNER_CENTERS.BR).toEqual([1364, 1880]);
  });

  it('herby: ainda aproximação (QR + margem), pendente dos retângulos pretos', () => {
    expect(anchorBoxFor('herby')).toEqual({ x0: 121, y0: 76, x1: 1327, y1: 1950 });
  });

  it('simulado: sem marcador — as 4 quinas da tabela são as âncoras', () => {
    expect(anchorBoxFor('simulado')).toEqual({ x0: 309.55, y0: 40, x1: 1138.44, y1: 2008 });
  });
});

describe('normalizedAnchorBox — proporção 0..1', () => {
  it('divide por 1448×2048 e bate com o box absoluto', () => {
    for (const t of ['padrao', 'sae', 'colar', 'saev', 'herby', 'simulado'] as AnchorTemplate[]) {
      const abs = anchorBoxFor(t);
      const n = normalizedAnchorBox(t);
      expect(n.x0).toBeCloseTo(abs.x0 / CARD_WIDTH, 12);
      expect(n.y0).toBeCloseTo(abs.y0 / CARD_HEIGHT, 12);
      expect(n.x1).toBeCloseTo(abs.x1 / CARD_WIDTH, 12);
      expect(n.y1).toBeCloseTo(abs.y1 / CARD_HEIGHT, 12);
      expect(n.x0).toBeGreaterThanOrEqual(0);
      expect(n.y0).toBeGreaterThanOrEqual(0);
      expect(n.x1).toBeLessThanOrEqual(1);
      expect(n.y1).toBeLessThanOrEqual(1);
    }
  });
});

describe('anchorBoxFor × gabaritoGridBox — âncoras contêm a grade', () => {
  const casos: { name: string; templateType: AnchorTemplate; qps: number; total: number; layoutMode: 'single' | 'dual' }[] = [
    { name: 'padrao dual 22', templateType: 'padrao', qps: 22, total: 44, layoutMode: 'dual' },
    { name: 'padrao single 10', templateType: 'padrao', qps: 10, total: 10, layoutMode: 'single' },
    { name: 'padrao dual 40', templateType: 'padrao', qps: 40, total: 80, layoutMode: 'dual' },
    { name: 'saev dual 22', templateType: 'saev', qps: 22, total: 44, layoutMode: 'dual' },
    { name: 'saev single 26', templateType: 'saev', qps: 26, total: 26, layoutMode: 'single' },
    { name: 'sae 26', templateType: 'sae', qps: 26, total: 26, layoutMode: 'single' },
    { name: 'colar 26', templateType: 'colar', qps: 26, total: 26, layoutMode: 'single' },
    { name: 'simulado 22', templateType: 'simulado', qps: 22, total: 22, layoutMode: 'single' },
  ];

  for (const c of casos) {
    it(`${c.name}: âncoras ⊇ grade`, () => {
      const b = anchorBoxFor(c.templateType);
      const g = gabaritoGridBox({
        questionsPerSubject: c.qps, layoutMode: c.layoutMode, totalQuestions: c.total,
        templateType: c.templateType,
      });
      expect(b.x0).toBeLessThanOrEqual(g.x);
      expect(b.y0).toBeLessThanOrEqual(g.y);
      expect(b.x1).toBeGreaterThanOrEqual(g.x + g.w);
      expect(b.y1).toBeGreaterThanOrEqual(g.y + g.h);
    });
  }
});
