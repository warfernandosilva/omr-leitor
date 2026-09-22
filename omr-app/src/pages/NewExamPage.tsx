import { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { AppView, Exam, DEFAULT_SAE_SPEC, SAE_MAX_QUESTIONS, SAEV_MIN_QPS, SAEV_MAX_QPS } from '../types';
import { saveExam, getExams, deleteExam, applyRemoteExams } from '../utils/storage';
import { MAX_QUESTIONS_PER_SUBJECT, MAX_QUESTIONS_SINGLE } from '../utils/card-template';
import { syncExam, getExamsFromDB, deleteExamFromDB, checkHealth } from '../utils/api';
import { useAuth } from '../context/AuthContext';

interface Props {
  onNavigate: (view: AppView, examId?: string) => void;
}

export default function NewExamPage({ onNavigate }: Props) {
  const { user } = useAuth();
  const [exams, setExams] = useState(() => getExams(user?.id));
  const [name, setName] = useState('');
  const [templateType, setTemplateType] = useState<'padrao' | 'sae' | 'colar' | 'saev'>('padrao');
  const [layoutMode, setLayoutMode] = useState<'dual' | 'single'>('dual');
  const [subjectLP, setSubjectLP] = useState('LÍNGUA PORTUGUESA');
  const [subjectMat, setSubjectMat] = useState('MATEMÁTICA');
  const [questionsPerSubject, setQuestionsPerSubject] = useState(22);
  const [gradeScale, setGradeScale] = useState<Exam['gradeScale']>('0-10');
  const [saved, setSaved] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const isSae = templateType === 'sae';
  const isColar = templateType === 'colar';
  const isSaev = templateType === 'saev';
  const isCustom = isSae || isColar;
  // SAEV é sempre dual 16+16 a 26+26 (como o padrão dual, não como SAE single)
  const maxQps = isSaev ? SAEV_MAX_QPS : !isCustom ? layoutMode === 'single' ? MAX_QUESTIONS_SINGLE : MAX_QUESTIONS_PER_SUBJECT : SAE_MAX_QUESTIONS;
  const minQps = isSaev ? SAEV_MIN_QPS : 1;
  const totalQuestions = isCustom || layoutMode === 'single' ? questionsPerSubject : questionsPerSubject * 2;

  const refreshFromServer = async (silent: boolean) => {
    if (syncing) return;
    if (!(await checkHealth())) {
      if (!silent) setSyncMsg('Backend inalcançável — confira se está rodando.');
      return;
    }
    setSyncing(true);
    try {
      const dbExams = await getExamsFromDB();
      const stats = applyRemoteExams(dbExams, user?.id);
      const local = getExams(user?.id);
      const dbIds = new Set(dbExams.map(d => d.external_id));
      for (const ex of local) {
        if (!dbIds.has(ex.id)) syncExam(ex).catch(() => {});
      }
      setExams(getExams(user?.id));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handleQpsChange = (raw: string) => {
    if (raw === '') { setQuestionsPerSubject(0); return; }
    const v = Math.max(minQps, Math.min(maxQps, Math.round(Number(raw))));
    setQuestionsPerSubject(v);
  };

  const handleTemplateChange = (t: 'padrao' | 'sae' | 'colar' | 'saev') => {
    setTemplateType(t);
    if (t === 'saev') {
      setLayoutMode('dual');
      setQuestionsPerSubject((q) => Math.max(SAEV_MIN_QPS, Math.min(SAEV_MAX_QPS, q || 22)));
    } else if (t !== 'padrao' && questionsPerSubject > SAE_MAX_QUESTIONS) {
      setQuestionsPerSubject(SAE_MAX_QUESTIONS);
    }
  };

  const handleModeChange = (mode: 'dual' | 'single') => {
    if (templateType === 'saev' && mode === 'single') return; // SAEV é sempre dual
    setLayoutMode(mode);
    if (questionsPerSubject > (mode === 'single' ? MAX_QUESTIONS_SINGLE : MAX_QUESTIONS_PER_SUBJECT)) {
      setQuestionsPerSubject(mode === 'single' ? MAX_QUESTIONS_SINGLE : MAX_QUESTIONS_PER_SUBJECT);
    }
  };

  const handleSave = async () => {
    if (!name.trim() || !subjectLP.trim()) return;
    if (layoutMode === 'dual' && !subjectMat.trim()) return;
    if (questionsPerSubject < 1) return;

    const exam: Exam = {
      id: editingId || uuidv4(),
      name: name.trim(),
      subjectLP: subjectLP.trim(),
      subjectMat: isCustom || layoutMode === 'single' ? subjectLP.trim() : subjectMat.trim(),
      questionsPerSubject,
      totalQuestions,
      createdAt: new Date().toISOString(),
      gradeScale,
      answerKey: null,
      layoutMode: isCustom ? 'single' : layoutMode,
      templateType,
      saeSpec: isSae ? { ...DEFAULT_SAE_SPEC } : undefined,
    };

    saveExam(exam, user?.id);
    syncExam(exam).catch(() => {});
    setExams(getExams(user?.id));
    setSaved(true);
    setTimeout(() => {
      onNavigate('generate-card', exam.id);
    }, 1000);
  };

  const handleDelete = (id: string) => {
    if (confirm('Tem certeza que deseja excluir esta prova e todos os resultados associados?')) {
      deleteExam(id, user?.id);
      deleteExamFromDB(id).catch(() => {});
      setExams(getExams(user?.id));
      setEditingId(null);
      setName('');
      setTemplateType('padrao');
      setSubjectLP('LÍNGUA PORTUGUESA');
      setSubjectMat('MATEMÁTICA');
    }
  };

  const handleEdit = (exam: Exam) => {
    setEditingId(exam.id);
    setName(exam.name);
    setTemplateType(exam.templateType === 'sae' || exam.templateType === 'colar' || exam.templateType === 'saev' ? exam.templateType : 'padrao');
    setLayoutMode(exam.layoutMode === 'single' ? 'single' : 'dual');
    setSubjectLP(exam.subjectLP);
    setSubjectMat(exam.subjectMat);
    setQuestionsPerSubject(exam.questionsPerSubject);
    setGradeScale(exam.gradeScale);
    window.scrollTo(0, 0);
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        {editingId ? 'Editar Prova' : 'Nova Prova'}
      </h1>

      <div className="card max-w-2xl mb-8">
        {saved && (
          <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 text-sm">
            Prova salva com sucesso! Redirecionando...
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="label">Nome da Prova *</label>
            <input
              type="text"
              className="input"
              placeholder="Ex: Prova de Matemática - Bimestre 1"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Modelo do Cartão *</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleTemplateChange('padrao')}
                className={`p-3 rounded-lg border text-sm font-medium transition-colors ${
                  templateType === 'padrao'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                Padrão
                <span className="block text-xs font-normal text-gray-400">ArUco nos cantos · 1 ou 2 disciplinas</span>
              </button>
              <button
                type="button"
                onClick={() => handleTemplateChange('saev')}
                className={`p-3 rounded-lg border text-sm font-medium transition-colors ${
                  templateType === 'saev'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                Gabarito SAEV
                <span className="block text-xs font-normal text-gray-400">LP + MAT · 16 a 26 por disciplina</span>
              </button>
              <button
                type="button"
                onClick={() => handleTemplateChange('sae')}
                className={`p-3 rounded-lg border text-sm font-medium transition-colors ${
                  templateType === 'sae'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                Avaliação Contínua
                <span className="block text-xs font-normal text-gray-400">cabeçalho editável · até {SAE_MAX_QUESTIONS} questões</span>
              </button>
              <button
                type="button"
                onClick={() => handleTemplateChange('colar')}
                className={`p-3 rounded-lg border text-sm font-medium transition-colors ${
                  templateType === 'colar'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                Colar em Avaliação
                <span className="block text-xs font-normal text-gray-400">só o gabarito · até {SAE_MAX_QUESTIONS} questões</span>
              </button>
            </div>
          </div>

          {(!isCustom && templateType !== 'saev') && (
          <div>
            <label className="label">Disciplinas *</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleModeChange('single')}
                className={`p-3 rounded-lg border text-sm font-medium transition-colors ${
                  layoutMode === 'single'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                1 disciplina
                <span className="block text-xs font-normal text-gray-400">coluna única (até {MAX_QUESTIONS_SINGLE} questões)</span>
              </button>
              <button
                type="button"
                onClick={() => handleModeChange('dual')}
                className={`p-3 rounded-lg border text-sm font-medium transition-colors ${
                  layoutMode === 'dual'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                2 disciplinas
                <span className="block text-xs font-normal text-gray-400">duas colunas (até {MAX_QUESTIONS_PER_SUBJECT} por disciplina)</span>
              </button>
            </div>
          </div>
          )}

          <div>
            <label className="label">{isCustom || layoutMode === 'single' ? 'Disciplina *' : 'Disciplina 1 (Língua Portuguesa) *'}</label>
            <input
              type="text"
              className="input"
              placeholder={isColar ? 'Ex: MATEMÁTICA' : isSae ? 'Ex: MATEMÁTICA' : layoutMode === 'single' ? 'Ex: CIÊNCIAS' : 'Ex: LÍNGUA PORTUGUESA'}
              value={subjectLP}
              onChange={(e) => setSubjectLP(e.target.value)}
            />
          </div>

          {!isCustom && layoutMode === 'dual' && (
            <div>
              <label className="label">Disciplina 2 (Matemática) *</label>
              <input
                type="text"
                className="input"
                placeholder="Ex: MATEMÁTICA"
                value={subjectMat}
                onChange={(e) => setSubjectMat(e.target.value)}
              />
            </div>
          )}

          <div>
            <label className="label">Questões{!isCustom && layoutMode === 'dual' ? ' por Disciplina' : ''} *</label>
            <input
              type="number"
              className="input"
              min={minQps}
              max={maxQps}
              value={questionsPerSubject || ''}
              onChange={(e) => handleQpsChange(e.target.value)}
            />
            <p className="text-xs text-gray-400 mt-1">
              {minQps} a {maxQps} questões — total de {questionsPerSubject > 0 ? totalQuestions : '—'} questões.
              {!isCustom && layoutMode === 'dual' && templateType !== 'saev' && ' O padrão do layout é 22 por disciplina.'}
              {templateType === 'saev' && ' Gabarito SAEV: LP + MAT com QR do sistema e nome impresso.'}
              {isSae && ' O cabeçalho do cartão (caderno, série, QR etc.) é editado na tela de geração.'}
              {isColar && ' Somente o gabarito, sem cabeçalho — para colar na avaliação. Correção com identificação manual.'}
            </p>
          </div>

          <div>
            <label className="label">Escala de Nota</label>
            <select
              className="input"
              value={gradeScale}
              onChange={(e) => setGradeScale(e.target.value as Exam['gradeScale'])}
            >
              <option value="0-10">0 a 10</option>
              <option value="0-100">0 a 100</option>
              <option value="count">Apenas quantidade de acertos</option>
            </select>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={
                !name.trim() || !subjectLP.trim()
                || (layoutMode === 'dual' && !subjectMat.trim())
                || questionsPerSubject < 1
              }
              className="btn btn-primary"
            >
              {editingId ? 'Salvar Alterações' : 'Criar Prova'}
            </button>
            {editingId && (
              <button
                onClick={() => { setEditingId(null); setName(''); setTemplateType('padrao'); setSubjectLP('LÍNGUA PORTUGUESA'); setSubjectMat('MATEMÁTICA'); }}
                className="btn btn-secondary"
              >
                Cancelar
              </button>
            )}
          </div>
        </div>
      </div>

      {exams.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3 max-w-2xl">
            <h2 className="text-lg font-semibold text-gray-900">Provas Cadastradas</h2>
            <button
              type="button"
              onClick={() => refreshFromServer(false)}
              disabled={syncing}
              className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-400"
            >
              {syncing ? 'Atualizando...' : '⟳ Atualizar do servidor'}
            </button>
          </div>
          {syncMsg && <p className="text-xs text-gray-500 mb-2">{syncMsg}</p>}
          <div className="space-y-2 max-w-2xl">
            {exams.map((exam) => (
              <div key={exam.id} className="card flex items-center justify-between p-4">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">{exam.name}</p>
                  <p className="text-sm text-gray-500">
                    {exam.templateType && exam.templateType !== 'padrao' && (
                      <span className="inline-block mr-1 px-1.5 py-0.5 text-xs font-medium rounded bg-violet-100 text-violet-700">{exam.templateType === 'sae' ? 'Avaliação Contínua' : exam.templateType === 'saev' ? 'Gabarito SAEV' : 'Colar em Avaliação'}</span>
                    )}
                    {exam.layoutMode === 'single'
                      ? exam.subjectLP
                      : `${exam.subjectLP} + ${exam.subjectMat}`}
                    {' '}— {exam.totalQuestions} questões — Escala: {exam.gradeScale}
                  </p>
                  <p className="text-xs text-gray-400">
                    Criada em {new Date(exam.createdAt).toLocaleString('pt-BR')}
                    {exam.answerKey && ' — Gabarito definido'}
                  </p>
                </div>
                <div className="flex gap-1 ml-4 flex-shrink-0">
                  <button onClick={() => handleEdit(exam)} className="btn btn-sm btn-secondary">Editar</button>
                  <button onClick={() => onNavigate('generate-card', exam.id)} className="btn btn-sm btn-primary">Cartão</button>
                  <button onClick={() => handleDelete(exam.id)} className="btn btn-sm btn-danger">Excluir</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
