import type { Exam } from '../../types';
import { calculateGrade } from '../../utils/grade';
import { computeSubjectStats, getSubjectIds, getSubjectName, getSubjectRange } from '../../utils/exam';
import Badge from '../ui/Badge';

export interface SummaryResultLike {
  duplicateQuestions?: number[];
  duplicateMarks?: Record<number, string[]>;
}

interface Props {
  exam: Exam;
  result: SummaryResultLike;
  manualAnswers: Record<number, string>;
}

/** Resumo da correção: totais, nota e desempenho por disciplina. */
export default function ResultSummaryPanel({ exam, result, manualAnswers }: Props) {
  const duplicates = result.duplicateQuestions ?? [];
  let correct = 0;
  let incorrect = 0;
  let blank = 0;

  for (let q = 1; q <= exam.totalQuestions; q++) {
    const answer = manualAnswers[q];
    if (!answer) {
      if (duplicates.includes(q)) incorrect++;
      else blank++;
    } else if (exam.answerKey?.[q] && answer === exam.answerKey[q]) correct++;
    else incorrect++;
  }

  const grade = calculateGrade(correct, exam.totalQuestions, exam.gradeScale);
  const subjectStats = computeSubjectStats(exam, manualAnswers, duplicates);
  const subjectIds = getSubjectIds(exam);
  const gradeLabel = exam.gradeScale === 'count'
    ? 'Acertos'
    : `Nota (0-${exam.gradeScale === '0-10' ? '10' : '100'})`;

  return (
    <div className="card">
      <div className="section-header mb-4">
        <h3 className="text-lg font-semibold text-[#172B4D] dark:text-white">Resumo</h3>
        {duplicates.length > 0 && <Badge tone="warning">Duplicada conta como erro</Badge>}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="panel text-center">
          <p className="text-2xl font-bold text-success-600 dark:text-success-100">{correct}</p>
          <p className="text-xs text-[#71809A] dark:text-gray-400">Acertos</p>
        </div>
        <div className="panel text-center">
          <p className="text-2xl font-bold text-danger-600 dark:text-danger-100">{incorrect}</p>
          <p className="text-xs text-[#71809A] dark:text-gray-400">Erros</p>
        </div>
        <div className="panel text-center">
          <p className="text-2xl font-bold text-[#71809A] dark:text-gray-400">{blank}</p>
          <p className="text-xs text-[#71809A] dark:text-gray-400">Em branco</p>
        </div>
        <div className="panel text-center">
          <p className="text-2xl font-bold text-warning-600 dark:text-warning-100">{duplicates.length}</p>
          <p className="text-xs text-[#71809A] dark:text-gray-400">Duplicadas</p>
        </div>
        <div className="panel text-center">
          <p className="text-2xl font-bold text-brand-600 dark:text-brand-200">
            {exam.gradeScale === 'count' ? correct : grade}
          </p>
          <p className="text-xs text-[#71809A] dark:text-gray-400">{gradeLabel}</p>
        </div>
      </div>

      <div className={`mt-4 grid gap-3 ${subjectIds.length > 1 ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
        {subjectIds.map((sid) => {
          const stats = subjectStats[sid];
          const [start, end] = getSubjectRange(sid, exam.questionsPerSubject, exam.layoutMode);
          return (
            <div key={sid} className="panel">
              <p className="text-sm font-semibold text-[#172B4D] dark:text-white mb-2 truncate">
                {getSubjectName(exam, sid)}
              </p>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-[#71809A] dark:text-gray-400">
                  {stats.correctCount}/{end - start + 1} acertos
                </span>
                <span className="text-xl font-bold text-brand-600 dark:text-brand-200">
                  {exam.gradeScale === 'count' ? stats.correctCount : stats.grade}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
