// Gera os ícones PNG do PWA (public/icons/) a partir de um SVG embutido.
// Uso: node scripts/gen-icons.mjs   (sharp já é devDependency)
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const svg = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#4f46e5"/>
  <g transform="translate(${pad},${pad}) scale(${(512 - 2 * pad) / 512})">
    <circle cx="176" cy="186" r="54" fill="none" stroke="#ffffff" stroke-width="30"/>
    <circle cx="336" cy="186" r="54" fill="#ffffff"/>
    <circle cx="176" cy="336" r="54" fill="none" stroke="#ffffff" stroke-width="30"/>
    <circle cx="336" cy="336" r="54" fill="none" stroke="#ffffff" stroke-width="30" opacity="0.9"/>
    <path d="M310 178 l20 20 l38 -42" fill="none" stroke="#4f46e5" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;

const jobs = [
  { name: 'icon-512.png', pad: 0, size: 512 },
  { name: 'icon-192.png', pad: 0, size: 192 },
  { name: 'maskable-512.png', pad: 64, size: 512 },
  { name: 'apple-touch-icon.png', pad: 0, size: 180 },
];

for (const { name, pad, size } of jobs) {
  const buf = Buffer.from(svg(pad));
  await sharp(buf).resize(size, size).png().toFile(join(outDir, name));
  console.log('ok:', name);
}
