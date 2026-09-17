import { describe, it, expect } from 'vitest';
import { exportSaevLoteCsv } from './export';
import type { Exam, StudentResult } from '../types';

function exam(patch: Partial<Exam> = {}): Exam {
  return {
    id: 'E1', name: 'Prova', subjectLP: 'LÍNGUA PORTUGUESA', subjectMat: 'MATEMÁTICA',
    questionsPerSubject: 22, totalQuestions: 44, createdAt: '2026-01-01T00:00:00',
    gradeScale: '0-10', answerKey: null, layoutMode: 'dual',
    ...patch,
  };
}

function result(patch: Partial<StudentResult> = {}): StudentResult {
  return {
    id: 'R1', examId: 'E1', studentName: 'ALICE EVILYN PASSOS DE OLIVEIRA',
    answers: {}, correctCount: 0, incorrectCount: 0, blankCount: 0, duplicateCount: 0,
    grade: 0, timestamp: '2026-01-01T00:00:00', manualOverrides: {},
    ...patch,
  };
}

describe('exportSaevLoteCsv', () => {
  it('gera o header do modelo (22/22) e mapeia LP=1..22 MAT=23..44', () => {
    const answers: Record<number, string> = { 1: 'B', 2: 'A', 22: 'C', 23: 'A', 44: 'D' };
    const { csv, skipped } = exportSaevLoteCsv([result({ answers })], [exam()]);
    const [header, row] = csv.split('\r\n');
    const cols = header.split(',');
    expect(cols[0]).toBe('NOME');
    expect(cols[1]).toBe('LP_Q1');
    expect(cols[22]).toBe('LP_Q22');
    expect(cols[23]).toBe('MAT_Q1');
    expect(cols[44]).toBe('MAT_Q22');
    expect(cols).toHaveLength(45);
    const cells = row.split(',');
    expect(cells[0]).toBe('ALICE EVILYN PASSOS DE OLIVEIRA');
    expect(cells[1]).toBe('B'); // LP_Q1 = q1
    expect(cells[2]).toBe('A'); // LP_Q2 = q2
    expect(cells[3]).toBe(''); // LP_Q3 em branco
    expect(cells[22]).toBe('C'); // LP_Q22 = q22
    expect(cells[23]).toBe('A'); // MAT_Q1 = q23
    expect(cells[44]).toBe('D'); // MAT_Q22 = q44
    expect(skipped).toBe(0);
  });

  it('é dinâmico pelo questionsPerSubject da prova', () => {
    const { csv } = exportSaevLoteCsv(
      [result({ answers: { 1: 'A', 11: 'B' } })],
      [exam({ questionsPerSubject: 10, totalQuestions: 20 })],
    );
    const cols = csv.split('\r\n')[0].split(',');
    expect(cols).toHaveLength(21);
    expect(cols[1]).toBe('LP_Q1');
    expect(cols[10]).toBe('LP_Q10');
    expect(cols[11]).toBe('MAT_Q1');
    expect(cols[20]).toBe('MAT_Q10');
    const cells = csv.split('\r\n')[1].split(',');
    expect(cells[1]).toBe('A');
    expect(cells[11]).toBe('B'); // MAT_Q1 = q11
  });

  it('ignora provas não-duais e conta skipped', () => {
    const single = exam({ id: 'E2', layoutMode: 'single', questionsPerSubject: 10, totalQuestions: 10 });
    const sae = exam({ id: 'E3', layoutMode: 'single', templateType: 'sae', questionsPerSubject: 26, totalQuestions: 26 });
    const { csv, skipped } = exportSaevLoteCsv(
      [result({ examId: 'E2' }), result({ examId: 'E3' }), result({})],
      [exam(), single, sae],
    );
    expect(skipped).toBe(2);
    expect(csv.split('\r\n')).toHaveLength(2); // header + 1 linha dual
  });

  it('usa CRLF e nome sem aspas como no modelo', () => {
    const { csv } = exportSaevLoteCsv([result({ answers: { 1: 'A' } })], [exam()]);
    expect(csv).toContain('\r\n');
    expect(csv.split('\r\n')[1].startsWith('ALICE EVILYN PASSOS DE OLIVEIRA,A')).toBe(true);
  });

  it('protege célula com vírgula/aspas', () => {
    const { csv } = exportSaevLoteCsv([result({ studentName: 'SILVA, "JU"' })], [exam()]);
    expect(csv.split('\r\n')[1].startsWith('"SILVA, ""JU"""')).toBe(true);
  });
});
