import { describe, it, expect } from 'vitest';
import { canonicalAnswer, scoreAnswers } from './exam';
import type { Exam } from '../types';

function exam(patch: Partial<Exam> = {}): Pick<Exam, 'answerKey' | 'totalQuestions'> {
  return {
    answerKey: { 1: 'A', 2: 'B', 3: 'C' },
    totalQuestions: 3,
    ...patch,
  };
}

describe('canonicalAnswer (múltipla resposta)', () => {
  it('normaliza ordem, caixa e separadores', () => {
    expect(canonicalAnswer('DA')).toBe('AD');
    expect(canonicalAnswer('a d')).toBe('AD');
    expect(canonicalAnswer('A,D')).toBe('AD');
    expect(canonicalAnswer('A')).toBe('A');
  });

  it('vazio/nulo vira string vazia', () => {
    expect(canonicalAnswer(undefined)).toBe('');
    expect(canonicalAnswer(null)).toBe('');
    expect(canonicalAnswer('')).toBe('');
  });

  it('múltipla resposta casa com o gabarito em qualquer ordem', () => {
    // Gabarito "DA" (conjunto) × leitura "AD" → acerto.
    expect(scoreAnswers(exam({ answerKey: { 1: 'DA', 2: 'B', 3: 'C' } }),
      { 1: 'AD', 2: 'B', 3: 'C' })).toEqual({ correct: 3, incorrect: 0, blank: 0 });
    // Conjunto diferente → erro.
    expect(scoreAnswers(exam({ answerKey: { 1: 'DA', 2: 'B', 3: 'C' } }),
      { 1: 'AB', 2: 'B', 3: 'C' })).toEqual({ correct: 2, incorrect: 1, blank: 0 });
  });
});

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
