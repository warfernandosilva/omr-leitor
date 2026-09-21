import { describe, it, expect } from 'vitest';
import { shouldRegisterPwa } from './pwa-gate';
import type { PwaContext } from './pwa-gate';

const base: PwaContext = {
  protocol: 'https:',
  secureContext: true,
  hasServiceWorker: true,
  isDev: false,
};

describe('shouldRegisterPwa', () => {
  it('registra em https (ngrok/produção)', () => {
    expect(shouldRegisterPwa(base)).toBe(true);
  });

  it('registra em localhost http (contexto seguro)', () => {
    expect(shouldRegisterPwa({ ...base, protocol: 'http:' })).toBe(true);
  });

  it('não registra em dev (sem SW gerado)', () => {
    expect(shouldRegisterPwa({ ...base, isDev: true })).toBe(false);
  });

  it('não registra em http de LAN (não é contexto seguro)', () => {
    expect(shouldRegisterPwa({ ...base, protocol: 'http:', secureContext: false })).toBe(false);
  });

  it('não registra em file:// (Electron)', () => {
    expect(shouldRegisterPwa({ ...base, protocol: 'file:', secureContext: false })).toBe(false);
  });

  it('não registra sem suporte a service worker', () => {
    expect(shouldRegisterPwa({ ...base, hasServiceWorker: false })).toBe(false);
  });
});
