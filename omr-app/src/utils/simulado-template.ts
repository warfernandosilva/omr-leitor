// ─── Geometria do cartão "Simulado" (espelha omr/template_simulado.py) ───
// Canvas: 1448×2048 (A4 retrato). Só UMA tabela centralizada de 828.89×1968
// (margem vertical 40) — as próprias réguas são as âncoras (sem marcador
// dedicado, sem QR/nome/turma). Sempre 22 questões, layout single.
//
// Os valores vêm PRONTOS do backend (SIMULADO_COORDS) para não reproduzir em
// TS o arredondamento do Python (`round(x, 2)` usa meio-módulo). Mantenha em
// sincronia com omr/template_simulado.py.

export const SIMULADO_TABLE: readonly [number, number, number, number] = [
  309.55, 40.0, 1138.44, 2008.0,
];

/** Réguas verticais (6): célula 0 = números, células 1..4 = A..D. */
export const SIMULADO_V: readonly number[] = [309.55, 509.72, 665.11, 826.57, 980.3, 1138.44];
/** Borda direita do cabeçalho (degrau de 6 px em relação aos dados). */
export const SIMULADO_V5_HEADER = 1131.81;

export const SIMULADO_H_TOP = 40.0;
export const SIMULADO_H_HEADER_BOT = 115.2;
export const SIMULADO_H_DATA_TOP = 133.45;
export const SIMULADO_H_BOTTOM = 2008.0;
export const SIMULADO_ROW_PITCH = 85.2068;

/** Centros das colunas A..D. */
export const SIMULADO_COLS: readonly number[] = [587.41, 745.84, 903.43, 1059.37];
export const SIMULADO_NUM_X = 409.63;
export const SIMULADO_HEADER_LABEL_Y = 77.6;

export const SIMULADO_BUBBLE_R = 27;
export const SIMULADO_BUBBLE_STROKE = 5;
/** Raio do disco amostrado pelo leitor. */
export const SIMULADO_INNER_R = 20;
export const SIMULADO_LINE_W = 7;

export const SIMULADO_MAX_QUESTIONS = 22;
export const SIMULADO_LAYOUT = 'single' as const;
export const SIMULADO_LETTERS = ['A', 'B', 'C', 'D'] as const;

/** Y da régua superior da questão q (1..22). */
export function simuladoRowTop(q: number): number {
  const n = Math.max(1, Math.min(SIMULADO_MAX_QUESTIONS, Math.round(q)));
  return round2(SIMULADO_H_DATA_TOP + (n - 1) * SIMULADO_ROW_PITCH);
}

/** Y do centro da célula da questão q (1..22). */
export function simuladoRowCenter(q: number): number {
  const n = Math.max(1, Math.min(SIMULADO_MAX_QUESTIONS, Math.round(q)));
  return round2(SIMULADO_H_DATA_TOP + (n - 0.5) * SIMULADO_ROW_PITCH);
}

/** Centro (x, y) da bolha da questão q na coluna ci (0=A..3=D). */
export function simuladoBubbleCenter(q: number, ci: number): [number, number] {
  const c = Math.max(0, Math.min(3, Math.round(ci)));
  return [SIMULADO_COLS[c], simuladoRowCenter(q)];
}

/** BBox da grade de bolhas (dilatado pelo raio) — para o recorte/Invariantes. */
export function simuladoGridExtent(): { x0: number; y0: number; x1: number; y1: number } {
  const [cx0] = simuladoBubbleCenter(1, 0);
  const [cx3] = simuladoBubbleCenter(1, 3);
  const y0 = simuladoRowCenter(1);
  const y1 = simuladoRowCenter(SIMULADO_MAX_QUESTIONS);
  return {
    x0: cx0 - SIMULADO_BUBBLE_R,
    y0: y0 - SIMULADO_BUBBLE_R,
    x1: cx3 + SIMULADO_BUBBLE_R,
    y1: y1 + SIMULADO_BUBBLE_R,
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
