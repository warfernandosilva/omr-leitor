import { describe, it, expect } from 'vitest';
import { overlayRowFor, overlayBubbleFor, isSingleLayout } from './overlay-bubbles';
import {
  SINGLE_X, SINGLE_BUBBLE_RADIUS, singleQuestionYFor,
  PORTUGUESE_X, MATHEMATICS_X, BUBBLE_RADIUS, questionYFor,
} from './card-template';
import type { Exam } from '../types';

function exam(patch: Partial<Exam> = {}): Exam {
  return {
    id: 'E1', name: 'Prova', subjectLP: 'LP', subjectMat: 'MAT',
    questionsPerSubject: 10, totalQuestions: 10, createdAt: '',
    gradeScale: '0-10', answerKey: null, layoutMode: 'single',
    ...patch,
  };
}

describe('overlay-bubbles', () => {
  it('single usa as colunas centrais (SINGLE_X), Y single e raio 15', () => {
    const e = exam({ layoutMode: 'single', questionsPerSubject: 10 });
    expect(isSingleLayout(e)).toBe(true);
    const row = overlayRowFor(e, 1);
    expect(row.y).toBe(singleQuestionYFor(10)[0]);
    expect(row.r).toBe(SINGLE_BUBBLE_RADIUS);
    expect(row.cells.map(c => c.x)).toEqual(SINGLE_X);
    expect(row.cells.map(c => c.q)).toEqual([1, 1, 1, 1]);
    expect(row.cells.map(c => c.letter)).toEqual(['A', 'B', 'C', 'D']);
    // sem bloco de segunda disciplina
    expect(row.cells.every(c => c.q <= 10)).toBe(true);
    const last = overlayRowFor(e, 10);
    expect(last.y).toBe(singleQuestionYFor(10)[9]);
  });

  it('dual mantém a geometria atual (PORT/MAT, Y dual, raio 19.5)', () => {
    const e = exam({ layoutMode: 'dual', questionsPerSubject: 22, totalQuestions: 44 });
    expect(isSingleLayout(e)).toBe(false);
    const row = overlayRowFor(e, 1);
    expect(row.y).toBe(questionYFor(22)[0]);
    expect(row.r).toBe(BUBBLE_RADIUS);
    expect(row.cells.map(c => c.x)).toEqual([...PORTUGUESE_X, ...MATHEMATICS_X]);
    expect(row.cells.map(c => c.q)).toEqual([1, 1, 1, 1, 23, 23, 23, 23]);
  });

  it('overlayBubbleFor posiciona duplicadas na geometria certa', () => {
    const single = exam({ layoutMode: 'single', questionsPerSubject: 10 });
    const p = overlayBubbleFor(single, 4, 'D');
    expect(p).toEqual({ x: SINGLE_X[3], y: singleQuestionYFor(10)[3], r: SINGLE_BUBBLE_RADIUS });
    const dual = exam({ layoutMode: 'dual', questionsPerSubject: 22, totalQuestions: 44 });
    const m = overlayBubbleFor(dual, 30, 'B');
    expect(m).toEqual({ x: MATHEMATICS_X[1], y: questionYFor(22)[7], r: BUBBLE_RADIUS });
    expect(overlayBubbleFor(dual, 1, 'X')).toBeNull();
    expect(overlayBubbleFor(single, 99, 'A')).toBeNull();
  });
});
