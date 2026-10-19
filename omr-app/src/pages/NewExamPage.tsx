import { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Pencil, Plus, Printer, RefreshCw, Trash2 } from 'lucide-react';
import { AppView, Exam, ExamStatus, DEFAULT_SAE_SPEC, DEFAULT_HERBY_SPEC, SAE_MAX_QUESTIONS, SAEV_MIN_QPS, SAEV_MAX_QPS, templateLabel, normalizeExamStatus, examStatusLabel } from '../types';
import { HERBY_MIN_QPS, HERBY_MAX_QPS } from '../utils/herby-template';
import { SIMULADO_MAX_QUESTIONS } from '../utils/simulado-template';
import {
  saveExam, getExams, deleteExam, applyRemoteExams,
  getDeletedExamIds, markExamDeleted, unmarkExamDeleted, isExamDeleted,
} from '../utils/storage';
import { MAX_QUESTIONS_PER_SUBJECT, MAX_QUESTIONS_SINGLE } from '../utils/card-template';
import { syncExam, getExamsFromDB, getDeletedExamsFromDB, isGoneError, deleteExamFromDB, checkHealth, listTurmas } from '../utils/api';
import type { TurmaDTO } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { listCustomTemplates, type CustomTemplateSummary } from '../utils/custom-template-api';
import PageHeader from '../components/ui/PageHeader';
import Field from '../components/ui/Field';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';

interface Props {
  onNavigate: (view: AppView, examId?: string) => void;
}

/** Modelo escolhido no formulário (inclui o pseudo-modelo "custom" para o Gabarito Personalizado). */
type ModelChoice = NonNullable<Exam['templateType']> | 'custom';

export default function NewExamPage({ onNavigate }: Props) {
  const { user } = useAuth();
  const [exams, setExams] = useState(() => getExams(user?.id));
  const [name, setName] = useState('');
  const [templateType, setTemplateType] = useState<ModelChoice>('padrao');
  const [customTemplateId, setCustomTemplateId] = useState<number | ''>('');
  const [layoutMode, setLayoutMode] = useState<'dual' | 'single'>('dual');
  const [subjectLP, setSubjectLP] = useState('LÍNGUA PORTUGUESA');
  const [subjectMat, setSubjectMat] = useState('MATEMÁTICA');
  const [questionsPerSubject, setQuestionsPerSubject] = useState(22);
  const [gradeScale, setGradeScale] = useState<Exam['gradeScale']>('0-10');
  const [saved, setSaved] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [turmas, setTurmas] = useState<TurmaDTO[]>([]);
  const [turmaId, setTurmaId] = useState<number | ''>('');
  const [status, setStatus] = useState<ExamStatus>('ativa');
  const [step, setStep] = useState(0);
  const [examSearch, setExamSearch] = useState('');
  const [examStatusFilter, setExamStatusFilter] = useState<'' | ExamStatus>('');
  const [customTemplates, setCustomTemplates] = useState<CustomTemplateSummary[]>([]);

  const STEPS = ['Dados', 'Modelo', 'Configurações', 'Revisão'] as const;

  const isSae = templateType === 'sae';
  const isColar = templateType === 'colar';
  const isSaev = templateType === 'saev';
  const isHerby = templateType === 'herby';
  const isSimulado = templateType === 'simulado';
  const isCustom = isSae || isColar || templateType === 'custom';
const isCustomTemplate = templateType === 'custom';
const readyCustomTemplates = customTemplates.filter((t) => t.status === 'ativo' || t.status === 'validado');
  // SAEV é sempre dual 16+16 a 26+26 (como o padrão dual, não como SAE single)
  // Herby: dual 1+1 a 26+26 ou single 1..26 (metade esquerda do cartão)
  // Simulado: tabela única, sempre single e sempre 22 questões
  const maxQps = isSimulado ? SIMULADO_MAX_QUESTIONS
    : isSaev ? SAEV_MAX_QPS : isHerby ? HERBY_MAX_QPS : !isCustom ? layoutMode === 'single' ? MAX_QUESTIONS_SINGLE : MAX_QUESTIONS_PER_SUBJECT : SAE_MAX_QUESTIONS;
  const minQps = isSimulado ? SIMULADO_MAX_QUESTIONS : isSaev ? SAEV_MIN_QPS : isHerby ? HERBY_MIN_QPS : 1;
  const totalQuestions = isCustom || layoutMode === 'single' ? questionsPerSubject : questionsPerSubject * 2;

  const refreshFromServer = async (silent: boolean) => {
    if (syncing) return;
    if (!(await checkHealth())) {
      if (!silent) setSyncMsg('Backend inalcançável — confira se está rodando.');
      return;
    }
    setSyncing(true);
    try {
      const uid = user?.id;
      // 0. Empurra lápides locais (exclusões feitas offline/antes): DELETE idempotente.
      for (const goneId of getDeletedExamIds(uid)) {
        try {
          await deleteExamFromDB(goneId);
          unmarkExamDeleted(goneId, uid);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/404/.test(msg)) unmarkExamDeleted(goneId, uid); // já sumiu do servidor
          // outro erro: mantém a lápide local para a próxima tentativa
        }
      }
      // 1. Puxa lápides do servidor → apaga cópias locais SEM re-empurrar (fim da ressurreição).
      try {
        const gone = await getDeletedExamsFromDB();
        for (const t of gone) {
          markExamDeleted(t.external_id, uid);
          deleteExam(t.external_id, uid); // só-local: prova morta em todos os aparelhos
        }
      } catch {
        // segue sem as lápides desta vez
      }
      // 2. Merge servidor → local (fonte oficial).
      const dbExams = await getExamsFromDB();
      const stats = applyRemoteExams(dbExams, uid);
      // 3. Empurra locais novos — nunca lapidados; 410 (lapidada lá) → apaga local.
      const local = getExams(uid);
      const dbIds = new Set(dbExams.map(d => d.external_id));
      for (const ex of local) {
        if (dbIds.has(ex.id) || isExamDeleted(ex.id, uid)) continue;
        try {
          await syncExam(ex);
        } catch (err) {
          if (isGoneError(err)) {
            markExamDeleted(ex.id, uid);
            deleteExam(ex.id, uid);
          }
          // demais erros: tenta de novo no próximo refresh
        }
      }
      setExams(getExams(uid));
      const total = stats.added + stats.updated;
      setSyncMsg(total > 0
        ? `Provas atualizadas do servidor (+${stats.added} novas, ${stats.updated} atualizadas).`
        : (silent ? null : 'Provas já atualizadas.'));
    } catch {
      if (!silent) setSyncMsg('Falha ao buscar provas do servidor.');
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    refreshFromServer(true).catch(() => {});
    listTurmas().then(setTurmas).catch(() => setTurmas([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  // ─── Carregar modelos custom do backend ───
  useEffect(() => {
    listCustomTemplates().then((res) => setCustomTemplates(res.templates)).catch(() => setCustomTemplates([]));
  }, []);
  // ─── Sincroniza questões/disciplina quando o template custom muda ───
  useEffect(() => {
    if (templateType !== 'custom' || customTemplateId === '') return;
    const tpl = customTemplates.find((c) => c.id === customTemplateId);
    if (!tpl) return;
    const nq = tpl.config_summary?.n_questions;
    if (nq && nq > 0) setQuestionsPerSubject(nq);
    if (tpl.nome) {
      setSubjectLP(tpl.nome);
      setSubjectMat(tpl.nome);
    }
  }, [customTemplateId, templateType, customTemplates]);

  const handleQpsChange = (raw: string) => {
    if (raw === '') { setQuestionsPerSubject(0); return; }
    const v = Math.max(minQps, Math.min(maxQps, Math.round(Number(raw))));
    setQuestionsPerSubject(v);
  };

  const handleTemplateChange = (t: ModelChoice) => {
    setTemplateType(t);
    if (t === 'saev') {
      setLayoutMode('dual');
      setQuestionsPerSubject((q) => Math.max(SAEV_MIN_QPS, Math.min(SAEV_MAX_QPS, q || 22)));
    } else if (t === 'herby') {
      setQuestionsPerSubject((q) => Math.max(HERBY_MIN_QPS, Math.min(HERBY_MAX_QPS, q || 22)));
    } else if (t === 'simulado') {
      setLayoutMode('single');
      setQuestionsPerSubject(SIMULADO_MAX_QUESTIONS);
    } else if (t === 'custom') {
      setLayoutMode('single');
      const tpl = customTemplates.find((c) => c.id === customTemplateId);
      const nq = tpl?.config_summary?.n_questions;
      if (nq && nq > 0) setQuestionsPerSubject(nq);
      else setQuestionsPerSubject(0);
      setSubjectLP((prev) => (tpl?.nome ? tpl.nome : prev || 'GABARITO PERSONALIZADO'));
      setSubjectMat((prev) => (tpl?.nome ? tpl.nome : prev || 'GABARITO PERSONALIZADO'));
    } else if (t !== 'padrao' && questionsPerSubject > SAE_MAX_QUESTIONS) {
      setQuestionsPerSubject(SAE_MAX_QUESTIONS);
    }
  };

  const handleModeChange = (mode: 'dual' | 'single') => {
    if (templateType === 'saev' && mode === 'single') return; // SAEV sempre dual
    if (templateType === 'simulado') return; // Simulado é tabela única, só single
    setLayoutMode(mode);
    if (templateType === 'herby') {
      // Herby vale 1..26 nos dois layouts (single usa a metade esquerda)
      setQuestionsPerSubject((q) => Math.max(HERBY_MIN_QPS, Math.min(HERBY_MAX_QPS, q || 22)));
      return;
    }
    if (questionsPerSubject > (mode === 'single' ? MAX_QUESTIONS_SINGLE : MAX_QUESTIONS_PER_SUBJECT)) {
      setQuestionsPerSubject(mode === 'single' ? MAX_QUESTIONS_SINGLE : MAX_QUESTIONS_PER_SUBJECT);
    }
  };

  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    if (saving) return;
    if (!name.trim()) return;
    if (!isCustomTemplate && !subjectLP.trim()) return;
    if (!isCustomTemplate && layoutMode === 'dual' && !subjectMat.trim()) return;
    if (!isCustomTemplate && questionsPerSubject < 1) return;
    if (templateType === 'custom' && customTemplateId === '') {
      alert('Selecione um Gabarito Personalizado ativo para esta prova.');
      return;
    }
    setSaving(true);

    const turmaSel = turmaId === '' ? undefined : turmas.find(t => t.id === turmaId);
    const exam: Exam = {
      id: editingId || uuidv4(),
      name: name.trim(),
      status,
      turma: turmaSel?.nome,
      turmaId: turmaSel?.id,
      subjectLP: subjectLP.trim(),
      subjectMat: isCustom || layoutMode === 'single' ? subjectLP.trim() : subjectMat.trim(),
      questionsPerSubject,
      totalQuestions,
      createdAt: new Date().toISOString(),
      gradeScale,
      answerKey: null,
      layoutMode: isCustom ? 'single' : layoutMode,
      templateType: templateType === 'custom' ? 'padrao' : templateType,
      customTemplateId: templateType === 'custom' && customTemplateId !== '' ? customTemplateId : undefined,
      saeSpec: isSae ? { ...DEFAULT_SAE_SPEC } : undefined,
      herbySpec: isHerby ? { ...DEFAULT_HERBY_SPEC } : undefined,
    };

    try {
      saveExam(exam, user?.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao salvar neste aparelho.');
      setSaving(false);
      return;
    }
    syncExam(exam).catch(() => {});
    setExams(getExams(user?.id));
    setSaved(true);
    setTimeout(() => {
      onNavigate('generate-card', exam.id);
    }, 1000);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir esta prova e todos os resultados associados?')) return;
    // Servidor primeiro: se falhar, não apaga o local (evita a prova "ressuscitar" no próximo sync).
    try {
      await deleteExamFromDB(id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/404/.test(msg)) {
        alert(`Não foi possível excluir a prova no servidor: ${msg}. Nada foi apagado.`);
        return;
      }
      // 404 = prova só-local: segue apagando localmente.
    }
    markExamDeleted(id, user?.id); // lápide: os outros aparelhos removem a cópia sem recriar
    try {
      deleteExam(id, user?.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao excluir neste aparelho.');
      return;
    }
    setExams(getExams(user?.id));
    setEditingId(null);
    setName('');
    setTurmaId('');
    setStatus('ativa');
    setStep(0);
    setTemplateType('padrao');
    setSubjectLP('LÍNGUA PORTUGUESA');
    setSubjectMat('MATEMÁTICA');
  };

  const handleEdit = (exam: Exam) => {
    setEditingId(exam.id);
    setName(exam.name);
    setStatus(normalizeExamStatus(exam.status));
    setStep(0);
    if (exam.customTemplateId != null) {
      setTemplateType('custom');
      setCustomTemplateId(exam.customTemplateId);
    } else {
      setTemplateType(exam.templateType === 'sae' || exam.templateType === 'colar' || exam.templateType === 'saev' || exam.templateType === 'herby' || exam.templateType === 'simulado' ? exam.templateType : 'padrao');
      setCustomTemplateId('');
    }
    setLayoutMode(exam.layoutMode === 'single' ? 'single' : 'dual');
    setSubjectLP(exam.subjectLP);
    setSubjectMat(exam.subjectMat);
    setQuestionsPerSubject(exam.questionsPerSubject);
    setGradeScale(exam.gradeScale);
    setTurmaId(exam.turmaId ?? '');
    window.scrollTo(0, 0);
  };

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setTurmaId('');
    setStatus('ativa');
    setStep(0);
    setTemplateType('padrao');
    setCustomTemplateId('');
    setSubjectLP('LÍNGUA PORTUGUESA');
    setSubjectMat('MATEMÁTICA');
  };

  const templates: { id: ModelChoice; title: string; hint: string }[] = [
    { id: 'padrao', title: 'Padrão', hint: 'ArUco nos cantos · 1 ou 2 disciplinas' },
    { id: 'saev', title: 'Gabarito SAEV', hint: 'LP + MAT · 16 a 26 por disciplina' },
    { id: 'sae', title: 'Avaliação Contínua', hint: `Cabeçalho editável · até ${SAE_MAX_QUESTIONS} questões` },
    { id: 'colar', title: 'Colar em Avaliação', hint: `Só o gabarito · até ${SAE_MAX_QUESTIONS} questões` },
    { id: 'herby', title: 'Gabarito Herby', hint: '1 ou 2 disciplinas · QR duplo · 1 a 26 por disciplina' },
    { id: 'simulado', title: 'Simulado', hint: 'Só a tabela · réguas como âncora · 22 questões · sem QR' },
    { id: 'custom', title: 'Gabarito Personalizado', hint: 'Modelo importado (âncoras + bolhas)' },
  ];

  const optionCard = (selected: boolean) =>
    `p-3 rounded-lg border text-sm font-medium text-left transition-colors min-h-[44px] ${
      selected
        ? 'border-brand-500 bg-brand-50 text-ink dark:bg-brand-700/15 dark:text-white dark:border-brand-400'
        : 'border-line text-gray-600 hover:bg-surface dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
    }`;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={editingId ? 'Editar prova' : 'Nova prova'}
        subtitle="Configure o modelo do cartão, as disciplinas e a escala de nota"
      />

      <div className="card max-w-2xl">
        {saved && (
          <div className="callout-success mb-4">
            Prova salva com sucesso! Redirecionando...
          </div>
        )}

        {/* Assistente em etapas */}
        <ol className="flex items-center gap-1 mb-5" aria-label="Etapas da criação">
          {STEPS.map((label, i) => {
            const done = i < step;
            const current = i === step;
            return (
              <li key={label} className="flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => { if (i < step) setStep(i); }}
                  disabled={i > step}
                  aria-current={current ? 'step' : undefined}
                  className="w-full flex flex-col items-center gap-1.5 group"
                >
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors
                    ${done ? 'bg-success-500 text-white' : current ? 'bg-brand-500 text-white' : 'bg-surface text-gray-400 dark:bg-gray-800'}`}>
                    {done ? '✓' : i + 1}
                  </span>
                  <span className={`text-[11px] font-medium truncate max-w-full ${current ? 'text-brand-700 dark:text-brand-200' : 'text-gray-400'}`}>
                    {label}
                  </span>
                  <span aria-hidden className={`h-1 w-full rounded-full ${done || current ? 'bg-brand-500' : 'bg-line dark:bg-gray-800'}`} />
                </button>
              </li>
            );
          })}
        </ol>

        <div className="space-y-4">
        {step === 0 && (
          <>
          <Field label="Nome da prova" htmlFor="exam-name" required>
            <Input
              id="exam-name"
              type="text"
              placeholder="Ex: Prova de Matemática - Bimestre 1"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          {!isSimulado && (
            <Field
              label="Turma (opcional)"
              htmlFor="exam-turma"
              helper={<>A turma imprime o nome no cartão e permite gerar os gabaritos sem reenviar a lista. Gerencie as turmas em <button type="button" className="text-brand-600 hover:text-brand-700 dark:text-brand-200 underline" onClick={() => onNavigate('turmas')}>Turmas</button>.</>}
            >
              <Select
                id="exam-turma"
                value={turmaId}
                onChange={(e) => setTurmaId(e.target.value === '' ? '' : Number(e.target.value))}
              >
                <option value="">Sem turma vinculada</option>
                {turmas.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome} ({t.total_alunos} aluno{t.total_alunos === 1 ? '' : 's'})
                  </option>
                ))}
              </Select>
            </Field>
          )}
          </>
        )}

        {step === 1 && (
          <>
          <div>
            <span className="label">Modelo do cartão *</span>
            <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Modelo do cartão">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={templateType === t.id}
                  onClick={() => handleTemplateChange(t.id)}
                  className={optionCard(templateType === t.id)}
                >
                  {t.title}
                  <span className="block text-xs font-normal text-gray-400 dark:text-gray-500">{t.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {templateType === 'custom' && (
            readyCustomTemplates.length === 0 ? (
              <div className="callout-warning text-sm">
                Nenhum Gabarito Personalizado ativo. Crie e ative um modelo em{' '}
                <button
                  type="button"
                  className="text-brand-600 hover:text-brand-700 dark:text-brand-200 underline"
                  onClick={() => onNavigate('custom-template')}
                >
                  Gabarito personalizado
                </button>{' '}
                antes de vincular a esta prova.
              </div>
            ) : (
              <>
                <Field label="Gabarito Personalizado *" htmlFor="exam-custom-template">
                  <Select
                    id="exam-custom-template"
                    value={customTemplateId}
                    onChange={(e) => setCustomTemplateId(e.target.value === '' ? '' : Number(e.target.value))}
                  >
                    <option value="">Selecione o modelo importado...</option>
                    {readyCustomTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nome} ({t.config_summary.n_questions} quest{t.config_summary.n_questions === 1 ? 'ão' : 'ões'})
                      </option>
                    ))}
                  </Select>
                </Field>
                {customTemplateId !== '' && (() => {
                  const tpl = customTemplates.find((t) => t.id === customTemplateId);
                  if (!tpl) return null;
                  return (
                    <div className="rounded border border-gray-200 dark:border-gray-700 p-3 text-sm space-y-1">
                      <p><strong>Modelo:</strong> {tpl.nome}</p>
                      <p><strong>Questões:</strong> {tpl.config_summary.n_questions} (definidas no gabarito personalizado)</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Disciplina e número de questões são configurados no próprio gabarito personalizado; esta prova apenas o vincula.
                      </p>
                    </div>
                  );
                })()}
              </>
            )
          )}

          {(!isCustom && templateType !== 'saev' && !isSimulado) && (
            <div>
              <span className="label">Disciplinas *</span>
              <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Disciplinas">
                <button
                  type="button"
                  role="radio"
                  aria-checked={layoutMode === 'single'}
                  onClick={() => handleModeChange('single')}
                  className={optionCard(layoutMode === 'single')}
                >
                  1 disciplina
                  <span className="block text-xs font-normal text-gray-400 dark:text-gray-500">coluna única (até {MAX_QUESTIONS_SINGLE} questões)</span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={layoutMode === 'dual'}
                  onClick={() => handleModeChange('dual')}
                  className={optionCard(layoutMode === 'dual')}
                >
                  2 disciplinas
                  <span className="block text-xs font-normal text-gray-400 dark:text-gray-500">duas colunas (até {MAX_QUESTIONS_PER_SUBJECT} por disciplina)</span>
                </button>
              </div>
            </div>
          )}

{!isCustomTemplate && (
          <Field
            label={isCustom || layoutMode === 'single' ? 'Disciplina' : 'Disciplina 1 (Língua Portuguesa)'}
            htmlFor="exam-subject-lp"
            required
          >
            <Input
              id="exam-subject-lp"
              type="text"
              placeholder={isColar ? 'Ex: MATEMÁTICA' : isSae ? 'Ex: MATEMÁTICA' : layoutMode === 'single' ? 'Ex: CIÊNCIAS' : 'Ex: LÍNGUA PORTUGUESA'}
              value={subjectLP}
              onChange={(e) => setSubjectLP(e.target.value)}
            />
          </Field>
          )}

          {!isCustomTemplate && !isCustom && layoutMode === 'dual' && (
            <Field label="Disciplina 2 (Matemática)" htmlFor="exam-subject-mat" required>
              <Input
                id="exam-subject-mat"
                type="text"
                placeholder="Ex: MATEMÁTICA"
                value={subjectMat}
                onChange={(e) => setSubjectMat(e.target.value)}
              />
            </Field>
          )}

          {!isCustomTemplate && (
          <Field
            label={`Questões${!isCustom && layoutMode === 'dual' ? ' por disciplina' : ''}`}
            htmlFor="exam-qps"
            required
            helper={
              isSimulado
                ? `${SIMULADO_MAX_QUESTIONS} questões fixas — o cartão Simulado tem tabela única com 22 linhas. Sem QR, sem nome, sem turma: só a tabela das réguas.`
                : <>{minQps} a {maxQps} questões — total de {questionsPerSubject > 0 ? totalQuestions : '—'} questões.
                  {!isCustom && layoutMode === 'dual' && templateType !== 'saev' && templateType !== 'herby' && ' O padrão do layout é 22 por disciplina.'}
                  {templateType === 'saev' && ' Gabarito SAEV: LP + MAT com QR do sistema e nome impresso.'}
                  {templateType === 'herby' && (layoutMode === 'single'
                    ? ' Gabarito Herby 1 disciplina: grade na metade esquerda · QR duplo (cabeçalho + rodapé) · 1 a 26 questões · sem ArUco.'
                    : ' Gabarito Herby: LP + MAT · QR duplo (cabeçalho + rodapé) · 1 a 26 por disciplina · sem ArUco.')}
                  {isSae && ' O cabeçalho do cartão (caderno, série, QR etc.) é editado na tela de geração.'}
                  {isColar && ' Somente o gabarito, sem cabeçalho — para colar na avaliação. Correção com identificação manual.'}</>
            }
          >
            <Input
              id="exam-qps"
              type="number"
              min={minQps}
              max={maxQps}
              disabled={isSimulado}
              value={questionsPerSubject || ''}
              onChange={(e) => handleQpsChange(e.target.value)}
            />
          </Field>
          )}
          </>
        )}

        {step === 2 && (
          <>
          <Field label="Escala de nota" htmlFor="exam-scale">
            <Select
              id="exam-scale"
              value={gradeScale}
              onChange={(e) => setGradeScale(e.target.value as Exam['gradeScale'])}
            >
              <option value="0-10">0 a 10</option>
              <option value="0-100">0 a 100</option>
              <option value="count">Apenas quantidade de acertos</option>
            </Select>
          </Field>

          <div>
            <span className="label">Situação da prova</span>
            <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Situação da prova">
              {(['rascunho', 'ativa', 'arquivada'] as ExamStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={status === s}
                  onClick={() => setStatus(s)}
                  className={optionCard(status === s)}
                >
                  {examStatusLabel(s)}
                </button>
              ))}
            </div>
            <p className="field-helper">Rascunhos e arquivadas continuam salvos; o filtro da lista separa cada situação.</p>
          </div>
          </>
        )}

        {step === 3 && (
          <dl className="rounded-lg border border-line dark:border-gray-700 divide-y divide-line dark:divide-gray-800 text-sm">
            {[
              ['Nome', name.trim() || '—'],
              ['Turma', turmaId === '' ? 'Sem turma vinculada' : (turmas.find(t => t.id === turmaId)?.nome ?? '—')],
              ['Modelo', isCustomTemplate ? (customTemplates.find(t => t.id === customTemplateId)?.nome ?? 'Gabarito Personalizado') : templateLabel(templateType)],
              ['Disciplinas', isCustomTemplate ? 'Definidas no gabarito personalizado' : (layoutMode === 'single' || isCustom ? subjectLP.trim() || '—' : `${subjectLP.trim() || '—'} + ${subjectMat.trim() || '—'}`)],
              ['Questões', isCustomTemplate ? String(customTemplates.find(t => t.id === customTemplateId)?.config_summary.n_questions ?? '—') : String(questionsPerSubject > 0 ? totalQuestions : '—')],
              ['Escala', gradeScale === 'count' ? 'Quantidade de acertos' : `0 a ${gradeScale === '0-10' ? '10' : '100'}`],
              ['Situação', examStatusLabel(status)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 px-3 py-2.5">
                <dt className="text-gray-500 dark:text-gray-400">{k}</dt>
                <dd className="font-medium text-ink dark:text-gray-100 text-right">{v}</dd>
              </div>
            ))}
          </dl>
        )}

          <div className="flex gap-2 pt-2">
            {step > 0 && (
              <Button variant="secondary" onClick={() => setStep(step - 1)} className="min-h-[44px]">
                Voltar
              </Button>
            )}
            {step < 3 ? (
              <Button
                onClick={() => setStep(step + 1)}
                disabled={
                  (step === 0 && !name.trim())
                  || (step === 1 && !isCustomTemplate && (!subjectLP.trim() || (layoutMode === 'dual' && !isCustom && !subjectMat.trim()) || questionsPerSubject < 1))
                }
                className="min-h-[44px] flex-1"
              >
                Próximo
              </Button>
            ) : (
              <Button
                onClick={handleSave}
                loading={saving}
                disabled={
                  !name.trim() || !subjectLP.trim()
                  || (layoutMode === 'dual' && !isCustom && !subjectMat.trim())
                  || questionsPerSubject < 1
                }
                icon={<Plus size={16} aria-hidden />}
                className="min-h-[44px] flex-1"
              >
                {editingId ? 'Salvar alterações' : 'Criar prova'}
              </Button>
            )}
            {editingId && (
              <Button variant="secondary" onClick={resetForm} className="min-h-[44px]">
                Cancelar
              </Button>
            )}
          </div>
        </div>
      </div>

      {exams.length > 0 && (
        <section aria-label="Provas cadastradas" className="max-w-2xl">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-ink dark:text-white">Provas cadastradas</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refreshFromServer(false)}
              loading={syncing}
              icon={<RefreshCw size={14} aria-hidden />}
            >
              Atualizar do servidor
            </Button>
          </div>
          {syncMsg && <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{syncMsg}</p>}
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <Input
              type="search"
              aria-label="Buscar prova"
              placeholder="Buscar prova..."
              value={examSearch}
              onChange={(e) => setExamSearch(e.target.value)}
              className="flex-1"
            />
            <Select
              aria-label="Filtrar por situação"
              value={examStatusFilter}
              onChange={(e) => setExamStatusFilter(e.target.value as '' | ExamStatus)}
              className="sm:w-44"
            >
              <option value="">Todas</option>
              <option value="ativa">Ativas</option>
              <option value="rascunho">Rascunhos</option>
              <option value="arquivada">Arquivadas</option>
            </Select>
          </div>
          <div className="space-y-2">
            {exams
              .filter((exam) => {
                if (examStatusFilter && normalizeExamStatus(exam.status) !== examStatusFilter) return false;
                if (examSearch.trim() && !exam.name.toLowerCase().includes(examSearch.trim().toLowerCase())) return false;
                return true;
              })
              .map((exam) => {
              const st = normalizeExamStatus(exam.status);
              return (
              <div key={exam.id} className="card p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-ink dark:text-gray-100 truncate">{exam.name}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      <span className="inline-flex flex-wrap gap-1 mr-1 align-middle">
                        <Badge tone={st === 'ativa' ? 'success' : st === 'rascunho' ? 'info' : 'neutral'}>{examStatusLabel(st)}</Badge>
                        {exam.turma && <Badge tone="success">{exam.turma}</Badge>}
                        {exam.customTemplateId != null ? (
                          <Badge tone="info">Gabarito Personalizado</Badge>
                        ) : (exam.templateType && exam.templateType !== 'padrao' && (
                          <Badge tone="info">{templateLabel(exam.templateType)}</Badge>
                        ))}
                      </span>
                      {exam.layoutMode === 'single'
                        ? exam.subjectLP
                        : `${exam.subjectLP} + ${exam.subjectMat}`}
                      {' '}— {exam.totalQuestions} questões — Escala: {exam.gradeScale}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      Criada em {new Date(exam.createdAt).toLocaleString('pt-BR')}
                      {exam.answerKey && ' — Gabarito definido'}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1 mt-2">
                  <Select
                    aria-label={`Situação de ${exam.name}`}
                    value={st}
                    onChange={(e) => {
                      saveExam({ ...exam, status: e.target.value as ExamStatus }, user?.id);
                      setExams(getExams(user?.id));
                    }}
                    className="!w-auto !min-h-[44px] !py-1.5 text-xs"
                  >
                    <option value="rascunho">Rascunho</option>
                    <option value="ativa">Ativa</option>
                    <option value="arquivada">Arquivada</option>
                  </Select>
                  <span className="flex-1" />
                  <Button variant="secondary" size="sm" onClick={() => handleEdit(exam)} icon={<Pencil size={14} aria-hidden />}>
                    Editar
                  </Button>
                  <Button size="sm" onClick={() => onNavigate('generate-card', exam.id)} icon={<Printer size={14} aria-hidden />}>
                    Cartão
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => handleDelete(exam.id)} icon={<Trash2 size={14} aria-hidden />}>
                    Excluir
                  </Button>
                </div>
              </div>
              );
            })}
          </div>
        </section>
      )}
      {exams.length === 0 && (
        <div className="max-w-2xl">
          <EmptyState
            title="Nenhuma prova cadastrada"
            description="Preencha o formulário acima para criar a primeira."
          />
        </div>
      )}
    </div>
  );
}
