#!/usr/bin/env node
/**
 * One-off cleanup: find activities in felipefontes's user doc that have
 * type: "" (saved by a watch path that didn't populate summaryActivityType)
 * and either delete them or relabel them as "Other" so they render.
 *
 * Auth: ADC (`gcloud auth application-default login` if expired).
 *
 * Usage:
 *   node functions/scripts/repairEmptyTypeActivity.js            # list only
 *   node functions/scripts/repairEmptyTypeActivity.js --fix      # relabel to "Other"
 *   node functions/scripts/repairEmptyTypeActivity.js --delete   # remove them
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'dayseven-f1a89' });
const db = admin.firestore();

const ADMIN_UID = 'TvQwWbwNFQe7lDzhPOo15EopEOA3';

async function run() {
  const mode = process.argv.includes('--fix')
    ? 'fix'
    : process.argv.includes('--delete')
      ? 'delete'
      : 'list';

  const ref = db.collection('users').doc(ADMIN_UID);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error('User doc not found');
    process.exit(1);
  }
  const acts = Array.isArray(snap.data().activities) ? snap.data().activities : [];
  const broken = acts.filter(a => !a?.type || String(a.type).trim() === '');

  console.log(`Total activities: ${acts.length}`);
  console.log(`Empty-type entries: ${broken.length}\n`);
  if (broken.length === 0) return;

  for (const a of broken) {
    console.log(`- id=${a.id}, date=${a.date}, time=${a.time}, duration=${a.duration}, source=${a.source}, healthKitUUID=${a.healthKitUUID || '(none)'}`);
  }

  if (mode === 'list') {
    console.log('\nRun with --fix to relabel as "Other", or --delete to remove.');
    return;
  }

  const brokenIds = new Set(broken.map(a => String(a.id)));
  const next = mode === 'delete'
    ? acts.filter(a => !brokenIds.has(String(a.id)))
    : acts.map(a => brokenIds.has(String(a.id))
        ? { ...a, type: 'Other', subtype: a.subtype || 'Workout' }
        : a);

  await ref.set({ activities: next }, { merge: true });
  console.log(`\n${mode === 'delete' ? 'Deleted' : 'Relabeled'} ${broken.length} entries. New total: ${next.length}.`);
}

run().catch(e => { console.error(e); process.exit(1); });
