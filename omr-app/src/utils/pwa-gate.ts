// ─── PWA: decisão pura sobre registrar o service worker ───
// Só registra em contexto seguro servido por http(s): localhost (dev não,
// pois não há SW gerado) e https (ngrok/produção). Nunca em file://
// (Electron) nem em http de LAN (não é contexto seguro).
export interface PwaContext {
  protocol: string;
  secureContext: boolean;
  hasServiceWorker: boolean;
  isDev: boolean;
}

export function shouldRegisterPwa(ctx: PwaContext): boolean {
  if (ctx.isDev) return false;
  if (!ctx.hasServiceWorker) return false;
  if (!ctx.secureContext) return false;
  return ctx.protocol === 'http:' || ctx.protocol === 'https:';
}
