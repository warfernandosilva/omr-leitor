import { describe, it, expect, beforeEach } from 'vitest';
import { saveNav, loadNav, clearNav } from './nav-persist';

beforeEach(() => {
  sessionStorage.clear();
});

describe('nav-persist', () => {
  it('salva e restaura a tela (caso do reload pós-câmera)', () => {
    saveNav({ view: 'correct-card', examId: 'E1', resultId: null });
    // simula o reload: o estado em memória some, o storage fica
    expect(loadNav()).toEqual({ view: 'correct-card', examId: 'E1', resultId: null });
  });

  it('sem nada salvo, retorna null (boot normal no Início)', () => {
    expect(loadNav()).toBeNull();
  });

  it('JSON corrompido não quebra o boot', () => {
    sessionStorage.setItem('omr-nav', '{invalido');
    expect(loadNav()).toBeNull();
  });

  it('clearNav limpa', () => {
    saveNav({ view: 'results' });
    clearNav();
    expect(loadNav()).toBeNull();
  });
});
