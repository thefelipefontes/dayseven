#!/usr/bin/env node
/**
 * One-off: seed a bunch of fake completed challenges for the admin user across both
 * perspectives (Sent + Received) with a mix of wins and losses, so the new sticky-header
 * + scrollable-cards layout on the Challenges tab can be exercised on a real device.
 *
 * Creates ~14 challenges total spread over the past few weeks, with realistic match rules
 * (running miles / sauna minutes / strength duration / etc).
 *
 * Auth: uses Application Default Credentials.
 *   gcloud auth application-default login
 *
 * Usage:
 *   node functions/scripts/seedFakeCompletedChallenges.js
 *
 * Cleanup later (removes ALL _seed: true challenges, including those from seedFakeChallenges.js):
 *   node functions/scripts/seedFakeCompletedChallenges.js --delete
 */

const admin = require('firebase-admin');

admin.initializeApp({ projectId: 'dayseven-f1a89' });
const db = admin.firestore();

const ADMIN_UID = 'TvQwWbwNFQe7lDzhPOo15EopEOA3'; // felipefontes@felipefontes.com (per memory)

async function getFriendsOf(uid) {
  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists) throw new Error(`User ${uid} not found`);
  const data = userDoc.data();

  if (Array.isArray(data.friends) && data.friends.length > 0 && typeof data.friends[0] === 'string') {
    return data.friends;
  }
  const subSnap = await db.collection('users').doc(uid).collection('friends').get();
  if (!subSnap.empty) return subSnap.docs.map(d => d.id);
  if (data.friends && typeof data.friends === 'object') return Object.keys(data.friends);
  return [];
}

async function getDisplayName(uid) {
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) return 'Friend';
  const d = snap.data();
  return d.displayName || d.username || 'Friend';
}

/**
 * Build a fully-resolved completed challenge doc.
 *
 * @param {object} cfg
 * @param {'sent'|'received'} cfg.perspective — admin is challenger (sent) or recipient (received)
 * @param {'won'|'lost'} cfg.outcome — for 'sent', whether the friend completed; for 'received', whether admin completed
 * @param {string} cfg.friendUid
 * @param {string} cfg.friendName
 * @param {object} cfg.matchRule — { category, activityType?, distanceMin?, durationMin?, paceMaxSecondsPerMile? }
 * @param {string} [cfg.title]
 * @param {boolean} [cfg.requirePhoto]
 * @param {number} cfg.daysAgo — how many days back to anchor createdAt/resolvedAt
 */
function buildCompletedChallenge(cfg) {
  const {
    perspective, outcome, friendUid, friendName,
    matchRule, title = '', requirePhoto = false, daysAgo,
  } = cfg;

  const challengerUid = perspective === 'sent' ? ADMIN_UID : friendUid;
  const recipientUid = perspective === 'sent' ? friendUid : ADMIN_UID;
  const challengerName = perspective === 'sent' ? '' : friendName;

  const createdAtDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const acceptedAtDate = new Date(createdAtDate.getTime() + 30 * 60 * 1000); // accepted 30min later
  const expiresAtDate = new Date(acceptedAtDate.getTime() + 24 * 60 * 60 * 1000);
  const resolvedAtDate = new Date(acceptedAtDate.getTime() + 18 * 60 * 60 * 1000); // 18h after accept

  const createdAt = createdAtDate.toISOString();
  const acceptedAt = acceptedAtDate.toISOString();
  const expiresAt = expiresAtDate.toISOString();
  const resolvedAt = resolvedAtDate.toISOString();
  const respondByAt = new Date(createdAtDate.getTime() + 8 * 60 * 60 * 1000).toISOString();

  // Outcome of the *recipient* drives status. Sent + won → friend completed → status 'completed'.
  // Sent + lost → friend expired → status 'expired'. Same logic from the other perspective for received.
  const recipientFinalStatus = outcome === 'won' ? 'completed' : 'expired';
  const overallStatus = recipientFinalStatus; // 1v1 — overall mirrors recipient

  const challengerActivity = {
    activityId: `seed_${createdAtDate.getTime()}`,
    type: matchRule.activityType || (matchRule.category === 'lifting' ? 'Strength Training' : matchRule.category === 'recovery' ? 'Sauna' : 'Running'),
    subtype: '',
    duration: matchRule.durationMin || 30,
    distance: matchRule.distanceMin || 0,
    calories: 0,
    countToward: matchRule.category === 'lifting' ? 'lifting' : matchRule.category,
    date: createdAtDate.toISOString().slice(0, 10),
  };

  const participants = {
    [recipientUid]: {
      status: recipientFinalStatus,
      acceptedAt,
      expiresAt,
      resolvedAt,
      ...(recipientFinalStatus === 'completed' ? { completedAt: resolvedAt, fulfillingActivityId: `seed_fulfill_${createdAtDate.getTime()}` } : {}),
    },
  };

  const challengeId = `${challengerUid}_${recipientUid}_seedcomp_${createdAtDate.getTime()}`;

  return {
    id: challengeId,
    type: '1v1',
    mode: 'all_complete',
    challengerUid,
    challengerName,
    title,
    participantUids: [challengerUid, recipientUid],
    participants,
    challengerActivity,
    matchRule,
    windowHours: 24,
    requirePhoto,
    createdAt,
    respondByAt,
    acceptedAt,
    expiresAt,
    resolvedAt,
    // Legacy 1v1 mirror fields the older code paths still read.
    friendUid: recipientUid,
    friendStatus: recipientFinalStatus,
    status: overallStatus,
    _seed: true,
  };
}

async function seed() {
  const friends = await getFriendsOf(ADMIN_UID);
  if (friends.length === 0) {
    console.error('[seed] no friends found for admin user — add a friend first');
    process.exit(1);
  }
  // Spread across up to 4 friends so cards visually vary; fall back to repeats if fewer.
  const friendNames = await Promise.all(friends.slice(0, 4).map(getDisplayName));
  const F = (i) => ({ uid: friends[i % friends.length], name: friendNames[i % friendNames.length] });

  // 14 challenges total — 7 sent + 7 received, with a healthy mix of wins/losses.
  // Variety in match rule (distance / duration / pace) and category.
  const seedConfigs = [
    // Sent — wins (friend completed)
    { perspective: 'sent', outcome: 'won', friend: F(0), matchRule: { category: 'cardio', activityType: 'Running', distanceMin: 3 }, title: 'Easy 3 mi', daysAgo: 2 },
    { perspective: 'sent', outcome: 'won', friend: F(1), matchRule: { category: 'lifting', durationMin: 45 }, title: 'Push day', daysAgo: 5 },
    { perspective: 'sent', outcome: 'won', friend: F(2), matchRule: { category: 'recovery', activityType: 'Sauna', durationMin: 15 }, requirePhoto: true, daysAgo: 8 },
    { perspective: 'sent', outcome: 'won', friend: F(0), matchRule: { category: 'cardio', activityType: 'Running', distanceMin: 5, paceMaxSecondsPerMile: 480 }, title: 'Sub-8 5-miler', daysAgo: 11 },
    // Sent — losses (friend didn't finish)
    { perspective: 'sent', outcome: 'lost', friend: F(2), matchRule: { category: 'lifting', durationMin: 60 }, title: 'Leg day, no excuses', requirePhoto: true, daysAgo: 4 },
    { perspective: 'sent', outcome: 'lost', friend: F(3), matchRule: { category: 'cardio', activityType: 'Running', distanceMin: 6 }, title: 'Long run', daysAgo: 9 },
    { perspective: 'sent', outcome: 'lost', friend: F(1), matchRule: { category: 'recovery', activityType: 'Cold Plunge', durationMin: 5 }, daysAgo: 13 },

    // Received — wins (admin completed)
    { perspective: 'received', outcome: 'won', friend: F(0), matchRule: { category: 'cardio', activityType: 'Running', distanceMin: 4 }, title: 'Tuesday miles', daysAgo: 3 },
    { perspective: 'received', outcome: 'won', friend: F(2), matchRule: { category: 'lifting', durationMin: 50 }, daysAgo: 6 },
    { perspective: 'received', outcome: 'won', friend: F(3), matchRule: { category: 'recovery', activityType: 'Yoga', durationMin: 30 }, title: 'Recover or die', daysAgo: 10 },
    { perspective: 'received', outcome: 'won', friend: F(1), matchRule: { category: 'cardio', activityType: 'Cycle', distanceMin: 12 }, daysAgo: 14 },
    // Received — losses (admin didn't finish)
    { perspective: 'received', outcome: 'lost', friend: F(0), matchRule: { category: 'cardio', activityType: 'Running', distanceMin: 8 }, title: '8 mi if you dare', daysAgo: 7 },
    { perspective: 'received', outcome: 'lost', friend: F(3), matchRule: { category: 'lifting', durationMin: 75 }, requirePhoto: true, daysAgo: 12 },
    { perspective: 'received', outcome: 'lost', friend: F(2), matchRule: { category: 'recovery', activityType: 'Sauna', durationMin: 20 }, daysAgo: 15 },
  ];

  const challenges = seedConfigs.map(cfg => buildCompletedChallenge({
    perspective: cfg.perspective,
    outcome: cfg.outcome,
    friendUid: cfg.friend.uid,
    friendName: cfg.friend.name,
    matchRule: cfg.matchRule,
    title: cfg.title || '',
    requirePhoto: cfg.requirePhoto || false,
    daysAgo: cfg.daysAgo,
  }));

  const batch = db.batch();
  for (const c of challenges) {
    batch.set(db.collection('challenges').doc(c.id), c);
    const ruleSummary = c.matchRule.distanceMin ? `${c.matchRule.distanceMin} mi` : `${c.matchRule.durationMin} min`;
    const persp = c.challengerUid === ADMIN_UID ? 'SENT' : 'RECV';
    const result = c.status === 'completed' ? '✅' : '❌';
    console.log(`[seed] ${persp} ${result} ${c.matchRule.category} (${ruleSummary}) — ${c.challengerUid === ADMIN_UID ? `to ${c.friendUid}` : `from ${c.challengerName}`}`);
  }
  await batch.commit();
  console.log(`\n[seed] done. ${challenges.length} fake completed challenges created.`);
  console.log(`[seed] cleanup: node functions/scripts/seedFakeCompletedChallenges.js --delete`);
}

async function cleanup() {
  const snap = await db.collection('challenges').where('_seed', '==', true).get();
  if (snap.empty) {
    console.log('[seed] no _seed challenges to delete');
    return;
  }
  const batch = db.batch();
  for (const doc of snap.docs) batch.delete(doc.ref);
  await batch.commit();
  console.log(`[seed] deleted ${snap.size} seeded challenges`);
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
