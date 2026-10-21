import { describe, expect, it } from 'vitest';
import { duplicateIds, findDuplicateGroups, findStudentMatches, mergeStudentOptions, normalizeName } from './alunos';
import type { StudentOption } from './alunos';
import type { AlunoListItem } from './api';

function option(partial: Partial<StudentOption> & { key: string; nome: string }): StudentOption {
  return { matricula: null, alunoId: null, ...partial };
}

function aluno(partial: Partial<AlunoListItem> & { id: number; nome: string }): AlunoListItem {
  return {
    matricula: null,
    identificador_externo: null,
    turma_id: 1,
    turma_nome: '9º A',
    ...partial,
  };
}

describe('normalizeName', () => {
  it('remove acentos, caixa e espaços extras', () => {
    expect(normalizeName('  José  da SILVA ')).toBe('jose da silva');
    expect(normalizeName('Ana-Beatriz')).toBe('ana-beatriz');
  });
});

describe('findDuplicateGroups', () => {
  it('agrupa por matrícula repetida', () => {
    const list = [
      aluno({ id: 1, nome: 'Ana Lima', matricula: '0012', turma_id: 1, turma_nome: '9º A' }),
      aluno({ id: 2, nome: 'Ana B. Lima', matricula: '0012', turma_id: 2, turma_nome: '9º B' }),
      aluno({ id: 3, nome: 'Bruno Silva', matricula: '0013' }),
    ];
    const groups = findDuplicateGroups(list);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: '0012', kind: 'matricula' });
    expect(groups[0].items.map(a => a.id).sort()).toEqual([1, 2]);
  });

  it('agrupa por nome normalizado igual', () => {
    const list = [
      aluno({ id: 1, nome: 'José da Silva' }),
      aluno({ id: 2, nome: 'jose  da silva', matricula: '0099' }),
      aluno({ id: 3, nome: 'Maria Souza', matricula: '0001' }),
    ];
    const groups = findDuplicateGroups(list);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('nome');
  });

  it('ignora matrícula vazia e lista limpa', () => {
    const list = [aluno({ id: 1, nome: 'Ana' }), aluno({ id: 2, nome: 'Bruno' })];
    expect(findDuplicateGroups(list)).toEqual([]);
    expect(duplicateIds([])).toEqual(new Set());
  });
});

describe('findStudentMatches', () => {
  const list: StudentOption[] = [
    option({ key: '1', nome: 'José da Silva', matricula: '0012', alunoId: 1 }),
    option({ key: '2', nome: 'Mariazinha Souza', matricula: '0099', alunoId: 2 }),
    option({ key: '3', nome: 'Ana Beatriz Lima', matricula: '0101', alunoId: 3 }),
    option({ key: 'turma:9', nome: 'Silvana Prado', alunoId: null, fromTurmaOnly: true }),
  ];

  it('casa sem acento nem caixa (substring)', () => {
    expect(findStudentMatches(list, 'jose').map(o => o.key)).toEqual(['1']);
    expect(findStudentMatches(list, 'ANA').map(o => o.key)).toEqual(['3', 'turma:9']);
  });

  it('prefixo de nome vem antes de substring', () => {
    const got = findStudentMatches(list, 'silva').map(o => o.key);
    expect(got).toEqual(['turma:9', '1']);
  });

  it('casa pela matrícula', () => {
    expect(findStudentMatches(list, '0099').map(o => o.key)).toEqual(['2']);
  });

  it('consulta vazia devolve os primeiros (até o limite)', () => {
    expect(findStudentMatches(list, '').map(o => o.key)).toEqual(['1', '2', '3', 'turma:9']);
    expect(findStudentMatches(list, '', 2).map(o => o.key)).toEqual(['1', '2']);
  });

  it('sem correspondência devolve vazio', () => {
    expect(findStudentMatches(list, 'zzz')).toEqual([]);
  });
});

describe('mergeStudentOptions', () => {
  it('mantém a prova primeiro e completa com nomes do catálogo', () => {
    const primary = [option({ key: '1', nome: 'Ana Lima', alunoId: 1 })];
    const fallback = [
      option({ key: 'turma:1', nome: 'ana lima', alunoId: null, origemLabel: 'turma' }),
      option({ key: 'turma:2', nome: 'Bruno Souza', alunoId: null, origemLabel: 'turma' }),
    ];
    expect(mergeStudentOptions(primary, fallback).map(o => o.key)).toEqual(['1', 'turma:2']);
  });

  it('sem fallback devolve a própria lista da prova', () => {
    const primary = [option({ key: '1', nome: 'Ana Lima', alunoId: 1 })];
    expect(mergeStudentOptions(primary, [])).toBe(primary);
  });
});
