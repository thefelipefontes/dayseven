#!/usr/bin/env node
/**
 * Quick read-only check: do the seeded feed challenges have the shape the badge query expects?
 *   status === 'completed' AND winnerUids array-contains the accepter
 * Also confirms participants[bobUid].fulfillingActivityId is a string.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'dayseven-f1a89' });
const db = admin.firestore();

(async () => {
  const snap = await db.collection('challenges').where('_seed', '==', true).get();
  if (snap.empty) {
    console.log('[check] no _seed challenges found');
    process.exit(0);
  }
  for (const doc of snap.docs) {
    const c = doc.data();
    console.log('---');
    console.log('id:', doc.id);
    console.log('status:', JSON.stringify(c.status));
    console.log('winnerUids:', JSON.stringify(c.winnerUids));
    console.log('participants:', JSON.stringify(c.participants));
    console.log('challengerUid:', c.challengerUid);
    console.log('challengerName:', c.challengerName);
  }
  process.exit(0);
})();
