import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  mergeRemoteExams, saveExam, getExams, saveResult, getResults, deleteResult,
  getDeletedExamIds, markExamDeleted, unmarkExamDeleted, isExamDeleted,
} from './storage';
import type { DBExam } from './api';
import type { Exam, StudentResult } from '../types';

function dbExam(patch: Partial<DBExam> = {}): DBExam {
  return {
    id: 1, external_id: 'E1', titulo: 'Prova', turma: null, turma_id: null,
    subject_lp: 'LÍNGUA PORTUGUESA', subject_mat: 'MATEMÁTICA',
    questions_per_subject: 22, layout_mode: 'dual', template: 'padrao',
    sae_spec: null, herby_spec: null, grade_scale: '0-10', answer_key: null,
    created_at: '2026-01-01T00:00:00',
    ...patch,
  };
}

function localExam(patch: Partial<Exam> = {}): Exam {
  return {
    id: 'E1', name: 'Prova', subjectLP: 'LÍNGUA PORTUGUESA', subjectMat: 'MATEMÁTICA',
    questionsPerSubject: 22, totalQuestions: 44, createdAt: '2025-01-01T00:00:00',
    gradeScale: '0-10', answerKey: null, layoutMode: 'dual',
    ...patch,
  };
}

describe('mergeRemoteExams (servidor vence)', () => {
  it('insere prova ausente com gabarito e modelo', () => {
    const { merged, stats } = mergeRemoteExams([], [
      dbExam({ answer_key: { '1': 'A' }, template: 'sae', sae_spec: { caderno: 'M0901' } }),
    ]);
    expect(stats).toEqual({ added: 1, updated: 0 });
    expect(merged).toHaveLength(1);
    expect(merged[0].answerKey).toEqual({ '1': 'A' });
    expect(merged[0].templateType).toBe('sae');
    expect(merged[0].saeSpec?.caderno).toBe('M0901');
    expect(merged[0].layoutMode).toBe('dual');
  });

  it('atualiza gabarito preenchido depois no PC (servidor vence)', () => {
    const { merged, stats } = mergeRemoteExams(
      [localExam({ answerKey: null })],
      [dbExam({ answer_key: { '1': 'B', '2': 'C' } })],
    );
    expect(stats).toEqual({ added: 0, updated: 1 });
    expect(merged[0].answerKey).toEqual({ '1': 'B', '2': 'C' });
  });

  it('servidor vence mesmo com gabarito local diferente', () => {
    const { merged } = mergeRemoteExams(
      [localExam({ answerKey: { '1': 'A' } })],
      [dbExam({ answer_key: { '1': 'D' } })],
    );
    expect(merged[0].answerKey).toEqual({ '1': 'D' });
  });

  it('preserva provas só-locais e usa createdAt do remoto', () => {
    const { merged, stats } = mergeRemoteExams(
      [localExam({ id: 'LOCAL', createdAt: '2024-05-05T00:00:00' })],
      [dbExam()],
    );
    expect(stats).toEqual({ added: 1, updated: 0 });
    expect(merged.map(e => e.id).sort()).toEqual(['E1', 'LOCAL']);
    expect(merged.find(e => e.id === 'E1')?.createdAt).toBe('2026-01-01T00:00:00');
    expect(merged.find(e => e.id === 'LOCAL')?.createdAt).toBe('2024-05-05T00:00:00');
  });

  it('sem mudanças não conta como atualizado', () => {
    const remote = [dbExam()];
    const first = mergeRemoteExams([], remote);
    const second = mergeRemoteExams(first.merged, remote);
    expect(second.stats).toEqual({ added: 0, updated: 0 });
  });

  it('colar vira single com total = questões', () => {
    const { merged } = mergeRemoteExams([], [
      dbExam({ external_id: 'C1', questions_per_subject: 26, layout_mode: 'single', template: 'colar' }),
    ]);
    expect(merged[0].templateType).toBe('colar');
    expect(merged[0].totalQuestions).toBe(26);
    expect(merged[0].saeSpec).toBeUndefined();
  });

  it('incorpora prova SAEV avulsa do QR (auto-download no salvamento)', () => {
    // Formato de GET /api/exams/{id}: DBExam + campos extras (total_alunos) que devem ser ignorados
    const single = { ...dbExam({ external_id: 'QR-EXAM', template: 'saev' }), total_alunos: 35 };
    const { merged, stats } = mergeRemoteExams([localExam({ id: 'LOCAL' })], [single as DBExam]);
    expect(stats).toEqual({ added: 1, updated: 0 });
    const got = merged.find(e => e.id === 'QR-EXAM');
    expect(got?.templateType).toBe('saev');
    expect(got?.totalQuestions).toBe(44);
  });

  it('traz turma/turmaId do servidor no merge', () => {
    const { merged } = mergeRemoteExams([], [
      dbExam({ turma: '9º A', turma_id: 7 }),
    ]);
    expect(merged[0].turma).toBe('9º A');
    expect(merged[0].turmaId).toBe(7);
  });

  it('turma ausente no servidor vira indefinida (sem falso "atualizado")', () => {
    const first = mergeRemoteExams([], [dbExam()]);
    expect(first.merged[0].turma).toBeUndefined();
    expect(first.merged[0].turmaId).toBeUndefined();
    const second = mergeRemoteExams(first.merged, [dbExam()]);
    expect(second.stats).toEqual({ added: 0, updated: 0 });
  });

  it('status local sobrevive ao merge (rascunho não vira ativa)', () => {
    const { merged, stats } = mergeRemoteExams(
      [localExam({ status: 'rascunho' })],
      [dbExam()],
    );
    expect(merged[0].status).toBe('rascunho');
    // só o status existia de diferente? não: gabarito/turma iguais → sem "atualizado"
    expect(stats.updated).toBe(0);
  });

  it('prova nova do servidor chega como ativa', () => {
    const { merged } = mergeRemoteExams([], [dbExam()]);
    expect(merged[0].status).toBe('ativa');
  });

  it('preserva templateType herby + herbySpec no merge (correção mobile)', () => {
    const { merged } = mergeRemoteExams([], [
      dbExam({
        external_id: 'H1', template: 'herby', questions_per_subject: 22,
        herby_spec: { evento: 'Ev', serie: '5º', caderno: 'CAD', turma: 'A', magic_base: '', n_questoes: 22 },
      }),
    ]);
    expect(merged[0].templateType).toBe('herby');
    expect(merged[0].herbySpec?.caderno).toBe('CAD');
    expect(merged[0].herbySpec?.n_questoes).toBe(22);
    expect(merged[0].totalQuestions).toBe(44);
  });

  it('carrega custom_template_id do servidor como customTemplateId', () => {
    const { merged } = mergeRemoteExams([], [
      dbExam({ external_id: 'C1', template: 'custom', custom_template_id: 7 }),
    ]);
    expect(merged[0].templateType).toBeUndefined();
    expect(merged[0].customTemplateId).toBe(7);
  });

  it('limpa o customTemplateId quando o servidor volta para um modelo nativo', () => {
    const { merged } = mergeRemoteExams(
      [localExam({ id: 'C1', customTemplateId: 7 })],
      [dbExam({ external_id: 'C1', template: 'sae', sae_spec: {} })],
    );
    expect(merged[0].customTemplateId).toBeUndefined();
    expect(merged[0].templateType).toBe('sae');
  });

  it('preserva o customTemplateId local quando o servidor não informa modelo', () => {
    const { merged } = mergeRemoteExams(
      [localExam({ id: 'C1', customTemplateId: 7 })],
      [dbExam({ external_id: 'C1', template: 'padrao' })],
    );
    expect(merged[0].customTemplateId).toBe(7);
  });
});

const UID = 'test-ciclo-uid';

function student(patch: Partial<StudentResult> = {}): StudentResult {
  return {
    id: 'uuid-1', examId: 'E1', studentName: 'ALUNO QR', answers: { 1: 'A' },
    correctCount: 1, incorrectCount: 0, blankCount: 0,
    duplicateCount: 0, duplicateQuestions: [], duplicateMarks: {},
    lowConfidence: [], qrOk: true, codigoUnico: 'OMR-2026-000001',
    grade: 10, timestamp: new Date().toISOString(), manualOverrides: {},
    ...patch,
  };
}

describe('status da prova (somente local)', () => {
  afterEach(() => {
    localStorage.removeItem('omr-app-data');
    localStorage.removeItem(`omr-app-data-${UID}`);
  });

  it('storage antigo do aparelho passa a pertencer ao primeiro usuário', () => {
    localStorage.setItem('omr-app-data', JSON.stringify({ exams: [localExam()], results: [] }));
    expect(getExams(UID)).toHaveLength(1);
    expect(localStorage.getItem('omr-app-data')).toBeNull();
    expect(getExams('outro')).toHaveLength(0);
  });

  it('prova antiga sem status volta como ativa', () => {
    const semStatus = { ...localExam() };
    delete semStatus.status;
    saveExam(semStatus, UID);
    expect(getExams(UID)[0].status).toBe('ativa');
  });

  it('status salvo é preservado na leitura', () => {
    saveExam(localExam({ status: 'arquivada' }), UID);
    expect(getExams(UID)[0].status).toBe('arquivada');
  });
});

describe('ciclo local resultado', () => {
  afterEach(() => {
    localStorage.removeItem('omr-app-data');
    localStorage.removeItem(`omr-app-data-${UID}`);
  });

  it('salvo aparece no listar do mesmo usuário', () => {
    saveResult(student(), UID);
    const list = getResults(undefined, UID);
    expect(list).toHaveLength(1);
    expect(list[0].codigoUnico).toBe('OMR-2026-000001');
  });

  it('excluído não volta no listar seguinte', () => {
    saveResult(student(), UID);
    deleteResult('uuid-1', UID);
    expect(getResults(undefined, UID)).toHaveLength(0);
  });

  it('armazenamento cheio vira erro legível (nunca some em silêncio)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    try {
      expect(() => saveResult(student(), UID)).toThrow(/cheio/);
      expect(() => deleteResult('uuid-1', UID)).toThrow(/cheio/);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('lápides locais (anti-ressurreição)', () => {
  afterEach(() => {
    localStorage.removeItem('omr-deleted-exams');
    localStorage.removeItem(`omr-deleted-exams-${UID}`);
  });

  it('marca, consulta e desmarca', () => {
    expect(isExamDeleted('E1', UID)).toBe(false);
    markExamDeleted('E1', UID);
    expect(isExamDeleted('E1', UID)).toBe(true);
    expect(getDeletedExamIds(UID)).toEqual(['E1']);
    unmarkExamDeleted('E1', UID);
    expect(isExamDeleted('E1', UID)).toBe(false);
  });

  it('idempotente e isolada por usuário', () => {
    markExamDeleted('E1', UID);
    markExamDeleted('E1', UID);
    markExamDeleted('E2', UID);
    expect(getDeletedExamIds(UID)).toEqual(['E2', 'E1']);
    expect(getDeletedExamIds('outro')).toEqual([]);
    expect(isExamDeleted('E1')).toBe(false);
  });
});
