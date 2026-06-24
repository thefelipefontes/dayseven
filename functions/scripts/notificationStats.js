#!/usr/bin/env node
/**
 * Print notification send/open counts and open rates per type from the
 * `notificationEvents` collection (written by sendNotificationToUser = 'sent'
 * and logNotificationOpen = 'opened').
 *
 * Auth: ADC (`gcloud auth application-default login`).
 *
 * Usage:
 *   node functions/scripts/notificationStats.js            # all-time
 *   node functions/scripts/notificationStats.js 2026-06-01 # only events on/after a date (YYYY-MM-DD)
 */

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'dayseven-f1a89' });
const db = admin.firestore();

const sinceDate = process.argv[2] || null;

(async () => {
  let q = db.collection('notificationEvents');
  if (sinceDate) q = q.where('date', '>=', sinceDate);
  const snap = await q.get();

  const stats = {};
  snap.forEach((doc) => {
    const { type = 'unknown', event } = doc.data();
    (stats[type] = stats[type] || { sent: 0, opened: 0 });
    if (event === 'sent') stats[type].sent++;
    else if (event === 'opened') stats[type].opened++;
  });

  const rows = Object.entries(stats).sort();
  console.log(`\nnotificationEvents${sinceDate ? ` since ${sinceDate}` : ''} — ${snap.size} events\n`);
  console.log('type'.padEnd(26) + 'sent'.padStart(7) + 'opened'.padStart(8) + 'open-rate'.padStart(11));
  console.log('-'.repeat(52));
  let totSent = 0, totOpen = 0;
  for (const [type, s] of rows) {
    totSent += s.sent; totOpen += s.opened;
    const rate = s.sent ? `${((100 * s.opened) / s.sent).toFixed(0)}%` : '—';
    console.log(type.padEnd(26) + String(s.sent).padStart(7) + String(s.opened).padStart(8) + rate.padStart(11));
  }
  console.log('-'.repeat(52));
  const totRate = totSent ? `${((100 * totOpen) / totSent).toFixed(0)}%` : '—';
  console.log('TOTAL'.padEnd(26) + String(totSent).padStart(7) + String(totOpen).padStart(8) + totRate.padStart(11));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
