// ─── Cliente REST para o Python OMR Backend ───

const API_BASE = (() => {
  // Permite forçar via .env: VITE_API_URL=https://xxxx.ngrok-free.app
  const envUrl = (import.meta as unknown as { env?: { VITE_API_URL?: string } })?.env?.VITE_API_URL;
  if (envUrl) return envUrl.replace(/\/$/, '');
  if (typeof window !== 'undefined') {
    const h = window.location.hostname;
    // ngrok / tunneling: usa o mesmo host https via proxy do Vite (/api -> localhost:8010)
    if (h && (h.endsWith('ngrok-free.app') || h.endsWith('ngrok.io') || h.endsWith('ngrok.app'))) return '';
    if (h && h !== 'localhost' && h !== '127.0.0.1') return `${window.location.protocol}//${h}:8010`;
  }
  return 'http://localhost:8010';
})();

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('omr_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface ProcessResult {
  success: boolean;
  answers?: Record<number, string>;
  blankQuestions?: number[];
  duplicateQuestions?: number[];
  duplicateMarks?: Record<number, string[]>;
  lowConfidence?: number[];
  allRatios?: Record<number, Record<string, number>>;
  cardId?: string;
  rectifiedImage?: string;
  templateUsed?: 'padrao' | 'sae';
  error?: string;
}

export interface GradeResult {
  portugues: { correct: number; incorrect: number; blank: number; duplicate: number; total: number; grade: number };
  matematica: { correct: number; incorrect: number; blank: number; duplicate: number; total: number; grade: number };
  total_correct: number;
  total_incorrect: number;
  total_blank: number;
  total_duplicate: number;
  total_questions: number;
}

export interface TemplateCoords {
  page_w: number;
  page_h: number;
  aruco_centers: Record<string, [number, number]>;
  aruco_size: number;
  aruco_ids: number[];
  bubble_radius: number;
  question_y: number[];
  port_x: number[];
  mat_x: number[];
  port_num_x: number;
  mat_num_x: number;
  questions_per_subject: number;
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/health`, { headers: authHeaders() });
    return res.ok;
  } catch {
    return false;
  }
}

import type { SaeSpec } from '../types';

export async function processImage(
  file: File,
  questionsPerSubject?: number,
  layoutMode?: 'dual' | 'single',
  template?: 'padrao' | 'sae',
): Promise<ProcessResult> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('questions_per_subject', String(questionsPerSubject ?? 22));
  formData.append('layout_mode', layoutMode ?? 'dual');
  formData.append('template', template ?? 'padrao');

  const res = await fetch(`${API_BASE}/api/omr/process`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });

  const data = await res.json();

  // Mapear snake_case → camelCase
  return {
    success: data.success,
    answers: data.answers ? Object.fromEntries(
      Object.entries(data.answers).map(([k, v]) => [Number(k), v as string])
    ) : undefined,
    blankQuestions: data.blank_questions,
    duplicateQuestions: data.duplicate_questions,
    duplicateMarks: data.duplicate_marks ? Object.fromEntries(
      Object.entries(data.duplicate_marks as Record<string, string[]>).map(([k, v]) => [Number(k), v])
    ) : undefined,
    lowConfidence: data.low_confidence,
    allRatios: data.all_ratios ? Object.fromEntries(
      Object.entries(data.all_ratios as Record<string, unknown>).map(([k, v]) => [Number(k), v as Record<string, number>])
    ) : undefined,
    cardId: data.card_id || undefined,
    rectifiedImage: data.rectified_image || undefined,
    templateUsed: data.template_used === 'sae' ? 'sae' : data.template_used === 'padrao' ? 'padrao' : undefined,
    error: data.error,
  };
}

export async function gradeAnswers(
  answers: Record<number, string>,
  answerKey: Record<number, string>,
  gradeScale: string = '0-10',
): Promise<GradeResult> {
  const res = await fetch(`${API_BASE}/api/omr/grade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      answers,
      answer_key: answerKey,
      grade_scale: gradeScale,
    }),
  });

  return res.json();
}

export async function generateCard(
  subjectLp: string,
  subjectMat: string,
  format: 'PNG' | 'PDF' = 'PNG',
): Promise<Blob> {
  const res = await fetch(`${API_BASE}/api/card/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      subject_lp: subjectLp,
      subject_mat: subjectMat,
      format,
    }),
  });

  return res.blob();
}

export async function getTemplateCoords(): Promise<TemplateCoords> {
  const res = await fetch(`${API_BASE}/api/template/coords`, { headers: authHeaders() });
  return res.json();
}

// ─── Cartão em branco (mesmo desenho dos oficiais, gerado pelo backend) ───

export async function generateBlankCard(
  subjectLp: string,
  subjectMat: string,
  format: 'PNG' | 'PDF',
  opts?: { questionsPerSubject?: number; layoutMode?: 'dual' | 'single'; template?: 'padrao' | 'sae'; sae?: SaeSpec },
): Promise<Blob> {
  const res = await fetch(`${API_BASE}/api/card/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      subject_lp: subjectLp,
      subject_mat: subjectMat,
      format,
      questions_per_subject: opts?.questionsPerSubject ?? 22,
      layout_mode: opts?.layoutMode ?? 'dual',
      template: opts?.template ?? 'padrao',
      sae: opts?.sae ? { ...opts.sae, n_questoes: opts?.questionsPerSubject ?? 26 } : null,
    }),
  });
  if (!res.ok) throw new Error(`Falha ao gerar cartão no servidor (${res.status})`);
  return res.blob();
}

// ─── Persistência: Avaliação → Alunos → Gabaritos → Resultado ───

export interface PersistedAluno {
  id: number;
  nome: string;
  matricula: string | null;
}

export interface SyncExamResult {
  avaliacao_id: number;
  external_id: string;
  titulo: string;
  turma: string | null;
}

export interface ImportStudentsResult {
  avaliacao_id: number;
  external_id: string;
  total_importados: number;
  alunos: PersistedAluno[];
}

export interface GabaritoInfo {
  id: number;
  codigo_unico: string;
  qr_code_payload: string;
  numero_pagina: number;
  status: 'gerado' | 'lido' | 'corrigido';
  respostas?: Record<string, string> | null;
  acertos?: number | null;
  erros?: number | null;
  brancos?: number | null;
  nota?: number | null;
  data_leitura?: string | null;
  data_correcao?: string | null;
  aluno: { id: number; nome: string; matricula: string | null };
}

export interface GabaritosListResult {
  avaliacao: { id: number; external_id: string; titulo: string; turma: string | null };
  stats: {
    alunos_cadastrados: number;
    gabaritos_gerados: number;
    gabaritos_lidos: number;
    gabaritos_corrigidos: number;
    pendentes: number;
  };
  gabaritos: GabaritoInfo[];
}

export type LookupResult =
  | {
      found: true;
      codigo_unico: string;
      status: GabaritoInfo['status'];
      numero_pagina: number;
      aluno: { id: number; nome: string; matricula: string | null };
      avaliacao: {
        id: number;
        external_id: string;
        titulo: string;
        turma: string | null;
        questions_per_subject: number;
      };
    }
  | { found: false };

export class AlreadyGradedError extends Error {
  previous: { nota?: number | null; acertos?: number | null; nome?: string };
  constructor(previous: { nota?: number | null; acertos?: number | null; nome?: string }) {
    super('Gabarito já possui resultado salvo');
    this.previous = previous;
  }
}

export async function syncExam(exam: {
  id: string;
  name: string;
  subjectLP: string;
  subjectMat: string;
  questionsPerSubject?: number;
  layoutMode?: 'dual' | 'single';
}): Promise<SyncExamResult> {
  const res = await fetch(`${API_BASE}/api/exams/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      external_id: exam.id,
      titulo: exam.name,
      subject_lp: exam.subjectLP,
      subject_mat: exam.subjectMat,
      questions_per_subject: exam.questionsPerSubject ?? 22,
      layout_mode: exam.layoutMode ?? 'dual',
    }),
  });
  if (!res.ok) throw new Error(`Falha ao sincronizar a prova (${res.status})`);
  return res.json();
}

export async function importStudentsAPI(
  examExternalId: string,
  alunos: { nome: string; matricula?: string | null }[],
): Promise<ImportStudentsResult> {
  const res = await fetch(`${API_BASE}/api/exams/${encodeURIComponent(examExternalId)}/students/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      alunos: alunos.map(a => ({ nome: a.nome, matricula: a.matricula ?? null })),
    }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j?.detail) detail = String(j.detail); } catch { /* ignore */ }
    throw new Error(`Falha ao importar alunos: ${detail}`);
  }
  return res.json();
}

export interface GenerateGabaritosResult {
  avaliacao_id: number;
  total_alunos: number;
  total_gabaritos: number;
  novos_gabaritos: number;
}

export async function generateGabaritos(examExternalId: string): Promise<GenerateGabaritosResult> {
  const res = await fetch(`${API_BASE}/api/exams/${encodeURIComponent(examExternalId)}/gabaritos/generate`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j?.detail) detail = String(j.detail); } catch { /* ignore */ }
    throw new Error(detail);
  }
  return res.json();
}

export async function generateGabaritosPDF(examExternalId: string): Promise<Blob> {
  const res = await fetch(`${API_BASE}/api/exams/${encodeURIComponent(examExternalId)}/gabaritos/pdf`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j?.detail) detail = String(j.detail); } catch { /* ignore */ }
    throw new Error(`Falha ao gerar PDF no servidor: ${detail}`);
  }
  return res.blob();
}

export async function fetchGabaritos(examExternalId: string): Promise<GabaritosListResult> {
  const res = await fetch(`${API_BASE}/api/exams/${encodeURIComponent(examExternalId)}/gabaritos`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Falha ao consultar gabaritos (${res.status})`);
  return res.json();
}

export interface ResetExamResult {
  avaliacao_id: number;
  deleted_alunos: number;
  deleted_gabaritos: number;
}

export async function resetExam(examExternalId: string): Promise<ResetExamResult> {
  const res = await fetch(`${API_BASE}/api/exams/${encodeURIComponent(examExternalId)}/students`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j?.detail) detail = String(j.detail); } catch { /* ignore */ }
    throw new Error(`Falha ao resetar a avaliação: ${detail}`);
  }
  return res.json();
}

export async function deleteAluno(alunoId: number): Promise<{ nome: string; gabaritos_removidos: number }> {
  const res = await fetch(`${API_BASE}/api/alunos/${alunoId}`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j?.detail) detail = String(j.detail); } catch { /* ignore */ }
    throw new Error(`Falha ao apagar o aluno: ${detail}`);
  }
  const j = await res.json();
  return { nome: j.nome, gabaritos_removidos: j.gabaritos_removidos };
}

export async function lookupCodigo(codigo: string): Promise<LookupResult> {
  const res = await fetch(`${API_BASE}/api/gabaritos/${encodeURIComponent(codigo)}/lookup`, {
    headers: authHeaders(),
  });
  if (res.status === 404) return { found: false };
  if (!res.ok) throw new Error(`Falha na consulta do código (${res.status})`);
  return res.json();
}

export interface ResultadoPayload {
  respostas?: Record<string, string>;
  acertos?: number;
  erros?: number;
  brancos?: number;
  nota?: number;
  observacoes?: string;
}

export async function saveGabaritoResultado(
  codigo: string,
  payload: ResultadoPayload,
  overwrite = false,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/gabaritos/${encodeURIComponent(codigo)}/resultado?overwrite=${overwrite}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
    },
  );
  if (res.status === 409) {
    const j = await res.json();
    throw new AlreadyGradedError(j?.previous ?? {});
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j?.detail) detail = String(j.detail); } catch { /* ignore */ }
    throw new Error(detail);
  }
}

// ─── Exames e gabaritos — persistência completa ───

export interface DBExam {
  id: number;
  external_id: string;
  titulo: string;
  turma: string | null;
  subject_lp: string;
  subject_mat: string;
  questions_per_subject: number;
  layout_mode: 'dual' | 'single';
  grade_scale: string;
  answer_key: Record<string, string> | null;
  created_at: string | null;
}

export async function getExamsFromDB(): Promise<DBExam[]> {
  const res = await fetch(`${API_BASE}/api/exams`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Falha ao listar avaliações (${res.status})`);
  return res.json();
}

export async function deleteExamFromDB(externalId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/exams/${encodeURIComponent(externalId)}`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j?.detail) detail = String(j.detail); } catch { /* ignore */ }
    throw new Error(detail);
  }
}

export async function putAnswerKeyDB(externalId: string, answerKey: Record<string, string>, gradeScale?: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/exams/${encodeURIComponent(externalId)}/answer-key`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ answer_key: answerKey, grade_scale: gradeScale }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j?.detail) detail = String(j.detail); } catch { /* ignore */ }
    throw new Error(detail);
  }
}

export interface DBResultado {
  codigo_unico: string;
  numero_pagina: number;
  status: string;
  respostas: Record<string, string> | null;
  acertos: number | null;
  erros: number | null;
  brancos: number | null;
  nota: number | null;
  observacoes: string | null;
  data_correcao: string | null;
  aluno: { id: number; nome: string; matricula: string | null };
  avaliacao: { id: number; external_id: string; titulo: string; questions_per_subject: number; layout_mode: string; grade_scale: string };
}

export async function getResultadosFromDB(): Promise<DBResultado[]> {
  const res = await fetch(`${API_BASE}/api/resultados`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Falha ao listar resultados (${res.status})`);
  return res.json();
}

export async function deleteResultadoDB(codigo: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/gabaritos/${encodeURIComponent(codigo)}/resultado`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j?.detail) detail = String(j.detail); } catch { /* ignore */ }
    throw new Error(detail);
  }
}

export async function postAvulsoResultado(
  externalId: string,
  payload: { nome: string; matricula?: string | null; respostas?: Record<string, string>; acertos?: number; erros?: number; brancos?: number; nota?: number; observacoes?: string },
): Promise<{ codigo_unico: string }> {
  const res = await fetch(`${API_BASE}/api/exams/${encodeURIComponent(externalId)}/resultados/avulso`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j?.detail) detail = String(j.detail); } catch { /* ignore */ }
    throw new Error(detail);
  }
  const j = await res.json();
  return { codigo_unico: j.gabarito.codigo_unico };
}

// ─── Auth ───

export interface AuthUser {
  id: number;
  email: string;
  nome: string;
  role: string;
}

export function getToken(): string | null {
  return localStorage.getItem('omr_token');
}

export async function register(email: string, nome: string, password: string): Promise<{ access_token: string; user: AuthUser }> {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, nome, password }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j?.detail) detail = String(j.detail); } catch { /* ignore */ }
    throw new Error(detail);
  }
  const data = await res.json();
  localStorage.setItem('omr_token', data.access_token);
  localStorage.setItem('omr_user', JSON.stringify(data.user));
  return data;
}

export async function login(email: string, password: string): Promise<{ access_token: string; user: AuthUser }> {
  const params = new URLSearchParams();
  params.append('username', email);
  params.append('password', password);
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j?.detail) detail = String(j.detail); } catch { /* ignore */ }
    throw new Error(detail);
  }
  const data = await res.json();
  localStorage.setItem('omr_token', data.access_token);
  localStorage.setItem('omr_user', JSON.stringify(data.user));
  return data;
}

export async function getMe(): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/api/auth/me`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Falha ao validar sessão (${res.status})`);
  const user = await res.json();
  localStorage.setItem('omr_user', JSON.stringify(user));
  return user;
}

export function logout(): void {
  localStorage.removeItem('omr_token');
  localStorage.removeItem('omr_user');
}

// ─── Admin — usuários ───

export interface AdminUser {
  id: number;
  email: string;
  nome: string;
  role: string;
  is_active: boolean;
  created_at: string | null;
  avaliacoes: number;
}

export async function adminListUsers(): Promise<AdminUser[]> {
  const res = await fetch(`${API_BASE}/api/admin/users`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Falha ao listar usuários (${res.status})`);
  return res.json();
}

export async function adminUpdateUser(
  userId: number,
  patch: { role?: string; is_active?: boolean; password?: string },
): Promise<AdminUser> {
  const res = await fetch(`${API_BASE}/api/admin/users/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j?.detail) detail = String(j.detail); } catch { /* ignore */ }
    throw new Error(detail);
  }
  return res.json();
}

export async function adminDeleteUser(userId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/admin/users/${userId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j?.detail) detail = String(j.detail); } catch { /* ignore */ }
    throw new Error(detail);
  }
}
