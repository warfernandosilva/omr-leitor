import { useState } from 'react';
import DataTable from '../ui/DataTable';
import EmptyState from '../ui/EmptyState';
import {
  LAB_TEMPLATES, LabSessionCreated, LabSessionSummary, LabTemplate, labTotalQuestions,
  labCreateSession, labDeleteSession,
} from '../../utils/lab-api';

interface Props {
  sessions: LabSessionSummary[];
  loading: boolean;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onCreated: (created: LabSessionCreated) => void;
  onDeleted: (id: number) => void;
}

function templateLabel(t: string): string {
  return LAB_TEMPLATES.find(x => x.value === t)?.label ?? t;
}

export default function SessionsPanel({ sessions, loading, selectedId, onSelect, onCreated, onDeleted }: Props) {
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [template, setTemplate] = useState<LabTemplate>('padrao');
  const [qps, setQps] = useState(22);
  const [layoutMode, setLayoutMode] = useState<'dual' | 'single'>('dual');
  const [adaptive, setAdaptive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickTemplate = (t: LabTemplate) => {
    setTemplate(t);
    const def = LAB_TEMPLATES.find(x => x.value === t);
    if (def) setQps(def.qps);
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) { setError('Dê um nome para a sessão.'); return; }
    setBusy(true);
    setError(null);
    try {
      const created = await labCreateSession({
        nome: nome.trim(),
        descricao: descricao.trim() || null,
        template,
        questions_per_subject: qps,
        layout_mode: layoutMode,
        adaptive,
      });
      setNome('');
      setDescricao('');
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar a sessão');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: LabSessionSummary) => {
    if (!confirm(`Excluir a sessão "${s.nome}"?\n\nAs ${s.n_images} foto(s) e o gabarito serão apagados. Não dá para desfazer.`)) return;
    try {
      await labDeleteSession(s.id);
      onDeleted(s.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao excluir a sessão');
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={create} className="card">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Nova sessão de teste</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Uma sessão agrupa fotos do mesmo cartão + um gabarito. As fotos passam pelo mesmo motor de produção.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="label" htmlFor="lab-nome">Nome</label>
            <input
              id="lab-nome"
              className="input"
              value={nome}
              onChange={e => setNome(e.target.value)}
              placeholder="Ex.: Turma B — foto de mesa — 12/05"
            />
          </div>
          <div>
            <label className="label" htmlFor="lab-descricao">Descrição (opcional)</label>
            <input
              id="lab-descricao"
              className="input"
              value={descricao}
              onChange={e => setDescricao(e.target.value)}
              placeholder="Condições da foto, câmera, iluminação…"
            />
          </div>
          <div>
            <label className="label" htmlFor="lab-template">Modelo do cartão</label>
            <select
              id="lab-template"
              className="input"
              value={template}
              onChange={e => pickTemplate(e.target.value as LabTemplate)}
            >
              {LAB_TEMPLATES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="lab-qps">Questões por disciplina</label>
            <input
              id="lab-qps"
              type="number"
              min={1}
              max={30}
              className="input"
              value={qps}
              onChange={e => setQps(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
          <div>
            <label className="label" htmlFor="lab-layout">Layout</label>
            <select
              id="lab-layout"
              className="input"
              value={layoutMode}
              onChange={e => setLayoutMode(e.target.value as 'dual' | 'single')}
            >
              <option value="dual">Dual ({qps * 2} questões)</option>
              <option value="single">Simples ({qps} questões)</option>
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 mt-4 text-sm text-gray-700 dark:text-gray-300">
          <input type="checkbox" checked={adaptive} onChange={e => setAdaptive(e.target.checked)} className="w-4 h-4" />
          Usar limiar adaptativo (floor calculado por imagem)
        </label>
        {error && <div className="callout-danger mt-4">{error}</div>}
        <button type="submit" disabled={busy} className="btn btn-primary mt-4 min-h-[44px]">
          {busy ? 'Criando…' : 'Criar sessão'}
        </button>
      </form>

      {loading && <div className="card text-center py-10 text-gray-500">Carregando sessões…</div>}

      {!loading && sessions.length === 0 && (
        <EmptyState
          title="Nenhuma sessão ainda"
          description="Crie a primeira sessão acima para começar a coletar fotos."
        />
      )}

      {!loading && sessions.length > 0 && (
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Sessões</h3>
          <DataTable<LabSessionSummary>
            minWidth={760}
            rows={sessions}
            rowKey={s => String(s.id)}
            columns={[
              {
                key: 'nome',
                header: 'Sessão',
                render: s => (
                  <div className="min-w-[180px]">
                    <p className="font-medium text-gray-900 dark:text-white">{s.nome}</p>
                    {s.descricao && <p className="text-xs text-gray-500 dark:text-gray-400">{s.descricao}</p>}
                  </div>
                ),
              },
              {
                key: 'template',
                header: 'Modelo',
                render: s => <span className="text-xs">{templateLabel(s.template)}</span>,
              },
              {
                key: 'q',
                header: 'Questões',
                render: s => <span className="text-xs">{labTotalQuestions(s)}</span>,
              },
              {
                key: 'fotos',
                header: 'Fotos',
                render: s => (
                  <span className="text-xs">
                    {s.n_images}
                    {s.n_erro > 0 && (
                      <span className="ml-1 text-red-600 dark:text-red-400">({s.n_erro} erro)</span>
                    )}
                  </span>
                ),
              },
              {
                key: 'acoes',
                header: 'Ações',
                className: 'text-right',
                render: s => (
                  <div className="flex justify-end gap-1">
                    <button
                      onClick={() => onSelect(s.id)}
                      className={`btn btn-sm ${selectedId === s.id ? 'btn-primary' : 'btn-secondary'}`}
                    >
                      {selectedId === s.id ? 'Selecionada' : 'Abrir'}
                    </button>
                    <button onClick={() => remove(s)} className="btn btn-sm btn-danger">Excluir</button>
                  </div>
                ),
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}