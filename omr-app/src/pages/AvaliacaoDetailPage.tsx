import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, CheckCircle2, ClipboardList, FileText, GraduationCap, KeyRound, ListChecks,
  Lock, Printer, RefreshCw, ScanLine, ShieldCheck, TriangleAlert, Upload,
} from 'lucide-react';
import type { AppView } from '../types';
import {
  getAvaliacao, mudarStatus, publicarResultados, vincularTurma,
  desvincularTurma, timelineAvaliacao, listLeituras, revisarLeitura,
  type AvaliacaoDTO, type EventoDTO, type EtapaDTO, type LeituraDTO,
} from '../utils/api-avaliacoes';

import { AVALIACAO_STATUS_TONE, transicaoInvalida, type EtapaId, type StatusAvaliacao } from '../utils/workflow';
import { listTurmas, type TurmaDTO } from '../utils/api';
import PageHeader from '../components/ui/PageHeader';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import Modal, { ConfirmModal } from '../components/ui/Modal';
import Field from '../components/ui/Field';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import { useToast } from '../components/ui/Toast';

interface Props {
  examId: string | null;
  onNavigate: (view: AppView, examId?: string) => void;
}

const ETAPA_META: Record<EtapaId, { view?: AppView; acaoPadrao: string; icon: typeof ListChecks; hint: string }> = {
  preparacao: {
    acaoPadrao: 'Concluir cadastro', icon: ClipboardList,
    hint: 'Turmas, alunos e gabarito oficial da avaliação.',
  },
  impressao: {
    view: 'generate-card', acaoPadrao: 'Gerar cartões', icon: Printer,
    hint: 'Cartões individuais com QR de cada aluno.',
  },
  aplicacao: {
    view: 'correct-card', acaoPadrao: 'Iniciar leitura', icon: ScanLine,
    hint: 'Aplique a prova e capture/envie as fotos dos cartões.',
  },
  leitura: {
    view: 'correct-card', acaoPadrao: 'Corrigir cartões', icon: ScanLine,
    hint: 'A leitura OMR usa o mesmo motor de produção.',
  },
  revisao: {
    view: 'pending', acaoPadrao: 'Revisar correções', icon: ShieldCheck,
    hint: 'Baixa confiança e marcação dupla exigem conferência manual.',
  },
  resultados: {
    view: 'dashboard', acaoPadrao: 'Publicar resultados', icon: ListChecks,
    hint: 'Resultados por aluno, turma e avaliação.',
  },
};

function statusDaEtapa(e: EtapaDTO): { texto: string; cor: string } {
  if (e.status === 'concluida') return { texto: 'pronta', cor: 'text-success-600 dark:text-success-100' };
  if (e.status === 'atual') return { texto: 'em andamento', cor: 'text-brand-600 dark:text-brand-200' };
  if (e.status === 'bloqueada') return { texto: 'bloqueada', cor: 'text-[#71809A] dark:text-gray-500' };
  return { texto: 'pendente', cor: 'text-[#71809A] dark:text-gray-400' };
}

/** Detalhe operacional da avaliação: 6 etapas com ação contextual em cada uma. */
export default function AvaliacaoDetailPage({ examId, onNavigate }: Props) {
  const { notify } = useToast();
  const [dados, setDados] = useState<AvaliacaoDTO | null>(null);
  const [turmas, setTurmas] = useState<TurmaDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [publicando, setPublicando] = useState(false);
  const [confirmarPublicar, setConfirmarPublicar] = useState(false);
  const [confirmarArquivar, setConfirmarArquivar] = useState(false);
  const [leituras, setLeituras] = useState<LeituraDTO[]>([]);
  const [eventos, setEventos] = useState<EventoDTO[]>([]);
  const [revisando, setRevisando] = useState<LeituraDTO | null>(null);
  const [respostasRevisao, setRespostasRevisao] = useState<Record<string, string>>({});
  const [obsRevisao, setObsRevisao] = useState('');
  const [salvandoRevisao, setSalvandoRevisao] = useState(false);

  const carregar = useCallback(async (id: string) => {
    setLoading(true);
    setErro(null);
    try {
      const [a, ts, ls, ev] = await Promise.all([
        getAvaliacao(id), listTurmas(), listLeituras(id), timelineAvaliacao(id),
      ]);
      setDados(a);
      setTurmas(ts);
      setLeituras(ls);
      setEventos(ev);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao carregar a avaliação.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (examId) void carregar(examId);
    else { setLoading(false); setErro('Nenhuma avaliação selecionada.'); }
  }, [examId, carregar]);

  const turmasFora = useMemo(
    () => (dados?.turmas ? turmas.filter(t => !dados.turmas!.some(x => x.id === t.id)) : turmas),
    [dados, turmas],
  );

  const irPara = (view: AppView) => {
    if (!dados) return;
    onNavigate(view, dados.external_id);
  };

  const abrirRevisao = (l: LeituraDTO) => {
    setRevisando(l);
    const r: Record<string, string> = {};
    for (const [q, v] of Object.entries(l.respostas ?? {})) r[q] = v;
    setRespostasRevisao(r);
    setObsRevisao('');
  };

  const salvarRevisao = async () => {
    if (!revisando) return;
    setSalvandoRevisao(true);
    try {
      const numericas: Record<number, string> = {};
      for (const [q, v] of Object.entries(respostasRevisao)) {
        if (v && v.trim()) numericas[Number(q)] = v.trim().toUpperCase();
      }
      await revisarLeitura(revisando.id, numericas, obsRevisao.trim() || undefined);
      notify('Leitura revisada — alterações registradas no histórico.', 'success');
      setRevisando(null);
      if (dados) await carregar(dados.external_id);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao registrar a revisão.');
      notify('Não foi possível salvar a revisão.', 'error');
    } finally {
      setSalvandoRevisao(false);
    }
  };

  const acaoDaEtapa = (e: EtapaDTO) => {
    if (!dados) return;
    const id = e.id as EtapaId;
    const meta = ETAPA_META[id];
    if (id === 'preparacao') { onNavigate('register-key', dados.external_id); return; }
    if (id === 'impressao') { onNavigate('generate-card', dados.external_id); return; }
    if (id === 'aplicacao' || id === 'leitura') { onNavigate('correct-card', dados.external_id); return; }
    if (id === 'revisao') { onNavigate('pending', dados.external_id); return; }
    if (id === 'resultados') {
      if (e.acao === 'Publicar resultados') { setConfirmarPublicar(true); return; }
      onNavigate('dashboard', dados.external_id);
      return;
    }
    if (meta?.view) irPara(meta.view);
  };

  const marcarImpressa = async () => {
    if (!dados) return;
    setOcupado(true);
    try {
      await mudarStatus(dados.external_id, 'impressa');
      await carregar(dados.external_id);
      notify('Cartões marcados como impressos.', 'success');
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao atualizar o status.');
    } finally {
      setOcupado(false);
    }
  };

  const publicar = async () => {
    if (!dados) return;
    setPublicando(true);
    try {
      await publicarResultados(dados.external_id);
      await carregar(dados.external_id);
      notify('Resultados publicados.', 'success');
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível publicar.');
      notify('Não foi possível publicar os resultados.', 'error');
    } finally {
      setPublicando(false);
      setConfirmarPublicar(false);
    }
  };

  const arquivar = async () => {
    if (!dados) return;
    setOcupado(true);
    try {
      await mudarStatus(dados.external_id, 'arquivada');
      await carregar(dados.external_id);
      notify('Avaliação arquivada.', 'success');
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao arquivar.');
    } finally {
      setOcupado(false);
      setConfirmarArquivar(false);
    }
  };

  const transicoes = useMemo(() => {
    if (!dados) return [];
    if (dados.status_efetivo === 'pronta_impressao') {
      return [{ alvo: 'impressa' as StatusAvaliacao, rotulo: 'Marcar como impressa' }];
    }
    if (dados.status_efetivo === 'impressa') {
      return [{ alvo: 'em_aplicacao' as StatusAvaliacao, rotulo: 'Marcar em aplicação' }];
    }
    if (dados.status_efetivo === 'corrigida') {
      return [{ alvo: 'arquivada' as StatusAvaliacao, rotulo: 'Arquivar' }];
    }
    return [];
  }, [dados]);

  if (loading) {
    return (
      <div className="app-section animate-fade-in">
        <PageHeader title="Detalhe da avaliação" />
        <Card><p className="text-sm text-[#71809A] dark:text-gray-400" role="status">Carregando avaliação...</p></Card>
      </div>
    );
  }

  if (!dados || erro) {
    return (
      <div className="app-section animate-fade-in">
        <PageHeader title="Detalhe da avaliação" />
        <div className="callout-danger" role="alert">{erro ?? 'Avaliação não encontrada.'}</div>
        <Button variant="secondary" className="mt-3" onClick={() => onNavigate('avaliacoes')} icon={<ArrowLeft size={16} aria-hidden />}>
          Voltar para avaliações
        </Button>
      </div>
    );
  }

  const contadores = dados.etapas ?? [];
  const etapaPreparacao = contadores.find(e => e.id === 'preparacao');
  const semGabarito = !dados.answer_key;

  return (
    <div className="app-section animate-fade-in">
      <PageHeader
        title={dados.titulo}
        subtitle={`${dados.status_label} · ${dados.progresso}% do fluxo concluído`}
        actions={
          <>
            <Button variant="secondary" onClick={() => onNavigate('avaliacoes')} icon={<ArrowLeft size={16} aria-hidden />}>
              Voltar
            </Button>
            <Button variant="secondary" onClick={() => void carregar(dados.external_id)} icon={<RefreshCw size={16} aria-hidden />}>
              Atualizar
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="!py-3">
          <p className="text-xs text-[#71809A] dark:text-gray-400">Situação</p>
          <Badge tone={AVALIACAO_STATUS_TONE[dados.status_efetivo]}>{dados.status_label}</Badge>
        </Card>
        <Card className="!py-3">
          <p className="text-xs text-[#71809A] dark:text-gray-400">Prova</p>
          <p className="font-semibold text-[#172B4D] dark:text-white truncate">{dados.prova?.titulo ?? '—'}</p>
        </Card>
        <Card className="!py-3">
          <p className="text-xs text-[#71809A] dark:text-gray-400">Turmas</p>
          <p className="font-semibold text-[#172B4D] dark:text-white truncate">
            {dados.turmas?.length ? dados.turmas.map(t => t.nome).join(', ') : '—'}
          </p>
        </Card>
        <Card className="!py-3">
          <p className="text-xs text-[#71809A] dark:text-gray-400">Gabarito oficial</p>
          <p className="font-semibold text-[#172B4D] dark:text-white">
            {semGabarito ? 'não cadastrado' : `versão ${dados.gabarito_versao ?? 1}`}
          </p>
        </Card>
      </div>

      {dados.bloqueios.length > 0 && (
        <div className="callout-warning flex items-start gap-2" role="status">
          <TriangleAlert size={16} className="shrink-0 mt-0.5" aria-hidden />
          <p><strong>Falta resolver:</strong> {dados.bloqueios.join(' · ')}</p>
        </div>
      )}

      <Card>
        <div className="section-header mb-4">
          <h2 className="text-lg font-semibold text-[#172B4D] dark:text-white">Etapas da avaliação</h2>
          <span className="text-sm text-[#71809A] dark:text-gray-400">{dados.progresso}%</span>
        </div>

        <ol className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {contadores.map((e, i) => {
            const meta = ETAPA_META[e.id as EtapaId];
            const st = statusDaEtapa(e);
            const bloqueada = e.status === 'bloqueada';
            const proxima = dados.proxima_acao?.etapa === e.id;
            return (
              <li key={e.id} className={`panel flex flex-col gap-2 ${proxima ? 'border-brand-500/40 bg-brand-50/40 dark:bg-brand-700/10' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-8 h-8 rounded-[10px] bg-brand-50 dark:bg-brand-700/20 flex items-center justify-center text-brand-600 dark:text-brand-200 shrink-0" aria-hidden>
                      <meta.icon size={16} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#172B4D] dark:text-white truncate">
                        {i + 1}. {e.label}
                      </p>
                      <p className={`text-xs ${st.cor}`}>{st.texto}</p>
                    </div>
                  </div>
                  {e.status === 'concluida' && <CheckCircle2 size={18} className="text-success-500 shrink-0" aria-hidden />}
                  {bloqueada && <Lock size={16} className="text-[#71809A] shrink-0" aria-hidden />}
                </div>

                <p className="text-xs text-[#71809A] dark:text-gray-400">{e.detalhe || meta?.hint}</p>

                <div className="mt-auto flex flex-wrap gap-2">
                  {(e.acao || proxima) && (
                    <Button
                      size="sm"
                      variant={proxima ? 'primary' : 'secondary'}
                      disabled={bloqueada && e.status !== 'pendente'}
                      onClick={() => acaoDaEtapa(e)}
                    >
                      {e.acao ?? meta?.acaoPadrao}
                    </Button>
                  )}
                  {e.id === 'impressao' && dados.status_efetivo === 'pronta_impressao' && (
                    <Button size="sm" variant="ghost" loading={ocupado} onClick={() => void marcarImpressa()}>
                      {transicoes[0]?.rotulo ?? 'Marcar como impressa'}
                    </Button>
                  )}
                </div>
                {bloqueada && e.bloqueio && (
                  <p className="text-[11px] text-warning-600 dark:text-warning-100">{e.bloqueio}</p>
                )}
              </li>
            );
          })}
        </ol>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <h2 className="text-lg font-semibold text-[#172B4D] dark:text-white mb-3">Ações da avaliação</h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => onNavigate('generate-card', dados.external_id)} icon={<Printer size={15} aria-hidden />}>
              Gerar cartões
            </Button>
            <Button variant="secondary" onClick={() => onNavigate('correct-card', dados.external_id)} icon={<ScanLine size={15} aria-hidden />}>
              Nova leitura
            </Button>
            <Button variant="secondary" onClick={() => onNavigate('pending', dados.external_id)} icon={<ShieldCheck size={15} aria-hidden />}>
              Revisões pendentes
            </Button>
            <Button variant="secondary" onClick={() => onNavigate('dashboard', dados.external_id)} icon={<ListChecks size={15} aria-hidden />}>
              Resultados
            </Button>
            <Button variant="secondary" onClick={() => onNavigate('reports')} icon={<FileText size={15} aria-hidden />}>
              Relatórios
            </Button>
          </div>

          {transicoes.length > 0 && (
            <div className="mt-4 border-t border-line pt-4 dark:border-gray-800">
              <p className="text-sm text-[#71809A] dark:text-gray-400 mb-2">Mudança manual de situação</p>
              <div className="flex flex-wrap gap-2">
                {transicoes.map(t => {
                  const msg = transicaoInvalida(dados.status_efetivo, t.alvo);
                  return (
                    <Button
                      key={t.alvo}
                      variant={t.alvo === 'arquivada' ? 'danger' : 'secondary'}
                      disabled={!!msg}
                      loading={ocupado}
                      onClick={() => t.alvo === 'arquivada' ? setConfirmarArquivar(true) : void marcarImpressa()}
                      title={msg ?? undefined}
                    >
                      {t.rotulo}
                    </Button>
                  );
                })}
              </div>
              {dados.status_efetivo === 'corrigida' && (
                <Button className="mt-2" onClick={() => setConfirmarPublicar(true)} disabled={dados.resultados_publicados_em != null}>
                  Publicar resultados
                </Button>
              )}
            </div>
          )}
        </Card>

        <Card className="space-y-4">
          <h2 className="text-lg font-semibold text-[#172B4D] dark:text-white">Turmas participantes</h2>
          {dados.turmas?.length ? (
            <ul className="divide-y divide-line rounded-[10px] border border-line dark:divide-gray-800 dark:border-gray-800">
              {dados.turmas.map(t => (
                <li key={t.id} className="flex items-center gap-2 px-3 py-2">
                  <GraduationCap size={15} className="text-brand-600 dark:text-brand-200 shrink-0" aria-hidden />
                  <span className="text-sm text-[#172B4D] dark:text-gray-100 truncate">{t.nome}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    onClick={async () => {
                      try {
                        await desvincularTurma(dados.external_id, t.id);
                        await carregar(dados.external_id);
                      } catch (err) {
                        setErro(err instanceof Error ? err.message : 'Falha ao desvincular a turma.');
                      }
                    }}
                  >
                    Remover
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="Nenhuma turma vinculada"
              description="Vincule ao menos uma turma para gerar os cartões."
              icon={<GraduationCap size={22} strokeWidth={1.5} aria-hidden />}
            />
          )}

          {turmasFora.length > 0 && (
            <div>
              <p className="label">Adicionar turma</p>
              <div className="flex flex-wrap gap-2">
                {turmasFora.map(t => (
                  <Button
                    key={t.id}
                    size="sm"
                    variant="secondary"
                    icon={<Upload size={14} aria-hidden />}
                    onClick={async () => {
                      try {
                        await vincularTurma(dados.external_id, t.id);
                        await carregar(dados.external_id);
                      } catch (err) {
                        setErro(err instanceof Error ? err.message : 'Falha ao vincular a turma.');
                      }
                    }}
                  >
                    {t.nome}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-line pt-4 dark:border-gray-800">
            <p className="label">Identificação</p>
            <p className="text-sm text-[#71809A] dark:text-gray-400">
              Cada cartão tem QR único vinculado a aluno, avaliação e prova. O nome do aluno
              nunca é usado como identificador.
            </p>
            {dados.resultados_publicados_em && (
              <p className="mt-2 text-sm text-success-600 dark:text-success-100">
                Resultados publicados em {new Date(dados.resultados_publicados_em).toLocaleString('pt-BR')}.
              </p>
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <div className="section-header mb-3">
            <h2 className="text-lg font-semibold text-[#172B4D] dark:text-white">Leituras registradas</h2>
            <Badge tone={leituras.some(l => l.status === 'pendente') ? 'warning' : 'success'}>
              {leituras.filter(l => l.status === 'pendente').length} pendente(s)
            </Badge>
          </div>
          {leituras.length === 0 ? (
            <EmptyState
              title="Nenhuma leitura registrada"
              description="As leituras aparecem aqui com histórico e correções manuais."
              icon={<ScanLine size={22} strokeWidth={1.5} aria-hidden />}
            />
          ) : (
            <ul className="divide-y divide-line rounded-[10px] border border-line dark:divide-gray-800 dark:border-gray-800 max-h-72 overflow-y-auto">
              {leituras.map(l => (
                <li key={l.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="font-mono text-xs text-[#71809A] dark:text-gray-400">{l.codigo_unico ?? '—'}</span>
                  <Badge tone={l.status === 'pendente' ? 'warning' : l.status === 'revisada' ? 'info' : 'success'}>
                    {l.status}
                  </Badge>
                  {l.nota != null && <span className="text-sm font-semibold text-brand-600 dark:text-brand-200">Nota {l.nota}</span>}
                  {l.parent_id != null && <span className="text-xs text-[#71809A] dark:text-gray-400">reprocessada</span>}
                  {(l.baixa_confianca?.length || l.duplicadas?.length) ? (
                    <span className="text-xs text-warning-600 dark:text-warning-100">
                      {l.duplicadas?.length ? `${l.duplicadas.length} duplicada(s) ` : ''}
                      {l.baixa_confianca?.length ? `${l.baixa_confianca.length} incerta(s)` : ''}
                    </span>
                  ) : null}
                  <div className="ml-auto flex items-center gap-2">
                    {l.status === 'pendente' && (
                      <Button size="sm" variant="secondary" onClick={() => abrirRevisao(l)}>
                        Revisar
                      </Button>
                    )}
                    <span className="text-xs text-[#71809A] dark:text-gray-400">
                      {l.criada_em ? new Date(l.criada_em).toLocaleString('pt-BR') : ''}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-[#172B4D] dark:text-white mb-3">Histórico e auditoria</h2>
          {eventos.length === 0 ? (
            <EmptyState
              title="Sem histórico"
              description="Criação, mudanças de status e gabarito ficam registrados aqui."
              icon={<KeyRound size={22} strokeWidth={1.5} aria-hidden />}
            />
          ) : (
            <ul className="divide-y divide-line rounded-[10px] border border-line dark:divide-gray-800 dark:border-gray-800 max-h-72 overflow-y-auto">
              {eventos.map((ev, i) => (
                <li key={`${ev.data}-${i}`} className="px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-[#172B4D] dark:text-gray-100">{ev.resumo ?? ev.tipo}</span>
                    <span className="text-xs text-[#71809A] dark:text-gray-400">
                      {ev.data ? new Date(ev.data).toLocaleString('pt-BR') : ''}
                    </span>
                  </div>
                  <p className="text-xs text-[#71809A] dark:text-gray-400">
                    {ev.autor ? `por ${ev.autor}` : 'sistema'} · {ev.tipo}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {etapaPreparacao?.status !== 'concluida' && (
        <Card className="border-warning-500/30 bg-warning-50/40 dark:bg-warning-500/5">
          <p className="text-sm text-warning-600 dark:text-warning-100">
            Complete a preparação: vincule turmas, materialize os alunos e cadastre o gabarito oficial.
          </p>
        </Card>
      )}

      <ConfirmModal
        open={confirmarPublicar}
        onClose={() => setConfirmarPublicar(false)}
        onConfirm={() => void publicar()}
        title="Publicar resultados?"
        confirmLabel="Publicar"
        loading={publicando}
        message="Os resultados passam a ser oficiais desta avaliação. A publicação só é permitida quando não há leituras aguardando revisão."
      />

      <ConfirmModal
        open={confirmarArquivar}
        onClose={() => setConfirmarArquivar(false)}
        onConfirm={() => void arquivar()}
        title="Arquivar avaliação?"
        confirmLabel="Arquivar"
        loading={ocupado}
        message="A avaliação sai do fluxo ativo e passa para o histórico. Os resultados permanecem consultáveis."
      />

      <Modal
        open={revisando !== null}
        onClose={() => setRevisando(null)}
        title="Revisar leitura"
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setRevisando(null)} disabled={salvandoRevisao}>
              Cancelar
            </Button>
            <Button onClick={() => void salvarRevisao()} loading={salvandoRevisao}>
              Confirmar revisão
            </Button>
          </>
        }
      >
        {revisando && (
          <div className="space-y-4">
            <p className="text-sm text-[#71809A] dark:text-gray-400">
              Confirme as respostas do cartão <strong className="font-mono">{revisando.codigo_unico ?? '—'}</strong>.
              Cada alteração fica registrada com autor e data.
            </p>

            {(revisando.duplicadas?.length || revisando.baixa_confianca?.length) ? (
              <div className="callout-warning text-xs">
                {revisando.duplicadas?.length ? `Duplicadas: Q${revisando.duplicadas.join(', Q')}. ` : ''}
                {revisando.baixa_confianca?.length ? `Baixa confiança: Q${revisando.baixa_confianca.join(', Q')}.` : ''}
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.keys(respostasRevisao)
                .map(Number)
                .sort((a, b) => a - b)
                .map(q => (
                  <Field key={q} label={`Q${q}`} htmlFor={`rev-${q}`}>
                    <Select
                      id={`rev-${q}`}
                      value={respostasRevisao[q]}
                      onChange={e => setRespostasRevisao(v => ({ ...v, [q]: e.target.value }))}
                    >
                      <option value="">Em branco</option>
                      {['A', 'B', 'C', 'D'].map(l => (
                        <option key={l} value={l}>{l}</option>
                      ))}
                    </Select>
                  </Field>
                ))}
            </div>

            <Field label="Observação (opcional)" htmlFor="rev-obs">
              <Input
                id="rev-obs"
                type="text"
                value={obsRevisao}
                onChange={e => setObsRevisao(e.target.value)}
                placeholder="Ex: marcação fraca corrigida na foto original"
                autoComplete="off"
              />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
