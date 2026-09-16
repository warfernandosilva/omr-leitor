// ─── Teste: novo cartão com ArUco + QR ───

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

// ─── ArUco codes from DICT_ARUCO (via js-aruco2 dictionary) ───
// Importante: bit 0 = preto, bit 1 = branco na grade interna 5×5.

const jsAruco2 = await import('js-aruco2');
const AR = jsAruco2.default?.AR || jsAruco2.AR || jsAruco2['module.exports'].AR;
const dict = new AR.Dictionary('ARUCO');
const ARUCO_CODES = {
  10: dict.codeList[10],
  11: dict.codeList[11],
  12: dict.codeList[12],
  13: dict.codeList[13],
};

function renderArUcoMarker(id, cellPx) {
  const code = ARUCO_CODES[id];
  const bits = code.toString(2).padStart(25, '0');
  const cells = 7;
  const sz = cells * cellPx;
  const buf = new Uint8ClampedArray(sz * sz * 4);

  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      const border = (cx === 0 || cx === 6 || cy === 0 || cy === 6);
      let dark;
      if (border) {
        dark = true;
      } else {
        const innerR = cy - 1, innerC = cx - 1;
        const bitIdx = innerR * 5 + innerC;
        dark = bits[bitIdx] === '0';
      }
      for (let dy = 0; dy < cellPx; dy++) {
        for (let dx = 0; dx < cellPx; dx++) {
          const px = cx * cellPx + dx;
          const py = cy * cellPx + dy;
          const idx = (py * sz + px) * 4;
          const v = dark ? 0 : 255;
          buf[idx] = v; buf[idx+1] = v; buf[idx+2] = v; buf[idx+3] = 255;
        }
      }
    }
  }
  return { buf, sz };
}

// ─── Compor imagem do cartão ───
const DW = 1448, DH = 2048;

function composeCard(fills) {
  const card = new Uint8ClampedArray(DW * DH * 4);
  for (let i = 0; i < card.length; i += 4) {
    card[i] = 255; card[i+1] = 255; card[i+2] = 255; card[i+3] = 255;
  }

  // ArUco markers nos cantos (7×30px cells = 210px markers)
  const cellPx = 30;
  const mSz = 7 * cellPx;
  const halfMk = mSz / 2;
  const margin = 10;
  const positions = [
    { id: 10, x: halfMk + margin - halfMk, y: halfMk + margin - halfMk },
    { id: 11, x: DW - halfMk - margin - halfMk, y: halfMk + margin - halfMk },
    { id: 12, x: DW - halfMk - margin - halfMk, y: DH - halfMk - margin - halfMk },
    { id: 13, x: halfMk + margin - halfMk, y: DH - halfMk - margin - halfMk },
  ];

  for (const pos of positions) {
    const { buf: marker, sz } = renderArUcoMarker(pos.id, cellPx);
    for (let my = 0; my < sz; my++) {
      for (let mx = 0; mx < sz; mx++) {
        const si = (my * sz + mx) * 4;
        const di = ((pos.y + my) * DW + (pos.x + mx)) * 4;
        card[di] = marker[si]; card[di+1] = marker[si+1]; card[di+2] = marker[si+2]; card[di+3] = 255;
      }
    }
  }

  // Bolhas preenchidas
  const TEMPLATE = pure.buildCardTemplate();
  for (const subj of TEMPLATE.subjects) {
    const answers = fills[subj.id];
    if (!answers) continue;
    for (const q of subj.questions) {
      for (const opt of q.options) {
        const isFilled = answers[q.options[0].question] === opt.alternative;
        if (isFilled) {
          for (let dy = -12; dy <= 12; dy++) {
            for (let dx = -12; dx <= 12; dx++) {
              if (Math.hypot(dx, dy) > 12) continue;
              const px = Math.round(opt.centerX + dx);
              const py = Math.round(opt.centerY + dy);
              if (px >= 0 && px < DW && py >= 0 && py < DH) {
                const idx = (py * DW + px) * 4;
                card[idx] = 30; card[idx+1] = 30; card[idx+2] = 30; card[idx+3] = 255;
              }
            }
          }
        }
      }
    }
  }

  return card;
}

// ─── Testes ───
let allPass = true;

// Teste 1: ArUco detection + bubble reading
{
  const fills = {
    portugues: { 1: 'A', 2: 'B', 3: 'C', 4: 'D' },
    matematica: { 1: 'A', 2: 'C' },
  };
  const card = composeCard(fills);
  const result = pure.readCardArUco(card, DW, DH);

  if (!result) {
    console.log('Teste 1 (ArUco read): FAIL — readCardArUco retornou null');
    allPass = false;
  } else {
    console.log('Teste 1 (ArUco read): PASS — ' + result.portuguesRatios.length + '×4 + ' + result.matematicaRatios.length + '×4 bolhas');
    console.log('  Marcadores: ' + result.markers.length + ' pontos');
  }
}

// Teste 2: Isolated ArUco detection (no bubbles, no QR)
{
  const card = new Uint8ClampedArray(DW * DH * 4);
  for (let i = 0; i < card.length; i += 4) {
    card[i] = 255; card[i+1] = 255; card[i+2] = 255; card[i+3] = 255;
  }

  const cellPx = 30;
  const mSz = 7 * cellPx;
  const halfMk = mSz / 2;
  const margin = 10;
  const positions = [
    { id: 10, x: margin, y: margin },
    { id: 11, x: DW - mSz - margin, y: margin },
    { id: 12, x: DW - mSz - margin, y: DH - mSz - margin },
    { id: 13, x: margin, y: DH - mSz - margin },
  ];

  for (const pos of positions) {
    const { buf: marker, sz } = renderArUcoMarker(pos.id, cellPx);
    for (let my = 0; my < sz; my++) {
      for (let mx = 0; mx < sz; mx++) {
        const si = (my * sz + mx) * 4;
        const di = ((pos.y + my) * DW + (pos.x + mx)) * 4;
        card[di] = marker[si]; card[di+1] = marker[si+1]; card[di+2] = marker[si+2]; card[di+3] = 255;
      }
    }
  }

  const result = pure.readCardArUco(card, DW, DH);
  if (result) {
    console.log('Teste 2 (isolated ArUco): PASS — detectou 4 marcadores');
  } else {
    console.log('Teste 2 (isolated ArUco): FAIL — readCardArUco retornou null');
    allPass = false;
  }
}

// Teste 3: Legacy fallback (cartão antigo com quadrados pretos)
{
  const u = await import('./omr-utils.mjs');
  const fills = {
    portugues: { 1: 'A', 5: 'C', 10: 'B' },
    matematica: { 3: 'D', 7: 'A' },
  };
  const cv = u.makeCanvas(pure.PAGE_WIDTH, pure.PAGE_HEIGHT);
  u.renderCard(cv, 1, 0, 0, fills);
  const result = pure.readCard(cv.buf, pure.PAGE_WIDTH, pure.PAGE_HEIGHT);

  if (result) {
    console.log('Teste 3 (legacy fallback): PASS — quadrados pretos detectados');
  } else {
    console.log('Teste 3 (legacy fallback): FAIL');
    allPass = false;
  }
}

// Teste 4: card-template
{
  const tpl = pure.buildCardTemplate();
  const ok = tpl.width === 1448 && tpl.height === 2048;
  console.log('Teste 4 (template): ' + tpl.width + '×' + tpl.height + ' — ' + (ok ? 'PASS' : 'FAIL'));
  if (!ok) allPass = false;
}

console.log(allPass ? '\nALL PASS' : '\nSOME FAILURES');
process.exit(allPass ? 0 : 1);
