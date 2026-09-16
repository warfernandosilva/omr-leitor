import { Exam } from '../types';

export function calculateGrade(
  correctCount: number,
  totalQuestions: number,
  scale: Exam['gradeScale']
): number {
  if (scale === 'count') return correctCount;
  const max = scale === '0-10' ? 10 : 100;
  return Math.round((correctCount / totalQuestions) * max * 10) / 10;
}