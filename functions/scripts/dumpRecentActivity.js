#!/usr/bin/env node
/**
 * Dump the most recent activities from felipefontes's user doc so we can see
 * what's stored on a row that's rendering weirdly on Home (yellow heartbeat
 * icon + blank title typically means type is missing or unrecognized).
 *
 * Usage: node functions/scripts/dumpRecentActivity.js [count]
 *   count — how many most-recent rows to dump (default 5)
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'dayseven-f1a89' });
const db = admin.firestore();

const ADMIN_UID = 'TvQwWbwNFQe7lDzhPOo15EopEOA3';
const N = parseInt(process.argv[2] || '5', 10);

async function run() {
  const snap = await db.collection('users').doc(ADMIN_UID).get();
  if (!snap.exists) {
    console.error('User doc not found');
    process.exit(1);
  }
  const acts = Array.isArray(snap.data().activities) ? snap.data().activities : [];
  const sorted = [...acts].sort((a, b) => {
    const d = String(b.date || '').localeCompare(String(a.date || ''));
    if (d !== 0) return d;
    return String(b.time || '').localeCompare(String(a.time || ''));
  });
  console.log(`Total activities: ${acts.length}. Showing ${Math.min(N, sorted.length)} most recent:\n`);
  for (const a of sorted.slice(0, N)) {
    console.log('---');
    console.log(JSON.stringify(a, null, 2));
  }
}

run().catch(e => { console.error(e); process.exit(1); });
