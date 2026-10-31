/**
 * The week rule the app judges by: a port of src/utils/weekGoals.js and of canHold in
 * src/utils/streakShield.js. Keep them in sync. Free of Firestore so it can be unit-tested
 * (firestore-tests/weekRule.test.js); judgeUserWeek in index.js feeds it a user's data.
 *
 * Weeks are Sunday-start, keyed 'YYYY-MM-DD'.
 */

// initialUserData.goals in the app: what a user who never set a goal is judged against.
const DEFAULT_GOALS = { liftsPerWeek: 4, cardioPerWeek: 3, recoveryPerWeek: 2, stepsPerDay: 10000 };

// The Streak Shield's floor: a week that ends at 70%, with every goal at least halfway, holds.
const SHIELD_MIN_PERCENT = 70;

const addDays = (dateStr, days) => {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
};

/** Sunday-start week key for a 'YYYY-MM-DD' date. */
const weekKeyOf = (dateStr) => addDays(dateStr, -new Date(`${dateStr}T12:00:00Z`).getUTCDay());

/** Goals in the { lifts, cardio, recovery, stepsPerDay } shape used below. */
const normalizeGoals = (goals) => ({
  lifts: goals?.liftsPerWeek ?? DEFAULT_GOALS.liftsPerWeek,
  cardio: goals?.cardioPerWeek ?? DEFAULT_GOALS.cardioPerWeek,
  recovery: goals?.recoveryPerWeek ?? DEFAULT_GOALS.recoveryPerWeek,
  stepsPerDay: goals?.stepsPerDay ?? DEFAULT_GOALS.stepsPerDay,
});

// A stored goals entry (goalHistory, pendingGoals) over `fallback`, field by field. Entries
// written before a field existed hold null for it.
const overlay = (entry, fallback) => ({
  lifts: entry.liftsPerWeek ?? fallback.lifts,
  cardio: entry.cardioPerWeek ?? fallback.cardio,
  recovery: entry.recoveryPerWeek ?? fallback.recovery,
  stepsPerDay: entry.stepsPerDay ?? fallback.stepsPerDay,
});

/**
 * Returns weekKey → the goals in force that week.
 *
 * goalHistory's newest entry at or before the week wins; weeks before any recorded change
 * fall back to current goals. Goals are edited on Sundays only: an edit made on another day
 * is queued in `pendingGoals` and applies from the Sunday `applyOn`, but the app only moves
 * it into `goals` and goalHistory when it next opens. Until then the queued goals are the
 * ones the user sees for that week, so they win from that week on.
 */
function weekGoalsResolver(goals, goalHistory = [], pendingGoals = null) {
  const current = normalizeGoals(goals);
  const history = (Array.isArray(goalHistory) ? goalHistory : [])
    .filter((h) => h && h.fromWeek)
    .sort((a, b) => a.fromWeek.localeCompare(b.fromWeek));
  const pendingFrom = pendingGoals?.applyOn ? weekKeyOf(pendingGoals.applyOn) : null;

  return (weekKey) => {
    if (pendingFrom && weekKey >= pendingFrom) return overlay(pendingGoals, current);
    let chosen = null;
    for (const h of history) {
      if (h.fromWeek > weekKey) break;
      chosen = h;
    }
    return chosen ? overlay(chosen, current) : current;
  };
}

/** Does this week use the steps rule (from the user's `winningRuleFrom` week)? */
const usesStepsRule = (weekKey, winningRuleFrom) => !!winningRuleFrom && weekKey >= winningRuleFrom;

/**
 * The categories the Winning Streak needs in a given week: Strength + Cardio + Recovery
 * before the user's rule start, Strength + Cardio + weekly Steps from it, and Strength +
 * Cardio only for a user with no step data (no Apple Health access).
 */
function winningCategories(weekKey, { winningRuleFrom = null, stepsTracked = true } = {}) {
  if (!usesStepsRule(weekKey, winningRuleFrom)) return ['lifts', 'cardio', 'recovery'];
  return stepsTracked === false ? ['lifts', 'cardio'] : ['lifts', 'cardio', 'steps'];
}

/**
 * Judge one week: which goals are met, and whether it counts toward the Winning Streak.
 * Same result as the app's judgeWeek:
 *   all      every required goal met (a won week)
 *   percent  0–100, the average completion of the required goals, each capped at its goal
 *   missing  how far short each goal is; toHalf how far short of halfway (half rounded up)
 */
function judgeWeek(counts, weekGoals, { weekSteps = 0, required = ['lifts', 'cardio', 'recovery'] } = {}) {
  const stepsGoal = (weekGoals.stepsPerDay ?? DEFAULT_GOALS.stepsPerDay) * 7;
  const done = { lifts: counts?.lifts || 0, cardio: counts?.cardio || 0, recovery: counts?.recovery || 0, steps: weekSteps };
  const goal = { lifts: weekGoals.lifts, cardio: weekGoals.cardio, recovery: weekGoals.recovery, steps: stepsGoal };
  const met = {
    lifts: done.lifts >= goal.lifts,
    cardio: done.cardio >= goal.cardio,
    // A recovery goal of 0 means Recovery is off: never "met".
    recovery: goal.recovery > 0 && done.recovery >= goal.recovery,
    steps: done.steps >= goal.steps,
  };
  const part = (c) => (goal[c] > 0 ? Math.min(done[c] / goal[c], 1) : 1);
  const percent = required.length > 0
    ? Math.round((required.reduce((sum, c) => sum + part(c), 0) / required.length) * 100)
    : 0;
  const missing = Object.fromEntries(Object.keys(goal).map((c) => [c, Math.max(0, (goal[c] || 0) - done[c])]));
  const toHalf = Object.fromEntries(Object.keys(goal).map((c) => [c, Math.max(0, Math.ceil((goal[c] || 0) / 2) - done[c])]));
  return { ...met, all: required.every((c) => met[c]), required, percent, missing, toHalf };
}

/** Does a judged week hold the streak (Streak Shield)? A won week doesn't need to. */
const canHold = (judged) => !judged.all && judged.percent >= SHIELD_MIN_PERCENT
  && judged.required.every((c) => (judged.toHalf?.[c] ?? 0) === 0);

module.exports = {
  DEFAULT_GOALS, addDays, weekKeyOf, normalizeGoals, weekGoalsResolver, usesStepsRule,
  winningCategories, judgeWeek, canHold,
};
