import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PENDING_MAX_ITEMS,
  addPendingRead,
  clearPendingReads,
  loadPendingReads,
  removePendingRead,
  updatePendingRead,
} from './pending-reads';

const base = {
  examId: 'prova-1',
  examName: 'Prova 1',
  dataUrl: 'data:image/jpeg;base64,AAAA',
  error: 'Sem conexão',
  errorKind: 'network' as const,
};

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('fila de leituras pendentes', () => {
  it('guarda e devolve a captura', () => {
    const r = addPendingRead({ ...base, page: 1, userId: 'u1' });
    expect(r.ok).toBe(true);
    const items = loadPendingReads('u1');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ examId: 'prova-1', page: 1, errorKind: 'network' });
    expect(items[0].id).toBeTruthy();
    expect(items[0].createdAt).toBeTruthy();
  });

  it('descarta a mais antiga ao passar do limite', () => {
    for (let i = 0; i < PENDING_MAX_ITEMS + 1; i += 1) {
      addPendingRead({ ...base, page: i });
    }
    const items = loadPendingReads();
    expect(items).toHaveLength(PENDING_MAX_ITEMS);
    expect(items[0].page).toBe(1);
  });

  it('separa por usuário', () => {
    addPendingRead({ ...base, userId: 'a' });
    addPendingRead({ ...base, userId: 'b' });
    expect(loadPendingReads('a')).toHaveLength(1);
    expect(loadPendingReads('b')).toHaveLength(1);
    expect(loadPendingReads()).toHaveLength(2);
  });

  it('atualiza o erro de um item', () => {
    const r = addPendingRead(base);
    if (!r.ok) throw new Error('esperava sucesso');
    updatePendingRead(r.item.id, { error: 'Timeout', errorKind: 'timeout' });
    const [item] = loadPendingReads();
    expect(item.error).toBe('Timeout');
    expect(item.errorKind).toBe('timeout');
  });

  it('remove um item e limpa a fila do usuário', () => {
    const a = addPendingRead({ ...base, userId: 'a' });
    addPendingRead({ ...base, userId: 'b' });
    if (!a.ok) throw new Error('esperava sucesso');
    removePendingRead(a.item.id);
    expect(loadPendingReads('a')).toEqual([]);
    expect(loadPendingReads('b')).toHaveLength(1);
    clearPendingReads('b');
    expect(loadPendingReads()).toEqual([]);
  });

  it('informa cota quando o navegador recusa a gravação', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const r = addPendingRead(base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('quota');
  });
});
