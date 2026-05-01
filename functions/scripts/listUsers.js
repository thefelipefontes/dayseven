#!/usr/bin/env node
/**
 * Print every user in the `users` collection with key fields. Optional
 * filtering by username substring or by demoMode flag.
 *
 * Auth: ADC (`gcloud auth application-default login`).
 *
 * Usage:
 *   node functions/scripts/listUsers.js                   # all users
 *   node functions/scripts/listUsers.js --grep tom        # username contains "tom"
 *   node functions/scripts/listUsers.js --demo            # demoMode: true only
 *   node functions/scripts/listUsers.js --json            # JSON output (pipe to jq)
 */

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'dayseven-f1a89' });
const db = admin.firestore();

const args = process.argv.slice(2);
const grepIdx = args.indexOf('--grep');
const grep = grepIdx >= 0 ? (args[grepIdx + 1] || '').toLowerCase() : null;
const demoOnly = args.includes('--demo');
const jsonOut = args.includes('--json');

(async () => {
  let q = db.collection('users');
  if (demoOnly) q = q.where('demoMode', '==', true);
  const snap = await q.get();

  const rows = snap.docs.map(d => {
    const x = d.data();
    return {
      uid: d.id,
      username: x.username || '',
      email: x.email || '',
      displayName: x.displayName || '',
      demoMode: x.demoMode === true,
      disableHealthKitSync: x.disableHealthKitSync === true,
    };
  })
  .filter(r => !grep || r.username.toLowerCase().includes(grep))
  .sort((a, b) => a.username.localeCompare(b.username));

  if (jsonOut) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    console.log(`${rows.length} user(s)${demoOnly ? ' (demoMode only)' : ''}${grep ? ` matching "${grep}"` : ''}:`);
    rows.forEach(r => {
      const flags = [r.demoMode && 'DEMO', r.disableHealthKitSync && 'noHK'].filter(Boolean).join(',');
      console.log(`  ${r.username.padEnd(22)} ${r.displayName.padEnd(24)} ${r.email.padEnd(40)} ${flags}`);
    });
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
