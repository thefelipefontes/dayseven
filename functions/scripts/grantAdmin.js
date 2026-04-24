#!/usr/bin/env node
/**
 * One-off: grant the `admin: true` custom auth claim to a user, so they can
 * invoke admin-only callables like `backfillChallengeStats`.
 *
 * Auth: uses Application Default Credentials. Run this first (once per machine):
 *   gcloud auth application-default login
 *
 * Usage:
 *   node functions/scripts/grantAdmin.js <email>
 *     or
 *   node functions/scripts/grantAdmin.js --uid <uid>
 *
 * After granting, the user must sign OUT and back IN in the app so the
 * refreshed ID token includes the new claim.
 */

const admin = require('firebase-admin');

admin.initializeApp({ projectId: 'dayseven-f1a89' });

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node grantAdmin.js <email>  OR  node grantAdmin.js --uid <uid>');
    process.exit(1);
  }

  let uid;
  if (args[0] === '--uid') {
    uid = args[1];
  } else {
    const email = args[0];
    const record = await admin.auth().getUserByEmail(email);
    uid = record.uid;
    console.log(`Resolved ${email} → ${uid}`);
  }

  const before = (await admin.auth().getUser(uid)).customClaims || {};
  await admin.auth().setCustomUserClaims(uid, { ...before, admin: true });
  console.log(`Granted admin=true to ${uid}.`);
  console.log('Sign out + back in on-device to refresh the token.');
}

main().catch(err => { console.error(err); process.exit(1); });
