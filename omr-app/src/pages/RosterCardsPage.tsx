import { useState, useEffect, useRef } from 'react';
import { CheckCircle2, Download, FileUp, Upload } from 'lucide-react';
import { AppView, Exam } from '../types';
import { getExams, saveExam } from '../utils/storage';
import {
  importStudents, countPdfPages,
  ImportResult,
} from '../utils/students';
import {
  syncExam, importStudentsAPI,
  generateGabaritos, generateGabaritosPDF,
  fetchGabaritos, checkHealth,
  listTurmas, getTurma, materializeFromTurma,
  PersistedAluno, ImportStudentsResult,
  TurmaDTO, TurmaDetail,
} from '../utils/api';
import AnswerCard from '../components/AnswerCard';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/ui/PageHeader';
import Field from '../components/ui/Field';
import Select from '../components/ui/Select';
import Button from '../components/ui/Button';
import StatCard from '../components/ui/StatCard';
import EmptyState from '../components/ui/EmptyState';

interface Props {
  examId: string | null;
  onNavigate: (view: AppView, examId?: string) => void;
}

type Step = 'form' | 'generating' | 'done';

export default function RosterCardsPage({ examId, onNavigate }: Props) {
  const { user } = useAuth();
  const userId = user?.id;

  const exams = getExams(userId);
  const [selectedExamId, setSelectedExamId] = useState(examId || '');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [backendAvailable, setBackendAvailable] = useState<boolean | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const [step, setStep] = useState<Step>('form');
  const [stage, setStage] = useState('');
  const [genError, setGenError] = useState<string | null>(null);
  const [importingOnly, setImportingOnly] = useState(false);
  const [importedPersisted, setImportedPersisted] = useState<ImportStudentsResult | null>(null);
  const [source, setSource] = useState<'file' | 'turma'>('file');
  const [turmas, setTurmas] = useState<TurmaDTO[]>([]);
  const [turmaSelId, setTurmaSelId] = useState<number | ''>('');
  const [turmaDetail, setTurmaDetail] = useState<TurmaDetail | null>(null);
  const [loadingTurma, setLoadingTurma] = useState(false);
  const [doneInfo, setDoneInfo] = useState<{
    pages: number;
    alunos: PersistedAluno[];
    primeiroCodigo: string;
    ultimoCodigo: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (examId) setSelectedExamId(examId);
  }, [examId]);

  useEffect(() => {
    checkHealth().then(setBackendAvailable);
  }, []);

  useEffect(() => {
    listTurmas().then(setTurmas).catch(() => setTurmas([]));
  }, []);

  const activeExam: Exam | undefined = selectedExamId
    ? exams.find(e => e.id === selectedExamId)
    : undefined;

  const students = result?.students ?? [];
  const n = students.length;
  const isColarExam = activeExam?.templateType === 'colar';
const isHerbyExam = activeExam?.templateType === 'herby';
const isSimuladoExam = activeExam?.templateType === 'simulado';
const SIMULADO_BLOCK_MSG = 'Provas "Simulado" são avulsas (sem QR/nome/turma): gere o cartão em branco em Gerar Cartão em vez do lote por alunos.';
  const COLAR_BLOCK_MSG = 'Provas "Colar em Avaliação" são avulsas (sem QR/nome): gere o cartão em branco em Gerar Cartão em vez do lote por alunos.';
const HERBY_BLOCK_MSG = 'Provas "Gabarito Herby" exigem geração em lote via Gerenciar Avaliação (com QR duplo + código único por aluno).';

  const switchSource = (s: 'file' | 'turma') => {
    setSource(s);
    setGenError(null);
    if (s === 'turma' && turmaSelId === '' && activeExam?.turmaId) {
      void pickTurma(activeExam.turmaId);
    }
  };

  const pickTurma = async (id: number | '') => {
    setTurmaSelId(id);
    setTurmaDetail(null);
    setGenError(null);
    if (id === '') return;
    setLoadingTurma(true);
    try {
      setTurmaDetail(await getTurma(id));
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Falha ao carregar a turma.');
    } finally {
      setLoadingTurma(false);
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setParseError(null);
    setResult(null);
    setShowIgnored(false);
    setShowPreview(false);
    setGenError(null);
    setImportedPersisted(null);
    setDoneInfo(null);
    setFileName(file.name);
    try {
      setResult(await importStudents(file));
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Não foi possível ler o arquivo.');
    }
  };

  const reset = () => {
    setResult(null);
    setParseError(null);
    setFileName('');
    setShowIgnored(false);
    setShowPreview(false);
    setGenError(null);
    setImportedPersisted(null);
    setImportingOnly(false);
    setDoneInfo(null);
    setStage('');
    setStep('form');
    setSource('file');
    setTurmaSelId('');
    setTurmaDetail(null);
  };

  const handleImportOnly = async () => {
    if (!activeExam || !result || n === 0) return;
    if (isColarExam) { setGenError(COLAR_BLOCK_MSG); return; }
    if (isSimuladoExam) { setGenError(SIMULADO_BLOCK_MSG); return; }
    setImportingOnly(true);
    setGenError(null);
    setStage('');
    try {
      if (!(await checkHealth())) {
        throw new Error('O backend Python é obrigatório para salvar no banco. Inicie-o com start-omr.bat e tente novamente.');
      }
      setStage('Sincronizando a prova com o banco de dados...');
      const sync = await syncExam(activeExam);
      setStage(`Persistindo ${n} alunos no banco...`);
      const imported = await importStudentsAPI(
        sync.external_id,
        students.map(s => ({ nome: s.name, matricula: s.identifier ?? null })),
      );
      if (imported.total_importados !== n) {
        throw new Error(`Validação falhou: ${n} nomes válidos no arquivo, mas ${imported.total_importados} foram persistidos.`);
      }
      setImportedPersisted(imported);
      setStage('');
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Erro ao importar os alunos.');
    } finally {
      setImportingOnly(false);
    }
  };

  const handleGenerate = async () => {
    if (!activeExam || !result || n === 0) return;
    if (isColarExam) { setGenError(COLAR_BLOCK_MSG); return; }
    if (isHerbyExam) { setGenError(HERBY_BLOCK_MSG); return; }
    if (isSimuladoExam) { setGenError(SIMULADO_BLOCK_MSG); return; }
    setGenError(null);
    setStep('generating');
    try {
      if (!(await checkHealth())) {
        throw new Error('O backend Python é obrigatório para gabaritos nomeados: os alunos e os códigos QR precisam ser gravados no banco de dados antes da geração do PDF. Inicie o servidor (start-omr.bat) e tente novamente.');
      }
      let externalId: string | null = null;
      let importedForPdf: ImportStudentsResult | null = importedPersisted;
      if (importedPersisted && importedPersisted.total_importados === n) {
        externalId = importedPersisted.external_id;
        setStage('Importação já confirmada — gerando gabaritos e códigos únicos...');
        await generateGabaritos(externalId);
      } else {
        setStage('Sincronizando a prova com o banco de dados...');
        const sync = await syncExam(activeExam);
        setStage(`Persistindo ${n} alunos no banco...`);
        const imported = await importStudentsAPI(
          sync.external_id,
          students.map(s => ({ nome: s.name, matricula: s.identifier ?? null })),
        );
        if (imported.total_importados !== n) {
          throw new Error(`Validação falhou: ${n} nomes válidos no arquivo, mas ${imported.total_importados} foram persistidos.`);
        }
        externalId = sync.external_id;
        importedForPdf = imported;
        setImportedPersisted(imported);
        setStage('Gerando gabaritos e códigos únicos...');
        await generateGabaritos(sync.external_id);
      }
      setStage(`Gerando PDF com ${n} páginas a partir do banco...`);
      const blob = await generateGabaritosPDF(externalId!);
      const pdfText = await blob.text();
      const pages = countPdfPages(pdfText);
      if (pages !== n) {
        throw new Error(`Validação falhou: ${n} alunos persistidos, ${pages} páginas no PDF. O arquivo NÃO foi disponibilizado.`);
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const slug = activeExam.name.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '');
      a.href = url;
      a.download = `gabaritos_${slug || 'prova'}_${n}_paginas.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      let lista: Awaited<ReturnType<typeof fetchGabaritos>> | null = null;
      try {
        lista = await fetchGabaritos(externalId!);
      } catch { /* painel de detalhe opcional */ }
      const codigos = lista?.gabaritos.map(g => g.codigo_unico) ?? [];
      const alunosPersistidos = importedForPdf?.alunos ?? importedPersisted?.alunos ?? [];
      setDoneInfo({
        pages,
        alunos: alunosPersistidos,
        primeiroCodigo: codigos[0] ?? '—',
        ultimoCodigo: codigos[codigos.length - 1] ?? '—',
      });
      setStep('done');
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Erro ao gerar os gabaritos.');
      setStep('form');
    }
  };

  const handleGenerateFromTurma = async () => {
    if (!activeExam || !turmaDetail || turmaDetail.alunos.length === 0) return;
    if (isColarExam) { setGenError(COLAR_BLOCK_MSG); return; }
    if (isHerbyExam) { setGenError(HERBY_BLOCK_MSG); return; }
    if (isSimuladoExam) { setGenError(SIMULADO_BLOCK_MSG); return; }
    setGenError(null);
    setStep('generating');
    try {
      if (!(await checkHealth())) {
        throw new Error('O backend Python é obrigatório para gabaritos nomeados: os alunos e os códigos QR precisam ser gravados no banco de dados antes da geração do PDF. Inicie o servidor (start-omr.bat) e tente novamente.');
      }
      // Vincula a prova à turma (rótulo impresso + turma_id) antes de materializar
      const examToSync: Exam = { ...activeExam, turma: turmaDetail.nome, turmaId: turmaDetail.id };
      setStage('Sincronizando a prova com o banco de dados...');
      const sync = await syncExam(examToSync);
      saveExam(examToSync, userId);
      setStage(`Materializando ${turmaDetail.alunos.length} aluno(s) da turma "${turmaDetail.nome}"...`);
      const mat = await materializeFromTurma(sync.external_id, turmaDetail.id);
      setStage(`Turma sincronizada (${mat.materializados} novo(s), ${mat.reaproveitados} reaproveitado(s)). Gerando gabaritos...`);
      // O lote é filtrado pela turma: uma prova que já recebeu alunos de
      // outras turmas não pode imprimir os nomes delas neste PDF.
      const gen = await generateGabaritos(sync.external_id, turmaDetail.id);
      setStage(`Gerando PDF com ${gen.total_alunos} páginas a partir do banco...`);
      const blob = await generateGabaritosPDF(sync.external_id, turmaDetail.id);
      const pdfText = await blob.text();
      const pages = countPdfPages(pdfText);
      if (pages !== gen.total_alunos) {
        throw new Error(`Validação falhou: ${gen.total_alunos} alunos na turma, ${pages} páginas no PDF. O arquivo NÃO foi disponibilizado.`);
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const slug = activeExam.name.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '');
      a.href = url;
      a.download = `gabaritos_${slug || 'prova'}_${pages}_paginas.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      let lista: Awaited<ReturnType<typeof fetchGabaritos>> | null = null;
      try {
        lista = await fetchGabaritos(sync.external_id, turmaDetail.id);
      } catch { /* painel de detalhe opcional */ }
      const alunosPersistidos = lista?.gabaritos.map(g => ({ id: g.aluno.id, nome: g.aluno.nome, matricula: g.aluno.matricula })) ?? [];
      const codigos = lista?.gabaritos.map(g => g.codigo_unico) ?? [];
      setDoneInfo({
        pages,
        alunos: alunosPersistidos,
        primeiroCodigo: codigos[0] ?? '—',
        ultimoCodigo: codigos[codigos.length - 1] ?? '—',
      });
      setStep('done');
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Erro ao gerar os gabaritos.');
      setStep('form');
    }
  };

  const ignoredEmpty = result ? result.ignored.filter(i => i.reason === 'Linha vazia').length : 0;
  const ignoredOther = result ? result.ignored.filter(i => i.reason !== 'Linha vazia') : [];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Cartões por lista da prova"
        subtitle="1 nome válido importado = 1 aluno persistido = 1 gabarito com QR Code = 1 página no PDF"
      />

      {step === 'generating' && (
        <div className="card max-w-2xl text-center py-12">
          <div className="animate-spin w-12 h-12 border-4 border-brand-500 border-t-transparent rounded-full mx-auto mb-4" role="status" aria-label="Gerando gabaritos" />
          <p className="text-gray-600 dark:text-gray-300 font-medium">{stage || 'Processando...'}</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
            Os dados estão sendo gravados no banco de dados do servidor.
          </p>
        </div>
      )}

      {step === 'done' && doneInfo && (
        <div className="card max-w-2xl text-center py-12">
          <div className="w-16 h-16 bg-success-50 dark:bg-success-700/20 rounded-full flex items-center justify-center mx-auto mb-4 text-success-600 dark:text-success-100" aria-hidden>
            <CheckCircle2 size={32} strokeWidth={1.8} />
          </div>
          <h3 className="text-xl font-bold text-ink dark:text-white mb-4">Gabaritos gerados e persistidos!</h3>

          <div className="inline-grid grid-cols-3 gap-3 mb-4 text-sm">
            <div className="bg-success-50 dark:bg-success-700/15 rounded-lg px-4 py-2">
              <p className="font-bold text-success-600 dark:text-success-100">{doneInfo.alunos.length}</p>
              <p className="text-xs text-success-600/80 dark:text-success-100/70">Alunos no banco</p>
            </div>
            <div className="bg-success-50 dark:bg-success-700/15 rounded-lg px-4 py-2">
              <p className="font-bold text-success-600 dark:text-success-100">{doneInfo.alunos.length}</p>
              <p className="text-xs text-success-600/80 dark:text-success-100/70">Códigos únicos</p>
            </div>
            <div className="bg-success-50 dark:bg-success-700/15 rounded-lg px-4 py-2">
              <p className="font-bold text-success-600 dark:text-success-100">{doneInfo.pages}</p>
              <p className="text-xs text-success-600/80 dark:text-success-100/70">Páginas do PDF</p>
            </div>
          </div>

          <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
            IDs internos #{Math.min(...doneInfo.alunos.map(a => a.id))}–#{Math.max(...doneInfo.alunos.map(a => a.id))}
            {' '}• Códigos {doneInfo.primeiroCodigo} … {doneInfo.ultimoCodigo}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-6">
            A associação código ↔ aluno está salva no banco e sobrevive ao fechamento do sistema.
          </p>

          <div className="flex gap-2 justify-center">
            <Button onClick={() => onNavigate('manage-exam', activeExam?.id)}>
              Ver avaliação
            </Button>
            <Button variant="secondary" onClick={reset}>
              Importar outra lista
            </Button>
          </div>
        </div>
      )}

      {step === 'form' && (
        <>
          <div className="card max-w-3xl space-y-5">
            <Field label="Selecione a prova" htmlFor="roster-exam-select" required>
              {exams.length === 0 ? (
                <EmptyState
                  title="Nenhuma prova cadastrada"
                  action={<Button size="sm" onClick={() => onNavigate('new-exam')}>Criar prova</Button>}
                />
              ) : (
                <Select
                  id="roster-exam-select"
                  value={selectedExamId}
                  onChange={(e) => setSelectedExamId(e.target.value)}
                >
                  <option value="">Selecione...</option>
                  {exams.map(x => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </Select>
              )}
            </Field>
            {isColarExam && (
              <div className="callout-warning">{COLAR_BLOCK_MSG}</div>
            )}
            {isSimuladoExam && (
              <div className="callout-warning">{SIMULADO_BLOCK_MSG}</div>
            )}

            {activeExam && (
              <div>
                <span className="label">Origem da lista de alunos *</span>
                <div className="grid grid-cols-2 gap-3 mb-4" role="radiogroup" aria-label="Origem da lista de alunos">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={source === 'file'}
                    onClick={() => switchSource('file')}
                    className={`p-3 rounded-lg border text-sm font-medium text-left transition-colors min-h-[44px] ${
                      source === 'file'
                        ? 'border-brand-500 bg-brand-50 text-ink dark:bg-brand-700/15 dark:text-white dark:border-brand-400'
                        : 'border-line text-gray-600 hover:bg-surface dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                    }`}
                  >
                    Arquivo XLSX/CSV
                    <span className="block text-xs font-normal text-gray-400 dark:text-gray-500">enviar a planilha de novo</span>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={source === 'turma'}
                    onClick={() => switchSource('turma')}
                    className={`p-3 rounded-lg border text-sm font-medium text-left transition-colors min-h-[44px] ${
                      source === 'turma'
                        ? 'border-brand-500 bg-brand-50 text-ink dark:bg-brand-700/15 dark:text-white dark:border-brand-400'
                        : 'border-line text-gray-600 hover:bg-surface dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                    }`}
                  >
                    Turma cadastrada
                    <span className="block text-xs font-normal text-gray-400 dark:text-gray-500">reutilizar o catálogo, sem planilha</span>
                  </button>
                </div>

                {source === 'file' ? (
                  <>
                    <span className="label">Lista de alunos (XLSX ou CSV) *</span>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full border-2 border-dashed border-line dark:border-gray-700 rounded-lg p-6 text-center hover:border-brand-400 hover:bg-brand-50/30 dark:hover:bg-brand-700/10 transition-colors min-h-[44px]"
                    >
                      <Upload size={28} strokeWidth={1.5} className="text-gray-400 mx-auto mb-2" aria-hidden />
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
                        Clique para importar o arquivo com os nomes dos alunos
                      </span>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">.xlsx, .xls ou .csv</p>
                    </button>
                    {fileName && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Arquivo: {fileName}</p>}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv,text/csv"
                      className="hidden"
                      onChange={handleFile}
                    />
                  </>
                ) : (
                  <Field label="Turma" htmlFor="roster-turma-select" required>
                    {turmas.length === 0 ? (
                      <EmptyState
                        title="Nenhuma turma cadastrada"
                        action={<Button size="sm" onClick={() => onNavigate('turmas')}>Cadastrar turma</Button>}
                      />
                    ) : (
                      <Select
                        id="roster-turma-select"
                        value={turmaSelId}
                        onChange={(e) => pickTurma(e.target.value === '' ? '' : Number(e.target.value))}
                      >
                        <option value="">Selecione...</option>
                        {turmas.map(t => (
                          <option key={t.id} value={t.id}>
                            {t.nome} ({t.total_alunos} aluno{t.total_alunos === 1 ? '' : 's'})
                          </option>
                        ))}
                      </Select>
                    )}
                    {loadingTurma && <p className="text-sm text-gray-500 dark:text-gray-400 mt-2" role="status">Carregando turma...</p>}
                    {turmaDetail && (
                      <div className="callout-info mt-2">
                        {turmaDetail.alunos.length} aluno(s) no catálogo de &quot;{turmaDetail.nome}&quot;.
                        A prova será vinculada a esta turma e o nome impresso no cartão.
                      </div>
                    )}
                  </Field>
                )}
              </div>
            )}

            {parseError && (
              <div className="callout-danger">{parseError}</div>
            )}

            {result && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <StatCard label="Alunos importados" value={n} tone="info" />
                  <StatCard label="Gabaritos a gerar" value={n} />
                  <StatCard label="Páginas do PDF" value={n} tone="info" />
                </div>

                {n === 0 ? (
                  <div className="callout-danger">
                    Nenhum aluno válido encontrado no arquivo. Verifique se existe uma coluna de nomes.
                  </div>
                ) : (
                  <div className="bg-surface dark:bg-gray-800/60 rounded-lg p-4 text-sm space-y-1 text-ink dark:text-gray-200">
                    <p><strong>Coluna de nomes:</strong> {result.nameColumnLabel}</p>
                    {result.identifierColumnLabel && (
                      <p><strong>Coluna de identificação:</strong> {result.identifierColumnLabel}</p>
                    )}
                    <p><strong>Linhas lidas:</strong> {result.totalRowsRead} &nbsp;•&nbsp; <strong>Válidas:</strong> {n} &nbsp;•&nbsp; <strong>Ignoradas:</strong> {result.ignored.length}</p>
                    {ignoredEmpty > 0 && <p className="text-gray-500 dark:text-gray-400">{ignoredEmpty} linha(s) vazia(s) ignorada(s).</p>}
                    {ignoredOther.length > 0 && (
                      <p className="text-warning-600 dark:text-warning-100">
                        {ignoredOther.length} linha(s) sem nome válido ignorada(s).
                        <button onClick={() => setShowIgnored(v => !v)} className="underline ml-2 font-medium">
                          {showIgnored ? 'Ocultar' : 'Detalhar'}
                        </button>
                      </p>
                    )}
                    {result.duplicateNamesCount > 0 && (
                      <p className="text-brand-600 dark:text-brand-200">
                        {result.duplicateNamesCount} nome(s) duplicado(s): mantidos como alunos independentes
                        {result.identifierColumnLabel ? ' (diferenciados pela identificação)' : ''}.
                      </p>
                    )}
                    {showIgnored && (
                      <ul className="list-disc list-inside text-xs text-warning-600 dark:text-warning-100 max-h-32 overflow-y-auto mt-1">
                        {ignoredOther.map((r, i) => (
                          <li key={i}>Linha {r.row}: {r.reason}</li>
                        ))}
                      </ul>
                    )}
                    {!result.headerDetected && (
                      <p className="text-gray-400 dark:text-gray-500 text-xs">Cabeçalho não detectado — primeira coluna com nomes utilizada automaticamente.</p>
                    )}
                  </div>
                )}
              </>
            )}

            {importedPersisted && (
              <div className="callout-success">
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={15} aria-hidden /> {importedPersisted.total_importados} aluno(s) já importado(s) no banco para esta prova
                {' '}({importedPersisted.alunos.length} registro(s) com IDs internos).</span>{' '}
                <button onClick={() => onNavigate('manage-exam', activeExam!.id)} className="underline font-medium ml-1">
                  Ver em Gerenciar Avaliação
                </button>
                {' '}— se importar de novo o mesmo arquivo, os alunos serão duplicados.
              </div>
            )}

            {stage && (
              <div className="callout-info">
                <span className="inline-flex items-center gap-2">
                  <span className="animate-spin w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full" aria-hidden />
                  {stage}
                </span>
              </div>
            )}

            {backendAvailable === false && (
              <div className="callout-warning">
                O backend Python não está acessível. Gabaritos nomeados exigem o banco de dados do
                servidor — inicie-o com <strong>start-omr.bat</strong>.
              </div>
            )}

            {genError && (
              <div className="callout-danger whitespace-pre-line">{genError}</div>
            )}

            {result && n > 0 && (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Button
                    variant="secondary"
                    onClick={handleImportOnly}
                    disabled={!selectedExamId || backendAvailable === false || !!importedPersisted}
                    loading={importingOnly}
                    icon={<FileUp size={16} aria-hidden />}
                    title={
                      importedPersisted
                        ? 'Alunos deste arquivo já foram gravados no banco'
                        : 'Grava os alunos no banco sem gerar gabaritos (útil para revisar antes do PDF)'
                    }
                  >
                    {importedPersisted ? 'Importados no banco' : `Apenas importar ${n} aluno${n > 1 ? 's' : ''} no banco`}
                  </Button>

                  <Button
                    onClick={handleGenerate}
                    disabled={!selectedExamId || backendAvailable === false}
                    icon={<Download size={16} aria-hidden />}
                  >
                    Gerar {n} gabarito{n > 1 ? 's' : ''} em PDF ({n} página{n > 1 ? 's' : ''})
                  </Button>
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
                  &quot;Apenas importar&quot; deixa os gabaritos pendentes — use depois o
                  {' '}<button onClick={() => onNavigate('manage-exam', activeExam!.id)} className="underline">Gerenciar Avaliação</button>
                  {' '}ou este mesmo botão para gerar o PDF.
                </p>
                <Button variant="secondary" onClick={reset}>
                  Limpar
                </Button>
              </div>
            )}

            {source === 'turma' && turmaDetail && turmaDetail.alunos.length > 0 && (
              <div className="flex flex-col gap-3">
                <Button
                  onClick={handleGenerateFromTurma}
                  disabled={!selectedExamId || backendAvailable === false}
                  icon={<Download size={16} aria-hidden />}
                >
                  Gerar gabaritos da turma &quot;{turmaDetail.nome}&quot; em PDF
                </Button>
                <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
                  Materializa o catálogo na prova (sem duplicar quem já está nela), vincula a turma
                  e gera o PDF. Alunos novos no catálogo entram na próxima geração.
                </p>
                <Button variant="secondary" onClick={reset}>
                  Limpar
                </Button>
              </div>
            )}
          </div>

          {result && n > 0 && (
            <div className="card max-w-3xl mt-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold text-ink dark:text-white">
                  Alunos importados ({n})
                </h3>
                <Button variant="secondary" size="sm" onClick={() => setShowPreview(v => !v)}>
                  {showPreview ? 'Ocultar prévia' : 'Prévia do cartão'}
                </Button>
              </div>
              <div className="overflow-y-auto max-h-96 border border-line dark:border-gray-700 rounded-lg">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white dark:bg-gray-900 shadow-[0_1px_0_0_#E2E8F0]">
                    <tr>
                      <th className="py-2 px-3 text-left font-medium text-gray-500 dark:text-gray-400 w-12">#</th>
                      {result.identifierColumnLabel && (
                        <th className="py-2 px-3 text-left font-medium text-gray-500 dark:text-gray-400">Identificação</th>
                      )}
                      <th className="py-2 px-3 text-left font-medium text-gray-500 dark:text-gray-400">Nome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s) => (
                      <tr key={s.seq} className="border-b border-line/60 dark:border-gray-800 hover:bg-surface dark:hover:bg-gray-800">
                        <td className="py-1.5 px-3 text-gray-400 dark:text-gray-500 tabular-nums">{s.seq}</td>
                        {result.identifierColumnLabel && (
                          <td className="py-1.5 px-3 text-gray-500 dark:text-gray-400">{s.identifier ?? '—'}</td>
                        )}
                        <td className="py-1.5 px-3 text-ink dark:text-gray-100">{s.name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                Os IDs internos e os códigos únicos (QR) são gerados pelo servidor durante a gravação no banco.
              </p>

              {showPreview && activeExam && students[0] && (
                <>
                  <div className="mt-4 bg-gray-200 dark:bg-gray-800 p-4 rounded-xl overflow-auto flex justify-center">
                    <div className="print-answer-card shadow-2xl" style={{ position: 'relative' }}>
                      <AnswerCard
                        exam={activeExam}
                        cardId="(gerado pelo servidor)"
                        studentName={students[0].name}
                        questionsPerSubject={activeExam.questionsPerSubject}
                        layoutMode={activeExam.layoutMode}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 text-center">
                    Prévia ilustrativa — ID textual e QR Code definitivos são inseridos na geração do PDF.
                  </p>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
