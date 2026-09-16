// ─── Importação de lista de alunos (XLSX/CSV) ───
//
// Regra fundamental:
//   N = quantidade de nomes válidos importados
//   Quantidade de gabaritos = códigos únicos = páginas do PDF = N
//
// - Cada nome válido gera exatamente 1 gabarito individual.
// - Nomes duplicados NÃO são removidos: cada registro é um aluno independente.
// - Linhas vazias ou sem nome válido são ignoradas (e reportadas).
// - Sem limite fixo de quantidade.
// - Os IDs/códigos definitivos são gerados e persistidos PELO BACKEND
//   (fonte oficial); aqui apenas parseamos e validamos o arquivo.

import * as XLSX from 'xlsx';

export interface ImportedStudent {
  seq: number;
  name: string;
  identifier?: string;
}

export interface IgnoredRow {
  row: number; // número da linha na planilha (1-based, incluindo cabeçalho)
  reason: string;
}

export interface ImportResult {
  students: ImportedStudent[];
  ignored: IgnoredRow[];
  totalRowsRead: number;
  headerDetected: boolean;
  nameColumnLabel: string;
  identifierColumnLabel: string | null;
  duplicateNamesCount: number;
}

const NAME_HEADER_RE = /^(nome( do aluno| do estudante)?|aluno|aluno\(a\)|estudante|student|name)$/i;
const ID_HEADER_RE = /^(matr[ií]cula|c[oó]digo|cod|ra|registro|id|n[uú]mero|num|n[º°])$/i;

function cellToString(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

function isBlankRow(row: unknown[]): boolean {
  return row.every(c => cellToString(c) === '');
}

function isNameLike(value: string): boolean {
  const t = value.trim();
  if (t.length < 2 || t.length > 120) return false;
  if (!/\p{L}/u.test(t)) return false; // precisa conter pelo menos uma letra
  return true;
}

function pickNameColumn(rows: unknown[][]): number {
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  let best = 0;
  let bestScore = -1;
  for (let c = 0; c < width; c++) {
    let score = 0;
    for (const r of rows) {
      if (isNameLike(cellToString(r[c]))) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return bestScore > 0 ? best : 0;
}

export async function importStudents(file: File): Promise<ImportResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('O arquivo não contém planilhas.');
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '' });
  if (rows.length === 0) throw new Error('A planilha está vazia.');

  // ─── Detecção de colunas ───
  const firstRow = rows[0].map(cellToString);
  let headerDetected = firstRow.some(c => NAME_HEADER_RE.test(c) || ID_HEADER_RE.test(c));

  let nameCol: number | null = null;
  let idCol: number | null = null;
  let dataStart = 0;

  if (headerDetected) {
    nameCol = firstRow.findIndex(c => NAME_HEADER_RE.test(c));
    idCol = firstRow.findIndex(c => ID_HEADER_RE.test(c));
    dataStart = 1;
    if (nameCol < 0) {
      headerDetected = false;
      nameCol = null;
      idCol = null;
      dataStart = 0;
    }
  }
  if (nameCol === null || !headerDetected) {
    nameCol = pickNameColumn(rows);
    dataStart = headerDetected ? 1 : 0;
    if (!firstRow.some(c => NAME_HEADER_RE.test(c))) headerDetected = false;
  }
  const nameIdx = nameCol;

  const columnLetter = (idx: number): string => {
    let n = idx;
    let s = '';
    do {
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return s;
  };

  const nameColumnLabel = headerDetected && nameIdx >= 0
    ? firstRow[nameIdx] || `Coluna ${columnLetter(nameIdx)}`
    : `Coluna ${columnLetter(nameIdx)} (detectada automaticamente)`;
  const identifierColumnLabel = idCol !== null && idCol >= 0 && headerDetected
    ? firstRow[idCol] || `Coluna ${columnLetter(idCol)}`
    : null;

  // ─── Leitura das linhas ───
  const students: ImportedStudent[] = [];
  const ignored: IgnoredRow[] = [];
  const seenNames = new Map<string, number>();
  let duplicateNamesCount = 0;
  const totalRowsRead = rows.length - dataStart;

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 1; // 1-based para o usuário

    if (!row || isBlankRow(row)) {
      ignored.push({ row: rowNumber, reason: 'Linha vazia' });
      continue;
    }

    const rawId = idCol !== null && idCol >= 0 ? cellToString(row[idCol]) : '';
    const name = cellToString(row[nameIdx]);

    if (name === '') {
      ignored.push({ row: rowNumber, reason: 'Sem nome' });
      continue;
    }
    if (!isNameLike(name)) {
      ignored.push({ row: rowNumber, reason: `Nome inválido: "${name}"` });
      continue;
    }

    const key = name.toLowerCase();
    const seen = seenNames.get(key);
    if (seen) {
      duplicateNamesCount++;
    } else {
      seenNames.set(key, students.length);
    }

    const student: ImportedStudent = { seq: students.length + 1, name };
    if (rawId !== '') student.identifier = rawId;
    students.push(student);
  }

  return {
    students,
    ignored,
    totalRowsRead,
    headerDetected,
    nameColumnLabel,
    identifierColumnLabel,
    duplicateNamesCount,
  };
}

export function countPdfPages(pdfText: string): number {
  const matches = pdfText.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 0;
}
