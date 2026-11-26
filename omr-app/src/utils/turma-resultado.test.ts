import { describe, expect, it } from 'vitest';
import type { DBResultado } from './api';
import { casaComTurma, turmaDoResultado, turmaPorResultado } from './turma-resultado';

function res(over: Partial<DBResultado> & { codigo_unico: string }): DBResultado {
  return {
    numero_pagina: 0,
    status: 'corrigido',
    respostas: {},
    acertos: 8,
    erros: 0,
    brancos: 0,
    nota: 10,
    observacoes: null,
    data_correcao: null,
    aluno: { id: 1, nome: 'Ana', matricula: null },
    avaliacao: {
      id: 1,
      external_id: 'aval-1',
      titulo: 'Prova',
      questions_per_subject: 4,
      layout_mode: 'dual',
      grade_scale: '0-10',
      template: 'padrao',
      turma: null,
      turma_id: null,
    },
    ...over,
  } as DBResultado;
}

describe('turmaPorResultado', () => {
  it('usa a turma do aluno quando existe (avaliação multi-turma)', () => {
    const mapa = turmaPorResultado([
      res({ codigo_unico: 'A', aluno: { id: 1, nome: 'Ana', matricula: null, turma: 'Turma A', turma_id: 10 } }),
      res({ codigo_unico: 'B', aluno: { id: 2, nome: 'Caio', matricula: null, turma: 'Turma B', turma_id: 20 } }),
    ]);
    expect(mapa.get('A')).toEqual({ id: 10, nome: 'Turma A' });
    expect(mapa.get('B')).toEqual({ id: 20, nome: 'Turma B' });
  });

  it('nunca sobrescreve o nome do aluno pelo nome da turma', () => {
    const [r] = [res({ codigo_unico: 'A', aluno: { id: 1,nome: 'Ana', matricula: null, turma: 'Turma A', turma_id: 10 } })];
    expect(r.aluno.nome).toBe('Ana');
    expect(r.aluno.turma).toBe('Turma A');
  });

  it('sem origem no aluno, cai na turma única da avaliação', () => {
    const mapa = turmaPorResultado([
      res({
        codigo_unico: 'A',
        aluno: { id: 1, nome: 'Elena', matricula: null },
        avaliacao: {
          id: 1, external_id: 'aval-1', titulo: 'Prova', questions_per_subject: 4,
          layout_mode: 'dual', grade_scale: '0-10', template: 'padrao',
          turma: null, turma_id: null,
          turmas: [{ id: 10, nome: 'Turma Única' }],
        },
      }),
    ]);
    expect(mapa.get('A')).toEqual({ id: 10, nome: 'Turma Única' });
  });

  it('avaliação com várias turmas e aluno sem origem não escolhe nenhuma', () => {
    const mapa = turmaPorResultado([
      res({
        codigo_unico: 'A',
        aluno: { id: 1, nome: 'Sem Origem', matricula: null },
        avaliacao: {
          id: 1, external_id: 'aval-1', titulo: 'Prova', questions_per_subject: 4,
          layout_mode: 'dual', grade_scale: '0-10', template: 'padrao',
          turma: null, turma_id: null,
          turmas: [{ id: 10, nome: 'A' }, { id: 20, nome: 'B' }],
        },
      }),
    ]);
    expect(mapa.get('A')).toBeNull();
  });

  it('rótulo legado da avaliação não é usado quando há 2+ turmas (regressão)', () => {
    const mapa = turmaPorResultado([
      res({
        codigo_unico: 'A',
        aluno: { id: 1, nome: 'Sem Origem', matricula: null },
        avaliacao: {
          id: 1, external_id: 'aval-1', titulo: 'Prova', questions_per_subject: 4,
          layout_mode: 'dual', grade_scale: '0-10', template: 'padrao',
          turma: '5 ANO C', turma_id: 30,
          turmas: [{ id: 10, nome: '5 ANO A' }, { id: 20, nome: '5 ANO B' }],
        },
      }),
    ]);
    expect(mapa.get('A')).toBeNull();
    // ...e o resultado conhecido do servidor não ganha o fallback da prova local.
    expect(turmaDoResultado('A', mapa, { id: 30, nome: '5 ANO C' })).toBeNull();
  });

  it('usa o rótulo legado quando a avaliação tem turma única', () => {
    const mapa = turmaPorResultado([
      res({
        codigo_unico: 'A',
        aluno: { id: 1, nome: 'Sem Origem', matricula: null },
        avaliacao: {
          id: 1, external_id: 'aval-1', titulo: 'Prova', questions_per_subject: 4,
          layout_mode: 'dual', grade_scale: '0-10', template: 'padrao',
          turma: 'Turma Única', turma_id: 10,
          turmas: [{ id: 10, nome: 'Turma Única' }],
        },
      }),
    ]);
    expect(mapa.get('A')).toEqual({ id: 10, nome: 'Turma Única' });
  });
});

describe('turmaDoResultado / casaComTurma', () => {
  const turmas = [
    { id: 1, nome: '5 ANO A' },
    { id: 2, nome: '5 ANO B' },
  ];

  it('resolve pelo codigo_unico e cassa por id ou nome', () => {
    const mapa = turmaPorResultado([
      res({ codigo_unico: 'X', aluno: { id: 1, nome: 'Ana', matricula: null, turma: '5 ANO B', turma_id: 2 } }),
    ]);
    const t = turmaDoResultado('X', mapa);
    expect(t).toEqual({ id: 2, nome: '5 ANO B' });
    expect(casaComTurma(t, '2', turmas)).toBe(true);
    expect(casaComTurma(t, '1', turmas)).toBe(false);
    expect(casaComTurma(t, '', turmas)).toBe(true);
  });

  it('usa o fallback informado quando não há dado do servidor', () => {
    expect(turmaDoResultado('Z', new Map(), { id: 1, nome: '5 ANO A' }))
      .toEqual({ id: 1, nome: '5 ANO A' });
  });

  it('servidor conhecido sem turma não cai no fallback', () => {
    const mapa = turmaPorResultado([
      res({ codigo_unico: 'X', aluno: { id: 1, nome: 'Ana', matricula: null } }),
    ]);
    expect(turmaDoResultado('X', mapa, { id: 1, nome: '5 ANO A' })).toBeNull();
  });

  it('sem turma conhecida, nenhum filtro de turma casa', () => {
    expect(casaComTurma(null, '1', turmas)).toBe(false);
  });
});