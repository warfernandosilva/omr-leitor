import { useState, useEffect, useCallback } from 'react';
import { FilePlus2, Pencil, Plus, RefreshCw, Trash2, Upload, UserPlus } from 'lucide-react';
import { AppView } from '../types';
import { importStudents } from '../utils/students';
import {
  listTurmas, createTurma, getTurma, renameTurma, deleteTurma,
  importTurmaAlunos, addTurmaAluno, removeTurmaAluno,
  TurmaDTO, TurmaDetail,
} from '../utils/api';
import PageHeader from '../components/ui/PageHeader';
import Field from '../components/ui/Field';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';

interface Props {
  onNavigate: (view: AppView) => void;
}

export default function TurmasPage({ onNavigate }: Props) {
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

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setTurmas(await listTurmas());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Falha ao listar turmas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const select = async (id: number) => {
    setSelectedId(id);
    setDetail(null);
    setDetailError(null);
    setRenaming(false);
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

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Turmas"
        subtitle="Catálogo reutilizável: cadastre a lista uma vez e gere os gabaritos de qualquer prova sem reenviar planilha"
      />

      <div className="card max-w-3xl">
        <Field label="Nova turma" htmlFor="turma-new-name">
          <div className="flex gap-2">
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
      </div>

      {loading && <p className="text-gray-500 dark:text-gray-400" role="status">Carregando turmas...</p>}
      {loadError && (
        <div className="card max-w-3xl callout-danger">
          {loadError}
          <div className="mt-2">
            <Button variant="secondary" size="sm" onClick={refresh} icon={<RefreshCw size={14} aria-hidden />}>Tentar de novo</Button>
          </div>
        </div>
      )}

      {!loading && !loadError && turmas.length === 0 && (
        <div className="max-w-3xl">
          <EmptyState
            title="Nenhuma turma cadastrada"
            description="Crie a primeira acima e importe a lista de alunos."
          />
        </div>
      )}

      {turmas.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-3xl" role="listbox" aria-label="Turmas">
          {turmas.map((t) => (
            <button
              key={t.id}
              type="button"
              role="option"
              aria-selected={selectedId === t.id}
              onClick={() => select(t.id)}
              className={`card text-left p-4 transition-colors min-h-[44px] ${
                selectedId === t.id
                  ? 'border-brand-500 bg-brand-50/40 dark:bg-brand-700/15 dark:border-brand-400'
                  : 'card-hover'
              }`}
            >
              <p className="font-medium text-ink dark:text-gray-100">{t.nome}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">{t.total_alunos} aluno{t.total_alunos === 1 ? '' : 's'}</p>
            </button>
          ))}
        </div>
      )}

      {detailError && (
        <div className="card max-w-3xl callout-danger">{detailError}</div>
      )}

      {detail && (
        <div className="card max-w-3xl space-y-5">
          <div className="flex items-center justify-between gap-3">
            {renaming ? (
              <div className="flex gap-2 flex-1">
                <Input
                  type="text"
                  aria-label="Novo nome da turma"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                />
                <Button size="sm" onClick={handleRename} loading={busy} disabled={!renameValue.trim()}>Salvar</Button>
                <Button size="sm" variant="secondary" onClick={() => setRenaming(false)}>Cancelar</Button>
              </div>
            ) : (
              <>
                <h2 className="text-lg font-semibold text-ink dark:text-white">{detail.nome}</h2>
                <div className="flex gap-2 flex-shrink-0">
                  <Button size="sm" variant="secondary" onClick={() => setRenaming(true)} icon={<Pencil size={14} aria-hidden />}>Renomear</Button>
                  <Button size="sm" variant="danger" onClick={handleDelete} loading={busy} icon={<Trash2 size={14} aria-hidden />}>Apagar turma</Button>
                </div>
              </>
            )}
          </div>

          {msg && <div className="callout-success">{msg}</div>}
          {msgError && <div className="callout-danger">{msgError}</div>}

          <Field
            label="Importar lista (XLSX ou CSV)"
            helper="Reimportar atualiza quem já tem matrícula e adiciona os novos — sem duplicar."
          >
            <label className="inline-flex items-center gap-2 btn btn-secondary cursor-pointer">
              <Upload size={15} aria-hidden />
              Escolher arquivo
              <input
                type="file"
                accept=".xlsx,.xls,.csv,text/csv"
                className="sr-only"
                disabled={busy}
                onChange={handleFile}
              />
            </label>
          </Field>

          <Field label="Adicionar aluno manualmente">
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                type="text"
                aria-label="Nome do aluno"
                placeholder="Nome do aluno"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
              />
              <Input
                type="text"
                aria-label="Matrícula"
                placeholder="Matrícula"
                value={manualMat}
                onChange={(e) => setManualMat(e.target.value)}
                className="sm:w-36"
              />
              <Button variant="secondary" onClick={handleAddManual} loading={busy} disabled={!manualName.trim()} icon={<UserPlus size={15} aria-hidden />} className="whitespace-nowrap">
                Adicionar
              </Button>
            </div>
          </Field>

          <div>
            <span className="label">Alunos no catálogo ({detail.alunos.length})</span>
            {detail.alunos.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Nenhum aluno ainda. Importe a planilha ou adicione manualmente.</p>
            ) : (
              <ul className="divide-y divide-line dark:divide-gray-800 border border-line dark:border-gray-800 rounded-lg max-h-80 overflow-y-auto">
                {detail.alunos.map((a) => (
                  <li key={a.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="text-gray-700 dark:text-gray-200 truncate">
                      {a.nome}
                      {a.matricula && <span className="text-gray-400 dark:text-gray-500"> — {a.matricula}</span>}
                    </span>
                    <button
                      onClick={() => handleRemoveAluno(a.id, a.nome)}
                      disabled={busy}
                      className="text-xs text-danger-600 hover:text-danger-700 dark:text-danger-100 disabled:text-gray-300 dark:disabled:text-gray-600 ml-3 flex-shrink-0 min-h-[44px] px-2"
                    >
                      Remover
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="pt-1">
            <Button size="sm" onClick={() => onNavigate('new-exam')} icon={<FilePlus2 size={15} aria-hidden />}>
              Criar prova usando esta turma
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
