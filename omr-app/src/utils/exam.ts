import { Exam, SubjectId, SubjectStats, SUBJECT_IDS } from '../types';
import { calculateGrade } from './grade';

export { SUBJECT_IDS };

export const QUESTIONS_PER_SUBJECT = 22;

export const SUBJECT_LABELS: Record<SubjectId, string> = {
  lp: 'Língua Portuguesa',
  mat: 'Matemática',
};

/** Disciplinas que a prova possui (1 no modo coluna única, 2 no padrão). */
export function getSubjectIds(exam?: Pick<Exam, 'layoutMode'> | null): SubjectId[] {
  return exam?.layoutMode === 'single' ? ['lp'] : [...SUBJECT_IDS];
}

export function getSubjectRange(
  subjectId: SubjectId,
  qps = QUESTIONS_PER_SUBJECT,
  layoutMode?: 'dual' | 'single',
): [number, number] {
  if (layoutMode === 'single') return [1, qps];
  return subjectId === 'lp' ? [1, qps] : [qps + 1, qps * 2];
}

export function getSubjectName(exam: Exam, subjectId: SubjectId): string {
  return subjectId === 'lp' ? exam.subjectLP : exam.subjectMat;
}

export function computeSubjectStats(
  exam: Exam,
  answers: Record<number, string>,
  duplicateQuestions: number[] = [],
): Record<SubjectId, SubjectStats> {
  const key = exam.answerKey || {};
  const single = exam.layoutMode === 'single';
  const result: Record<SubjectId, SubjectStats> = {
    lp: { correctCount: 0, incorrectCount: 0, blankCount: 0, grade: 0 },
    mat: { correctCount: 0, incorrectCount: 0, blankCount: 0, grade: 0 },
  };

  for (const sid of getSubjectIds(exam)) {
    const [start, end] = getSubjectRange(sid, exam.questionsPerSubject, exam.layoutMode);
    let correct = 0;
    let incorrect = 0;
    let blank = 0;
    for (let q = start; q <= end; q++) {
      const ans = answers[q];
      if (!ans) {
        // Política: duplicada sem resposta resolvida conta como ERRO
        if (duplicateQuestions.includes(q)) incorrect++;
        else blank++;
      } else if (key[q] && ans === key[q]) correct++;
      else incorrect++;
    }
    result[sid].correctCount = correct;
    result[sid].incorrectCount = incorrect;
    result[sid].blankCount = blank;
    result[sid].grade = calculateGrade(correct, end - start + 1, exam.gradeScale);
  }

  if (single) result.mat.grade = 0;
  return result;
}
