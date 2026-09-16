import { buildSync } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = join(__dirname, '..');

buildSync({
  entryPoints: [join(appRoot, 'src/utils/omr-pure.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: join(__dirname, 'omr-pure.mjs'),
  logLevel: 'warning',
});

const pure = await import('./omr-pure.mjs');

async function loadImageAsPixels(path) {
  const sharp = (await import('sharp')).default;
  const img = sharp(path);
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { buf: new Uint8ClampedArray(data), w: info.width, h: info.height };
}

const { buf, w, h } = await loadImageAsPixels('test/foto-real.jpg');
console.log(`Foto: ${w}×${h}`);

const markers = pure.detectMarkers(buf, w, h);
console.log('Marcadores:', markers.map((m, i) => `[${['TL','TR','BR','BL'][i]}]=(${m.x.toFixed(1)},${m.y.toFixed(1)})`).join(' '));

// Computa a homografia template→foto
function computeHomography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const sx = src[i].x, sy = src[i].y, dx = dst[i].x, dy = dst[i].y;
    A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]); b.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]); b.push(dy);
  }
  const n = 8, M = A.map((row, i) => row.slice().concat([b[i]]));
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col] || 1e-12;
    for (let c = col; c <= n; c++) M[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const hh = M.map(row => row[n]);
  return [hh[0], hh[1], hh[2], hh[3], hh[4], hh[5], hh[6], hh[7], 1];
}
function applyH(m, u, v) {
  const den = m[6] * u + m[7] * v + m[8];
  return { x: (m[0] * u + m[1] * v + m[2]) / den, y: (m[3] * u + m[4] * v + m[5]) / den };
}
function pxGray(data, x, y, w) {
  const i = (Math.round(y) * w + Math.round(x)) * 4;
  if (i < 0 || i >= data.length - 3) return -1;
  return Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
}

const OUTER = pure.OUTER_MARKER_LOGICAL;
const H = computeHomography(OUTER, markers);

// Lê a foto ORIGINAL nos centros das bolhas (região circular de raio 18,50) via homografia
function photoDarkRatio(tx, ty) {
  // centro previsto na foto
  const p = applyH(H, tx, ty);
  // raio da bolha na foto ≈ 37px template * escala média
  const r = 9;
  let dark = 0, total = 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.hypot(dx, dy) > r) continue;
    const g = pxGray(buf, p.x + dx, p.y + dy, w);
    if (g >= 0) { total++; if (g < 120) dark++; }
  }
  return { ratio: dark / total, px: p.x, py: p.y, g: pxGray(buf, p.x, p.y, w) };
}

// Questões que o motor leu como DUPLA ou branco → verificar na foto original
const checks = [
  // [label, subject, question, alternativesX]
  ['LP Q1', pure.PORTUGUESE_X, 0],
  ['LP Q2', pure.PORTUGUESE_X, 1],
  ['LP Q17', pure.PORTUGUESE_X, 16],
  ['LP Q18', pure.PORTUGUESE_X, 17],
  ['LP Q21', pure.PORTUGUESE_X, 20],
  ['MAT Q1', pure.MATHEMATICS_X, 0],
  ['MAT Q2', pure.MATHEMATICS_X, 1],
  ['MAT Q3', pure.MATHEMATICS_X, 2],
  ['MAT Q21', pure.MATHEMATICS_X, 20],
];
console.log('\nLeitura da FOTO ORIGINAL (raios escuros reais nas posições previstas):');
console.log('  (ratio>0.35 = marcada na foto)');
for (const [label, xs, qi] of checks) {
  const y = pure.QUESTION_Y[qi];
  const res = xs.map(x => photoDarkRatio(x, y));
  const letters = res.map((r, i) => `ABCD`[i] + '=' + r.ratio.toFixed(2)).join(' ');
  const marked = res.map((r, i) => r.ratio > 0.35 ? `ABCD`[i] : '').filter(Boolean).join('');
  console.log(`  ${label} (Y=${y}): ${letters}  → marcadas na foto: ${marked || '(nenhuma)'}`);
}