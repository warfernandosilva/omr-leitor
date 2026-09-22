// ─── Geometria do cartão "Gabarito SAEV" (espelha omr/template_saev.py) ───
// Canvas: 1448×2048 · 4 subcolunas × ceil(qps/2) linhas (LP 1..qps, MAT qps+1..2*qps)
// Bolhas QUADRADAS lado 30 · qps 16..26 por disciplina

export const SAEV_COLS_X = [120, 438, 752, 1068];
export const SAEV_NUM_W = 55;
export const SAEV_PITCH = 41;
export const SAEV_SIDE = 30;
export const SAEV_Y0 = 660;
export const SAEV_Y1 = 1790;
export const SAEV_MIN_QPS = 16;
export const SAEV_MAX_QPS = 26;
export const SAEV_QR_POS: [number, number] = [100, 72];
export const SAEV_QR_SIZE = 250;
export const SAEV_CORNER_CENTERS = {
  TL: [110, 545] as [number, number],
  TR: [1338, 545] as [number, number],
  BL: [110, 1905] as [number, number],
  BR: [1338, 1905] as [number, number],
};
export const SAEV_LETTERS = ['A', 'B', 'C', 'D'] as const;

/** Linhas por subcoluna (2 subcolunas por disciplina). */
export function saevRowsFor(qps: number): number {
  const n = Math.max(1, Math.min(SAEV_MAX_QPS, Math.round(qps)));
  return Math.ceil(n / 2);
}

/** Ys das linhas, distribuídas na faixa fixa. */
export function saevRowYs(qps: number): number[] {
  const rows = saevRowsFor(qps);
  if (rows <= 1) return [SAEV_Y0];
  const step = (SAEV_Y1 - SAEV_Y0) / (rows - 1);
  return Array.from({ length: rows }, (_, i) => Math.round((SAEV_Y0 + i * step) * 10) / 10);
}

/** (questão global, coluna 0..3, linha) — LP=1..qps, MAT=qps+1..2*qps. */
export function saevBlockRows(qps: number): [number, number, number][] {
  const n = Math.max(1, Math.min(SAEV_MAX_QPS, Math.round(qps)));
  const rows = saevRowsFor(n);
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
export function saevBubbleCenter(col: number, row: number, ci: number, qps = 22): [number, number] {
  const ys = saevRowYs(qps);
  return [SAEV_COLS_X[col] + SAEV_NUM_W + ci * SAEV_PITCH + SAEV_PITCH / 2, ys[row] ?? 0];
}
