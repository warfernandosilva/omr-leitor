// ─── Geometria do cartão SAE "Avaliação Contínua" (espelha omr/template_sae.py) ───
// Canvas: 1448×2048 · 4 blocos × 7 linhas (questões 01–28, A–D)

export const SAE_BLOCKS_X = [100, 431, 762, 1093];
export const SAE_BLOCK_W = 270;
export const SAE_BUBBLE_DX = [80, 132, 184, 236];
export const SAE_BUBBLE_RADIUS = 13.5;
export const SAE_FIRST_ROW_Y = 1265;
export const SAE_ROW_STEP = 84;
export const SAE_ROWS_PER_BLOCK = 7;
export const SAE_MAX_QUESTIONS = 28;

// ─── Âncoras: 4 quadrados pretos nos cantos (sem ArUco) ───
// Espelha template_sae.py: CORNER_SIZE=40, CORNER_MARGIN=64,
// CORNER_TOP=1140, CORNER_BOTTOM=1860 → centros = canto + CORNER_SIZE/2.
export const SAE_CORNER_SIZE = 40;
export const SAE_CORNER_CENTERS = {
  TL: [84, 1160] as [number, number],
  TR: [1364, 1160] as [number, number],
  BR: [1364, 1880] as [number, number],
  BL: [84, 1880] as [number, number],
};

/** Linha/coluna (bloco 0–3, linha 0–6) da questão q (1-based). */
export function saeBlockRow(q: number): [number, number] {
  const b = Math.floor((q - 1) / SAE_ROWS_PER_BLOCK);
  const r = (q - 1) % SAE_ROWS_PER_BLOCK;
  return [b, r];
}

/** Centro (x, y) da bolha da questão q (1-based), alternativa ci (0=A..3=D). */
export function saeBubbleCenter(q: number, ci: number): [number, number] {
  const [b, r] = saeBlockRow(q);
  return [SAE_BLOCKS_X[b] + SAE_BUBBLE_DX[ci], SAE_FIRST_ROW_Y + r * SAE_ROW_STEP];
}
