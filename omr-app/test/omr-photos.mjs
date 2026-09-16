// Validação com múltiplas fotografias variadas (spec §35):
// distante, close-up, pouca luz, gradiente de iluminação, rotação forte,
// perspectiva forte, desfoque forte, ruído de sensor e papel amarelado.
//
// Uso: node test/omr-photos.mjs

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
    `${label}: marcadores=${result.markers.length}, respostas=${Object.keys(read).length}, dups=${dups.join(',') || 'nenhuma'}`
  );
  const ok = mism === 0;
  console.log(`${label}: ${ok ? 'PASS' : 'FAIL'}`);
  return ok;
}

// ─── transformações ───

function scaleGray(cv, factor) {
  for (let i = 0; i < cv.buf.length; i += 4) {
    const g = Math.min(255, Math.round(cv.buf[i] * factor));
    cv.buf[i] = g; cv.buf[i + 1] = g; cv.buf[i + 2] = g;
  }
  return cv;
}

function horizontalGradient(cv, f0, f1) {
  for (let y = 0; y < cv.H; y++) {
    for (let x = 0; x < cv.W; x++) {
      const t = x / cv.W;
      const f = f0 + (f1 - f0) * t;
      const i = (y * cv.W + x) * 4;
      const g = Math.min(255, Math.round(cv.buf[i] * f));
      cv.buf[i] = g; cv.buf[i + 1] = g; cv.buf[i + 2] = g;
    }
  }
  return cv;
}

function blurN(cv, n) {
  const r = (n / 2) | 0;
  const out = new Uint8ClampedArray(cv.buf.length);
  for (let y = r; y < cv.H - r; y++) {
    for (let x = r; x < cv.W - r; x++) {
      let sum = 0, cnt = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          sum += cv.buf[((y + dy) * cv.W + (x + dx)) * 4];
          cnt++;
        }
      }
      const v = sum / cnt;
      const i = (y * cv.W + x) * 4;
      out[i] = v; out[i + 1] = v; out[i + 2] = v; out[i + 3] = 255;
    }
  }
  cv.buf.set(out);
  return cv;
}

function noise(cv, amount) {
  for (let i = 0; i < cv.buf.length; i += 4) {
    const n = Math.round((Math.random() * 2 - 1) * amount);
    const g = Math.max(0, Math.min(255, cv.buf[i] + n));
    cv.buf[i] = g; cv.buf[i + 1] = g; cv.buf[i + 2] = g;
  }
  return cv;
}

function yellowish(cv, paper) {
  for (let i = 0; i < cv.buf.length; i += 4) {
    const v = Math.round((cv.buf[i] / 255) * paper);
    cv.buf[i] = v;
    cv.buf[i + 1] = v;
    cv.buf[i + 2] = Math.min(255, v + 10);
  }
  return cv;
}

let allPass = true;

// L: foto distante — cartão pequeno em moldura grande com margens cinza
{
  const DW = 2200, DH = 2600;
  const S = Math.min((DW * 0.55) / PAGE_WIDTH, (DH * 0.55) / PAGE_HEIGHT);
  const corners = [
    { x: 0, y: 0 },
    { x: PAGE_WIDTH, y: 0 },
    { x: PAGE_WIDTH, y: PAGE_HEIGHT },
    { x: 0, y: PAGE_HEIGHT },
  ];
  const scaledCorners = corners.map(p => ({
    x: (p.x - PAGE_WIDTH / 2) * S + PAGE_WIDTH / 2,
    y: (p.y - PAGE_HEIGHT / 2) * S + PAGE_HEIGHT / 2,
  }));
  const rotated = rotateQuad(scaledCorners, 1.5, PAGE_WIDTH / 2, PAGE_HEIGHT / 2);
  const quad = shiftQuad(rotated, DW / 2 - PAGE_WIDTH / 2, DH / 2 - PAGE_HEIGHT / 2);
  allPass = runScenario('L (foto distante, 55%)', {
    W: DW, H: DH,
    transform: (cv) => warpInto(cv.buf, cv.W, cv.H, quad, DW, DH),
  }) && allPass;
}

// M: close-up — cartão ocupa quase toda a moldura
allPass = runScenario('M (close-up)', {
  W: 1700, H: 2250,
  transform: (cv) => {
    const S = 1.05;
    const Ox = 60, Oy = 80;
    const out = makeCanvas(1700, 2250, 200);
    for (let ry = 0; ry < 2250; ry++) {
      for (let rx = 0; rx < 1700; rx++) {
        const u = (rx - Ox) / S;
        const v = (ry - Oy) / S;
        if (u < 0 || u >= PAGE_WIDTH || v < 0 || v >= PAGE_HEIGHT) continue;
        const i = (Math.round(v) * PAGE_WIDTH + Math.round(u)) * 4;
        const o = (ry * 1700 + rx) * 4;
        out.buf[o] = cv.buf[i]; out.buf[o + 1] = cv.buf[i + 1]; out.buf[o + 2] = cv.buf[i + 2]; out.buf[o + 3] = 255;
      }
    }
    return out;
  },
}) && allPass;

// N: pouca luz (imagem escura globalmente)
allPass = runScenario('N (pouca luz ×0.45)', {
  W: PAGE_WIDTH, H: PAGE_HEIGHT,
  transform: (cv) => scaleGray(cv, 0.45),
}) && allPass;

// O: gradiente de iluminação (esquerda escura → direita clara)
allPass = runScenario('O (gradiente lateral)', {
  W: PAGE_WIDTH, H: PAGE_HEIGHT,
  transform: (cv) => horizontalGradient(cv, 0.45, 1.0),
}) && allPass;

// P: rotação forte (8°) sobre fundo cinza
{
  const DW = 2200, DH = 2600;
  const corners = [
    { x: 0, y: 0 },
    { x: PAGE_WIDTH, y: 0 },
    { x: PAGE_WIDTH, y: PAGE_HEIGHT },
    { x: 0, y: PAGE_HEIGHT },
  ];
  const rotated = rotateQuad(corners, 8, PAGE_WIDTH / 2, PAGE_HEIGHT / 2);
  const quad = shiftQuad(rotated, DW / 2 - PAGE_WIDTH / 2, DH / 2 - PAGE_HEIGHT / 2);
  allPass = runScenario('P (rotação 8°)', {
    W: DW, H: DH,
    transform: (cv) => warpInto(cv.buf, cv.W, cv.H, quad, DW, DH),
  }) && allPass;
}

// Q: perspectiva forte (keystone)
{
  const DW = 2000, DH = 2500;
  const quad = [
    { x: 150, y: 120 },
    { x: 1750, y: 160 },
    { x: 1830, y: 2320 },
    { x: 130, y: 2280 },
  ];
  allPass = runScenario('Q (perspectiva forte)', {
    W: DW, H: DH,
    transform: (cv) => warpInto(cv.buf, cv.W, cv.H, quad, DW, DH),
  }) && allPass;
}

// R: desfoque forte (5×5)
allPass = runScenario('R (desfoque 5×5)', {
  W: PAGE_WIDTH, H: PAGE_HEIGHT,
  transform: (cv) => blurN(cv, 5),
}) && allPass;

// S: ruído de sensor
allPass = runScenario('S (ruído ±30)', {
  W: PAGE_WIDTH, H: PAGE_HEIGHT,
  transform: (cv) => noise(cv, 30),
}) && allPass;

// T: papel amarelado
allPass = runScenario('T (papel amarelado)', {
  W: PAGE_WIDTH, H: PAGE_HEIGHT,
  transform: (cv) => yellowish(cv, 235),
}) && allPass;

// U: cenário realista combinado — rotação 4° + sombra diagonal + leve desfoque
{
  const DW = 2000, DH = 2500;
  const corners = [
    { x: 0, y: 0 },
    { x: PAGE_WIDTH, y: 0 },
    { x: PAGE_WIDTH, y: PAGE_HEIGHT },
    { x: 0, y: PAGE_HEIGHT },
  ];
  const rotated = rotateQuad(corners, 4, PAGE_WIDTH / 2, PAGE_HEIGHT / 2);
  const quad = shiftQuad(rotated, DW / 2 - PAGE_WIDTH / 2, DH / 2 - PAGE_HEIGHT / 2);
  allPass = runScenario('U (rotação 4° + sombra + desfoque)', {
    W: DW, H: DH,
    transform: (cv) => {
      const warped = warpInto(cv.buf, cv.W, cv.H, quad, DW, DH);
      // sombra diagonal: linha da esquerda-clara para direita-escura
      for (let y = 0; y < DH; y++) {
        for (let x = 0; x < DW; x++) {
          const i = (y * DW + x) * 4;
          const f = 1.0 - 0.35 * Math.max(0, (x - y) / DW);
          warped.buf[i] = Math.min(255, Math.round(warped.buf[i] * f));
          warped.buf[i + 1] = warped.buf[i];
          warped.buf[i + 2] = warped.buf[i];
        }
      }
      return blurN(warped, 3);
    },
  }) && allPass;
}

console.log('\n' + (allPass ? 'ALL PASS' : 'SOME FAILURES'));
if (!allPass) process.exitCode = 1;