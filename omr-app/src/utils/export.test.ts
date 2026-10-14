import { describe, it, expect } from 'vitest';
import { exportSaevLoteCsv, examsWithRemoteFallback } from './export';
import type { Exam, StudentResult } from '../types';
import type { DBResultado } from './api';

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

  it('separa prova ausente (missingExam) de prova não-dual (skipped)', () => {
    const single = exam({ id: 'E2', layoutMode: 'single', questionsPerSubject: 10, totalQuestions: 10 });
    const r = exportSaevLoteCsv(
      [result({ examId: 'E2' }), result({ examId: 'EX-QUEBRADA' })],
      [exam(), single],
    );
    expect(r.skipped).toBe(1);
    expect(r.missingExam).toBe(1);
    expect(r.csv.split('\r\n')).toHaveLength(1); // só header
  });
});

function dbResult(patch: Partial<DBResultado> = {}): DBResultado {
  return {
    codigo_unico: 'QR-1', numero_pagina: 1, status: 'corrigido',
    respostas: { 1: 'B', 23: 'A' }, acertos: 2, erros: 0, brancos: 42, nota: 1.0,
    observacoes: null, data_correcao: '2026-01-02T00:00:00',
    aluno: { id: 1, nome: 'ALICE', matricula: null },
    avaliacao: {
      id: 7, external_id: 'EX-REMOTA', titulo: 'SAEV Remota',
      questions_per_subject: 22, layout_mode: 'dual', grade_scale: '0-10',
      template: 'saev', turma: '9º A', turma_id: 3,
    },
    ...patch,
  };
}

describe('examsWithRemoteFallback', () => {
  it('sintetiza a prova do servidor quando ela não está neste aparelho', () => {
    const out = examsWithRemoteFallback([], [dbResult()]);
    expect(out).toHaveLength(1);
    const e = out[0];
    expect(e.id).toBe('EX-REMOTA');
    expect(e.name).toBe('SAEV Remota');
    expect(e.layoutMode).toBe('dual');
    expect(e.templateType).toBe('saev');
    expect(e.questionsPerSubject).toBe(22);
    expect(e.totalQuestions).toBe(44);
    expect(e.turma).toBe('9º A');
    expect(e.turmaId).toBe(3);
  });

  it('não duplica prova que já existe local', () => {
    const out = examsWithRemoteFallback([exam({ id: 'EX-REMOTA', name: 'Local' })], [dbResult()]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Local');
  });

  it('resultado só-servidor entra no lote SAEV via fallback', () => {
    const exams = examsWithRemoteFallback([], [dbResult()]);
    const r = result({ examId: 'EX-REMOTA', answers: { 1: 'B', 23: 'A' } });
    const { csv, skipped, missingExam } = exportSaevLoteCsv([r], exams);
    const cols = csv.split('\r\n')[0].split(',');
    expect(cols).toHaveLength(45);
    expect(skipped).toBe(0);
    expect(missingExam).toBe(0);
    const cells = csv.split('\r\n')[1].split(',');
    expect(cells[1]).toBe('B'); // LP_Q1 = q1
    expect(cells[23]).toBe('A'); // MAT_Q1 = q23
  });

  it('prova remota single continua ignorada (skipped, não missing)', () => {
    const exams = examsWithRemoteFallback([], [dbResult({
      avaliacao: {
        id: 8, external_id: 'EX-SINGLE', titulo: 'Single',
        questions_per_subject: 10, layout_mode: 'single', grade_scale: '0-10',
        template: null, turma: null, turma_id: null,
      },
    })]);
    const r = exportSaevLoteCsv([result({ examId: 'EX-SINGLE' })], exams);
    expect(r.skipped).toBe(1);
    expect(r.missingExam).toBe(0);
  });

  it('template sae dual remoto é excluído do lote', () => {
    const exams = examsWithRemoteFallback([], [dbResult({
      avaliacao: {
        id: 9, external_id: 'EX-SAE', titulo: 'SAE',
        questions_per_subject: 26, layout_mode: 'dual', grade_scale: '0-10',
        template: 'sae', turma: null, turma_id: null,
      },
    })]);
    const r = exportSaevLoteCsv([result({ examId: 'EX-SAE' })], exams);
    expect(r.skipped).toBe(1);
    expect(r.missingExam).toBe(0);
  });
});
