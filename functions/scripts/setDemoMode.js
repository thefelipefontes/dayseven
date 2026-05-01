#!/usr/bin/env node
/**
 * Toggle the `demoMode` flag on a user doc — the chokepoint that turns any
 * account into a demo account (mocks, seeded HK data, in-memory isolation).
 * See src/demoData.js → isDemoAccount.
 *
 * Auth: ADC (`gcloud auth application-default login`).
 *
 * Usage:
 *   node functions/scripts/setDemoMode.js milahart           # turn ON
 *   node functions/scripts/setDemoMode.js milahart --off     # turn OFF
 */

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'dayseven-f1a89' });
const db = admin.firestore();

const username = process.argv[2];
const turnOff = process.argv.includes('--off');

if (!username) {
  console.error('usage: node setDemoMode.js <username> [--off]');
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
  await doc.ref.update({ demoMode: !turnOff });
  console.log(`${doc.ref.path}: demoMode = ${!turnOff}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
