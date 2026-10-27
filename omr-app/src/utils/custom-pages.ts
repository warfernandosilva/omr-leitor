/**
 * Regras de páginas do Gabarito Personalizado multi-página.
 *
 * O cartão é a mesma folha lida em várias capturas (uma por página). As
 * respostas de cada página são acumuladas: ao reler uma página, só as questões
 * dela são substituídas — as demais páginas ficam intactas.
 */

/** Páginas (0-based) ainda não lidas, em ordem crescente. */
export function missingPages(readPages: ReadonlySet<number>, nPages: number): number[] {
  const total = Math.max(1, Math.floor(nPages) || 1);
  return Array.from({ length: total }, (_, i) => i).filter((i) => !readPages.has(i));
}

/** Primeira página ainda não lida; undefined quando todas já foram lidas. */
export function nextUnreadPage(readPages: ReadonlySet<number>, nPages: number): number | undefined {
  return missingPages(readPages, nPages)[0];
}

/**
 * Acumula as respostas de uma página nas respostas já lidas.
 *
 * `answers` são as respostas da página recém-lida e `pageQuestions` são as
 * questões que pertencem a ela: as respostas antigas dessas questões são
 * descartadas (evita resposta velha em releitura) e as das outras páginas são
 * preservadas.
 */
export function mergePageAnswers(
  prev: Readonly<Record<number, string>>,
  answers: Readonly<Record<number, string>>,
  pageQuestions: Iterable<number>,
): Record<number, string> {
  const pageSet = new Set(pageQuestions);
  const kept = Object.entries(prev).filter(([question]) => !pageSet.has(Number(question)));
  return { ...Object.fromEntries(kept), ...answers };
}
