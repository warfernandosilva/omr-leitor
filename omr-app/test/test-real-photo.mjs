/**
 * Testa o motor OMR com uma foto real do cartão impresso.
 *
 * Uso:
 *   node test/test-real-photo.mjs <caminho-da-foto.jpg>
 *
 * Ou sem argumento: gera um cartão sintético com as respostas visíveis na
 * foto enviada pelo usuário e aplica distorções realistas (rotação 3°,
 * perspectiva leve, sombra parcial) antes de ler.
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
const u = await import('./omr-utils.mjs');

// ─── Respostas visíveis na foto enviada pelo usuário ───
// Português (esquerda):
const LP_ANSWERS = [
  'B', 'C', 'D', 'A', 'B', 'C', 'D', 'A', 'B', 'C', 'D', 'A',
  'B', 'C', 'D', 'A', 'C', 'B', 'D', 'A', 'B', 'B',
];
// Matemática (direita):
const MAT_ANSWERS = [
  'A', 'C', 'B', 'A', 'C', 'B', 'C', 'D', 'C', 'B', 'A', 'D',
  'C', 'B', 'A', 'D', 'A', 'B', 'D', 'A', 'C', 'C',
];

const fills = { portugues: {}, matematica: {} };
LP_ANSWERS.forEach((a, i) => { fills.portugues[String(i + 1)] = a; });
MAT_ANSWERS.forEach((a, i) => { fills.matematica[String(i + 1)] = a; });

// ─── Renderiza o cartão em 1448×2048 e aplica distorções realistas ───
const W = u.PAGE_WIDTH, H = u.PAGE_HEIGHT;
const cv = u.makeCanvas(W, H);
u.renderCard(cv, 1, 0, 0, fills);

// rotação 3°
const corners = [
  { x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H },
];
const rotated = u.rotateQuad(corners, 3, W / 2, H / 2);

// escala a 1800×2400 (foto realista) com translate
const DW = 1800, DH = 2400;
const quad = u.shiftQuad(rotated, DW / 2 - W / 2, DH / 2 - H / 2);

const warped = u.warpInto(cv.buf, W, H, quad, DW, DH);

// sombra sutil no canto inferior direito (20% mais escuro)
for (let py = 0; py < DH; py++) {
  for (let px = 0; px < DW; px++) {
    const i = (py * DW + px) * 4;
    const fx = px / DW;
    const fy = py / DH;
    const d = Math.hypot(fx - 0.8, fy - 0.8);
    if (d < 0.35) {
      const f = 1 - 0.2 * (1 - d / 0.35);
      warped.buf[i] = Math.max(0, Math.round(warped.buf[i] * f));
      warped.buf[i + 1] = warped.buf[i];
      warped.buf[i + 2] = warped.buf[i];
    }
  }
}

// ─── Salva imagem de referência ───
writeFileSync(join(__dirname, 'real-photo-test.png'), Buffer.from(warped.buf));

// ─── Lê com o motor OMR ───
console.log('Processando foto sintetizada (1800×2400, rotação 3° + sombra)...');
const result = pure.readCard(warped.buf, DW, DH);

if (!result) {
  console.error('FAIL: marcadores não localizados!');
  process.exit(1);
}

console.log(`Marcadores detectados: ${result.markers.length}/18`);

// ─── Classifica e compara ───
let ok = 0, fail = 0;

function classify(ratios) {
  const floor = 0.3;
  const mx = Math.max(...ratios);
  const second = [...ratios].sort((a, b) => b - a)[1] ?? 0;
  const marked = [];
  for (let c = 0; c < 4; c++) if (ratios[c] >= floor) marked.push('ABCD'[c]);
  if (marked.length !== 1) return null;
  if (mx - second < 0.15) return null;
  return marked[0];
}

console.log('\n─── PORTUGUÊS ───');
for (let q = 0; q < 22; q++) {
  const got = classify(result.portuguesRatios[q]);
  const exp = LP_ANSWERS[q];
  const pass = got === exp;
  if (pass) ok++; else fail++;
  console.log(`  Q${String(q + 1).padStart(2)}: esperado=${exp}  lido=${got ?? '?'}  ${pass ? '✓' : '✗'}`);
}

console.log('\n─── MATEMÁTICA ───');
for (let q = 0; q < 22; q++) {
  const got = classify(result.matematicaRatios[q]);
  const exp = MAT_ANSWERS[q];
  const pass = got === exp;
  if (pass) ok++; else fail++;
  console.log(`  Q${String(q + 1).padStart(2)}: esperado=${exp}  lido=${got ?? '?'}  ${pass ? '✓' : '✗'}`);
}

console.log(`\nResultado: ${ok}/${ok + fail} corretas`);
console.log(fail === 0 ? 'ALL PASS ✓' : `FAILURES: ${fail} ✗`);
process.exitCode = fail === 0 ? 0 : 1;