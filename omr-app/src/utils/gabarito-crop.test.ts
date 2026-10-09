import { describe, it, expect } from 'vitest';
import { gabaritoCropBox, gabaritoGridBox, CROP_PAD } from './gabarito-crop';
import {
  CARD_WIDTH, CARD_HEIGHT,
  BUBBLE_RADIUS, PORTUGUESE_X, MATHEMATICS_X, questionYFor,
  SINGLE_X, SINGLE_BUBBLE_RADIUS, singleQuestionYFor,
} from './card-template';
import { SAE_BUBBLE_RADIUS, saeBubbleCenter } from './sae-template';
import { anchorBoxFor, type AnchorTemplate } from './anchors';

function inside(box: { x: number; y: number; w: number; h: number }) {
  expect(box.w).toBeGreaterThan(0);
  expect(box.h).toBeGreaterThan(0);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.w).toBeLessThanOrEqual(CARD_WIDTH);
  expect(box.y + box.h).toBeLessThanOrEqual(CARD_HEIGHT);
}

function toBox(b: { x0: number; y0: number; x1: number; y1: number }) {
  return { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 };
}

describe('gabaritoCropBox — recorte no limite das âncoras (0 px de respiro)', () => {
  it('padrao dual 22: recorte = quadro externo dos ArUcos 104px', () => {
    const box = gabaritoCropBox({
      questionsPerSubject: 22, layoutMode: 'dual', totalQuestions: 44,
      templateType: 'padrao',
    });
    inside(box);
    expect(box).toEqual(toBox({ x0: 86, y0: 479, x1: 1362, y1: 1928 }));
    expect(box.w).toBe(1276);
    expect(box.h).toBe(1449);
  });

  it('padrao single 10: âncoras não se movem com o layout', () => {
    const box = gabaritoCropBox({
      questionsPerSubject: 10, layoutMode: 'single', totalQuestions: 10,
      templateType: 'padrao',
    });
    inside(box);
    expect(box).toEqual(gabaritoCropBox({
      questionsPerSubject: 40, layoutMode: 'dual', totalQuestions: 80,
      templateType: 'padrao',
    }));
    // grade single continua dentro do quadro
    const ys = singleQuestionYFor(10);
    expect(box.x).toBeLessThanOrEqual(Math.min(...SINGLE_X) - SINGLE_BUBBLE_RADIUS);
    expect(box.y).toBeLessThanOrEqual(Math.min(...ys) - SINGLE_BUBBLE_RADIUS);
    expect(box.x + box.w).toBeGreaterThanOrEqual(Math.max(...SINGLE_X) + SINGLE_BUBBLE_RADIUS);
    expect(box.y + box.h).toBeGreaterThanOrEqual(Math.max(...ys) + SINGLE_BUBBLE_RADIUS);
  });

  it('padrao dual: envolve a grade inteira de LP+MAT', () => {
    const box = gabaritoCropBox({
      questionsPerSubject: 22, layoutMode: 'dual', totalQuestions: 44,
      templateType: 'padrao',
    });
    const ys = questionYFor(22);
    expect(box.x).toBeLessThanOrEqual(Math.min(...PORTUGUESE_X) - BUBBLE_RADIUS);
    expect(box.y).toBeLessThanOrEqual(Math.min(...ys) - BUBBLE_RADIUS);
    expect(box.x + box.w).toBeGreaterThanOrEqual(Math.max(...MATHEMATICS_X) + BUBBLE_RADIUS);
    expect(box.y + box.h).toBeGreaterThanOrEqual(Math.max(...ys) + BUBBLE_RADIUS);
  });

  it('sae 26: recorte = quadro dos quadrados 40px (64,1140 → 1384,1900)', () => {
    const box = gabaritoCropBox({
      questionsPerSubject: 26, layoutMode: 'single', totalQuestions: 26,
      templateType: 'sae',
    });
    inside(box);
    expect(box).toEqual(toBox({ x0: 64, y0: 1140, x1: 1384, y1: 1900 }));
    expect(box.w).toBe(1320);
    expect(box.h).toBe(760);
    const [fx, fy] = saeBubbleCenter(1, 0);
    const [lx, ly] = saeBubbleCenter(26, 3);
    expect(box.x).toBeLessThanOrEqual(fx - SAE_BUBBLE_RADIUS);
    expect(box.y).toBeLessThanOrEqual(fy - SAE_BUBBLE_RADIUS);
    expect(box.x + box.w).toBeGreaterThanOrEqual(lx + SAE_BUBBLE_RADIUS);
    expect(box.y + box.h).toBeGreaterThanOrEqual(ly + SAE_BUBBLE_RADIUS);
  });

  it('colar usa o mesmo recorte do sae', () => {
    const sae = gabaritoCropBox({
      questionsPerSubject: 26, layoutMode: 'single', totalQuestions: 26,
      templateType: 'sae',
    });
    const colar = gabaritoCropBox({
      questionsPerSubject: 26, layoutMode: 'single', totalQuestions: 26,
      templateType: 'colar',
    });
    expect(colar).toEqual(sae);
  });

  it('saev 22+22: recorte = quadro dos ArUcos (58,493 → 1390,1957) e contém a grade', () => {
    const box = gabaritoCropBox({
      questionsPerSubject: 22, layoutMode: 'dual', totalQuestions: 44,
      templateType: 'saev',
    });
    inside(box);
    expect(box).toEqual(toBox({ x0: 58, y0: 493, x1: 1390, y1: 1957 }));
    expect(box.w).toBe(1332);
    expect(box.h).toBe(1464);
  });

  it('simulado 22: recorte = a tabela inteira (309.55,40 → 1138.44,2008)', () => {
    const box = gabaritoCropBox({
      questionsPerSubject: 22, layoutMode: 'single', totalQuestions: 22,
      templateType: 'simulado',
    });
    inside(box);
    expect(box).toEqual(toBox({ x0: 309.55, y0: 40, x1: 1138.44, y1: 2008 }));
    // e é independente do layout, como as demais âncoras fixas
    expect(box).toEqual(gabaritoCropBox({
      questionsPerSubject: 22, layoutMode: 'dual', totalQuestions: 44,
      templateType: 'simulado',
    }));
  });
});

describe('gabaritoCropBox — invariantes âncoras ⊇ grade', () => {
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
    it(`${c.name}: âncoras contêm toda a grade`, () => {
      const exam = { questionsPerSubject: c.qps, layoutMode: c.layoutMode, totalQuestions: c.total, templateType: c.templateType };
      const crop = gabaritoCropBox(exam);
      const grid = gabaritoGridBox(exam);
      expect(crop.x).toBeLessThanOrEqual(grid.x);
      expect(crop.y).toBeLessThanOrEqual(grid.y);
      expect(crop.x + crop.w).toBeGreaterThanOrEqual(grid.x + grid.w);
      expect(crop.y + crop.h).toBeGreaterThanOrEqual(grid.y + grid.h);
      // e cabe na folha
      expect(crop.x + crop.w).toBeLessThanOrEqual(CARD_WIDTH);
      expect(crop.y + crop.h).toBeLessThanOrEqual(CARD_HEIGHT);
    });
  }

  it('quadro das âncoras é igual ao anchorBoxFor do guia de captura', () => {
    for (const t of ['padrao', 'sae', 'colar', 'saev', 'simulado'] as const) {
      const b = anchorBoxFor(t);
      expect(gabaritoCropBox({
        questionsPerSubject: 22, layoutMode: 'dual', totalQuestions: 44, templateType: t,
      })).toEqual(toBox(b));
    }
  });

  it('sem templateType legado cai no padrão', () => {
    expect(gabaritoCropBox({ questionsPerSubject: 22, layoutMode: 'dual', totalQuestions: 44 }))
      .toEqual(gabaritoCropBox({
        questionsPerSubject: 22, layoutMode: 'dual', totalQuestions: 44, templateType: 'padrao',
      }));
  });
});

describe('gabaritoCropBox — Herby (sem âncoras de canto, ainda)', () => {
  it('herby 22+22: contém primeira e última bolha de LP e MAT', () => {
    const box = gabaritoCropBox({
      questionsPerSubject: 22, layoutMode: 'dual', totalQuestions: 44,
      templateType: 'herby',
    });
    inside(box);
    const grid = gabaritoGridBox({
      questionsPerSubject: 22, layoutMode: 'dual', totalQuestions: 44,
      templateType: 'herby',
    });
    expect(box).toEqual({
      x: grid.x - CROP_PAD, y: grid.y - CROP_PAD,
      w: grid.w + 2 * CROP_PAD, h: grid.h + 2 * CROP_PAD,
    });
  });

  it('mantém o respiro de CROP_PAD fora da grade', async () => {
    const { herbyBubbleCenter, HERBY_SIDE } = await import('./herby-template');
    const exam = { questionsPerSubject: 22, layoutMode: 'dual' as const, totalQuestions: 44, templateType: 'herby' as const };
    const box = gabaritoCropBox(exam);
    const [fx, fy] = herbyBubbleCenter(0, 0, 0, 22);
    const h = HERBY_SIDE / 2;
    expect(box.x).toBeCloseTo(fx - h - CROP_PAD, 6);
    expect(box.y).toBeCloseTo(fy - h - CROP_PAD, 6);
  });

  it('herby single: crop só na metade esquerda', () => {
    const box = gabaritoCropBox({
      questionsPerSubject: 10, layoutMode: 'single', totalQuestions: 10,
      templateType: 'herby',
    });
    inside(box);
    expect(box.x + box.w).toBeLessThanOrEqual(750);
  });
});
