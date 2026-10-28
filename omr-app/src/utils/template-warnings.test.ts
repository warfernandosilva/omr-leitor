import { describe, expect, it } from 'vitest';
import { pageWarnings } from './template-warnings';

describe('pageWarnings', () => {
  it('não avisa quando a página tem questões e âncoras', () => {
    expect(pageWarnings({
      n_pages: 1,
      questions: [{ page: 0, n_questions: 44 }],
      anchors: [{ page: 0 }],
    })).toEqual([]);
  });

  it('avisa página sem âncoras', () => {
    const warnings = pageWarnings({
      n_pages: 2,
      questions: [{ page: 0, n_questions: 22 }, { page: 1, n_questions: 22 }],
      anchors: [{ page: 0 }],
    });
    expect(warnings).toEqual([
      expect.objectContaining({ page: 1, code: 'no-anchors' }),
    ]);
  });

  it('avisa página sem questões', () => {
    const warnings = pageWarnings({
      n_pages: 2,
      questions: [{ page: 0, n_questions: 22 }],
      anchors: [{ page: 0 }, { page: 1 }],
    });
    expect(warnings).toEqual([
      expect.objectContaining({ page: 1, code: 'no-questions' }),
    ]);
  });

  it('avisa página totalmente vazia', () => {
    const warnings = pageWarnings({
      n_pages: 3,
      questions: [{ page: 0, n_questions: 22 }],
      anchors: [{ page: 0 }],
    });
    expect(warnings.map((w) => w.code)).toEqual(['empty-page', 'empty-page']);
    expect(warnings.map((w) => w.page)).toEqual([1, 2]);
  });

  it('considera páginas citadas mesmo sem n_pages declarado', () => {
    const warnings = pageWarnings({
      questions: [{ page: 0, n_questions: 10 }, { page: 1, n_questions: 5 }],
      anchors: [{ page: 0 }],
    });
    expect(warnings).toEqual([
      expect.objectContaining({ page: 1, code: 'no-anchors' }),
    ]);
  });

  it('conta n_questions dos blocos da mesma página', () => {
    expect(pageWarnings({
      n_pages: 1,
      questions: [{ page: 0, n_questions: 10 }, { page: 0, n_questions: 12 }],
      anchors: [{ page: 0 }],
    })).toEqual([]);
  });

  it('mensagem indica o número da página (1-based)', () => {
    const [w] = pageWarnings({ n_pages: 1, questions: [], anchors: [] });
    expect(w.message).toContain('Página 1');
  });
});
