import { useState, useEffect, useRef } from 'react';
import { AppView, isSaeExam } from '../types';
import { getExam, getExams, saveExam } from '../utils/storage';
import { getSubjectName, getSubjectIds, getSubjectRange } from '../utils/exam';
import { putAnswerKeyDB, processImage as apiProcessImage, loadAdaptiveFlag } from '../utils/api';
import { keyFromProcessResult, KeyFlag } from '../utils/key-from-photo';
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
  const [serverState, setServerState] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle');
  const [serverError, setServerError] = useState<string | null>(null);
  // Gabarito por foto
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [readSummary, setReadSummary] = useState<string | null>(null);
  const [flags, setFlags] = useState<Record<number, KeyFlag>>({});

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
      setFlags({});
      setReadError(null);
      setReadSummary(null);
    }
  }, [selectedExamId, userId]);

  const activeExam = selectedExamId ? exams.find(e => e.id === selectedExamId) : exam;
  const questionsPerSubject = activeExam?.questionsPerSubject || 22;
  const totalQuestions = activeExam?.totalQuestions || questionsPerSubject * 2;

  const handleSetAnswer = (q: number, answer: string) => {
    setAnswerKey(prev => ({ ...prev, [q]: answer }));
    // Rever manualmente limpa o aviso da foto
    setFlags(prev => {
      if (!prev[q]) return prev;
      const next = { ...prev };
      delete next[q];
      return next;
    });
    setSaved(false);
    setServerState('idle');
  };

  // ─── Gabarito por foto: lê um cartão-espelho marcado pelo professor ───
  const handleReadPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeExam) return;
    setReading(true);
    setReadError(null);
    setReadSummary(null);
    try {
      const template = activeExam.templateType === 'colar' ? 'colar' : isSaeExam(activeExam) ? 'sae' : 'padrao';
      const res = await apiProcessImage(
        file,
        activeExam.questionsPerSubject,
        activeExam.layoutMode ?? 'dual',
        template,
        loadAdaptiveFlag(),
      );
      if (!res.success || !res.answers) {
        setReadError(res.error || 'Falha na leitura da foto — tente novamente com melhor iluminação.');
        return;
      }
      const k = keyFromProcessResult(res, totalQuestions, template);
      setAnswerKey(k.key);
      setFlags(k.flags);
      const parts: string[] = [`${k.readCount} resposta(s) lida(s)`];
      if (k.blankCount) parts.push(`${k.blankCount} em branco`);
      if (k.duplicateCount) parts.push(`${k.duplicateCount} com dupla marcação`);
      if (k.lowCount) parts.push(`${k.lowCount} de leitura incerta`);
      const needReview = k.blankCount + k.duplicateCount + k.lowCount > 0;
      setReadSummary(
        `Foto lida: ${parts.join(' · ')}. `
        + (needReview ? 'Revise os destaques em âmbar antes de salvar.' : 'Confira e salve.')
        + (k.mismatchNote ? ` (${k.mismatchNote})` : ''),
      );
      setSaved(false);
      setServerState('idle');
    } catch {
      setReadError('Erro ao enviar a foto. Verifique o backend no PC (porta 8010 / ngrok ativo).');
    } finally {
      setReading(false);
    }
  };

  const handleSave = async () => {
    if (!activeExam) return;
    const filledCount = Object.keys(answerKey).length;
    if (filledCount < totalQuestions) {
      alert(`Preencha todas as ${totalQuestions} questões antes de salvar.`);
      return;
    }

    saveExam({ ...activeExam, answerKey }, userId);
    setServerState('saving');
    try {
      await putAnswerKeyDB(activeExam.id, answerKey);
      setServerState('ok');
    } catch (err) {
      setServerState('error');
      setServerError(err instanceof Error ? err.message : 'Falha ao salvar no servidor.');
    }
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
    setServerState('idle');
  };

  const filledCount = Object.keys(answerKey).length;

  const FLAG_LABEL: Record<KeyFlag, string> = {
    blank: '⚠ não lida na foto (em branco)',
    duplicate: '⚠ dupla marcação na foto',
    low: '⚠ leitura incerta',
  };

  const renderQuestionRow = (q: number, displayNumber: number) => {
    const flag = flags[q];
    return (
      <div
        key={q}
        className={`flex items-center gap-3 p-2 rounded-lg ${flag ? 'bg-amber-50 border border-amber-200' : 'hover:bg-gray-50'}`}
      >
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
        {flag ? (
          <span className="text-xs text-amber-700 ml-2">{FLAG_LABEL[flag]}</span>
        ) : answerKey[q] && (
          <span className="text-sm text-gray-500 ml-2">
            Resposta: <strong>{answerKey[q]}</strong>
          </span>
        )}
      </div>
    );
  };

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
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={reading}
                    className="btn btn-sm btn-primary min-h-[44px]"
                  >
                    {reading ? 'Lendo foto…' : '📷 Ler por foto'}
                  </button>
                  <button onClick={() => handleAutoFill('ABCD')} className="btn btn-sm btn-secondary min-h-[44px]">
                    Preencher ABCD
                  </button>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleReadPhoto}
              />
              <p className="text-xs text-gray-400 -mt-2">
                📷 Imprima um cartão vazio em “Gerar Cartões”, marque as respostas corretas com
                caneta escura e fotografe aqui — o gabarito é preenchido automaticamente.
              </p>

              {readSummary && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm">
                  {readSummary}
                </div>
              )}
              {readError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {readError}
                </div>
              )}

              {saved && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 text-sm">
                  Gabarito salvo com sucesso!
                  {serverState === 'saving' && <span className="block text-xs mt-1">Enviando ao servidor...</span>}
                  {serverState === 'ok' && <span className="block text-xs mt-1">✔ Salvo no servidor — disponível no celular.</span>}
                  {serverState === 'error' && (
                    <span className="block text-xs mt-1 text-red-600">
                      ✖ Só neste aparelho! Falha ao salvar no servidor: {serverError} Verifique o backend e salve de novo.
                    </span>
                  )}
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
