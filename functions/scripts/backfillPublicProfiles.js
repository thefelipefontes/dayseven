#!/usr/bin/env node
/**
 * One-time backfill for the rules hardening. Run it after deploying functions and before
 * deploying the new firestore.rules. Dry-runs by default; pass --confirm to write.
 *
 *  - publicProfiles/{uid} for every user (username, displayName, photoURL). The
 *    protectUserFields function keeps them current from then on; the app reads them for
 *    search, friend requests and friends lists.
 *  - usernames/{username} for legacy users who never got a reservation. The app's
 *    availability check used to also query user docs by username; the rules no longer
 *    allow that, so without a reservation a legacy username could be claimed again.
 *    A reservation already held by another uid is reported, not changed.
 *
 * Auth: ADC (`gcloud auth application-default login`).
 *
 * Usage:
 *   node functions/scripts/backfillPublicProfiles.js            # dry run
 *   node functions/scripts/backfillPublicProfiles.js --confirm  # write
 */

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'dayseven-f1a89' });
const db = admin.firestore();

const confirm = process.argv.includes('--confirm');
const PUBLIC_PROFILE_FIELDS = ['username', 'displayName', 'photoURL']; // keep in sync with functions/index.js

async function main() {
  const users = await db.collection('users').select(...PUBLIC_PROFILE_FIELDS).get();
  const reservations = await db.collection('usernames').get();
  const reservedBy = new Map(reservations.docs.map((d) => [d.id, d.data().uid]));

  const writer = db.bulkWriter();
  let profiles = 0;
  let newReservations = 0;
  const conflicts = [];

  for (const doc of users.docs) {
    const data = doc.data();
    const profile = { uid: doc.id };
    for (const k of PUBLIC_PROFILE_FIELDS) profile[k] = data[k] ?? null;
    profiles++;
    if (confirm) writer.set(db.collection('publicProfiles').doc(doc.id), profile);

    const username = typeof data.username === 'string' ? data.username.toLowerCase() : null;
    if (!username) continue;
    const holder = reservedBy.get(username);
    if (holder === doc.id) continue;
    if (holder) {
      conflicts.push(`${username}: user ${doc.id}, reserved by ${holder}`);
      continue;
    }
    reservedBy.set(username, doc.id);
    newReservations++;
    console.log(`reserve usernames/${username} → ${doc.id}`);
    if (confirm) writer.create(db.collection('usernames').doc(username), { uid: doc.id });
  }

  if (confirm) await writer.close();
  console.log(`\n${confirm ? 'Wrote' : 'Would write'} ${profiles} public profiles and ${newReservations} username reservations.`);
  if (conflicts.length) {
    console.log(`\n${conflicts.length} username(s) held by a different uid (left alone — check by hand):`);
    conflicts.forEach((c) => console.log(`  ${c}`));
  }
  if (!confirm) console.log('\nDry run. Re-run with --confirm to write.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
