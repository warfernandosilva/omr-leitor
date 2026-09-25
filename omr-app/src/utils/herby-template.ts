// ─── Geometria do cartão "Gabarito Herby" (espelha omr/template_herby.py) ───
// Canvas: 1448×2048 · 4 subcolunas × ceil(qps/2) linhas (LP 1..qps, MAT qps+1..2*qps)
// Quadrados lado 28 · qps 1..26 por disciplina · SEM ArUco (âncoras = 2 QRs + bordas)

export const HERBY_COLS_X = [193, 504, 815, 1127];
export const HERBY_NUM_W = 16;
export const HERBY_PITCH = 40;
export const HERBY_SIDE = 28;
export const HERBY_Y0 = 650;
export const HERBY_Y1 = 1785;
export const HERBY_MIN_QPS = 1;
export const HERBY_MAX_QPS = 26;
export const HERBY_QR_HEAD_POS: [number, number] = [121, 76];
export const HERBY_QR_HEAD_SIZE = 243;
export const HERBY_QR_FOOT_POS: [number, number] = [458, 1849];
export const HERBY_QR_FOOT_SIZE = 142;
export const HERBY_LETTERS = ['A', 'B', 'C', 'D'] as const;

/** Normaliza QR lido (magic link ou ID puro) para o codigo_unico. Espelha normalize_herby_qr. */
export function normalizeHerbyQr(data: string): string {
  let s = (data || '').trim();
  if (s.includes('?')) s = s.split('?', 2)[1] ?? '';
  if (s.includes('=')) s = s.split('=').pop() ?? '';
  return s.trim();
}

/** Linhas por subcoluna (2 subcolunas por disciplina). */
export function herbyRowsFor(qps: number): number {
  const n = Math.max(1, Math.min(HERBY_MAX_QPS, Math.round(qps)));
  return Math.ceil(n / 2);
}

/** Ys das linhas, distribuídas na faixa fixa. */
export function herbyRowYs(qps: number): number[] {
  const rows = herbyRowsFor(qps);
  if (rows <= 1) return [HERBY_Y0];
  const step = (HERBY_Y1 - HERBY_Y0) / (rows - 1);
  return Array.from({ length: rows }, (_, i) => Math.round((HERBY_Y0 + i * step) * 10) / 10);
}

/** (questão global, coluna 0..3, linha) — LP=1..qps, MAT=qps+1..2*qps. */
export function herbyBlockRows(qps: number): [number, number, number][] {
  const n = Math.max(1, Math.min(HERBY_MAX_QPS, Math.round(qps)));
  const rows = herbyRowsFor(n);
  const out: [number, number, number][] = [];
  for (let col = 0; col < 4; col++) {
    const base = col < 2 ? 0 : n;
    const off = col % 2 === 0 ? 0 : rows;
    for (let r = 0; r < rows; r++) {
      const q = base + off + r + 1;
      if (q > base + n) continue;
      out.push([q, col, r]);
    }
  }
  return out;
}

/** Centro (x, y) do quadrado (coluna, linha, alternativa 0=A..3=D). */
export function herbyBubbleCenter(col: number, row: number, ci: number, qps = 22): [number, number] {
  const ys = herbyRowYs(qps);
  return [HERBY_COLS_X[col] + HERBY_NUM_W + ci * HERBY_PITCH + HERBY_PITCH / 2, ys[row] ?? 0];
}
