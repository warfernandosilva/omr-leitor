import type { Exam } from '../types';

/**
 * Prova vinculada à turma.
 *
 * Pode haver várias provas para a mesma turma (atividades diferentes): usa a
 * mais recente na ordem de criação. Provas arquivadas só entram se não houver
 * nenhuma outra.
 */
export function linkedExamForTurma(exams: Exam[], turmaId: number): Exam | undefined {
  const linked = exams.filter(e => e.turmaId === turmaId);
  if (linked.length === 0) return undefined;
  const open = linked.filter(e => e.status !== 'arquivada');
  const pool = open.length > 0 ? open : linked;
  return pool[pool.length - 1];
}
