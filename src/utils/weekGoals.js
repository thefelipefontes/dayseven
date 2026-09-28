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

// ── The Winning Streak rule ────────────────────────────────────────────────────────────
//
// Two rules, split by week:
//   • before the user's `winningRuleFrom` week: Strength + Cardio + Recovery (the original)
//   • from that week on:                        Strength + Cardio + weekly Steps
// `winningRuleFrom` is per user — the week they first ran a build with the steps rule — so
// nobody's past weeks are re-judged by a rule they never saw. Recovery keeps its own streak
// either way; it just stops counting toward the Winning Streak.
//
// Users without step data (no Apple Health access) can never hit a steps goal, so for them
// the steps rule is Strength + Cardio only.

/** Does this week use the steps rule? */
export const usesStepsRule = (weekKey, winningRuleFrom) => !!winningRuleFrom && weekKey >= winningRuleFrom;

/** The categories the Winning Streak needs in a given week. */
export const winningCategories = (weekKey, ctx = {}) => {
  if (!usesStepsRule(weekKey, ctx.winningRuleFrom)) return ['lifts', 'cardio', 'recovery'];
  return ctx.stepsTracked === false ? ['lifts', 'cardio'] : ['lifts', 'cardio', 'steps'];
};

/** Sum of the seven daily step totals of the week starting `weekKey` (a Sunday). */
export const weekStepsTotal = (stepsByDate = {}, weekKey) => {
  const d = new Date(`${weekKey}T12:00:00`);
  let total = 0;
  for (let i = 0; i < 7; i++) {
    total += stepsByDate[`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`] || 0;
    d.setDate(d.getDate() + 1);
  }
  return total;
};

/**
 * Daily steps map ('YYYY-MM-DD' → steps) from the stored health history, with today's live
 * reading laid over today's stored one (which lags behind while the app is open).
 */
export const stepsByDateFrom = (healthHistory = [], todaySteps = 0, todayKey = null) => {
  const map = {};
  (healthHistory || []).forEach((e) => { if (e?.date) map[e.date] = e.steps || 0; });
  if (todayKey && todaySteps > 0) map[todayKey] = Math.max(map[todayKey] || 0, todaySteps);
  return map;
};

/**
 * Whether the user tracks steps at all. iOS never reports whether HealthKit READ access was
 * denied, so this is judged from the data: any steps recorded in the four weeks up to
 * `today`. No data → the steps rule falls back to Strength + Cardio.
 */
export const hasRecentSteps = (stepsByDate = {}, today = new Date()) => {
  const d = new Date(today);
  d.setHours(12, 0, 0, 0);
  for (let i = 0; i < 28; i++) {
    if ((stepsByDate[`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`] || 0) > 0) return true;
    d.setDate(d.getDate() - 1);
  }
  return false;
};

/**
 * Judge one week: which category goals are met, and whether the week counts toward the
 * Winning Streak.
 *
 * @param {{lifts,cardio,recovery}} counts    from countWeekActivities
 * @param {{lifts,cardio,recovery,stepsPerDay}} weekGoals from weekGoalsResolver / normalizeGoals
 * @param {Object} [opts]
 *   weekSteps  {number}   the week's step total
 *   required   {string[]} categories the Winning Streak needs this week (winningCategories);
 *                         defaults to the original Strength + Cardio + Recovery
 * @returns {{ lifts, cardio, recovery, steps: boolean, all: boolean, required: string[],
 *            percent: number, missing: { lifts, cardio, recovery, steps: number } }}
 *   percent  0–100, the average completion of the required goals, each capped at its goal
 *            (extra doesn't count) — the same number as Home's Week Progress.
 *   missing  how far short each goal is (0 when met): sessions, or steps for `steps`.
 */
export const judgeWeek = (counts, weekGoals, { weekSteps = 0, required = ['lifts', 'cardio', 'recovery'] } = {}) => {
  const stepsGoal = (weekGoals.stepsPerDay ?? DEFAULTS.stepsPerDay) * 7;
  const done = { lifts: counts?.lifts || 0, cardio: counts?.cardio || 0, recovery: counts?.recovery || 0, steps: weekSteps };
  const goal = { lifts: weekGoals.lifts, cardio: weekGoals.cardio, recovery: weekGoals.recovery, steps: stepsGoal };
  const met = {
    lifts: done.lifts >= goal.lifts,
    cardio: done.cardio >= goal.cardio,
    // A recovery goal of 0 means Recovery is off: never "met", so its streak doesn't count up on its own.
    recovery: goal.recovery > 0 && done.recovery >= goal.recovery,
    steps: done.steps >= goal.steps,
  };
  const part = (c) => (goal[c] > 0 ? Math.min(done[c] / goal[c], 1) : 1);
  const percent = required.length > 0
    ? Math.round((required.reduce((sum, c) => sum + part(c), 0) / required.length) * 100)
    : 0;
  const missing = Object.fromEntries(Object.keys(goal).map((c) => [c, Math.max(0, (goal[c] || 0) - done[c])]));
  return { ...met, all: required.every((c) => met[c]), required, percent, missing };
};

/**
 * Everything needed to judge any week, gathered once per screen:
 *   { goals, goalHistory, winningRuleFrom, stepsByDate, stepsTracked }
 * `stepsTracked` defaults to hasRecentSteps(stepsByDate).
 */
export const weekContext = ({ goals, goalHistory = [], winningRuleFrom = null, stepsByDate = {}, stepsTracked } = {}) => ({
  goals,
  goalHistory: goalHistory || [],
  winningRuleFrom: winningRuleFrom || null,
  stepsByDate: stepsByDate || {},
  stepsTracked: stepsTracked ?? hasRecentSteps(stepsByDate || {}),
});

/**
 * The common case: judge the week `weekKey` straight from the full activity list.
 * `ctx` is a weekContext (goals, goal history, rule start, steps).
 */
export const judgeWeekFromActivities = (activities, weekKey, ctx = {}) => {
  const inWeek = (activities || []).filter((a) => a?.date && weekKeyFromDateStr(a.date) === weekKey);
  const weekGoals = weekGoalsResolver(ctx.goals, ctx.goalHistory)(weekKey);
  return judgeWeek(countWeekActivities(inWeek), weekGoals, {
    weekSteps: weekStepsTotal(ctx.stepsByDate, weekKey),
    required: winningCategories(weekKey, ctx),
  });
};

/**
 * Today's steps share, set at the START of today and fixed all day: what the week still needed
 * going into today ÷ the days left, today included. 70k goal, Monday, 11.9k before today →
 * (70k − 11.9k) ÷ 6 = 9.7k. It's a daily total ("846 / 9.7k"), so it's the one number shown
 * everywhere — Home's pace line and Today's Activity row, the Plan tab, the week stats sheet,
 * and the Watch (DailyDetailView.swift todayStepTarget, same rule). It resets each morning:
 * less if you beat yesterday's share, more if you didn't.
 *   total     the week's steps so far, today included; today  today's steps so far
 *   daysLeft  days left in the week including today (Saturday = 1)
 * @returns {{ share: number, after: number, leftToday: number, lastDay: boolean }}
 *   after      what each day after today needs — the share, or less once today beats it
 *   leftToday  steps still to walk today to hit the share
 */
export const stepsDailyShare = (goal, total, today, daysLeft) => {
  const up100 = (n) => Math.ceil(Math.max(0, n) / 100) * 100;
  const d = Math.max(daysLeft, 1);
  const share = up100((goal - (total - today)) / d);
  const after = d > 1 && today > share ? up100((goal - total) / (d - 1)) : share;
  return { share, after, leftToday: Math.max(0, share - today), lastDay: d <= 1 };
};
