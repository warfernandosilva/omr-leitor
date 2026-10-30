import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_ENABLED_KEY,
  getAiStatus,
  isAiAssistEnabled,
  readSheetWithAi,
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

describe('readSheetWithAi', () => {
  it('envia a folha e devolve as respostas', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      ok: true, answers: { '1': 'A', '2': 'C' }, missing: [3], model: 'qwen2.5vl',
    }));
    const r = await readSheetWithAi({
      image: 'data:image/jpeg;base64,AA', questions: [1, 2, 3],
    });
    expect(r.answers).toEqual({ '1': 'A', '2': 'C' });
    expect(r.missing).toEqual([3]);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.questions).toEqual([1, 2, 3]);
  });

  it('transforma falha do modelo em Error amigável', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      ok: false, error: 'Modelo não instalado.',
    }));
    await expect(readSheetWithAi({ image: 'data:image/jpeg;base64,AA', questions: [1] }))
      .rejects.toThrow('Modelo não instalado.');
  });
});
