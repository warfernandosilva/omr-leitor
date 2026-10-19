import { describe, it, expect } from 'vitest';
import { gabaritosPdfName, slugify } from './pdf-name';

describe('nome do PDF de gabaritos', () => {
  it('identifica a turma e remove acentos', () => {
    expect(gabaritosPdfName('Prova de Matemática', 'turma', '9º A', 12))
      .toBe('gabaritos_prova-de-matematica_turma-9o-a_12_paginas.pdf');
  });

  it('identifica o arquivo e ignora a extensão', () => {
    expect(gabaritosPdfName('Prova 1', 'file', 'Lista_9A.xlsx', 30))
      .toBe('gabaritos_prova-1_lista-9a_30_paginas.pdf');
  });

  it('fluxos diferentes nunca geram o mesmo nome', () => {
    const prova = 'Prova 1';
    const arquivo = gabaritosPdfName(prova, 'file', '9A.xlsx', 10);
    const turma = gabaritosPdfName(prova, 'turma', '9A', 10);
    expect(arquivo).not.toBe(turma);
    expect(turma).toContain('_turma-');
  });

  it('usa fallbacks quando o nome está vazio', () => {
    expect(gabaritosPdfName('', 'file', '', 3)).toBe('gabaritos_prova_sem-nome_3_paginas.pdf');
    expect(slugify('  ')).toBe('');
  });
});
