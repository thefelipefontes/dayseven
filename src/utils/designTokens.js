// Shared look for the Nov 2026 redesign (Home first; Plan, Profile and Friends reuse these next).
// The decisions behind every value live in the mocks (mocks/mock-home-light.html, option F1):
//   - each goal draws in its own category colour (CATEGORY_COLORS) on a tinted track of that colour
//   - gold is the winning streak and the week number, nothing else
//   - glow is a reward: only on a finished goal and a won week, never the resting look
import { CATEGORY_COLORS } from '../components/CategoryIcon';

export { CATEGORY_COLORS };

export const GOLD = '#FFD700';
export const GOLD_RGB = '255,215,0';

// '#00FF94' → '0,255,148', for rgba() tints of a category colour.
export const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
};

// The empty part of a goal: the goal's own colour at 20%.
export const TRACK_ALPHA = 0.2;
export const trackColor = (hex) => `rgba(${hexToRgb(hex)},${TRACK_ALPHA})`;

// A finished goal's soft halo.
export const doneGlow = (hex) => `0 0 12px rgba(${hexToRgb(hex)},0.5)`;

// Session blocks and the steps bar share one shape.
export const BAR = { height: 12, radius: 6, gap: 6 };

// The week number warms from white to gold as the week fills: rgb(255, 255−40t, 255·(1−t)).
// At 100 that's exactly GOLD. The glow comes only with the win (WEEK_WON_GLOW).
export const goldMix = (pct) => {
  const t = Math.min(1, Math.max(0, pct / 100));
  return `rgb(255,${Math.round(255 - 40 * t)},${Math.round(255 * (1 - t))})`;
};
export const WEEK_WON_GLOW = `0 0 22px rgba(${GOLD_RGB},0.45)`;

// Number sizes — Felipe's pick "One big number" (Nov 2026, mock-home-light.html .ns-B): each
// screen keeps ONE big number (Home's week %, Plan's done/placed, Profile's winning streak);
// every other number drops to text size. Read these instead of hard-coding sizes.
export const NUM = {
  big: { fontSize: 46, fontWeight: 800, letterSpacing: '-2.2px' },           // the one big number
  bigSmall: { fontSize: 22, letterSpacing: '-0.6px', marginLeft: 2 },        // its "%", "/7", "weeks"
  value: { fontSize: 17, fontWeight: 700, letterSpacing: '-0.2px', lineHeight: 1 }, // every other number
  valueSmall: { fontSize: 13, fontWeight: 600, color: '#666' },              // its "/goal" part
  mini: { fontSize: 15, fontWeight: 800, letterSpacing: '-0.3px' },          // one-line goal rows
  miniSmall: { fontSize: 12, fontWeight: 700, color: '#666' },
};
// The check badge on a finished goal.
export const CHECK_BADGE_SIZE = 18;

// Card surface: a faint top-lit gradient with a hairline edge.
export const CARD_RADIUS = 22;
export const CARD_SURFACE = {
  borderRadius: CARD_RADIUS,
  background: 'linear-gradient(180deg, rgba(255,255,255,0.065), rgba(255,255,255,0.035))',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), inset 0 0 0 1px rgba(255,255,255,0.035)',
};
// What that surface reads as over the black page, for things that must cover it exactly
// (the steps notch's cut-out ring, a swipe row's backing).
export const CARD_BG_SOLID = '#0e0e0e';

// Secondary text greys used across the new cards.
export const TEXT_MUTED = '#8a8a8a';
export const TEXT_FAINT = '#666';
