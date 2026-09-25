import { useState, useEffect, useRef } from 'react';
import { AppView, Exam } from '../types';
import { getExams } from '../utils/storage';
import {
  importStudents, countPdfPages,
  ImportResult,
} from '../utils/students';
import {
  syncExam, importStudentsAPI,
  generateGabaritos, generateGabaritosPDF,
  fetchGabaritos, checkHealth,
  PersistedAluno, ImportStudentsResult,
} from '../utils/api';
import AnswerCard from '../components/AnswerCard';
import { useAuth } from '../context/AuthContext';

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

  const activeExam: Exam | undefined = selectedExamId
    ? exams.find(e => e.id === selectedExamId)
    : undefined;

  const students = result?.students ?? [];
  const n = students.length;
  const isColarExam = activeExam?.templateType === 'colar';
const isHerbyExam = activeExam?.templateType === 'herby';
  const COLAR_BLOCK_MSG = 'Provas "Colar em Avaliação" são avulsas (sem QR/nome): gere o cartão em branco em Gerar Cartão em vez do lote por alunos.';
const HERBY_BLOCK_MSG = 'Provas "Gabarito Herby" exigem geração em lote via Gerenciar Avaliação (com QR duplo + código único por aluno).';

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
  };

  const handleImportOnly = async () => {
    if (!activeExam || !result || n === 0) return;
    if (isColarExam) { setGenError(COLAR_BLOCK_MSG); return; }
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

  const ignoredEmpty = result ? result.ignored.filter(i => i.reason === 'Linha vazia').length : 0;
  const ignoredOther = result ? result.ignored.filter(i => i.reason !== 'Linha vazia') : [];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Gabaritos por Lista de Alunos</h1>
      <p className="text-gray-500 mb-6">
        1 nome válido importado = 1 aluno persistido = 1 gabarito com QR Code = 1 página no PDF
      </p>

      {step === 'generating' && (
        <div className="card max-w-2xl text-center py-12">
          <div className="animate-spin w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-600 font-medium">{stage || 'Processando...'}</p>
          <p className="text-sm text-gray-400 mt-1">
            Os dados estão sendo gravados no banco de dados do servidor.
          </p>
        </div>
      )}

      {step === 'done' && doneInfo && (
        <div className="card max-w-2xl text-center py-12">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-4">Gabaritos Gerados e Persistidos!</h3>

          <div className="inline-grid grid-cols-3 gap-3 mb-4 text-sm">
            <div className="bg-emerald-50 rounded-lg px-4 py-2">
              <p className="font-bold text-emerald-700">{doneInfo.alunos.length}</p>
              <p className="text-xs text-emerald-600">Alunos no banco</p>
            </div>
            <div className="bg-emerald-50 rounded-lg px-4 py-2">
              <p className="font-bold text-emerald-700">{doneInfo.alunos.length}</p>
              <p className="text-xs text-emerald-600">Códigos únicos</p>
            </div>
            <div className="bg-emerald-50 rounded-lg px-4 py-2">
              <p className="font-bold text-emerald-700">{doneInfo.pages}</p>
              <p className="text-xs text-emerald-600">Páginas do PDF</p>
            </div>
          </div>

          <p className="text-sm text-gray-500 mb-1">
            IDs internos #{Math.min(...doneInfo.alunos.map(a => a.id))}–#{Math.max(...doneInfo.alunos.map(a => a.id))}
            {' '}• Códigos {doneInfo.primeiroCodigo} … {doneInfo.ultimoCodigo}
          </p>
          <p className="text-xs text-gray-400 mb-6">
            A associação código ↔ aluno está salva no banco e sobrevive ao fechamento do sistema.
          </p>

          <div className="flex gap-3 justify-center">
            <button onClick={() => onNavigate('manage-exam', activeExam?.id)} className="btn btn-primary">
              Ver Avaliação
            </button>
            <button onClick={reset} className="btn btn-secondary">
              Importar Outra Lista
            </button>
          </div>
        </div>
      )}

      {step === 'form' && (
        <>
          <div className="card max-w-3xl space-y-5">
            <div>
              <label className="label">Selecione a Prova *</label>
              {exams.length === 0 ? (
                <div className="text-sm text-gray-500">
                  <p>Nenhuma prova cadastrada.</p>
                  <button onClick={() => onNavigate('new-exam')} className="btn btn-primary btn-sm mt-2">
                    Criar Prova
                  </button>
                </div>
              ) : (
                <select
                  className="input"
                  value={selectedExamId}
                  onChange={(e) => setSelectedExamId(e.target.value)}
                >
                  <option value="">Selecione...</option>
                  {exams.map(x => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </select>
              )}
              {isColarExam && (
                <p className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">
                  {COLAR_BLOCK_MSG}
                </p>
              )}
            </div>

            {activeExam && (
              <div>
                <label className="label">Lista de Alunos (XLSX ou CSV) *</label>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 hover:bg-blue-50/30 transition-colors"
                >
                  <svg className="w-8 h-8 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-sm font-medium text-gray-600">
                    Clique para importar o arquivo com os nomes dos alunos
                  </span>
                  <p className="text-xs text-gray-400 mt-1">.xlsx, .xls ou .csv</p>
                </button>
                {fileName && <p className="text-xs text-gray-400 mt-1">Arquivo: {fileName}</p>}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,text/csv"
                  className="hidden"
                  onChange={handleFile}
                />
              </div>
            )}

            {parseError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{parseError}</div>
            )}

            {result && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-blue-50 rounded-lg p-4 text-center">
                    <p className="text-sm text-blue-600/80 font-medium uppercase tracking-wide">Alunos importados:</p>
                    <p className="text-3xl font-bold text-blue-600">{n}</p>
                  </div>
                  <div className="bg-indigo-50 rounded-lg p-4 text-center">
                    <p className="text-sm text-indigo-600/80 font-medium uppercase tracking-wide">Gabaritos a gerar:</p>
                    <p className="text-3xl font-bold text-indigo-600">{n}</p>
                  </div>
                  <div className="bg-purple-50 rounded-lg p-4 text-center">
                    <p className="text-sm text-purple-600/80 font-medium uppercase tracking-wide">Páginas do PDF:</p>
                    <p className="text-3xl font-bold text-purple-600">{n}</p>
                  </div>
                </div>

                {n === 0 ? (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                    Nenhum aluno válido encontrado no arquivo. Verifique se existe uma coluna de nomes.
                  </div>
                ) : (
                  <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-1">
                    <p><strong>Coluna de nomes:</strong> {result.nameColumnLabel}</p>
                    {result.identifierColumnLabel && (
                      <p><strong>Coluna de identificação:</strong> {result.identifierColumnLabel}</p>
                    )}
                    <p><strong>Linhas lidas:</strong> {result.totalRowsRead} &nbsp;•&nbsp; <strong>Válidas:</strong> {n} &nbsp;•&nbsp; <strong>Ignoradas:</strong> {result.ignored.length}</p>
                    {ignoredEmpty > 0 && <p className="text-gray-500">{ignoredEmpty} linha(s) vazia(s) ignorada(s).</p>}
                    {ignoredOther.length > 0 && (
                      <p className="text-amber-600">
                        {ignoredOther.length} linha(s) sem nome válido ignorada(s).
                        <button onClick={() => setShowIgnored(v => !v)} className="underline ml-2 font-medium">
                          {showIgnored ? 'Ocultar' : 'Detalhar'}
                        </button>
                      </p>
                    )}
                    {result.duplicateNamesCount > 0 && (
                      <p className="text-blue-600">
                        {result.duplicateNamesCount} nome(s) duplicado(s): mantidos como alunos independentes
                        {result.identifierColumnLabel ? ' (diferenciados pela identificação)' : ''}.
                      </p>
                    )}
                    {showIgnored && (
                      <ul className="list-disc list-inside text-xs text-amber-700 max-h-32 overflow-y-auto mt-1">
                        {ignoredOther.map((r, i) => (
                          <li key={i}>Linha {r.row}: {r.reason}</li>
                        ))}
                      </ul>
                    )}
                    {!result.headerDetected && (
                      <p className="text-gray-400 text-xs">Cabeçalho não detectado — primeira coluna com nomes utilizada automaticamente.</p>
                    )}
                  </div>
                )}
              </>
            )}

            {importedPersisted && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 text-sm">
                ✓ {importedPersisted.total_importados} aluno(s) já importado(s) no banco para esta prova
                {' '}({importedPersisted.alunos.length} registro(s) com IDs internos).{' '}
                <button onClick={() => onNavigate('manage-exam', activeExam!.id)} className="underline font-medium ml-1">
                  Ver em Gerenciar Avaliação
                </button>
                {' '}— se importar de novo o mesmo arquivo, os alunos serão duplicados.
              </div>
            )}

            {stage && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm">
                <div className="inline-flex items-center gap-2">
                  <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full" />
                  {stage}
                </div>
              </div>
            )}

            {backendAvailable === false && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">
                O backend Python não está acessível. Gabaritos nomeados exigem o banco de dados do
                servidor — inicie-o com <strong>start-omr.bat</strong>.
              </div>
            )}

            {genError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm whitespace-pre-line">{genError}</div>
            )}

            {result && n > 0 && (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={handleImportOnly}
                    disabled={!selectedExamId || backendAvailable === false || importingOnly || !!importedPersisted}
                    className="btn btn-secondary"
                    title={
                      importedPersisted
                        ? 'Alunos deste arquivo já foram gravados no banco'
                        : 'Grava os alunos no banco sem gerar gabaritos (útil para revisar antes do PDF)'
                    }
                  >
                    {importingOnly ? (
                      <>
                        <div className="animate-spin w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full" />
                        Importando...
                      </>
                    ) : importedPersisted ? (
                      'Importados no banco ✓'
                    ) : (
                      `Apenas importar ${n} aluno${n > 1 ? 's' : ''} no banco`
                    )}
                  </button>

                  <button
                    onClick={handleGenerate}
                    disabled={!selectedExamId || backendAvailable === false}
                    className="btn btn-primary"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Gerar {n} Gabarito{n > 1 ? 's' : ''} em PDF ({n} página{n > 1 ? 's' : ''})
                  </button>
                </div>
                <p className="text-xs text-gray-400 text-center">
                  &quot;Apenas importar&quot; deixa os gabaritos pendentes — use depois o
                  {' '}<button onClick={() => onNavigate('manage-exam', activeExam!.id)} className="underline">Gerenciar Avaliação</button>
                  {' '}ou este mesmo botão para gerar o PDF.
                </p>
                <button onClick={reset} className="btn btn-secondary">
                  Limpar
                </button>
              </div>
            )}
          </div>

          {result && n > 0 && (
            <div className="card max-w-3xl mt-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold text-gray-900">
                  Alunos Importados ({n})
                </h3>
                <button onClick={() => setShowPreview(v => !v)} className="btn btn-sm btn-secondary">
                  {showPreview ? 'Ocultar prévia' : 'Prévia do cartão'}
                </button>
              </div>
              <div className="overflow-y-auto max-h-96 border border-gray-100 rounded-lg">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white shadow-[0_1px_0_0_#e5e7eb]">
                    <tr>
                      <th className="py-2 px-3 text-left font-medium text-gray-500 w-12">#</th>
                      {result.identifierColumnLabel && (
                        <th className="py-2 px-3 text-left font-medium text-gray-500">Identificação</th>
                      )}
                      <th className="py-2 px-3 text-left font-medium text-gray-500">Nome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s) => (
                      <tr key={s.seq} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-1.5 px-3 text-gray-400">{s.seq}</td>
                        {result.identifierColumnLabel && (
                          <td className="py-1.5 px-3 text-gray-500">{s.identifier ?? '—'}</td>
                        )}
                        <td className="py-1.5 px-3 text-gray-900">{s.name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Os IDs internos e os códigos únicos (QR) são gerados pelo servidor durante a gravação no banco.
              </p>

              {showPreview && activeExam && students[0] && (
                <>
                  <div className="mt-4 bg-gray-200 p-4 rounded-xl overflow-auto flex justify-center">
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
                  <p className="text-xs text-gray-400 mt-2 text-center">
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
