import { describe, expect, it } from 'vitest';
import { bubbleBox, questionBubbleBoxes } from './ai-bubbles';
import { CARD_HEIGHT, CARD_WIDTH } from './card-template';
import { SAE_BUBBLE_RADIUS } from './sae-template';
import { unionBox } from './ai-crop';

const exam = { questionsPerSubject: 22, layoutMode: 'dual' as const };

describe('bubbleBox', () => {
  it('converte o canvas 1448×2048 em caixa normalizada', () => {
    const box = bubbleBox(100, 200, 10);
    expect(box.x).toBeCloseTo(90 / CARD_WIDTH, 9);
    expect(box.y).toBeCloseTo(190 / CARD_HEIGHT, 9);
    expect(box.w).toBeCloseTo(20 / CARD_WIDTH, 9);
    expect(box.h).toBeCloseTo(20 / CARD_HEIGHT, 9);
  });
});

describe('questionBubbleBoxes', () => {
  it('devolve as quatro bolhas do cartão padrão (LP e MAT)', () => {
    const lp = questionBubbleBoxes('padrao', exam, 1);
    const mat = questionBubbleBoxes('padrao', exam, 23);
    expect(lp).toHaveLength(4);
    expect(mat).toHaveLength(4);
    // A–D ficam lado a lado na mesma linha
    const ys = new Set(lp.map((b) => Math.round(b.y * 1e6)));
    expect(ys.size).toBe(1);
    expect(lp[0].x).toBeLessThan(lp[3].x);
  });

  it('mantém todas as caixas dentro da imagem', () => {
    for (const q of [1, 11, 22, 23, 44]) {
      for (const box of questionBubbleBoxes('padrao', exam, q)) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.w).toBeLessThanOrEqual(1);
        expect(box.y + box.h).toBeLessThanOrEqual(1);
      }
    }
  });

  it('usa o raio do SAE', () => {
    const boxes = questionBubbleBoxes('sae', exam, 3);
    expect(boxes).toHaveLength(4);
    expect(boxes[0].w).toBeCloseTo((2 * SAE_BUBBLE_RADIUS) / CARD_WIDTH, 9);
  });

  it('cobre as quatro bolhas com o recorte unido', () => {
    const boxes = questionBubbleBoxes('padrao', exam, 5);
    const crop = unionBox(boxes, 0.2);
    expect(crop).not.toBeNull();
    for (const b of boxes) {
      expect(crop!.x).toBeLessThanOrEqual(b.x);
      expect(crop!.y).toBeLessThanOrEqual(b.y);
      expect(crop!.x + crop!.w).toBeGreaterThanOrEqual(b.x + b.w);
      expect(crop!.y + crop!.h).toBeGreaterThanOrEqual(b.y + b.h);
    }
  });

  it('ignora questão fora do alcance do SAEV/Herby', () => {
    expect(questionBubbleBoxes('saev', exam, 0)).toEqual([]);
    expect(questionBubbleBoxes('saev', exam, 45)).toEqual([]);
    expect(questionBubbleBoxes('herby', exam, 45)).toEqual([]);
    expect(questionBubbleBoxes('saev', exam, 44)).toHaveLength(4);
  });

  it('devolve as bolhas do Simulado', () => {
    expect(questionBubbleBoxes('simulado', exam, 1)).toHaveLength(4);
    expect(questionBubbleBoxes('simulado', exam, 99)).toEqual([]);
  });

  it('exige a geometria da página no Gabarito Personalizado', () => {
    const bubbles = [
      { question: 1, option: 'A', x: 0.20, y: 0.30, r: 0.02, shape: 'circle' as const },
      { question: 1, option: 'B', x: 0.25, y: 0.30, r: 0.02, shape: 'circle' as const },
      { question: 2, option: 'A', x: 0.20, y: 0.35, r: 0.02, shape: 'circle' as const },
    ];
    const page = { bubbles, pageW: 1240, pageH: 1754 };
    expect(questionBubbleBoxes('custom', null, 1, null)).toEqual([]);
    expect(questionBubbleBoxes('custom', null, 1, { ...page, pageW: 0 })).toEqual([]);
    const boxes = questionBubbleBoxes('custom', null, 1, page);
    expect(boxes).toHaveLength(2);
    // raio normalizado ao maior lado da página
    expect(boxes[0].w).toBeCloseTo((2 * 0.02 * 1754) / 1240, 9);
    expect(boxes[0].h).toBeCloseTo((2 * 0.02 * 1754) / 1754, 9);
    // questão de outra página não tem caixa nesta imagem
    expect(questionBubbleBoxes('custom', null, 2, { ...page, bubbles: bubbles.slice(0, 2) })).toEqual([]);
  });

  it('sem prova não há caixa nos modelos fixos', () => {
    expect(questionBubbleBoxes('padrao', null, 1)).toEqual([]);
  });
});
