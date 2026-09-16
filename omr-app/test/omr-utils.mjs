// Helpers compartilhados para os testes do motor OMR (novo template 1448×2048)

export const PAGE_WIDTH = 1448;
export const PAGE_HEIGHT = 2048;
export const QUESTION_Y = [
  721.0, 773.5, 826.0, 878.5, 931.0, 983.5, 1036.0, 1088.5, 1141.0, 1194.0, 1246.5,
  1299.0, 1351.5, 1404.0, 1456.5, 1509.0, 1562.0, 1614.5, 1667.0, 1719.5, 1772.0, 1824.5,
];
export const PORTUGUESE_X = [329.5, 419.5, 509.5, 599.0];
export const MATHEMATICS_X = [919.5, 1009.5, 1098.5, 1188.5];
export const BUBBLE_RADIUS = 18.5;
export const MARKER_SIZE = 34;
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

export function makeCanvas(W, H, bg = 255) {
  const buf = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    buf[i * 4] = bg; buf[i * 4 + 1] = bg; buf[i * 4 + 2] = bg; buf[i * 4 + 3] = 255;
  }
  return { buf, W, H };
}

export function setPx(cv, px, py, color) {
  if (px < 0 || px >= cv.W || py < 0 || py >= cv.H) return;
  const i = (py * cv.W + px) * 4;
  cv.buf[i] = color[0]; cv.buf[i + 1] = color[1]; cv.buf[i + 2] = color[2];
}

export function fillRect(cv, x0, y0, x1, y1, color = [0, 0, 0]) {
  const xa = Math.max(0, Math.round(x0));
  const xb = Math.min(cv.W - 1, Math.round(x1));
  const ya = Math.max(0, Math.round(y0));
  const yb = Math.min(cv.H - 1, Math.round(y1));
  for (let py = ya; py <= yb; py++) for (let px = xa; px <= xb; px++) setPx(cv, px, py, color);
}

export function strokeRect(cv, x0, y0, x1, y1, color = [0, 0, 0], t = 1.5) {
  fillRect(cv, x0, y0, x1, y0 + t, color);
  fillRect(cv, x0, y1 - t, x1, y1, color);
  fillRect(cv, x0, y0, x0 + t, y1, color);
  fillRect(cv, x1 - t, y0, x1, y1, color);
}

export function drawCircle(cv, cx, cy, r, S, color = [51, 51, 51], t = 3) {
  const rw = r * S;
  const tw = Math.max(1, t * S);
  for (let dy = -Math.ceil(rw); dy <= Math.ceil(rw); dy++) {
    for (let dx = -Math.ceil(rw); dx <= Math.ceil(rw); dx++) {
      const d = Math.hypot(dx, dy);
      if (Math.abs(d - rw) <= tw / 2) setPx(cv, Math.round(cx + dx), Math.round(cy + dy), color);
    }
  }
}

export function fillCircle(cv, cx, cy, r, S, color) {
  const rw = r * S;
  for (let dy = -Math.ceil(rw); dy <= Math.ceil(rw); dy++) {
    for (let dx = -Math.ceil(rw); dx <= Math.ceil(rw); dx++) {
      if (Math.hypot(dx, dy) <= rw) setPx(cv, Math.round(cx + dx), Math.round(cy + dy), color);
    }
  }
}

// renders o cartão no template (escala S, deslocamento Ox/Oy)
// fills: { portugues: {1:'B',...}, matematica: {...} } — valor pode ser letra ou array
export function renderCard(cv, S, Ox, Oy, fills, fillColor = 0) {
  const tx = (px) => px * S + Ox;
  const ty = (py) => py * S + Oy;

  fillRect(cv, tx(0), ty(0), tx(PAGE_WIDTH), ty(PAGE_HEIGHT), [255, 255, 255]);

  // caixas de identificação
  strokeRect(cv, tx(100), ty(119), tx(1349), ty(206), [51, 51, 51], 2 * S);
  strokeRect(cv, tx(100), ty(204), tx(725), ty(291), [51, 51, 51], 2 * S);

  // marcadores de calibração
  const halfM = MARKER_SIZE / 2 * S;
  for (const m of MARKER_CENTERS) {
    fillRect(cv, tx(m.x) - halfM, ty(m.y) - halfM, tx(m.x) + halfM, ty(m.y) + halfM, [0, 0, 0]);
  }

  // linha divisória
  fillRect(cv, tx(721.5), ty(465), tx(724.5), ty(1844), [51, 51, 51]);

  // bolhas
  for (const [subject, xs] of [['portugues', PORTUGUESE_X], ['matematica', MATHEMATICS_X]]) {
    for (let r = 0; r < QUESTION_Y.length; r++) {
      const q = r + 1;
      const entry = (fills[subject] || {})[String(q)];
      const letters = entry == null ? [] : Array.isArray(entry) ? entry : [entry];
      const marks = new Set(letters.map(l => 'ABCD'.indexOf(l)));
      for (let c = 0; c < 4; c++) {
        const cx = tx(xs[c]);
        const cy = ty(QUESTION_Y[r]);
        drawCircle(cv, cx, cy, BUBBLE_RADIUS, S, [51, 51, 51], 3);
        if (marks.has(c)) fillCircle(cv, cx, cy, 13, S, [fillColor, fillColor, fillColor]);
      }
    }
  }
}

// Classificação alinhada ao motor (spec §14)
export function classifyRow(ratios) {
  const floor = 0.3;
  const uncertain = 0.15;
  const mx = Math.max(...ratios);
  const second = [...ratios].sort((a, b) => b - a)[1] ?? 0;
  const marked = [];
  for (let c = 0; c < 4; c++) {
    if (ratios[c] >= floor) marked.push('ABCD'[c]);
  }
  if (marked.length === 0) return [];
  if (marked.length >= 2) return marked;
  const diff = mx - second;
  if (diff >= uncertain) return marked;
  return [];
}

export function readAnswers(portuguesRatios, matematicaRatios) {
  const read = {};
  const dups = [];
  const subjects = [portuguesRatios, matematicaRatios];
  for (let t = 0; t < 2; t++) {
    const ratios = subjects[t];
    for (let q = 0; q < 22; q++) {
      const marked = classifyRow(ratios[q]);
      const g = q + 1 + t * 22;
      if (marked.length === 1) read[g] = marked[0];
      else if (marked.length > 1) dups.push(g);
    }
  }
  return { read, dups };
}

export function buildExpected(fills) {
  const expected = {};
  for (let t = 0; t < 2; t++) {
    const subject = t === 0 ? 'portugues' : 'matematica';
    for (let q = 1; q <= 22; q++) {
      const entry = (fills[subject] || {})[String(q)];
      if (entry == null) continue;
      const letters = Array.isArray(entry) ? entry : [entry];
      if (letters.length === 1) expected[q + t * 22] = letters[0];
    }
  }
  return expected;
}

// ─── homografia para cenários de rotação/perspectiva ───

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
  return M.map(row => row[n]);
}

function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g);
  const G = b * f - c * e, H = -(a * f - c * d), I = a * e - b * d;
  const det = a * A + b * B + c * C;
  const inv = 1 / (det || 1e-12);
  return [A * inv, D * inv, G * inv, B * inv, E * inv, H * inv, C * inv, F * inv, I * inv];
}

function applyH(m, u, v) {
  const den = m[6] * u + m[7] * v + m[8];
  return {
    x: (m[0] * u + m[1] * v + m[2]) / den,
    y: (m[3] * u + m[4] * v + m[5]) / den,
  };
}

function bilinearRGB(src, sw, sh, fx, fy) {
  const x0 = Math.max(0, Math.min(sw - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(sh - 1, Math.floor(fy)));
  const x1 = Math.max(0, Math.min(sw - 1, x0 + 1));
  const y1 = Math.max(0, Math.min(sh - 1, y0 + 1));
  const dx = fx - x0;
  const dy = fy - y0;
  const g = (x, y) => {
    const i = (y * sw + x) * 4;
    return [src[i], src[i + 1], src[i + 2]];
  };
  const w00 = (1 - dx) * (1 - dy), w10 = dx * (1 - dy), w01 = (1 - dx) * dy, w11 = dx * dy;
  const a = g(x0, y0), b = g(x1, y0), c = g(x0, y1), d = g(x1, y1);
  return [
    w00 * a[0] + w10 * b[0] + w01 * c[0] + w11 * d[0],
    w00 * a[1] + w10 * b[1] + w01 * c[1] + w11 * d[1],
    w00 * a[2] + w10 * b[2] + w01 * c[2] + w11 * d[2],
  ];
}

// aplica homografia src->quad e desenha em um canvas dst com fundo cinza
export function warpInto(srcData, sw, sh, quad, dw, dh, bg = 160) {
  const dst = makeCanvas(dw, dh, bg);
  const H = computeHomography(
    [
      { x: 0, y: 0 },
      { x: sw, y: 0 },
      { x: sw, y: sh },
      { x: 0, y: sh },
    ],
    quad,
  );
  const Hi = invert3(H);
  for (let ry = 0; ry < dh; ry++) {
    for (let rx = 0; rx < dw; rx++) {
      const p = applyH(Hi, rx, ry);
      if (p.x < 0 || p.x >= sw || p.y < 0 || p.y >= sh) continue;
      const rgb = bilinearRGB(srcData, sw, sh, p.x, p.y);
      const i = (ry * dw + rx) * 4;
      dst.buf[i] = rgb[0]; dst.buf[i + 1] = rgb[1]; dst.buf[i + 2] = rgb[2]; dst.buf[i + 3] = 255;
    }
  }
  return dst;
}

export function rotateQuad(corners, deg, cx, cy) {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return corners.map(p => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return {
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos,
    };
  });
}

export function shiftQuad(corners, ox, oy) {
  return corners.map(p => ({ x: p.x + ox, y: p.y + oy }));
}