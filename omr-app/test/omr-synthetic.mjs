import { buildSync } from 'esbuild';

buildSync({
  entryPoints: ['src/utils/omr-pure.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: 'test/omr-pure.mjs',
  logLevel: 'warning',
});

const pure = await import('./omr-pure.mjs');
import {
  makeCanvas, renderCard, readAnswers, buildExpected, PAGE_WIDTH, PAGE_HEIGHT,
} from './omr-utils.mjs';

const fills = {
  portugues: {
    1: 'B', 2: 'C', 3: 'A', 4: 'D', 5: 'B', 6: 'C', 7: ['B', 'C'], 8: 'A', 9: 'C', 10: 'B', 11: 'D',
    12: 'A', 13: 'B', 14: 'C', 15: 'D', 16: 'A', 17: 'C', 18: 'B', 19: 'D', 20: 'C', 21: 'A', 22: 'B',
  },
  matematica: {
    1: 'D', 2: 'A', 3: 'B', 4: 'C', 5: 'A', 6: 'B', 7: 'C', 8: 'D', 9: 'A', 10: 'C', 11: 'B',
    12: 'C', 13: 'D', 14: 'A', 15: 'B', 16: 'C', 17: 'B', 18: 'A', 19: 'C', 20: 'D', 21: 'B', 22: 'A',
  },
};

const expected = buildExpected(fills);
const expectedDups = [7];

function runScenario(label, opts) {
  const { W, H, S = 1, Ox = 0, Oy = 0, bgColor = 255, transform, fillColor = 0 } = opts;
  const cv = makeCanvas(W, H, bgColor);
  renderCard(cv, S, Ox, Oy, fills, fillColor);

  if (transform) transform(cv);

  const result = pure.readCard(cv.buf, W, H);
  if (!result) {
    console.log(`${label}: FAIL (marcadores não localizados)`);
    return false;
  }

  const { read, dups } = readAnswers(result.portuguesRatios, result.matematicaRatios);
  let mism = 0;

  for (const [q, a] of Object.entries(expected)) {
    if (read[+q] !== a) {
      mism++;
      console.log(`${label}: Q${q} esperado ${a}, obteve ${read[+q] || 'branco'}`);
    }
  }
  for (const q of Object.keys(read)) {
    if (!(q in expected) && !expectedDups.includes(+q)) {
      mism++;
      console.log(`${label}: Q${q} inesperada ${read[q]}`);
    }
  }
  for (const q of expectedDups) {
    if (!dups.includes(q)) {
      mism++;
      console.log(`${label}: Q${q} deveria ser duplicada, mas não foi`);
    }
  }

  console.log(
    `${label}: marcadores=${result.markers.length}, respostas=${Object.keys(read).length}, dups=${dups.join(',') || 'nenhuma'}`
  );
  const ok = mism === 0;
  console.log(`${label}: ${ok ? 'PASS' : 'FAIL'}`);
  return ok;
}

let allPass = true;

// A: scan perfeito no tamanho do template
allPass = runScenario('A', { W: PAGE_WIDTH, H: PAGE_HEIGHT }) && allPass;

// B: foto paisagem com margens e fundo cinza
{
  const BW = 2000, BH = 1500;
  const S = Math.min((BW * 0.85) / PAGE_WIDTH, (BH * 0.85) / PAGE_HEIGHT);
  const Ox = (BW - PAGE_WIDTH * S) / 2;
  const Oy = (BH - PAGE_HEIGHT * S) / 2;
  allPass = runScenario('B', { W: BW, H: BH, S, Ox, Oy, bgColor: 165 }) && allPass;
}

// C: iluminação ruim
allPass = runScenario('C', {
  W: PAGE_WIDTH, H: PAGE_HEIGHT,
  transform: (cv) => {
    for (let i = 0; i < cv.buf.length; i += 4) {
      const g = cv.buf[i] * 0.45 + 120;
      cv.buf[i] = g; cv.buf[i + 1] = g; cv.buf[i + 2] = g;
    }
  },
}) && allPass;

// D: marcação fraca (grafite 200)
allPass = runScenario('D', { W: PAGE_WIDTH, H: PAGE_HEIGHT, fillColor: 200 }) && allPass;

// E: marcação muito fraca (grafite 180)
allPass = runScenario('E', { W: PAGE_WIDTH, H: PAGE_HEIGHT, fillColor: 180 }) && allPass;

// F: sombra no lado direito
allPass = runScenario('F', {
  W: PAGE_WIDTH, H: PAGE_HEIGHT,
  transform: (cv) => {
    const shadowed = new Uint8ClampedArray(cv.buf.length);
    for (let y = 0; y < cv.H; y++) {
      for (let x = 0; x < cv.W; x++) {
        const i = (y * cv.W + x) * 4;
        const factor = x > cv.W * 0.5 ? 0.7 : 1.0;
        shadowed[i] = Math.min(255, Math.round(cv.buf[i] * factor));
        shadowed[i + 1] = Math.min(255, Math.round(cv.buf[i + 1] * factor));
        shadowed[i + 2] = Math.min(255, Math.round(cv.buf[i + 2] * factor));
        shadowed[i + 3] = 255;
      }
    }
    cv.buf.set(shadowed);
  },
}) && allPass;

// G: cartão em branco (sem falsos positivos)
{
  const cv = makeCanvas(PAGE_WIDTH, PAGE_HEIGHT);
  renderCard(cv, 1, 0, 0, { portugues: {}, matematica: {} });
  const result = pure.readCard(cv.buf, PAGE_WIDTH, PAGE_HEIGHT);
  if (!result) {
    console.log('G (em branco): FAIL (marcadores não localizados)');
    allPass = false;
  } else {
    const { read, dups } = readAnswers(result.portuguesRatios, result.matematicaRatios);
    let maxRatio = 0;
    for (const r of [...result.portuguesRatios, ...result.matematicaRatios]) for (const v of r) maxRatio = Math.max(maxRatio, v);
    const ok = Object.keys(read).length === 0 && dups.length === 0;
    console.log(`G (em branco): max_ratio=${maxRatio.toFixed(4)}, falsos_positivos=${Object.keys(read).length}, dups=${dups.length}`);
    console.log('G:', ok ? 'PASS' : 'FAIL');
    allPass = ok && allPass;
  }
}

// H: cartão em branco + ruído + sombra (sem falsos positivos)
{
  const W = PAGE_WIDTH, H = PAGE_HEIGHT;
  const cv = makeCanvas(W, H);
  renderCard(cv, 1, 0, 0, { portugues: {}, matematica: {} });

  for (let i = 0; i < cv.buf.length; i += 4) {
    const n = (Math.random() * 40 - 20) | 0;
    cv.buf[i] = Math.max(0, Math.min(255, cv.buf[i] + n));
    cv.buf[i + 1] = cv.buf[i];
    cv.buf[i + 2] = cv.buf[i];
  }
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const d = Math.hypot(px, py) / Math.hypot(W, H);
      if (d < 0.5) {
        const i = (py * W + px) * 4;
        const factor = 0.75 + 0.25 * d * 2;
        cv.buf[i] = Math.max(0, Math.round(cv.buf[i] * factor));
        cv.buf[i + 1] = cv.buf[i];
        cv.buf[i + 2] = cv.buf[i];
      }
    }
  }

  const result = pure.readCard(cv.buf, W, H);
  if (!result) {
    console.log('H (ruído+sombra): FAIL (marcadores não localizados)');
    allPass = false;
  } else {
    const { read, dups } = readAnswers(result.portuguesRatios, result.matematicaRatios);
    const ok = Object.keys(read).length === 0 && dups.length === 0;
    console.log(`H (ruído+sombra): falsos_positivos=${Object.keys(read).length}, dups=${dups.length}`);
    console.log('H:', ok ? 'PASS' : 'FAIL');
    allPass = ok && allPass;
  }
}

console.log('\n' + (allPass ? 'ALL PASS' : 'SOME FAILURES'));
if (!allPass) process.exitCode = 1;