// Single source of truth for "which weekly goal does this activity count toward?"
//
// NOTE ON NAMING: the strength/lifting category has inconsistent naming across the
// codebase. The UI label says "Strength" and the activity type is "Strength Training",
// but the stored value is 'lifting' (matching the goal key 'liftsPerWeek'). Both
// 'lifting' and 'strength' are accepted on read for back-compat — always write 'lifting'.
//
// Keep this in sync with getActivityCategoryForGoals in functions/index.js. Before this
// module existed there were eight divergent copies of the type→category table scattered
// across App.jsx, Profile.jsx, TrendsView, WeekStatsModal and ActivityFeed; most of them
// were missing Rowing/Hiking/Dance and the named sports, so HealthKit-imported workouts
// of those types silently failed to fill the cardio ring.

// Team / competitive sports that count as cardio.
const TEAM_SPORTS = [
  'Basketball', 'Soccer', 'Football', 'Tennis', 'Golf', 'Badminton', 'Boxing', 'Martial Arts',
  'Baseball', 'Volleyball', 'Hockey', 'Lacrosse', 'Rugby', 'Softball', 'Squash', 'Table Tennis',
  'Racquetball', 'Handball', 'Pickleball', 'Cricket', 'Australian Football', 'Wrestling',
  'Fencing', 'Curling', 'Bowling',
];

// Individual cardio sports.
const INDIVIDUAL_CARDIO_SPORTS = [
  'Track & Field', 'Jump Rope', 'Downhill Skiing', 'Cross Country Skiing', 'Snowboarding',
  'Skating', 'Surfing', 'Water Polo', 'Paddle Sports',
];

const LIFTING_TYPES = ['Strength Training', 'Weightlifting', 'Bodyweight'];

// Machine / steady-state cardio. Rowing covers both indoor and outdoor: HealthKit has no
// distinct indoor-rowing activity type (indoor is metadata), so both land on 'Rowing'.
const CARDIO_TYPES = [
  'Running', 'Cycle', 'Sports', 'Stair Climbing', 'Elliptical', 'Rowing', 'Ski Trainer',
  'Swimming', 'Hiking', 'Dance',
];

const RECOVERY_TYPES = [
  'Pilates', 'Cold Plunge', 'Sauna', 'Contrast Therapy', 'Massage', 'Chiropractic',
  'Stretching', 'Foam Rolling', 'Tai Chi', 'Cooldown',
];

/**
 * Default "count toward" category for an activity type, used when the user hasn't
 * explicitly picked one. Returns 'lifting' | 'cardio' | 'recovery' | 'lifting+cardio'
 * | null (null = counts toward no goal, e.g. Walking).
 */
export const getDefaultCountToward = (type, sub) => {
  if (LIFTING_TYPES.includes(type)) return 'lifting';
  if (type === 'Circuit') return 'lifting+cardio';
  if (CARDIO_TYPES.includes(type)) return 'cardio';
  if (TEAM_SPORTS.includes(type)) return 'cardio';
  if (INDIVIDUAL_CARDIO_SPORTS.includes(type)) return 'cardio';
  if (type === 'Yoga') {
    if (['Power', 'Hot', 'Vinyasa'].includes(sub)) return 'cardio';
    return 'recovery';
  }
  if (RECOVERY_TYPES.includes(type)) return 'recovery';
  if (type === 'Walking') return null;
  return null;
};

/**
 * Effective goal category for a logged activity. Precedence:
 *   1. explicit countToward (what the user picked in "Counts Toward")
 *   2. customActivityCategory (for "Other"/uncategorized Apple Health types)
 *   3. the type-based default above
 * Returns 'lifting' | 'cardio' | 'recovery' | 'warmup' | 'lifting+cardio' | 'other'.
 * Callers must treat 'lifting+cardio' as counting toward BOTH goals.
 */
export const getActivityCategory = (activity) => {
  if (!activity) return 'other';
  if (activity.countToward) {
    if (activity.countToward === 'strength') return 'lifting';
    return activity.countToward;
  }
  if (activity.customActivityCategory) {
    if (activity.customActivityCategory === 'strength') return 'lifting';
    return activity.customActivityCategory;
  }
  return getDefaultCountToward(activity.type, activity.subtype || '') || 'other';
};

/** Does this activity fill a lifting slot? ('lifting+cardio' counts toward both.) */
export const countsAsLifting = (activity) => {
  const c = getActivityCategory(activity);
  return c === 'lifting' || c === 'lifting+cardio';
};

/** Does this activity fill a cardio slot? ('lifting+cardio' counts toward both.) */
export const countsAsCardio = (activity) => {
  const c = getActivityCategory(activity);
  return c === 'cardio' || c === 'lifting+cardio';
};

/** Does this activity fill a recovery slot? */
export const countsAsRecovery = (activity) => getActivityCategory(activity) === 'recovery';
