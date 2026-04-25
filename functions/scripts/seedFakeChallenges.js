#!/usr/bin/env node
/**
 * One-off: seed a couple of fake "active received" challenges into Firestore for the admin
 * user, so the new card UI (dual buttons, target rendering, "use past activity" picker) can
 * be eyeballed on a real device without going through send + accept.
 *
 * Picks the first 2 friends as senders. Creates one distance-cardio challenge (Run 5 mi) and
 * one duration-based one (12 min Sauna) so both target types render. Status is set to active
 * with the recipient already 'accepted' — skip the pending phase.
 *
 * Auth: uses Application Default Credentials.
 *   gcloud auth application-default login
 *
 * Usage:
 *   node functions/scripts/seedFakeChallenges.js
 *
 * Cleanup later:
 *   node functions/scripts/seedFakeChallenges.js --delete
 */

const admin = require('firebase-admin');

admin.initializeApp({ projectId: 'dayseven-f1a89' });
const db = admin.firestore();

const ADMIN_UID = 'TvQwWbwNFQe7lDzhPOo15EopEOA3'; // felipefontes@felipefontes.com (per memory)

async function getFriendsOf(uid) {
  // Friends typically live as a uid array on the user doc OR in a subcollection.
  // Try both shapes; whichever returns first wins.
  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists) throw new Error(`User ${uid} not found`);
  const data = userDoc.data();

  // Shape 1: uid array on the user doc
  if (Array.isArray(data.friends) && data.friends.length > 0 && typeof data.friends[0] === 'string') {
    return data.friends;
  }
  // Shape 2: friends subcollection (each doc id = friend uid)
  const subSnap = await db.collection('users').doc(uid).collection('friends').get();
  if (!subSnap.empty) return subSnap.docs.map(d => d.id);
  // Shape 3: object map
  if (data.friends && typeof data.friends === 'object') return Object.keys(data.friends);
  return [];
}

async function getDisplayName(uid) {
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) return 'Friend';
  const d = snap.data();
  return d.displayName || d.username || 'Friend';
}

function buildChallenge({ challengerUid, challengerName, recipientUid, type, category, distanceMin, durationMin, title, requirePhoto }) {
  const now = new Date();
  const nowMs = now.getTime();
  // Workout window — 24h from now (kept simple for testing).
  const expiresAt = new Date(nowMs + 24 * 60 * 60 * 1000).toISOString();
  const respondByAt = new Date(nowMs + 8 * 60 * 60 * 1000).toISOString();
  const challengeId = `${challengerUid}_${recipientUid}_seed_${nowMs}`;

  const matchRule = { category };
  if (type && ['Running', 'Cycle', 'Swimming', 'Rowing', 'Hiking'].includes(type)) {
    matchRule.activityType = type;
  }
  if (distanceMin) matchRule.distanceMin = distanceMin;
  if (durationMin) matchRule.durationMin = durationMin;

  const challengerActivity = {
    activityId: `seed_${nowMs}`,
    type: type || (category === 'lifting' ? 'Strength Training' : category === 'recovery' ? 'Sauna' : 'Running'),
    subtype: '',
    duration: durationMin || 30,
    distance: distanceMin || 0,
    calories: 0,
    countToward: category === 'lifting' ? 'lifting' : category,
    date: now.toISOString().slice(0, 10),
  };

  // Recipient is pre-accepted so the card lands on Active received instantly.
  const participants = {
    [recipientUid]: {
      status: 'accepted',
      acceptedAt: now.toISOString(),
      expiresAt,
    },
  };

  return {
    id: challengeId,
    type: '1v1',
    mode: 'all_complete',
    challengerUid,
    challengerName: challengerName || '',
    title: title || '',
    participantUids: [challengerUid, recipientUid],
    participants,
    challengerActivity,
    matchRule,
    windowHours: 24,
    requirePhoto: !!requirePhoto,
    createdAt: now.toISOString(),
    respondByAt,
    expiresAt,
    // Legacy 1v1 mirror fields the older code paths still read.
    friendUid: recipientUid,
    friendStatus: 'accepted',
    status: 'active',
    // Tag so cleanup can find these without ambiguity.
    _seed: true,
  };
}

async function seed() {
  const friends = await getFriendsOf(ADMIN_UID);
  if (friends.length === 0) {
    console.error('[seed] no friends found for admin user — add a friend first');
    process.exit(1);
  }
  const sender1Uid = friends[0];
  const sender2Uid = friends[1] || friends[0];
  const [sender1Name, sender2Name] = await Promise.all([
    getDisplayName(sender1Uid),
    getDisplayName(sender2Uid),
  ]);

  const challenges = [
    buildChallenge({
      challengerUid: sender1Uid,
      challengerName: sender1Name,
      recipientUid: ADMIN_UID,
      type: 'Running',
      category: 'cardio',
      distanceMin: 5,
      title: 'Saturday miles',
    }),
    buildChallenge({
      challengerUid: sender2Uid,
      challengerName: sender2Name,
      recipientUid: ADMIN_UID,
      type: 'Sauna',
      category: 'recovery',
      durationMin: 12,
      requirePhoto: true,
    }),
  ];

  const batch = db.batch();
  for (const c of challenges) {
    batch.set(db.collection('challenges').doc(c.id), c);
    console.log(`[seed] writing ${c.id} — ${c.challengerName} → ${c.matchRule.category} (${c.matchRule.distanceMin ? `${c.matchRule.distanceMin} mi` : `${c.matchRule.durationMin} min`})`);
  }
  await batch.commit();
  console.log(`[seed] done. ${challenges.length} fake challenges created. Cleanup: node functions/scripts/seedFakeChallenges.js --delete`);
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
