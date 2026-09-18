import type { AppView } from '../types';

// ─── Persistência da navegação (sessionStorage) ───
// O Android pode descartar a aba quando o app nativo da câmera abre por cima
// (<input type=file capture>); ao voltar, a página recarrega e o useState da
// tela zera para 'home'. Persistindo a cada mudança, o boot restaura a tela
// (a Correção volta ao formulário, com a prova já selecionada).
export interface PersistedNav {
  view: AppView;
  examId?: string | null;
  resultId?: string | null;
}

const KEY = 'omr-nav';

export function saveNav(nav: PersistedNav): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(nav));
  } catch {
    /* armazenamento indisponível — segue sem restaurar */
  }
}

export function loadNav(): PersistedNav | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const nav = JSON.parse(raw) as PersistedNav;
    if (!nav || typeof nav.view !== 'string') return null;
    return nav;
  } catch {
    return null;
  }
}

export function clearNav(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignora */
  }
}
