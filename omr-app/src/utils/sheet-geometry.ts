// ─── Geometria da folha em milímetros (funções puras) ───
//
// O editor do protótipo de referência trabalha em milímetros: a página A4 é
// 210 × 297 mm, os elementos guardam posição/tamanho em mm e a tela converte
// com `MM_PX` (96 dpi). O zoom é apenas uma transformação visual.
//
// Este módulo concentra a matemática do editor para poder testá-la sem DOM.

export const MM_PX = 3.7795275591;

/** Passo da grade visual da folha (mm). */
export const GRID_MM = 5;

/** Níveis discretos de zoom do protótipo (25% a 200%). */
export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.85, 1, 1.25, 1.5, 1.75, 2];

export interface RectMm {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ResizeDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

export function clampZoom(zoom: number): number {
  return clamp(zoom, ZOOM_STEPS[0], ZOOM_STEPS[ZOOM_STEPS.length - 1]);
}

/** Próximo nível discreto de zoom (dir = 1 aproxima, -1 afasta). */
export function zoomStep(zoom: number, dir: 1 | -1): number {
  if (dir > 0) {
    const next = ZOOM_STEPS.find((z) => z > zoom + 0.001);
    return next ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  }
  const prev = [...ZOOM_STEPS].reverse().find((z) => z < zoom - 0.001);
  return prev ?? ZOOM_STEPS[0];
}

/**
 * Zoom que faz a folha inteira caber na área visível.
 *
 * Mesmo cálculo do protótipo: desconta 76 px de folga (réguas + margem),
 * arredonda o resultado para baixo em duas casas e limita a 25%–200%.
 */
export function fitZoom(
  clientW: number,
  clientH: number,
  pageWmm: number,
  pageHmm: number,
  padding = 76,
): number {
  const availW = Math.max(120, clientW - padding);
  const availH = Math.max(120, clientH - padding);
  const byWidth = availW / (pageWmm * MM_PX);
  const byHeight = availH / (pageHmm * MM_PX);
  return clampZoom(Math.floor(Math.min(byWidth, byHeight) * 100) / 100);
}

export function mmToPx(mm: number, zoom: number): number {
  return mm * MM_PX * zoom;
}

/** Encaixa um valor no múltiplo mais próximo da grade. */
export function snapToGrid(value: number, step = GRID_MM): number {
  return Math.round(value / step) * step;
}

/**
 * Encaixa na grade sem deixar o item passar de `max` (borda da folha).
 * Quando o limite não cai num múltiplo, arredonda para baixo para o item
 * continuar alinhado aos quadradinhos.
 */
export function snapToGridWithin(value: number, max: number, step = GRID_MM): number {
  const limit = Math.floor(Math.max(0, max) / step) * step;
  return Math.min(snapToGrid(value, step), limit);
}

/**
 * Trava na grade as pontas que o arrasto está movendo (alças de resize).
 *
 * Só as arestas indicadas em `dir` são encaixadas: a alça `e` mexe a borda
 * direita, a `w` a esquerda, e assim por diante. A borda oposta fica onde
 * está. Limites da folha e o tamanho mínimo têm prioridade sobre a grade.
 */
export function snapResizeMm(
  rect: RectMm,
  dir: ResizeDir,
  minW: number,
  minH: number,
  pageW: number,
  pageH: number,
  step = GRID_MM,
): RectMm {
  let x1 = rect.x;
  let y1 = rect.y;
  let x2 = rect.x + rect.w;
  let y2 = rect.y + rect.h;

  // Apenas as arestas que a alça mexe são encaixadas; a oposta fica onde está.
  if (dir.includes('w')) x1 = clamp(snapToGrid(x1, step), 0, Math.max(0, x2 - minW));
  if (dir.includes('e')) x2 = clamp(snapToGrid(x2, step), Math.min(pageW, x1 + minW), pageW);
  if (dir.includes('n')) y1 = clamp(snapToGrid(y1, step), 0, Math.max(0, y2 - minH));
  if (dir.includes('s')) y2 = clamp(snapToGrid(y2, step), Math.min(pageH, y1 + minH), pageH);

  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function pxToMm(px: number, zoom: number): number {
  return px / (MM_PX * zoom);
}

/** Mantém o retângulo dentro da página (posição e tamanho em mm). */
export function clampRectMm(r: RectMm, pageW: number, pageH: number): RectMm {
  const w = clamp(r.w, 0, pageW);
  const h = clamp(r.h, 0, pageH);
  return {
    x: clamp(r.x, 0, Math.max(0, pageW - w)),
    y: clamp(r.y, 0, Math.max(0, pageH - h)),
    w,
    h,
  };
}

/**
 * Redimensiona pelas 8 alças. `minW`/`minH` são os tamanhos mínimos em mm
 * (blocos: 18 × 14; demais elementos: 2 × 2).
 */
export function resizeRectMm(
  r: RectMm,
  dir: ResizeDir,
  dx: number,
  dy: number,
  minW: number,
  minH: number,
  pageW: number,
  pageH: number,
): RectMm {
  let x1 = r.x;
  let y1 = r.y;
  let x2 = r.x + r.w;
  let y2 = r.y + r.h;

  if (dir.includes('w')) x1 = clamp(r.x + dx, 0, Math.max(0, x2 - minW));
  if (dir.includes('e')) x2 = clamp(r.x + r.w + dx, Math.min(pageW, x1 + minW), pageW);
  if (dir.includes('n')) y1 = clamp(r.y + dy, 0, Math.max(0, y2 - minH));
  if (dir.includes('s')) y2 = clamp(r.y + r.h + dy, Math.min(pageH, y1 + minH), pageH);

  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/**
 * Mantém o retângulo quadrado (âncoras e QR). A alça escolhe o lado — cantos
 * usam o maior dos dois eixos — e a borda oposta continua fixa. Nas alças de
 * cima/baixo o centro horizontal é preservado (e vice-versa).
 */
export function squareResizeMm(
  rect: RectMm,
  orig: RectMm,
  dir: ResizeDir,
  minSide: number,
  pageW: number,
  pageH: number,
): RectMm {
  const horizontal = dir.includes('e') || dir.includes('w');
  const vertical = dir.includes('n') || dir.includes('s');
  let side = horizontal && vertical ? Math.max(rect.w, rect.h) : horizontal ? rect.w : rect.h;
  side = clamp(side, minSide, Math.min(pageW, pageH));

  const x = horizontal
    ? dir.includes('w') ? orig.x + orig.w - side : orig.x
    : orig.x + orig.w / 2 - side / 2;
  const y = vertical
    ? dir.includes('n') ? orig.y + orig.h - side : orig.y
    : orig.y + orig.h / 2 - side / 2;
  return {
    x: clamp(x, 0, Math.max(0, pageW - side)),
    y: clamp(y, 0, Math.max(0, pageH - side)),
    w: side,
    h: side,
  };
}

export interface SnapResultMm {
  dx: number;
  dy: number;
  /** Coordenada X (mm) da guia vertical, quando encostou em algo. */
  guidesX: number[];
  /** Coordenada Y (mm) da guia horizontal, quando encostou em algo. */
  guidesY: number[];
}

/**
 * Ímã de alinhamento em milímetros.
 *
 * Compara bordas e centros do retângulo com as bordas/centros da página e dos
 * outros elementos. Vence a menor distância dentro da tolerância (1,4 mm no
 * protótipo). Devolve o deslocamento a aplicar e as guias para desenhar.
 */
export function findSnapMm(
  rect: RectMm,
  others: RectMm[],
  pageW: number,
  pageH: number,
  tol = 1.4,
): SnapResultMm {
  const ownX = [rect.x, rect.x + rect.w / 2, rect.x + rect.w];
  const ownY = [rect.y, rect.y + rect.h / 2, rect.y + rect.h];

  const targetsX = [0, pageW / 2, pageW];
  const targetsY = [0, pageH / 2, pageH];
  for (const o of others) {
    targetsX.push(o.x, o.x + o.w / 2, o.x + o.w);
    targetsY.push(o.y, o.y + o.h / 2, o.y + o.h);
  }

  let bestX: { dist: number; delta: number; guide: number } | null = null;
  let bestY: { dist: number; delta: number; guide: number } | null = null;

  for (const target of targetsX) {
    for (const value of ownX) {
      const delta = target - value;
      const dist = Math.abs(delta);
      if (dist <= tol && (!bestX || dist < bestX.dist)) bestX = { dist, delta, guide: target };
    }
  }
  for (const target of targetsY) {
    for (const value of ownY) {
      const delta = target - value;
      const dist = Math.abs(delta);
      if (dist <= tol && (!bestY || dist < bestY.dist)) bestY = { dist, delta, guide: target };
    }
  }

  return {
    dx: bestX?.delta ?? 0,
    dy: bestY?.delta ?? 0,
    guidesX: bestX ? [bestX.guide] : [],
    guidesY: bestY ? [bestY.guide] : [],
  };
}

export interface RulerTick {
  mm: number;
  major: boolean;
  /** Marcas com rótulo numérico (em zoom baixo o rótulo fica a cada 20 mm). */
  label: boolean;
}

/** Marcas da régua a cada 5 mm (maiores a cada 10 mm), como no protótipo. */
export function rulerTicks(
  lengthMm: number,
  step = 5,
  majorEveryMm = 10,
  labelEveryMm = majorEveryMm,
): RulerTick[] {
  const total = Math.floor(lengthMm / step);
  const out: RulerTick[] = [];
  for (let i = 0; i <= total; i += 1) {
    const mm = i * step;
    out.push({
      mm,
      major: mm % majorEveryMm === 0,
      label: mm % labelEveryMm === 0,
    });
  }
  return out;
}
