import { describe, it, expect, vi, afterEach } from 'vitest';
import { processImage } from './api';

let captured: { url: string; init: RequestInit }[] = [];

function stubFetch(payload: unknown) {
  captured = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    captured.push({ url, init });
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }));
}

function file(): File {
  return new File([new Uint8Array([1, 2, 3])], 'card.jpg', { type: 'image/jpeg' });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const OK = { success: true, answers: { '1': 'A' }, template_used: 'custom' };

describe('processImage envia os cantos manuais (Gabarito Personalizado)', () => {
  it('manda custom_template_id e corners quando informados', async () => {
    stubFetch(OK);
    const corners: [number, number][] = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]];
    await processImage(file(), 22, 'dual', 'custom', false, false, 7, corners);

    expect(captured[0].url).toMatch(/\/api\/omr\/process$/);
    const fd = captured[0].init.body as FormData;
    expect(fd.get('template')).toBe('custom');
    expect(fd.get('custom_template_id')).toBe('7');
    expect(JSON.parse(String(fd.get('corners')))).toEqual(corners);
  });

  it('sem corners o campo não é enviado (alinhamento automático)', async () => {
    stubFetch(OK);
    await processImage(file(), 22, 'dual', 'custom', false, false, 7);
    const fd = captured[0].init.body as FormData;
    expect(fd.get('corners')).toBeNull();
  });

  it('corners com quantidade diferente de 4 são ignorados', async () => {
    stubFetch(OK);
    await processImage(file(), 22, 'dual', 'custom', false, false, 7, [[0.1, 0.1]]);
    const fd = captured[0].init.body as FormData;
    expect(fd.get('corners')).toBeNull();
  });

  it('envia o campo page quando informado (multi-página)', async () => {
    stubFetch(OK);
    await processImage(file(), 22, 'dual', 'custom', false, false, 7, null, 2);
    const fd = captured[0].init.body as FormData;
    expect(fd.get('page')).toBe('2');
  });

  it('sem page o campo não é enviado (modelo de 1 página)', async () => {
    stubFetch(OK);
    await processImage(file(), 22, 'dual', 'custom', false, false, 7);
    const fd = captured[0].init.body as FormData;
    expect(fd.get('page')).toBeNull();
  });

  it('envia omr_overrides quando informado (configurações globais)', async () => {
    stubFetch(OK);
    await processImage(file(), 22, 'dual', 'custom', false, false, 7, null, undefined, { floor: 0.3 });
    const fd = captured[0].init.body as FormData;
    expect(JSON.parse(String(fd.get('omr_overrides')))).toEqual({ floor: 0.3 });
  });
});
