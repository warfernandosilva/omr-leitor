import { useState, useEffect } from 'react';
import { AppView } from '../types';
import { getExam, getExams, saveExam } from '../utils/storage';
import { getSubjectName, getSubjectIds, getSubjectRange } from '../utils/exam';
import { putAnswerKeyDB } from '../utils/api';
import { useAuth } from '../context/AuthContext';

interface Props {
  examId: string | null;
  onNavigate: (view: AppView, examId?: string) => void;
}

const OPTIONS = ['A', 'B', 'C', 'D'];

export default function RegisterKeyPage({ examId, onNavigate }: Props) {
  const { user } = useAuth();
  const userId = user?.id;
  const exams = getExams(userId);
  const exam = examId ? getExam(examId, userId) : null;
  const [selectedExamId, setSelectedExamId] = useState(examId || '');
  const [answerKey, setAnswerKey] = useState<Record<number, string>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (examId) {
      setSelectedExamId(examId);
      const e = getExam(examId, userId);
      if (e?.answerKey) setAnswerKey(e.answerKey);
    }
  }, [examId, userId]);

  useEffect(() => {
    if (selectedExamId) {
      const e = getExam(selectedExamId, userId);
      if (e?.answerKey) setAnswerKey(e.answerKey);
      else setAnswerKey({});
    }
  }, [selectedExamId, userId]);

  const activeExam = selectedExamId ? exams.find(e => e.id === selectedExamId) : exam;
  const questionsPerSubject = activeExam?.questionsPerSubject || 22;
  const totalQuestions = activeExam?.totalQuestions || questionsPerSubject * 2;

  const handleSetAnswer = (q: number, answer: string) => {
    setAnswerKey(prev => ({ ...prev, [q]: answer }));
    setSaved(false);
  };

  const handleSave = async () => {
    if (!activeExam) return;
    const filledCount = Object.keys(answerKey).length;
    if (filledCount < totalQuestions) {
      alert(`Preencha todas as ${totalQuestions} questões antes de salvar.`);
      return;
    }

    saveExam({ ...activeExam, answerKey }, userId);
    putAnswerKeyDB(activeExam.id, answerKey).catch(() => {});
    setSaved(true);
  };

  const handleAutoFill = (pattern: string) => {
    const newKey: Record<number, string> = {};
    for (let i = 1; i <= totalQuestions; i++) {
      const idx = (i - 1) % pattern.length;
      newKey[i] = pattern[idx];
    }
    setAnswerKey(newKey);
    setSaved(false);
  };

  const filledCount = Object.keys(answerKey).length;

  const renderQuestionRow = (q: number, displayNumber: number) => (
    <div key={q} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50">
      <span className="w-8 text-sm font-bold text-gray-700 text-right">
        {String(displayNumber).padStart(2, '0')}
      </span>
      <div className="flex gap-2">
        {OPTIONS.map((opt) => (
          <button
            key={opt}
            onClick={() => handleSetAnswer(q, opt)}
            className={`bubble-option w-10 h-10 ${
              answerKey[q] === opt ? 'selected' : ''
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
      {answerKey[q] && (
        <span className="text-sm text-gray-500 ml-2">
          Resposta: <strong>{answerKey[q]}</strong>
        </span>
      )}
    </div>
  );

  const renderSubjectSection = (sid: 'lp' | 'mat', start: number, end: number) => (
    <div key={sid} className="mb-4">
      <h3 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
        {activeExam ? getSubjectName(activeExam, sid) : sid.toUpperCase()} (1–{end - start + 1})
      </h3>
      <div className="space-y-1">
        {Array.from({ length: end - start + 1 }, (_, i) => start + i).map((q, idx) => renderQuestionRow(q, idx + 1))}
      </div>
    </div>
  );

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Cadastrar Gabarito</h1>
      <p className="text-gray-500 mb-6">Defina a resposta correta para cada questão</p>

      <div className="card max-w-2xl mb-6">
        <div className="space-y-4">
          <div>
            <label className="label">Selecione a Prova</label>
            {exams.length === 0 ? (
              <div className="text-sm text-gray-500">
                <p>Nenhuma prova cadastrada.</p>
                <button onClick={() => onNavigate('new-exam')} className="btn btn-primary btn-sm mt-2">Criar Prova</button>
              </div>
            ) : (
              <select
                className="input"
                value={selectedExamId}
                onChange={(e) => setSelectedExamId(e.target.value)}
              >
                <option value="">Selecione...</option>
                {exams.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            )}
          </div>

          {activeExam && (
            <>
              <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                <span className="text-sm text-gray-600">
                  Progresso: <strong>{filledCount}/{totalQuestions}</strong> questões
                </span>
                <div className="flex gap-2">
                  <button onClick={() => handleAutoFill('ABCD')} className="btn btn-sm btn-secondary">
                    Preencher ABCD
                  </button>
                </div>
              </div>

              {saved && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 text-sm">
                  Gabarito salvo com sucesso!
                </div>
              )}

              <div>
                {getSubjectIds(activeExam).map((sid) => {
                  const [start, end] = getSubjectRange(sid, questionsPerSubject, activeExam.layoutMode);
                  return renderSubjectSection(sid, start, end);
                })}
              </div>

              <div className="flex gap-3 pt-4">
                <button onClick={handleSave} className="btn btn-primary" disabled={filledCount < totalQuestions}>
                  Salvar Gabarito
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
