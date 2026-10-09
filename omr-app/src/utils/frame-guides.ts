// ─── Guia de enquadramento: detector leve dos 4 quadrados-âncora ───
// Funcões puras sobre buffers grayscale (testáveis em Node, sem DOM).
// Vale para os 6 modelos: ArUco/quadrados aparecem como blocos escuros de
// longe; o Simulado (sem marcador) usa o modo singleRect — as réguas da
// tabela viram as 4 quinas.

export interface CornerPoint {
  x: number; // 0..1 (normalizado pelo frame)
  y: number;
}

export type CornerName = 'TL' | 'TR' | 'BR' | 'BL';

export interface FrameAnalysis {
  corners: Partial<Record<CornerName, CornerPoint>>;
  found: number; // 0..4
  coverage: number; // área do quad / área do frame
  skew: number; // max(top/bottom, left/right) - 1 (0 = perfeito)
  rotationDeg: number; // ângulo da aresta superior
  sharpness: number; // variância do Laplaciano
  brightness: number; // média 0..255
  locked: boolean;
  hint: string;
}

export interface GuideThresholds {
  darkLevel: number; // pixel < darkLevel é "escuro"
  minAreaFrac: number; // área mín. do componente / área do frame
  maxAreaFrac: number; // área máx. do componente / área do frame
  minFillRatio: number; // área / bbox (solidez do quadrado)
  minCoverage: number; // quad mín. / frame
  maxCoverage: number; // quad máx. / frame
  maxSkew: number;
  maxRotationDeg: number;
  minSharpness: number;
  minBrightness: number;
  maxBrightness: number;
  /**
   * Modo "retângulo único": o gabarito não tem marcadores de canto (Simulado)
   * — a maior malha escura (as réguas da tabela) é reduzida às suas 4 quinas
   * extremas, que viram TL/TR/BR/BL. Ativa também a faixa de aspecto própria.
   */
  singleRect?: boolean;
}

export const DEFAULT_THRESHOLDS: GuideThresholds = {
  darkLevel: 110,
  minAreaFrac: 0.0003,
  maxAreaFrac: 0.02,
  minFillRatio: 0.55,
  minCoverage: 0.12,
  maxCoverage: 0.9,
  maxSkew: 0.35,
  maxRotationDeg: 12,
  minSharpness: 25,
  minBrightness: 60,
  maxBrightness: 220,
};

interface Component {
  area: number;
  x0: number; y0: number; x1: number; y1: number;
  cx: number; cy: number;
  // quinas extremas (min x+y / min y−x / max x+y / max y−x) — modo singleRect
  xtl: number; ytl: number;
  xtr: number; ytr: number;
  xbr: number; ybr: number;
  xbl: number; ybl: number;
}

// Faixa de aspecto (largura/altura) por modo: as âncoras clássicas são quase
// quadradas; a tabela do Simulado é alta e estreita (~0.44).
function aspectOk(aspect: number, singleRect: boolean | undefined): boolean {
  if (singleRect) return aspect >= 0.25 && aspect <= 0.75;
  return aspect >= 0.7 && aspect <= 1.43;
}

function findDarkComponents(
  gray: Uint8Array | Uint8ClampedArray, w: number, h: number, th: GuideThresholds,
): Component[] {
  const visited = new Uint8Array(w * h);
  const comps: Component[] = [];
  const minArea = th.minAreaFrac * w * h;
  const maxArea = th.maxAreaFrac * w * h;
  const stack: number[] = [];

  for (let i = 0; i < w * h; i++) {
    if (visited[i] || gray[i] >= th.darkLevel) continue;
    // flood fill (4-conectividade)
    let area = 0;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    let sx = 0, sy = 0;
    let bestTL = Infinity, bestTR = Infinity, bestBR = -Infinity, bestBL = -Infinity;
    let xtl = 0, ytl = 0, xtr = 0, ytr = 0, xbr = 0, ybr = 0, xbl = 0, ybl = 0;
    stack.length = 0;
    stack.push(i);
    visited[i] = 1;
    while (stack.length > 0) {
      const p = stack.pop()!;
      const px = p % w, py = (p / w) | 0;
      area++; sx += px; sy += py;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
      const dTL = px + py;
      if (dTL < bestTL) { bestTL = dTL; xtl = px; ytl = py; }
      const dTR = py - px;
      if (dTR < bestTR) { bestTR = dTR; xtr = px; ytr = py; }
      const dBR = px + py;
      if (dBR > bestBR) { bestBR = dBR; xbr = px; ybr = py; }
      const dBL = py - px;
      if (dBL > bestBL) { bestBL = dBL; xbl = px; ybl = py; }
      // vizinhos
      if (px > 0) { const q = p - 1; if (!visited[q] && gray[q] < th.darkLevel) { visited[q] = 1; stack.push(q); } }
      if (px < w - 1) { const q = p + 1; if (!visited[q] && gray[q] < th.darkLevel) { visited[q] = 1; stack.push(q); } }
      if (py > 0) { const q = p - w; if (!visited[q] && gray[q] < th.darkLevel) { visited[q] = 1; stack.push(q); } }
      if (py < h - 1) { const q = p + w; if (!visited[q] && gray[q] < th.darkLevel) { visited[q] = 1; stack.push(q); } }
    }
    if (area < minArea || area > maxArea) continue;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (bw <= 0 || bh <= 0) continue;
    if (!aspectOk(bw / bh, th.singleRect)) continue;
    if (area / (bw * bh) < th.minFillRatio) continue;
    comps.push({
      area, x0, y0, x1, y1, cx: sx / area, cy: sy / area,
      xtl, ytl, xtr, ytr, xbr, ybr, xbl, ybl,
    });
  }
  return comps;
}

function quadArea(tl: CornerPoint, tr: CornerPoint, br: CornerPoint, bl: CornerPoint): number {
  // Shoelace
  const xs = [tl.x, tr.x, br.x, bl.x];
  const ys = [tl.y, tr.y, br.y, bl.y];
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    a += xs[i] * ys[j] - xs[j] * ys[i];
  }
  return Math.abs(a) / 2;
}

function dist(a: CornerPoint, b: CornerPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function laplacianVariance(
  gray: Uint8Array | Uint8ClampedArray, w: number, h: number,
): number {
  // Amostra 1 a cada 2 px por velocidade
  let sum = 0, sumSq = 0, n = 0;
  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const i = y * w + x;
      const lap = -4 * gray[i] + gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w];
      sum += lap; sumSq += lap * lap; n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

// Nitidez de um buffer grayscale (0..∞; maior = mais nítido).
// Reaproveitado pelo portão de nitidez na hora da captura.
export function measureSharpness(
  gray: Uint8Array | Uint8ClampedArray, w: number, h: number,
): number {
  return laplacianVariance(gray, w, h);
}

export function analyzeFrame(
  gray: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  th: GuideThresholds = DEFAULT_THRESHOLDS,
): FrameAnalysis {
  const base: Omit<FrameAnalysis, 'locked' | 'hint'> = {
    corners: {}, found: 0, coverage: 0, skew: 0, rotationDeg: 0,
    sharpness: 0, brightness: 0,
  };
  if (w < 8 || h < 8 || gray.length < w * h) {
    return { ...base, locked: false, hint: 'Apontando a câmera...' };
  }

  // Brilho médio (amostra rápida)
  let bSum = 0, bN = 0;
  for (let i = 0; i < gray.length; i += 7) { bSum += gray[i]; bN++; }
  const brightness = bN ? bSum / bN : 0;

  const comps = findDarkComponents(gray, w, h, th);
  const corners: Partial<Record<CornerName, CornerPoint>> = {};
  if (th.singleRect) {
    // Sem marcadores: um único componente grande vira as 4 quinas extremas.
    let best: Component | null = null;
    for (const c of comps) if (!best || c.area > best.area) best = c;
    if (best) {
      corners.TL = { x: best.xtl / w, y: best.ytl / h };
      corners.TR = { x: best.xtr / w, y: best.ytr / h };
      corners.BR = { x: best.xbr / w, y: best.ybr / h };
      corners.BL = { x: best.xbl / w, y: best.ybl / h };
    }
  } else {
    // 1 candidato por quadrante (o de maior área)
    const quad: Partial<Record<CornerName, Component>> = {};
    for (const c of comps) {
      const left = c.cx < w / 2, top = c.cy < h / 2;
      const name: CornerName = top ? (left ? 'TL' : 'TR') : (left ? 'BL' : 'BR');
      if (!quad[name] || c.area > quad[name]!.area) quad[name] = c;
    }
    (Object.keys(quad) as CornerName[]).forEach(k => {
      const c = quad[k]!;
      corners[k] = { x: c.cx / w, y: c.cy / h };
    });
  }
  const found = (['TL', 'TR', 'BR', 'BL'] as CornerName[]).filter(k => corners[k]).length;

  let coverage = 0, skew = 0, rotationDeg = 0;
  if (found === 4) {
    const tl = corners.TL!, tr = corners.TR!, br = corners.BR!, bl = corners.BL!;
    coverage = quadArea(tl, tr, br, bl); // já normalizado (0..1)
    const top = dist(tl, tr), bottom = dist(bl, br);
    const left = dist(tl, bl), right = dist(tr, br);
    skew = Math.max(top / (bottom || 1), bottom / (top || 1), left / (right || 1), right / (left || 1)) - 1;
    rotationDeg = (Math.atan2(tr.y - tl.y, tr.x - tl.x) * 180) / Math.PI;
  }
  const sharpness = laplacianVariance(gray, w, h);

  let hint = 'Enquadramento bom — segure firme...';
  let locked = false;
  if (found < 4) {
    hint = th.singleRect
      ? 'Mostre o cartão inteiro na tela (a tabela ainda não apareceu)'
      : `Mostre os 4 cantos do cartão (${found}/4 visíveis)`;
  } else if (coverage < th.minCoverage) {
    hint = 'Aproxime o cartão da câmera';
  } else if (coverage > th.maxCoverage) {
    hint = 'Afaste o cartão da câmera';
  } else if (skew > th.maxSkew) {
    hint = 'Alinhe de frente para o cartão (sem inclinar)';
  } else if (Math.abs(rotationDeg) > th.maxRotationDeg) {
    hint = 'Desvire o celular ou o cartão';
  } else if (brightness < th.minBrightness || brightness > th.maxBrightness) {
    hint = 'Melhore a iluminação (sem sombra nem estouro)';
  } else if (sharpness < th.minSharpness) {
    hint = 'Segure firme — imagem tremida';
  } else {
    locked = true;
  }

  return { corners, found, coverage, skew, rotationDeg, sharpness, brightness, locked, hint };
}
