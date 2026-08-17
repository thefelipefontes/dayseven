#!/usr/bin/env node
// Exports the app's category marks as standalone SVG + transparent PNG, for use
// in marketing art (screenshots.pro slides, social, press kit).
//
//   node export-icons.mjs   ->  icons/{strength,cardio,recovery}[-white].{svg,png}
//
// Path data is copied from the installed icon packs so the exports are the exact
// marks the app renders (see src/components/CategoryIcon.jsx):
//   strength  BicepsFlexed   lucide-react 0.577.0        (ISC)
//   cardio    IconHeartbeat  @tabler/icons-react 3.38.0  (MIT)
//   recovery  IconSnowflake  @tabler/icons-react 3.38.0  (MIT)
// Both packs use a 24x24 viewBox, fill:none, stroke-width 2, round caps/joins.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'icons');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PNG_SIZE = 1024;

export const MARKS = {
  strength: {
    color: '#00FF94',
    paths: [
      'M12.409 13.017A5 5 0 0 1 22 15c0 3.866-4 7-9 7-4.077 0-8.153-.82-10.371-2.462-.426-.316-.631-.832-.62-1.362C2.118 12.723 2.627 2 10 2a3 3 0 0 1 3 3 2 2 0 0 1-2 2c-1.105 0-1.64-.444-2-1',
      'M15 14a5 5 0 0 0-7.584 2',
      'M9.964 6.825C8.019 7.977 9.5 13 8 15',
    ],
  },
  cardio: {
    color: '#FF9500',
    paths: [
      'M19.5 13.572l-7.5 7.428l-2.896 -2.868m-6.117 -8.104a5 5 0 0 1 9.013 -3.022a5 5 0 1 1 7.5 6.572',
      'M3 13h2l2 3l2 -6l1 3h3',
    ],
  },
  recovery: {
    color: '#00D1FF',
    paths: [
      'M10 4l2 1l2 -1',
      'M12 2v6.5l3 1.72',
      'M17.928 6.268l.134 2.232l1.866 1.232',
      'M20.66 7l-5.629 3.25l.01 3.458',
      'M19.928 14.268l-1.866 1.232l-.134 2.232',
      'M20.66 17l-5.629 -3.25l-2.99 1.738',
      'M14 20l-2 -1l-2 1',
      'M12 22v-6.5l-3 -1.72',
      'M6.072 17.732l-.134 -2.232l-1.866 -1.232',
      'M3.34 17l5.629 -3.25l-.01 -3.458',
      'M4.072 9.732l1.866 -1.232l.134 -2.232',
      'M3.34 7l5.629 3.25l2.99 -1.738',
    ],
  },
};

// `strokeWidth` is in viewBox units, so it scales with the rendered size.
export const svgFor = (name, color, { size = 24, strokeWidth = 2 } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"` +
  ` fill="none" stroke="${color}" stroke-width="${strokeWidth}"` +
  ` stroke-linecap="round" stroke-linejoin="round">\n` +
  MARKS[name].paths.map((d) => `  <path d="${d}"/>`).join('\n') +
  `\n</svg>\n`;

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(OUT, { recursive: true });

  for (const [name, { color }] of Object.entries(MARKS)) {
    for (const [suffix, stroke] of [['', color], ['-white', '#FFFFFF']]) {
      const base = `${name}${suffix}`;
      const svg = svgFor(name, stroke, { size: PNG_SIZE });
      writeFileSync(join(OUT, `${base}.svg`), svg);

      // Render the PNG on a transparent ground.
      const html = `<html><body style="margin:0">${svg}</body></html>`;
      const htmlPath = join(OUT, `.${base}.html`);
      writeFileSync(htmlPath, html);
      execFileSync(CHROME, [
        '--headless=new', '--disable-gpu', '--hide-scrollbars',
        '--force-device-scale-factor=1',
        '--default-background-color=00000000',
        `--window-size=${PNG_SIZE},${PNG_SIZE}`,
        '--virtual-time-budget=3000',
        `--screenshot=${join(OUT, `${base}.png`)}`,
        `file://${htmlPath}`,
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      console.log(`icons/${base}.svg + .png`);
    }
  }
}
