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