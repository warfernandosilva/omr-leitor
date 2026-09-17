import { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { AppView, Exam, DEFAULT_SAE_SPEC, SAE_MAX_QUESTIONS } from '../types';
import { saveExam, getExams, deleteExam } from '../utils/storage';
import { MAX_QUESTIONS_PER_SUBJECT, MAX_QUESTIONS_SINGLE } from '../utils/card-template';
import { syncExam, getExamsFromDB, deleteExamFromDB } from '../utils/api';
import { useAuth } from '../context/AuthContext';

interface Props {
  onNavigate: (view: AppView, examId?: string) => void;
}

export default function NewExamPage({ onNavigate }: Props) {
  const { user } = useAuth();
  const [exams, setExams] = useState(() => getExams(user?.id));
  const [name, setName] = useState('');
  const [templateType, setTemplateType] = useState<'padrao' | 'sae' | 'colar'>('padrao');
  const [layoutMode, setLayoutMode] = useState<'dual' | 'single'>('dual');
  const [subjectLP, setSubjectLP] = useState('LÍNGUA PORTUGUESA');
  const [subjectMat, setSubjectMat] = useState('MATEMÁTICA');
  const [questionsPerSubject, setQuestionsPerSubject] = useState(22);
  const [gradeScale, setGradeScale] = useState<Exam['gradeScale']>('0-10');
  const [saved, setSaved] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const isSae = templateType === 'sae';
  const isColar = templateType === 'colar';
  const isCustom = isSae || isColar;
  const maxQps = !isCustom ? layoutMode === 'single' ? MAX_QUESTIONS_SINGLE : MAX_QUESTIONS_PER_SUBJECT : SAE_MAX_QUESTIONS;
  const totalQuestions = isCustom || layoutMode === 'single' ? questionsPerSubject : questionsPerSubject * 2;

  useEffect(() => {
    getExamsFromDB().then(dbExams => {
      const local = getExams(user?.id);
      const localIds = new Set(local.map(e => e.id));
      for (const db of dbExams) {
        if (!localIds.has(db.external_id)) {
          saveExam({
            id: db.external_id,
            name: db.titulo,
            subjectLP: db.subject_lp,
            subjectMat: db.subject_mat,
            questionsPerSubject: db.questions_per_subject,
            totalQuestions: db.layout_mode === 'single' ? db.questions_per_subject : db.questions_per_subject * 2,
            createdAt: db.created_at || new Date().toISOString(),
            gradeScale: (db.grade_scale as Exam['gradeScale']) || '0-10',
            answerKey: (db.answer_key as Record<number, string> | null) || null,
            layoutMode: db.layout_mode as Exam['layoutMode'],
          }, user?.id);
        }
      }
      const dbIds = new Set(dbExams.map(d => d.external_id));
      for (const ex of local) {
        if (!dbIds.has(ex.id)) syncExam(ex).catch(() => {});
      }
      setExams(getExams(user?.id));
    }).catch(() => {});
  }, [user?.id]);

  const handleQpsChange = (raw: string) => {
    if (raw === '') { setQuestionsPerSubject(0); return; }
    const v = Math.max(1, Math.min(maxQps, Math.round(Number(raw))));
    setQuestionsPerSubject(v);
  };

  const handleTemplateChange = (t: 'padrao' | 'sae' | 'colar') => {
    setTemplateType(t);
    if (t !== 'padrao' && questionsPerSubject > SAE_MAX_QUESTIONS) {
      setQuestionsPerSubject(SAE_MAX_QUESTIONS);
    }
  };

  const handleModeChange = (mode: 'dual' | 'single') => {
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
      subjectMat: isCustom ? subjectLP.trim() : layoutMode === 'single' ? subjectLP.trim() : subjectMat.trim(),
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
    setTemplateType(exam.templateType === 'sae' || exam.templateType === 'colar' ? exam.templateType : 'padrao');
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
            <div className="grid grid-cols-3 gap-3">
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

          {!isCustom && (
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
              min={1}
              max={maxQps}
              value={questionsPerSubject || ''}
              onChange={(e) => handleQpsChange(e.target.value)}
            />
            <p className="text-xs text-gray-400 mt-1">
              1 a {maxQps} questões — total de {questionsPerSubject > 0 ? totalQuestions : '—'} questões.
              {!isCustom && layoutMode === 'dual' && ' O padrão do layout é 22 por disciplina.'}
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
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Provas Cadastradas</h2>
          <div className="space-y-2 max-w-2xl">
            {exams.map((exam) => (
              <div key={exam.id} className="card flex items-center justify-between p-4">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">{exam.name}</p>
                  <p className="text-sm text-gray-500">
                    {exam.templateType && exam.templateType !== 'padrao' && (
                      <span className="inline-block mr-1 px-1.5 py-0.5 text-xs font-medium rounded bg-violet-100 text-violet-700">{exam.templateType === 'sae' ? 'Avaliação Contínua' : 'Colar em Avaliação'}</span>
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
