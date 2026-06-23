#!/usr/bin/env node
/**
 * Remove the `injuryMode` field from a user doc (clears injury history/markers).
 * Streaks self-heal: the app recomputes them from activity history on next load,
 * so removing the field restores the normal (no-injury) streak state.
 *
 * Auth: ADC (`gcloud auth application-default login`).
 *
 * Usage:
 *   node functions/scripts/clearInjuryMode.js felipehybrid           # dry run (shows current value)
 *   node functions/scripts/clearInjuryMode.js felipehybrid --apply   # actually delete the field
 */

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'dayseven-f1a89' });
const db = admin.firestore();

const username = process.argv[2];
const apply = process.argv.includes('--apply');

if (!username) {
  console.error('usage: node clearInjuryMode.js <username> [--apply]');
  process.exit(1);
}

(async () => {
  const snap = await db.collection('users').where('username', '==', username).get();
  if (snap.empty) {
    console.error(`No user with username "${username}"`);
    process.exit(1);
  }
  if (snap.size > 1) {
    console.error(`Multiple users matched "${username}" — aborting`);
    process.exit(1);
  }
  const doc = snap.docs[0];
  const data = doc.data();
  console.log(`User: ${doc.ref.path}  (username=${data.username})`);
  console.log(`Current injuryMode:`, JSON.stringify(data.injuryMode ?? null, null, 2));
  console.log(`Current streaks:`, JSON.stringify(data.streaks ?? null));

  if (!('injuryMode' in data)) {
    console.log('No injuryMode field present — nothing to remove.');
    process.exit(0);
  }
  if (!apply) {
    console.log('\nDRY RUN — pass --apply to delete the injuryMode field.');
    process.exit(0);
  }
  await doc.ref.update({ injuryMode: admin.firestore.FieldValue.delete() });
  console.log('\nDeleted injuryMode. Streaks will recompute from activity history on next app load.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
