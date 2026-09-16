import { useState, useCallback } from 'react';
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

interface Props {
  examId: string | null;
  onNavigate: (view: AppView, examId?: string) => void;
}

const STATUS_LABEL: Record<GabaritosListResult['gabaritos'][number]['status'], { label: string; cls: string }> = {
  gerado: { label: 'Pendente', cls: 'bg-gray-100 text-gray-600' },
  lido: { label: 'Lido', cls: 'bg-blue-50 text-blue-700' },
  corrigido: { label: 'Corrigido', cls: 'bg-emerald-50 text-emerald-700' },
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
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Gerenciar Avaliação</h1>
      <p className="text-gray-500 mb-6">
        Alunos persistidos, gabaritos gerados e status de correção — dados do banco do servidor
      </p>

      <div className="card max-w-3xl mb-6">
        <label className="label">Selecione a Prova</label>
        {exams.length === 0 ? (
          <div className="text-sm text-gray-500">
            <p>Nenhuma prova cadastrada.</p>
            <button onClick={() => onNavigate('new-exam')} className="btn btn-primary btn-sm mt-2">Criar Prova</button>
          </div>
        ) : (
          <div className="flex gap-2">
            <select
              className="input"
              value={selectedExamId}
              onChange={(e) => handleSelect(e.target.value)}
            >
              <option value="">Selecione...</option>
              {exams.map(x => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </select>
            {selectedExamId && (
              <button onClick={load} disabled={loading} className="btn btn-secondary whitespace-nowrap">
                Atualizar
              </button>
            )}
          </div>
        )}

        {loading && <p className="text-sm text-gray-400 mt-3">Consultando o banco de dados...</p>}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm mt-3">{error}</div>
        )}
      </div>

      {data && (
        <>
          <div className="card max-w-3xl mb-4">
            <h2 className="text-lg font-semibold text-gray-900">{data.avaliacao.titulo}</h2>
            {data.avaliacao.turma && <p className="text-sm text-gray-500">Turma: {data.avaliacao.turma}</p>}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6 max-w-5xl">
            <div className="card p-4 text-center !p-4">
              <p className="text-2xl font-bold text-blue-600">{data.stats.alunos_cadastrados}</p>
              <p className="text-xs text-gray-500 mt-1">Alunos cadastrados</p>
            </div>
            <div className="card p-4 text-center !p-4">
              <p className="text-2xl font-bold text-indigo-600">{data.stats.gabaritos_gerados}</p>
              <p className="text-xs text-gray-500 mt-1">Gabaritos gerados</p>
            </div>
            <div className="card p-4 text-center !p-4">
              <p className="text-2xl font-bold text-sky-600">{data.stats.gabaritos_lidos}</p>
              <p className="text-xs text-gray-500 mt-1">Lidos</p>
            </div>
            <div className="card p-4 text-center !p-4">
              <p className="text-2xl font-bold text-emerald-600">{data.stats.gabaritos_corrigidos}</p>
              <p className="text-xs text-gray-500 mt-1">Corrigidos</p>
            </div>
            <div className="card p-4 text-center !p-4">
              <p className="text-2xl font-bold text-amber-600">{data.stats.pendentes}</p>
              <p className="text-xs text-gray-500 mt-1">Pendentes</p>
            </div>
          </div>

          {data.stats.alunos_cadastrados > data.stats.gabaritos_gerados && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm mb-4 max-w-5xl">
              {data.stats.alunos_cadastrados - data.stats.gabaritos_gerados} aluno(s) ainda
              {' '}não possuem gabarito gerado. Use <strong>&quot;Gerar Gabaritos em PDF&quot;</strong> abaixo.
            </div>
          )}

          <div className="card max-w-5xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="py-2 px-3 text-left font-medium text-gray-500">Aluno</th>
                  <th className="py-2 px-3 text-left font-medium text-gray-500">Matrícula</th>
                  <th className="py-2 px-3 text-left font-medium text-gray-500">ID interno</th>
                  <th className="py-2 px-3 text-left font-medium text-gray-500">Gabarito (QR)</th>
                  <th className="py-2 px-3 text-center font-medium text-gray-500">Pág.</th>
                  <th className="py-2 px-3 text-center font-medium text-gray-500">QR Code</th>
                  <th className="py-2 px-3 text-center font-medium text-gray-500">Status</th>
                  <th className="py-2 px-3 text-center font-medium text-gray-500">Nota</th>
                  <th className="py-2 px-3 text-center font-medium text-gray-500">Ações</th>
                </tr>
              </thead>
              <tbody>
                {data.gabaritos.map(g => {
                  const st = STATUS_LABEL[g.status];
                  return (
                    <tr key={g.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 px-3 font-medium text-gray-900">{g.aluno.nome}</td>
                      <td className="py-2 px-3 text-gray-500">{g.aluno.matricula ?? '—'}</td>
                      <td className="py-2 px-3 text-gray-400">#{g.aluno.id}</td>
                      <td className="py-2 px-3 font-mono text-xs text-blue-600">{g.codigo_unico}</td>
                      <td className="py-2 px-3 text-center text-gray-400">{g.numero_pagina}</td>
                      <td className="py-2 px-3 text-center">
                        <span className="text-emerald-600" title={`Payload: ${g.qr_code_payload}`}>✓</span>
                      </td>
                      <td className="py-2 px-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.cls}`}>{st.label}</span>
                      </td>
                      <td className="py-2 px-3 text-center font-bold text-gray-700">
                        {g.nota != null ? g.nota : '—'}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <button
                          onClick={() => handleDeleteAluno(g)}
                          className="btn btn-sm btn-danger"
                          title="Apagar este aluno e seu gabarito do banco"
                        >
                          Apagar
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {data.gabaritos.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-gray-400 text-sm">
                      Nenhum gabarito gerado para esta avaliação ainda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-3 mt-4 max-w-5xl">
            <button onClick={() => onNavigate('correct-card', data.avaliacao.external_id)} className="btn btn-primary">
              Corrigir Cartões
            </button>
            <button onClick={() => onNavigate('import-students', data.avaliacao.external_id)} className="btn btn-secondary">
              Importar Mais Alunos
            </button>
            <button
              onClick={handleGeneratePdf}
              disabled={generatingPdf || data.stats.alunos_cadastrados === 0}
              className="btn btn-success"
              title={
                data.stats.alunos_cadastrados === 0
                  ? 'Importe alunos primeiro'
                  : 'Gera gabaritos para alunos sem gabarito e baixa o PDF completo (reimpressão mantém os mesmos QR Codes)'
              }
            >
              {generatingPdf ? (
                <>
                  <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                  Gerando...
                </>
              ) : (
                <>
                  Gerar {data.stats.alunos_cadastrados} Gabarito{data.stats.alunos_cadastrados !== 1 ? 's' : ''} em PDF
                </>
              )}
            </button>
            <button
              onClick={handleReset}
              disabled={data.stats.alunos_cadastrados === 0}
              className="btn btn-danger ml-auto"
            >
              Resetar Avaliação
            </button>
          </div>
        </>
      )}
    </div>
  );
}
