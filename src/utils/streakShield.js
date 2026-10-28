// The Streak Shield is earned, not spent. It covers a week that ends short only when the
// user got to at least 70% of it — the same Week Progress number Home shows (judgeWeek's
// `percent`: the average of the Winning Streak goals, each capped at 100%). A zero week
// can't be shielded.
//
// Nobody switches it on. When a week closes short but at 70%+, the shield is used on it
// automatically, as long as one is available (a rolling 4-week cooldown from the last
// shielded week) and a streak was actually on the line. It used to be a manual button
// with a 6-week cooldown, which made it an easy way to keep a streak through a week of
// doing nothing.
//
// Stored on the profile as streakShield:
//   shieldedWeeks  {string[]} every week a shield covered (manual ones from before included)
//   lastUsedWeek   {string}   the most recent shielded week; the cooldown runs from it
//   prevUsedWeek   {string}   the one before it, restored if the latest is revoked
//   autoWeeks      {string[]} weeks the shield was applied to automatically
//   autoFrom       {string}   first week judged by this rule (set once, like winningRuleFrom),
//                             so weeks before the rule existed are never re-judged
//   noticeSeenWeek {string}   the auto-shielded week whose "saved" notice was dismissed

import { computeStreaks, weekKeyFromDate } from './streaks';
import { judgeWeekFromActivities } from './weekGoals';

export const SHIELD_COOLDOWN_WEEKS = 4;
export const SHIELD_MIN_PERCENT = 70;
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

/** Weeks left before a shield can cover `weekKey` (0 = available). */
export const shieldCooldownLeft = (lastUsedWeek, weekKey) => {
  if (!lastUsedWeek || lastUsedWeek === weekKey) return 0;
  const since = weeksBetween(lastUsedWeek, weekKey);
  return since >= SHIELD_COOLDOWN_WEEKS || since < 0 ? 0 : SHIELD_COOLDOWN_WEEKS - since;
};

/** The first week a shield can cover again after `lastUsedWeek`. */
export const nextShieldWeek = (lastUsedWeek) => (lastUsedWeek ? addWeeks(lastUsedWeek, SHIELD_COOLDOWN_WEEKS) : null);

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
    prevUsedWeek: streakShield.prevUsedWeek ?? null,
  };
  let changed = false;
  let applied = null;
  let revoked = null;

  if (!s.autoFrom) {
    s.autoFrom = currentWeek;
    changed = true;
  }

  const judge = (weekKey) => judgeWeekFromActivities(activities, weekKey, ctx);

  // A shield applied before a late workout import or HealthKit catch-up turned out to cover
  // a week the user actually won. Give it back.
  const last = s.lastUsedWeek;
  if (last && s.autoWeeks.includes(last) && judge(last).all) {
    s.shieldedWeeks = s.shieldedWeeks.filter((w) => w !== last);
    s.autoWeeks = s.autoWeeks.filter((w) => w !== last);
    s.lastUsedWeek = s.prevUsedWeek ?? null;
    s.prevUsedWeek = null;
    revoked = last;
    changed = true;
  }

  // Closed weeks only, oldest first, never before the rule existed.
  let week = addWeeks(currentWeek, -LOOKBACK_WEEKS);
  if (week < s.autoFrom) week = s.autoFrom;
  for (; week < currentWeek; week = addWeeks(week, 1)) {
    if (s.shieldedWeeks.includes(week)) continue;
    if (vacationWeeks.includes(week) || injuryFrozenWeeks[week] !== undefined) continue;
    // 4 weeks from every shielded week, in both directions. Checking only forward from
    // lastUsedWeek let a re-run shield an older week the cooldown had skipped, once a
    // newer one had moved lastUsedWeek past it.
    if (s.shieldedWeeks.some((w) => Math.abs(weeksBetween(w, week)) < SHIELD_COOLDOWN_WEEKS)) continue;
    const judged = judge(week);
    if (judged.all || judged.percent < SHIELD_MIN_PERCENT) continue;

    // Only spend it when a streak was on the line. With `asOf` in this week the walk treats
    // it as in progress, so a goal it missed still shows the streak carried into it.
    const going = computeStreaks(activities, ctx.goals, {
      shieldedWeeks: s.shieldedWeeks,
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

    // lastUsedWeek anchors the cooldown and only ever moves forward.
    if (!s.lastUsedWeek || week > s.lastUsedWeek) {
      s.prevUsedWeek = s.lastUsedWeek;
      s.lastUsedWeek = week;
    }
    s.shieldedWeeks.push(week);
    s.autoWeeks = [...s.autoWeeks, week].slice(-8);
    applied = week;
    changed = true;
  }

  return { shield: changed ? s : null, applied, revoked };
}
