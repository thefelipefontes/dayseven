#!/usr/bin/env node
// Builds the App Store screenshot set.
//
//   node build.mjs          — write out/frame-N.html and render out/frame-N.png
//   node build.mjs --html   — write the HTML only (fast, for tweaking layout)
//
// Raw simulator captures live in ./captures/ at 1320x2868; the rendered frames
// come out at 1290x2796, which is the 6.9" size App Store Connect expects.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CANVAS, PANELS, ICONS } from './frames.config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Per-panel placement of the device mockup. `straight` panels share one set of
// numbers so the phone tops line up as you swipe through the carousel.
const STRAIGHT = { width: 957, top: 700 };
const TILT = {
  1: { width: 1080, left: 120, top: 690, rotate: 'rotateY(-13deg) rotateZ(-5deg)' },
  2: { width: 980, left: 190, top: 1290, rotate: 'rotateY(-13deg) rotateZ(-5deg)' },
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const lines = (s) => esc(s).replace(/\n/g, '<br>');

// Inline the capture so the rendered page has no file:// image dependency.
function dataUri(file) {
  const path = join(HERE, 'captures', file);
  if (!existsSync(path)) throw new Error(`missing capture: captures/${file}`);
  return `data:image/png;base64,${readFileSync(path).toString('base64')}`;
}

const css = () => `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body {
  width: ${CANVAS.width}px;
  height: ${CANVAS.height}px;
  overflow: hidden;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.frame {
  position: relative;
  width: ${CANVAS.width}px;
  height: ${CANVAS.height}px;
  overflow: hidden;
  background:
    radial-gradient(120% 70% at 50% 0%, rgba(46, 214, 160, 0.13) 0%, transparent 62%),
    linear-gradient(168deg, #0C312B 0%, #072320 38%, #03110F 78%, #010807 100%);
}

/* ---- copy ---- */
.copy {
  position: absolute;
  left: 0; right: 0;
  z-index: 3;
  text-align: center;
  padding: 0 70px;
}
.copy--top { top: 150px; }
.copy--bottom { bottom: 300px; }
.headline {
  font-size: 92px;
  font-weight: 800;
  color: #FFFFFF;
  letter-spacing: -2.6px;
  line-height: 1.12;
}
.subline {
  margin-top: 30px;
  font-size: 41px;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.62);
  letter-spacing: -0.4px;
  line-height: 1.36;
}

/* ---- device mockup ---- */
.phone {
  position: absolute;
  z-index: 2;
  background: #15171A;
  padding: 18px;
  box-shadow:
    0 0 0 2px rgba(255, 255, 255, 0.09),
    0 70px 140px rgba(0, 0, 0, 0.65),
    0 24px 70px rgba(0, 0, 0, 0.45);
}
.phone__screen {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #000;
}
.phone__screen img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top center;
  display: block;
}
/* No drawn Dynamic Island — the simulator captures already contain one. */
.phone--straight { left: 50%; transform: translateX(-50%); }
.phone--tilt { transform-style: preserve-3d; }

/* ---- panel 3: full-bleed capture fading into the background ---- */
.bleed {
  position: absolute;
  top: 0; left: 0;
  width: ${CANVAS.width}px;
  height: 1940px;
  overflow: hidden;
  z-index: 1;
}
.bleed img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
  display: block;
}
.bleed::after {
  content: '';
  position: absolute;
  left: 0; right: 0; bottom: 0;
  height: 460px;
  background: linear-gradient(180deg, rgba(3, 17, 15, 0) 0%, #051A17 62%, #041412 100%);
}

/* ---- panel 2: outlined category glyphs ---- */
.glyphs {
  position: absolute;
  left: 0; right: 0;
  top: 520px;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 46px;
}
.glyph {
  width: 132px;
  height: 132px;
  border: 3px solid rgba(255, 255, 255, 0.85);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}
/* 24-unit viewBox and stroke-width 2 are what both icon packs are drawn for. */
.glyph svg {
  width: 68px;
  height: 68px;
  fill: none;
  stroke: #FFFFFF;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
`;

function phoneHtml(panel, src) {
  // Screen aspect matches the iPhone 17 Pro Max capture (1320x2868).
  const ratio = 2868 / 1320;
  const isTilt = panel.layout === 'tilt';
  const cfg = isTilt ? TILT[panel.id] : STRAIGHT;
  const screenW = cfg.width - 36;
  const bezelH = Math.round(screenW * ratio) + 36;
  // Corner radius tracks the device width so it stays proportional when scaled.
  const outer = Math.round(cfg.width * 0.095);

  const pos = isTilt
    ? `left: ${cfg.left}px; top: ${cfg.top}px; transform: perspective(2900px) ${cfg.rotate};`
    : `top: ${cfg.top}px;`;

  return `  <div class="phone phone--${isTilt ? 'tilt' : 'straight'}"
       style="width: ${cfg.width}px; height: ${bezelH}px; border-radius: ${outer}px; ${pos}">
    <div class="phone__screen" style="border-radius: ${outer - 18}px;">
      <img src="${src}" alt="">
    </div>
  </div>`;
}

function panelHtml(panel) {
  const src = dataUri(panel.shot);
  const headline = panel.headline.map(esc).join('<br>');
  const subline = panel.subline ? `      <div class="subline">${lines(panel.subline)}</div>\n` : '';

  const glyphs = panel.icons
    ? `  <div class="glyphs">\n${panel.icons
        .map(
          (n) =>
            `    <div class="glyph"><svg viewBox="0 0 24 24">${ICONS[n]}</svg></div>`
        )
        .join('\n')}\n  </div>\n`
    : '';

  const copyPos = panel.layout === 'topbleed' ? 'bottom' : 'top';
  const body =
    panel.layout === 'topbleed'
      ? `  <div class="bleed"><img src="${src}" alt=""></div>\n`
      : phoneHtml(panel, src) + '\n';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>DaySeven — App Store screenshot ${panel.id}</title>
<style>${css()}</style>
</head>
<body>
<div class="frame">
${body}${glyphs}  <div class="copy copy--${copyPos}">
      <div class="headline">${headline}</div>
${subline}  </div>
</div>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });
const htmlOnly = process.argv.includes('--html');

for (const panel of PANELS) {
  const htmlPath = join(OUT, `frame-${panel.id}.html`);
  writeFileSync(htmlPath, panelHtml(panel));
  console.log(`wrote out/frame-${panel.id}.html`);

  if (htmlOnly) continue;

  const pngPath = join(OUT, `frame-${panel.id}.png`);
  execFileSync(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${CANVAS.width},${CANVAS.height}`,
    '--virtual-time-budget=5000',
    `--screenshot=${pngPath}`,
    `file://${htmlPath}`,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  console.log(`rendered out/frame-${panel.id}.png`);
}
