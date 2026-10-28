/**
 * Fila local de leituras que não chegaram ao servidor (rede/servidor fora).
 *
 * Guarda a imagem em localStorage (base64) para reprocessar depois, sem
 * precisar capturar de novo. Limite baixo de itens por usuário para não estourar
 * a cota do navegador.
 */

import type { OmrErrorKind } from './omr-errors';

export interface PendingRead {
  id: string;
  userId?: string;
  examId: string;
  examName?: string;
  page?: number;
  dataUrl: string;
  error: string;
  errorKind: OmrErrorKind;
  createdAt: string;
}

export type AddPendingResult =
  | { ok: true; item: PendingRead; evicted: number }
  | { ok: false; reason: 'quota'; evicted: number };

const KEY = 'omr-pending-reads';
export const PENDING_MAX_ITEMS = 3;

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // segue com o fallback
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function sameUser(a: PendingRead, b: { userId?: string }): boolean {
  return String(a.userId ?? '') === String(b.userId ?? '');
}

function readAll(): PendingRead[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingRead[]) : [];
  } catch {
    return [];
  }
}

function writeAll(items: PendingRead[]): void {
  localStorage.setItem(KEY, JSON.stringify(items));
}

export function loadPendingReads(userId?: string): PendingRead[] {
  const all = readAll();
  if (userId == null) return all;
  return all.filter((i) => sameUser(i, { userId }));
}

export function addPendingRead(item: Omit<PendingRead, 'id' | 'createdAt'>): AddPendingResult {
  const entry: PendingRead = { ...item, id: newId(), createdAt: new Date().toISOString() };
  const all = readAll();
  const mine = all.filter((i) => sameUser(i, item));
  const others = all.filter((i) => !sameUser(i, item));
  let nextMine = [...mine, entry];
  let evicted = 0;
  while (nextMine.length > PENDING_MAX_ITEMS) {
    nextMine = nextMine.slice(1);
    evicted += 1;
  }
  // Cota: descarta as mais antigas deste usuário até caber.
  let stored = false;
  while (!stored) {
    try {
      writeAll([...others, ...nextMine]);
      stored = true;
    } catch {
      if (nextMine.length <= 1) {
        return { ok: false, reason: 'quota', evicted };
      }
      nextMine = nextMine.slice(1);
      evicted += 1;
    }
  }
  return { ok: true, item: entry, evicted };
}

export function updatePendingRead(
  id: string,
  patch: Partial<Omit<PendingRead, 'id' | 'createdAt'>>,
): void {
  const all = readAll();
  const next = all.map((i) => (i.id === id ? { ...i, ...patch } : i));
  try {
    writeAll(next);
  } catch {
    // cota — mantém o registro anterior
  }
}

export function removePendingRead(id: string): void {
  try {
    writeAll(readAll().filter((i) => i.id !== id));
  } catch {
    // ignore
  }
}

export function clearPendingReads(userId?: string): void {
  try {
    if (userId == null) {
      localStorage.removeItem(KEY);
      return;
    }
    writeAll(readAll().filter((i) => !sameUser(i, { userId })));
  } catch {
    // ignore
  }
}
