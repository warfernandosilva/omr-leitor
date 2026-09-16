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
import { writeFileSync } from 'node:fs';
import {
  makeCanvas, renderCard, readAnswers, buildExpected,
  warpInto, rotateQuad, shiftQuad, PAGE_WIDTH, PAGE_HEIGHT,
} from './omr-utils.mjs';

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

const expected = buildExpected(fills);

function runScenario(label, opts) {
  const { W, H, transform } = opts;
  const cv = makeCanvas(PAGE_WIDTH, PAGE_HEIGHT);
  renderCard(cv, 1, 0, 0, fills);

  const warped = transform ? transform(cv) : cv;
  const result = pure.readCard(warped.buf, W, H);
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
    if (!(q in expected)) {
      mism++;
      console.log(`${label}: Q${q} inesperada ${read[q]}`);
    }
  }
  console.log(
    `${label}: marcadores=${result.markers.length}, respostas=${Object.keys(read).length}`
  );
  const ok = mism === 0;
  console.log(`${label}: ${ok ? 'PASS' : 'FAIL'}`);
  return ok;
}

function blur3x3(cv) {
  const out = new Uint8ClampedArray(cv.buf.length);
  for (let y = 1; y < cv.H - 1; y++) {
    for (let x = 1; x < cv.W - 1; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          sum += cv.buf[((y + dy) * cv.W + (x + dx)) * 4];
        }
      }
      const v = sum / 9;
      const i = (y * cv.W + x) * 4;
      out[i] = v; out[i + 1] = v; out[i + 2] = v; out[i + 3] = 255;
    }
  }
  cv.buf.set(out);
  return cv;
}

let allPass = true;

// I: foto com rotação de 3° sobre fundo cinza
{
  const DW = 1800, DH = 2400;
  const corners = [
    { x: 0, y: 0 },
    { x: PAGE_WIDTH, y: 0 },
    { x: PAGE_WIDTH, y: PAGE_HEIGHT },
    { x: 0, y: PAGE_HEIGHT },
  ];
  const rotated = rotateQuad(corners, 3, PAGE_WIDTH / 2, PAGE_HEIGHT / 2);
  const quad = shiftQuad(rotated, DW / 2 - PAGE_WIDTH / 2, DH / 2 - PAGE_HEIGHT / 2);
  allPass = runScenario('I (rotação 3°)', {
    W: DW, H: DH,
    transform: (cv) => warpInto(cv.buf, cv.W, cv.H, quad, DW, DH),
  }) && allPass;
}

// J: foto com perspectiva (trapézio)
{
  const DW = 1800, DH = 2400;
  const quad = [
    { x: 250, y: 320 },
    { x: 1550, y: 280 },
    { x: 1500, y: 2100 },
    { x: 200, y: 2050 },
  ];
  allPass = runScenario('J (perspectiva)', {
    W: DW, H: DH,
    transform: (cv) => warpInto(cv.buf, cv.W, cv.H, quad, DW, DH),
  }) && allPass;
}

// K: leve desfoque (fora de foco)
allPass = runScenario('K (desfoque)', {
  W: PAGE_WIDTH, H: PAGE_HEIGHT,
  transform: blur3x3,
}) && allPass;

console.log('\n' + (allPass ? 'ALL PASS' : 'SOME FAILURES'));
if (!allPass) process.exitCode = 1;

// render de referência do cartão preenchido
{
  const cv = makeCanvas(PAGE_WIDTH, PAGE_HEIGHT);
  renderCard(cv, 1, 0, 0, fills);
  writeFileSync('test/render-real-card.png', Buffer.from(cv.buf));
}