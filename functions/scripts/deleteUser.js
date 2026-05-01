#!/usr/bin/env node
/**
 * Fully delete one or more user accounts — Firestore profile, subcollections,
 * cross-references, and Firebase Auth record. Dry-runs by default; pass
 * --confirm to actually execute deletions.
 *
 * Auth: ADC (`gcloud auth application-default login`).
 *
 * Usage:
 *   node functions/scripts/deleteUser.js tom tommy test bobby            # dry run
 *   node functions/scripts/deleteUser.js tom tommy test bobby --confirm  # execute
 *
 * Scope per user:
 *   - users/{uid}/dailyHealth/*  (recursive)
 *   - users/{uid}/friends/*      (recursive)
 *   - users/{uid}                (the profile doc)
 *   - usernames/{username}       (the username uniqueness lock)
 *   - userTokens/{uid}           (FCM push token, if exists)
 *   - friendRequests/* where fromUid OR toUid matches
 *   - challenges/* where participantUids array contains uid (deleted entirely)
 *   - Firebase Auth user (deleted last so a mid-run failure leaves auth intact for a retry)
 */

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'dayseven-f1a89' });
const db = admin.firestore();
const auth = admin.auth();

const args = process.argv.slice(2);
const confirm = args.includes('--confirm');
const usernames = args.filter(a => !a.startsWith('--'));

if (usernames.length === 0) {
  console.error('usage: node deleteUser.js <username> [<username2> ...] [--confirm]');
  process.exit(1);
}

async function recursiveDelete(ref, collect) {
  const snap = await ref.get();
  for (const doc of snap.docs) {
    const subs = await doc.ref.listCollections();
    for (const sc of subs) await recursiveDelete(sc, collect);
    collect.push({ kind: 'doc', path: doc.ref.path });
    if (confirm) await doc.ref.delete();
  }
}

async function planAndDelete(username) {
  const planned = [];
  const userSnap = await db.collection('users').where('username', '==', username).get();
  if (userSnap.empty) {
    console.log(`\n[${username}] NOT FOUND in Firestore — nothing to delete`);
    return;
  }
  if (userSnap.size > 1) {
    console.error(`\n[${username}] MULTIPLE matches — aborting this username for safety`);
    return;
  }
  const userDoc = userSnap.docs[0];
  const uid = userDoc.id;

  console.log(`\n[${username}] uid=${uid}`);

  // 1. Subcollections under users/{uid}
  const subs = await userDoc.ref.listCollections();
  for (const sc of subs) await recursiveDelete(sc, planned);

  // 2. usernames/{username} lock
  const usernameLock = db.collection('usernames').doc(username);
  if ((await usernameLock.get()).exists) {
    planned.push({ kind: 'doc', path: usernameLock.path });
    if (confirm) await usernameLock.delete();
  }

  // 3. userTokens/{uid}
  const tokenRef = db.collection('userTokens').doc(uid);
  if ((await tokenRef.get()).exists) {
    planned.push({ kind: 'doc', path: tokenRef.path });
    if (confirm) await tokenRef.delete();
  }

  // 4. friendRequests where fromUid OR toUid matches
  const frFrom = await db.collection('friendRequests').where('fromUid', '==', uid).get();
  const frTo = await db.collection('friendRequests').where('toUid', '==', uid).get();
  for (const d of [...frFrom.docs, ...frTo.docs]) {
    planned.push({ kind: 'doc', path: d.ref.path });
    if (confirm) await d.ref.delete();
  }

  // 5. challenges where participantUids array-contains uid
  const ch = await db.collection('challenges').where('participantUids', 'array-contains', uid).get();
  for (const d of ch.docs) {
    planned.push({ kind: 'doc', path: d.ref.path });
    if (confirm) await d.ref.delete();
  }

  // 6. The user profile doc itself (deleted after subcollections)
  planned.push({ kind: 'doc', path: userDoc.ref.path });
  if (confirm) await userDoc.ref.delete();

  // 7. Firebase Auth record (LAST — only after all Firestore deletes succeed)
  let authStatus = 'auth: not deleted (dry-run)';
  if (confirm) {
    try {
      await auth.deleteUser(uid);
      authStatus = 'auth: DELETED';
    } catch (e) {
      authStatus = `auth: SKIPPED (${e.code || e.message})`;
    }
  }

  console.log(`  ${planned.length} doc(s) ${confirm ? 'deleted' : 'would be deleted'}:`);
  planned.forEach(p => console.log(`    - ${p.path}`));
  console.log(`  ${authStatus}`);
}

(async () => {
  console.log(confirm
    ? '*** EXECUTING — deletions are permanent ***'
    : '--- DRY RUN — pass --confirm to execute ---');
  for (const u of usernames) await planAndDelete(u);
  console.log(confirm ? '\nDone.' : '\nDry run complete. Re-run with --confirm to execute.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
