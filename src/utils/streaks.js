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
//                     outside the frozen set run normally. Master is held when the injury
//                     freezes a category that week's Winning Streak needs (under the
//                     original rule that's every injury week, as before).
//   • Master (the Winning Streak) advances only on weeks that meet the Winning Streak rule
//     (utils/weekGoals): Strength + Cardio + Recovery before the user's winningRuleFrom
//     week, Strength + Cardio + weekly Steps from it (Strength + Cardio without step data).
//   • Steps has its own streak (weekly steps ≥ stepsPerDay × 7), tracked only for users
//     with step data.
//   • The current / as-of week is still in progress: it can extend a streak but never
//     break one.
//
// Each week is judged against the goals that were in force THAT week, read from the
// user's goalHistory (recorded by saveUserGoals whenever goals change — and goals only
// ever change on a Sunday, so an entry always covers whole weeks). Without that, lowering
// a goal retroactively marked earlier weeks as met and inflated the streak.
//
// Weeks earlier than any recorded change fall back to current goals. For accounts that
// predate goalHistory that means every week, so their numbers are unchanged — the past
// can't be reconstructed, only kept honest from here on.

import { countsAsLifting, countsAsCardio, countsAsRecovery } from './activityCategory';
import { weekGoalsResolver, judgeWeek, weekKeyFromDate, weekKeyFromDateStr, usesStepsRule, winningCategories, weekStepsTotal, hasRecentSteps } from './weekGoals';

const ACTIVITY_CATEGORIES = ['lifts', 'cardio', 'recovery'];

// Week keys live with the week rules; re-exported so existing imports keep working.
export { weekKeyFromDate, weekKeyFromDateStr };

const zero = () => ({ master: 0, lifts: 0, cardio: 0, recovery: 0, steps: 0 });

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
  if (!goals || !Array.isArray(activities)) return result;

  const {
    shieldedWeeks = [],
    vacationWeeks = [],
    injuryFrozenWeeks = {},
    goalHistory = [],
    asOf = new Date(),
    stepsByDate = {},        // 'YYYY-MM-DD' → steps (utils/weekGoals stepsByDateFrom)
    winningRuleFrom = null,  // first week judged by the steps rule (per user)
    stepsTracked = hasRecentSteps(stepsByDate, asOf),
  } = options;
  const ctx = { winningRuleFrom, stepsTracked };
  // Steps only gets a streak when the user has step data at all.
  const CATEGORIES = stepsTracked ? [...ACTIVITY_CATEGORIES, 'steps'] : ACTIVITY_CATEGORIES;

  // Each week is judged against the goals in force that week (utils/weekGoals).
  const goalsForWeek = weekGoalsResolver(goals, goalHistory);

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
  // Step history can start before the first logged activity; walk from whichever is first.
  if (stepsTracked) {
    Object.keys(stepsByDate).forEach((d) => {
      if ((stepsByDate[d] || 0) > 0 && (!earliestDate || d < earliestDate)) earliestDate = d;
    });
  }
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
      const goalFor = goalsForWeek(weekKey);
      const shielded = shieldedWeeks.includes(weekKey);
      // A shielded week counts as met across the board.
      const required = winningCategories(weekKey, ctx);
      const judged = judgeWeek(counts, goalFor, { weekSteps: weekStepsTotal(stepsByDate, weekKey), required });
      const met = {};
      CATEGORIES.forEach((c) => { met[c] = shielded || judged[c]; });
      const allMet = shielded || judged.all;

      const frozen = injuryFrozenWeeks[weekKey]; // array of frozen categories, or undefined
      const isInjury = frozen !== undefined;

      CATEGORIES.forEach((c) => {
        if (isInjury && frozen.includes(c)) return;     // held — protected
        if (met[c]) current[c]++;
        else if (!isCurrentWeek) current[c] = 0;        // in-progress week never breaks
      });

      // Master is held when the injury froze something this week's Winning Streak needs.
      // Under the original rule that's any injury week (unchanged); under the steps rule a
      // recovery-only injury no longer holds it, since recovery doesn't count toward it.
      const masterHeld = isInjury && (!usesStepsRule(weekKey, winningRuleFrom) || frozen.some((c) => required.includes(c)));
      if (!masterHeld) {
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
