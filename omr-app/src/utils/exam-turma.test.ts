import { describe, it, expect } from 'vitest';
import type { Exam } from '../types';
import { linkedExamForTurma } from './exam-turma';

function exam(id: string, turmaId?: number, status?: Exam['status']): Exam {
  return {
    id,
    name: id,
    turmaId,
    status,
    subjectLP: 'LP',
    subjectMat: 'MAT',
    questionsPerSubject: 1,
    totalQuestions: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    gradeScale: '0-10',
    answerKey: null,
  };
}

describe('prova vinculada à turma', () => {
  it('devolve undefined quando nenhuma prova pertence à turma', () => {
    expect(linkedExamForTurma([exam('a', 1), exam('b', 2)], 3)).toBeUndefined();
  });

  it('escolhe a prova mais recente da turma', () => {
    const exams = [exam('antiga', 7), exam('outra', 8), exam('recente', 7)];
    expect(linkedExamForTurma(exams, 7)?.id).toBe('recente');
  });

  it('não mistura provas de outras turmas', () => {
    const exams = [exam('a', 1), exam('b', 2)];
    expect(linkedExamForTurma(exams, 2)?.id).toBe('b');
  });

  it('prefere não arquivadas e cai para arquivada se for a única', () => {
    const exams = [exam('ativa', 5, 'ativa'), exam('arquivada', 5, 'arquivada')];
    expect(linkedExamForTurma(exams, 5)?.id).toBe('ativa');
    expect(linkedExamForTurma([exam('velha', 5, 'arquivada')], 5)?.id).toBe('velha');
  });
});
