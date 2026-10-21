import type { AlunoListItem } from './api';

// ─── Catálogo global de alunos: normalização e detecção de duplicidade ───
// Funções puras (testáveis): a tela "Alunos" agrega os TurmaAluno de todas
// as turmas; matrícula repetida ou nome normalizado igual acende o alerta.

export function normalizeName(name: string): string {
  return (name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface DuplicateGroup {
  key: string;
  kind: 'matricula' | 'nome';
  items: AlunoListItem[];
}

/** Grupos com mais de um registro (por matrícula ou por nome normalizado). */
export function findDuplicateGroups(alunos: AlunoListItem[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];

  const byMat = new Map<string, AlunoListItem[]>();
  for (const a of alunos) {
    const m = (a.matricula ?? '').trim();
    if (!m) continue;
    const list = byMat.get(m) ?? [];
    list.push(a);
    byMat.set(m, list);
  }
  for (const [key, items] of byMat) {
    if (items.length > 1) groups.push({ key, kind: 'matricula', items });
  }

  const byName = new Map<string, AlunoListItem[]>();
  for (const a of alunos) {
    const n = normalizeName(a.nome);
    if (!n) continue;
    const list = byName.get(n) ?? [];
    list.push(a);
    byName.set(n, list);
  }
  for (const [key, items] of byName) {
    if (items.length > 1) groups.push({ key, kind: 'nome', items });
  }

  return groups;
}

/** Ids de alunos que aparecem em algum grupo de duplicidade. */
export function duplicateIds(groups: DuplicateGroup[]): Set<number> {
  const ids = new Set<number>();
  for (const g of groups) for (const a of g.items) ids.add(a.id);
  return ids;
}

// ─── Autocomplete de aluno na conferência (cartão sem QR) ───
// Fonte 1: alunos da prova (ExamStudent, já inclui quem veio de turma).
// Fonte 2 (fallback): catálogo da turma vinculada (TurmaAlunoDTO) — completa
// nomes ainda não materializados; alunoId null, só preenche o nome.
// Fonte 3 (fallback global): catálogo de todas as turmas visíveis, usado só
// quando a prova não tem alunos nem turma vinculada.

export interface StudentOption {
  /** Chave React: `String(aluno_id)`, `turma:${id}` ou `catalogo:${id}`. */
  key: string;
  nome: string;
  matricula: string | null;
  /** Id do aluno NA PROVA (p/ atribuição direta); null quando vem só do catálogo. */
  alunoId: number | null;
  /** undefined = fonte catálogo (desconhecido). */
  temGabarito?: boolean;
  codigoUnico?: string | null;
  /** Nome veio de um catálogo (turma ou global) e ainda não foi materializado na prova. */
  fromTurmaOnly?: boolean;
  /** Rótulo curto da origem exibido no badge ("turma" / "catálogo"). */
  origemLabel?: string;
}

/**
 * Junta os alunos já materializados na prova com as opções do catálogo.
 * A opção da prova vence: o catálogo só completa nomes que ainda não existem
 * nela, para o autocomplete não sugerir a mesma pessoa duas vezes.
 */
export function mergeStudentOptions(
  primary: StudentOption[],
  fallback: StudentOption[],
): StudentOption[] {
  if (fallback.length === 0) return primary;
  const seen = new Set(primary.map(o => normalizeName(o.nome)));
  return [
    ...primary,
    ...fallback.filter(o => {
      const n = normalizeName(o.nome);
      return n !== '' && !seen.has(n);
    }),
  ];
}

/** Ordena e filtra sugestões: prefixo de nome primeiro, depois substring — sem acento/caixa. */
export function findStudentMatches(
  list: StudentOption[],
  query: string,
  limit = 8,
): StudentOption[] {
  const q = normalizeName(query);
  if (!q) return list.slice(0, limit);
  const prefix: StudentOption[] = [];
  const rest: StudentOption[] = [];
  for (const opt of list) {
    const name = normalizeName(opt.nome);
    const mat = (opt.matricula ?? '').trim().toLowerCase();
    if (name.startsWith(q)) prefix.push(opt);
    else if (name.includes(q) || (mat && mat.includes(q))) rest.push(opt);
  }
  return [...prefix, ...rest].slice(0, limit);
}
