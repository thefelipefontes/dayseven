#!/usr/bin/env node
/**
 * Toggle the `forceProTier` flag on a user doc — overrides RevenueCat and
 * grants Pro entitlement client-side. Use for comped accounts (marketing
 * partners, friends-and-family, demo personas) without issuing a real sub.
 * See src/App.jsx → applyProStatus.
 *
 * Auth: ADC (`gcloud auth application-default login`).
 *
 * Usage:
 *   node functions/scripts/setProOverride.js nick           # turn ON
 *   node functions/scripts/setProOverride.js nick --off     # turn OFF
 */

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'dayseven-f1a89' });
const db = admin.firestore();

const username = process.argv[2];
const turnOff = process.argv.includes('--off');

if (!username) {
  console.error('usage: node setProOverride.js <username> [--off]');
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
  await doc.ref.update({ forceProTier: !turnOff });
  console.log(`${doc.ref.path}: forceProTier = ${!turnOff}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
