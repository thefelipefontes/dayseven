#!/usr/bin/env node
/**
 * Seed mock auto-logged activities into felipefontes's user doc so the new
 * auto-log surfaces (incomplete-strength banner + activity-detail provenance)
 * are visible without waiting on a real Apple Health sync.
 *
 * Cases covered:
 *   - 1 strength workout with needsDetails: true   → home banner ("Add muscle groups…")
 *   - 1 more strength with needsDetails: true      → banner switches to "2 strength workouts need details"
 *   - 1 auto-logged cardio (Running)               → just appears in Today's Activity with Synced-from-Apple-Health
 *   - 1 auto-logged recovery (Yoga)                → same as cardio, no banner
 *
 * Tap any of these in the app → ActivityDetailModal opens. The two strength
 * entries also drive the banner — tap the banner to see the deep-link path.
 *
 * Auth: ADC (`gcloud auth application-default login` if expired).
 *
 * Usage:
 *   node functions/scripts/seedAutoLogMocks.js          # add mocks
 *   node functions/scripts/seedAutoLogMocks.js --delete # remove them
 */

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'dayseven-f1a89' });
const db = admin.firestore();

const ADMIN_UID = 'TvQwWbwNFQe7lDzhPOo15EopEOA3'; // felipefontes
const MARKER = '__seedAutoLogMock';

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const niceTime = (minsAgo) => {
  const d = new Date(Date.now() - minsAgo * 60 * 1000);
  let hr = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = hr >= 12 ? 'PM' : 'AM';
  hr = hr % 12 || 12;
  return `${hr}:${m} ${ampm}`;
};

// Stable mock IDs so re-running this script overwrites instead of duplicating.
const MOCKS = [
  {
    id: 'mock_autolog_strength_1',
    type: 'Strength Training',
    subtype: 'Weightlifting',
    strengthType: 'Weightlifting',
    date: todayStr(),
    time: niceTime(45),
    duration: 52,
    calories: 318,
    avgHr: 128,
    maxHr: 152,
    autoLoggedFromHealthKit: true,
    needsDetails: true,
    source: 'healthkit',
    fromAppleHealth: true,
    sourceDevice: 'Apple Watch',
    [MARKER]: true,
  },
  {
    id: 'mock_autolog_strength_2',
    type: 'Strength Training',
    subtype: 'Bodyweight',
    strengthType: 'Bodyweight',
    date: todayStr(),
    time: niceTime(180),
    duration: 28,
    calories: 174,
    avgHr: 114,
    maxHr: 138,
    autoLoggedFromHealthKit: true,
    needsDetails: true,
    source: 'healthkit',
    fromAppleHealth: true,
    sourceDevice: 'Apple Watch',
    [MARKER]: true,
  },
  {
    id: 'mock_autolog_cardio_1',
    type: 'Running',
    subtype: 'Outdoor',
    date: todayStr(),
    time: niceTime(240),
    duration: 26,
    distance: 3.01,
    calories: 357,
    avgHr: 164,
    maxHr: 175,
    autoLoggedFromHealthKit: true,
    source: 'healthkit',
    fromAppleHealth: true,
    sourceDevice: 'Apple Watch',
    [MARKER]: true,
  },
  {
    id: 'mock_autolog_recovery_1',
    type: 'Yoga',
    date: todayStr(),
    time: niceTime(360),
    duration: 32,
    calories: 88,
    avgHr: 92,
    autoLoggedFromHealthKit: true,
    source: 'healthkit',
    fromAppleHealth: true,
    sourceDevice: 'iPhone',
    [MARKER]: true,
  },
];

async function run() {
  const deleteMode = process.argv.includes('--delete');
  const ref = db.collection('users').doc(ADMIN_UID);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error(`User doc not found: ${ADMIN_UID}`);
    process.exit(1);
  }
  const data = snap.data();
  const existing = Array.isArray(data.activities) ? data.activities : [];

  // Strip any prior mock entries so re-runs are idempotent.
  const pruned = existing.filter(a => !a?.[MARKER]);

  if (deleteMode) {
    if (pruned.length === existing.length) {
      console.log('No mock activities found — nothing to delete.');
      return;
    }
    await ref.set({ activities: pruned }, { merge: true });
    console.log(`Removed ${existing.length - pruned.length} mock activities.`);
    return;
  }

  const next = [...MOCKS, ...pruned];
  await ref.set({ activities: next }, { merge: true });
  console.log(`Seeded ${MOCKS.length} mock activities. Existing total: ${pruned.length} → ${next.length}.`);
  console.log('\nWhat to look for in the app:');
  console.log('  • Home: cyan banner "2 strength workouts need details" above the streak warning.');
  console.log('  • Tap banner → ActivityDetailModal opens on the most recent strength entry.');
  console.log('  • Today\'s Activity list: shows Running and Yoga entries (no banner — those are complete).');
  console.log('  • Tap any → "Synced from Apple Health · Apple Watch/iPhone" provenance row.');
  console.log('\nCleanup: node functions/scripts/seedAutoLogMocks.js --delete');
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
