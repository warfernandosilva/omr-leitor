import { describe, it, expect } from 'vitest';
import { scoreAnswers } from './exam';
import type { Exam } from '../types';

function exam(patch: Partial<Exam> = {}): Pick<Exam, 'answerKey' | 'totalQuestions'> {
  return {
    answerKey: { 1: 'A', 2: 'B', 3: 'C' },
    totalQuestions: 3,
    ...patch,
  };
}

describe('scoreAnswers (política única)', () => {
  it('conta acerto/erro/branco', () => {
    expect(scoreAnswers(exam(), { 1: 'A', 2: 'X' })).toEqual({ correct: 1, incorrect: 1, blank: 1 });
  });

  it('duplicada não resolvida = erro (não branco)', () => {
    expect(scoreAnswers(exam(), { 1: 'A' }, [2])).toEqual({ correct: 1, incorrect: 1, blank: 1 });
  });

  it('duplicada resolvida manualmente volta a valer', () => {
    expect(scoreAnswers(exam(), { 1: 'A', 2: 'B' }, [2])).toEqual({ correct: 2, incorrect: 0, blank: 1 });
  });

  it('sem gabarito na questão = erro', () => {
    expect(scoreAnswers(exam({ answerKey: { 1: 'A' } }), { 1: 'A', 2: 'B', 3: 'C' }))
      .toEqual({ correct: 1, incorrect: 2, blank: 0 });
  });
});
