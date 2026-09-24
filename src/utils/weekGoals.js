// The one answer to "did this week count?" — per category, and for the Winning Streak.
//
// Before this module the app answered that question in about fourteen places (Home,
// Profile's calendar and week stats, the month stats, three share-card walks, three
// celebration checks, the add/delete handlers, the streak walk itself), each with its own
// counting and its own goals. They drifted: some judged a past week against TODAY's goals
// instead of the goals in force that week, and some counted a 'lifting+cardio' activity
// (Circuit) toward only one goal. Every caller now counts and judges through here, so a
// rule change — like steps joining the Winning Streak — is made once.
//
// Weeks are Sunday-start, keyed 'YYYY-MM-DD' (see utils/streaks weekKeyFromDate).

import { countsAsLifting, countsAsCardio, countsAsRecovery } from './activityCategory';
import { initialUserData } from './initialUserData';

const DEFAULTS = initialUserData.goals;

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

/** Current goals in the { lifts, cardio, recovery, stepsPerDay } shape used below. */
export const normalizeGoals = (goals = {}) => ({
  lifts: goals.liftsPerWeek ?? DEFAULTS.liftsPerWeek,
  cardio: goals.cardioPerWeek ?? DEFAULTS.cardioPerWeek,
  recovery: goals.recoveryPerWeek ?? DEFAULTS.recoveryPerWeek,
  stepsPerDay: goals.stepsPerDay ?? DEFAULTS.stepsPerDay,
});

/**
 * Returns weekKey → the goals that were in force that week.
 *
 * Reads the user's goalHistory (written by saveUserGoals whenever goals change; goals only
 * change on a Sunday, so an entry always covers whole weeks). The newest entry at or before
 * the week wins; weeks before any recorded change fall back to current goals. A field an
 * older entry didn't record (stepsPerDay before it was added) also falls back to current.
 */
export const weekGoalsResolver = (goals, goalHistory = []) => {
  const current = normalizeGoals(goals);
  // Sorted defensively — saveUserGoals writes in order, but a hand-edited or
  // partially-migrated doc shouldn't skew the lookup.
  const history = (Array.isArray(goalHistory) ? goalHistory : [])
    .filter((h) => h && h.fromWeek)
    .sort((a, b) => a.fromWeek.localeCompare(b.fromWeek));

  return (weekKey) => {
    let chosen = null;
    for (const h of history) {
      if (h.fromWeek > weekKey) break;
      chosen = h;
    }
    if (!chosen) return current;
    return {
      lifts: chosen.liftsPerWeek ?? current.lifts,
      cardio: chosen.cardioPerWeek ?? current.cardio,
      recovery: chosen.recoveryPerWeek ?? current.recovery,
      stepsPerDay: chosen.stepsPerDay ?? current.stepsPerDay,
    };
  };
};

/**
 * Goal-slot counts for a list of activities (callers pass one week's worth).
 * A 'lifting+cardio' activity fills BOTH a lifting and a cardio slot.
 */
export const countWeekActivities = (activities = []) => {
  const counts = { lifts: 0, cardio: 0, recovery: 0 };
  activities.forEach((a) => {
    if (countsAsLifting(a)) counts.lifts++;
    if (countsAsCardio(a)) counts.cardio++;
    if (countsAsRecovery(a)) counts.recovery++;
  });
  return counts;
};

/**
 * Judge one week: which category goals are met, and whether the week counts toward the
 * Winning Streak.
 *
 * @param {{lifts,cardio,recovery}} counts    from countWeekActivities
 * @param {{lifts,cardio,recovery}} weekGoals from weekGoalsResolver / normalizeGoals
 * @returns {{ lifts: boolean, cardio: boolean, recovery: boolean, all: boolean }}
 */
export const judgeWeek = (counts, weekGoals) => {
  const met = {
    lifts: (counts?.lifts || 0) >= weekGoals.lifts,
    cardio: (counts?.cardio || 0) >= weekGoals.cardio,
    recovery: (counts?.recovery || 0) >= weekGoals.recovery,
  };
  return { ...met, all: met.lifts && met.cardio && met.recovery };
};

/**
 * Convenience for the common case: judge the week `weekKey` straight from the full
 * activity list, against the goals in force that week.
 */
export const judgeWeekFromActivities = (activities, weekKey, goals, goalHistory = []) => {
  const inWeek = (activities || []).filter((a) => a?.date && weekKeyFromDateStr(a.date) === weekKey);
  return judgeWeek(countWeekActivities(inWeek), weekGoalsResolver(goals, goalHistory)(weekKey));
};
