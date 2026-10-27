import { describe, expect, it } from 'vitest';
import { mergePageAnswers, missingPages, nextUnreadPage } from './custom-pages';

describe('missingPages', () => {
  it('lista todas as páginas quando nada foi lido', () => {
    expect(missingPages(new Set(), 3)).toEqual([0, 1, 2]);
  });

  it('ignora as páginas já lidas, mesmo fora de ordem', () => {
    expect(missingPages(new Set([0, 2]), 3)).toEqual([1]);
  });

  it('não retorna nada quando todas foram lidas', () => {
    expect(missingPages(new Set([0, 1]), 2)).toEqual([]);
  });

  it('trata cartão de uma página', () => {
    expect(missingPages(new Set(), 1)).toEqual([0]);
  });
});

describe('nextUnreadPage', () => {
  it('aponta a primeira página faltante', () => {
    expect(nextUnreadPage(new Set([0]), 3)).toBe(1);
  });

  it('é undefined quando o cartão está completo', () => {
    expect(nextUnreadPage(new Set([0, 1]), 2)).toBeUndefined();
  });
});

describe('mergePageAnswers', () => {
  it('preserva as respostas das outras páginas', () => {
    const prev = { 1: 'A', 2: 'B', 23: 'C', 24: 'D' };
    const merged = mergePageAnswers(prev, { 23: 'A', 24: 'B' }, [23, 24]);
    expect(merged).toEqual({ 1: 'A', 2: 'B', 23: 'A', 24: 'B' });
  });

  it('substitui respostas antigas da página relida', () => {
    const merged = mergePageAnswers({ 23: 'C', 24: 'D' }, { 23: 'A' }, [23, 24]);
    expect(merged).toEqual({ 23: 'A' });
  });

  it('aceita página em branco sem apagar as demais', () => {
    const merged = mergePageAnswers({ 1: 'A', 23: 'C' }, {}, [23, 24]);
    expect(merged).toEqual({ 1: 'A' });
  });

  it('não altera o objeto original', () => {
    const prev = { 1: 'A' };
    mergePageAnswers(prev, { 2: 'B' }, [2]);
    expect(prev).toEqual({ 1: 'A' });
  });
});
