import { describe, it, expect } from 'vitest';
import {
  HERBY_COLS_X, HERBY_PITCH, HERBY_SIDE, HERBY_Y0, HERBY_Y1,
  HERBY_MIN_QPS, HERBY_MAX_QPS, HERBY_QR_HEAD_POS, HERBY_QR_FOOT_POS,
  normalizeHerbyQr, herbyRowsFor, herbyRowYs, herbyBlockRows, herbyBubbleCenter,
} from './herby-template';

describe('herby-template (espelho do backend)', () => {
  it('constantes da folha real', () => {
    expect(HERBY_COLS_X).toEqual([193, 504, 815, 1127]);
    expect(HERBY_PITCH).toBe(40);
    expect(HERBY_SIDE).toBe(28);
    expect([HERBY_Y0, HERBY_Y1]).toEqual([650, 1785]);
    expect([HERBY_MIN_QPS, HERBY_MAX_QPS]).toEqual([1, 26]);
    expect(HERBY_QR_HEAD_POS).toEqual([121, 76]);
    expect(HERBY_QR_FOOT_POS).toEqual([458, 1849]);
  });

  it('normaliza magic link e ID', () => {
    expect(normalizeHerbyQr('https://hby.app?i4=GEW6rmMbj6oE')).toBe('GEW6rmMbj6oE');
    expect(normalizeHerbyQr('i4=GEW6rmMbj6oE')).toBe('GEW6rmMbj6oE');
    expect(normalizeHerbyQr('OMR-2026-000001')).toBe('OMR-2026-000001');
    expect(normalizeHerbyQr('https://omr.exemplo?codigo=OMR-2026-5')).toBe('OMR-2026-5');
  });

  it('qps variável 1..26', () => {
    expect(herbyRowsFor(1)).toBe(1);
    expect(herbyRowsFor(22)).toBe(11);
    expect(herbyRowsFor(26)).toBe(13);
    expect(herbyRowYs(22)).toHaveLength(11);
    expect(herbyRowYs(22)[0]).toBe(650);
    expect(herbyBlockRows(5)).toHaveLength(10);
    expect(herbyBlockRows(26)).toHaveLength(52);
  });

  it('centro coerente com grade', () => {
    const [x, y] = herbyBubbleCenter(0, 0, 0);
    expect(x).toBeCloseTo(193 + 16 + 20, 6);
    expect(y).toBe(650);
  });
});
