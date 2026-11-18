import { useState, useCallback, useEffect, useMemo } from 'react';
import { ClipboardList, Download, FileUp, RefreshCw, ScanLine, Search, Trash2, TriangleAlert } from 'lucide-react';
import { AppView } from '../types';
import { getExams } from '../utils/storage';
import {
  fetchGabaritos, checkHealth,
  resetExam, deleteAluno,
  generateGabaritos, generateGabaritosPDF,
  GabaritosListResult, GabaritoInfo,
} from '../utils/api';
import { countPdfPages } from '../utils/students';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/ui/PageHeader';
import Field from '../components/ui/Field';
import Select from '../components/ui/Select';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import StatCard from '../components/ui/StatCard';
import DataTable from '../components/ui/DataTable';
import EmptyState from '../components/ui/EmptyState';

interface Props {
  examId: string | null;
  onNavigate: (view: AppView, examId?: string) => void;
}

const STATUS_TONE: Record<GabaritosListResult['gabaritos'][number]['status'], { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' }> = {
  gerado: { label: 'Sem leitura', tone: 'warning' },
  lido: { label: 'Lido · falta nota', tone: 'info' },
  corrigido: { label: 'Corrigido', tone: 'success' },
};

/** "Falta corrigir" = cartão gerado que ainda não tem nota (sem leitura ou só lido). */
function faltaCorrigir(status: GabaritosListResult['gabaritos'][number]['status']): boolean {
  return status !== 'corrigido';
}

export default function ManageExamPage({ examId, onNavigate }: Props) {
  const { user } = useAuth();
  const userId = user?.id;
  const exams = getExams(userId);
  const [selectedExamId, setSelectedExamId] = useState(examId || '');
  const [data, setData] = useState<GabaritosListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [filtro, setFiltro] = useState<'todos' | 'falta' | 'corrigidos'>('todos');
  const [busca, setBusca] = useState('');

  /** Contagens reais de "quem falta corrigir" (fonte: os próprios gabaritos). */
  const contagem = useMemo(() => {
    const todos = data?.gabaritos ?? [];
    return {
      todos: todos.length,
      falta: todos.filter(g => faltaCorrigir(g.status)).length,
      corrigidos: todos.filter(g => g.status === 'corrigido').length,
    };
  }, [data]);

  /** Lista exibida: filtro de status + busca por aluno/matrícula/QR. */
  const linhas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (data?.gabaritos ?? []).filter(g => {
      if (filtro === 'falta' && !faltaCorrigir(g.status)) return false;
      if (filtro === 'corrigidos' && g.status !== 'corrigido') return false;
      if (!q) return true;
      return g.aluno.nome.toLowerCase().includes(q)
        || (g.aluno.matricula ?? '').toLowerCase().includes(q)
        || g.codigo_unico.toLowerCase().includes(q);
    });
  }, [data, filtro, busca]);

  const load = useCallback(async () => {
    if (!selectedExamId) return;
    setLoading(true);
    setError(null);
    try {
      if (!(await checkHealth())) {
        throw new Error('Backend Python indisponível — inicie-o com start-omr.bat.');
      }
      setData(await fetchGabaritos(selectedExamId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao consultar gabaritos.');
    } finally {
      setLoading(false);
    }
  }, [selectedExamId]);

  // Abrir a tela por um link (busca global, central de avaliações, "ver quem
  // falta") já traz a prova selecionada — sem isso a página nascia vazia e o
  // usuário tinha que clicar em "Atualizar" para ver qualquer número.
  useEffect(() => {
    if (selectedExamId && !data) void load();
  }, [selectedExamId, data, load]);

  const handleSelect = (id: string) => {
    setSelectedExamId(id);
    setData(null);
    setError(null);
  };

  const handleReset = async () => {
    if (!confirm('Resetar a avaliação? Apaga TODOS os alunos e gabaritos (incluindo resultados).')) return;
    try {
      await resetExam(selectedExamId);
      setData(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao resetar a avaliação.');
    }
  };

  const handleDeleteAluno = async (g: GabaritoInfo) => {
    if (!confirm(`Apagar o aluno "${g.aluno.nome}" (${g.codigo_unico})? O gabarito e o resultado serão removidos.`)) return;
    try {
      await deleteAluno(g.aluno.id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao apagar aluno');
    }
  };

  const handleGeneratePdf = async () => {
    if (!selectedExamId) return;
    setGeneratingPdf(true);
    setError(null);
    try {
      const gen = await generateGabaritos(selectedExamId);
      const blob = await generateGabaritosPDF(selectedExamId);
      const pdfText = await blob.text();
      const pages = countPdfPages(pdfText);
      if (pages !== gen.total_gabaritos) {
        throw new Error(`Validação falhou: ${gen.total_gabaritos} gabaritos, ${pages} páginas.`);
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const slug = exams.find(e => e.id === selectedExamId)?.name.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '') || 'prova';
      a.href = url;
      a.download = `gabaritos_${slug}_${gen.total_gabaritos}_paginas.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao gerar PDF');
    } finally {
      setGeneratingPdf(false);
    }
  };

  return (
    <div className="app-section animate-fade-in">
      <PageHeader
        title="Alunos e notas por prova"
        subtitle="Quem tem cartão, quem já foi corrigido e quem ainda falta — dados do banco do servidor"
      />

      <div className="card w-full max-w-6xl">
        <Field label="Selecione a prova" htmlFor="manage-exam-select">
          {exams.length === 0 ? (
            <EmptyState
              title="Nenhuma prova cadastrada"
              action={<Button size="sm" onClick={() => onNavigate('new-exam')}>Criar prova</Button>}
            />
          ) : (
            <div className="flex gap-2">
              <Select
                id="manage-exam-select"
                value={selectedExamId}
                onChange={(e) => handleSelect(e.target.value)}
              >
                <option value="">Selecione...</option>
                {exams.map(x => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </Select>
              {selectedExamId && (
                <Button variant="secondary" onClick={load} loading={loading} icon={<RefreshCw size={15} aria-hidden />} className="whitespace-nowrap">
                  Atualizar
                </Button>
              )}
            </div>
          )}
        </Field>

        {loading && <p className="text-sm text-gray-500 dark:text-gray-400 mt-3" role="status">Consultando o banco de dados...</p>}
        {error && <div className="callout-danger mt-3">{error}</div>}
      </div>

      {data && (
        <>
          <div className="card w-full">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider text-[#71809A] dark:text-gray-400">Avaliação</p>
                <h2 className="text-lg font-semibold text-[#172B4D] dark:text-white truncate">{data.avaliacao.titulo}</h2>
              </div>
              {data.avaliacao.turma && <Badge tone="success">{data.avaliacao.turma}</Badge>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatCard label="Alunos cadastrados" value={data.stats.alunos_cadastrados} tone="info" />
            <StatCard label="Gabaritos gerados" value={data.stats.gabaritos_gerados} />
            <StatCard label="Lidos" value={data.stats.gabaritos_lidos} tone="info" />
            <StatCard label="Corrigidos" value={data.stats.gabaritos_corrigidos} tone="success" />
            <StatCard label="Falta corrigir" value={contagem.falta} tone={contagem.falta > 0 ? 'warning' : 'default'} hint={contagem.falta > 0 ? 'cartões sem nota' : 'todos corrigidos'} />
          </div>

          {data.stats.alunos_cadastrados > data.stats.gabaritos_gerados && (
            <div className="callout-warning">
              {data.stats.alunos_cadastrados - data.stats.gabaritos_gerados} aluno(s) ainda
              {' '}não possuem gabarito gerado. Use <strong>&quot;Gerar gabaritos em PDF&quot;</strong> abaixo.
            </div>
          )}

          {/* ─── Quem ainda falta corrigir ─── */}
          <div className="card w-full">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-[10px] bg-brand-50 dark:bg-brand-700/20 flex items-center justify-center text-brand-600 dark:text-brand-200 shrink-0" aria-hidden>
                  <ClipboardList size={16} />
                </span>
                <div>
                  <h3 className="font-semibold text-[#172B4D] dark:text-white">
                    {filtro === 'falta' ? 'Quem ainda falta corrigir' : 'Participantes da avaliação'}
                  </h3>
                  <p className="text-xs text-[#71809A] dark:text-gray-400">
                    {filtro === 'falta'
                      ? `${contagem.falta} cartão(ões) gerado(s) ainda sem nota`
                      : `${contagem.todos} cartão(ões) · ${contagem.corrigidos} corrigido(s)`}
                  </p>
                </div>
              </div>
              {contagem.falta > 0 && (
                <Button size="sm" onClick={() => onNavigate('correct-card', data.avaliacao.external_id)} icon={<ScanLine size={15} aria-hidden />}>
                  Corrigir os {contagem.falta} que faltam
                </Button>
              )}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex flex-wrap gap-2">
                {([
                  { id: 'todos', label: `Todos (${contagem.todos})` },
                  { id: 'falta', label: `Falta corrigir (${contagem.falta})` },
                  { id: 'corrigidos', label: `Corrigidos (${contagem.corrigidos})` },
                ] as const).map(op => (
                  <button
                    key={op.id}
                    onClick={() => setFiltro(op.id)}
                    aria-pressed={filtro === op.id}
                    className={`px-3 py-1.5 rounded-[8px] text-xs font-medium border transition-colors ${
                      filtro === op.id
                        ? 'bg-brand-500 text-white border-brand-500'
                        : 'bg-white text-[#71809A] border-line hover:text-brand-600 dark:bg-gray-900 dark:border-gray-800 dark:text-gray-400'
                    }`}
                  >
                    {op.label}
                  </button>
                ))}
              </div>
              <div className="relative sm:ml-auto sm:w-64">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#71809A] pointer-events-none" aria-hidden />
                <input
                  type="search"
                  aria-label="Buscar aluno, matrícula ou QR"
                  placeholder="Buscar aluno, matrícula ou QR..."
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                  className="input !pl-9"
                />
              </div>
            </div>
          </div>

          <div className="table-shell">
            <DataTable
              rows={linhas}
              rowKey={(g) => String(g.id)}
              pageSize={25}
              minWidth={900}
              ariaLabel={filtro === 'falta' ? 'Alunos que ainda falta corrigir' : 'Tabela de participantes da avaliação'}
              empty={contagem.todos === 0
                ? 'Nenhum gabarito gerado para esta avaliação ainda.'
                : filtro === 'falta'
                  ? 'Nenhum cartão sem nota: todos os participantes já foram corrigidos.'
                  : 'Nenhum participante encontrado com este filtro/busca.'}
              mobileCard={(g) => {
                const st = STATUS_TONE[g.status];
                return (
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-[#172B4D] dark:text-gray-100 truncate">{g.aluno.nome}</p>
                        <p className="text-xs text-[#71809A] dark:text-gray-400 truncate">
                          {g.aluno.matricula ?? 'sem matrícula'} · #{g.aluno.id}
                        </p>
                        <p className="text-xs text-brand-600 dark:text-brand-200 font-mono mt-1">{g.codigo_unico}</p>
                      </div>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-[#71809A] dark:text-gray-400">Página {g.numero_pagina}</span>
                      <span className="text-sm font-bold text-[#172B4D] dark:text-white">Nota {g.nota ?? '—'}</span>
                    </div>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleDeleteAluno(g)}
                      icon={<Trash2 size={14} aria-hidden />}
                      className="w-full"
                    >
                      Apagar aluno e gabarito
                    </Button>
                  </div>
                );
              }}
              columns={[
                { key: 'aluno', header: 'Aluno', render: (g) => <span className="font-medium text-ink dark:text-gray-100">{g.aluno.nome}</span> },
                { key: 'mat', header: 'Matrícula', render: (g) => <span className="text-gray-500 dark:text-gray-400">{g.aluno.matricula ?? '—'}</span> },
                { key: 'id', header: 'ID interno', render: (g) => <span className="text-gray-500 dark:text-gray-400">#{g.aluno.id}</span> },
                { key: 'qr', header: 'Gabarito (QR)', render: (g) => <span className="font-mono text-xs text-brand-600 dark:text-brand-200">{g.codigo_unico}</span> },
                { key: 'pag', header: 'Pág.', className: 'text-center', render: (g) => <span className="text-gray-500 dark:text-gray-400">{g.numero_pagina}</span> },
                {
                  key: 'qrok', header: 'QR Code', className: 'text-center',
                  render: (g) => <span className="text-success-600 dark:text-success-100 font-bold" title={`Payload: ${g.qr_code_payload}`} aria-label="QR válido">✓</span>,
                },
                {
                  key: 'status', header: 'Status', className: 'text-center',
                  render: (g) => { const st = STATUS_TONE[g.status]; return <Badge tone={st.tone}>{st.label}</Badge>; },
                },
                {
                  key: 'nota', header: 'Nota', className: 'text-center',
                  render: (g) => <span className="font-bold text-ink dark:text-gray-100">{g.nota != null ? g.nota : '—'}</span>,
                },
                {
                  key: 'act', header: 'Ações', className: 'text-center',
                  render: (g) => (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleDeleteAluno(g)}
                      icon={<Trash2 size={14} aria-hidden />}
                      title="Apagar este aluno e seu gabarito do banco"
                    >
                      Apagar
                    </Button>
                  ),
                },
              ]}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => onNavigate('correct-card', data.avaliacao.external_id)} icon={<ScanLine size={16} aria-hidden />}>
              Corrigir cartões
            </Button>
            <Button variant="secondary" onClick={() => onNavigate('import-students', data.avaliacao.external_id)} icon={<FileUp size={16} aria-hidden />}>
              Cartões por lista da prova
            </Button>
            <Button
              variant="success"
              onClick={handleGeneratePdf}
              loading={generatingPdf}
              disabled={data.stats.alunos_cadastrados === 0}
              icon={<Download size={16} aria-hidden />}
              title={
                data.stats.alunos_cadastrados === 0
                  ? 'Importe alunos primeiro'
                  : 'Gera gabaritos para alunos sem gabarito e baixa o PDF completo (reimpressão mantém os mesmos QR Codes)'
              }
            >
              Gerar {data.stats.alunos_cadastrados} gabarito{data.stats.alunos_cadastrados !== 1 ? 's' : ''} em PDF
            </Button>
            <Button
              variant="danger"
              onClick={handleReset}
              disabled={data.stats.alunos_cadastrados === 0}
              icon={<TriangleAlert size={16} aria-hidden />}
              className="sm:ml-auto"
            >
              Resetar avaliação
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
