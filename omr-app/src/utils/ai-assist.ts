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
  /** Modelo da leitura da folha inteira (OLLAMA_READ_MODEL). */
  read_model?: string;
  read_available?: boolean;
  read_error?: string | null;
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

export interface AiSheetResult {
  ok: true;
  /** { "1": "A", "7": "VAZIO" } — só questões que o modelo conseguiu ler. */
  answers: Record<string, string>;
  /** Questões que o modelo não respondeu (nunca inventadas). */
  missing: number[];
  model: string;
  raw?: string;
}

/**
 * Lê a folha inteira (já compactada) e devolve as respostas.
 * Usa OLLAMA_READ_MODEL no backend — o moondream não dá conta de 30+ questões.
 */
export async function readSheetWithAi(req: {
  image: string;
  questions: number[];
  options?: string[];
}): Promise<AiSheetResult> {
  const res = await apiJsonBody<AiSheetResult | AiAssistErrorResponse>(
    '/api/ai/read', 'POST', req, 180000,
  );
  if (!res.ok) throw new Error(res.error || 'A leitura por IA não devolveu respostas.');
  return res;
}
