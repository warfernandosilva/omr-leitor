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
const u = await import('./omr-utils.mjs');

const W = u.PAGE_WIDTH, H = u.PAGE_HEIGHT;
const cv = u.makeCanvas(W, H);
const fills = {
  portugues: {
    1: 'B', 2: 'C', 3: 'A', 4: 'D', 5: 'B', 6: 'C', 7: 'A', 8: 'A', 9: 'C', 10: 'B', 11: 'D',
    12: 'A', 13: 'B', 14: 'C', 15: 'D', 16: 'A', 17: 'C', 18: 'B', 19: 'D', 20: 'C', 21: 'A', 22: 'B',
  },
  matematica: {
    1: 'D', 2: 'A', 3: 'B', 4: 'C', 5: 'A', 6: 'B', 7: 'C', 8: 'D', 9: 'A', 10: 'C', 11: 'B',
    12: 'C', 13: 'D', 14: 'A', 15: 'B', 16: 'C', 17: 'B', 18: 'A', 19: 'C', 20: 'D', 21: 'B', 22: 'A',
  },
};
u.renderCard(cv, 1, 0, 0, fills);

const DW = 2200, DH = 2600;
const corners = [
  { x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H },
];
const rotated = u.rotateQuad(corners, 8, W / 2, H / 2);
const quad = u.shiftQuad(rotated, DW / 2 - W / 2, DH / 2 - H / 2);
const warped = u.warpInto(cv.buf, W, H, quad, DW, DH);

// Reimplementa o pipeline de candidatos para depuração
const data = warped.buf, w = DW, h = DH;
const scale = Math.min(1, 1200 / Math.max(w, h));
const sw = Math.max(2, Math.round(w * scale));
const sh = Math.max(2, Math.round(h * scale));
const gray = new Float64Array(sw * sh);
for (let y = 0; y < sh; y++) {
  const sy = Math.min(h - 1, Math.round(y / scale));
  for (let x = 0; x < sw; x++) {
    const sx = Math.min(w - 1, Math.round(x / scale));
    const i = (sy * w + sx) * 4;
    gray[y * sw + x] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
}
const w2 = sw + 1, h2 = sh + 1;
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
    const x0 = Math.max(0, x - r), x1 = Math.min(sw - 1, x + r);
    const y0 = Math.max(0, y - r), y1 = Math.min(sh - 1, y + r);
    const area = (x1 - x0 + 1) * (y1 - y0 + 1);
    const sum = integ[(y1 + 1) * w2 + (x1 + 1)] - integ[y0 * w2 + (x1 + 1)] - integ[(y1 + 1) * w2 + x0] + integ[y0 * w2 + x0];
    const mean = sum / area;
    if (gray[y * sw + x] < mean - 30) dark[y * sw + x] = 1;
  }
}

const comp = new Int32Array(sw * sh).fill(-1);
const stats = [];
const stack = [];
let nextId = 0;
for (let i = 0; i < sw * sh; i++) {
  if (comp[i] !== -1 || dark[i] === 0) continue;
  comp[i] = nextId; stack.length = 0; stack.push(i);
  let area = 0, minX = sw, minY = sh, maxX = -1, maxY = -1;
  while (stack.length) {
    const p = stack.pop(); area++;
    const px = p % sw, py = (p / sw) | 0;
    if (px < minX) minX = px; if (px > maxX) maxX = px;
    if (py < minY) minY = py; if (py > maxY) maxY = py;
    for (let ny = py - 1; ny <= py + 1; ny++) for (let nx = px - 1; nx <= px + 1; nx++) {
      if (nx >= 0 && nx < sw && ny >= 0 && ny < sh) {
        const ni = ny * sw + nx;
        if (comp[ni] === -1 && dark[ni] === 1) { comp[ni] = nextId; stack.push(ni); }
      }
    }
  }
  stats.push({ area, minX, minY, maxX, maxY }); nextId++;
}

const minDim = Math.min(sw, sh);
const sideLo = 0.008 * minDim, sideHi = 0.05 * minDim;
const sx = sw / w, sy = sh / h;

const cands = [];
for (const s of stats) {
  const bw = s.maxX - s.minX + 1, bh = s.maxY - s.minY + 1;
  const aspect = bw / bh;
  if (aspect < 0.6 || aspect > 1.6) continue;
  if (bw < sideLo || bw > sideHi || bh < sideLo || bh > sideHi) continue;
  const fill = s.area / (bw * bh);
  if (fill < 0.6) continue;
  cands.push({ x: ((s.minX + s.maxX) / 2) / (sw / w), y: ((s.minY + s.maxY) / 2) / (sh / h), bw, bh, fill });
}
console.log(`candidates=${cands.length}`);

const byY = cands.slice().sort((a, b) => a.y - b.y);
console.log('\nTodos os candidatos por Y:');
byY.forEach((c, i) => console.log(`  [${i}] x=${c.x.toFixed(1)} y=${c.y.toFixed(1)} bw=${c.bw} bh=${c.bh} fill=${c.fill.toFixed(2)}`));

console.log('\nTOP-4 (mais acima):');
byY.slice(0, 4).forEach(c => console.log(`  x=${c.x.toFixed(1)} y=${c.y.toFixed(1)}`));
console.log('BOTTOM-4 (mais abaixo):');
byY.slice(-4).forEach(c => console.log(`  x=${c.x.toFixed(1)} y=${c.y.toFixed(1)}`));

console.log('\ndetectMarkers:', pure.detectMarkers(warped.buf, DW, DH));