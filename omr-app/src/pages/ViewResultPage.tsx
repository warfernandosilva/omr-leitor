import { useState, useEffect } from 'react';
import { AppView } from '../types';
import { getResult, getExam, saveResult } from '../utils/storage';
import { computeSubjectStats, getSubjectName, getSubjectIds, getSubjectRange } from '../utils/exam';
import { getResultadosFromDB } from '../utils/api';
import { useAuth } from '../context/AuthContext';

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
  const exam = result ? getExam(result.examId, userId) || getExam(result.examId) : null;

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
    return <div className="card text-center py-12"><p className="text-gray-500">Carregando...</p></div>;
  }

  if (!result || !exam) {
    return (
      <div className="card text-center py-12">
        <p className="text-gray-500">Resultado não encontrado.</p>
        <button onClick={() => onNavigate('results')} className="btn btn-primary mt-4">
          Voltar aos Resultados
        </button>
      </div>
    );
  }

  const getGradeLabel = () => {
    if (exam.gradeScale === 'count') return 'Acertos';
    return `Nota (0-${exam.gradeScale === '0-10' ? '10' : '100'})`;
  };

  const subjectStats = computeSubjectStats(exam, result.answers, result.duplicateQuestions ?? []);

  const renderSubjectTable = (sid: 'lp' | 'mat', start: number, end: number) => (
    <div key={sid} className="mb-6">
      <h4 className="text-sm font-bold text-gray-700 mb-2">
        {getSubjectName(exam, sid)} (1–{end - start + 1})
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="py-2 px-3 text-left font-medium text-gray-500">Questão</th>
              <th className="py-2 px-3 text-left font-medium text-gray-500">Resposta</th>
              <th className="py-2 px-3 text-left font-medium text-gray-500">Gabarito</th>
              <th className="py-2 px-3 text-center font-medium text-gray-500">Resultado</th>
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
                <tr key={q} className="border-b border-gray-50">
                  <td className="py-2 px-3 font-bold text-gray-700">{String(q - start + 1).padStart(2, '0')}</td>
                  <td className="py-2 px-3">
                    {answer ? (
                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-bold text-sm">
                        {answer}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    {correct ? (
                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 text-gray-700 font-bold text-sm">
                        {correct}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-center">
                    {isCorrect ? (
                      <span className="text-emerald-600 font-medium">✓ Correta</span>
                    ) : isDupUnresolved ? (
                      <span className="text-red-600 font-medium">
                        ✗ Incorreta{' '}
                        <span className="text-xs">
                          (marcou {dupMarksQ?.length ? dupMarksQ.join(' e ') : 'duas alternativas'})
                        </span>
                      </span>
                    ) : !answer ? (
                      <span className="text-xs text-gray-400">Em branco</span>
                    ) : (
                      <span className="text-red-600 font-medium">✗ Incorreta</span>
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
    <div className="max-w-3xl mx-auto">
      <button onClick={() => onNavigate('results')} className="btn btn-secondary mb-4">
        ← Voltar
      </button>

      <div className="card mb-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{result.studentName}</h1>
            <p className="text-gray-500">{exam.name} — {exam.subjectLP} + {exam.subjectMat}</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-blue-600">
              {exam.gradeScale === 'count' ? result.correctCount : result.grade}
            </p>
            <p className="text-xs text-gray-500">{getGradeLabel()}</p>
          </div>
        </div>

        <p className="text-sm text-gray-400">
          Corrigido em {new Date(result.timestamp).toLocaleString('pt-BR')}
        </p>
        {(needsReview || reviewed) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {pendingDup.length > 0 && (
              <span className="text-xs font-medium bg-orange-100 text-orange-700 px-2 py-1 rounded-full">
                {pendingDup.length} duplicada(s): Q{pendingDup.join(', Q')}
              </span>
            )}
            {pendingLow.length > 0 && (
              <span className="text-xs font-medium bg-amber-100 text-amber-700 px-2 py-1 rounded-full">
                {pendingLow.length} leitura(s) incerta(s): Q{pendingLow.join(', Q')}
              </span>
            )}
            {needsReview ? (
              local && (
                <button onClick={handleMarkReviewed} className="btn btn-sm btn-primary min-h-[44px]">
                  ✓ Marcar como revisado
                </button>
              )
            ) : (
              <span className="text-xs font-medium bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full">
                ✓ Revisado
              </span>
            )}
          </div>
        )}
      </div>

      <div className="card mb-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Resumo</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
          <div className="bg-emerald-50 rounded-lg p-4 text-center">
            <p className="text-3xl font-bold text-emerald-600">{result.correctCount}</p>
            <p className="text-sm text-emerald-600/70">Acertos</p>
          </div>
          <div className="bg-red-50 rounded-lg p-4 text-center">
            <p className="text-3xl font-bold text-red-600">{result.incorrectCount}</p>
            <p className="text-sm text-red-600/70">Erros</p>
          </div>
          <div className="bg-gray-100 rounded-lg p-4 text-center">
            <p className="text-3xl font-bold text-gray-500">{result.blankCount}</p>
            <p className="text-sm text-gray-500/70">Em branco</p>
          </div>
          <div className="bg-orange-50 rounded-lg p-4 text-center">
            <p className="text-3xl font-bold text-orange-600">{result.duplicateCount}</p>
            <p className="text-sm text-orange-600/70">Duplicadas</p>
          </div>
          <div className="bg-blue-50 rounded-lg p-4 text-center">
            <p className="text-3xl font-bold text-blue-600">
              {exam.gradeScale === 'count' ? result.correctCount : result.grade}
            </p>
            <p className="text-sm text-blue-600/70">{getGradeLabel()}</p>
          </div>
        </div>
        <div className={`grid gap-4 ${getSubjectIds(exam).length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {getSubjectIds(exam).map((sid) => {
            const st = subjectStats[sid];
            const [sStart, sEnd] = getSubjectRange(sid, exam.questionsPerSubject, exam.layoutMode);
            return (
              <div key={sid} className="rounded-lg border border-gray-200 p-4">
                <p className="text-sm font-semibold text-gray-700 mb-2 truncate">
                  {getSubjectName(exam, sid)}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">
                    {st.correctCount}/{sEnd - sStart + 1} acertos ({st.incorrectCount} erros, {st.blankCount} em branco)
                  </span>
                  <span className="text-2xl font-bold text-blue-600">
                    {exam.gradeScale === 'count' ? st.correctCount : st.grade}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Respostas Detalhadas</h3>
        {getSubjectIds(exam).map((sid) => {
          const [start, end] = getSubjectRange(sid, exam.questionsPerSubject, exam.layoutMode);
          return renderSubjectTable(sid, start, end);
        })}
      </div>
    </div>
  );
}
