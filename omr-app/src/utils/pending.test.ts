import { describe, it, expect } from 'vitest';
import { pendingFromResults } from './pending';
import type { StudentResult } from '../types';

function res(patch: Partial<StudentResult> = {}): StudentResult {
  return {
    id: 'r1',
    examId: 'e1',
    studentName: 'Ana',
    answers: {},
    correctCount: 0,
    incorrectCount: 0,
    blankCount: 0,
    duplicateCount: 0,
    grade: 0,
    timestamp: '2026-09-21T10:00:00',
    manualOverrides: {},
    ...patch,
  };
}

describe('pendingFromResults', () => {
  it('lista resultado com duplicadas', () => {
    const out = pendingFromResults([res({ duplicateQuestions: [3, 7], duplicateCount: 2 })]);
    expect(out).toHaveLength(1);
    expect(out[0].duplicateQuestions).toEqual([3, 7]);
    expect(out[0].qrIssue).toBe(false);
  });

  it('lista resultado com leitura incerta', () => {
    const out = pendingFromResults([res({ lowConfidence: [5] })]);
    expect(out).toHaveLength(1);
    expect(out[0].lowConfidence).toEqual([5]);
  });

  it('ignora resultado limpo e resultado legado (sem campos novos)', () => {
    expect(pendingFromResults([res()])).toHaveLength(0);
  });

  it('revisado sai da fila', () => {
    const out = pendingFromResults([
      res({ duplicateQuestions: [3], duplicateCount: 1, reviewed: true }),
    ]);
    expect(out).toHaveLength(0);
  });

  it('re-correção (mais recente) supera pendência anterior do mesmo aluno', () => {
    const out = pendingFromResults([
      res({ id: 'old', duplicateQuestions: [3], duplicateCount: 1, codigoUnico: 'C1', timestamp: '2026-09-21T09:00:00' }),
      res({ id: 'new', codigoUnico: 'C1', timestamp: '2026-09-21T10:00:00' }),
    ]);
    expect(out).toHaveLength(0);
  });

  it('QR ilegível só pendente quando sem identificação', () => {
    expect(pendingFromResults([res({ qrOk: false, studentName: '' })])[0]?.qrIssue).toBe(true);
    // avulso (nome digitado) não pendente por QR
    expect(pendingFromResults([res({ qrOk: false, studentName: 'Avulso' })])).toHaveLength(0);
  });
});
