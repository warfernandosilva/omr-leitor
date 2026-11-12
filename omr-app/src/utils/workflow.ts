// ─── Ciclo de vida da avaliação (espelho puro do backend) ───
// A mesma semântica de `omr-backend/workflow/status.py`. O servidor é a fonte
// oficial (usa os dados do banco); este espelho serve para a UI mostrar o
// fluxo com o cache local quando o backend está fora do ar. Os dois lados têm
// testes próprios para a conta não divergir.

export type StatusAvaliacao =
  | 'rascunho'
  | 'em_preparacao'
  | 'pronta_impressao'
  | 'impressa'
  | 'em_aplicacao'
  | 'aguardando_correcao'
  | 'em_correcao'
  | 'aguardando_revisao'
  | 'corrigida'
  | 'publicados'
  | 'arquivada';

export const STATUS_ORDEM: StatusAvaliacao[] = [
  'rascunho', 'em_preparacao', 'pronta_impressao', 'impressa', 'em_aplicacao',
  'aguardando_correcao', 'em_correcao', 'aguardando_revisao', 'corrigida',
  'publicados', 'arquivada',
];

export const STATUS_LABEL: Record<StatusAvaliacao, string> = {
  rascunho: 'Rascunho',
  em_preparacao: 'Em preparação',
  pronta_impressao: 'Pronta para impressão',
  impressa: 'Impressa',
  em_aplicacao: 'Em aplicação',
  aguardando_correcao: 'Aguardando correção',
  em_correcao: 'Em correção',
  aguardando_revisao: 'Aguardando revisão',
  corrigida: 'Corrigida',
  publicados: 'Resultados publicados',
  arquivada: 'Arquivada',
};

export type EtapaId =
  | 'preparacao' | 'impressao' | 'aplicacao' | 'leitura' | 'revisao' | 'resultados';

export const ETAPA_LABEL: Record<EtapaId, string> = {
  preparacao: 'Preparação',
  impressao: 'Impressão',
  aplicacao: 'Aplicação',
  leitura: 'Leitura',
  revisao: 'Revisão',
  resultados: 'Resultados',
};

/** Transição manual permitida por estado (espelho de TRANSICOES_MANUAIS). */
const TRANSICOES_MANUAIS: Record<StatusAvaliacao, StatusAvaliacao[]> = {
  rascunho: [],
  em_preparacao: [],
  pronta_impressao: ['impressa', 'em_aplicacao'],
  impressa: ['em_aplicacao'],
  em_aplicacao: ['aguardando_correcao', 'em_correcao'],
  aguardando_correcao: ['em_correcao'],
  em_correcao: ['aguardando_correcao', 'aguardando_revisao', 'corrigida'],
  aguardando_revisao: ['corrigida'],
  corrigida: ['publicados', 'arquivada'],
  publicados: ['arquivada'],
  arquivada: [],
};

export interface ContadoresFluxo {
  alunos: number;
  turmas: number;
  temGabarito: boolean;
  cartoesGerados: number;
  cartoesRecebidos: number;
  cartoesLidos: number;
  cartoesCorrigidos: number;
  revisoesPendentes: number;
  resultadosPublicados: boolean;
  arquivada: boolean;
}

export type EtapaStatus = 'pendente' | 'atual' | 'concluida' | 'bloqueada';

/** Cor do selo de status (compartilhada pelas telas de avaliação). */
export const AVALIACAO_STATUS_TONE: Record<StatusAvaliacao, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  rascunho: 'neutral',
  em_preparacao: 'info',
  pronta_impressao: 'info',
  impressa: 'info',
  em_aplicacao: 'info',
  aguardando_correcao: 'warning',
  em_correcao: 'warning',
  aguardando_revisao: 'warning',
  corrigida: 'success',
  publicados: 'success',
  arquivada: 'neutral',
};

export interface Etapa {
  id: EtapaId;
  label: string;
  status: EtapaStatus;
  detalhe: string;
  acao?: string;
  habilitada: boolean;
  bloqueio?: string | null;
}

export interface FluxoAvaliacao {
  status: StatusAvaliacao;
  etapas: Etapa[];
  proximaAcao: Etapa | null;
  bloqueios: string[];
  progresso: number;
}

function etapasBase(): Etapa[] {
  return [
    { id: 'preparacao', label: ETAPA_LABEL.preparacao, status: 'pendente', detalhe: '', habilitada: true },
    { id: 'impressao', label: ETAPA_LABEL.impressao, status: 'pendente', detalhe: '', habilitada: true },
    { id: 'aplicacao', label: ETAPA_LABEL.aplicacao, status: 'pendente', detalhe: '', habilitada: true },
    { id: 'leitura', label: ETAPA_LABEL.leitura, status: 'pendente', detalhe: '', habilitada: true },
    { id: 'revisao', label: ETAPA_LABEL.revisao, status: 'pendente', detalhe: '', habilitada: true },
    { id: 'resultados', label: ETAPA_LABEL.resultados, status: 'pendente', detalhe: '', habilitada: true },
  ];
}

/** Deriva etapas, status e próxima ação a partir dos números reais (função pura). */
export function calcularFluxo(c: ContadoresFluxo): FluxoAvaliacao {
  if (c.arquivada) {
    const et = etapasBase().map(e => ({ ...e, status: 'concluida' as EtapaStatus }));
    return { status: 'arquivada', etapas: et, proximaAcao: null, bloqueios: [], progresso: 100 };
  }

  const et = etapasBase();
  const bloqueios: string[] = [];

  const preparacaoOk = c.alunos > 0 && c.turmas > 0 && c.temGabarito;
  if (c.turmas === 0) bloqueios.push('Nenhuma turma vinculada à avaliação.');
  if (c.alunos === 0) bloqueios.push('Nenhum aluno selecionado.');
  if (!c.temGabarito) bloqueios.push('Gabarito oficial não cadastrado.');
  et[0].status = preparacaoOk ? 'concluida' : 'pendente';
  et[0].detalhe = `${c.alunos} aluno(s) · ${c.turmas} turma(s)`;

  et[1].status = c.cartoesGerados > 0 ? 'concluida' : preparacaoOk ? 'pendente' : 'bloqueada';
  et[1].bloqueio = preparacaoOk ? null : 'Conclua a preparação primeiro';
  et[1].detalhe = `${c.cartoesGerados} cartão(ões)`;

  et[2].status = c.cartoesRecebidos > 0 ? 'concluida' : c.cartoesGerados === 0 ? 'bloqueada' : 'pendente';
  et[2].bloqueio = c.cartoesGerados === 0 ? 'Gere os cartões primeiro' : null;
  et[2].detalhe = `${c.cartoesRecebidos} cartão(ões) recebido(s)`;

  et[3].status = c.cartoesCorrigidos > 0
    ? (c.cartoesLidos >= c.cartoesGerados && c.revisoesPendentes === 0 ? 'concluida' : 'atual')
    : c.cartoesRecebidos === 0 ? 'bloqueada' : 'pendente';
  et[3].detalhe = `${c.cartoesCorrigidos}/${c.cartoesGerados} corrigido(s)`;

  et[4].status = c.revisoesPendentes > 0
    ? 'atual'
    : c.cartoesCorrigidos > 0 ? 'concluida' : 'bloqueada';
  et[4].bloqueio = c.revisoesPendentes > 0 ? null : 'Conclua a leitura primeiro';
  et[4].detalhe = `${c.revisoesPendentes} revisão(ões) pendente(s)`;

  const publicado = c.resultadosPublicados;
  et[5].status = publicado
    ? 'concluida'
    : (c.revisoesPendentes > 0 || c.cartoesCorrigidos === 0) ? 'bloqueada' : 'pendente';
  et[5].bloqueio = c.revisoesPendentes > 0
    ? 'Resolva as revisões pendentes'
    : c.cartoesCorrigidos === 0 ? 'Conclua as correções' : null;

  let status: StatusAvaliacao;
  if (c.cartoesGerados === 0) status = c.alunos > 0 ? 'em_preparacao' : 'rascunho';
  else if (c.cartoesRecebidos === 0) status = 'pronta_impressao';
  else if (c.revisoesPendentes > 0) status = 'aguardando_revisao';
  else if (c.cartoesCorrigidos === 0) status = 'aguardando_correcao';
  else if (c.cartoesCorrigidos < c.cartoesGerados) status = 'em_correcao';
  else status = 'corrigida';
  if (publicado) status = 'publicados';

  let proxima: Etapa | null = null;
  if (!preparacaoOk) {
    et[0].acao = 'Concluir cadastro';
    proxima = et[0];
  } else if (c.cartoesGerados === 0) {
    et[1].acao = 'Gerar cartões';
    proxima = et[1];
  } else if (c.revisoesPendentes > 0) {
    et[4].acao = 'Revisar correções';
    proxima = et[4];
  } else if (c.cartoesCorrigidos === 0) {
    et[3].acao = c.cartoesRecebidos > 0 ? 'Corrigir cartões' : 'Iniciar leitura';
    proxima = et[3];
  } else if (!publicado) {
    et[5].acao = 'Publicar resultados';
    proxima = et[5];
  } else {
    et[5].acao = 'Ver resultados publicados';
    proxima = et[5];
  }

  const concluidas = et.filter(e => e.status === 'concluida').length;
  return {
    status,
    etapas: et,
    proximaAcao: proxima,
    bloqueios,
    progresso: Math.round((concluidas * 100) / et.length),
  };
}

/** Valida uma transição manual. Devolve `null` quando é permitida. */
export function transicaoInvalida(atual: StatusAvaliacao, alvo: StatusAvaliacao): string | null {
  if (atual === alvo) return null;
  const permitidas = TRANSICOES_MANUAIS[atual] ?? [];
  if (permitidas.includes(alvo)) return null;
  const lista = permitidas.map(s => STATUS_LABEL[s]).join(', ') || 'nenhuma';
  return `De '${STATUS_LABEL[atual]}' só é possível ir para: ${lista}.`;
}

/** Estado mais avançado entre o registrado e o derivado (o que a tela mostra). */
export function statusEfetivo(registrado: StatusAvaliacao | undefined, derivado: StatusAvaliacao): StatusAvaliacao {
  if (registrado === 'arquivada' || derivado === 'arquivada') return 'arquivada';
  const r = STATUS_ORDEM.indexOf(registrado ?? 'rascunho');
  const d = STATUS_ORDEM.indexOf(derivado);
  return r > d ? (registrado as StatusAvaliacao) : derivado;
}
