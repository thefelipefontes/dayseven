// Active-calorie accounting.
//
// HealthKit's daily active-energy total already contains everything a wearable
// recorded: the Apple Watch (or Whoop, Oura, etc.) writes activeEnergyBurned
// samples all day, workouts included. We deliberately never write calories back
// to HealthKit (see saveWorkoutToHealthKit / endLiveWorkout in the native
// plugin), so a calorie number the user typed in by hand is invisible to that
// total — it exists only on our activity document.
//
// So a day's real active burn is:
//
//   HealthKit active energy  +  calories the user entered that HealthKit
//                               doesn't already know about
//
// The second term is what these helpers compute. An activity contributes only
// the part of its calorie count that didn't come out of HealthKit:
//
//   * hkCalories — stamped at save time with whatever HealthKit reported for
//     that workout (a linked workout's total, a live session's accumulated
//     energy, the watch's final count). Anything above it was typed by the
//     user, so only the difference is extra.
//   * Activities saved before hkCalories existed fall back to their HealthKit
//     association: if the activity is linked to, imported from, or was recorded
//     into a HealthKit workout, we assume HealthKit already has its energy and
//     add nothing. Conservative on purpose — under-counting an old entry beats
//     double-counting it.

function toNumber(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

// True when the activity has a HealthKit workout behind it, meaning the
// wearable that recorded it also wrote the day's active-energy samples.
export function isHealthKitBacked(activity) {
  return !!(activity?.linkedHealthKitUUID || activity?.healthKitUUID || activity?.fromAppleHealth);
}

// Calories on this activity that HealthKit's daily total does NOT already include.
export function manualCaloriesForActivity(activity) {
  const total = toNumber(activity?.calories);
  if (total <= 0) return 0;

  const alreadyInHealthKit = activity?.hkCalories != null
    ? toNumber(activity.hkCalories)
    : (isHealthKitBacked(activity) ? total : 0);

  return Math.max(0, total - alreadyInHealthKit);
}

// Sum of the above across every activity on a given YYYY-MM-DD date.
export function manualCaloriesForDate(activities, dateStr) {
  if (!Array.isArray(activities) || !dateStr) return 0;
  return activities.reduce(
    (sum, a) => (a?.date === dateStr ? sum + manualCaloriesForActivity(a) : sum),
    0
  );
}

// Same, across an inclusive YYYY-MM-DD range (ISO dates compare lexically).
export function manualCaloriesInRange(activities, startStr, endStr) {
  if (!Array.isArray(activities) || !startStr || !endStr) return 0;
  return activities.reduce((sum, a) => {
    if (!a?.date || a.date < startStr || a.date > endStr) return sum;
    return sum + manualCaloriesForActivity(a);
  }, 0);
}

// A day's active calories as the app should display them.
export function dayActiveCalories(healthData, activities, dateStr) {
  return toNumber(healthData?.calories) + manualCaloriesForDate(activities, dateStr);
}

// True when an activity predates the hkCalories stamp and is being zeroed by the
// fallback above — i.e. it has a HealthKit workout attached and a calorie count we
// are currently assuming HealthKit holds. These are the ones worth asking HealthKit
// about directly; activities with no HealthKit association already count in full.
export function needsHkCaloriesBackfill(activity) {
  return activity?.hkCalories == null
    && toNumber(activity?.calories) > 0
    && isHealthKitBacked(activity);
}

function parseClockTime(dateStr, timeStr) {
  if (!dateStr) return null;
  const match = /(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(timeStr || '');
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === 'PM' && hour !== 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d, hour, minute, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

// The wall-clock window an activity occupied, for asking HealthKit what active
// energy it holds over exactly that span.
//
// The end is always derived from the recorded duration rather than the activity's
// endTime field: endTime is stamped when the user hits save, which for a workout
// logged hours after the fact would stretch the window across an unrelated chunk
// of the day and over-credit HealthKit.
export function activityTimeRange(activity) {
  if (!activity) return null;

  const seconds = toNumber(activity.duration) * 60 + toNumber(activity.durationSeconds);

  // A linked workout's HealthKit start date is the most precise anchor we have —
  // it's the real workout's start, not when the user opened the app.
  const anchors = [
    activity.linkedHealthKitStartDate,
    activity.healthKitStartDate,
    activity.startTime,
  ];
  let start = null;
  for (const anchor of anchors) {
    if (!anchor) continue;
    const parsed = new Date(anchor);
    if (!Number.isNaN(parsed.getTime())) { start = parsed; break; }
  }
  if (!start) start = parseClockTime(activity.date, activity.time);
  if (!start) return null;

  if (seconds > 0) {
    return { start: start.toISOString(), end: new Date(start.getTime() + seconds * 1000).toISOString() };
  }

  // No duration recorded — fall back to endTime, then to a one-hour window.
  const end = activity.endTime ? new Date(activity.endTime) : null;
  if (end && !Number.isNaN(end.getTime()) && end > start) {
    return { start: start.toISOString(), end: end.toISOString() };
  }
  return { start: start.toISOString(), end: new Date(start.getTime() + 3600 * 1000).toISOString() };
}
