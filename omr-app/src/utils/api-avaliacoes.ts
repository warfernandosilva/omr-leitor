// ─── Cliente do ciclo de vida de avaliações (Fase 1) ───
// Consome /api/avaliacoes/* e /api/provas/* preservados em main.py: os
// endpoints antigos de provas, alunos, gabaritos e leitura seguem iguais.

import { apiFetchTimeout as fetchTimeout, apiAuthHeaders as authHeaders, API_BASE_URL } from './api';

export type StatusAvaliacao = import('./workflow').StatusAvaliacao;

export interface EtapaDTO {
  id: string;
  label: string;
  status: 'pendente' | 'atual' | 'concluida' | 'bloqueada';
  detalhe: string;
  acao?: string | null;
  habilitada: boolean;
  bloqueio?: string | null;
}

export interface ProvaDTO {
  id: number;
  external_id: string;
  titulo: string;
  descricao?: string | null;
  disciplina?: string | null;
  subject_lp: string;
  subject_mat: string;
  questions_per_subject: number;
  total_questions: number;
  layout_mode: string;
  template: string;
  grade_scale: string;
  created_at: string | null;
}

export interface AvaliacaoDTO {
  id: number;
  external_id: string;
  titulo: string;
  descricao?: string | null;
  ano_letivo?: string | null;
  turma?: string | null;
  turma_id?: number | null;
  custom_template_id?: number | null;
  template: string;
  layout_mode: string;
  questions_per_subject: number;
  subject_lp: string;
  subject_mat: string;
  grade_scale: string;
  answer_key: Record<number, string> | null;
  gabarito_versao?: number | null;
  status_derivado: StatusAvaliacao;
  status_label: string;
  status_registrado: string;
  status_efetivo: StatusAvaliacao;
  etapas?: EtapaDTO[] | null;
  proxima_acao?: { etapa: string; acao: string } | null;
  bloqueios: string[];
  progresso: number;
  prova?: ProvaDTO | null;
  turmas?: { id: number; nome: string; ano_letivo?: string | null; arquivada?: boolean }[];
  resultados_publicados_em: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface EventoDTO {
  tipo: string;
  resumo?: string | null;
  autor?: string | null;
  antes?: unknown;
  depois?: unknown;
  data: string | null;
}

export interface LeituraDTO {
  id: number;
  codigo_unico?: string | null;
  status: string;
  respostas: Record<string, string> | null;
  baixa_confianca: number[] | null;
  duplicadas: number[] | null;
  acertos: number | null;
  erros: number | null;
  brancos: number | null;
  nota: number | null;
  parent_id: number | null;
  operador?: string | null;
  criada_em: string | null;
  revisada_em: string | null;
  aluno: { id: number } | null;
}

export interface OperacaoResumo {
  turmas: number;
  alunos: number;
  avaliacoes: number;
  por_status: Record<string, number>;
  pendencias: {
    external_id: string;
    titulo: string;
    etapa: string;
    acao: string;
    status: string;
    status_label: string;
    progresso: number;
  }[];
  alertas: { tipo: string; external_id: string; titulo: string; mensagem: string }[];
}

// API_BASE_URL já traz o host ('' = mesma origem); o prefixo /api é fixo em
// todas as rotas deste cliente.
const BASE = `${API_BASE_URL}/api`;

async function parse<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetchTimeout(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init?.headers || {}) },
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j?.detail) detail = String(j.detail);
    } catch { /* resposta sem JSON */ }
    throw new Error(detail);
  }
  return res.json();
}

// ─── Provas (estrutura reutilizável) ───

export async function listProvas(q?: string): Promise<(ProvaDTO & { avaliacoes_usando: number })[]> {
  const qs = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  const j = await parse<{ provas: (ProvaDTO & { avaliacoes_usando: number })[] }>(`/provas${qs}`);
  return j.provas;
}

export async function createProva(payload: {
  titulo: string;
  descricao?: string | null;
  subjectLP?: string;
  subjectMat?: string;
  questionsPerSubject?: number;
  layoutMode?: string;
  template?: string;
  gradeScale?: string;
}): Promise<ProvaDTO> {
  return parse<ProvaDTO>('/provas', { method: 'POST', body: JSON.stringify(payload) });
}

export async function duplicarProva(provaId: number): Promise<ProvaDTO & { avaliacoes_usando: number }> {
  return parse<ProvaDTO & { avaliacoes_usando: number }>(
    `/provas/${provaId}/duplicar`, { method: 'POST', body: '{}' },
  );
}

// ─── Avaliações ───

export interface AvaliacaoCreatePayload {
  titulo: string;
  descricao?: string | null;
  ano_letivo?: string | null;
  prova_id?: number;
  prova_external_id?: string;
  subjectLP?: string;
  subjectMat?: string;
  questionsPerSubject?: number;
  layoutMode?: string;
  template?: string;
  gradeScale?: string;
  customTemplateId?: number;
  turma_ids?: number[];
}

export async function listAvaliacoes(filtros?: {
  status?: string;
  turma_id?: number;
  q?: string;
}): Promise<AvaliacaoDTO[]> {
  const qs = new URLSearchParams();
  if (filtros?.status) qs.set('status', filtros.status);
  if (filtros?.turma_id != null) qs.set('turma_id', String(filtros.turma_id));
  if (filtros?.q?.trim()) qs.set('q', filtros.q.trim());
  const s = qs.toString();
  const j = await parse<{ avaliacoes: AvaliacaoDTO[] }>(`/avaliacoes${s ? `?${s}` : ''}`);
  return j.avaliacoes;
}

export async function getAvaliacao(externalId: string): Promise<AvaliacaoDTO> {
  return parse<AvaliacaoDTO>(`/avaliacoes/${encodeURIComponent(externalId)}`);
}

export async function createAvaliacao(payload: AvaliacaoCreatePayload): Promise<AvaliacaoDTO> {
  return parse<AvaliacaoDTO>('/avaliacoes', { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateAvaliacao(
  externalId: string,
  payload: { titulo?: string; descricao?: string; ano_letivo?: string },
): Promise<AvaliacaoDTO> {
  return parse<AvaliacaoDTO>(`/avaliacoes/${encodeURIComponent(externalId)}`, {
    method: 'PATCH', body: JSON.stringify(payload),
  });
}

export async function mudarStatus(externalId: string, status: string): Promise<AvaliacaoDTO> {
  return parse<AvaliacaoDTO>(`/avaliacoes/${encodeURIComponent(externalId)}/status`, {
    method: 'PATCH', body: JSON.stringify({ status }),
  });
}

export async function vincularTurma(externalId: string, turmaId: number): Promise<AvaliacaoDTO> {
  return parse<AvaliacaoDTO>(`/avaliacoes/${encodeURIComponent(externalId)}/turmas`, {
    method: 'POST', body: JSON.stringify({ turma_id: turmaId }),
  });
}

export async function desvincularTurma(externalId: string, turmaId: number): Promise<AvaliacaoDTO> {
  return parse<AvaliacaoDTO>(
    `/avaliacoes/${encodeURIComponent(externalId)}/turmas/${turmaId}`, { method: 'DELETE' },
  );
}

export async function publicarResultados(externalId: string): Promise<AvaliacaoDTO> {
  return parse<AvaliacaoDTO>(`/avaliacoes/${encodeURIComponent(externalId)}/publicar`, {
    method: 'POST', body: '{}',
  });
}

export async function salvarGabaritoOficial(
  externalId: string,
  answerKey: Record<number, string>,
  observacao?: string,
): Promise<AvaliacaoDTO> {
  return parse<AvaliacaoDTO>(`/avaliacoes/${encodeURIComponent(externalId)}/gabarito`, {
    method: 'POST', body: JSON.stringify({ answer_key: answerKey, observacao: observacao ?? null }),
  });
}

export async function listLeituras(externalId: string, status?: string): Promise<LeituraDTO[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const j = await parse<{ leituras: LeituraDTO[] }>(
    `/avaliacoes/${encodeURIComponent(externalId)}/leituras${qs}`);
  return j.leituras;
}

export async function revisarLeitura(
  leituraId: number,
  respostas: Record<number, string>,
  observacao?: string,
): Promise<{ ok: boolean; leitura_id: number; status: string }> {
  return parse(`/leituras/${leituraId}/revisar`, {
    method: 'POST', body: JSON.stringify({ respostas, observacao: observacao ?? null }),
  });
}

export async function timelineAvaliacao(externalId: string): Promise<EventoDTO[]> {
  const j = await parse<{ eventos: EventoDTO[] }>(
    `/avaliacoes/${encodeURIComponent(externalId)}/timeline`);
  return j.eventos;
}

export async function resumoOperacao(): Promise<OperacaoResumo> {
  return parse<OperacaoResumo>('/operacao/resumo');
}

export async function alunoHistorico(alunoId: number): Promise<{
  aluno: { id: number; nome: string; matricula: string | null; situacao: string };
  avaliacoes: {
    avaliacao_id: number;
    external_id: string;
    titulo: string;
    ano_letivo: string | null;
    turma: string | null;
    status: string;
    status_label: string;
    progresso: number;
    ultima_nota: number | null;
    melhor_nota: number | null;
  }[];
}> {
  return parse(`/alunos/${alunoId}/historico`);
}
