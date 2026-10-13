import { useState } from 'react';
import { Play, Trash2 } from 'lucide-react';
import DataTable from '../ui/DataTable';
import EmptyState from '../ui/EmptyState';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
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
        <h3 className="text-lg font-semibold text-ink dark:text-white mb-1">Nova sessão de teste</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Uma sessão agrupa fotos do mesmo cartão + um gabarito. As fotos passam pelo mesmo motor de produção.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Field label="Nome" htmlFor="lab-nome">
              <Input
                id="lab-nome"
                value={nome}
                onChange={e => setNome(e.target.value)}
                placeholder="Ex.: Turma B — foto de mesa — 12/05"
              />
            </Field>
          </div>
          <div>
            <Field label="Descrição (opcional)" htmlFor="lab-descricao">
              <Input
                id="lab-descricao"
                value={descricao}
                onChange={e => setDescricao(e.target.value)}
                placeholder="Condições da foto, câmera, iluminação…"
              />
            </Field>
          </div>
          <div>
            <Field label="Modelo do cartão" htmlFor="lab-template">
              <Select
                id="lab-template"
                value={template}
                onChange={e => pickTemplate(e.target.value as LabTemplate)}
              >
                {LAB_TEMPLATES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div>
            <Field label="Questões por disciplina" htmlFor="lab-qps">
              <Input
                id="lab-qps"
                type="number"
                min={1}
                max={30}
                value={qps}
                onChange={e => setQps(Math.max(1, Number(e.target.value) || 1))}
              />
            </Field>
          </div>
          <div>
            <Field label="Layout" htmlFor="lab-layout">
              <Select
                id="lab-layout"
                value={layoutMode}
                onChange={e => setLayoutMode(e.target.value as 'dual' | 'single')}
              >
                <option value="dual">Dual ({qps * 2} questões)</option>
                <option value="single">Simples ({qps} questões)</option>
              </Select>
            </Field>
          </div>
        </div>
        <label className="flex items-center gap-2 mt-4 text-sm text-gray-600 dark:text-gray-300 min-h-[44px]">
          <input type="checkbox" checked={adaptive} onChange={e => setAdaptive(e.target.checked)} className="w-4 h-4 accent-brand-500" />
          Usar limiar adaptativo (floor calculado por imagem)
        </label>
        {error && <div className="callout-danger mt-4">{error}</div>}
        <Button type="submit" loading={busy} className="mt-4">
          Criar sessão
        </Button>
      </form>

      {loading && <div className="card text-center py-10 text-gray-500 dark:text-gray-400" role="status">Carregando sessões…</div>}

      {!loading && sessions.length === 0 && (
        <EmptyState
          title="Nenhuma sessão ainda"
          description="Crie a primeira sessão acima para começar a coletar fotos."
        />
      )}

      {!loading && sessions.length > 0 && (
        <div className="card">
          <h3 className="text-lg font-semibold text-ink dark:text-white mb-4">Sessões</h3>
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
                    <p className="font-medium text-ink dark:text-white">{s.nome}</p>
                    {s.descricao && <p className="text-xs text-gray-500 dark:text-gray-400">{s.descricao}</p>}
                  </div>
                ),
              },
              {
                key: 'template',
                header: 'Modelo',
                render: s => <span className="text-xs text-gray-600 dark:text-gray-300">{templateLabel(s.template)}</span>,
              },
              {
                key: 'q',
                header: 'Questões',
                render: s => <span className="text-xs text-gray-600 dark:text-gray-300 tabular-nums">{labTotalQuestions(s)}</span>,
              },
              {
                key: 'fotos',
                header: 'Fotos',
                render: s => (
                  <span className="text-xs text-gray-600 dark:text-gray-300 tabular-nums">
                    {s.n_images}
                    {s.n_erro > 0 && (
                      <Badge tone="danger" className="ml-1">{s.n_erro} erro</Badge>
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
                    <Button
                      size="sm"
                      variant={selectedId === s.id ? 'primary' : 'secondary'}
                      onClick={() => onSelect(s.id)}
                      icon={<Play size={14} aria-hidden />}
                    >
                      {selectedId === s.id ? 'Selecionada' : 'Abrir'}
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => remove(s)} icon={<Trash2 size={14} aria-hidden />}>Excluir</Button>
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