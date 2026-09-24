import { Exam, StudentResult, SaeSpec, DEFAULT_SAE_SPEC } from '../types';
import type { DBExam } from './api';

const STORAGE_KEY = 'omr-app-data';

// Nota: provas e resultados ficam no navegador; alunos, gabaritos e
// códigos QR vivem no banco do backend (fonte oficial — ver Importar Alunos).

interface AppData {
  exams: Exam[];
  results: StudentResult[];
}

function getStorageKey(userId?: string | number): string {
  return userId != null ? `${STORAGE_KEY}-${String(userId)}` : STORAGE_KEY;
}

function migrateExam(raw: unknown): Exam {
  const e = raw as Partial<Exam> & { subject?: string };
  if (typeof e.subjectLP === 'string') {
    return e as Exam;
  }
  return {
    id: e.id || '',
    name: e.name || '',
    subjectLP: e.subject || 'LÍNGUA PORTUGUESA',
    subjectMat: 'MATEMÁTICA',
    questionsPerSubject: 22,
    totalQuestions: 44,
    createdAt: e.createdAt || new Date().toISOString(),
    gradeScale: e.gradeScale || '0-10',
    answerKey: e.answerKey || null,
    layoutMode: e.layoutMode === 'single' ? 'single' : 'dual',
    templateType: e.templateType === 'sae' || e.templateType === 'colar' || e.templateType === 'saev' ? e.templateType : undefined,
    saeSpec: e.saeSpec,
  };
}

function loadData(userId?: string | number): AppData {
  let exams: Exam[] = [];
  let results: StudentResult[] = [];
  try {
    // tenta chave do usuário, com fallback legado para migração
    const key = getStorageKey(userId);
    let raw = localStorage.getItem(key);
    if (!raw && userId != null) raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      exams = (parsed.exams || []).map(migrateExam);
      results = parsed.results || [];
    }
  } catch {
    exams = [];
    results = [];
  }
  return { exams, results };
}

function saveData(data: AppData, userId?: string | number): void {
  try {
    localStorage.setItem(getStorageKey(userId), JSON.stringify(data));
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
      throw new Error('Armazenamento local cheio: libere espaço (apague fotos/vídeos do aparelho ou resultados antigos) e tente salvar novamente.');
    }
    throw new Error('Falha ao gravar no armazenamento local deste aparelho.');
  }
}

export function getExams(userId?: string | number): Exam[] {
  return loadData(userId).exams;
}

export function getExam(id: string, userId?: string | number): Exam | undefined {
  return loadData(userId).exams.find(e => e.id === id);
}

export function saveExam(exam: Exam, userId?: string | number): void {
  const data = loadData(userId);
  const idx = data.exams.findIndex(e => e.id === exam.id);
  if (idx >= 0) data.exams[idx] = exam;
  else data.exams.push(exam);
  saveData(data, userId);
}

export interface MergeStats {
  added: number;
  updated: number;
}

function remoteSaeSpec(raw: Record<string, unknown> | null | undefined): SaeSpec | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const get = (k: keyof SaeSpec, fb: string): string =>
    typeof raw[k as string] === 'string' ? String(raw[k as string]) : fb;
  const titulo = Array.isArray(raw.titulo) && (raw.titulo as unknown[]).every(t => typeof t === 'string')
    ? (raw.titulo as string[]).slice(0, 4)
    : [...DEFAULT_SAE_SPEC.titulo];
  while (titulo.length < 4) titulo.push('');
  return {
    ano: get('ano', DEFAULT_SAE_SPEC.ano),
    programa_linha1: get('programa_linha1', DEFAULT_SAE_SPEC.programa_linha1),
    programa_linha2: get('programa_linha2', DEFAULT_SAE_SPEC.programa_linha2),
    titulo,
    caderno: get('caderno', DEFAULT_SAE_SPEC.caderno),
    disciplina: get('disciplina', DEFAULT_SAE_SPEC.disciplina),
    serie: get('serie', DEFAULT_SAE_SPEC.serie),
    qr_payload: get('qr_payload', DEFAULT_SAE_SPEC.qr_payload),
    codigo_barras: get('codigo_barras', DEFAULT_SAE_SPEC.codigo_barras),
  };
}

/**
 * Mescla provas vindas do servidor (fonte oficial) com as locais.
 * - Insere as ausentes; o SERVIDOR vence nos campos espelhados (inclui answerKey).
 * - Provas só-locais são preservadas. createdAt local é mantido se o remoto não trouxer.
 */
export function mergeRemoteExams(local: Exam[], remote: DBExam[]): { merged: Exam[]; stats: MergeStats } {
  const merged = local.map(e => ({ ...e }));
  const byId = new Map(merged.map(e => [e.id, e]));
  let added = 0, updated = 0;

  for (const db of remote) {
    const layoutMode = db.layout_mode === 'single' ? 'single' : 'dual';
    const templateType = db.template === 'sae' || db.template === 'colar' || db.template === 'saev' ? db.template : undefined;
    const qps = db.questions_per_subject;
    const exam: Exam = {
      id: db.external_id,
      name: db.titulo,
      subjectLP: db.subject_lp,
      subjectMat: db.subject_mat,
      questionsPerSubject: qps,
      totalQuestions: layoutMode === 'single' ? qps : qps * 2,
      createdAt: db.created_at || byId.get(db.external_id)?.createdAt || new Date().toISOString(),
      gradeScale: (db.grade_scale as Exam['gradeScale']) || '0-10',
      answerKey: (db.answer_key as Record<number, string> | null) || null,
      layoutMode,
      templateType,
      saeSpec: templateType === 'sae' ? remoteSaeSpec(db.sae_spec) : undefined,
    };
    const prev = byId.get(db.external_id);
    if (!prev) {
      merged.push(exam);
      byId.set(exam.id, exam);
      added++;
    } else {
      const before = JSON.stringify({ ...prev, createdAt: undefined });
      Object.assign(prev, exam, { createdAt: prev.createdAt || exam.createdAt });
      const after = JSON.stringify({ ...prev, createdAt: undefined });
      if (before !== after) updated++;
    }
  }
  return { merged, stats: { added, updated } };
}

/** Aplica o merge direto no localStorage. Retorna estatísticas. */
export function applyRemoteExams(remote: DBExam[], userId?: string | number): MergeStats {
  const data = loadData(userId);
  const { merged, stats } = mergeRemoteExams(data.exams, remote);
  data.exams = merged;
  saveData(data, userId);
  return stats;
}

export function deleteExam(id: string, userId?: string | number): void {
  const data = loadData(userId);
  data.exams = data.exams.filter(e => e.id !== id);
  data.results = data.results.filter(r => r.examId !== id);
  saveData(data, userId);
}

export function getResults(examId?: string, userId?: string | number): StudentResult[] {
  const results = loadData(userId).results;
  if (examId) return results.filter(r => r.examId === examId);
  return results;
}

export function getResult(id: string, userId?: string | number): StudentResult | undefined {
  return loadData(userId).results.find(r => r.id === id);
}

export function saveResult(result: StudentResult, userId?: string | number): void {
  const data = loadData(userId);
  const idx = data.results.findIndex(r => r.id === result.id);
  if (idx >= 0) data.results[idx] = result;
  else data.results.push(result);
  saveData(data, userId);
}

export function deleteResult(id: string, userId?: string | number): void {
  const data = loadData(userId);
  data.results = data.results.filter(r => r.id !== id);
  saveData(data, userId);
}
