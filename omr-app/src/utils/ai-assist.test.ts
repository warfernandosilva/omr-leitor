import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_ENABLED_KEY,
  getAiStatus,
  hasFaintMark,
  isAiAssistEnabled,
  setAiAssistEnabled,
  suggestCorrection,
} from './ai-assist';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('preferência do assistente', () => {
  it('começa desligado', () => {
    expect(isAiAssistEnabled()).toBe(false);
  });

  it('persiste a escolha', () => {
    setAiAssistEnabled(true);
    expect(isAiAssistEnabled()).toBe(true);
    expect(localStorage.getItem(AI_ENABLED_KEY)).toBe('1');
    setAiAssistEnabled(false);
    expect(isAiAssistEnabled()).toBe(false);
  });
});

describe('hasFaintMark', () => {
  it('ignora linha sem tinta (ruído do branco)', () => {
    expect(hasFaintMark({ A: 0.011, B: 0.011, C: 0.011, D: 0.011 })).toBe(false);
    expect(hasFaintMark(null)).toBe(false);
  });

  it('ignora cartão impresso sem marca (fundo já pontua)', () => {
    // medido no cartão real: vazio fica 0.011 acima da segunda bolha
    expect(hasFaintMark({ A: 0.023, B: 0.045, C: 0.092, D: 0.103 })).toBe(false);
    expect(hasFaintMark({ A: 0.12, B: 0.11, C: 0.12, D: 0.1 })).toBe(false);
  });

  it('aceita marca fraca que o OMR deu como em branco', () => {
    expect(hasFaintMark({ A: 0.011, B: 0.011, C: 0.086, D: 0.011 })).toBe(true);
    // cinza 200 no cartão real: C abre 0.039 sobre a segunda
    expect(hasFaintMark({ A: 0.023, B: 0.043, C: 0.165, D: 0.103 })).toBe(true);
  });
});

describe('getAiStatus', () => {
  it('devolve o status do Ollama', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      available: true, url: 'http://localhost:11434', model: 'moondream',
      models: ['moondream:latest'], error: null,
    }));
    const status = await getAiStatus();
    expect(status.available).toBe(true);
    expect(status.model).toBe('moondream');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/ai/status'),
      expect.any(Object),
    );
  });
});

describe('suggestCorrection', () => {
  it('devolve a sugestão', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      ok: true, suggestion: 'C', confidence: 0.8, reason: 'maior score',
      source: 'model', model: 'moondream',
    }));
    const s = await suggestCorrection({ image: 'data:image/jpeg;base64,AA', question: 4 });
    expect(s.suggestion).toBe('C');
    expect(s.confidence).toBe(0.8);
  });

  it('transforma erro do backend em Error amigável', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      ok: false, error: 'Ollama não encontrado.',
    }));
    await expect(suggestCorrection({ image: 'data:image/jpeg;base64,AA', question: 1 }))
      .rejects.toThrow('Ollama não encontrado.');
  });

  it('propaga erro HTTP', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ detail: 'boom' }, 500));
    await expect(suggestCorrection({ image: 'data:image/jpeg;base64,AA', question: 1 }))
      .rejects.toThrow();
  });
});

