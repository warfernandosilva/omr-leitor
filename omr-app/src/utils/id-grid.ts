import type { CustomIdGrid } from './custom-template-api';

/** Uma bolha da grade de matrícula: dígito (1..N) e valor (0–9). */
export interface IdGridBubble {
  digit: number;
  value: number;
  x: number;
  y: number;
}

/**
 * Bolhas de uma matrícula (coordenadas 0..1): N colunas × 10 linhas (0–9),
 * encostadas na direita de cada coluna.
 *
 * Espelha `expand_id_bubbles` do backend — se as duas divergirem, o desenho e
 * a leitura passam a olhar lugares diferentes.
 */
export function idGridBubbles(g: CustomIdGrid): IdGridBubble[] {
  const digits = Math.max(1, Math.min(14, Math.round(g.digits || 8)));
  const colW = g.w / digits;
  const rowH = g.h / 10;
  const r = g.radius || 0.014;
  const inset = Math.min(r + 0.012, Math.max(0, colW - r));
  const out: IdGridBubble[] = [];
  for (let c = 0; c < digits; c++) {
    for (let v = 0; v < 10; v++) {
      out.push({
        digit: c + 1,
        value: v,
        x: g.x + c * colW + inset,
        y: g.y + v * rowH + rowH / 2,
      });
    }
  }
  return out;
}
