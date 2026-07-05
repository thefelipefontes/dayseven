/**
 * Pure helpers for plan-aware daily reminders. Kept separate from index.js so
 * they can be unit-tested without initializing Firebase Admin.
 *
 * The weekly plan lives at users/{uid}.weeklyPlan:
 *   { repeatWeekly, template: {sun..sat: string[]}, weeks: { [sundayKey]: {sun..sat: string[]} } }
 * where each day array holds category ids: 'strength' | 'cardio' | 'recovery'.
 */

const PLAN_DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const PLAN_CAT_DISPLAY = {
  strength: { emoji: '💪', label: 'Strength' },
  cardio: { emoji: '❤️‍🔥', label: 'Cardio' },
  recovery: { emoji: '🧊', label: 'Recovery' },
};

/**
 * Resolve the categories the user planned for *today*.
 * @param {object|undefined} weeklyPlan  users/{uid}.weeklyPlan
 * @param {string} userToday             'YYYY-MM-DD' in the user's local tz
 * @param {number} dayOfWeek             0 (Sun) .. 6 (Sat), user's local day
 * @returns {string[]|null} category ids (empty array = planned rest day),
 *                          or null if there's no plan covering this week.
 */
function getPlannedCategoriesForToday(weeklyPlan, userToday, dayOfWeek) {
  if (!weeklyPlan) return null;
  // Derive this week's Sunday (the plan's week key) as a local calendar date.
  const [y, m, d] = userToday.split('-').map(Number);
  const sunday = new Date(Date.UTC(y, m - 1, d));
  sunday.setUTCDate(sunday.getUTCDate() - dayOfWeek);
  const pad = (n) => String(n).padStart(2, '0');
  const weekKey = `${sunday.getUTCFullYear()}-${pad(sunday.getUTCMonth() + 1)}-${pad(sunday.getUTCDate())}`;

  let week = weeklyPlan.weeks && weeklyPlan.weeks[weekKey];
  // Fall back to the recurring default only if the user opted into repeating it.
  if (!week && weeklyPlan.repeatWeekly && weeklyPlan.template) week = weeklyPlan.template;
  if (!week) return null;

  const arr = week[PLAN_DAY_KEYS[dayOfWeek]];
  return Array.isArray(arr) ? arr.filter((c) => PLAN_CAT_DISPLAY[c]) : [];
}

/**
 * Build notification copy for the planned categories still unfinished today.
 * @param {string[]} unmet  ordered category ids
 */
function buildPlannedReminderMessage(unmet) {
  const parts = unmet.map((c) => `${PLAN_CAT_DISPLAY[c].emoji} ${PLAN_CAT_DISPLAY[c].label}`);
  if (parts.length === 1) {
    return { title: "Today's Plan", body: `Time for your ${parts[0]} session today.` };
  }
  const list = parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
  return { title: "Today's Plan", body: `You've got ${list} on the schedule today.` };
}

module.exports = {
  PLAN_DAY_KEYS,
  PLAN_CAT_DISPLAY,
  getPlannedCategoriesForToday,
  buildPlannedReminderMessage,
};
