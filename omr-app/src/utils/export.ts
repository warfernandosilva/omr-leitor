import { StudentResult, Exam } from '../types';
import * as XLSX from 'xlsx';
import { computeSubjectStats, SUBJECT_LABELS } from './exam';

function resolveTotalQuestions(exams: Exam[]): number {
  return exams.reduce((m, e) => Math.max(m, e?.totalQuestions || 44), 44);
}

function getResultRow(result: StudentResult, exams: Exam[], totalQuestions: number): (string | number)[] {
  const exam = exams.find(e => e.id === result.examId);
  const row: (string | number)[] = [
    result.studentName,
    new Date(result.timestamp).toLocaleString('pt-BR'),
  ];
  for (let i = 1; i <= totalQuestions; i++) {
    row.push(result.answers[i] || '—');
  }
  row.push(result.correctCount, result.incorrectCount, result.blankCount, result.duplicateCount, result.grade);

  if (exam) {
    const stats = computeSubjectStats(exam, result.answers);
    row.push(
      stats.lp.correctCount,
      exam.gradeScale === 'count' ? stats.lp.correctCount : stats.lp.grade,
      stats.mat.correctCount,
      exam.gradeScale === 'count' ? stats.mat.correctCount : stats.mat.grade,
    );
  } else {
    row.push(0, 0, 0, 0);
  }
  return row;
}

function buildHeaders(totalQuestions: number): string[] {
  const headers = ['Nome', 'Data/Hora'];
  for (let i = 1; i <= totalQuestions; i++) headers.push(`Q${i}`);
  headers.push(
    'Acertos', 'Erros', 'Em branco', 'Duplicadas', 'Nota',
    `${SUBJECT_LABELS.lp} - Acertos`, `${SUBJECT_LABELS.lp} - Nota`,
    `${SUBJECT_LABELS.mat} - Acertos`, `${SUBJECT_LABELS.mat} - Nota`,
  );
  return headers;
}

export function exportToCSV(results: StudentResult[], exams: Exam[]): string {
  const totalQuestions = resolveTotalQuestions(exams);
  const headers = buildHeaders(totalQuestions);
  const rows = results.map(r => getResultRow(r, exams, totalQuestions));

  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  return csvContent;
}

export function downloadCSV(results: StudentResult[], exams: Exam[]): void {
  const csv = exportToCSV(results, exams);
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `resultados_omr_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadXLSX(results: StudentResult[], exams: Exam[]): void {
  const totalQuestions = resolveTotalQuestions(exams);
  const headers = buildHeaders(totalQuestions);
  const rows = results.map(r => getResultRow(r, exams, totalQuestions));

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [
    { wch: 25 }, { wch: 20 },
    ...Array(totalQuestions).fill({ wch: 6 }),
    { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 8 },
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Resultados');
  XLSX.writeFile(wb, `resultados_omr_${new Date().toISOString().slice(0, 10)}.xlsx`);
}