import { useState, useEffect } from 'react';
import { ArrowLeft, BadgeCheck } from 'lucide-react';
import { AppView } from '../types';
import { getResult, getExam, saveResult } from '../utils/storage';
import { computeSubjectStats, getSubjectName, getSubjectIds, getSubjectRange } from '../utils/exam';
import { getResultadosFromDB } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import StatCard from '../components/ui/StatCard';
import EmptyState from '../components/ui/EmptyState';

interface Props {
  resultId: string | null;
  onNavigate: (view: AppView) => void;
}

export default function ViewResultPage({ resultId, onNavigate }: Props) {
  const { user } = useAuth();
  const userId = user?.id;

  const [dbResult, setDbResult] = useState<ReturnType<typeof getResult> | null>(null);
  const [loading, setLoading] = useState(false);
  const [justReviewed, setJustReviewed] = useState(false);

  const local = resultId ? getResult(resultId, userId) : null;

  useEffect(() => {
    if (local || !resultId) return;
    setLoading(true);
    getResultadosFromDB().then(list => {
      const found = list.find(r => r.codigo_unico === resultId);
      if (found) {
        setDbResult({
          id: found.codigo_unico,
          examId: found.avaliacao.external_id,
          studentName: found.aluno.nome,
          answers: (found.respostas as Record<number, string>) || {},
          correctCount: found.acertos ?? 0,
          incorrectCount: found.erros ?? 0,
          blankCount: found.brancos ?? 0,
          duplicateCount: 0,
          duplicateQuestions: [],
          codigoUnico: found.codigo_unico,
          grade: found.nota ?? 0,
          timestamp: found.data_correcao || new Date().toISOString(),
          manualOverrides: {},
        } as ReturnType<typeof getResult>);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [resultId, local]);

  const result = local || dbResult;
  const exam = result ? getExam(result.examId, userId) : null;

  const reviewed = justReviewed || result?.reviewed === true;
  const pendingDup = result && !reviewed ? (result.duplicateQuestions ?? []) : [];
  const pendingLow = result && !reviewed ? (result.lowConfidence ?? []) : [];
  const needsReview = pendingDup.length > 0 || pendingLow.length > 0;

  const handleMarkReviewed = () => {
    if (!result || !local) return;
    saveResult({ ...result, reviewed: true }, userId);
    setJustReviewed(true);
  };

  if (loading) {
    return <div className="card text-center py-12"><p className="text-gray-500 dark:text-gray-400" role="status">Carregando...</p></div>;
  }

  if (!result || !exam) {
    return (
      <EmptyState
        title="Resultado não encontrado"
        action={<Button onClick={() => onNavigate('results')}>Voltar aos resultados</Button>}
      />
    );
  }

  const getGradeLabel = () => {
    if (exam.gradeScale === 'count') return 'Acertos';
    return `Nota (0-${exam.gradeScale === '0-10' ? '10' : '100'})`;
  };

  const subjectStats = computeSubjectStats(exam, result.answers, result.duplicateQuestions ?? []);

  const renderSubjectTable = (sid: 'lp' | 'mat', start: number, end: number) => (
    <div key={sid} className="mb-6 last:mb-0">
      <h4 className="text-sm font-bold text-gray-600 dark:text-gray-300 mb-2">
        {getSubjectName(exam, sid)} (1–{end - start + 1})
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line dark:border-gray-700">
              <th className="py-2 px-3 text-left font-medium text-gray-500 dark:text-gray-400">Questão</th>
              <th className="py-2 px-3 text-left font-medium text-gray-500 dark:text-gray-400">Resposta</th>
              <th className="py-2 px-3 text-left font-medium text-gray-500 dark:text-gray-400">Gabarito</th>
              <th className="py-2 px-3 text-center font-medium text-gray-500 dark:text-gray-400">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: end - start + 1 }, (_, i) => start + i).map((q) => {
              const answer = result.answers[q] || null;
              const correct = exam.answerKey?.[q];
              const isCorrect = answer && correct && answer === correct;
              const isDupUnresolved = !answer && (result.duplicateQuestions ?? []).includes(q);
              const dupMarksQ = result.duplicateMarks?.[q];

              return (
                <tr key={q} className="border-b border-line/60 dark:border-gray-800">
                  <td className="py-2 px-3 font-bold text-gray-600 dark:text-gray-300 tabular-nums">{String(q - start + 1).padStart(2, '0')}</td>
                  <td className="py-2 px-3">
                    {answer ? (
                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-brand-50 text-brand-700 font-bold text-sm dark:bg-brand-700/20 dark:text-brand-200">
                        {answer}
                      </span>
                    ) : (
                      <span className="text-gray-300 dark:text-gray-600">—</span>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    {correct ? (
                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-surface text-gray-600 font-bold text-sm dark:bg-gray-800 dark:text-gray-300">
                        {correct}
                      </span>
                    ) : (
                      <span className="text-gray-300 dark:text-gray-600">—</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-center">
                    {isCorrect ? (
                      <span className="text-success-600 dark:text-success-100 font-medium">✓ Correta</span>
                    ) : isDupUnresolved ? (
                      <span className="text-danger-600 dark:text-danger-100 font-medium">
                        ✗ Incorreta{' '}
                        <span className="text-xs">
                          (marcou {dupMarksQ?.length ? dupMarksQ.join(' e ') : 'duas alternativas'})
                        </span>
                      </span>
                    ) : !answer ? (
                      <span className="text-xs text-gray-400 dark:text-gray-500">Em branco</span>
                    ) : (
                      <span className="text-danger-600 dark:text-danger-100 font-medium">✗ Incorreta</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-4 animate-fade-in">
      <PageHeader
        title={result.studentName}
        subtitle={`${exam.name} — ${exam.subjectLP} + ${exam.subjectMat}`}
        actions={
          <Button variant="secondary" size="sm" onClick={() => onNavigate('results')} icon={<ArrowLeft size={15} aria-hidden />}>
            Voltar
          </Button>
        }
      />

      <div className="card">
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="text-sm text-gray-400 dark:text-gray-500">
            Corrigido em {new Date(result.timestamp).toLocaleString('pt-BR')}
          </p>
          <div className="text-right shrink-0">
            <p className="text-3xl font-bold text-brand-600 dark:text-brand-200 tabular-nums">
              {exam.gradeScale === 'count' ? result.correctCount : result.grade}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{getGradeLabel()}</p>
          </div>
        </div>

        {(needsReview || reviewed) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {pendingDup.length > 0 && (
              <Badge tone="warning">{pendingDup.length} duplicada(s): Q{pendingDup.join(', Q')}</Badge>
            )}
            {pendingLow.length > 0 && (
              <Badge tone="warning">{pendingLow.length} leitura(s) incerta(s): Q{pendingLow.join(', Q')}</Badge>
            )}
            {needsReview ? (
              local && (
                <Button size="sm" onClick={handleMarkReviewed} icon={<BadgeCheck size={15} aria-hidden />}>
                  Marcar como revisado
                </Button>
              )
            ) : (
              <Badge tone="success" icon={<BadgeCheck size={13} aria-hidden />}>Revisado</Badge>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold text-ink dark:text-white mb-4">Resumo</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <StatCard label="Acertos" value={result.correctCount} tone="success" />
          <StatCard label="Erros" value={result.incorrectCount} tone="danger" />
          <StatCard label="Em branco" value={result.blankCount} />
          <StatCard label="Duplicadas" value={result.duplicateCount} tone={result.duplicateCount > 0 ? 'warning' : 'default'} />
          <StatCard label={getGradeLabel()} value={exam.gradeScale === 'count' ? result.correctCount : result.grade} tone="info" />
        </div>
        <div className={`grid gap-3 ${getSubjectIds(exam).length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {getSubjectIds(exam).map((sid) => {
            const st = subjectStats[sid];
            const [sStart, sEnd] = getSubjectRange(sid, exam.questionsPerSubject, exam.layoutMode);
            return (
              <div key={sid} className="rounded-lg border border-line dark:border-gray-700 p-4">
                <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-2 truncate">
                  {getSubjectName(exam, sid)}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {st.correctCount}/{sEnd - sStart + 1} acertos ({st.incorrectCount} erros, {st.blankCount} em branco)
                  </span>
                  <span className="text-2xl font-bold text-brand-600 dark:text-brand-200 tabular-nums">
                    {exam.gradeScale === 'count' ? st.correctCount : st.grade}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold text-ink dark:text-white mb-4">Respostas detalhadas</h3>
        {getSubjectIds(exam).map((sid) => {
          const [start, end] = getSubjectRange(sid, exam.questionsPerSubject, exam.layoutMode);
          return renderSubjectTable(sid, start, end);
        })}
      </div>
    </div>
  );
}
