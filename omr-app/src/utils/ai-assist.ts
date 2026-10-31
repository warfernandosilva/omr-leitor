/**
 * Assistente de correção local (Ollama) — opt-in por aparelho.
 *
 * A sugestão é apenas uma dica: quem decide aplicar é o usuário na revisão.
 * Nada é enviado para a nuvem; o backend fala com o Ollama em localhost.
 */

import { apiJson, apiJsonBody } from './api';

export const AI_ENABLED_KEY = 'omr-ai-assist-enabled';

export interface AiStatus {
  available: boolean;
  url: string;
  model: string;
  models: string[];
  error?: string | null;
}

export interface AiSuggestion {
  ok: true;
  suggestion: string | null;
  confidence: number;
  reason: string;
  source: 'model' | 'ratios';
  model: string;
  raw?: string;
}

export interface AiAssistRequest {
  image: string;
  question: number;
  options?: string[];
  ratios?: Record<string, number> | null;
  context?: {
    low_confidence?: boolean;
    duplicate?: boolean;
    blank?: boolean;
    marks?: string[];
  } | null;
}

interface AiAssistErrorResponse {
  ok: false;
  error?: string;
}

export function isAiAssistEnabled(): boolean {
  try {
    return localStorage.getItem(AI_ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setAiAssistEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AI_ENABLED_KEY, enabled ? '1' : '0');
  } catch {
    // modo privado / cota — a preferência não persiste
  }
}

/** Verifica se o Ollama está acessível e se o modelo está instalado. */
export function getAiStatus(): Promise<AiStatus> {
  return apiJson<AiStatus>('/api/ai/status', {}, 8000);
}

/** Pede uma sugestão para uma questão. Lança Error com mensagem amigável. */
export async function suggestCorrection(req: AiAssistRequest): Promise<AiSuggestion> {
  const res = await apiJsonBody<AiSuggestion | AiAssistErrorResponse>(
    '/api/ai/assist', 'POST', req, 90000,
  );
  if (!res.ok) throw new Error(res.error || 'O assistente local não conseguiu sugerir uma resposta.');
  return res;
}
