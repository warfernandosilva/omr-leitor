import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, ListChecks, Plus, RefreshCw, Search,
} from 'lucide-react';
import type { AppView } from '../types';
import {
  listAvaliacoes, listProvas, createAvaliacao,
  type AvaliacaoDTO, type ProvaDTO,
} from '../utils/api-avaliacoes';
import { AVALIACAO_STATUS_TONE, STATUS_LABEL, type StatusAvaliacao } from '../utils/workflow';
import { listTurmas, type TurmaDTO } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/ui/PageHeader';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import Field from '../components/ui/Field';

interface Props {
  onNavigate: (view: AppView, examId?: string) => void;
}

const STATUS_TONE = AVALIACAO_STATUS_TONE;

const TODOS = '';

/** Central de avaliações: etapa, progresso e próxima ação de cada uma. */
export default function AvaliacoesPage({ onNavigate }: Props) {
  const { user } = useAuth();
  const [items, setItems] = useState<AvaliacaoDTO[]>([]);
  const [provas, setProvas] = useState<ProvaDTO[]>([]);
  const [turmas, setTurmas] = useState<TurmaDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState(TODOS);
  const [criando, setCriando] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nova, setNova] = useState({ titulo: '', prova_id: '', turma_ids: [] as number[], ano_letivo: '' });

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const [avs, ps, ts] = await Promise.all([listAvaliacoes(), listProvas(), listTurmas()]);
      setItems(avs);
      setProvas(ps);
      setTurmas(ts);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao carregar avaliações.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return items.filter(a => {
      if (filtroStatus && a.status_efetivo !== filtroStatus) return false;
      if (!q) return true;
      return a.titulo.toLowerCase().includes(q)
        || (a.prova?.titulo ?? '').toLowerCase().includes(q)
        || (a.turmas ?? []).some(t => t.nome.toLowerCase().includes(q));
    });
  }, [items, busca, filtroStatus]);

  const contagem = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of items) c[a.status_efetivo] = (c[a.status_efetivo] ?? 0) + 1;
    return c;
  }, [items]);

  const abrir = (a: AvaliacaoDTO) => {
    onNavigate('avaliacao-detalhe', a.external_id);
  };

  const criar = async () => {
    if (!nova.titulo.trim()) return;
    setSaving(true);
    setErro(null);
    try {
      const criada = await createAvaliacao({
        titulo: nova.titulo.trim(),
        ano_letivo: nova.ano_letivo.trim() || null,
        prova_id: nova.prova_id ? Number(nova.prova_id) : undefined,
        subjectLP: provas.find(p => String(p.id) === nova.prova_id)?.subject_lp,
        subjectMat: provas.find(p => String(p.id) === nova.prova_id)?.subject_mat,
        questionsPerSubject: provas.find(p => String(p.id) === nova.prova_id)?.questions_per_subject,
        layoutMode: provas.find(p => String(p.id) === nova.prova_id)?.layout_mode,
        gradeScale: provas.find(p => String(p.id) === nova.prova_id)?.grade_scale,
        turma_ids: nova.turma_ids,
      });
      setCriando(false);
      setNova({ titulo: '', prova_id: '', turma_ids: [], ano_letivo: '' });
      await carregar();
      onNavigate('avaliacao-detalhe', criada.external_id);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao criar a avaliação.');
    } finally {
      setSaving(false);
    }
  };

  const porEtapa = (a: AvaliacaoDTO) =>
    a.etapas?.find(e => e.id === a.proxima_acao?.etapa) ?? null;

  return (
    <div className="app-section animate-fade-in">
      <PageHeader
        title="Gerenciar avaliações"
        subtitle="Cada avaliação com suas etapas, progresso e próxima ação — da preparação à publicação dos resultados"
        actions={
          <>
            <Button variant="secondary" onClick={() => void carregar()} icon={<RefreshCw size={16} aria-hidden />}>
              Atualizar
            </Button>
            <Button onClick={() => setCriando(true)} icon={<Plus size={16} aria-hidden />}>
              Nova avaliação
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Card className="!py-3"><p className="text-xs text-[#71809A] dark:text-gray-400">Total</p><p className="text-2xl font-bold text-[#172B4D] dark:text-white">{items.length}</p></Card>
        {(['em_preparacao', 'pronta_impressao', 'aguardando_correcao', 'em_correcao', 'aguardando_revisao', 'publicados'] as StatusAvaliacao[]).map(s => (
          <Card key={s} className="!py-3">
            <p className="text-xs text-[#71809A] dark:text-gray-400 truncate">{STATUS_LABEL[s]}</p>
            <p className="text-2xl font-bold text-[#172B4D] dark:text-white">{contagem[s] ?? 0}</p>
          </Card>
        ))}
      </div>

      <Card>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#71809A] pointer-events-none" aria-hidden />
            <Input
              type="search"
              aria-label="Buscar avaliação"
              placeholder="Buscar por avaliação, prova ou turma..."
              value={busca}
              onChange={e => setBusca(e.target.value)}
              className="!pl-9"
            />
          </div>
          <Select
            aria-label="Filtrar por status"
            value={filtroStatus}
            onChange={e => setFiltroStatus(e.target.value)}
            className="sm:w-56"
          >
            <option value="">Todos os status</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </Select>
        </div>
      </Card>

      {erro && <div className="callout-danger" role="alert">{erro}</div>}

      {loading ? (
        <Card><p className="text-sm text-[#71809A] dark:text-gray-400" role="status">Carregando avaliações...</p></Card>
      ) : filtradas.length === 0 ? (
        <Card>
          <EmptyState
            title={items.length === 0 ? 'Nenhuma avaliação criada' : 'Nenhuma avaliação neste filtro'}
            description={items.length === 0
              ? 'Crie a primeira avaliação escolhendo uma prova e as turmas participantes.'
              : 'Ajuste a busca ou o filtro de status.'}
            icon={<ListChecks size={24} strokeWidth={1.5} aria-hidden />}
            action={<Button onClick={() => setCriando(true)} icon={<Plus size={16} aria-hidden />}>Nova avaliação</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {filtradas.map(a => {
            const prox = porEtapa(a);
            return (
              <Card key={a.external_id}>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-[#172B4D] dark:text-white truncate">{a.titulo}</h3>
                      <Badge tone={STATUS_TONE[a.status_efetivo]}>{a.status_label}</Badge>
                      {a.ano_letivo && <Badge tone="neutral">{a.ano_letivo}</Badge>}
                    </div>
                    <p className="text-sm text-[#71809A] dark:text-gray-400 mt-1 truncate">
                      {a.prova?.titulo ?? 'Sem prova vinculada'}
                      {a.turmas?.length ? ` · ${a.turmas.map(t => t.nome).join(', ')}` : ' · sem turma'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="w-32">
                      <div className="flex items-center justify-between text-xs text-[#71809A] dark:text-gray-400">
                        <span>Progresso</span><span>{a.progresso}%</span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-line dark:bg-gray-800 overflow-hidden">
                        <div className="h-full bg-brand-500 rounded-full" style={{ width: `${a.progresso}%` }} />
                      </div>
                    </div>
                    {prox?.acao && (
                      <Badge tone="info">{prox.acao}</Badge>
                    )}
                    <Button size="sm" onClick={() => abrir(a)} icon={<ArrowRight size={15} aria-hidden />}>
                      Abrir
                    </Button>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  {(a.etapas ?? []).map(e => (
                    <div key={e.id} className="panel !p-2">
                      <p className="text-[11px] font-medium text-[#172B4D] dark:text-gray-200 truncate">{e.label}</p>
                      <p className={`text-[11px] ${
                        e.status === 'concluida' ? 'text-success-600 dark:text-success-100'
                          : e.status === 'atual' ? 'text-brand-600 dark:text-brand-200'
                            : e.status === 'bloqueada' ? 'text-[#71809A] dark:text-gray-500'
                              : 'text-[#71809A] dark:text-gray-400'
                      }`}>
                        {e.status === 'concluida' ? 'pronta' : e.status === 'atual' ? 'em andamento'
                          : e.status === 'bloqueada' ? 'bloqueada' : 'pendente'}
                      </p>
                    </div>
                  ))}
                </div>

                {a.bloqueios.length > 0 && (
                  <p className="mt-2 text-xs text-warning-600 dark:text-warning-100">
                    {a.bloqueios.join(' · ')}
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={criando}
        onClose={() => setCriando(false)}
        title="Nova avaliação"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCriando(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={() => void criar()} loading={saving} disabled={!nova.titulo.trim()}>
              Criar e abrir
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Nome da avaliação" htmlFor="aval-novo-titulo" required>
            <Input
              id="aval-novo-titulo"
              type="text"
              value={nova.titulo}
              onChange={e => setNova(v => ({ ...v, titulo: e.target.value }))}
              placeholder="Ex: 1ª Avaliação de Matemática — 9º ano"
              autoComplete="off"
            />
          </Field>

          <Field
            label="Prova"
            htmlFor="aval-novo-prova"
            helper={provas.length === 0 ? 'Cadastre uma prova em Provas e avaliações para reutilizar a estrutura.' : 'Reaproveite a estrutura de uma prova existente.'}
          >
            {provas.length === 0 ? (
              <p className="text-sm text-[#71809A] dark:text-gray-400">Nenhuma prova cadastrada ainda.</p>
            ) : (
              <Select
                id="aval-novo-prova"
                value={nova.prova_id}
                onChange={e => setNova(v => ({ ...v, prova_id: e.target.value }))}
              >
                <option value="">Criar prova nova junto…</option>
                {provas.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.titulo} · {p.questions_per_subject}q/disciplina
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Ano letivo" htmlFor="aval-novo-ano" helper="Opcional — usado no histórico do aluno.">
            <Input
              id="aval-novo-ano"
              type="text"
              value={nova.ano_letivo}
              onChange={e => setNova(v => ({ ...v, ano_letivo: e.target.value }))}
              placeholder="2026"
              autoComplete="off"
              className="sm:w-32"
            />
          </Field>

          <div>
            <span className="label">Turmas participantes</span>
            {turmas.length === 0 ? (
              <p className="text-sm text-[#71809A] dark:text-gray-400">Nenhuma turma cadastrada.</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {turmas.map(t => (
                  <label key={t.id} className="panel flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={nova.turma_ids.includes(t.id)}
                      onChange={e => setNova(v => ({
                        ...v,
                        turma_ids: e.target.checked
                          ? [...v.turma_ids, t.id]
                          : v.turma_ids.filter(id => id !== t.id),
                      }))}
                    />
                    <span className="text-sm text-[#172B4D] dark:text-gray-100">{t.nome}</span>
                    <span className="text-xs text-[#71809A] dark:text-gray-400 ml-auto">{t.total_alunos} aluno(s)</span>
                  </label>
                ))}
              </div>
            )}
            <p className="field-helper">
              As turmas podem ser alteradas depois, no detalhe da avaliação.
              {user?.role === 'professor' ? '' : ''}
            </p>
          </div>

          {erro && <div className="callout-danger" role="alert">{erro}</div>}
        </div>
      </Modal>
    </div>
  );
}
