// Distance + pace unit helpers.
//
// Canonical storage: every activity's `distance` field is in MILES, and every
// pace is in SECONDS PER MILE. Display in the user's preferred unit happens at
// the edge. New code shouldn't store km — convert with displayToMiles() before
// writing.

const KM_PER_MILE = 1.60934;

export function resolveUnit(userProfile) {
  return userProfile?.distanceUnit === 'km' ? 'km' : 'mi';
}

export function unitLabel(unit) {
  return unit === 'km' ? 'km' : 'mi';
}

export function paceLabel(unit) {
  return unit === 'km' ? '/km' : '/mi';
}

// miles → user-unit value (numeric, unrounded).
export function milesToDisplay(miles, unit) {
  const n = parseFloat(miles);
  if (!Number.isFinite(n)) return 0;
  return unit === 'km' ? n * KM_PER_MILE : n;
}

// user-unit value → miles for storage.
export function displayToMiles(value, unit) {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return 0;
  return unit === 'km' ? n / KM_PER_MILE : n;
}

// "2.4" — value only, no unit suffix.
export function formatDistanceValue(miles, unit, decimals = 2) {
  return milesToDisplay(miles, unit).toFixed(decimals);
}

// "2.4 mi" / "3.9 km"
export function formatDistance(miles, unit, decimals = 2) {
  return `${formatDistanceValue(miles, unit, decimals)} ${unitLabel(unit)}`;
}

// Pace formatter. Input is always seconds-per-MILE (canonical). Returns
// "8:32/mi" or "5:18/km". Pass withSuffix:false for just "8:32".
export function formatPace(secondsPerMile, unit, { withSuffix = true } = {}) {
  if (!Number.isFinite(secondsPerMile) || secondsPerMile <= 0) {
    return withSuffix ? `--:--${paceLabel(unit)}` : '--:--';
  }
  const sec = unit === 'km' ? secondsPerMile / KM_PER_MILE : secondsPerMile;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec - m * 60);
  const mm = m;
  const ss = s.toString().padStart(2, '0');
  return withSuffix ? `${mm}:${ss}${paceLabel(unit)}` : `${mm}:${ss}`;
}

// Convenience: build a pace string from duration (minutes) + miles. Useful for
// inline activity rows that don't carry a pre-computed pace.
export function formatPaceFromMinutesAndMiles(durationMinutes, miles, unit) {
  const m = parseFloat(miles);
  const d = parseFloat(durationMinutes);
  if (!Number.isFinite(m) || !Number.isFinite(d) || m <= 0) {
    return `--:--${paceLabel(unit)}`;
  }
  const secondsPerMile = (d * 60) / m;
  return formatPace(secondsPerMile, unit);
}
