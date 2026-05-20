// Goals are Sunday-only to keep streaks honest. Non-Sunday edits queue into
// `pendingGoals` on the user doc and auto-apply the next Sunday. If the user
// misses Sunday entirely, the apply-when-due check on app load catches up.

const toLocalDateStr = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const isSundayToday = () => new Date().getDay() === 0;

export const todayLocalDateStr = () => toLocalDateStr(new Date());

// 'YYYY-MM-DD' for the next Sunday after `from`. If `from` is a Sunday, returns
// the Sunday a week out — but the queue path is never entered on Sunday (those
// edits apply immediately), so that branch is effectively dead.
export const nextSundayDateStr = (from = new Date()) => {
  const d = new Date(from);
  const dow = d.getDay();
  const daysUntil = dow === 0 ? 7 : 7 - dow;
  d.setDate(d.getDate() + daysUntil);
  return toLocalDateStr(d);
};

export const isPendingDue = (pending) => {
  if (!pending?.applyOn) return false;
  return todayLocalDateStr() >= pending.applyOn;
};

// "Sun Mar 24" — used in the pending pill so the user knows when the change lands.
export const formatApplyOn = (applyOn) => {
  if (!applyOn) return '';
  // applyOn is YYYY-MM-DD local; parsing with explicit components avoids UTC drift.
  const [y, m, d] = applyOn.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
};
