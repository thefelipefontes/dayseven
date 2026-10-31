/**
 * Everything an account leaves behind, found and deleted. Used by the deleteAccount
 * callable and the onAuthUserDeleted trigger (index.js), and by scripts/deleteUser.js.
 *
 * Everything is found before anything is deleted, so a failed lookup changes nothing.
 * Then, in order: Storage files; this user's traces in other users' data (their comments
 * on others' activities with the replies under them, their replies and reactions, and
 * others' friend docs naming them); shared docs (friend requests, challenges, push
 * counters), the username lock, push tokens and public profile; and the user doc with all
 * its subcollections last. A retry after a partial run finds whatever is left. Callers
 * delete the Auth account only once this has succeeded.
 *
 * A challenge goes whole, as scripts/deleteUser.js always did: it holds this user's
 * activity, name and photos, and a 1v1 has nothing left without them.
 *
 * The collection-group lookups need the single-field indexes in firestore.indexes.json.
 */

/** Every doc, doc tree and Storage path that belongs to `uid`. */
async function findAccountData(db, uid) {
  const userRef = db.collection('users').doc(uid);
  const byField = (name, field, op = '==') => db.collection(name).where(field, op, uid).get();
  const byGroupField = (name, field) => db.collectionGroup(name).where(field, '==', uid).get();

  const [userSnap, usernameLocks, friendDocs, reactions, comments, replies, sentRequests,
    receivedRequests, challenges, limitsFrom, limitsTo] = await Promise.all([
    userRef.get(),
    byField('usernames', 'uid'),
    byGroupField('friends', 'friendUid'),
    byGroupField('reactions', 'reactorUid'),
    byGroupField('comments', 'commenterUid'),
    byGroupField('replies', 'replierUid'),
    byField('friendRequests', 'fromUid'),
    byField('friendRequests', 'toUid'),
    byField('challenges', 'participantUids', 'array-contains'),
    byField('pushRateLimits', 'fromUid'),
    byField('pushRateLimits', 'toUid'),
  ]);

  // Anything under users/{uid} goes with the user doc's own tree.
  const elsewhere = (snap) => snap.docs.map((d) => d.ref).filter((ref) => !ref.path.startsWith(`users/${uid}/`));

  const sharedDocs = [
    ...sentRequests.docs, ...receivedRequests.docs, ...challenges.docs, ...limitsFrom.docs, ...limitsTo.docs,
    ...usernameLocks.docs,
  ].map((d) => d.ref);
  // A username lock from before locks named their uid.
  const username = userSnap.exists ? userSnap.data().username : null;
  if (typeof username === 'string' && username) {
    const lock = await db.collection('usernames').doc(username.toLowerCase()).get();
    if (lock.exists && (!lock.data().uid || lock.data().uid === uid)) sharedDocs.push(lock.ref);
  }
  sharedDocs.push(db.collection('userTokens').doc(uid), db.collection('publicProfiles').doc(uid));

  return {
    userRef,
    // Other users' docs that are this user's: friend docs naming them, their reactions and replies.
    otherUsersDocs: [...elsewhere(friendDocs), ...elsewhere(reactions), ...elsewhere(replies)],
    // Their comments on other users' activities, with the replies under them.
    otherUsersTrees: elsewhere(comments),
    sharedDocs: dedupeRefs(sharedDocs),
    storageFiles: [`profilePhotos/${uid}`],
    // Trailing slash: 'activityPhotos/abc' would also match another user 'abcd'.
    storagePrefixes: [`activityPhotos/${uid}/`],
  };
}

function dedupeRefs(refs) {
  const byPath = new Map();
  refs.forEach((ref) => byPath.set(ref.path, ref));
  return [...byPath.values()];
}

/** The found data as readable lines (scripts/deleteUser.js dry run). */
function describeAccountData(found) {
  return [
    ...found.storageFiles.map((f) => `storage: ${f}`),
    ...found.storagePrefixes.map((p) => `storage: ${p}*`),
    ...found.otherUsersDocs.map((r) => r.path),
    ...found.otherUsersTrees.map((r) => `${r.path} (and replies)`),
    ...found.sharedDocs.map((r) => r.path),
    `${found.userRef.path} (and every subcollection)`,
  ];
}

/**
 * Delete everything findAccountData finds for `uid`. `bucket` is the Storage bucket, or
 * null to leave Storage alone (the emulator without a Storage emulator). Storage is
 * best effort, as the app's own photo cleanup always was: a failure is logged, and the
 * rest still goes. Returns counts for the log.
 */
async function deleteAccountData({ db, bucket, uid, found = null }) {
  const data = found || await findAccountData(db, uid);

  let storageFailed = false;
  if (bucket) {
    const results = await Promise.allSettled([
      ...data.storageFiles.map((name) => bucket.file(name).delete({ ignoreNotFound: true })),
      ...data.storagePrefixes.map((prefix) => bucket.deleteFiles({ prefix })),
    ]);
    results.filter((r) => r.status === 'rejected').forEach((r) => {
      storageFailed = true;
      console.error(`[deleteAccountData] storage cleanup failed for ${uid}:`, r.reason?.message || r.reason);
    });
  }

  for (const ref of data.otherUsersTrees) await db.recursiveDelete(ref);
  const writer = db.bulkWriter();
  const deletes = Promise.allSettled([...data.otherUsersDocs, ...data.sharedDocs].map((ref) => writer.delete(ref)));
  await writer.close();
  const failed = (await deletes).filter((r) => r.status === 'rejected');
  if (failed.length > 0) throw new Error(`${failed.length} deletes failed for ${uid}: ${failed[0].reason?.message}`);
  await db.recursiveDelete(data.userRef);

  return {
    otherUsersDocs: data.otherUsersDocs.length,
    otherUsersTrees: data.otherUsersTrees.length,
    sharedDocs: data.sharedDocs.length,
    storage: !bucket ? 'skipped' : (storageFailed ? 'failed' : 'deleted'),
  };
}

module.exports = { findAccountData, describeAccountData, deleteAccountData };
