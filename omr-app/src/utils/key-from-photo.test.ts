import { describe, it, expect } from 'vitest';
import { keyFromProcessResult } from './key-from-photo';
import type { ProcessResult } from './api';

function result(patch: Partial<ProcessResult> = {}): ProcessResult {
  return { success: true, ...patch };
}

describe('keyFromProcessResult', () => {
  it('monta o gabarito só com questões dentro da prova', () => {
    const r = keyFromProcessResult(
      result({ answers: { 1: 'A', 2: 'C', 44: 'D', 99: 'B' } }),
      44,
    );
    expect(r.key).toEqual({ 1: 'A', 2: 'C', 44: 'D' });
    expect(r.readCount).toBe(3);
  });

  it('marca brancas e duplicadas para revisão (fora do gabarito)', () => {
    const r = keyFromProcessResult(
      result({
        answers: { 1: 'A', 3: 'B', 5: 'D' },
        blankQuestions: [2, 4, 60],
        duplicateQuestions: [6, 7],
      }),
      10,
    );
    expect(r.key).toEqual({ 1: 'A', 3: 'B', 5: 'D' });
    expect(r.flags).toEqual({ 2: 'blank', 4: 'blank', 6: 'duplicate', 7: 'duplicate' });
    expect(r.blankCount).toBe(2); // 60 está fora da prova
    expect(r.duplicateCount).toBe(2);
  });

  it('baixa confiança mantém a resposta mas sinaliza revisão', () => {
    const r = keyFromProcessResult(
      result({ answers: { 2: 'B' }, lowConfidence: [2] }),
      10,
    );
    expect(r.key).toEqual({ 2: 'B' });
    expect(r.flags).toEqual({ 2: 'low' });
    expect(r.lowCount).toBe(1);
  });

  it('duplicada tem prioridade sobre baixa confiança', () => {
    const r = keyFromProcessResult(
      result({ answers: {}, duplicateQuestions: [3], lowConfidence: [3] }),
      10,
    );
    expect(r.flags[3]).toBe('duplicate');
  });

  it('avisa quando o modelo detectado difere do esperado', () => {
    const r = keyFromProcessResult(
      result({ answers: { 1: 'A' }, templateUsed: 'sae' }),
      26,
      'padrao',
    );
    expect(r.mismatchNote).toContain('sae');
  });

  it('sem divergência não gera aviso', () => {
    const r = keyFromProcessResult(
      result({ answers: { 1: 'A' }, templateUsed: 'padrao' }),
      44,
      'padrao',
    );
    expect(r.mismatchNote).toBeUndefined();
  });
});
