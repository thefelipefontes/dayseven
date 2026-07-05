/**
 * Pure helpers for plan-aware daily reminders. Kept separate from index.js so
 * they can be unit-tested without initializing Firebase Admin.
 *
 * The weekly plan lives at users/{uid}.weeklyPlan:
 *   { repeatWeekly, template: {sun..sat: Pill[]}, weeks: { [sundayKey]: {sun..sat: Pill[]} } }
 * A Pill is { cat, type } where cat is 'strength'|'cardio'|'recovery' and type
 * is an optional specific string. Legacy plans stored pills as bare category
 * strings; normPill upgrades those transparently.
 */

const PLAN_DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const PLAN_CAT_DISPLAY = {
  strength: { emoji: '💪', label: 'Strength' },
  cardio: { emoji: '❤️‍🔥', label: 'Cardio' },
  recovery: { emoji: '🧊', label: 'Recovery' },
};

// Friendlier phrasing for a pill's specific type in notification copy.
const TYPE_LABEL = {
  'Full Body': 'Full body', Upper: 'Upper body', Lower: 'Lower body', Push: 'Push', Pull: 'Pull', Core: 'Core',
  Running: 'Run', Cycling: 'Ride', Swimming: 'Swim', Rowing: 'Row', Walking: 'Walk',
  'Stair Climbing': 'Stair session', Elliptical: 'Elliptical', Sports: 'Sport',
  Yoga: 'Yoga', Pilates: 'Pilates', 'Cold Plunge': 'Cold plunge', Sauna: 'Sauna',
  'Contrast Therapy': 'Contrast session', Massage: 'Massage',
};

// Upgrade a stored entry (bare string OR {cat,type}) to { cat, type }, or null.
function normPill(raw) {
  if (typeof raw === 'string') return PLAN_CAT_DISPLAY[raw] ? { cat: raw, type: null } : null;
  if (raw && typeof raw === 'object' && PLAN_CAT_DISPLAY[raw.cat]) {
    return { cat: raw.cat, type: typeof raw.type === 'string' ? raw.type : null };
  }
  return null;
}

/**
 * Resolve the pills the user planned for *today*.
 * @returns {Array<{cat,type}>|null} pills (empty array = planned rest day),
 *          or null if there's no plan covering this week.
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
  return Array.isArray(arr) ? arr.map(normPill).filter(Boolean) : [];
}

/**
 * Build notification copy for the sessions still unfinished today, counting
 * multiples of a category (e.g. two cardio → "2 Cardio sessions", or the two
 * distinct types if both are set).
 * @param {Object} byCat      { strength: (type|null)[], cardio: [...], recovery: [...] }
 * @param {Object} doneToday  { strength, cardio, recovery } — logged counts today
 * @returns {{title,body}|null} null if nothing is unfinished
 */
function buildPlannedReminderMessage(byCat, doneToday = {}) {
  const order = ['strength', 'cardio', 'recovery'];
  const label = (t) => (t ? (TYPE_LABEL[t] || t) : null);
  const segments = [];
  let totalUnmet = 0;

  for (const c of order) {
    const types = byCat[c] || [];
    const planned = types.length;
    const done = doneToday[c] || 0;
    const unmet = Math.max(0, planned - done);
    if (unmet === 0) continue;
    totalUnmet += unmet;
    const { emoji, label: catLabel } = PLAN_CAT_DISPLAY[c];

    if (unmet === 1) {
      // Use the type only when there's a single planned session (otherwise we
      // can't tell which of several was already done).
      const t = planned === 1 ? label(types[0]) : null;
      segments.push(`${emoji} ${t || catLabel}`);
    } else if (done === 0 && types.every((t) => t)) {
      // None done yet and every session is typed → list each distinct session.
      types.forEach((t) => segments.push(`${emoji} ${label(t)}`));
    } else {
      // Multiple unfinished but ambiguous/untyped → convey the count.
      segments.push(`${unmet} ${emoji} ${catLabel} sessions`);
    }
  }

  if (segments.length === 0) return null;
  const list = segments.length === 1
    ? segments[0]
    : segments.slice(0, -1).join(', ') + ' and ' + segments[segments.length - 1];
  const body = totalUnmet === 1
    ? `Time for your ${list} today.`
    : `You've got ${list} on the schedule today.`;
  return { title: "Today's Plan", body };
}

module.exports = {
  PLAN_DAY_KEYS,
  PLAN_CAT_DISPLAY,
  TYPE_LABEL,
  getPlannedCategoriesForToday,
  buildPlannedReminderMessage,
};
