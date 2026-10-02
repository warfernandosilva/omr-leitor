// Testes do parser de gabarito do Laboratório OMR (CSV/XLSX/texto).
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildTruthTemplateRows, formatTruthPreview, parseGroundTruthFile, parseGroundTruthText } from './lab-truth';

function fakeFile(buf: ArrayBuffer, name = 'gabarito.xlsx'): File {
  return {
    name,
    arrayBuffer: async () => buf,
  } as unknown as File;
}

function workbookFile(rows: (string | number)[][], name = 'gabarito.xlsx'): File {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Gabarito');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return fakeFile(out, name);
}

describe('parseGroundTruthText', () => {
  it('interpreta "1=A" por linha', () => {
    const r = parseGroundTruthText('1=A\n2=C\n3=D');
    expect(r.mode).toBe('texto');
    expect(r.truth).toEqual({ '1': 'A', '2': 'C', '3': 'D' });
    expect(r.n).toBe(3);
  });

  it('aceita separadores = : - e espaço', () => {
    const r = parseGroundTruthText('1 = A\n2: b\n3-D\n4 A');
    expect(r.truth).toEqual({ '1': 'A', '2': 'B', '3': 'D', '4': 'A' });
  });

  it('interpreta sequência de letras começando em 1', () => {
    const r = parseGroundTruthText('A B C D');
    expect(r.truth).toEqual({ '1': 'A', '2': 'B', '3': 'C', '4': 'D' });
  });

  it('ignora linhas fora do formato e avisa sobre letras acima de D', () => {
    const r = parseGroundTruthText('1=A\nlixo aqui\n2=E');
    expect(r.truth).toEqual({ '1': 'A', '2': 'E' });
    expect(r.ignored).toHaveLength(1);
    expect(r.warnings.some(w => /acima de D/.test(w))).toBe(true);
  });

  it('devolve vazio sem entradas válidas', () => {
    const r = parseGroundTruthText('nada\n\t\n');
    expect(r.n).toBe(0);
  });
});

describe('parseGroundTruthFile', () => {
  it('lê duas colunas com cabeçalho', async () => {
    const r = await parseGroundTruthFile(workbookFile([
      ['questão', 'gabarito'],
      [1, 'A'], [2, 'B'], [3, 'C'],
    ]));
    expect(r.mode).toBe('colunas');
    expect(r.truth).toEqual({ '1': 'A', '2': 'B', '3': 'C' });
  });

  it('lê duas colunas sem cabeçalho', async () => {
    const r = await parseGroundTruthFile(workbookFile([[1, 'A'], [2, 'B']]));
    expect(r.truth).toEqual({ '1': 'A', '2': 'B' });
  });

  it('lê matriz com cabeçalho de números', async () => {
    const r = await parseGroundTruthFile(workbookFile([
      [1, 2, 3, 4],
      ['A', 'B', 'C', 'D'],
    ]));
    expect(r.mode).toBe('matriz');
    expect(r.truth).toEqual({ '1': 'A', '2': 'B', '3': 'C', '4': 'D' });
    expect(r.versions).toHaveLength(1);
  });

  it('matriz com múltiplas versões usa a última linha', async () => {
    const r = await parseGroundTruthFile(workbookFile([
      [1, 2, 3],
      ['A', 'B', 'C'],
      ['D', 'A', 'B'],
    ]));
    expect(r.versions).toHaveLength(2);
    expect(r.truth).toEqual({ '1': 'D', '2': 'A', '3': 'B' });
  });

  it('coluna única de letras vira sequência', async () => {
    const r = await parseGroundTruthFile(workbookFile([['A'], ['B'], ['C']]));
    expect(r.truth).toEqual({ '1': 'A', '2': 'B', '3': 'C' });
  });
});

describe('formatTruthPreview', () => {
  it('resume e indica o restante', () => {
    const truth = { '1': 'A', '2': 'B', '3': 'C' };
    expect(formatTruthPreview(truth, 2)).toBe('1=A, 2=B … (+1)');
  });
});

describe('buildTruthTemplateRows', () => {
  it('cabeçalho + uma linha por questão, vazias', () => {
    expect(buildTruthTemplateRows(3, null)).toEqual([
      ['questão', 'gabarito'],
      ['1', ''],
      ['2', ''],
      ['3', ''],
    ]);
  });

  it('pré-enche com o gabarito atual', () => {
    expect(buildTruthTemplateRows(2, { '1': 'A', '2': 'D' })).toEqual([
      ['questão', 'gabarito'],
      ['1', 'A'],
      ['2', 'D'],
    ]);
  });

  it('total zero devolve só o cabeçalho', () => {
    expect(buildTruthTemplateRows(0, { '1': 'A' })).toEqual([['questão', 'gabarito']]);
  });
});