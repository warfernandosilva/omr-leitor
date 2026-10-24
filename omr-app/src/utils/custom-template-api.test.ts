import { describe, expect, it } from 'vitest';
import type { CustomBlock } from './custom-template-api';
import {
  expandBlock, moveBlockTo, removePageImage, shiftOverrides, withBubbleOverride, withoutBubbleOverride,
} from './custom-template-api';

function block(over: Partial<CustomBlock> = {}): CustomBlock {
  return {
    id: 'blk_test',
    type: 'bubble_block',
    first_x: 0.1,
    first_y: 0.2,
    option_step_x: 0.1,
    question_step_y: 0.05,
    column_step_x: null,
    columns: 1,
    n_questions: 2,
    labels: ['A', 'B', 'C', 'D'],
    radius: 0.02,
    shape: 'circle',
    start_question: 1,
    distribution: 'column',
    multi_answer: false,
    multi_marks_min: null,
    multi_marks_max: null,
    points: 1,
    annulled: false,
    pick_darkest_mark: false,
    darkest_mark_threshold: null,
    fallback_on_empty: false,
    fallback_floor: null,
    mark_style: 'filled',
    overrides: {},
    ...over,
  };
}

describe('expandBlock com ajustes individuais', () => {
  it('aplica a posição absoluta da bolha ajustada', () => {
    const out = expandBlock(block({ overrides: { '2': { B: { x: 0.42, y: 0.33 } } } }));
    const q2b = out.find((b) => b.question === 2 && b.option === 'B');
    expect(q2b?.x).toBeCloseTo(0.42);
    expect(q2b?.y).toBeCloseTo(0.33);
  });

  it('mantém as demais bolhas na grade do bloco', () => {
    const out = expandBlock(block({ overrides: { '2': { B: { x: 0.42, y: 0.33 } } } }));
    const q2a = out.find((b) => b.question === 2 && b.option === 'A');
    expect(q2a?.x).toBeCloseTo(0.1);
    expect(q2a?.y).toBeCloseTo(0.25);
    const q2c = out.find((b) => b.question === 2 && b.option === 'C');
    expect(q2c?.x).toBeCloseTo(0.3);
    expect(q2c?.y).toBeCloseTo(0.25);
  });

  it('aceita ajuste só em X ou só em Y', () => {
    const out = expandBlock(block({
      overrides: { '1': { A: { x: 0.15 } }, '2': { C: { y: 0.4 } } },
    }));
    const q1a = out.find((b) => b.question === 1 && b.option === 'A');
    expect(q1a?.x).toBeCloseTo(0.15);
    expect(q1a?.y).toBeCloseTo(0.2);
    const q2c = out.find((b) => b.question === 2 && b.option === 'C');
    expect(q2c?.x).toBeCloseTo(0.3);
    expect(q2c?.y).toBeCloseTo(0.4);
  });
});

describe('ajustes individuais do bloco', () => {
  it('adiciona e remove um override sem mexer nos demais', () => {
    let b = block({ overrides: { '2': { B: { x: 0.42, y: 0.33 } } } });
    b = withBubbleOverride(b, 3, 'D', 0.7, 0.6);
    expect(b.overrides['2'].B).toEqual({ x: 0.42, y: 0.33 });
    expect(b.overrides['3'].D).toEqual({ x: 0.7, y: 0.6 });

    b = withoutBubbleOverride(b, 2, 'B');
    expect(b.overrides['2']).toBeUndefined();
    b = withoutBubbleOverride(b, 3, 'D');
    expect(b.overrides).toEqual({});
  });

  it('move o bloco e desloca os overrides junto', () => {
    const b = block({ first_x: 0.1, first_y: 0.2, overrides: { '1': { A: { x: 0.15, y: 0.25 } } } });
    const moved = moveBlockTo(b, 0.3, 0.4);
    expect(moved.first_x).toBeCloseTo(0.3);
    expect(moved.first_y).toBeCloseTo(0.4);
    expect(moved.overrides['1'].A.x!).toBeCloseTo(0.35);
    expect(moved.overrides['1'].A.y!).toBeCloseTo(0.45);
  });

  it('não deixa o override sair da página ao mover', () => {
    const b = block({ first_x: 0.9, first_y: 0.9, overrides: { '1': { A: { x: 0.99, y: 0.99 } } } });
    const moved = moveBlockTo(b, 1, 1);
    expect(moved.overrides['1'].A.x!).toBe(1);
    expect(moved.overrides['1'].A.y!).toBe(1);
  });

  it('shiftOverrides preserva override só em um eixo', () => {
    const out = shiftOverrides({ '1': { A: { x: 0.2 } }, '2': { B: { y: 0.5 } } }, 0.1, 0.1);
    expect(out['1'].A.x!).toBeCloseTo(0.3);
    expect(out['1'].A.y).toBeUndefined();
    expect(out['2'].B.y!).toBeCloseTo(0.6);
    expect(out['2'].B.x).toBeUndefined();
  });
});

describe('removePageImage', () => {
  it('remove a página e reindexa as imagens seguintes', () => {
    const before = { '1': 'img_a', '2': 'img_b', '3': 'img_c' };
    expect(removePageImage(before, 2)).toEqual({ '1': 'img_a', '2': 'img_c' });
    expect(removePageImage(before, 1)).toEqual({ '1': 'img_b', '2': 'img_c' });
    expect(removePageImage(undefined, 1)).toEqual({});
  });
});
