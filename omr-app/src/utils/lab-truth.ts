// ─── Laboratório OMR: gabarito (ground truth) e export XLSX ───
//
// O backend só recebe `{"1": "A", ...}` já parseado. A leitura do arquivo
// (CSV/XLSX) e a montagem do XLSX de saída acontecem AQUI, no cliente, pelo
// mesmo motivo do import de alunos: `xlsx` já é dependência do app e não
// precisa entrar no requirements do Python.
//
// Formatos aceitos para o gabarito (o mais comum dos dois lados):
//   1. Duas colunas  questao | gabarito      (com ou sem cabeçalho)
//   2. Texto         "1=A" / "1: A" / "1 A" e/ou linhas "A B C D"
//   3. Sequencial    uma coluna de letras   (1ª letra = questão 1)
//   4. Matriz        cabeçalho 1..N e uma linha de letras por versão

import * as XLSX from 'xlsx';

export interface TruthParseResult {
  /** questão (string, como o banco usa) -> letra maiúscula */
  truth: Record<string, string>;
  n: number;
  mode: 'colunas' | 'texto' | 'sequencial' | 'matriz';
  warnings: string[];
  ignored: { row: number; reason: string }[];
  /** Todas as linhas de respostas encontradas (matriz pode ter várias). */
  versions: { nome: string; truth: Record<string, string> }[];
}

const HEADER_QUESTION_RE = /^(quest[aã]o|q|num(ero)?|n[º°]?|item|indice)/i;
const HEADER_ANSWER_RE = /(gabarito|resposta|letra|answer|key|correta|chave)/i;

function cellToString(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

/** A-E cobre qualquer cartão atual; além disso é aviso, não erro. */
function normalizeLetter(v: unknown): string | null {
  const t = cellToString(v).toUpperCase();
  if (!t) return null;
  const m = t.match(/[A-Z]/);
  if (!m) return null;
  return m[0];
}

function isQuestionKey(v: string): number | null {
  const t = v.replace(/[^\d]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Monta o resultado a partir de pares (questão, letra). */
function build(
  pairs: { q: number; letter: string }[],
  mode: TruthParseResult['mode'],
  warnings: string[],
  ignored: { row: number; reason: string }[],
): TruthParseResult {
  const truth: Record<string, string> = {};
  for (const p of pairs) truth[String(p.q)] = p.letter;
  const keys = Object.keys(truth).map(Number);
  if (keys.length > 0 && Math.max(...keys) > 60) {
    warnings.push(`A maior questão lida foi ${Math.max(...keys)} — confira se a coluna não bringa índice de linha.`);
  }
  const outsideD = Object.values(truth).filter(l => l > 'D').length;
  if (outsideD > 0) {
    warnings.push(`${outsideD} letra(s) acima de D — os cartões atuais usam A–D.`);
  }
  const versions = Object.keys(truth).length
    ? [{ nome: 'gabarito', truth }]
    : [];
  return { truth, n: Object.keys(truth).length, mode, warnings, ignored, versions };
}

// ─── 2) texto "1=A" ───

export function parseGroundTruthText(raw: string): TruthParseResult {
  const pairs: { q: number; letter: string }[] = [];
  const ignored: { row: number; reason: string }[] = [];
  const warnings: string[] = [];
  let sequential = 0;

  raw.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    // "1=A", "1: A", "1 - A", "1 A"
    const m = t.match(/^(\d+)\s*[=:\-–]?\s*([A-Za-z])\s*$/);
    if (m) {
      const q = Number(m[1]);
      if (q > 0) pairs.push({ q, letter: m[2].toUpperCase() });
      else ignored.push({ row: i + 1, reason: `questão inválida: ${m[1]}` });
      return;
    }
    // linha só com letras isoladas => sequência continua
    const tokens = t.split(/[\s,;]+/).filter(Boolean);
    if (tokens.length > 0 && tokens.every(tok => /^[A-Za-z]$/.test(tok))) {
      for (const tok of tokens) {
        sequential += 1;
        pairs.push({ q: sequential, letter: tok.toUpperCase() });
      }
      return;
    }
    ignored.push({ row: i + 1, reason: `linha fora do formato "questão=letra": ${t.slice(0, 40)}` });
  });

  const byNumber = new Map<number, string>();
  for (const p of pairs) byNumber.set(p.q, p.letter); // última ocorrência vence
  const unique = [...byNumber.entries()].map(([q, letter]) => ({ q, letter }));
  unique.sort((a, b) => a.q - b.q);
  if (unique.length && unique[0].q !== 1) {
    warnings.push(`A primeira questão é ${unique[0].q} — as anteriores ficam sem gabarito.`);
  }
  return build(unique, 'texto', warnings, ignored);
}

// ─── 1/3/4) planilha ───

export async function parseGroundTruthFile(file: File): Promise<TruthParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('O arquivo não contém planilhas.');
  const rows = XLSX.utils
    .sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, raw: false, defval: '' })
    .filter(r => r.some(c => cellToString(c) !== ''));
  if (rows.length === 0) throw new Error('A planilha está vazia.');

  const warnings: string[] = [];
  const ignored: { row: number; reason: string }[] = [];
  const first = rows[0].map(cellToString);
  const headerLooksTyped = first.some(c => HEADER_QUESTION_RE.test(c) || HEADER_ANSWER_RE.test(c));
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);

  // 4) matriz: cabeçalho com números de questão
  if (!headerLooksTyped && first.filter(Boolean).length > 1 && first.every(c => c === '' || isQuestionKey(c) !== null)) {
    const colPositions: { q: number; col: number }[] = [];
    first.forEach((c, col) => {
      if (c === '') return;
      const q = isQuestionKey(c);
      if (q !== null) colPositions.push({ q, col });
    });
    const versions: { nome: string; truth: Record<string, string> }[] = [];
    for (let r = 1; r < rows.length; r++) {
      const truth: Record<string, string> = {};
      for (const { q, col } of colPositions) {
        const letter = normalizeLetter(rows[r][col]);
        if (letter) truth[String(q)] = letter;
      }
      const n = Object.keys(truth).length;
      if (n === 0) continue;
      versions.push({ nome: rows.length > 2 ? `linha ${r}` : 'gabarito', truth });
    }
    if (versions.length === 0) throw new Error('A matriz tem cabeçalho de questões mas nenhuma linha de letras.');
    const last = versions[versions.length - 1];
    return { truth: last.truth, n: Object.keys(last.truth).length, mode: 'matriz', warnings, ignored, versions };
  }

  // 1) duas colunas (com ou sem cabeçalho)
  if (width >= 2) {
    let qCol = 0;
    let aCol = 1;
    let start = 0;
    if (headerLooksTyped) {
      qCol = first.findIndex(c => HEADER_QUESTION_RE.test(c));
      aCol = first.findIndex(c => HEADER_ANSWER_RE.test(c));
      if (qCol < 0 || aCol < 0) { qCol = 0; aCol = 1; }
      else start = 1;
    }
    const pairs: { q: number; letter: string }[] = [];
    for (let r = start; r < rows.length; r++) {
      const q = isQuestionKey(cellToString(rows[r][qCol]));
      const letter = normalizeLetter(rows[r][aCol]);
      if (q === null) { ignored.push({ row: r + 1, reason: `questão ilegível: "${cellToString(rows[r][qCol])}"` }); continue; }
      if (!letter) { ignored.push({ row: r + 1, reason: `questão ${q} sem letra` }); continue; }
      pairs.push({ q, letter });
    }
    if (pairs.length > 0) return build(pairs, 'colunas', warnings, ignored);
    // cai para o formato texto quando as "duas colunas" eram na verdade "1=A"
    const asText = rows.map(r => r.map(cellToString).join(' ')).join('\n');
    return parseGroundTruthText(asText);
  }

  // 3) coluna única de letras => sequência
  return parseGroundTruthText(rows.map(r => cellToString(r[0])).join('\n'));
}

// ─── Export XLSX ───

/** Converte as abas do backend (sheets do export JSON) em .xlsx e baixa. */
export function exportSheetsToXlsx(
  sheets: Record<string, string[][]>,
  filename: string,
  sheetOrder?: string[],
): void {
  const wb = XLSX.utils.book_new();
  const names = sheetOrder ?? Object.keys(sheets);
  const ordered = [...names.filter(n => sheets[n]), ...Object.keys(sheets).filter(n => !names.includes(n))];
  if (ordered.length === 0) throw new Error('Nada para exportar.');
  for (const name of ordered) {
    const data = sheets[name];
    if (!data || data.length === 0) continue;
    const ws = XLSX.utils.aoa_to_sheet(data as unknown[][]);
    ws['!cols'] = (data[0] ?? []).map((_, i) => ({
      wch: Math.min(
        42,
        Math.max(10, ...data.map(r => String(r[i] ?? '').length + 2)),
      ),
    }));
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 5000);
}

// ─── Planilha modelo para preenchimento do gabarito ───

/**
 * Linhas da planilha modelo: cabeçalho `questão` + `gabarito` seguido de
 * uma linha por questão (1..total). Se `truth` for informado, as letras já
 * vêm preenchidas (útil para editar o gabarito atual).
 */
export function buildTruthTemplateRows(
  total: number,
  truth: Record<string, string> | null,
): string[][] {
  const rows: string[][] = [['questão', 'gabarito']];
  for (let q = 1; q <= Math.max(0, Math.floor(total)); q++) {
    rows.push([String(q), truth?.[String(q)] ?? '']);
  }
  return rows;
}

/** Baixa a planilha modelo (.xlsx) para o usuário preencher o gabarito. */
export function downloadTruthTemplate(
  total: number,
  truth: Record<string, string> | null,
  filename: string,
): void {
  exportSheetsToXlsx({ gabarito: buildTruthTemplateRows(total, truth) }, filename, ['gabarito']);
}

/** Pré-visualização "1=A, 2=B, …" para conferir antes de gravar. */
export function formatTruthPreview(truth: Record<string, string>, limit = 12): string {
  const keys = Object.keys(truth).map(Number).sort((a, b) => a - b);
  return keys.slice(0, limit).map(q => `${q}=${truth[String(q)]}`).join(', ')
    + (keys.length > limit ? ` … (+${keys.length - limit})` : '');
}