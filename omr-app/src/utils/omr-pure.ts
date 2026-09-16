// ─── Motor OMR — novo template 1448×2048 (círculos + marcadores de calibração) ───
import { FLOOR as _FLOOR_CFG, MARGIN as _MARGIN_CFG } from './omr-config';

export const PAGE_WIDTH = 1448;
export const PAGE_HEIGHT = 2048;
export const TOTAL_QUESTIONS = 44;
export const QUESTIONS_PER_SUBJECT = 22;
export const VALID_ANSWERS = ['A', 'B', 'C', 'D'] as const;
export type Alternative = (typeof VALID_ANSWERS)[number];

// ─── Geometria do cartão ───

export const DIVIDER_X = 723;

export const QUESTION_Y = [
  721.0, 773.5, 826.0, 878.5, 931.0, 983.5, 1036.0, 1088.5, 1141.0, 1194.0, 1246.5,
  1299.0, 1351.5, 1404.0, 1456.5, 1509.0, 1562.0, 1614.5, 1667.0, 1719.5, 1772.0, 1824.5,
];

export const PORTUGUESE_X = [329.5, 419.5, 509.5, 599.0];
export const MATHEMATICS_X = [919.5, 1009.5, 1098.5, 1188.5];

export const BUBBLE_DIAMETER = 37;
export const BUBBLE_RADIUS = BUBBLE_DIAMETER / 2;
export const MARKER_SIZE = 34;

// ─── Identificação ───

export const ALUNO_BOX = { x0: 100, y0: 119, x1: 1349, y1: 206, label: 'Aluno (a):', textX: 110, textY: 138 };
export const TURMA_BOX = { x0: 100, y0: 204, x1: 725, y1: 291, label: 'Turma:', textX: 110, textY: 229 };

export const SUBJECT_TITLES = {
  portugues: { text: 'PORTUGUÊS', centerX: 429, centerY: 512, fontSize: 40 },
  matematica: { text: 'MATEMÁTICA', centerX: 1018, centerY: 512, fontSize: 40 },
} as const;

export const HEADER_Y = 635;

export const QUESTION_NUM_X = { portugues: 260, matematica: 850 } as const;

// ─── Marcadores de calibração (centros) ───
// 18 marcadores: 4 no topo, 4 embaixo, 5 em cada lateral.

export const MARKER_CENTERS = [
  { x: 117.5, y: 396.0 },
  { x: 522.0, y: 396.0 },
  { x: 926.0, y: 396.0 },
  { x: 1330.5, y: 396.0 },
  { x: 117.5, y: 648.5 },
  { x: 117.5, y: 901.0 },
  { x: 117.5, y: 1153.5 },
  { x: 117.5, y: 1406.0 },
  { x: 117.5, y: 1658.5 },
  { x: 1330.5, y: 648.5 },
  { x: 1330.5, y: 901.0 },
  { x: 1330.5, y: 1153.5 },
  { x: 1330.5, y: 1406.0 },
  { x: 1330.5, y: 1658.5 },
  { x: 117.5, y: 1911.5 },
  { x: 522.0, y: 1911.5 },
  { x: 926.0, y: 1911.5 },
  { x: 1330.5, y: 1911.5 },
];

// Os 4 marcadores externos (em ordem [TL, TR, BR, BL]) usados na homografia.
export const OUTER_MARKER_LOGICAL: { x: number; y: number }[] = [
  { x: 117.5, y: 396.0 },
  { x: 1330.5, y: 396.0 },
  { x: 1330.5, y: 1911.5 },
  { x: 117.5, y: 1911.5 },
];

// ─── Modelo do cartão ───

export interface BubbleOption {
  question: number;
  alternative: Alternative;
  centerX: number;
  centerY: number;
  radius: number;
}

export interface SubjectModel {
  id: 'portugues' | 'matematica';
  title: string;
  centerX: number;
  centerY: number;
  alternatives: { letter: Alternative; x: number }[];
  headerY: number;
  questionNumX: number;
  questions: { y: number; options: BubbleOption[] }[];
}

export interface CardModel {
  pageWidth: number;
  pageHeight: number;
  identification: {
    aluno: { x0: number; y0: number; x1: number; y1: number; label: string; textX: number; textY: number };
    turma: { x0: number; y0: number; x1: number; y1: number; label: string; textX: number; textY: number };
  };
  calibrationMarkers: { x: number; y: number; size: number }[];
  divider: { x: number; y0: number; y1: number; width: number };
  subjects: SubjectModel[];
}

export function buildCardModel(): CardModel {
  const makeSubject = (
    id: 'portugues' | 'matematica',
    xs: number[],
    titleX: number,
    questionNumX: number
  ): SubjectModel => ({
    id,
    title: SUBJECT_TITLES[id].text,
    centerX: titleX,
    centerY: SUBJECT_TITLES[id].centerY,
    alternatives: xs.map((x, c) => ({ letter: VALID_ANSWERS[c], x })),
    headerY: HEADER_Y,
    questionNumX,
    questions: QUESTION_Y.map(y => ({
      y,
      options: xs.map((x, c) => ({
        question: QUESTION_Y.indexOf(y) + 1,
        alternative: VALID_ANSWERS[c],
        centerX: x,
        centerY: y,
        radius: BUBBLE_RADIUS,
      })),
    })),
  });

  return {
    pageWidth: PAGE_WIDTH,
    pageHeight: PAGE_HEIGHT,
    identification: { aluno: ALUNO_BOX, turma: TURMA_BOX },
    calibrationMarkers: MARKER_CENTERS.map(m => ({ x: m.x, y: m.y, size: MARKER_SIZE })),
    divider: { x: DIVIDER_X, y0: 465, y1: 1844, width: 3 },
    subjects: [
      makeSubject('portugues', PORTUGUESE_X, SUBJECT_TITLES.portugues.centerX, QUESTION_NUM_X.portugues),
      makeSubject('matematica', MATHEMATICS_X, SUBJECT_TITLES.matematica.centerX, QUESTION_NUM_X.matematica),
    ],
  };
}

// ─── Utilitários de pixel ───

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function pxGray(data: Uint8ClampedArray, x: number, y: number, w: number): number {
  const i = (y * w + x) * 4;
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}

function bilinearSampleRGB(
  data: Uint8ClampedArray, w: number, h: number, fx: number, fy: number
): [number, number, number] {
  const x0 = clamp(Math.floor(fx), 0, w - 1);
  const y0 = clamp(Math.floor(fy), 0, h - 1);
  const x1 = clamp(x0 + 1, 0, w - 1);
  const y1 = clamp(y0 + 1, 0, h - 1);
  const dx = fx - x0;
  const dy = fy - y0;
  const i00 = (y0 * w + x0) * 4;
  const i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4;
  const i11 = (y1 * w + x1) * 4;
  const w00 = (1 - dx) * (1 - dy);
  const w10 = dx * (1 - dy);
  const w01 = (1 - dx) * dy;
  const w11 = dx * dy;
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    out[c] = w00 * data[i00 + c] + w10 * data[i10 + c] + w01 * data[i01 + c] + w11 * data[i11 + c];
  }
  return out;
}

function downscaleGray(
  data: Uint8ClampedArray, w: number, h: number, maxDim = 1200
): { gray: Float64Array; sw: number; sh: number; sx: number; sy: number } {
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const sw = Math.max(2, Math.round(w * scale));
  const sh = Math.max(2, Math.round(h * scale));
  const gray = new Float64Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    const sy = Math.min(h - 1, Math.round(y / scale));
    for (let x = 0; x < sw; x++) {
      const sx = Math.min(w - 1, Math.round(x / scale));
      gray[y * sw + x] = pxGray(data, sx, sy, w);
    }
  }
  return { gray, sw, sh, sx: sw / w, sy: sh / h };
}

// Limiar adaptativo por média local (integral image) — robusto a sombras/gradientes.
function adaptiveDarkMask(gray: Float64Array, sw: number, sh: number): Uint8Array {
  const w2 = sw + 1;
  const h2 = sh + 1;
  const integ = new Int32Array(w2 * h2);
  for (let y = 0; y < sh; y++) {
    let row = 0;
    for (let x = 0; x < sw; x++) {
      row += Math.round(gray[y * sw + x]);
      integ[(y + 1) * w2 + (x + 1)] = integ[y * w2 + (x + 1)] + row;
    }
  }
  const r = Math.max(16, Math.round(Math.min(sw, sh) * 0.05));
  const dark = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(sw - 1, x + r);
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(sh - 1, y + r);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        integ[(y1 + 1) * w2 + (x1 + 1)] -
        integ[y0 * w2 + (x1 + 1)] -
        integ[(y1 + 1) * w2 + x0] +
        integ[y0 * w2 + x0];
      const mean = sum / area;
      if (gray[y * sw + x] < mean - 30) dark[y * sw + x] = 1;
    }
  }
  return dark;
}

// ─── Componentes conectados escuros ───

interface Component {
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function labelDarkComponents(
  dark: Uint8Array, sw: number, sh: number
): { comp: Int32Array; stats: Component[] } {
  const comp = new Int32Array(sw * sh).fill(-1);
  const stats: Component[] = [];
  const stack: number[] = [];
  let nextId = 0;
  for (let i = 0; i < sw * sh; i++) {
    if (comp[i] !== -1 || dark[i] === 0) continue;
    comp[i] = nextId;
    stack.length = 0;
    stack.push(i);
    let area = 0;
    let minX = sw, minY = sh, maxX = -1, maxY = -1;
    while (stack.length) {
      const p = stack.pop()!;
      area++;
      const px = p % sw;
      const py = (p / sw) | 0;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      for (let ny = py - 1; ny <= py + 1; ny++) {
        for (let nx = px - 1; nx <= px + 1; nx++) {
          if (nx >= 0 && nx < sw && ny >= 0 && ny < sh) {
            const ni = ny * sw + nx;
            if (comp[ni] === -1 && dark[ni] === 1) {
              comp[ni] = nextId;
              stack.push(ni);
            }
          }
        }
      }
    }
    stats.push({ area, minX, minY, maxX, maxY });
    nextId++;
  }
  return { comp, stats };
}

// ─── Geometria estrutural dos marcadores ───
// O cartão tem 18 marcadores em uma grade conhecida: 4 no topo, 4 embaixo,
// 5 na lateral esquerda e 5 na lateral direita. Em vez de "achar 4 quadrados
// e ordenar", detectamos TODOS os candidatos a quadrado preenchido e usamos a
// geometria global (colunas) para identificar os 4 cantos reais.

interface MarkerCandidate {
  x: number; // coordenadas da foto
  y: number;
  bw: number;
  bh: number;
  area: number;
  fill: number;
}

// Agrupa candidatos por proximidade de X (colunas). Usa os objetos reais
// para que os membros de cada coluna sejam exatamente os marcadores do cluster.
function clusterCandidatesByX(cands: MarkerCandidate[], tol: number): MarkerCandidate[][] {
  const sorted = cands.slice().sort((a, b) => a.x - b.x);
  const clusters: MarkerCandidate[][] = [];
  let cur = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].x - cur[cur.length - 1].x <= tol) {
      cur.push(sorted[i]);
    } else {
      clusters.push(cur);
      cur = [sorted[i]];
    }
  }
  clusters.push(cur);
  return clusters;
}

/**
 * Validação geométrica OBRIGATÓRIA antes da homografia (especificação §7).
 * - Lados opostos com comprimentos compatíveis (tolerância 25%).
 * - Proporção largura/altura coerente com o template (~0.8).
 * - Quadrilátero convexo e com tamanho mínimo.
 */
function validateQuadGeometry(
  q: { x: number; y: number }[], w: number, h: number
): boolean {
  const [TL, TR, BR, BL] = q;
  const topW = Math.hypot(TR.x - TL.x, TR.y - TL.y);
  const botW = Math.hypot(BR.x - BL.x, BR.y - BL.y);
  const leftH = Math.hypot(BL.x - TL.x, BL.y - TL.y);
  const rightH = Math.hypot(BR.x - TR.x, BR.y - TR.y);

  const minDim = Math.min(w, h);
  if (topW < 0.2 * minDim || leftH < 0.2 * minDim) return false;

  // Lados opostos proporcionais (tolerância 25%).
  const wRatio = Math.max(topW, botW) / Math.min(topW, botW);
  const hRatio = Math.max(leftH, rightH) / Math.min(leftH, rightH);
  if (wRatio > 1.25 || hRatio > 1.25) return false;

  // Proporção do template: largura/altura ≈ 0.8 (tolerância ampla).
  const aspect = topW / ((leftH + rightH) / 2);
  if (aspect < 0.45 || aspect > 1.1) return false;

  // Convexidade: todos os produtos vetoriais com o mesmo sinal.
  const signs: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    signs.push(Math.sign(cr));
  }
  const nonZero = signs.filter(s => s !== 0);
  if (nonZero.length > 0 && new Set(nonZero).size > 1) return false;

  return true;
}

// ─── Detecção dos marcadores de calibração ───

/**
 * Localiza os 4 marcadores externos (quadrados pretos preenchidos) usando a
 * estrutura global dos 18 marcadores do cartão.
 *
 * 1. Detecta todos os candidatos a "quadrado preenchido" (tamanho, aspecto, fill).
 * 2. Agrupa os candidatos em colunas (X) e identifica a coluna mais à esquerda
 *    e a mais à direita — são as colunas dos marcadores laterais (as bolhas
 *    ficam entre elas).
 * 3. Os cantos são os membros das colunas mais próximos do menor Y (topo) e do
 *    maior Y (base) globais. Sob rotação as colunas podem se fundir com as
 *    bolhas adjacentes, mas os marcadores se estendem além das bolhas, então o
 *    membro mais acima e o mais abaixo de cada coluna ainda são marcadores.
 * 4. Valida a geometria do quadrilátero; se inválida, retorna null.
 *
 * Retorna as posições na foto em ordem [TL, TR, BR, BL], ou null.
 */
export function detectMarkers(
  data: Uint8ClampedArray, w: number, h: number
): { x: number; y: number }[] | null {
  const { gray, sw, sh, sx, sy } = downscaleGray(data, w, h, 1200);
  const dark = adaptiveDarkMask(gray, sw, sh);
  const { stats } = labelDarkComponents(dark, sw, sh);

  const minDim = Math.min(sw, sh);
  const sideLo = 0.008 * minDim;
  const sideHi = 0.05 * minDim;
  const fillMin = 0.6; // quadrado preenchido; exclui letras/números abertos

  const candidates: MarkerCandidate[] = [];
  for (const s of stats) {
    const bw = s.maxX - s.minX + 1;
    const bh = s.maxY - s.minY + 1;
    const aspect = bw / bh;
    if (aspect < 0.6 || aspect > 1.6) continue;
    if (bw < sideLo || bw > sideHi || bh < sideLo || bh > sideHi) continue;
    const fill = s.area / (bw * bh);
    if (fill < fillMin) continue;
    candidates.push({
      x: ((s.minX + s.maxX) / 2) / sx,
      y: ((s.minY + s.maxY) / 2) / sy,
      bw,
      bh,
      area: s.area,
      fill,
    });
  }

  if (candidates.length < 6) return null;

  // ─── Colunas (X) ───
  const tolX = Math.max(8, Math.round(0.02 * minDim / sx)); // em px da foto
  const colClusters = clusterCandidatesByX(candidates, tolX);
  // Colunas fortes = com pelo menos 2 marcadores alinhados (evita texto solto).
  const strongCols = colClusters.filter(cl => cl.length >= 2);
  if (strongCols.length < 2) return null;

  const leftCands = strongCols.reduce((a, b) => (a[0].x < b[0].x ? a : b));
  const rightCands = strongCols.reduce((a, b) => (a[0].x > b[0].x ? a : b));
  if (leftCands.length < 2 || rightCands.length < 2) return null;

  const topY = Math.min(...leftCands.map(c => c.y), ...rightCands.map(c => c.y));
  const botY = Math.max(...leftCands.map(c => c.y), ...rightCands.map(c => c.y));

  const nearest = (arr: MarkerCandidate[], target: number): { x: number; y: number } =>
    arr.reduce((a, b) => (Math.abs(b.y - target) < Math.abs(a.y - target) ? b : a));

  const ordered = [
    nearest(leftCands, topY),   // TL
    nearest(rightCands, topY),  // TR
    nearest(rightCands, botY),  // BR
    nearest(leftCands, botY),   // BL
  ];

  if (!validateQuadGeometry(ordered, w, h)) return null;
  return ordered;
}

// ─── Homografia ───

function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => row.slice().concat([b[i]]));
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    const tmp = M[col];
    M[col] = M[piv];
    M[piv] = tmp;
    const d = M[col][col] || 1e-12;
    for (let c = col; c <= n; c++) M[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map(row => row[n]);
}

// Mapeia src → dst com h33 = 1 (sistema 8×8).
function computeHomography(
  src: { x: number; y: number }[], dst: { x: number; y: number }[]
): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x: sx, y: sy } = src[i];
    const { x: dx, y: dy } = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]);
    b.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]);
    b.push(dy);
  }
  const h = solveLinear(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function applyH(m: number[], u: number, v: number): { x: number; y: number } {
  const den = m[6] * u + m[7] * v + m[8];
  return {
    x: (m[0] * u + m[1] * v + m[2]) / den,
    y: (m[3] * u + m[4] * v + m[5]) / den,
  };
}

/**
 * Retifica a fotografia para o plano do template (1448×2048) usando as
 * correspondências dos 4 marcadores externos: posição lógica (template) →
 * posição na foto. As coordenadas do template passam a valer no plano retificado.
 */
export function warpSheet(
  data: Uint8ClampedArray, w: number, h: number,
  markers: { x: number; y: number }[],
  outW: number, outH: number,
  templatePoints?: { x: number; y: number }[]
): Uint8ClampedArray {
  const H = computeHomography(templatePoints ?? OUTER_MARKER_LOGICAL, markers);
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let ry = 0; ry < outH; ry++) {
    for (let rx = 0; rx < outW; rx++) {
      const p = applyH(H, rx, ry);
      const rgb = bilinearSampleRGB(data, w, h, p.x, p.y);
      const idx = (ry * outW + rx) * 4;
      out[idx] = rgb[0];
      out[idx + 1] = rgb[1];
      out[idx + 2] = rgb[2];
      out[idx + 3] = 255;
    }
  }
  return out;
}

export function normalizeRect(rect: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const n = w * h;
  const hist = new Int32Array(256);
  for (let i = 0; i < n; i++) {
    const g = Math.round(0.299 * rect[i * 4] + 0.587 * rect[i * 4 + 1] + 0.114 * rect[i * 4 + 2]);
    hist[Math.max(0, Math.min(255, g))]++;
  }
  let lo = 255;
  let hi = 0;
  let cum = 0;
  const targetLo = n * 0.005;
  for (let t = 0; t < 256; t++) {
    cum += hist[t];
    if (cum >= targetLo) {
      lo = t;
      break;
    }
  }
  cum = 0;
  const targetHi = n * 0.995;
  for (let t = 255; t >= 0; t--) {
    cum += hist[t];
    if (cum >= n - targetHi) {
      hi = t;
      break;
    }
  }
  if (hi - lo < 40) {
    lo = 0;
    hi = 255;
  }
  const range = hi - lo || 1;
  const out = new Uint8ClampedArray(rect.length);
  for (let i = 0; i < n; i++) {
    const g = 0.299 * rect[i * 4] + 0.587 * rect[i * 4 + 1] + 0.114 * rect[i * 4 + 2];
    const v = Math.max(0, Math.min(255, Math.round(((g - lo) / range) * 255)));
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return out;
}

// ─── Leitura das bolhas (ROI circular) ───

const INNER_RADIUS = 11;          // raio interno: conteúdo da bolha (ignora o contorno)
const OFFSETS = [-8, -4, 0, 4, 8]; // busca local ±8px (especificação §12)
const SAFE_INNER = 16;            // interior seguro da bolha (fora do contorno ~17–20)

// Estatísticas do disco interno da bolha em uma posição de busca (ox, oy).
// Os pixels são limitados ao interior seguro da própria bolha (raio SAFE_INNER
// em torno do centro original), para que o deslocamento da busca nunca capture
// o contorno da bolha (que é escuro e inflaria o score de bolhas em branco).
function diskStats(
  rect: Uint8ClampedArray, w: number, h: number,
  cx: number, cy: number, ox: number, oy: number, thr: number
): { mean: number; min: number; darkRatio: number; total: number } {
  let sum = 0;
  let min = 255;
  let dark = 0;
  let total = 0;
  for (let dy = -INNER_RADIUS; dy <= INNER_RADIUS; dy++) {
    for (let dx = -INNER_RADIUS; dx <= INNER_RADIUS; dx++) {
      if (Math.hypot(dx, dy) > INNER_RADIUS) continue;
      const px = cx + ox + dx;
      const py = cy + oy + dy;
      if (Math.hypot(px - cx, py - cy) > SAFE_INNER) continue;
      const ix = Math.round(px);
      const iy = Math.round(py);
      if (ix < 0 || ix >= w || iy < 0 || iy >= h) continue;
      const g = pxGray(rect, ix, iy, w);
      sum += g;
      if (g < min) min = g;
      if (g < thr) dark++;
      total++;
    }
  }
  return { mean: sum / (total || 1), min, darkRatio: total ? dark / total : 0, total };
}

/**
 * Score combinado da bolha (especificação §20-21):
 *   40% intensidade média do disco, 40% fração de pixels escuros,
 *   20% contraste local (papel − mínimo), todos relativos ao nível de papel
 *   estimado por um anel local fora da bolha. Toma o máximo sobre a busca
 *   local de ±8px para tolerar pequenos erros de retificação.
 */
function sampleBubbleRatio(rect: Uint8ClampedArray, outW: number, outH: number, cx: number, cy: number): number {
  // Nível do papel: anel logo fora da bolha (raio 24–30).
  const vals: number[] = [];
  for (let dy = -30; dy <= 30; dy++) {
    for (let dx = -30; dx <= 30; dx++) {
      const d = Math.hypot(dx, dy);
      if (d >= 24 && d <= 30) {
        const px = Math.round(cx + dx);
        const py = Math.round(cy + dy);
        if (px >= 0 && px < outW && py >= 0 && py < outH) {
          vals.push(pxGray(rect, px, py, outW));
        }
      }
    }
  }
  const paper = vals.length
    ? vals.sort((a, b) => a - b)[Math.min(vals.length - 1, Math.floor(vals.length * 0.75))]
    : 255;
  if (paper < 1) return 0;
  const thr = paper - 40;

  let best = 0;
  for (const ox of OFFSETS) {
    for (const oy of OFFSETS) {
      const s = diskStats(rect, outW, outH, cx, cy, ox, oy, thr);
      if (s.total === 0) continue;
      const intensity = Math.max(0, Math.min(1, 1 - s.mean / paper));
      const contrast = Math.max(0, Math.min(1, (paper - s.min) / paper));
      const score = 0.4 * intensity + 0.4 * s.darkRatio + 0.2 * contrast;
      if (score > best) best = score;
    }
  }
  return best;
}

/**
 * Validação da imagem retificada (especificação §9): os marcadores devem
 * aparecer escuros nas posições lógicas do template. Se menos da maioria
 * dos marcadores for encontrada, a retificação é considerada inválida.
 */
function validateRectified(rect: Uint8ClampedArray, outW: number, outH: number): boolean {
  let ok = 0;
  for (const m of MARKER_CENTERS) {
    const x = Math.round(m.x);
    const y = Math.round(m.y);
    if (x >= 0 && x < outW && y >= 0 && y < outH) {
      if (pxGray(rect, x, y, outW) < 128) ok++;
    }
  }
  return ok >= Math.ceil(MARKER_CENTERS.length * 0.6);
}

/**
 * Validação para cartão ArUco: verifica que os 4 cantos ArUco (210px markers)
 * contêm pixels escuros nas posições centrais esperadas do template.
 * Cada marcador ArUco tem borda preta (bit 0=preto) — o centro do marcador
 * deve ser escuro se o bit central for 0, ou claro se for 1.
 * Para validação, verificamos se há pixels escuros dentro da área do marcador.
 */
function validateArUcoRectified(rect: Uint8ClampedArray, outW: number, outH: number): boolean {
  const halfMk = Math.floor(ARUCO_MARKER_SIZE / 2);
  const corners: Array<{ x: number; y: number }> = [
    ARUCO_CENTERS.TL, ARUCO_CENTERS.TR, ARUCO_CENTERS.BR, ARUCO_CENTERS.BL,
  ];
  let ok = 0;
  for (const c of corners) {
    const x0 = Math.round(c.x - halfMk);
    const y0 = Math.round(c.y - halfMk);
    const x1 = Math.round(c.x + halfMk);
    const y1 = Math.round(c.y + halfMk);
    if (x0 < 0 || y0 < 0 || x1 >= outW || y1 >= outH) continue;
    // Conta pixels escuros dentro da área do marcador
    let darkCount = 0;
    let total = 0;
    for (let y = y0; y <= y1; y += 4) {
      for (let x = x0; x <= x1; x += 4) {
        total++;
        if (pxGray(rect, x, y, outW) < 128) darkCount++;
      }
    }
    // Um marcador ArUco válido tem ~50% pixels escuros (borda + bits internos)
    if (total > 0 && darkCount / total > 0.15) ok++;
  }
  return ok >= 3; // Pelo menos 3 de 4 cantos com conteúdo ArUco
}

export interface ReadCardResult {
  portuguesRatios: number[][];
  matematicaRatios: number[][];
  markers: { x: number; y: number }[];
  rectified: Uint8ClampedArray;
}

/**
 * Pipeline completo: detecta os marcadores de calibração, retifica para o
 * template 1448×2048 e lê as 176 bolhas. Retorna null se os marcadores
 * externos não forem encontrados ou se a retificação for inválida.
 */
export function readCard(
  data: Uint8ClampedArray, w: number, h: number
): ReadCardResult | null {
  const markers = detectMarkers(data, w, h);
  if (!markers) return null;

  const rect = warpSheet(data, w, h, markers, PAGE_WIDTH, PAGE_HEIGHT);
  const norm = normalizeRect(rect, PAGE_WIDTH, PAGE_HEIGHT);

  // Segurança: se a homografia mapeou para o lugar errado, os marcadores
  // não aparecem nas posições esperadas → não faz a leitura.
  if (!validateRectified(norm, PAGE_WIDTH, PAGE_HEIGHT)) return null;

  const readSubject = (xs: number[]): number[][] =>
    QUESTION_Y.map(y => xs.map(x => sampleBubbleRatio(norm, PAGE_WIDTH, PAGE_HEIGHT, x, y)));

  return {
    portuguesRatios: readSubject(PORTUGUESE_X),
    matematicaRatios: readSubject(MATHEMATICS_X),
    markers,
    rectified: norm,
  };
}

// ─── Leitura ArUco + QR (especificação §3-13, §15-21) ───
// Pipeline robusto: detectar QR → identificar modelo → detectar 4 ArUco →
// validar geometria → homografia → ler bolhas.
// Substitui o método antigo de quadrados pretos como referência principal.

import {
  ARUCO_IDS, ARUCO_HOMOGRAPHY_ORDER,
  ARUCO_POINTS_ARRAY, ARUCO_CENTERS, ARUCO_MARKER_SIZE,
  CARD_WIDTH, CARD_HEIGHT,
} from './card-template';

export { buildCardTemplate, CARD_WIDTH, CARD_HEIGHT } from './card-template';
import { detectArUcoMarkers, validateArUcoGeometry } from './aruco-detector';
import { detectQRCode, validateQRPayload, type QRDecodeResult } from './qr-detector';

export interface ArUcoReadResult {
  portuguesRatios: number[][];
  matematicaRatios: number[][];
  markers: { x: number; y: number }[];
  rectified: Uint8ClampedArray;
  qr: QRDecodeResult | null;
}

/**
 * Pipeline completo ArUco + QR (especificação §3-13):
 * 1. Detectar QR Code → identificar modelo.
 * 2. Detectar 4 marcadores ArUco (IDs 10-13).
 * 3. Validar geometria (convexidade, proporção, orientação).
 * 4. Homografia: ArUco centers (foto) → positions (template).
 * 5. Retificar e ler 176 bolhas.
 *
 * Retorna null se qualquer etapa falhar.
 */
export function readCardArUco(
  data: Uint8ClampedArray, w: number, h: number
): ArUcoReadResult | null {
  // 1. Detectar QR Code (opcional — se não detectado, usa modelo padrão)
  const qr = detectQRCode(data, w, h);
  if (qr) {
    const validation = validateQRPayload(qr);
    if (!validation.ok) {
      // QR detectado mas inválido — não interrompe se o modelo for o padrão
      if (qr.model && qr.model !== 'GABARITO_01') return null;
    }
  }

  // 2. Detectar marcadores ArUco
  const aruco = detectArUcoMarkers(data, w, h);
  if (!aruco) return null;
  if (aruco.missing.length > 0) return null;

  // 3. Validar geometria
  if (!validateArUcoGeometry(aruco.markers, w, h)) return null;

  const byId: Record<number, { x: number; y: number }> = {};
  for (const m of aruco.markers) byId[m.id] = m.center;

  const photoPoints = ARUCO_HOMOGRAPHY_ORDER.map(c => byId[ARUCO_IDS[c]]);
  const templatePoints = ARUCO_POINTS_ARRAY;

  // 5. Retificar para o template 1448×2048
  const rect = warpSheet(data, w, h, photoPoints, CARD_WIDTH, CARD_HEIGHT, templatePoints);
  const norm = normalizeRect(rect, CARD_WIDTH, CARD_HEIGHT);

  // Validar retificação: marcadores ArUco devem aparecer nas posições corretas
  if (!validateArUcoRectified(norm, CARD_WIDTH, CARD_HEIGHT)) return null;

  // 6. Ler bolhas
  const readSubject = (xs: number[]): number[][] =>
    QUESTION_Y.map(y => xs.map(x => sampleBubbleRatio(norm, CARD_WIDTH, CARD_HEIGHT, x, y)));

  return {
    portuguesRatios: readSubject(PORTUGUESE_X),
    matematicaRatios: readSubject(MATHEMATICS_X),
    markers: photoPoints,
    rectified: norm,
    qr,
  };
}

// ─── Imagem de depuração (especificação §25) ───
// Overlay sobre a imagem retificada: marcadores de calibração em azul e as
// 176 bolhas coloridas pelo score lido (verde = marcada, amarelo = fraca,
// cinza = em branco). Ajuda a verificar o que o motor "enxergou".

const DEBUG_FLOOR = _FLOOR_CFG;
const DEBUG_WEAK = _MARGIN_CFG;

function debugSetPx(buf: Uint8ClampedArray, w: number, x: number, y: number, color: [number, number, number]): void {
  if (x < 0 || x >= w || y < 0) return;
  const i = (y * w + x) * 4;
  if (i >= buf.length - 3) return;
  buf[i] = color[0];
  buf[i + 1] = color[1];
  buf[i + 2] = color[2];
  buf[i + 3] = 255;
}

function debugDrawRect(buf: Uint8ClampedArray, w: number, cx: number, cy: number, half: number, color: [number, number, number]): void {
  for (let dy = -half; dy <= half; dy++) {
    debugSetPx(buf, w, cx - half, cy + dy, color);
    debugSetPx(buf, w, cx + half, cy + dy, color);
  }
  for (let dx = -half; dx <= half; dx++) {
    debugSetPx(buf, w, cx + dx, cy - half, color);
    debugSetPx(buf, w, cx + dx, cy + half, color);
  }
}

function debugDrawCircle(buf: Uint8ClampedArray, w: number, cx: number, cy: number, r: number, color: [number, number, number]): void {
  for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
    for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
      if (Math.abs(Math.hypot(dx, dy) - r) <= 1.5) {
        debugSetPx(buf, w, Math.round(cx + dx), Math.round(cy + dy), color);
      }
    }
  }
}

export function buildDebugImage(
  rect: Uint8ClampedArray, outW: number,
  portuguesRatios: number[][], matematicaRatios: number[][],
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rect);

  // Marcadores de calibração (18) — azul.
  for (const m of MARKER_CENTERS) {
    debugDrawRect(out, outW, Math.round(m.x), Math.round(m.y), MARKER_SIZE / 2, [0, 120, 255]);
  }

  // Bolhas — cor pelo score lido.
  const ratioSets = [portuguesRatios, matematicaRatios];
  const xSets = [PORTUGUESE_X, MATHEMATICS_X];
  for (let t = 0; t < 2; t++) {
    for (let q = 0; q < QUESTION_Y.length; q++) {
      const ratios = ratioSets[t][q];
      const y = QUESTION_Y[q];
      for (let c = 0; c < ratios.length; c++) {
        const r = ratios[c];
        const color: [number, number, number] =
          r >= DEBUG_FLOOR ? [0, 200, 0] :
          r >= DEBUG_WEAK ? [230, 190, 0] :
          [160, 160, 160];
        debugDrawCircle(out, outW, Math.round(xSets[t][c]), Math.round(y), BUBBLE_RADIUS, color);
      }
    }
  }
  return out;
}