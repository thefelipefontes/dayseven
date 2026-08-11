// Single source of truth for weekly streak math — current AND longest, per category.
//
// Before this module there were three separate walks over the week history: the live
// recalc in App.jsx, the share-card recalc, and a longest-streak loop buried in the
// personal-records recalc. Only the first two honored streak shields / vacation weeks /
// injury pauses, and only the first two counted a week the user simply didn't log. That
// divergence is what made "Your longest" disagree with the streak the user actually ran:
// a single shielded or vacation week mid-run chopped the longest value down to whatever
// fragment came after it.
//
// Semantics (these mirror the live streak exactly):
//   • A week counts for a category when that category's activity count meets its goal.
//   • A 'lifting+cardio' activity (Circuit, etc.) fills BOTH a lifting and a cardio slot.
//   • Shielded week → every category counts as met, so the streak advances.
//   • Vacation week → skipped entirely: neither advances nor breaks anything.
//   • Injury week   → the frozen categories are held (no advance, no break); categories
//                     outside the frozen set run normally; master is always held.
//   • Master (the "hybrid" streak) advances only on weeks where all three goals are met.
//   • The current / as-of week is still in progress: it can extend a streak but never
//     break one.
//
// Goals are always the user's CURRENT goals — the app doesn't keep a history of goal
// changes, so a longest value means "longest run that qualifies under today's goals".

import { countsAsLifting, countsAsCardio, countsAsRecovery } from './activityCategory';

const CATEGORIES = ['lifts', 'cardio', 'recovery'];

const pad = (n) => String(n).padStart(2, '0');

/** Sunday-start week key ('YYYY-MM-DD') for a Date. */
export const weekKeyFromDate = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Sunday-start week key for a 'YYYY-MM-DD' activity date (noon avoids DST/TZ drift). */
export const weekKeyFromDateStr = (dateStr) => weekKeyFromDate(new Date(`${dateStr}T12:00:00`));

const zero = () => ({ master: 0, lifts: 0, cardio: 0, recovery: 0 });

/**
 * Walk the full week history forward and return both the running streaks and the
 * longest run ever reached, per category.
 *
 * @param {Array}  activities  all logged activities ({ date: 'YYYY-MM-DD', ... })
 * @param {Object} goals       { liftsPerWeek, cardioPerWeek, recoveryPerWeek }
 * @param {Object} options
 *   shieldedWeeks     {string[]} week keys covered by a streak shield
 *   vacationWeeks     {string[]} week keys frozen by vacation mode
 *   injuryFrozenWeeks {Object}   week key → array of frozen categories
 *   asOf              {Date}     treat this date's week as the in-progress week
 *                                (defaults to today; used by the share card to
 *                                 report streaks as they stood in a past week)
 * @returns {{ current: {master,lifts,cardio,recovery}, longest: {master,lifts,cardio,recovery} }}
 */
export function computeStreaks(activities, goals, options = {}) {
  const result = { current: zero(), longest: zero() };
  if (!goals || !Array.isArray(activities) || activities.length === 0) return result;

  const {
    shieldedWeeks = [],
    vacationWeeks = [],
    injuryFrozenWeeks = {},
    asOf = new Date(),
  } = options;

  const goalFor = {
    lifts: goals.liftsPerWeek,
    cardio: goals.cardioPerWeek,
    recovery: goals.recoveryPerWeek,
  };

  // Bucket every activity into its week.
  const weeks = new Map();
  let earliestDate = null;
  activities.forEach((a) => {
    if (!a?.date) return;
    if (!earliestDate || a.date < earliestDate) earliestDate = a.date;
    const key = weekKeyFromDateStr(a.date);
    let week = weeks.get(key);
    if (!week) {
      week = { lifts: 0, cardio: 0, recovery: 0 };
      weeks.set(key, week);
    }
    if (countsAsLifting(a)) week.lifts++;
    if (countsAsCardio(a)) week.cardio++;
    if (countsAsRecovery(a)) week.recovery++;
  });
  if (!earliestDate) return result;

  const currentWeekKey = weekKeyFromDate(asOf);
  const cursor = new Date(`${earliestDate}T12:00:00`);
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - cursor.getDay());

  const current = zero();
  const longest = zero();
  const recordHighWater = () => {
    Object.keys(longest).forEach((k) => {
      if (current[k] > longest[k]) longest[k] = current[k];
    });
  };

  // Guard against a malformed date producing an unbounded walk.
  for (let guard = 0; guard < 5200; guard++) {
    const weekKey = weekKeyFromDate(cursor);
    if (weekKey > currentWeekKey) break;
    const isCurrentWeek = weekKey === currentWeekKey;

    // Vacation freezes everything — the week is invisible to the streak.
    if (!vacationWeeks.includes(weekKey)) {
      const counts = weeks.get(weekKey) || { lifts: 0, cardio: 0, recovery: 0 };
      const shielded = shieldedWeeks.includes(weekKey);
      const met = {};
      CATEGORIES.forEach((c) => { met[c] = shielded || counts[c] >= goalFor[c]; });
      const allMet = met.lifts && met.cardio && met.recovery;

      const frozen = injuryFrozenWeeks[weekKey]; // array of frozen categories, or undefined
      const isInjury = frozen !== undefined;

      CATEGORIES.forEach((c) => {
        if (isInjury && frozen.includes(c)) return;     // held — protected
        if (met[c]) current[c]++;
        else if (!isCurrentWeek) current[c] = 0;        // in-progress week never breaks
      });

      // Master is held for the whole of an injury week.
      if (!isInjury) {
        if (allMet) current.master++;
        else if (!isCurrentWeek) current.master = 0;
      }

      recordHighWater();
    }

    if (isCurrentWeek) break;
    cursor.setDate(cursor.getDate() + 7);
  }

  return { current, longest };
}
