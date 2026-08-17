// Panel definitions for the App Store screenshot set.
// Mirrors the seven-panel layout previously assembled in screenshots.pro.
//
// `shot` is a filename in ./captures/ (raw simulator screenshots, 1320x2868).
// `layout` picks one of the three arrangements defined in styles.css:
//   tilt      — oversized phone in 3D perspective, bleeding off the bottom-right
//   straight  — phone centred below the copy
//   topbleed  — phone cropped by the top edge, copy underneath

export const CANVAS = { width: 1290, height: 2796 };

export const PANELS = [
  {
    id: 1,
    shot: 'home.png',
    layout: 'tilt',
    headline: ['Set Your Standards.', 'Earn Your Streaks.'],
    subline: null,
  },
  {
    id: 2,
    shot: 'goals.png',
    layout: 'tilt',
    headline: ['Three rings. One goal.'],
    subline: 'Strength. Cardio. Recovery.',
    icons: ['strength', 'cardio', 'recovery'],
  },
  {
    id: 3,
    shot: 'feed.png',
    layout: 'topbleed',
    headline: ['Better with Friends.'],
    subline: 'Share your wins.\nHype each other up.',
  },
  {
    id: 4,
    shot: 'history.png',
    layout: 'straight',
    headline: ['Your Stats.', 'Your Records.', 'Your Proof.'],
    subline: 'Streaks, personal bests and\nweek-by-week history.',
  },
  {
    id: 5,
    shot: 'leaderboard.png',
    layout: 'straight',
    headline: ['Compete.', 'Dominate.'],
    subline: 'Rankings across calories, steps,\nworkouts & more.',
  },
  {
    id: 6,
    shot: 'challenges.png',
    layout: 'straight',
    headline: ['Bet on Yourself.'],
    subline: 'Head-to-head challenges.\nWinner takes the streak.',
  },
  {
    id: 7,
    shot: 'trends.png',
    layout: 'straight',
    headline: ['Zoom Out.', 'See the Big Picture.'],
    subline: 'Weekly, monthly & yearly trends\nfor every metric that matters.',
  },
];

// Glyphs used by panel 2 — the app's real category marks, not lookalikes.
// Single source of truth is export-icons.mjs, which lifts the path data straight
// from the installed icon packs (see src/components/CategoryIcon.jsx).
import { MARKS } from './export-icons.mjs';

export const ICONS = Object.fromEntries(
  Object.entries(MARKS).map(([name, { paths }]) => [
    name,
    paths.map((d) => `<path d="${d}"/>`).join(''),
  ])
);
