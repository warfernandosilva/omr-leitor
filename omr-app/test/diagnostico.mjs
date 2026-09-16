/**
 * Diagnóstico completo do motor OMR — mostra tudo que o motor "vê".
 *
 * Uso:
 *   node test/diagnostico.mjs <caminho-da-foto>
 *
 * Exibe: marcadores, threshold, componentes, homografia, razões por bolha,
 * classificação, e compara com gabarito (se fornecido).
 */

import { buildSync } from 'esbuild';
import { writeFileSync, readFileSync } from 'node:fs';
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

// ─── Lê a imagem via canvas (npm canvas) ou sharp ───
async function loadImageAsPixels(path) {
  let createCanvas, loadImage;
  try {
    ({ createCanvas, loadImage } = await import('canvas'));
  } catch {
    // fallback: sharp
    try {
      const sharp = (await import('sharp')).default;
      const img = sharp(path);
      const { data, info } = await img
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return { buf: new Uint8ClampedArray(data), w: info.width, h: info.height };
    } catch {
      console.error('Instale "canvas" ou "sharp": npm install canvas  ou  npm install sharp');
      process.exit(1);
    }
  }
  const img = await loadImage(path);
  const cv = createCanvas(img.width, img.height);
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const imgData = ctx.getImageData(0, 0, img.width, img.height);
  return { buf: new Uint8ClampedArray(imgData.data), w: img.width, h: img.height };
}

async function savePng(path, rawRgba, w, h) {
  const sharp = (await import('sharp')).default;
  await sharp(Buffer.from(rawRgba), { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toFile(path);
}

// ─── Classificação (mesmo critério do engine) ───
function classify(ratios) {
  const FLOOR = 0.3;
  const UNCERTAIN = 0.15;
  const mx = Math.max(...ratios);
  const sorted = [...ratios].sort((a, b) => b - a);
  const second = sorted[1] ?? 0;
  const marked = [];
  for (let c = 0; c < 4; c++) {
    if (ratios[c] >= FLOOR) marked.push('ABCD'[c]);
  }
  if (marked.length === 0) return { answer: null, conf: mx, marked: [], uncertain: false };
  if (marked.length >= 2) return { answer: 'DUPLA', conf: mx, marked, uncertain: false };
  const diff = mx - second;
  if (diff < UNCERTAIN) return { answer: null, conf: mx, marked, uncertain: true };
  return { answer: marked[0], conf: mx, marked, uncertain: false };
}

// ─── Main ───
const imgPath = process.argv[2];
if (!imgPath) {
  console.log('Uso: node test/diagnostico.mjs <caminho-da-foto>');
  console.log('Exemplo: node test/diagnostico.mjs test/foto-real.jpg');
  process.exit(1);
}

console.log(`Carregando: ${imgPath}`);
const { buf, w, h } = await loadImageAsPixels(imgPath);
console.log(`Dimensões: ${w}×${h}\n`);

// ─── 1. Detecta marcadores ───
console.log('═══ 1. DETECÇÃO DE MARCADORES ═══');
const markers = pure.detectMarkers(buf, w, h);
if (!markers) {
  console.error('NENHUM MARCADOR DETECTADO —Abortando.');
  process.exit(1);
}
console.log(`Marcadores detectados: ${markers.length}`);
for (let i = 0; i < markers.length; i++) {
  const m = markers[i];
  const label = ['TL', 'TR', 'BR', 'BL'][i] ?? `#${i}`;
  console.log(`  ${label}: (${m.x.toFixed(1)}, ${m.y.toFixed(1)})`);
}

// ─── 2. Lê o cartão completo ───
console.log('\n═══ 2. LEITURA DO CARTÃO ═══');
const result = pure.readCard(buf, w, h);
if (!result) {
  console.error('readCard retornou null');
  process.exit(1);
}

// ─── 3. Razões por bolha (Português) ───
console.log('\n═══ 3. PORTUGUÊS — razões por bolha ═══');
console.log('  Q   A      B      C      D      → classificação');
for (let q = 0; q < 22; q++) {
  const r = result.portuguesRatios[q];
  const c = classify(r);
  const line = `  ${String(q + 1).padStart(2)}  ${r[0].toFixed(3)}  ${r[1].toFixed(3)}  ${r[2].toFixed(3)}  ${r[3].toFixed(3)}  → ${c.answer ?? '(branco)'}${c.uncertain ? ' ⚠ incerto' : ''}`;
  console.log(line);
}

// ─── 4. Razões por bolha (Matemática) ───
console.log('\n═══ 4. MATEMÁTICA — razões por bolha ═══');
console.log('  Q   A      B      C      D      → classificação');
for (let q = 0; q < 22; q++) {
  const r = result.matematicaRatios[q];
  const c = classify(r);
  const line = `  ${String(q + 1).padStart(2)}  ${r[0].toFixed(3)}  ${r[1].toFixed(3)}  ${r[2].toFixed(3)}  ${r[3].toFixed(3)}  → ${c.answer ?? '(branco)'}${c.uncertain ? ' ⚠ incerto' : ''}`;
  console.log(line);
}

// ─── 5. Resumo ───
console.log('\n═══ 5. RESUMO ═══');
const lpAnswers = {}, matAnswers = {};
for (let q = 0; q < 22; q++) {
  const c1 = classify(result.portuguesRatios[q]);
  const c2 = classify(result.matematicaRatios[q]);
  if (c1.answer && c1.answer !== 'DUPLA') lpAnswers[q + 1] = c1.answer;
  if (c2.answer && c2.answer !== 'DUPLA') matAnswers[q + 1] = c2.answer;
}
console.log('Português:', JSON.stringify(lpAnswers));
console.log('Matemática:', JSON.stringify(matAnswers));

// salva a imagem retificada para inspeção visual
if (result.rectified) {
  await savePng(join(__dirname, 'retified.png'), result.rectified, u.PAGE_WIDTH, u.PAGE_HEIGHT);
  console.log('\nImagem retificada salva em test/retified.png (1448×2048)');
  console.log('Abra no navegador para verificar se o cartão ficou reto e legível.');

  // imagem de depuração: marcadores + bolhas coloridas pelo score lido
  const debug = pure.buildDebugImage(
    result.rectified, u.PAGE_WIDTH,
    result.portuguesRatios, result.matematicaRatios,
  );
  await savePng(join(__dirname, 'debug-real.png'), debug, u.PAGE_WIDTH, u.PAGE_HEIGHT);
  console.log('Imagem de depuração salva em test/debug-real.png');
  console.log('  azul = marcadores de calibração, verde = bolha marcada, amarelo = fraca, cinza = em branco');
} else {
  console.log('\nAVISO: retified não disponível');
}

// ─── 6. Pontos de amostragem (ver onde o motor "olha") ───
console.log('\n═══ 6. PIXELS NA IMAGEM RETIFICADA ═══');
const px = (x, y) => {
  const i = (Math.round(y) * u.PAGE_WIDTH + Math.round(x)) * 4;
  if (i < 0 || i >= result.rectified.length - 3) return [0, 0, 0];
  return [result.rectified[i], result.rectified[i+1], result.rectified[i+2]];
};
// centros dos marcadores retificados
console.log('Marcadores (retificados):');
const mLabels = ['TL','TR','BR','BL'];
for (let i = 0; i < Math.min(4, markers.length); i++) {
  // mapeia marcador foto → coordenada template via homografia invertida
  // mas podemos ver onde os marcadores ficaram no template
}
// amostra na imagem retificada: bolhas de amostra
console.log('\nAmostras pontuais (retified):');
const samples = [
  ['branco P1-A (deveria ser branco)', u.PORTUGUESE_X[0], u.QUESTION_Y[0]],
  ['marcada P1-B (deveria ser escuro)', u.PORTUGUESE_X[1], u.QUESTION_Y[0]],
  ['branco P5-A', u.PORTUGUESE_X[0], u.QUESTION_Y[4]],
  ['marcada P5-C', u.PORTUGUESE_X[2], u.QUESTION_Y[4]],
  ['marcada M1-A', u.MATHEMATICS_X[0], u.QUESTION_Y[0]],
  ['marcada M19-D', u.MATHEMATICS_X[3], u.QUESTION_Y[18]],
  ['divisor X=723 Y=1000', 723, 1000],
  ['fundo branco X=724 Y=100', 724, 100],
  ['marcador TL lógico X=117 Y=396', 117, 396],
  ['centro cartão X=724 Y=1024', 724, 1024],
];
for (const [label, x, y] of samples) {
  const [r, g, b] = px(x, y);
  const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  console.log(`  ${label}: rgb(${r},${g},${b}) gray=${gray}`);
}