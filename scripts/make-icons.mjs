// Generates the app icons (son clave in polygon notation).
//   node scripts/make-icons.mjs
// Writes icons/*.svg and rasterises PNGs with a local Chrome/Chromium
// (set CHROME=/path/to/chrome if it is not in a standard location).

import { writeFile, mkdir, rm, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outDir = join(root, 'icons');

const BG = '#16181d';
const ACCENT = '#ee6f30';
const RING = '#3a3e47';
const DOT = '#5b606b';

/** @param {number} scale fraction of the canvas used by the circle (maskable needs ≤ 0.8). */
function iconSVG({ rounded, scale }) {
  const n = 16;
  const onsets = [0, 3, 6, 10, 12];
  const R = 50 * scale;
  const pt = (i) => {
    const a = (2 * Math.PI * i) / n;
    return [50 + R * Math.sin(a), 50 - R * Math.cos(a)];
  };
  const poly = onsets.map((i) => pt(i).map((v) => v.toFixed(2)).join(',')).join(' ');
  const dots = [];
  for (let i = 0; i < n; i++) {
    const [x, y] = pt(i);
    const on = onsets.includes(i);
    dots.push(
      `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${on ? 5.2 * scale : 1.9 * scale}" fill="${on ? ACCENT : DOT}"${
        on ? ` stroke="${BG}" stroke-width="${1.8 * scale}"` : ''
      }/>`,
    );
  }
  const bg = rounded
    ? `<rect width="100" height="100" rx="22" fill="${BG}"/>`
    : `<rect width="100" height="100" fill="${BG}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
  ${bg}
  <circle cx="50" cy="50" r="${R.toFixed(2)}" fill="none" stroke="${RING}" stroke-width="${2 * scale}"/>
  <polygon points="${poly}" fill="${ACCENT}" fill-opacity="0.2" stroke="${ACCENT}" stroke-width="${4.2 * scale}" stroke-linejoin="round"/>
  ${dots.join('\n  ')}
</svg>
`;
}

const variants = {
  'icon.svg': iconSVG({ rounded: true, scale: 0.72 }),
  'icon-maskable.svg': iconSVG({ rounded: false, scale: 0.56 }),
  'icon-full.svg': iconSVG({ rounded: false, scale: 0.7 }),
};

const rasters = [
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'icon-512.png', 512],
  ['icon-maskable.svg', 'icon-maskable-512.png', 512],
  ['icon-full.svg', 'apple-touch-icon.png', 180],
];

function findChrome() {
  const candidates = [
    process.env.CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p));
}

await mkdir(outDir, { recursive: true });
const tmp = await mkdtemp(join(tmpdir(), 'icons-'));
for (const [name, svg] of Object.entries(variants)) {
  // Only icon.svg ships; the others are intermediate.
  await writeFile(name === 'icon.svg' ? join(outDir, name) : join(tmp, name), svg);
}

const chrome = findChrome();
if (!chrome) {
  console.warn('Chrome not found: wrote icons/icon.svg only. Set CHROME=/path/to/chrome to rasterise PNGs.');
} else {
  for (const [src, out, size] of rasters) {
    const srcPath = src === 'icon.svg' ? join(outDir, src) : join(tmp, src);
    const html = join(tmp, `${out}.html`);
    await writeFile(
      html,
      `<!doctype html><style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="${pathToFileURL(srcPath)}">`,
    );
    execFileSync(chrome, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${size},${size}`,
      '--default-background-color=00000000',
      `--screenshot=${join(outDir, out)}`,
      pathToFileURL(html).href,
    ], { stdio: 'ignore' });
    console.log(`icons/${out} (${size}×${size})`);
  }
}
await rm(tmp, { recursive: true, force: true });
