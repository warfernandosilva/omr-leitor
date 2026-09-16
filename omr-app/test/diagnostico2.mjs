/**
 * Diagnóstico aprofundado — investiga por que a imagem retificada fica cinza.
 *
 * Uso:
 *   node test/diagnostico2.mjs <caminho-da-foto>
 */

import { buildSync } from 'esbuild';
import { writeFileSync } from 'node:fs';
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

async function savePng(path, rawRgba, w, h) {
  const sharp = (await import('sharp')).default;
  await sharp(Buffer.from(rawRgba), { raw: { width: w, height: h, channels: 4 } }).png().toFile(path);
}

function pxGray(data, x, y, w) {
  const i = (Math.round(y) * w + Math.round(x)) * 4;
  if (i < 0 || i >= data.length - 3) return -1;
  return Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
}

// ─── Main ───
const imgPath = process.argv[2];
if (!imgPath) {
  console.log('Uso: node test/diagnostico2.mjs <caminho-da-foto>');
  process.exit(1);
}

console.log(`Carregando: ${imgPath}`);
const { buf, w, h } = await loadImageAsPixels(imgPath);
console.log(`Dimensões: ${w}×${h}\n`);

// ─── 1. Detecta marcadores ───
console.log('═══ 1. DETECÇÃO DE MARCADORES ═══');
const markers = pure.detectMarkers(buf, w, h);
if (!markers) {
  console.error('NENHUM MARCADOR DETECTADO');
  process.exit(1);
}
console.log(`Marcadores detectados (TL,TR,BR,BL):`);
for (let i = 0; i < markers.length; i++) {
  const m = markers[i];
  const label = ['TL', 'TR', 'BR', 'BL'][i];
  console.log(`  ${label}: (${m.x.toFixed(1)}, ${m.y.toFixed(1)})`);
}

// ─── 2. Homografia — onde cada canto do template mapeia na foto ───
console.log('\n═══ 2. MAPEAMENTO HOMOGRAFIA ═══');
console.log('Template corners → photo coords:');
const corners = [
  ['TL template (0,0)', 0, 0],
  ['TR template (1448,0)', 1448, 0],
  ['BR template (1448,2048)', 1448, 2048],
  ['BL template (0,2048)', 0, 2048],
  ['Center template (724,1024)', 724, 1024],
  ['PT Q1-A bubble (329.5,721)', 329.5, 721],
  ['PT Q5-C bubble (509.5,931)', 509.5, 931],
  ['MAT Q1-A bubble (919.5,721)', 919.5, 721],
  ['MAT Q19-D bubble (1188.5,1667)', 1188.5, 1667],
];
for (const [label, tx, ty] of corners) {
  // We need to compute the homography ourselves to inspect it
  // The homography in pure maps template → photo
  console.log(`  ${label} → (computing...)`);
}

// ─── 3. Warp com inspeção ───
console.log('\n═══ 3. WARP — amostras da imagem retificada ═══');
const rect = pure.readCard(buf, w, h);
if (!rect) {
  console.error('readCard retornou null');
  process.exit(1);
}

const pw = pure.PAGE_WIDTH;
const ph = pure.PAGE_HEIGHT;
const px = (x, y) => {
  const i = (Math.round(y) * pw + Math.round(x)) * 4;
  if (i < 0 || i >= rect.rectified.length - 3) return [-1, -1, -1];
  return [rect.rectified[i], rect.rectified[i + 1], rect.rectified[i + 2]];
};

console.log('Pontos na imagem retificada (APÓS normalizeRect):');
const samples = [
  ['PT Q1-A (branco)', 329.5, 721],
  ['PT Q1-B (deveria ser branco)', 419.5, 721],
  ['PT Q5-C (marcada)', 509.5, 931],
  ['PT Q5-A (branco)', 329.5, 931],
  ['MAT Q1-A (marcada)', 919.5, 721],
  ['MAT Q19-D (marcada)', 1188.5, 1667],
  ['Divisor (723, 1000)', 723, 1000],
  ['Fundo branco (724, 100)', 724, 100],
  ['Marcador TL (117.5, 396)', 117.5, 396],
  ['Centro (724, 1024)', 724, 1024],
  ['Borda superior (724, 396)', 724, 396],
  ['Borda inferior (724, 1911.5)', 724, 1911.5],
];
for (const [label, x, y] of samples) {
  const [r, g, b] = px(x, y);
  const gray = r >= 0 ? Math.round(0.299 * r + 0.587 * g + 0.114 * b) : -1;
  console.log(`  ${label}: rgb(${r},${g},${b}) gray=${gray}`);
}

// ─── 4. Amostras da FOTO ORIGINAL nos pontos mapeados ───
// Precisamos da homografia para isso — vamos usar a função warp internamente
// Mas podemos calcular manualmente
console.log('\n═══ 4. HOMOGRAFIA — cálculo manual ═══');

// Reconstruir a homografia (mesmo código de omr-pure)
function computeHomography(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const sx = src[i].x, sy = src[i].y;
    const dx = dst[i].x, dy = dst[i].y;
    A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]);
    b.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]);
    b.push(dy);
  }
  // Solve 8x8
  const n = 8;
  const M = A.map((row, i) => row.slice().concat([b[i]]));
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
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
  const h = M.map(row => row[n]);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function applyH(m, u, v) {
  const den = m[6] * u + m[7] * v + m[8];
  return { x: (m[0] * u + m[1] * v + m[2]) / den, y: (m[3] * u + m[4] * v + m[5]) / den };
}

const OUTER = [
  { x: 117.5, y: 396.0 },
  { x: 1330.5, y: 396.0 },
  { x: 1330.5, y: 1911.5 },
  { x: 117.5, y: 1911.5 },
];

const H = computeHomography(OUTER, markers);
console.log('Homografia H (template → foto):');
console.log(`  [${H.map(v => v.toFixed(6)).join(', ')}]`);
console.log(`  h33 = ${H[8]}`);

// Verificar correspondências
console.log('\nVerificação das correspondências (H × src ≈ dst):');
for (let i = 0; i < 4; i++) {
  const p = applyH(H, OUTER[i].x, OUTER[i].y);
  const m = markers[i];
  const err = Math.hypot(p.x - m.x, p.y - m.y);
  const label = ['TL', 'TR', 'BR', 'BL'][i];
  console.log(`  ${label}: H×(${OUTER[i].x},${OUTER[i].y}) = (${p.x.toFixed(1)},${p.y.toFixed(1)})  foto=(${m.x.toFixed(1)},${m.y.toFixed(1)})  erro=${err.toFixed(2)}px`);
}

// Mapear pontos do template para a foto
console.log('\nOnde pontos do template mapeiam na foto:');
for (const [label, tx, ty] of corners) {
  const p = applyH(H, tx, ty);
  const g = pxGray(buf, Math.round(p.x), Math.round(p.y), w);
  console.log(`  ${label} → foto(${p.x.toFixed(1)}, ${p.y.toFixed(1)})  gray=${g}`);
}

// ─── 5. Estatísticas da imagem retificada ───
console.log('\n═══ 5. ESTATÍSTICAS DA IMAGEM RETIFICADA ═══');
let minG = 255, maxG = 0, sumG = 0;
let count = 0;
const hist = new Int32Array(256);
for (let y = 0; y < ph; y++) {
  for (let x = 0; x < pw; x++) {
    const g = pxGray(rect.rectified, x, y, pw);
    if (g < 0) continue;
    hist[g]++;
    if (g < minG) minG = g;
    if (g > maxG) maxG = g;
    sumG += g;
    count++;
  }
}
const meanG = sumG / count;
console.log(`Min gray: ${minG}, Max: ${maxG}, Mean: ${meanG.toFixed(1)}`);
console.log('Histograma (bins de 16):');
for (let i = 0; i < 16; i++) {
  let sum = 0;
  for (let j = i * 16; j < (i + 1) * 16; j++) sum += hist[j];
  const bar = '#'.repeat(Math.round(sum / count * 200));
  console.log(`  ${String(i * 16).padStart(3)}-${String((i + 1) * 16 - 1).padStart(3)}: ${String(sum).padStart(6)} ${bar}`);
}

// Salvar imagem retificada
await savePng(join(__dirname, 'retified2.png'), rect.rectified, pw, ph);
console.log('\nImagem retificada salva em test/retified2.png');
