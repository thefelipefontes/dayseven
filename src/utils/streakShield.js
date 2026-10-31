// The Streak Shield holds a streak through a week that ends short. Win the week (every
// goal hit) and the streak grows by one; hold it and the streak stays where it is; below
// that, it resets.
//
// A week holds when it ends at 70%+ of the Week Progress number Home shows (judgeWeek's
// `percent`: the average of the Winning Streak goals, each capped at 100%) AND every one of
// those goals got at least halfway (judgeWeek's `toHalf`). The halfway floor stops a week
// that maxes two goals and skips the third from holding.
//
// It applies itself to every closed week that qualifies, with no cooldown, from the user's
// `holdFrom` week (the first week this build ran for them, set once like winningRuleFrom).
// Weeks before that keep the old rule they were judged under: one shield every 4 weeks,
// 70% with no per-goal floor, and a shielded week counted as met, so the streak advanced
// through it (utils/streaks). Nobody's past streak changes.
//
// Stored on the profile as streakShield:
//   shieldedWeeks  {string[]} every week a shield covered (manual ones from before included)
//   lastUsedWeek   {string}   the most recent shielded week (Home's "held" notice reads it)
//   autoWeeks      {string[]} weeks the shield was applied to automatically
//   autoFrom       {string}   first week judged automatically, so weeks before it are never
//                             re-judged
//   holdFrom       {string}   first week judged by the every-week hold rule
//   noticeSeenWeek {string}   the held week whose notice was dismissed

import { computeStreaks, weekKeyFromDate } from './streaks';
import { judgeWeekFromActivities } from './weekGoals';

export const SHIELD_MIN_PERCENT = 70;
// The old rule's cooldown, still applied to weeks before holdFrom.
const LEGACY_COOLDOWN_WEEKS = 4;
// How far back a run looks for a closed week to cover — enough for someone who didn't
// open the app for a while, without ever reaching past autoFrom.
const LOOKBACK_WEEKS = 6;

const weekDate = (weekKey) => new Date(`${weekKey}T12:00:00`);

export const addWeeks = (weekKey, n) => {
  const d = weekDate(weekKey);
  d.setDate(d.getDate() + n * 7);
  return weekKeyFromDate(d);
};

/** Whole weeks from week key `a` to week key `b` (positive when b is later). */
export const weeksBetween = (a, b) => Math.round((weekDate(b) - weekDate(a)) / (7 * 24 * 60 * 60 * 1000));

/** Goals in a judged week (judgeWeek) still short of halfway, in required order. */
export const goalsShortOfHalf = (judged) => judged.required.filter((c) => (judged.toHalf?.[c] ?? 0) > 0);

/** Does a judged week (judgeWeek) hold the streak? A won week doesn't need to. */
export const canHold = (judged) => !judged.all && judged.percent >= SHIELD_MIN_PERCENT && goalsShortOfHalf(judged).length === 0;

/** Was `weekKey` held under the every-week rule (as opposed to an old-style shield)? */
export const isHoldWeek = (streakShield, weekKey) => !!streakShield?.holdFrom && weekKey >= streakShield.holdFrom
  && (streakShield.shieldedWeeks || []).includes(weekKey);

/**
 * Work out what the shield should do now. Pure: returns the new streakShield (or null when
 * nothing changes) plus which week was covered or uncovered.
 *
 * @param {Object} p
 *   activities     all activities
 *   ctx            weekContext (goals, goalHistory, winningRuleFrom, stepsByDate, stepsTracked)
 *   streakShield   the stored streakShield
 *   vacationWeeks  {string[]}
 *   injuryFrozenWeeks {Object}
 *   today          {Date}
 * @returns {{ shield: Object|null, applied: string|null, revoked: string|null }}
 */
export function planAutoShield({ activities, ctx, streakShield = {}, vacationWeeks = [], injuryFrozenWeeks = {}, today = new Date() }) {
  const currentWeek = weekKeyFromDate(today);
  const s = {
    ...streakShield,
    shieldedWeeks: [...(streakShield.shieldedWeeks || [])],
    autoWeeks: [...(streakShield.autoWeeks || [])],
    lastUsedWeek: streakShield.lastUsedWeek ?? null,
  };
  let changed = false;
  let applied = null;
  let revoked = null;

  if (!s.autoFrom) {
    s.autoFrom = currentWeek;
    changed = true;
  }
  if (!s.holdFrom) {
    s.holdFrom = currentWeek;
    changed = true;
  }

  const judge = (weekKey) => judgeWeekFromActivities(activities, weekKey, ctx);
  const latestShielded = () => s.shieldedWeeks.reduce((max, w) => (!max || w > max ? w : max), null);
  const lookbackStart = addWeeks(currentWeek, -LOOKBACK_WEEKS);

  // A shield applied before a late workout import or HealthKit catch-up turned out to cover
  // a week the user actually won. Give it back, so the win counts.
  s.autoWeeks.filter((w) => w >= lookbackStart && judge(w).all).forEach((w) => {
    s.shieldedWeeks = s.shieldedWeeks.filter((x) => x !== w);
    s.autoWeeks = s.autoWeeks.filter((x) => x !== w);
    revoked = w;
    changed = true;
  });
  if (revoked) s.lastUsedWeek = latestShielded();

  // Closed weeks only, oldest first, never before the rule existed.
  let week = lookbackStart < s.autoFrom ? s.autoFrom : lookbackStart;
  for (; week < currentWeek; week = addWeeks(week, 1)) {
    if (s.shieldedWeeks.includes(week)) continue;
    if (vacationWeeks.includes(week) || injuryFrozenWeeks[week] !== undefined) continue;
    const judged = judge(week);
    if (week >= s.holdFrom) {
      if (!canHold(judged)) continue;
    } else {
      // The old rule: 70% with no per-goal floor, 4 weeks from any other old-rule shield.
      if (judged.all || judged.percent < SHIELD_MIN_PERCENT) continue;
      if (s.shieldedWeeks.some((w) => w < s.holdFrom && Math.abs(weeksBetween(w, week)) < LEGACY_COOLDOWN_WEEKS)) continue;
    }

    // Only when a streak was on the line. With `asOf` in this week the walk treats it as
    // in progress, so a goal it missed still shows the streak carried into it.
    const going = computeStreaks(activities, ctx.goals, {
      shieldedWeeks: s.shieldedWeeks,
      holdFrom: s.holdFrom,
      vacationWeeks,
      injuryFrozenWeeks,
      goalHistory: ctx.goalHistory,
      winningRuleFrom: ctx.winningRuleFrom,
      stepsByDate: ctx.stepsByDate,
      stepsTracked: ctx.stepsTracked,
      asOf: weekDate(week),
    }).current;
    const atRisk = going.master > 0
      || ['lifts', 'cardio', 'recovery', 'steps'].some((c) => !judged[c] && (going[c] || 0) > 0);
    if (!atRisk) continue;

    s.shieldedWeeks.push(week);
    s.autoWeeks = [...s.autoWeeks, week].slice(-8);
    s.lastUsedWeek = latestShielded();
    applied = week;
    changed = true;
  }

  return { shield: changed ? s : null, applied, revoked };
}
