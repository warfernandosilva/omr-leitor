import { Exam, StudentResult } from '../types';

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
  localStorage.setItem(getStorageKey(userId), JSON.stringify(data));
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
