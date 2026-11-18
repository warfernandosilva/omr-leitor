// ─── Turma de um resultado corrigido ───
//
// A turma certa de um cartão corrigido é a turma do ALUNO (catálogo de
// origem). `avaliacao.turma`/`turma_id` guarda apenas a primeira turma
// vinculada à avaliação: usá-lo atribuía todos os cartões de uma avaliação
// multi-turma a uma única turma. Este helper resolve a turma por resultado e
// é compartilhado pelo histórico de correções e pelos relatórios.

import type { DBResultado } from './api';

export interface TurmaRef {
  id: number | null;
  nome: string | null;
}

function limparNome(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function limparId(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Monta uma referência de turma só se sobrar alguma informação útil. */
function turmaValida(id: number | null, nome: string | null): TurmaRef | null {
  if (id == null && !nome) return null;
  return { id, nome };
}

/** Turma do aluno, quando o servidor a informou (`aluno.turma*`). */
function turmaDoAluno(aluno: DBResultado['aluno'] | undefined): TurmaRef | null {
  return turmaValida(limparId(aluno?.turma_id), limparNome(aluno?.turma));
}

/** Turma única da avaliação (usada quando o aluno não tem origem no catálogo). */
function turmaUnicaDaAvaliacao(avaliacao: DBResultado['avaliacao'] | undefined): TurmaRef | null {
  const turmas = avaliacao?.turmas ?? [];
  if (turmas.length !== 1) return null;
  return turmaValida(limparId(turmas[0]?.id), limparNome(turmas[0]?.nome));
}

/** Turma legada da avaliação (primeira vinculada) — último recurso. */
function turmaLegada(avaliacao: DBResultado['avaliacao'] | undefined): TurmaRef | null {
  return turmaValida(limparId(avaliacao?.turma_id), limparNome(avaliacao?.turma));
}

/**
 * Mapa `codigo_unico → turma do aluno`.
 *
 * Ordem de preferência: turma do aluno (catálogo) → turma única da avaliação
 * → turma legada da avaliação.
 */
export function turmaPorResultado(db: DBResultado[]): Map<string, TurmaRef> {
  const mapa = new Map<string, TurmaRef>();
  for (const r of db) {
    if (!r?.codigo_unico || mapa.has(r.codigo_unico)) continue;
    const turma = turmaDoAluno(r.aluno)
      ?? turmaUnicaDaAvaliacao(r.avaliacao)
      ?? turmaLegada(r.avaliacao);
    if (turma) mapa.set(r.codigo_unico, turma);
  }
  return mapa;
}

/** Turma de um resultado, com fallback para a prova local (resultado só neste aparelho). */
export function turmaDoResultado(
  codigoUnico: string | undefined,
  mapa: Map<string, TurmaRef>,
  fallback?: TurmaRef | null,
): TurmaRef | null {
  if (codigoUnico) {
    const t = mapa.get(codigoUnico);
    if (t) return t;
  }
  if (!fallback) return null;
  return turmaValida(limparId(fallback.id), limparNome(fallback.nome));
}

/** true quando o resultado pertence à turma filtrada (por id ou por nome). */
export function casaComTurma(
  turma: TurmaRef | null,
  filtroId: string,
  turmas: { id: number; nome: string }[],
): boolean {
  if (!filtroId) return true;
  if (!turma) return false;
  if (turma.id != null && String(turma.id) === filtroId) return true;
  const alvo = turmas.find(t => String(t.id) === filtroId);
  return alvo != null && turma.nome === alvo.nome;
}