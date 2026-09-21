// ─── PWA: registro condicional do service worker + aviso de atualização ───
// Usa o gate puro de utils/pwa-gate (testável). Este módulo importa o
// módulo virtual 'virtual:pwa-register' e por isso nunca deve ser
// importado por testes unitários — só pelo App em runtime com o plugin.
import { registerSW } from 'virtual:pwa-register';
import { shouldRegisterPwa } from './utils/pwa-gate';

export const PWA_UPDATE_EVENT = 'pwa-update-available';

let applyUpdate: (() => void) | null = null;

export function initPwa(): void {
  if (typeof window === 'undefined') return;
  const ok = shouldRegisterPwa({
    protocol: window.location.protocol,
    secureContext: window.isSecureContext,
    hasServiceWorker: 'serviceWorker' in navigator,
    isDev: import.meta.env.DEV,
  });
  if (!ok) return;
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      applyUpdate = () => updateSW(true);
      window.dispatchEvent(new CustomEvent(PWA_UPDATE_EVENT));
    },
  });
}

/** Chamado pelo banner "Nova versão" — ativa o SW novo e recarrega. */
export function applyPwaUpdate(): void {
  if (applyUpdate) applyUpdate();
  else window.location.reload();
}
