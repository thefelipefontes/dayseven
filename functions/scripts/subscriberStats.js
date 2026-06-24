#!/usr/bin/env node
/**
 * Production subscriber / trial breakdown from the mirrored `subscription`
 * state (webhook + backfill). Excludes SANDBOX (test) entitlements by default.
 * Records with no `environment` are treated as production (they predate the
 * environment tag, e.g. the original backfill of real subscribers).
 *
 * Auth: ADC (`gcloud auth application-default login`).
 *
 * Usage:
 *   node functions/scripts/subscriberStats.js                   # production only
 *   node functions/scripts/subscriberStats.js --include-sandbox # include test/sandbox
 */

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'dayseven-f1a89' });
const db = admin.firestore();
const includeSandbox = process.argv.includes('--include-sandbox');

(async () => {
  const snap = await db.collection('users').get();
  const c = { active: 0, trial: 0, expired: 0, none: 0, sandbox: 0 };
  let trialCancelled = 0;

  snap.forEach((doc) => {
    const sub = doc.data().subscription;
    if (!sub || !sub.status) { c.none++; return; }
    if (sub.environment === 'SANDBOX' && !includeSandbox) { c.sandbox++; return; }
    c[sub.status] = (c[sub.status] || 0) + 1;
    if (sub.status === 'trial' && sub.willRenew === false) trialCancelled++;
  });

  console.log(`\nSubscribers${includeSandbox ? ' (incl. sandbox)' : ' (production)'} — ${snap.size} users\n`);
  console.log(`  paying (active):   ${c.active}`);
  console.log(`  on trial:          ${c.trial}  (${trialCancelled} cancelled / won't convert)`);
  console.log(`  lapsed (expired):  ${c.expired}`);
  console.log(`  never subscribed:  ${c.none}`);
  if (!includeSandbox && c.sandbox) {
    console.log(`  [excluded ${c.sandbox} sandbox/test record(s) — pass --include-sandbox to show]`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
