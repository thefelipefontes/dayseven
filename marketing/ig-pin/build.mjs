#!/usr/bin/env node
// Two-post pinned Instagram split ("puzzle") for DaySeven.
//
//   node marketing/ig-pin/build.mjs
//
// Each concept is drawn once on a single master canvas, then sliced into two
// 1080x1350 (4:5) posts. The profile grid shows posts as 3:4, so it hides
// ~34px off each side of every post. The master is therefore 2 x 1012.5 of
// visible area plus a 34px bleed on the outer edges, and the two slices
// overlap by 67px, so the halves line up seamlessly on the grid.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(HERE, 'out');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const W = 1080, H = 1350;
const CROP = (W - H * 3 / 4) / 2;        // 33.75px hidden per side on the grid
const VIS = W - 2 * CROP;                  // 1012.5px visible per post
const MW = Math.round(2 * VIS + 2 * CROP); // 2093px master
const SEAM = CROP + VIS;                   // 1046.25, where the grid splits
const P2 = Math.round(SEAM - CROP);        // post 2 starts here on the master
const C1 = CROP + VIS / 2, C2 = SEAM + VIS / 2; // visible centres of each post

const C = { strength: '#00FF94', cardio: '#FF9500', steps: '#BF5AF2', gold: '#FFD60A', recovery: '#00D1FF' };

const b64 = (p, type) => `data:${type};base64,${readFileSync(join(ROOT, p)).toString('base64')}`;
const HOME = b64('marketing/ig-pin/home.png', 'image/png');
const WORDMARK = b64('public/wordmark.png', 'image/png');
const ICON_MARK = b64('public/icon-transparent.png', 'image/png');

const ICON = {
  strength: '<path d="M12.409 13.017A5 5 0 0 1 22 15c0 3.866-4 7-9 7-4.077 0-8.153-.82-10.371-2.462-.426-.316-.631-.832-.62-1.362C2.118 12.723 2.627 2 10 2a3 3 0 0 1 3 3 2 2 0 0 1-2 2c-1.105 0-1.64-.444-2-1"/><path d="M15 14a5 5 0 0 0-7.584 2"/><path d="M9.964 6.825C8.019 7.977 9.5 13 8 15"/>',
  cardio: '<path d="M19.5 13.572l-7.5 7.428l-2.896 -2.868m-6.117 -8.104a5 5 0 0 1 9.013 -3.022a5 5 0 1 1 7.5 6.572"/><path d="M3 13h2l2 3l2 -6l1 3h3"/>',
  steps: '<path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z"/><path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"/><path d="M16 17h4"/><path d="M4 13h4"/>',
};
const icon = (k, size, color) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;

// A DaySeven-style progress ring, absolutely positioned by its centre.
function ring({ cx, cy, d, sw, color, p, inner = '' }) {
  const r = (d - sw) / 2, circ = 2 * Math.PI * r;
  return `<div class="ring" style="left:${cx - d / 2}px;top:${cy - d / 2}px;width:${d}px;height:${d}px">
    <svg width="${d}" height="${d}" style="transform:rotate(-90deg)">
      <circle cx="${d / 2}" cy="${d / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="${sw}"/>
      <circle cx="${d / 2}" cy="${d / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"
        stroke-dasharray="${circ * p} ${circ}" style="filter:drop-shadow(0 0 ${sw * 0.6}px ${color}66)"/>
    </svg>
    <div class="ring-in">${inner}</div>
  </div>`;
}

// An arc of a circle centred at (cx, cy), drawn as an SVG path (degrees, 0 = up, clockwise).
function arc({ cx, cy, r, sw, color, from, to, track = true }) {
  const pt = (a) => [cx + r * Math.sin(a * Math.PI / 180), cy - r * Math.cos(a * Math.PI / 180)];
  const path = (a, b) => { const [x1, y1] = pt(a), [x2, y2] = pt(b); return `M${x1} ${y1} A${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${x2} ${y2}`; };
  return (track ? `<path d="${path(-90, 90)}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="${sw}" stroke-linecap="round"/>` : '') +
    `<path d="${path(from, to)}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" style="filter:drop-shadow(0 0 ${sw * 0.5}px ${color}55)"/>`;
}

function phone({ x, y, w, rotate = 0, crop = null }) {
  const h = w * 2868 / 1320;
  return `<div class="phone" style="left:${x}px;top:${y}px;width:${w}px;height:${crop ?? h}px;transform:rotate(${rotate}deg)">
    <div class="phone-screen"><img src="${HOME}"></div>
  </div>`;
}

const streakPill = (n, scale = 1) => `<div class="pill" style="transform:scale(${scale});transform-origin:left top">
  <span class="pill-fire">🔥</span><b>${n}</b> week winning streak</div>`;

const BASE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
* { margin:0; padding:0; box-sizing:border-box; }
html, body { width:${W}px; height:${H}px; overflow:hidden; background:#000; font-family:'Inter',-apple-system,sans-serif; -webkit-font-smoothing:antialiased; color:#fff; }
.stage { position:absolute; top:0; width:${MW}px; height:${H}px; overflow:hidden;
  background:
    radial-gradient(60% 55% at 50% 0%, rgba(46,214,160,0.14) 0%, transparent 70%),
    linear-gradient(170deg, #0C312B 0%, #072320 38%, #03110F 75%, #010807 100%); }
.abs { position:absolute; }
.ring { position:absolute; }
.ring-in { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
.phone { position:absolute; background:#1C1C1E; border-radius:${70}px ${70}px ${70}px ${70}px; padding:14px; overflow:hidden;
  box-shadow:0 0 0 2px rgba(255,255,255,0.09), 0 60px 120px rgba(0,0,0,0.65), 0 20px 50px rgba(0,0,0,0.45); }
.phone-screen { width:100%; height:100%; border-radius:57px; overflow:hidden; background:#000; }
.phone-screen img { width:100%; display:block; }
.pill { display:inline-flex; align-items:center; gap:14px; white-space:nowrap; padding:18px 34px; border-radius:999px;
  background:rgba(255,214,10,0.12); border:2px solid rgba(255,214,10,0.45); color:${C.gold}; font-size:34px; font-weight:600; }
.pill b { font-size:44px; font-weight:800; }
.pill-fire { font-size:36px; }
.wordmark { height:52px; opacity:0.95; }
.h { font-weight:800; letter-spacing:-0.035em; line-height:0.98; }
.muted { color:rgba(255,255,255,0.5); }
`;

// ---------------------------------------------------------------- concepts

const CONCEPTS = {
  // A — The three Home rings, blown up across the whole split.
  a: () => {
    const d = 540, sw = 62, cy = 735;
    const label = (k, name, color) => `<div class="abs lbl" style="color:${color}">${icon(k, 46, color)}<span>${name}</span></div>`;
    const lbl = (cx, k, name, color) => `<div class="abs" style="left:${cx - 200}px;top:${cy + d / 2 + 44}px;width:400px;display:flex;justify-content:center">
      <div style="display:flex;align-items:center;gap:14px;font-size:44px;font-weight:700">${icon(k, 46, color)}<span>${name}</span></div></div>`;
    const xs = [CROP + VIS * 0.36, SEAM, SEAM + VIS * 0.64];
    return `
      <div class="abs h" style="left:${CROP + 86}px;top:120px;font-size:132px">Win the week,</div>
      <div class="abs h muted" style="left:${SEAM + 40}px;top:120px;font-size:132px">not the day.</div>
      ${ring({ cx: xs[0], cy, d, sw, color: C.strength, p: 2 / 3, inner: `<div class="h" style="font-size:150px">2/3</div>` })}
      ${ring({ cx: xs[1], cy, d, sw, color: C.cardio, p: 1 / 2, inner: `<div class="h" style="font-size:150px">1/2</div>` })}
      ${ring({ cx: xs[2], cy, d, sw, color: C.steps, p: 46 / 70, inner: `<div class="h" style="font-size:140px">46k</div><div class="muted" style="font-size:42px;font-weight:600;margin-top:6px">/ 70k</div>` })}
      ${lbl(xs[0], 'strength', 'Strength', C.strength)}
      ${lbl(xs[1], 'cardio', 'Cardio', C.cardio)}
      ${lbl(xs[2], 'steps', 'Steps', C.steps)}
      <img class="abs wordmark" src="${WORDMARK}" style="left:${CROP + 86}px;top:${H - 130}px">
      <div class="abs" style="left:${SEAM + VIS - 86 - 560}px;top:${H - 150}px;width:560px;display:flex;justify-content:flex-end">${streakPill(12)}</div>
    `;
  },

  // B — The real Home screen, tilted across the seam.
  b: () => {
    const pw = 640;
    const goal = (k, name, txt, color) => `<div style="display:flex;align-items:center;gap:22px;margin-bottom:30px">
      ${icon(k, 52, color)}<div style="font-size:46px;font-weight:700">${name}</div><div class="muted" style="font-size:38px;font-weight:500">${txt}</div></div>`;
    return `
      <div class="abs h" style="left:${CROP + 86}px;top:150px;font-size:150px">Win<br>the week.</div>
      <div class="abs h muted" style="left:${CROP + 86}px;top:470px;font-size:76px">Not the day.</div>
      <div class="abs" style="left:${CROP + 90}px;top:${H - 430}px">
        ${goal('strength', 'Strength', 'sessions a week', C.strength)}
        ${goal('cardio', 'Cardio', 'sessions a week', C.cardio)}
        ${goal('steps', 'Steps', 'weekly total', C.steps)}
      </div>
      ${phone({ x: SEAM - pw / 2 + 30, y: 170, w: pw, rotate: 7 })}
      <div class="abs" style="left:${SEAM + VIS - 86 - 330}px;top:200px;width:330px;text-align:right">
        <div class="h" style="font-size:64px;color:${C.gold}">Hit all 3.</div>
        <div class="h" style="font-size:64px">Keep the<br>streak.</div>
      </div>
      <div class="abs" style="left:${SEAM + VIS - 86 - 360}px;top:${H - 400}px;width:360px;text-align:right">
        <div class="h" style="font-size:170px;color:${C.gold}">12</div>
        <div style="font-size:34px;font-weight:600;color:${C.gold};opacity:.85;margin-top:8px;white-space:nowrap">week winning streak 🔥</div>
      </div>
      <img class="abs wordmark" src="${WORDMARK}" style="left:${SEAM + VIS - 86 - 236}px;top:${H - 120}px;height:44px;opacity:.6">
    `;
  },

  // C — Three huge arcs rising across both posts, phone on the right.
  c: () => {
    const cx = SEAM, cy = H + 330;
    const svg = `<svg class="abs" style="left:0;top:0" width="${MW}" height="${H}">
      ${arc({ cx, cy, r: 930, sw: 96, color: C.strength, from: -90, to: 30 })}
      ${arc({ cx, cy, r: 815, sw: 96, color: C.cardio, from: -90, to: 0 })}
      ${arc({ cx, cy, r: 700, sw: 96, color: C.steps, from: -90, to: 28 })}
    </svg>`;
    return `
      ${svg}
      <div class="abs h" style="left:${CROP + 86}px;top:120px;font-size:120px">Get in shape.</div>
      <div class="abs h" style="left:${CROP + 86}px;top:240px;font-size:120px;color:rgba(255,255,255,.5)">Keep your life.</div>
      <div class="abs" style="left:${CROP + 90}px;top:420px;font-size:40px;line-height:1.4;font-weight:500;color:rgba(255,255,255,.7)">
        Three goals a week.<br>Lift. Cardio. Steps.<br>Hit them, keep the streak.</div>
      ${phone({ x: SEAM + VIS - 86 - 560, y: 110, w: 560 })}
      <img class="abs wordmark" src="${WORDMARK}" style="left:${CROP + 86}px;top:640px;height:44px;opacity:.6">
    `;
  },

  // D — C's arcs and copy, with B's tilted phone straddling the seam.
  d: () => polished(),

  // E — Same, but the phone stands upright on the seam and bleeds off the bottom.
  e: () => hybrid({ rotate: 0, pw: 640, py: 330 }),
};

// D, polished: rings sit higher to fill the left post, the phone gets a glow
// and drops clear of the headline, and the right post's copy keys the ring colours.
function polished() {
  const cx = SEAM, cy = H + 230, pw = 600;
  const svg = `<svg class="abs" style="left:0;top:0" width="${MW}" height="${H}">
    ${arc({ cx, cy, r: 930, sw: 96, color: C.strength, from: -90, to: 50 })}
    ${arc({ cx, cy, r: 815, sw: 96, color: C.cardio, from: -90, to: 34 })}
    ${arc({ cx, cy, r: 700, sw: 96, color: C.steps, from: -90, to: 44 })}
  </svg>`;
  const right = SEAM + VIS - 86;
  return `
    ${svg}
    <div class="abs" style="left:${SEAM - 520}px;top:260px;width:1040px;height:1040px;border-radius:50%;
      background:radial-gradient(closest-side, rgba(0,255,148,0.16), transparent 70%)"></div>
    <div class="abs h" style="left:${CROP + 86}px;top:118px;font-size:112px">Get in shape.</div>
    <div class="abs h" style="left:${CROP + 86}px;top:230px;font-size:112px;color:rgba(255,255,255,.5)">Keep your life.</div>
    ${phone({ x: SEAM - pw / 2 + 40, y: 390, w: pw, rotate: 7 })}
    <div class="abs" style="left:${right - 560}px;top:118px;width:560px;text-align:right">
      <div class="h" style="font-size:80px">Three goals<br>a week.</div>
      <div style="font-size:40px;line-height:1.45;font-weight:600;margin-top:26px">
        <span style="color:${C.strength}">Lift.</span> <span style="color:${C.cardio}">Cardio.</span> <span style="color:${C.steps}">Steps.</span></div>
      <div style="font-size:40px;line-height:1.45;font-weight:500;color:rgba(255,255,255,.6)">Hit them, keep the streak.</div>
    </div>
    <div class="abs" style="left:${right - 400}px;top:${H - 150}px;width:400px;display:flex;justify-content:flex-end;align-items:center;gap:14px;opacity:.9">
      <img src="${ICON_MARK}" style="height:78px;margin-right:-8px"><img src="${WORDMARK}" style="height:40px">
    </div>
  `;
}

function hybrid({ rotate, pw, py, dx = 0 }) {
  const cx = SEAM, cy = H + 330;
  const svg = `<svg class="abs" style="left:0;top:0" width="${MW}" height="${H}">
    ${arc({ cx, cy, r: 930, sw: 96, color: C.strength, from: -90, to: 50 })}
    ${arc({ cx, cy, r: 815, sw: 96, color: C.cardio, from: -90, to: 34 })}
    ${arc({ cx, cy, r: 700, sw: 96, color: C.steps, from: -90, to: 44 })}
  </svg>`;
  const right = SEAM + VIS - 86;
  return `
    ${svg}
    <div class="abs h" style="left:${CROP + 86}px;top:120px;font-size:104px">Get in shape.</div>
    <div class="abs h" style="left:${CROP + 86}px;top:224px;font-size:104px;color:rgba(255,255,255,.5)">Keep your life.</div>
    ${phone({ x: SEAM - pw / 2 + dx, y: py, w: pw, rotate })}
    <div class="abs" style="left:${right - 560}px;top:120px;width:560px;text-align:right">
      <div class="h" style="font-size:72px">Three goals<br>a week.</div>
      <div style="font-size:38px;line-height:1.4;font-weight:500;color:rgba(255,255,255,.65);margin-top:22px">Lift. Cardio. Steps.<br>Hit them, keep the streak.</div>
    </div>
    <img class="abs wordmark" src="${WORDMARK}" style="left:${right - 236}px;top:470px;height:44px;opacity:.6">
  `;
}

// ---------------------------------------------------------------- render

mkdirSync(OUT, { recursive: true });

const page = (body, shift) => `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head>
<body><div class="stage" style="left:${-shift}px">${body}</div></body></html>`;

function shot(html, file, w, h) {
  const tmp = join(OUT, file.replace(/\.png$/, '.html'));
  writeFileSync(tmp, html);
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--virtual-time-budget=4000', `--window-size=${w},${h}`, `--screenshot=${join(OUT, file)}`, `file://${tmp}`], { stdio: 'ignore' });
}

const only = process.argv.slice(2);
for (const [id, make] of Object.entries(CONCEPTS)) {
  if (only.length && !only.includes(id)) continue;
  const body = make();
  shot(page(body, 0), `${id}-post1.png`, W, H);
  shot(page(body, P2), `${id}-post2.png`, W, H);

  // How it reads: the two posts as uploaded, and as 3:4 tiles on the profile grid.
  const gw = 380, gh = gw * 4 / 3, gap = 3;
  const tile = (src) => `<div style="width:${gw}px;height:${gh}px;overflow:hidden;background:#111">
    <img src="${src}" style="height:100%;width:${gh * W / H}px;margin-left:${-(gh * W / H - gw) / 2}px;display:block"></div>`;
  const preview = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@500;700&display=swap');
    body{margin:0;background:#fff;font-family:Inter,sans-serif;color:#111;padding:40px;width:1700px}
    h2{font-size:22px;margin:0 0 14px} .row{display:flex;gap:${gap}px} .lbl{font-size:15px;color:#777;margin:10px 0 30px}
  </style></head><body>
    <h2>Concept ${id.toUpperCase()} — profile grid (3:4 tiles)</h2>
    <div class="row">${tile(`${id}-post1.png`)}${tile(`${id}-post2.png`)}<div style="width:${gw}px;height:${gh}px;background:#e9e9e9;display:flex;align-items:center;justify-content:center;color:#999;font-size:15px">your latest post</div></div>
    <div class="lbl">How the pinned pair reads on the profile</div>
    <h2>As posted (4:5, 1080×1350 each)</h2>
    <div class="row" style="gap:24px"><img src="${id}-post1.png" width="540"><img src="${id}-post2.png" width="540"></div>
  </body></html>`;
  shot(preview, `${id}-preview.png`, 1780, 1400);
  console.log(`concept ${id}: out/${id}-post1.png, out/${id}-post2.png, out/${id}-preview.png`);
}
