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
 * Build notification copy for the unfinished categories today. `typeByCat`
 * maps a category to a representative planned type (if any) so the copy can
 * say "your run" instead of "your cardio".
 * @param {string[]} unmet          ordered category ids
 * @param {Object} [typeByCat]      { cat: type }
 */
function buildPlannedReminderMessage(unmet, typeByCat = {}) {
  const labelFor = (c) => {
    const t = typeByCat[c];
    return t ? (TYPE_LABEL[t] || t) : PLAN_CAT_DISPLAY[c].label;
  };
  const parts = unmet.map((c) => `${PLAN_CAT_DISPLAY[c].emoji} ${labelFor(c)}`);
  if (parts.length === 1) {
    return { title: "Today's Plan", body: `Time for your ${parts[0]} today.` };
  }
  const list = parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
  return { title: "Today's Plan", body: `You've got ${list} on the schedule today.` };
}

module.exports = {
  PLAN_DAY_KEYS,
  PLAN_CAT_DISPLAY,
  TYPE_LABEL,
  getPlannedCategoriesForToday,
  buildPlannedReminderMessage,
};
