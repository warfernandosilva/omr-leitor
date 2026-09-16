/**
 * Diagnóstico dos componentes escuros detectados — mostra TODOS os candidatos
 * e a posição real dos marcadores na foto.
 *
 * Uso:
 *   node test/diagnostico3.mjs <caminho-da-foto>
 */

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

function pxGray(data, x, y, w) {
  const i = (Math.round(y) * w + Math.round(x)) * 4;
  if (i < 0 || i >= data.length - 3) return -1;
  return Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
}

// ─── Reimplementa a detecção para expor os candidatos ───
function detectComponents(data, w, h) {
  // downscale
  const maxDim = 1200;
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

  // adaptive dark mask
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

  // label components
  const comp = new Int32Array(sw * sh).fill(-1);
  const stats = [];
  const stack = [];
  let nextId = 0;
  for (let i = 0; i < sw * sh; i++) {
    if (comp[i] !== -1 || dark[i] === 0) continue;
    comp[i] = nextId;
    stack.length = 0;
    stack.push(i);
    let area = 0;
    let minX = sw, minY = sh, maxX = -1, maxY = -1;
    while (stack.length) {
      const p = stack.pop();
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

  const minDim = Math.min(sw, sh);
  const sideLo = 0.006 * minDim;
  const sideHi = 0.06 * minDim;

  console.log(`\n═══ TODOS OS COMPONENTES ESCUROS (${stats.length}) ═══`);
  console.log(`Escala: ${scale.toFixed(3)} (sw=${sw}, sh=${sh})`);
  console.log(`sideLo=${sideLo.toFixed(1)}, sideHi=${sideHi.toFixed(1)}`);
  console.log('  #  area   x1   y1   x2   y2   bw   bh  aspect  fill  | foto cx,cy | é candidato?');

  const candidates = [];
  const rows = [];
  for (let i = 0; i < stats.length; i++) {
    const s = stats[i];
    const bw = s.maxX - s.minX + 1;
    const bh = s.maxY - s.minY + 1;
    const aspect = bw / bh;
    const fill = s.area / (bw * bh);
    const isCand = aspect >= 0.6 && aspect <= 1.6 && bw >= sideLo && bw <= sideHi && bh >= sideLo && bh <= sideHi && fill >= 0.55;
    const cx = ((s.minX + s.maxX) / 2) / scale;
    const cy = ((s.minY + s.maxY) / 2) / scale;
    if (isCand) candidates.push({ x: cx, y: cy });
    // Mostra até 40 componentes
    if (rows.length < 40 || isCand) {
      rows.push(`  ${String(i).padStart(2)}  ${String(s.area).padStart(5)}  ${String(s.minX).padStart(4)}  ${String(s.minY).padStart(4)}  ${String(s.maxX).padStart(4)}  ${String(s.maxY).padStart(4)}  ${String(bw).padStart(3)}  ${String(bh).padStart(3)}  ${aspect.toFixed(2)}  ${fill.toFixed(2)}  | ${cx.toFixed(1)}, ${cy.toFixed(1)} | ${isCand ? 'SIM' : 'não'}`);
    }
  }
  console.log(rows.join('\n'));
  console.log(`\nTotal de candidatos (filtro de marcador): ${candidates.length}`);

  // Marca os candidatos em um "mapa" de texto (30×40) para visualizar a disposição
  console.log('\n═══ MAPA DOS CANDIDATOS (30×40 células) ═══');
  const COLS = 30, ROWS = 40;
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill('.'));
  for (const c of candidates) {
    const gx = Math.min(COLS - 1, Math.floor((c.x / w) * COLS));
    const gy = Math.min(ROWS - 1, Math.floor((c.y / h) * ROWS));
    grid[gy][gx] = '#';
  }
  // marca os 4 detectados
  const mk = pure.detectMarkers(data, w, h) ?? [];
  const mkLabels = ['T', 'R', 'B', 'L'];
  mk.forEach((m, i) => {
    const gx = Math.min(COLS - 1, Math.floor((m.x / w) * COLS));
    const gy = Math.min(ROWS - 1, Math.floor((m.y / h) * ROWS));
    grid[gy][gx] = mkLabels[i];
  });
  console.log(grid.map(r => r.join('')).join('\n'));

  // ─── Verificação: onde os marcadores LÓGICOS deveriam estar na foto? ───
  // Usando a homografia dos 4 detectados, projeta os 18 marcadores e confere se
  // há um componente escuro perto.
  console.log('\n═══ VERIFICAÇÃO DOS 18 MARCADORES LÓGICOS ═══');
  const OUTER = pure.OUTER_MARKER_LOGICAL;
  const ordered = mk;

  function computeHomography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const sx = src[i].x, sy = src[i].y;
      const dx = dst[i].x, dy = dst[i].y;
      A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]); b.push(dx);
      A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]); b.push(dy);
    }
    const n = 8;
    const M = A.map((row, i) => row.slice().concat([b[i]]));
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
    const h = M.map(row => row[n]);
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }

  function applyH(m, u, v) {
    const den = m[6] * u + m[7] * v + m[8];
    return { x: (m[0] * u + m[1] * v + m[2]) / den, y: (m[3] * u + m[4] * v + m[5]) / den };
  }

  const H = computeHomography(OUTER, ordered);
  console.log('Marcador lógico → foto (via homografia) | gray na foto | componente escuro perto?');
  for (const m of pure.MARKER_CENTERS) {
    const p = applyH(H, m.x, m.y);
    const g = pxGray(data, p.x, p.y, w);
    // procura candidato mais próximo
    let best = Infinity, bestC = null;
    for (const c of candidates) {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < best) { best = d; bestC = c; }
    }
    const status = best < 8 ? `OK (cand ${bestC.x.toFixed(1)},${bestC.y.toFixed(1)} d=${best.toFixed(1)})` : `FALTA candidato (mais próximo ${bestC ? bestC.x.toFixed(1) + ',' + bestC.y.toFixed(1) : '?'} d=${best.toFixed(1)})`;
    console.log(`  (${String(m.x).padStart(6)},${String(m.y).padStart(6)}) → (${p.x.toFixed(1)},${p.y.toFixed(1)})  gray=${g}  ${status}`);
  }
}

const imgPath = process.argv[2];
if (!imgPath) {
  console.log('Uso: node test/diagnostico3.mjs <caminho-da-foto>');
  process.exit(1);
}

console.log(`Carregando: ${imgPath}`);
const { buf, w, h } = await loadImageAsPixels(imgPath);
console.log(`Dimensões: ${w}×${h}\n`);
detectComponents(buf, w, h);