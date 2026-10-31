#!/usr/bin/env node
/**
 * Fully delete one or more user accounts — everything the deleteAccount Cloud Function
 * deletes (functions/accountDeletion.js), then the Firebase Auth record. Dry-runs by
 * default; pass --confirm to actually execute deletions.
 *
 * Auth: ADC (`gcloud auth application-default login`).
 *
 * Usage:
 *   node functions/scripts/deleteUser.js tom tommy test bobby            # dry run
 *   node functions/scripts/deleteUser.js tom tommy test bobby --confirm  # execute
 *
 * Scope per user (see accountDeletion.js):
 *   - users/{uid} and every subcollection (dailyHealth, friends, activityComments,
 *     activityReactions, …)
 *   - their friend docs in other users' lists, and their comments (with replies), replies
 *     and reactions on other users' activities
 *   - friendRequests and pushRateLimits either side, challenges they're in (deleted whole)
 *   - usernames lock, userTokens, publicProfiles
 *   - Storage: profilePhotos/{uid}, activityPhotos/{uid}/…
 *   - Firebase Auth user (deleted last so a mid-run failure leaves auth intact for a retry)
 */

const admin = require('firebase-admin');
const { findAccountData, describeAccountData, deleteAccountData } = require('../accountDeletion');

admin.initializeApp({ projectId: 'dayseven-f1a89', storageBucket: 'dayseven-f1a89.firebasestorage.app' });
const db = admin.firestore();
const auth = admin.auth();
const bucket = admin.storage().bucket();

const args = process.argv.slice(2);
const confirm = args.includes('--confirm');
const usernames = args.filter(a => !a.startsWith('--'));

if (usernames.length === 0) {
  console.error('usage: node deleteUser.js <username> [<username2> ...] [--confirm]');
  process.exit(1);
}

async function planAndDelete(username) {
  const userSnap = await db.collection('users').where('username', '==', username).get();
  if (userSnap.empty) {
    console.log(`\n[${username}] NOT FOUND in Firestore — nothing to delete`);
    return;
  }
  if (userSnap.size > 1) {
    console.error(`\n[${username}] MULTIPLE matches — aborting this username for safety`);
    return;
  }
  const uid = userSnap.docs[0].id;
  console.log(`\n[${username}] uid=${uid}`);

  const found = await findAccountData(db, uid);
  const planned = describeAccountData(found);
  console.log(`  ${planned.length} item(s) ${confirm ? 'to delete' : 'would be deleted'}:`);
  planned.forEach(p => console.log(`    - ${p}`));
  if (!confirm) {
    console.log('  auth: not deleted (dry-run)');
    return;
  }

  const summary = await deleteAccountData({ db, bucket, uid, found });
  console.log('  deleted:', summary);

  // Firebase Auth record (LAST — only after all Firestore deletes succeed). The
  // onAuthUserDeleted trigger then sweeps once more and finds nothing left.
  try {
    await auth.deleteUser(uid);
    console.log('  auth: DELETED');
  } catch (e) {
    console.log(`  auth: SKIPPED (${e.code || e.message})`);
  }
}

(async () => {
  console.log(confirm
    ? '*** EXECUTING — deletions are permanent ***'
    : '--- DRY RUN — pass --confirm to execute ---');
  for (const u of usernames) await planAndDelete(u);
  console.log(confirm ? '\nDone.' : '\nDry run complete. Re-run with --confirm to execute.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
