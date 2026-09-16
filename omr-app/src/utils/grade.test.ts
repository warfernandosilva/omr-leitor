import { describe, it, expect } from 'vitest';
import { calculateGrade } from './grade';
import { questionYFor } from './card-template';

describe('calculateGrade', () => {
  it('0-10 escala', () => expect(calculateGrade(20, 22, '0-10')).toBe(9.1));
  it('count escala', () => expect(calculateGrade(5, 10, 'count')).toBe(5));
  it('0-100 escala', () => expect(calculateGrade(22, 22, '0-100')).toBe(100));
});

describe('questionYFor', () => {
  it('22 questões deve ter LEGACY exato', () => {
    const ys = questionYFor(22);
    expect(ys[0]).toBe(653);
    expect(ys[21]).toBe(1756);
  });
});
