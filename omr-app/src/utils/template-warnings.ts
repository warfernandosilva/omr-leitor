/**
 * Avisos de completude por página do Gabarito Personalizado multi-página.
 *
 * São apenas avisos: nunca bloqueiam o salvamento. Ajudam a perceber páginas
 * vazias/sem âncoras antes de usar o modelo na correção.
 */

export type TemplateWarningCode = 'empty-page' | 'no-questions' | 'no-anchors';

export interface TemplatePageWarning {
  /** Página 0-based. */
  page: number;
  code: TemplateWarningCode;
  message: string;
}

interface TemplateConfigLike {
  n_pages?: number;
  questions?: { page?: number; n_questions?: number }[];
  anchors?: { page?: number }[];
}

function maxPage(items: { page?: number }[] | undefined): number {
  let max = 0;
  for (const item of items ?? []) max = Math.max(max, item.page ?? 0);
  return max;
}

export function pageWarnings(cfg: TemplateConfigLike): TemplatePageWarning[] {
  const declared = Math.floor(cfg.n_pages ?? 1) || 1;
  const nPages = Math.max(1, declared, maxPage(cfg.questions) + 1, maxPage(cfg.anchors) + 1);
  const out: TemplatePageWarning[] = [];

  for (let page = 0; page < nPages; page += 1) {
    const questionCount = (cfg.questions ?? [])
      .filter((b) => (b.page ?? 0) === page)
      .reduce((sum, b) => sum + Math.max(0, b.n_questions ?? 0), 0);
    const anchorCount = (cfg.anchors ?? []).filter((a) => (a.page ?? 0) === page).length;

    if (questionCount === 0 && anchorCount === 0) {
      out.push({
        page,
        code: 'empty-page',
        message: `Página ${page + 1} está sem questões e sem âncoras — será ignorada na leitura.`,
      });
    } else if (questionCount === 0) {
      out.push({
        page,
        code: 'no-questions',
        message: `Página ${page + 1} não tem questões — nenhuma resposta será lida nela.`,
      });
    } else if (anchorCount === 0) {
      out.push({
        page,
        code: 'no-anchors',
        message: `Página ${page + 1} não tem âncoras — o alinhamento pode falhar; use os cantos da folha ou adicione âncoras.`,
      });
    }
  }

  return out;
}
