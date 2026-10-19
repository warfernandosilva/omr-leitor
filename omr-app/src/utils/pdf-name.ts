/** Nome do PDF de gabaritos, identificando a ORIGEM da lista. */

export type CardSource = 'file' | 'turma';

/** Slug ASCII seguro para nome de arquivo (remove acentos e pontuação). */
export function slugify(value: string): string {
  return (value || '')
    // NFKD também decompõe "º/ª" (compatibilidade), que NFD mantém.
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * `gabaritos_<prova>_<origem>_<paginas>_paginas.pdf`
 *
 * A origem entra no nome para que os lotes de arquivo e de turma não colidam
 * (antes ambos usavam só o nome da prova e o mesmo tanto de páginas):
 * - arquivo: nome do XLSX/CSV sem extensão;
 * - turma: `turma-<nome da turma>`.
 */
export function gabaritosPdfName(
  examName: string,
  source: CardSource,
  origem: string,
  pages: number,
): string {
  const exam = slugify(examName) || 'prova';
  const raw = source === 'file' ? (origem || '').replace(/\.[^.]+$/, '') : origem;
  const originSlug = slugify(raw) || 'sem-nome';
  const tag = source === 'turma' ? `turma-${originSlug}` : originSlug;
  return `gabaritos_${exam}_${tag}_${pages}_paginas.pdf`;
}
