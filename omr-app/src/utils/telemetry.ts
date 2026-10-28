/**
 * Telemetria local da leitura OMR — opt-in.
 *
 * Nada sai do aparelho: os registros ficam no localStorage e só existem se o
 * usuário ligar a chave em Configurações. Serve para diagnosticar falhas de
 * leitura e alimentar a análise offline (exportação CSV).
 */

import type { OmrErrorKind } from './omr-errors';

export interface TelemetryEntry {
  ts: string;
  userId?: string;
  examId?: string;
  template?: string;
  customTemplateId?: number;
  page?: number;
  success: boolean;
  errorKind?: OmrErrorKind;
  error?: string;
  cardId?: string;
  readCount?: number;
  blankCount?: number;
  dupCount?: number;
  lowCount?: number;
  durationMs?: number;
  reprocessed?: boolean;
}

const ENABLED_KEY = 'omr-telemetry-enabled';
const LOG_KEY = 'omr-telemetry-log';
export const TELEMETRY_MAX_ENTRIES = 500;

export function isTelemetryEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setTelemetryEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0');
  } catch {
    // modo privado / cota — a preferência não persiste
  }
}

export function readTelemetryLog(): TelemetryEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TelemetryEntry[]) : [];
  } catch {
    return [];
  }
}

/** Registra uma tentativa. No-op quando a telemetria está desligada. */
export function logOmrTelemetry(entry: Omit<TelemetryEntry, 'ts'>): void {
  if (!isTelemetryEnabled()) return;
  try {
    const log = readTelemetryLog();
    log.push({ ...entry, ts: new Date().toISOString() });
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-TELEMETRY_MAX_ENTRIES)));
  } catch {
    // cota estourada: telemetria nunca pode quebrar a correção
  }
}

export function clearTelemetryLog(): void {
  try {
    localStorage.removeItem(LOG_KEY);
  } catch {
    // ignore
  }
}

const CSV_COLUMNS: (keyof TelemetryEntry)[] = [
  'ts', 'userId', 'examId', 'template', 'customTemplateId', 'page', 'success',
  'errorKind', 'error', 'cardId', 'readCount', 'blankCount', 'dupCount',
  'lowCount', 'durationMs', 'reprocessed',
];

function csvCell(value: unknown): string {
  if (value == null) return '';
  const s = String(value);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function telemetryCsv(entries: TelemetryEntry[] = readTelemetryLog()): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const e of entries) {
    lines.push(CSV_COLUMNS.map((c) => csvCell(e[c])).join(','));
  }
  return lines.join('\n');
}
