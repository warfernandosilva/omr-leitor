import { useState, useCallback } from 'react';
import { Download, FileUp, RefreshCw, ScanLine, Trash2, TriangleAlert } from 'lucide-react';
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

const STATUS_TONE: Record<GabaritosListResult['gabaritos'][number]['status'], { label: string; tone: 'neutral' | 'info' | 'success' }> = {
  gerado: { label: 'Pendente', tone: 'neutral' },
  lido: { label: 'Lido', tone: 'info' },
  corrigido: { label: 'Corrigido', tone: 'success' },
};

export default function ManageExamPage({ examId, onNavigate }: Props) {
  const { user } = useAuth();
  const userId = user?.id;
  const exams = getExams(userId);
  const [selectedExamId, setSelectedExamId] = useState(examId || '');
  const [data, setData] = useState<GabaritosListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);

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
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Gerenciar avaliação"
        subtitle="Alunos persistidos, gabaritos gerados e status de correção — dados do banco do servidor"
      />

      <div className="card max-w-3xl">
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

        {loading && <p className="text-sm text-gray-400 dark:text-gray-500 mt-3" role="status">Consultando o banco de dados...</p>}
        {error && <div className="callout-danger mt-3">{error}</div>}
      </div>

      {data && (
        <>
          <div className="card max-w-3xl">
            <h2 className="text-lg font-semibold text-ink dark:text-white">{data.avaliacao.titulo}</h2>
            {data.avaliacao.turma && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                Turma: <Badge tone="success">{data.avaliacao.turma}</Badge>
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 max-w-5xl">
            <StatCard label="Alunos cadastrados" value={data.stats.alunos_cadastrados} tone="info" />
            <StatCard label="Gabaritos gerados" value={data.stats.gabaritos_gerados} />
            <StatCard label="Lidos" value={data.stats.gabaritos_lidos} tone="info" />
            <StatCard label="Corrigidos" value={data.stats.gabaritos_corrigidos} tone="success" />
            <StatCard label="Pendentes" value={data.stats.pendentes} tone={data.stats.pendentes > 0 ? 'warning' : 'default'} />
          </div>

          {data.stats.alunos_cadastrados > data.stats.gabaritos_gerados && (
            <div className="callout-warning max-w-5xl">
              {data.stats.alunos_cadastrados - data.stats.gabaritos_gerados} aluno(s) ainda
              {' '}não possuem gabarito gerado. Use <strong>&quot;Gerar gabaritos em PDF&quot;</strong> abaixo.
            </div>
          )}

          <div className="card max-w-5xl">
            <DataTable
              rows={data.gabaritos}
              rowKey={(g) => String(g.id)}
              empty="Nenhum gabarito gerado para esta avaliação ainda."
              columns={[
                { key: 'aluno', header: 'Aluno', render: (g) => <span className="font-medium text-ink dark:text-gray-100">{g.aluno.nome}</span> },
                { key: 'mat', header: 'Matrícula', render: (g) => <span className="text-gray-500 dark:text-gray-400">{g.aluno.matricula ?? '—'}</span> },
                { key: 'id', header: 'ID interno', render: (g) => <span className="text-gray-400 dark:text-gray-500">#{g.aluno.id}</span> },
                { key: 'qr', header: 'Gabarito (QR)', render: (g) => <span className="font-mono text-xs text-brand-600 dark:text-brand-200">{g.codigo_unico}</span> },
                { key: 'pag', header: 'Pág.', className: 'text-center', render: (g) => <span className="text-gray-400 dark:text-gray-500">{g.numero_pagina}</span> },
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

          <div className="flex flex-wrap gap-2 max-w-5xl">
            <Button onClick={() => onNavigate('correct-card', data.avaliacao.external_id)} icon={<ScanLine size={16} aria-hidden />}>
              Corrigir cartões
            </Button>
            <Button variant="secondary" onClick={() => onNavigate('import-students', data.avaliacao.external_id)} icon={<FileUp size={16} aria-hidden />}>
              Importar mais alunos
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
