import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Archive, BarChart3, ClipboardList, Download, FilePlus2, GraduationCap, Pencil, Plus,
  RefreshCw, Search, Trash2, Upload, UserPlus, Users,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import type { AppView } from '../types';
import { getExams, getResults } from '../utils/storage';
import { importStudents } from '../utils/students';
import {
  listTurmas, createTurma, getTurma, renameTurma, deleteTurma, updateTurma,
  listTurmasPorArquivo,
  importTurmaAlunos, addTurmaAluno, removeTurmaAluno, saveBlob,
  type TurmaDTO, type TurmaDetail,
} from '../utils/api';
import PageHeader from '../components/ui/PageHeader';
import Field from '../components/ui/Field';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import Card from '../components/ui/Card';
import StatCard from '../components/ui/StatCard';
import Tabs from '../components/ui/Tabs';
import DataTable from '../components/ui/DataTable';
import { useAuth } from '../context/AuthContext';

interface Props {
  onNavigate: (view: AppView, examId?: string, resultId?: string) => void;
}

type DetailTab = 'visao' | 'alunos' | 'avaliacoes' | 'resultados';

/** Gera a planilha-modelo (Nome + Matrícula) para download. */
function downloadTemplate() {
  const ws = XLSX.utils.json_to_sheet([
    { 'Nome': 'Ana Beatriz Lima', 'Matrícula': '0012' },
    { 'Nome': 'Bruno Henrique Silva', 'Matrícula': '0013' },
  ]);
  ws['!cols'] = [{ wch: 28 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Alunos');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  saveBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'modelo-alunos.xlsx');
}

export default function TurmasPage({ onNavigate }: Props) {
  const { user } = useAuth();
  const [turmas, setTurmas] = useState<TurmaDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<TurmaDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualMat, setManualMat] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgError, setMsgError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<DetailTab>('visao');
  const [mostrarArquivadas, setMostrarArquivadas] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setTurmas(await listTurmasPorArquivo(mostrarArquivadas ? 'all' : 'false'));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Falha ao listar turmas.');
    } finally {
      setLoading(false);
    }
  }, [mostrarArquivadas]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const select = async (id: number) => {
    setSelectedId(id);
    setDetail(null);
    setDetailError(null);
    setRenaming(false);
    setTab('visao');
    try {
      const d = await getTurma(id);
      setDetail(d);
      setRenameValue(d.nome);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Falha ao carregar a turma.');
    }
  };

  const refreshDetail = async (id: number) => {
    const d = await getTurma(id);
    setDetail(d);
    setTurmas(await listTurmas());
  };

  const handleCreate = async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    setMsg(null);
    setMsgError(null);
    try {
      const t = await createTurma(newName.trim());
      setNewName('');
      await refresh();
      await select(t.id);
    } catch (err) {
      setMsgError(err instanceof Error ? err.message : 'Falha ao criar a turma.');
    } finally {
      setCreating(false);
    }
  };

  const handleRename = async () => {
    if (selectedId == null || !renameValue.trim()) return;
    setBusy(true);
    setMsg(null);
    setMsgError(null);
    try {
      await renameTurma(selectedId, renameValue.trim());
      setRenaming(false);
      await refreshDetail(selectedId);
    } catch (err) {
      setMsgError(err instanceof Error ? err.message : 'Falha ao renomear.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveAnoLetivo = async (ano: string) => {
    if (selectedId == null) return;
    setBusy(true);
    setMsgError(null);
    try {
      await updateTurma(selectedId, { ano_letivo: ano.trim() || null });
      await refreshDetail(selectedId);
      setMsg(`Ano letivo ${ano.trim() || 'removido'} salvo.`);
    } catch (err) {
      setMsgError(err instanceof Error ? err.message : 'Falha ao salvar o ano letivo.');
    } finally {
      setBusy(false);
    }
  };

  const handleArquivar = async (arquivar: boolean) => {
    if (selectedId == null) return;
    const acao = arquivar ? 'arquivar' : 'reativar';
    if (!confirm(`${arquivar ? 'Arquivar' : 'Reativar'} a turma "${detail?.nome}"? As provas e resultados já gerados permanecem consultáveis.`)) return;
    setBusy(true);
    setMsgError(null);
    try {
      await updateTurma(selectedId, { arquivada: arquivar });
      setSelectedId(null);
      setDetail(null);
      await refresh();
      setMsg(`Turma ${acao === 'arquivar' ? 'arquivada' : 'reativada'}.`);
    } catch (err) {
      setMsgError(err instanceof Error ? err.message : `Falha ao ${acao} a turma.`);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (selectedId == null) return;
    if (!confirm(`Apagar a turma "${detail?.nome}" e sua lista do catálogo? As provas já geradas NÃO são afetadas.`)) return;
    setBusy(true);
    try {
      await deleteTurma(selectedId);
      setSelectedId(null);
      setDetail(null);
      await refresh();
    } catch (err) {
      setMsgError(err instanceof Error ? err.message : 'Falha ao apagar.');
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || selectedId == null) return;
    setBusy(true);
    setMsg(null);
    setMsgError(null);
    try {
      const parsed = await importStudents(file);
      if (parsed.students.length === 0) {
        throw new Error('Nenhum aluno válido encontrado no arquivo.');
      }
      const r = await importTurmaAlunos(
        selectedId,
        parsed.students.map(s => ({ nome: s.name, matricula: s.identifier ?? null })),
      );
      setMsg(
        `Lista atualizada: +${r.criados} novo(s), ${r.atualizados} atualizado(s) por matrícula` +
        (r.ignorados > 0 ? `, ${r.ignorados} linha(s) ignorada(s)` : '') +
        `. Total: ${r.total_alunos} aluno(s).`,
      );
      await refreshDetail(selectedId);
    } catch (err) {
      setMsgError(err instanceof Error ? err.message : 'Não foi possível importar o arquivo.');
    } finally {
      setBusy(false);
    }
  };

  const handleAddManual = async () => {
    if (selectedId == null || !manualName.trim()) return;
    setBusy(true);
    setMsg(null);
    setMsgError(null);
    try {
      await addTurmaAluno(selectedId, { nome: manualName.trim(), matricula: manualMat.trim() || null });
      setManualName('');
      setManualMat('');
      await refreshDetail(selectedId);
    } catch (err) {
      setMsgError(err instanceof Error ? err.message : 'Falha ao adicionar aluno.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveAluno = async (alunoId: number, nome: string) => {
    if (selectedId == null) return;
    if (!confirm(`Remover "${nome}" do catálogo? As provas já geradas NÃO são afetadas.`)) return;
    setBusy(true);
    try {
      await removeTurmaAluno(selectedId, alunoId);
      await refreshDetail(selectedId);
    } catch (err) {
      setMsgError(err instanceof Error ? err.message : 'Falha ao remover aluno.');
    } finally {
      setBusy(false);
    }
  };

  const norm = q.trim().toLowerCase();
  const filtered = useMemo(
    () => (norm ? turmas.filter(t => t.nome.toLowerCase().includes(norm)) : turmas),
    [turmas, norm],
  );
  const exams = getExams(user?.id);
  const results = getResults(undefined, user?.id);
  const turmaExams = useMemo(
    () => (selectedId == null ? [] : exams.filter(e => e.turmaId === selectedId)),
    [exams, selectedId],
  );
  const turmaResults = useMemo(
    () => (selectedId == null
      ? []
      : results.filter(r => turmaExams.some(e => e.id === r.examId))),
    [results, turmaExams, selectedId],
  );
  const avg = turmaResults.length
    ? (turmaResults.reduce((acc, r) => acc + r.grade, 0) / turmaResults.length).toFixed(1)
    : '—';

  return (
    <div className="app-section animate-fade-in">
      <PageHeader
        title="Turmas"
        subtitle="Catálogo reutilizável: cadastre a lista uma vez e gere os gabaritos de qualquer prova sem reenviar planilha"
        actions={<Button variant="secondary" icon={<RefreshCw size={16} aria-hidden />} onClick={refresh}>Atualizar</Button>}
      />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="flex flex-col gap-4">
          <div className="section-header">
            <div className="relative w-full max-w-sm">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#71809A] pointer-events-none" aria-hidden />
              <Input
                type="search"
                aria-label="Buscar turma"
                placeholder="Buscar turma..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="!pl-9"
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-[#71809A] dark:text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={mostrarArquivadas}
                  onChange={e => setMostrarArquivadas(e.target.checked)}
                />
                Ver arquivadas
              </label>
              <span className="text-xs text-[#71809A] dark:text-gray-400">{filtered.length} turma(s)</span>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-[#71809A] dark:text-gray-400" role="status">Carregando turmas...</p>
          ) : loadError ? (
            <div className="callout-danger">
              {loadError}
              <div className="mt-2"><Button variant="secondary" size="sm" onClick={refresh}>Tentar de novo</Button></div>
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              title={norm ? 'Nenhuma turma encontrada' : 'Nenhuma turma cadastrada'}
              description={norm ? 'Ajuste a busca ou cadastre uma nova turma.' : 'Crie a primeira turma e importe a lista de alunos.'}
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((t) => {
                const active = selectedId === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => select(t.id)}
                    className={`panel text-left transition-all duration-200 min-h-[44px] ${active
                      ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-700/15 dark:border-brand-400'
                      : 'card-hover'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-[#172B4D] dark:text-white truncate">{t.nome}</p>
                        <p className="text-sm text-[#71809A] dark:text-gray-400 mt-0.5">
                          {t.total_alunos} aluno{t.total_alunos === 1 ? '' : 's'}
                          {t.ano_letivo ? ` · ${t.ano_letivo}` : ''}
                        </p>
                        {t.arquivada && <Badge tone="neutral">Arquivada</Badge>}
                      </div>
                      <span className="w-9 h-9 rounded-[10px] bg-brand-50 dark:bg-brand-700/20 flex items-center justify-center text-brand-600 dark:text-brand-200 shrink-0" aria-hidden>
                        <GraduationCap size={18} />
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <Field label="Nova turma" htmlFor="turma-new-name">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="turma-new-name"
                type="text"
                placeholder="Ex: 9º A"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              />
              <Button onClick={handleCreate} loading={creating} disabled={!newName.trim()} icon={<Plus size={16} aria-hidden />}>
                Criar
              </Button>
            </div>
          </Field>
          <p className="field-helper">
            O catálogo de turmas é reutilizável: importe uma vez e use em qualquer prova.
          </p>
        </Card>
      </div>

      {detailError && <div className="callout-danger">{detailError}</div>}

      {detail && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card noPad className="overflow-hidden">
            <div className="border-b border-line p-4 dark:border-gray-800 sm:p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                {renaming ? (
                  <div className="flex flex-1 flex-col gap-2 sm:flex-row">
                    <Input
                      type="text"
                      aria-label="Novo nome da turma"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleRename} loading={busy} disabled={!renameValue.trim()}>Salvar</Button>
                      <Button size="sm" variant="secondary" onClick={() => setRenaming(false)}>Cancelar</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-wider text-[#71809A] dark:text-gray-400">Turma selecionada</p>
                      <h2 className="text-xl font-bold text-[#172B4D] dark:text-white truncate">{detail.nome}</h2>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setRenaming(true)} icon={<Pencil size={14} aria-hidden />}>Renomear</Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={busy}
                        onClick={() => handleArquivar(true)}
                        icon={<Archive size={14} aria-hidden />}
                      >
                        Arquivar
                      </Button>
                      <Button size="sm" variant="danger" onClick={handleDelete} loading={busy} icon={<Trash2 size={14} aria-hidden />}>Apagar turma</Button>
                    </div>
                  </>
                )}
              </div>
              <div className="mt-4">
                <Tabs
                  ariaLabel="Detalhes da turma"
                  active={tab}
                  onChange={(id) => setTab(id as DetailTab)}
                  tabs={[
                    { id: 'visao', label: 'Visão geral' },
                    { id: 'alunos', label: 'Alunos', badge: detail.alunos.length },
                    { id: 'avaliacoes', label: 'Avaliações', badge: turmaExams.length },
                    { id: 'resultados', label: 'Resultados', badge: turmaResults.length },
                  ]}
                />
              </div>
            </div>

            {msg && <div className="m-4 callout-success sm:m-5">{msg}</div>}
            {msgError && <div className="m-4 callout-danger sm:m-5">{msgError}</div>}

            <div className="p-4 sm:p-5">
              {tab === 'visao' && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <StatCard label="Alunos" value={detail.alunos.length} tone="info" icon={<Users size={18} aria-hidden />} />
                  <StatCard label="Avaliações vinculadas" value={turmaExams.length} tone="info" icon={<ClipboardList size={18} aria-hidden />} />
                  <StatCard label="Cartões corrigidos" value={turmaResults.length} tone="success" icon={<BarChart3 size={18} aria-hidden />} />
                  <StatCard label="Média da turma" value={avg} icon={<BarChart3 size={18} aria-hidden />} />
                </div>
              )}

              {tab === 'alunos' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <Field label="Importar lista (XLSX ou CSV)" helper="Reimportar atualiza quem já tem matrícula e adiciona os novos — sem duplicar.">
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="btn btn-secondary cursor-pointer">
                          <Upload size={15} aria-hidden />
                          Escolher arquivo
                          <input type="file" accept=".xlsx,.xls,.csv,text/csv" className="sr-only" disabled={busy} onChange={handleFile} />
                        </label>
                        <Button variant="ghost" size="sm" onClick={downloadTemplate} icon={<Download size={14} aria-hidden />}>
                          Baixar planilha-modelo
                        </Button>
                      </div>
                    </Field>
                    <Field label="Adicionar aluno manualmente">
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input type="text" aria-label="Nome do aluno" placeholder="Nome do aluno" value={manualName} onChange={(e) => setManualName(e.target.value)} />
                        <Input type="text" aria-label="Matrícula" placeholder="Matrícula" value={manualMat} onChange={(e) => setManualMat(e.target.value)} className="sm:w-36" />
                        <Button variant="secondary" onClick={handleAddManual} loading={busy} disabled={!manualName.trim()} icon={<UserPlus size={15} aria-hidden />} className="whitespace-nowrap">
                          Adicionar
                        </Button>
                      </div>
                    </Field>
                  </div>

                  {detail.alunos.length === 0 ? (
                    <EmptyState
                      title="Nenhum aluno ainda"
                      description="Importe a planilha ou adicione manualmente para usar esta turma nas provas."
                    />
                  ) : (
                    <DataTable
                      rows={detail.alunos}
                      rowKey={(a) => String(a.id)}
                      pageSize={25}
                      minWidth={640}
                      ariaLabel="Alunos da turma"
                      empty="Nenhum aluno cadastrado."
                      mobileCard={(a) => (
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[#172B4D] dark:text-gray-100 truncate">{a.nome}</p>
                            <p className="text-xs text-[#71809A] dark:text-gray-400">{a.matricula || 'sem matrícula'}</p>
                          </div>
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => handleRemoveAluno(a.id, a.nome)}>Remover</Button>
                        </div>
                      )}
                      columns={[
                        { key: 'nome', header: 'Nome', render: (a) => <span className="font-medium text-[#172B4D] dark:text-gray-100">{a.nome}</span> },
                        { key: 'matricula', header: 'Matrícula', render: (a) => <span className="text-[#71809A] dark:text-gray-400">{a.matricula || '—'}</span> },
                        {
                          key: 'acoes', header: 'Ações', className: 'text-right',
                          render: (a) => <Button size="sm" variant="ghost" disabled={busy} onClick={() => handleRemoveAluno(a.id, a.nome)}>Remover</Button>,
                        },
                      ]}
                    />
                  )}
                </div>
              )}

              {tab === 'avaliacoes' && (
                turmaExams.length === 0 ? (
                  <EmptyState
                    title="Nenhuma avaliação vinculada"
                    description="Crie uma prova usando esta turma para acompanhar os cartões."
                    action={<Button onClick={() => onNavigate('new-exam')} icon={<FilePlus2 size={16} aria-hidden />}>Nova prova</Button>}
                  />
                ) : (
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {turmaExams.map((e) => (
                      <div key={e.id} className="panel">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-[#172B4D] dark:text-white truncate">{e.name}</p>
                            <p className="text-sm text-[#71809A] dark:text-gray-400 mt-0.5">
                              {e.totalQuestions} questões · escala {e.gradeScale}
                            </p>
                          </div>
                          <Badge tone={e.answerKey ? 'success' : 'warning'}>
                            {e.answerKey ? 'Gabarito definido' : 'Sem gabarito'}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}

              {tab === 'resultados' && (
                turmaResults.length === 0 ? (
                  <EmptyState
                    title="Nenhum resultado ainda"
                    description="Depois de corrigir os cartões desta turma, os resultados aparecem aqui."
                  />
                ) : (
                  <DataTable
                    rows={[...turmaResults].sort((a, b) => b.timestamp.localeCompare(a.timestamp))}
                    rowKey={(r) => r.id}
                    pageSize={10}
                    minWidth={720}
                    ariaLabel="Resultados da turma"
                    mobileCard={(r) => (
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[#172B4D] dark:text-gray-100 truncate">{r.studentName || '(sem identificação)'}</p>
                          <p className="text-xs text-[#71809A] dark:text-gray-400 truncate">{turmaExams.find(e => e.id === r.examId)?.name ?? 'Prova'}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-brand-600 dark:text-brand-200">{r.grade.toFixed(1)}</span>
                          <Button size="sm" variant="ghost" onClick={() => onNavigate('view-result', r.id)}>Ver</Button>
                        </div>
                      </div>
                    )}
                    columns={[
                      { key: 'aluno', header: 'Aluno', render: (r) => <span className="font-medium text-[#172B4D] dark:text-gray-100">{r.studentName || '(sem identificação)'}</span> },
                      { key: 'prova', header: 'Prova', render: (r) => <span className="text-[#71809A] dark:text-gray-400">{turmaExams.find(e => e.id === r.examId)?.name ?? 'Prova'}</span> },
                      { key: 'nota', header: 'Nota', render: (r) => <span className="font-semibold text-brand-600 dark:text-brand-200">{r.grade.toFixed(1)}</span> },
                      {
                        key: 'acoes', header: 'Ações', className: 'text-right',
                        render: (r) => <Button size="sm" variant="ghost" onClick={() => onNavigate('view-result', r.id)}>Ver</Button>,
                      },
                    ]}
                  />
                )
              )}

              <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4 dark:border-gray-800">
                <Button onClick={() => onNavigate('new-exam')} icon={<FilePlus2 size={15} aria-hidden />}>
                  Criar prova usando esta turma
                </Button>
                <Button variant="secondary" onClick={() => onNavigate('import-students')} icon={<Users size={15} aria-hidden />}>
                  Cartões por lista da prova
                </Button>
              </div>
            </div>
          </Card>

          <Card className="space-y-4">
            <h3 className="font-semibold text-[#172B4D] dark:text-white">Ações da turma</h3>
            <Field
              label="Ano letivo"
              htmlFor="turma-ano-letivo"
              helper="Usado no histórico do aluno e nos relatórios consolidados."
            >
              <div className="flex gap-2">
                <Input
                  id="turma-ano-letivo"
                  type="text"
                  placeholder="2026"
                  defaultValue={detail?.ano_letivo ?? ''}
                  className="sm:w-28"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busy}
                  onClick={() => handleSaveAnoLetivo(
                    (document.getElementById('turma-ano-letivo') as HTMLInputElement | null)?.value ?? '',
                  )}
                >
                  Salvar
                </Button>
              </div>
            </Field>
            <div className="flex flex-col gap-2">
              <Button variant="secondary" onClick={() => setTab('alunos')} icon={<Users size={16} aria-hidden />}>
                Gerenciar alunos
              </Button>
              <Button variant="secondary" onClick={() => setTab('avaliacoes')} icon={<ClipboardList size={16} aria-hidden />}>
                Ver avaliações
              </Button>
              <Button variant="secondary" onClick={() => setTab('resultados')} icon={<BarChart3 size={16} aria-hidden />}>
                Ver resultados
              </Button>
              <Button variant="ghost" onClick={() => onNavigate('dashboard')} icon={<BarChart3 size={16} aria-hidden />}>
                Abrir análises
              </Button>
            </div>
            <div className="callout-info">
              Reimportar a lista atualiza alunos pela matrícula e adiciona novos nomes sem duplicar.
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
