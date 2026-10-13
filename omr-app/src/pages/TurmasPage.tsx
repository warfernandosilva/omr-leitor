import { useState, useEffect, useCallback } from 'react';
import { AppView } from '../types';
import { importStudents } from '../utils/students';
import {
  listTurmas, createTurma, getTurma, renameTurma, deleteTurma,
  importTurmaAlunos, addTurmaAluno, removeTurmaAluno,
  TurmaDTO, TurmaDetail,
} from '../utils/api';

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
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Turmas</h1>
      <p className="text-gray-500 mb-6">
        Catálogo reutilizável: cadastre a lista uma vez e gere os gabaritos de qualquer prova sem reenviar planilha.
      </p>

      <div className="card max-w-3xl mb-6">
        <label className="label">Nova turma</label>
        <div className="flex gap-2">
          <input
            type="text"
            className="input flex-1"
            placeholder="Ex: 9º A"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
          />
          <button onClick={handleCreate} disabled={creating || !newName.trim()} className="btn btn-primary">
            {creating ? 'Criando...' : 'Criar'}
          </button>
        </div>
      </div>

      {loading && <p className="text-gray-500">Carregando turmas...</p>}
      {loadError && (
        <div className="card max-w-3xl p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm mb-6">
          {loadError}
          <div className="mt-2">
            <button onClick={refresh} className="btn btn-sm btn-secondary">Tentar de novo</button>
          </div>
        </div>
      )}

      {!loading && !loadError && turmas.length === 0 && (
        <div className="card max-w-3xl text-sm text-gray-500">
          Nenhuma turma cadastrada. Crie a primeira acima e importe a lista de alunos.
        </div>
      )}

      {turmas.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-3xl mb-6">
          {turmas.map((t) => (
            <button
              key={t.id}
              onClick={() => select(t.id)}
              className={`card text-left p-4 transition-colors ${
                selectedId === t.id ? 'border-blue-500 bg-blue-50/40' : 'hover:border-blue-300'
              }`}
            >
              <p className="font-medium text-gray-900">{t.nome}</p>
              <p className="text-sm text-gray-500">{t.total_alunos} aluno{t.total_alunos === 1 ? '' : 's'}</p>
            </button>
          ))}
        </div>
      )}

      {detailError && (
        <div className="card max-w-3xl p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm mb-6">{detailError}</div>
      )}

      {detail && (
        <div className="card max-w-3xl space-y-5">
          <div className="flex items-center justify-between gap-3">
            {renaming ? (
              <div className="flex gap-2 flex-1">
                <input
                  type="text"
                  className="input flex-1"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                />
                <button onClick={handleRename} disabled={busy || !renameValue.trim()} className="btn btn-sm btn-primary">Salvar</button>
                <button onClick={() => setRenaming(false)} className="btn btn-sm btn-secondary">Cancelar</button>
              </div>
            ) : (
              <>
                <h2 className="text-lg font-semibold text-gray-900">{detail.nome}</h2>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => setRenaming(true)} className="btn btn-sm btn-secondary">Renomear</button>
                  <button onClick={handleDelete} disabled={busy} className="btn btn-sm btn-danger">Apagar turma</button>
                </div>
              </>
            )}
          </div>

          {msg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 text-sm">{msg}</div>
          )}
          {msgError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{msgError}</div>
          )}

          <div>
            <label className="label">Importar lista (XLSX ou CSV)</label>
            <p className="text-xs text-gray-400 mb-2">
              Reimportar atualiza quem já tem matrícula e adiciona os novos — sem duplicar.
            </p>
            <input
              type="file"
              accept=".xlsx,.xls,.csv,text/csv"
              className="text-sm text-gray-600"
              disabled={busy}
              onChange={handleFile}
            />
          </div>

          <div>
            <label className="label">Adicionar aluno manualmente</label>
            <div className="flex gap-2">
              <input
                type="text"
                className="input flex-1"
                placeholder="Nome do aluno"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
              />
              <input
                type="text"
                className="input w-32"
                placeholder="Matrícula"
                value={manualMat}
                onChange={(e) => setManualMat(e.target.value)}
              />
              <button onClick={handleAddManual} disabled={busy || !manualName.trim()} className="btn btn-secondary">
                Adicionar
              </button>
            </div>
          </div>

          <div>
            <label className="label">Alunos no catálogo ({detail.alunos.length})</label>
            {detail.alunos.length === 0 ? (
              <p className="text-sm text-gray-500">Nenhum aluno ainda. Importe a planilha ou adicione manualmente.</p>
            ) : (
              <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg max-h-80 overflow-y-auto">
                {detail.alunos.map((a) => (
                  <li key={a.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="text-gray-800 truncate">
                      {a.nome}
                      {a.matricula && <span className="text-gray-400"> — {a.matricula}</span>}
                    </span>
                    <button
                      onClick={() => handleRemoveAluno(a.id, a.nome)}
                      disabled={busy}
                      className="text-xs text-red-600 hover:text-red-800 disabled:text-gray-300 ml-3 flex-shrink-0"
                    >
                      Remover
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="pt-1">
            <button onClick={() => onNavigate('new-exam')} className="btn btn-primary btn-sm">
              Criar prova usando esta turma
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
