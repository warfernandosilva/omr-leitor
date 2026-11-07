// ─── Edição geométrica do cartão (funções puras) ───
//
// Alinhar, distribuir, encaixar na grade e nas guias. Tudo em coordenadas
// normalizadas (0..1), então serve para qualquer resolução/página.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** Mantém o retângulo dentro da página (encolhe se passar da borda). */
export function clampRect(r: Rect): Rect {
  const w = Math.max(0.001, Math.min(1, r.w));
  const h = Math.max(0.001, Math.min(1, r.h));
  return {
    x: Math.max(0, Math.min(1 - w, r.x)),
    y: Math.max(0, Math.min(1 - h, r.y)),
    w,
    h,
  };
}

/** Alinha todos os retângulos pela borda/centro pedido (primeiro como referência
 *  só no eixo: usa o extremo, que é o que o usuário espera de "alinhar à esquerda"). */
export function alignRects(rects: Rect[], mode: AlignMode): Rect[] {
  if (rects.length < 2) return rects;
  const left = Math.min(...rects.map((r) => r.x));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const top = Math.min(...rects.map((r) => r.y));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return rects.map((r) => {
    switch (mode) {
      case 'left': return { ...r, x: left };
      case 'right': return { ...r, x: right - r.w };
      case 'hcenter': return { ...r, x: (left + right) / 2 - r.w / 2 };
      case 'top': return { ...r, y: top };
      case 'bottom': return { ...r, y: bottom - r.h };
      case 'vcenter': return { ...r, y: (top + bottom) / 2 - r.h / 2 };
      default: return r;
    }
  });
}

/** Distribui com espaçamento igual entre os centros (mín. 3 elementos). */
export function distributeRects(rects: Rect[], axis: 'x' | 'y'): Rect[] {
  if (rects.length < 3) return rects;
  const size = axis === 'x' ? 'w' : 'h';
  const order = rects
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r[axis] - b.r[axis]);
  const first = order[0].r;
  const last = order[order.length - 1].r;
  const total = order.reduce((acc, o) => acc + o.r[size], 0);
  const span = (last[axis] + last[size]) - first[axis];
  const gap = (span - total) / (order.length - 1);
  let cursor = first[axis];
  const out = rects.slice();
  for (const o of order) {
    out[o.i] = { ...o.r, [axis]: cursor };
    cursor += o.r[size] + gap;
  }
  return out;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guidesX: number[];
  guidesY: number[];
}

const GRID = 0.005;

/**
 * Deslocamento magnético para a posição arrastada.
 *
 * As guias (bordas/centros dos outros elementos) têm prioridade sobre a grade:
 * se algo está a menos de `tol` da borda de outro elemento, encosta nele.
 */
export function snapDelta(
  rect: Rect, others: Rect[], grid = GRID, tol = 0.004,
): SnapResult {
  const xs = [rect.x, rect.x + rect.w / 2, rect.x + rect.w];
  const ys = [rect.y, rect.y + rect.h / 2, rect.y + rect.h];

  let bestX = { dist: Infinity, d: 0, guide: null as number | null };
  let bestY = { dist: Infinity, d: 0, guide: null as number | null };

  for (const o of others) {
    for (const target of [o.x, o.x + o.w / 2, o.x + o.w]) {
      for (const v of xs) {
        const d = target - v;
        if (Math.abs(d) <= tol && Math.abs(d) < bestX.dist) {
          bestX = { dist: Math.abs(d), d, guide: target };
        }
      }
    }
    for (const target of [o.y, o.y + o.h / 2, o.y + o.h]) {
      for (const v of ys) {
        const d = target - v;
        if (Math.abs(d) <= tol && Math.abs(d) < bestY.dist) {
          bestY = { dist: Math.abs(d), d, guide: target };
        }
      }
    }
  }

  const snapToGrid = (v: number) => Math.round(v / grid) * grid - v;
  return {
    dx: bestX.guide !== null ? bestX.d : snapToGrid(rect.x),
    dy: bestY.guide !== null ? bestY.d : snapToGrid(rect.y),
    guidesX: bestX.guide !== null ? [bestX.guide] : [],
    guidesY: bestY.guide !== null ? [bestY.guide] : [],
  };
}

/** Novo id local (o backend aceita qualquer string; só precisa ser único). */
export function newRegionId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Alinha pela MARGEM DA PÁGINA (não pela seleção, como `alignRects`). */
export function alignToMargin(
  rects: Rect[], side: 'left' | 'right' | 'top' | 'bottom', margin = 0.05,
): Rect[] {
  return rects.map((r) => {
    switch (side) {
      case 'left': return { ...r, x: margin };
      case 'right': return { ...r, x: 1 - margin - r.w };
      case 'top': return { ...r, y: margin };
      default: return { ...r, y: 1 - margin - r.h };
    }
  });
}

/** Empilha os retângulos de cima para baixo, na ordem visual (y, depois x),
 *  com uma folga fixa entre eles, alinhados à margem. Quando a pilha estoura a
 *  altura da página, começa uma coluna nova à direita — como o "Organizar" de
 *  um editor de documentos. */
export function organizeRects(
  rects: Rect[], margin = 0.05, gap = 0.02, colStep = 0.45,
): Rect[] {
  if (!rects.length) return rects;
  const order = rects
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x);
  const out = rects.slice();
  let col = 0;
  let y = margin;
  for (const o of order) {
    if (y + o.r.h > 1 - margin) {
      col += 1;
      y = margin;
    }
    const x = margin + col * colStep;
    out[o.i] = clampRect({ ...o.r, x, y });
    y += o.r.h + gap;
  }
  return out;
}
