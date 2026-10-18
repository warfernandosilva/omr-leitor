import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Camera, CheckCircle2, Focus, Save, Wand2, XCircle } from 'lucide-react';
import { AppView, isCustomExam, isSaeExam, isSaevExam, isHerbyExam, isSimuladoExam } from '../types';
import { getExam, getExams, saveExam } from '../utils/storage';
import { getSubjectName, getSubjectIds, getSubjectRange } from '../utils/exam';
import { putAnswerKeyDB, processImage as apiProcessImage, loadAdaptiveFlag } from '../utils/api';
import { getCustomTemplate } from '../utils/custom-template-api';
import { keyFromProcessResult, KeyFlag } from '../utils/key-from-photo';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/ui/PageHeader';
import Field from '../components/ui/Field';
import Select from '../components/ui/Select';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import CornerEditor from '../components/CornerEditor';

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
  // Custom: guarda a última foto p/ reler marcando os cantos à mão
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [cornerEdit, setCornerEdit] = useState(false);
  // Multi-página (mesma folha): página do gabarito sendo lida.
  const [customPage, setCustomPage] = useState(0);
  const [customNPages, setCustomNPages] = useState(1);
  const [readPages, setReadPages] = useState<Set<number>>(new Set());

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
      setPhotoUrl(null);
      setCustomPage(0);
      setReadPages(new Set());
    }
  }, [selectedExamId, userId]);

  const activeExam = selectedExamId ? exams.find(e => e.id === selectedExamId) : exam;
  // Multi-página: descobre o nº de páginas do modelo custom vinculado.
  useEffect(() => {
    if (!activeExam || !isCustomExam(activeExam) || activeExam.customTemplateId == null) {
      setCustomNPages(1);
      return;
    }
    let alive = true;
    getCustomTemplate(activeExam.customTemplateId)
      .then((d) => { if (alive) setCustomNPages(Math.max(1, d.config.n_pages ?? 1)); })
      .catch(() => { if (alive) setCustomNPages(1); });
    return () => { alive = false; };
  }, [activeExam?.customTemplateId, activeExam]);
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
  const readKeyFromFile = async (file: File, corners?: [number, number][], page?: number) => {
    if (!activeExam) return;
    setReading(true);
    setReadError(null);
    setReadSummary(null);
    try {
      const template = isCustomExam(activeExam) ? 'custom' : activeExam.templateType === 'colar' ? 'colar' : isSaevExam(activeExam) ? 'saev' : isSaeExam(activeExam) ? 'sae' : isHerbyExam(activeExam) ? 'herby' : isSimuladoExam(activeExam) ? 'simulado' : 'padrao';
      const res = await apiProcessImage(
        file,
        activeExam.questionsPerSubject,
        activeExam.layoutMode ?? 'dual',
        template,
        loadAdaptiveFlag() || isSaevExam(activeExam) || isHerbyExam(activeExam) || isSimuladoExam(activeExam),
        false,
        activeExam.customTemplateId,
        corners ?? null,
        isCustomExam(activeExam) ? (page ?? customPage) : undefined,
      );
      if (!res.success || !res.answers) {
        setReadError(res.error || 'Falha na leitura da foto — tente novamente com melhor iluminação.');
        return;
      }
      const k = keyFromProcessResult(res, totalQuestions, template);
      // Multi-página: acumula as respostas por página.
      if (isCustomExam(activeExam) && customNPages > 1) {
        setAnswerKey((prev) => ({ ...prev, ...k.key }));
        setReadPages((s) => new Set(s).add(customPage));
      } else {
        setAnswerKey(k.key);
      }
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

  const handleReadPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeExam) return;
    // guarda a foto: se a leitura falhar, dá para tentar de novo marcando os cantos
    const reader = new FileReader();
    reader.onload = () => setPhotoUrl(reader.result as string);
    reader.readAsDataURL(file);
    await readKeyFromFile(file);
  };

  // Custom: relê a MESMA foto usando os 4 cantos marcados à mão
  const handleReadWithCorners = async (corners: [number, number][]) => {
    setCornerEdit(false);
    if (!photoUrl) return;
    try {
      const blob = await (await fetch(photoUrl)).blob();
      await readKeyFromFile(
        new File([blob], 'gabarito.jpg', { type: blob.type || 'image/jpeg' }), corners);
    } catch {
      setReadError('Não foi possível reprocessar a foto. Envie novamente.');
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
  const progressPct = totalQuestions > 0 ? Math.round((filledCount / totalQuestions) * 100) : 0;

  const FLAG_LABEL: Record<KeyFlag, string> = {
    blank: 'não lida na foto (em branco)',
    duplicate: 'dupla marcação na foto',
    low: 'leitura incerta',
  };

  const renderQuestionRow = (q: number, displayNumber: number) => {
    const flag = flags[q];
    return (
      <div
        key={q}
        className={`flex items-center gap-3 p-2 rounded-lg ${flag ? 'bg-warning-50 border border-warning-500/30 dark:bg-warning-500/10' : 'hover:bg-surface dark:hover:bg-gray-800'}`}
      >
        <span className="w-8 text-sm font-bold text-gray-600 dark:text-gray-300 text-right tabular-nums">
          {String(displayNumber).padStart(2, '0')}
        </span>
        <div className="flex gap-2" role="radiogroup" aria-label={`Questão ${displayNumber}`}>
          {OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={answerKey[q] === opt}
              aria-label={`Questão ${displayNumber}: ${opt}`}
              onClick={() => handleSetAnswer(q, opt)}
              className={`bubble-option w-10 h-10 min-w-[44px] min-h-[44px] ${
                answerKey[q] === opt ? 'selected' : ''
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
        {flag ? (
          <Badge tone="warning" className="ml-2">{FLAG_LABEL[flag]}</Badge>
        ) : answerKey[q] && (
          <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">
            Resposta: <strong className="text-ink dark:text-white">{answerKey[q]}</strong>
          </span>
        )}
      </div>
    );
  };

  const renderSubjectSection = (sid: 'lp' | 'mat', start: number, end: number) => (
    <div key={sid} className="mb-4">
      <h3 className="text-sm font-bold text-gray-600 dark:text-gray-300 mb-2 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-brand-500 inline-block" aria-hidden />
        {activeExam ? getSubjectName(activeExam, sid) : sid.toUpperCase()} (1–{end - start + 1})
      </h3>
      <div className="space-y-1">
        {Array.from({ length: end - start + 1 }, (_, i) => start + i).map((q, idx) => renderQuestionRow(q, idx + 1))}
      </div>
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Cadastrar gabarito"
        subtitle="Defina a resposta correta para cada questão"
      />

      <div className="card max-w-2xl">
        <div className="space-y-4">
          <Field label="Selecione a prova" htmlFor="key-exam-select">
            {exams.length === 0 ? (
              <EmptyState
                title="Nenhuma prova cadastrada"
                action={<Button size="sm" onClick={() => onNavigate('new-exam')}>Criar prova</Button>}
              />
            ) : (
              <Select
                id="key-exam-select"
                value={selectedExamId}
                onChange={(e) => setSelectedExamId(e.target.value)}
              >
                <option value="">Selecione...</option>
                {exams.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </Select>
            )}
          </Field>

          {activeExam && (
            <>
              <div className="bg-surface dark:bg-gray-800/60 rounded-lg p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <span className="text-sm text-gray-600 dark:text-gray-300">
                    Progresso: <strong className="text-ink dark:text-white tabular-nums">{filledCount}/{totalQuestions}</strong> questões
                  </span>
                  {isCustomExam(activeExam) && customNPages > 1 && (
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="text-sm text-gray-600 dark:text-gray-300">Página do gabarito:</span>
                      {Array.from({ length: customNPages }, (_, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setCustomPage(i)}
                          className={`btn btn-sm min-h-[36px] px-3 ${i === customPage ? 'btn-primary' : 'btn-secondary'}`}
                        >
                          {i + 1}{readPages.has(i) ? ' ✓' : ''}
                        </button>
                      ))}
                      {readPages.size > 0 && readPages.size < customNPages && (
                        <span className="text-xs text-brand-600 dark:text-brand-200">
                          {readPages.size} de {customNPages} página(s) lida(s).
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      loading={reading}
                      icon={<Camera size={15} aria-hidden />}
                    >
                      Ler por foto
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => handleAutoFill('ABCD')} icon={<Wand2 size={15} aria-hidden />}>
                      Preencher ABCD
                    </Button>
                  </div>
                </div>
                <div className="h-2 rounded-full bg-line dark:bg-gray-700 overflow-hidden" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso do gabarito">
                  <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleReadPhoto}
              />
              <p className="field-helper -mt-2">
                Imprima um cartão vazio em “Gerar cartões”, marque as respostas corretas com
                caneta escura e fotografe aqui — o gabarito é preenchido automaticamente.
              </p>

              {readSummary && (
                <div className="callout-info">{readSummary}</div>
              )}
              {readError && (
                <div className="callout-danger">{readError}</div>
              )}
              {readError && activeExam && isCustomExam(activeExam) && photoUrl && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setCornerEdit(true)}
                  icon={<Focus size={15} aria-hidden />}
                >
                  Ajustar cantos manualmente e tentar de novo
                </Button>
              )}

              {saved && (
                <div className="callout-success">
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <CheckCircle2 size={15} aria-hidden />
                    Gabarito salvo com sucesso!
                  </span>
                  {serverState === 'saving' && <span className="block text-xs mt-1">Enviando ao servidor...</span>}
                  {serverState === 'ok' && <span className="block text-xs mt-1">Salvo no servidor — disponível no celular.</span>}
                  {serverState === 'error' && (
                    <span className="block text-xs mt-1 text-danger-600 dark:text-danger-100">
                      <span className="inline-flex items-center gap-1"><XCircle size={13} aria-hidden /> Só neste aparelho! Falha ao salvar no servidor: {serverError} Verifique o backend e salve de novo.</span>
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

              <div className="flex gap-2 pt-2">
                <Button onClick={handleSave} disabled={filledCount < totalQuestions} icon={<Save size={16} aria-hidden />}>
                  Salvar gabarito
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {cornerEdit && photoUrl && createPortal(
        <CornerEditor
          src={photoUrl}
          onCancel={() => setCornerEdit(false)}
          onConfirm={handleReadWithCorners}
        />,
        document.body,
      )}
    </div>
  );
}
