import { describe, it, expect } from 'vitest';
import { gabaritoCropBox, CROP_PAD } from './gabarito-crop';
import {
  CARD_WIDTH, CARD_HEIGHT,
  BUBBLE_RADIUS, PORTUGUESE_X, MATHEMATICS_X, questionYFor,
  SINGLE_X, SINGLE_BUBBLE_RADIUS, singleQuestionYFor,
} from './card-template';
import { SAE_BUBBLE_RADIUS, saeBubbleCenter } from './sae-template';

function inside(box: { x: number; y: number; w: number; h: number }) {
  expect(box.w).toBeGreaterThan(0);
  expect(box.h).toBeGreaterThan(0);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.w).toBeLessThanOrEqual(CARD_WIDTH);
  expect(box.y + box.h).toBeLessThanOrEqual(CARD_HEIGHT);
}

describe('gabaritoCropBox', () => {
  it('dual 22: envolve LP+MAT com respiro', () => {
    const box = gabaritoCropBox({
      questionsPerSubject: 22, layoutMode: 'dual', totalQuestions: 44,
      templateType: 'padrao',
    });
    inside(box);
    const ys = questionYFor(22);
    expect(box.x).toBeCloseTo(Math.min(...PORTUGUESE_X) - BUBBLE_RADIUS - CROP_PAD, 6);
    expect(box.x + box.w).toBeCloseTo(Math.max(...MATHEMATICS_X) + BUBBLE_RADIUS + CROP_PAD, 6);
    expect(box.y).toBeCloseTo(Math.min(...ys) - BUBBLE_RADIUS - CROP_PAD, 6);
    expect(box.y + box.h).toBeCloseTo(Math.max(...ys) + BUBBLE_RADIUS + CROP_PAD, 6);
    // bem menor que a folha inteira
    expect(box.w * box.h).toBeLessThan((CARD_WIDTH * CARD_HEIGHT) / 2);
  });

  it('single 10: usa colunas centrais', () => {
    const box = gabaritoCropBox({
      questionsPerSubject: 10, layoutMode: 'single', totalQuestions: 10,
      templateType: 'padrao',
    });
    inside(box);
    expect(box.x).toBeCloseTo(Math.min(...SINGLE_X) - SINGLE_BUBBLE_RADIUS - CROP_PAD, 6);
    const ys = singleQuestionYFor(10);
    expect(box.y + box.h).toBeCloseTo(Math.max(...ys) + SINGLE_BUBBLE_RADIUS + CROP_PAD, 6);
  });

  it('sae 26: contém primeira e última bolha', () => {
    const box = gabaritoCropBox({
      questionsPerSubject: 26, layoutMode: 'single', totalQuestions: 26,
      templateType: 'sae',
    });
    inside(box);
    const [fx, fy] = saeBubbleCenter(1, 0);
    const [lx, ly] = saeBubbleCenter(26, 3);
    expect(box.x).toBeLessThanOrEqual(fx - SAE_BUBBLE_RADIUS);
    expect(box.y).toBeLessThanOrEqual(fy - SAE_BUBBLE_RADIUS);
    expect(box.x + box.w).toBeGreaterThanOrEqual(lx + SAE_BUBBLE_RADIUS);
    expect(box.y + box.h).toBeGreaterThanOrEqual(ly + SAE_BUBBLE_RADIUS);
  });

  it('colar usa a mesma grade do sae', () => {
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

  it('saev 22+22: contém primeira e última bolha de LP e MAT', async () => {
    const { saevBubbleCenter } = await import('./saev-template');
    const { SAEV_SIDE } = await import('./saev-template');
    const box = gabaritoCropBox({
      questionsPerSubject: 22, layoutMode: 'dual', totalQuestions: 44,
      templateType: 'saev',
    });
    inside(box);
    const [fx, fy] = saevBubbleCenter(0, 0, 0, 22);
    const [lx, ly] = saevBubbleCenter(3, 10, 3, 22);
    const h = SAEV_SIDE / 2;
    expect(box.x).toBeLessThanOrEqual(fx - h);
    expect(box.y).toBeLessThanOrEqual(fy - h);
    expect(box.x + box.w).toBeGreaterThanOrEqual(lx + h);
    expect(box.y + box.h).toBeGreaterThanOrEqual(ly + h);
  });
});
