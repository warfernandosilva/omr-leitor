// src/utils/omr-pure.ts
var PAGE_WIDTH = 1448;
var PAGE_HEIGHT = 2048;
var TOTAL_QUESTIONS = 44;
var QUESTIONS_PER_SUBJECT = 22;
var VALID_ANSWERS = ["A", "B", "C", "D"];
var DIVIDER_X = 723;
var QUESTION_Y = [
  721,
  773.5,
  826,
  878.5,
  931,
  983.5,
  1036,
  1088.5,
  1141,
  1194,
  1246.5,
  1299,
  1351.5,
  1404,
  1456.5,
  1509,
  1562,
  1614.5,
  1667,
  1719.5,
  1772,
  1824.5
];
var PORTUGUESE_X = [329.5, 419.5, 509.5, 599];
var MATHEMATICS_X = [919.5, 1009.5, 1098.5, 1188.5];
var BUBBLE_DIAMETER = 37;
var BUBBLE_RADIUS = BUBBLE_DIAMETER / 2;
var MARKER_SIZE = 34;
var ALUNO_BOX = { x0: 100, y0: 119, x1: 1349, y1: 206, label: "Aluno (a):", textX: 110, textY: 138 };
var TURMA_BOX = { x0: 100, y0: 204, x1: 725, y1: 291, label: "Turma:", textX: 110, textY: 229 };
var SUBJECT_TITLES = {
  portugues: { text: "PORTUGU\xCAS", centerX: 429, centerY: 512, fontSize: 40 },
  matematica: { text: "MATEM\xC1TICA", centerX: 1018, centerY: 512, fontSize: 40 }
};
var HEADER_Y = 635;
var QUESTION_NUM_X = { portugues: 260, matematica: 850 };
var MARKER_CENTERS = [
  { x: 117.5, y: 396 },
  { x: 522, y: 396 },
  { x: 926, y: 396 },
  { x: 1330.5, y: 396 },
  { x: 117.5, y: 648.5 },
  { x: 117.5, y: 901 },
  { x: 117.5, y: 1153.5 },
  { x: 117.5, y: 1406 },
  { x: 117.5, y: 1658.5 },
  { x: 1330.5, y: 648.5 },
  { x: 1330.5, y: 901 },
  { x: 1330.5, y: 1153.5 },
  { x: 1330.5, y: 1406 },
  { x: 1330.5, y: 1658.5 },
  { x: 117.5, y: 1911.5 },
  { x: 522, y: 1911.5 },
  { x: 926, y: 1911.5 },
  { x: 1330.5, y: 1911.5 }
];
var OUTER_MARKER_LOGICAL = [
  { x: 117.5, y: 396 },
  { x: 1330.5, y: 396 },
  { x: 1330.5, y: 1911.5 },
  { x: 117.5, y: 1911.5 }
];
function buildCardModel() {
  const makeSubject = (id, xs, titleX, questionNumX) => ({
    id,
    title: SUBJECT_TITLES[id].text,
    centerX: titleX,
    centerY: SUBJECT_TITLES[id].centerY,
    alternatives: xs.map((x, c) => ({ letter: VALID_ANSWERS[c], x })),
    headerY: HEADER_Y,
    questionNumX,
    questions: QUESTION_Y.map((y) => ({
      y,
      options: xs.map((x, c) => ({
        question: QUESTION_Y.indexOf(y) + 1,
        alternative: VALID_ANSWERS[c],
        centerX: x,
        centerY: y,
        radius: BUBBLE_RADIUS
      }))
    }))
  });
  return {
    pageWidth: PAGE_WIDTH,
    pageHeight: PAGE_HEIGHT,
    identification: { aluno: ALUNO_BOX, turma: TURMA_BOX },
    calibrationMarkers: MARKER_CENTERS.map((m) => ({ x: m.x, y: m.y, size: MARKER_SIZE })),
    divider: { x: DIVIDER_X, y0: 465, y1: 1844, width: 3 },
    subjects: [
      makeSubject("portugues", PORTUGUESE_X, SUBJECT_TITLES.portugues.centerX, QUESTION_NUM_X.portugues),
      makeSubject("matematica", MATHEMATICS_X, SUBJECT_TITLES.matematica.centerX, QUESTION_NUM_X.matematica)
    ]
  };
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function pxGray(data, x, y, w) {
  const i = (y * w + x) * 4;
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}
function bilinearSampleRGB(data, w, h, fx, fy) {
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
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    out[c] = w00 * data[i00 + c] + w10 * data[i10 + c] + w01 * data[i01 + c] + w11 * data[i11 + c];
  }
  return out;
}
function downscaleGray(data, w, h, maxDim = 1200) {
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
function otsuThreshold(gray, total) {
  const hist = new Int32Array(256);
  for (let i = 0; i < total; i++) {
    hist[Math.max(0, Math.min(255, Math.round(gray[i])))]++;
  }
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let bestVar = -1;
  let T = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v >= bestVar) {
      bestVar = v;
      T = t;
    }
  }
  return Math.max(40, Math.min(T, 200));
}
function labelDarkComponents(gray, sw, sh, T) {
  const comp = new Int32Array(sw * sh).fill(-1);
  const stats = [];
  const stack = [];
  let nextId = 0;
  for (let i = 0; i < sw * sh; i++) {
    if (comp[i] !== -1 || gray[i] >= T) continue;
    comp[i] = nextId;
    stack.length = 0;
    stack.push(i);
    let area = 0;
    let minX = sw, minY = sh, maxX = -1, maxY = -1;
    while (stack.length) {
      const p = stack.pop();
      area++;
      const px = p % sw;
      const py = p / sw | 0;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      for (let ny = py - 1; ny <= py + 1; ny++) {
        for (let nx = px - 1; nx <= px + 1; nx++) {
          if (nx >= 0 && nx < sw && ny >= 0 && ny < sh) {
            const ni = ny * sw + nx;
            if (comp[ni] === -1 && gray[ni] < T) {
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
function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}
function convexHull(points) {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}
function triangleArea2(a, b, c) {
  return Math.abs(cross(a, b, c));
}
function reduceToQuad(hull) {
  if (hull.length <= 4) return hull.slice();
  const pts = hull.slice();
  while (pts.length > 4) {
    let bestIdx = -1;
    let bestArea = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const next = pts[(i + 1) % pts.length];
      const a = triangleArea2(prev, pts[i], next);
      if (a < bestArea) {
        bestArea = a;
        bestIdx = i;
      }
    }
    pts.splice(bestIdx, 1);
  }
  return pts;
}
function orderQuadCorners(q) {
  let cx = 0, cy = 0;
  for (const p of q) {
    cx += p.x;
    cy += p.y;
  }
  cx /= q.length;
  cy /= q.length;
  const withAng = q.map((p) => ({ x: p.x, y: p.y, ang: Math.atan2(p.y - cy, p.x - cx) }));
  withAng.sort((a, b) => a.ang - b.ang);
  let start = 0;
  let best = Infinity;
  for (let i = 0; i < withAng.length; i++) {
    const s = withAng[i].x + withAng[i].y;
    if (s < best) {
      best = s;
      start = i;
    }
  }
  const ordered = withAng.slice(start).concat(withAng.slice(0, start));
  return [
    { x: ordered[0].x, y: ordered[0].y },
    { x: ordered[1].x, y: ordered[1].y },
    { x: ordered[2].x, y: ordered[2].y },
    { x: ordered[3].x, y: ordered[3].y }
  ];
}
function detectMarkers(data, w, h) {
  const { gray, sw, sh, sx, sy } = downscaleGray(data, w, h, 1200);
  const total = sw * sh;
  const T = otsuThreshold(gray, total);
  const { stats } = labelDarkComponents(gray, sw, sh, T);
  const minDim = Math.min(sw, sh);
  const sideLo = 6e-3 * minDim;
  const sideHi = 0.06 * minDim;
  const candidates = [];
  for (const s of stats) {
    const bw = s.maxX - s.minX + 1;
    const bh = s.maxY - s.minY + 1;
    const aspect2 = bw / bh;
    if (aspect2 < 0.6 || aspect2 > 1.6) continue;
    if (bw < sideLo || bw > sideHi || bh < sideLo || bh > sideHi) continue;
    const fill = s.area / (bw * bh);
    if (fill < 0.55) continue;
    candidates.push({
      x: (s.minX + s.maxX) / 2 / sx,
      y: (s.minY + s.maxY) / 2 / sy
    });
  }
  if (candidates.length < 4) return null;
  const hull = convexHull(candidates);
  if (hull.length < 4) return null;
  const quad = reduceToQuad(hull);
  const ordered = orderQuadCorners(quad);
  const wq = Math.hypot(ordered[1].x - ordered[0].x, ordered[1].y - ordered[0].y);
  const hq = Math.hypot(ordered[2].x - ordered[1].x, ordered[2].y - ordered[1].y);
  const minDimPhoto = Math.min(w, h);
  if (wq < 0.15 * minDimPhoto || hq < 0.15 * minDimPhoto) return null;
  const aspect = wq / hq;
  if (aspect < 0.4 || aspect > 0.95) return null;
  return ordered;
}
function solveLinear(A, b) {
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
  return M.map((row) => row[n]);
}
function computeHomography(src, dst) {
  const A = [];
  const b = [];
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
function applyH(m, u, v) {
  const den = m[6] * u + m[7] * v + m[8];
  return {
    x: (m[0] * u + m[1] * v + m[2]) / den,
    y: (m[3] * u + m[4] * v + m[5]) / den
  };
}
function warpSheet(data, w, h, markers, outW, outH) {
  const H = computeHomography(OUTER_MARKER_LOGICAL, markers);
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
function normalizeRect(rect, w, h) {
  const n = w * h;
  const hist = new Int32Array(256);
  for (let i = 0; i < n; i++) {
    const g = Math.round(0.299 * rect[i * 4] + 0.587 * rect[i * 4 + 1] + 0.114 * rect[i * 4 + 2]);
    hist[Math.max(0, Math.min(255, g))]++;
  }
  let lo = 255;
  let hi = 0;
  let cum = 0;
  const targetLo = n * 5e-3;
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
    const v = Math.max(0, Math.min(255, Math.round((g - lo) / range * 255)));
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return out;
}
var INNER_RADIUS = 11;
var OFFSETS = [-4, 0, 4];
function sampleBubbleRatio(rect, outW, outH, cx, cy) {
  const vals = [];
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
  const paper = vals.length ? vals.sort((a, b) => a - b)[Math.min(vals.length - 1, Math.floor(vals.length * 0.75))] : 255;
  const thr = paper - 40;
  let best = 0;
  for (const ox of OFFSETS) {
    for (const oy of OFFSETS) {
      const ccx = cx + ox;
      const ccy = cy + oy;
      let dark = 0;
      let total = 0;
      for (let dy = -INNER_RADIUS; dy <= INNER_RADIUS; dy++) {
        for (let dx = -INNER_RADIUS; dx <= INNER_RADIUS; dx++) {
          const d = Math.hypot(dx, dy);
          if (d <= INNER_RADIUS) {
            const px = Math.round(ccx + dx);
            const py = Math.round(ccy + dy);
            if (px >= 0 && px < outW && py >= 0 && py < outH) {
              total++;
              if (pxGray(rect, px, py, outW) < thr) dark++;
            }
          }
        }
      }
      if (total > 0) best = Math.max(best, dark / total);
    }
  }
  return best;
}
function readCard(data, w, h) {
  const markers = detectMarkers(data, w, h);
  if (!markers) return null;
  const rect = warpSheet(data, w, h, markers, PAGE_WIDTH, PAGE_HEIGHT);
  const norm = normalizeRect(rect, PAGE_WIDTH, PAGE_HEIGHT);
  const readSubject = (xs) => QUESTION_Y.map((y) => xs.map((x) => sampleBubbleRatio(norm, PAGE_WIDTH, PAGE_HEIGHT, x, y)));
  return {
    portuguesRatios: readSubject(PORTUGUESE_X),
    matematicaRatios: readSubject(MATHEMATICS_X),
    markers,
    rectified: norm
  };
}
export {
  ALUNO_BOX,
  BUBBLE_DIAMETER,
  BUBBLE_RADIUS,
  DIVIDER_X,
  HEADER_Y,
  MARKER_CENTERS,
  MARKER_SIZE,
  MATHEMATICS_X,
  OUTER_MARKER_LOGICAL,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  PORTUGUESE_X,
  QUESTIONS_PER_SUBJECT,
  QUESTION_NUM_X,
  QUESTION_Y,
  SUBJECT_TITLES,
  TOTAL_QUESTIONS,
  TURMA_BOX,
  VALID_ANSWERS,
  buildCardModel,
  detectMarkers,
  normalizeRect,
  readCard,
  warpSheet
};
