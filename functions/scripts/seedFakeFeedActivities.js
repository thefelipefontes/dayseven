#!/usr/bin/env node
/**
 * One-off: seed fake activities into Bob's user doc + completed challenges that point to them,
 * so the admin's friends feed shows the "Completed [sender]'s challenge" badge in context.
 *
 * Two flavors:
 *  1. Bob completes a challenge YOU sent  → badge reads "Completed your challenge"
 *  2. Bob completes a challenge from JESSICA → badge reads "Completed Jessica Devous's challenge"
 *
 * Auth: ADC (run `gcloud auth application-default login` once if expired).
 *
 * Usage:
 *   node functions/scripts/seedFakeFeedActivities.js
 *
 * Cleanup:
 *   node functions/scripts/seedFakeFeedActivities.js --delete
 */

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'dayseven-f1a89' });
const db = admin.firestore();

const ADMIN_UID = 'TvQwWbwNFQe7lDzhPOo15EopEOA3'; // felipefontes@felipefontes.com
const BOB_UID = '43roQoNMxdVXBQY1nBr68ey2bPz2';
const JESSICA_UID = '0dEy2rpFhBVQUNrDI9vfke63WKc2';

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const niceTime = (mins) => {
  const d = new Date(Date.now() - mins * 60 * 1000);
  let hr = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = hr >= 12 ? 'PM' : 'AM';
  hr = hr % 12 || 12;
  return `${hr}:${m} ${ampm}`;
};

async function getUserName(uid) {
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) return 'Friend';
  const d = snap.data();
  return d.displayName || d.username || 'Friend';
}

function buildCompletedChallenge({ challengerUid, challengerName, accepterUid, fulfillingActivityId, type, category, distanceMin, durationMin, paceMaxSecondsPerMile, requirePhoto, title, originatingActivity }) {
  const now = new Date();
  const completedAt = new Date(now.getTime() - 30 * 60 * 1000); // ~30 min ago
  const acceptedAt = new Date(now.getTime() - 90 * 60 * 1000);
  const challengeId = `${challengerUid}_${accepterUid}_seedfeed_${now.getTime()}_${Math.random().toString(36).slice(2, 6)}`;

  const matchRule = { category };
  if (type && ['Running', 'Cycle', 'Swimming', 'Rowing', 'Hiking'].includes(type)) {
    matchRule.activityType = type;
  }
  if (distanceMin) matchRule.distanceMin = distanceMin;
  if (durationMin) matchRule.durationMin = durationMin;
  if (paceMaxSecondsPerMile) matchRule.paceMaxSecondsPerMile = paceMaxSecondsPerMile;

  return {
    id: challengeId,
    type: '1v1',
    mode: 'all_complete',
    challengerUid,
    challengerName: challengerName || '',
    title: title || '',
    participantUids: [challengerUid, accepterUid],
    participants: {
      [accepterUid]: {
        status: 'completed',
        acceptedAt: acceptedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        fulfillingActivityId: String(fulfillingActivityId),
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      },
    },
    challengerActivity: originatingActivity,
    matchRule,
    windowHours: 24,
    requirePhoto: !!requirePhoto,
    createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    respondByAt: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    completedAt: completedAt.toISOString(),
    // Legacy 1v1 mirror
    friendUid: accepterUid,
    friendStatus: 'completed',
    fulfillingActivityId: String(fulfillingActivityId),
    status: 'completed',
    winnerUids: [accepterUid],
    _seed: true,
  };
}

async function seed() {
  const [adminName, jessicaName] = await Promise.all([
    getUserName(ADMIN_UID),
    getUserName(JESSICA_UID),
  ]);

  // Read Bob's existing activities so we append (don't clobber).
  const bobRef = db.collection('users').doc(BOB_UID);
  const bobSnap = await bobRef.get();
  if (!bobSnap.exists) {
    console.error(`[seed] Bob (${BOB_UID}) not found`);
    process.exit(1);
  }
  const existingActivities = Array.isArray(bobSnap.data()?.activities) ? bobSnap.data().activities : [];

  const nowMs = Date.now();
  const runActivity = {
    id: nowMs, // numeric IDs match the app's Date.now() pattern
    type: 'Running',
    subtype: 'Outdoor',
    duration: 42,
    distance: 5.4,
    calories: 510,
    countToward: 'cardio',
    date: todayStr(),
    time: niceTime(45),
    photoURL: null,
    _seed: true,
  };
  const saunaActivity = {
    id: nowMs + 1,
    type: 'Sauna',
    duration: 18,
    calories: 60,
    countToward: 'recovery',
    date: todayStr(),
    time: niceTime(120),
    // Photo-required challenge → must have photoURL for the cloud-function check, but for the
    // pre-completed seed we just need fulfillingActivityId on the challenge to wire the badge.
    photoURL: null,
    _seed: true,
  };

  // Append + write back.
  const updatedActivities = [...existingActivities, runActivity, saunaActivity];
  await bobRef.set({ activities: updatedActivities }, { merge: true });
  console.log(`[seed] appended 2 fake activities to Bob (${BOB_UID}). Total now: ${updatedActivities.length}`);

  // Two completed challenges, one from each sender.
  const challenges = [
    buildCompletedChallenge({
      challengerUid: ADMIN_UID,
      challengerName: adminName,
      accepterUid: BOB_UID,
      fulfillingActivityId: runActivity.id,
      type: 'Running',
      category: 'cardio',
      distanceMin: 5,
      title: 'Saturday miles',
      originatingActivity: {
        activityId: `seedfeed_origin_${nowMs}_a`,
        type: 'Running',
        subtype: 'Outdoor',
        duration: 39,
        distance: 5.0,
        calories: 470,
        countToward: 'cardio',
        date: todayStr(),
      },
    }),
    buildCompletedChallenge({
      challengerUid: JESSICA_UID,
      challengerName: jessicaName,
      accepterUid: BOB_UID,
      fulfillingActivityId: saunaActivity.id,
      type: 'Sauna',
      category: 'recovery',
      durationMin: 15,
      requirePhoto: false,
      originatingActivity: {
        activityId: `seedfeed_origin_${nowMs}_b`,
        type: 'Sauna',
        duration: 15,
        calories: 50,
        countToward: 'recovery',
        date: todayStr(),
      },
    }),
  ];

  const batch = db.batch();
  for (const c of challenges) {
    batch.set(db.collection('challenges').doc(c.id), c);
    console.log(`[seed] writing challenge ${c.id} — ${c.challengerName} → Bob (${describe(c.matchRule)})`);
  }
  await batch.commit();
  console.log('[seed] done. Pull-to-refresh the friends feed; the two new cards should carry the "Completed ..." badge.');
}

function describe(rule) {
  if (rule.distanceMin) return `${rule.distanceMin} mi`;
  if (rule.durationMin) return `${rule.durationMin} min`;
  if (rule.paceMaxSecondsPerMile) return `pace ${rule.paceMaxSecondsPerMile}s/mi`;
  return rule.category;
}

async function cleanup() {
  // Delete seeded challenges first.
  const challengesSnap = await db.collection('challenges').where('_seed', '==', true).get();
  let deletedChallenges = 0;
  if (!challengesSnap.empty) {
    const batch = db.batch();
    for (const doc of challengesSnap.docs) batch.delete(doc.ref);
    await batch.commit();
    deletedChallenges = challengesSnap.size;
  }
  console.log(`[seed] deleted ${deletedChallenges} seeded challenges`);

  // Strip _seed activities from Bob's array.
  const bobRef = db.collection('users').doc(BOB_UID);
  const bobSnap = await bobRef.get();
  if (bobSnap.exists) {
    const existing = Array.isArray(bobSnap.data()?.activities) ? bobSnap.data().activities : [];
    const cleaned = existing.filter(a => !a._seed);
    if (cleaned.length !== existing.length) {
      await bobRef.set({ activities: cleaned }, { merge: true });
      console.log(`[seed] removed ${existing.length - cleaned.length} seeded activities from Bob`);
    } else {
      console.log('[seed] no seeded activities to remove from Bob');
    }
  }
}

(async () => {
  try {
    if (process.argv.includes('--delete')) {
      await cleanup();
    } else {
      await seed();
    }
    process.exit(0);
  } catch (e) {
    console.error('[seed] failed:', e);
    process.exit(1);
  }
})();
