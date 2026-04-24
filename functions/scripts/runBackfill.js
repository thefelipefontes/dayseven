#!/usr/bin/env node
/**
 * One-off: run the challenge-stats backfill locally via admin SDK.
 * Mirrors the logic in `backfillChallengeStats` (in index.js) exactly —
 * deriving wins/losses/accepted/streaks from the challenges collection
 * and stripping legacy h2hRecords.
 *
 * Auth: uses Application Default Credentials. Run once per machine:
 *   gcloud auth application-default login
 *
 * Usage:
 *   node functions/scripts/runBackfill.js
 */

const admin = require('firebase-admin');

admin.initializeApp({ projectId: 'dayseven-f1a89' });

const db = admin.firestore();
const { FieldValue } = admin.firestore;

async function main() {
  console.log('[runBackfill] fetching challenges...');
  const challengesSnap = await db.collection('challenges').get();
  console.log(`[runBackfill] processing ${challengesSnap.size} challenges`);

  const perUser = new Map();
  const recordFor = (uid) => {
    if (!uid) return null;
    let rec = perUser.get(uid);
    if (!rec) { rec = { accepted: 0, events: [] }; perUser.set(uid, rec); }
    return rec;
  };
  const ACCEPTED_STATUSES = new Set(['accepted', 'completed', 'expired']);

  for (const doc of challengesSnap.docs) {
    const c = doc.data();

    if (c.participants && typeof c.participants === 'object') {
      for (const [uid, p] of Object.entries(c.participants)) {
        if (!p || !ACCEPTED_STATUSES.has(p.status)) continue;
        const rec = recordFor(uid);
        rec.accepted += 1;
        if (p.status === 'completed') {
          const at = p.completedAt || p.resolvedAt || c.completedAt || c.resolvedAt || c.createdAt;
          rec.events.push({ type: 'win', at: at ? new Date(at) : new Date(0) });
        } else if (p.status === 'expired') {
          const at = p.resolvedAt || c.resolvedAt || c.expiresAt;
          rec.events.push({ type: 'loss', at: at ? new Date(at) : new Date(0) });
        }
      }
      continue;
    }

    if (c.friendUid && ACCEPTED_STATUSES.has(c.friendStatus)) {
      const rec = recordFor(c.friendUid);
      rec.accepted += 1;
      if (c.friendStatus === 'completed') {
        const at = c.completedAt || c.resolvedAt || c.createdAt;
        rec.events.push({ type: 'win', at: at ? new Date(at) : new Date(0) });
      } else if (c.friendStatus === 'expired') {
        const at = c.resolvedAt || c.expiresAt;
        rec.events.push({ type: 'loss', at: at ? new Date(at) : new Date(0) });
      }
    }
  }

  const finalStats = new Map();
  for (const [uid, rec] of perUser.entries()) {
    rec.events.sort((a, b) => a.at.getTime() - b.at.getTime());
    let wins = 0, losses = 0, currentWinStreak = 0, longestWinStreak = 0;
    for (const e of rec.events) {
      if (e.type === 'win') {
        wins += 1;
        currentWinStreak += 1;
        if (currentWinStreak > longestWinStreak) longestWinStreak = currentWinStreak;
      } else {
        losses += 1;
        currentWinStreak = 0;
      }
    }
    finalStats.set(uid, { accepted: rec.accepted, wins, losses, currentWinStreak, longestWinStreak });
  }

  console.log('[runBackfill] fetching users...');
  const usersSnap = await db.collection('users').get();
  console.log(`[runBackfill] writing to ${usersSnap.size} users`);

  const ZERO = { accepted: 0, wins: 0, losses: 0, currentWinStreak: 0, longestWinStreak: 0 };
  let batch = db.batch();
  let pending = 0;
  let written = 0;
  const MAX_BATCH = 400;

  for (const userDoc of usersSnap.docs) {
    const stats = finalStats.get(userDoc.id) || ZERO;
    batch.update(userDoc.ref, {
      challengeStats: stats,
      h2hRecords: FieldValue.delete(),
    });
    pending += 1;
    if (pending >= MAX_BATCH) {
      await batch.commit();
      written += pending;
      console.log(`[runBackfill] committed ${written}`);
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) {
    await batch.commit();
    written += pending;
  }

  console.log('[runBackfill] done:', {
    challengesProcessed: challengesSnap.size,
    usersUpdated: written,
    usersWithChallengeHistory: perUser.size,
  });
}

main().catch(err => { console.error(err); process.exit(1); });
