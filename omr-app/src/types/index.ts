export interface Exam {
  id: string;
  name: string;
  subjectLP: string;
  subjectMat: string;
  questionsPerSubject: number;
  totalQuestions: number;
  createdAt: string;
  gradeScale: '0-10' | '0-100' | 'count';
  answerKey: Record<number, string> | null;
  layoutMode?: 'dual' | 'single';
  /** Modelo do cartão: 'padrao' (ArUco), 'sae' (Avaliação Contínua), 'colar' (Colar em Avaliação, só grade) ou 'saev' (Gabarito SAEV, dual 16+16 a 26+26). */
  templateType?: 'padrao' | 'sae' | 'colar' | 'saev';
  /** Cabeçalho editável do cartão SAE (só quando templateType === 'sae'). */
  saeSpec?: SaeSpec;
}

/** Cabeçalho editável do cartão "Avaliação Contínua" (espelha SaeSpec do backend). */
export interface SaeSpec {
  ano: string;
  programa_linha1: string;
  programa_linha2: string;
  titulo: string[];
  caderno: string;
  disciplina: string;
  serie: string;
  qr_payload: string;
  codigo_barras: string;
}

export const DEFAULT_SAE_SPEC: SaeSpec = {
  ano: '2026',
  programa_linha1: 'AVALIAÇÃO CONTÍNUA DA APRENDIZAGEM',
  programa_linha2: 'NOS ANOS FINAIS - CICLO II',
  titulo: ['AVALIAÇÃO CONTÍNUA', 'DA APRENDIZAGEM', 'NOS ANOS FINAIS', 'CICLO II'],
  caderno: 'M0901',
  disciplina: 'MATEMÁTICA',
  serie: '9º ano do Ensino Fundamental',
  qr_payload: '2269M0901',
  codigo_barras: '6357256532',
};

export const SAE_MAX_QUESTIONS = 28;

/** qps por disciplina no Gabarito SAEV (dual). */
export const SAEV_MIN_QPS = 16;
export const SAEV_MAX_QPS = 26;

export function isSaeExam(exam?: Pick<Exam, 'templateType'> | null): boolean {
  return exam?.templateType === 'sae';
}

export function isSaevExam(exam?: Pick<Exam, 'templateType'> | null): boolean {
  return exam?.templateType === 'saev';
}

/** SAE e Colar compartilham a mesma geometria de grade/âncoras (leitura e overlay). */
export function isSaeFamilyExam(exam?: Pick<Exam, 'templateType'> | null): boolean {
  return exam?.templateType === 'sae' || exam?.templateType === 'colar';
}

export function templateLabel(t?: Exam['templateType']): string {
  if (t === 'sae') return 'Avaliação Contínua';
  if (t === 'colar') return 'Colar em Avaliação';
  if (t === 'saev') return 'Gabarito SAEV';
  return 'Padrão';
}

export interface OMRResult {
  answers: Record<number, string>;
  blankQuestions: number[];
  duplicateQuestions: number[];
  lowConfidence: number[];
}

export interface StudentResult {
  id: string;
  examId: string;
  studentName: string;
  answers: Record<number, string>;
  correctCount: number;
  incorrectCount: number;
  blankCount: number;
  duplicateCount: number;
  duplicateQuestions?: number[];
  duplicateMarks?: Record<number, string[]>;
  codigoUnico?: string;
  grade: number;
  timestamp: string;
  manualOverrides: Record<number, string>;
  /** Questões de leitura incerta no OMR (para a fila de revisão) */
  lowConfidence?: number[];
  /** false = QR não lido na foto que gerou este resultado */
  qrOk?: boolean;
  /** professor já revisou as pendências deste resultado */
  reviewed?: boolean;
}

export type AppView =
  | 'home'
  | 'new-exam'
  | 'generate-card'
  | 'import-students'
  | 'manage-exam'
  | 'register-key'
  | 'correct-card'
  | 'results'
  | 'dashboard'
  | 'export'
  | 'view-result'
  | 'admin-users';

export const SUBJECT_IDS = ['lp', 'mat'] as const;
export type SubjectId = (typeof SUBJECT_IDS)[number];

export interface SubjectStats {
  correctCount: number;
  incorrectCount: number;
  blankCount: number;
  grade: number;
}