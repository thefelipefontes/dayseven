#!/usr/bin/env node
// Renders out/frame-*.png side by side into out/contact-sheet.png for review.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PANELS } from './frames.config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const TILE_W = 300;
const TILE_H = Math.round((2796 / 1290) * TILE_W);
const GAP = 18;
const PAD = 28;
const width = PAD * 2 + PANELS.length * TILE_W + (PANELS.length - 1) * GAP;
const height = PAD * 2 + TILE_H;

const tiles = PANELS.map((p) => {
  const b64 = readFileSync(join(OUT, `frame-${p.id}.png`)).toString('base64');
  return `<img src="data:image/png;base64,${b64}">`;
}).join('\n');

const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { width: ${width}px; height: ${height}px; background: #EEF2F6; padding: ${PAD}px; }
.row { display: flex; gap: ${GAP}px; }
img { width: ${TILE_W}px; height: ${TILE_H}px; display: block; border-radius: 6px; }
</style></head><body><div class="row">${tiles}</div></body></html>`;

const htmlPath = join(OUT, 'contact-sheet.html');
writeFileSync(htmlPath, html);
execFileSync(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--force-device-scale-factor=1',
  `--window-size=${width},${height}`,
  '--virtual-time-budget=5000',
  `--screenshot=${join(OUT, 'contact-sheet.png')}`,
  `file://${htmlPath}`,
], { stdio: ['ignore', 'ignore', 'pipe'] });
console.log(`out/contact-sheet.png (${width}x${height})`);
