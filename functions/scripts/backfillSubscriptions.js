#!/usr/bin/env node
/**
 * Backfill users/{uid}.subscription from RevenueCat's current state.
 *
 * The revenueCatWebhook only captures events from when it went live forward —
 * RevenueCat does not replay past purchases. So existing trials/subscribers
 * have no `subscription` field, which makes them invisible to trial-end and
 * (worse) makes active trials look access-less to win-back. This one-time
 * backfill pulls each user's current state from the RevenueCat REST API and
 * stamps `subscription` to match exactly what the webhook would write.
 *
 * Stamps users RevenueCat knows about (active OR lapsed); skips users RC has no
 * subscription record for (never-subscribed — win-back already covers them via
 * the signup clock, no field needed). After this runs, the live webhook keeps
 * everyone current going forward.
 *
 * Auth:
 *   - Firestore: ADC (`gcloud auth application-default login`)
 *   - RevenueCat: secret API key in env (Dashboard → API keys → secret `sk_…`)
 *
 * Usage (uses Node's https, so any Node version is fine):
 *   export REVENUECAT_SECRET_KEY=sk_xxx
 *   node functions/scripts/backfillSubscriptions.js              # DRY RUN (prints, writes nothing)
 *   node functions/scripts/backfillSubscriptions.js --apply      # writes the subscription field
 */

const https = require('https');
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'dayseven-f1a89' });
const db = admin.firestore();

const ENTITLEMENT_ID = 'dayseven Pro';
const RC_KEY = process.env.REVENUECAT_SECRET_KEY;
const APPLY = process.argv.includes('--apply');

if (!RC_KEY) {
  console.error('Missing REVENUECAT_SECRET_KEY env var (RevenueCat Dashboard → API keys → secret key).');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GET https://api.revenuecat.com/v1/subscribers/{app_user_id} via Node https
// (avoids the Node-22 undici "premature close" issue entirely).
function rcGetSubscriber(appUserId) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.revenuecat.com',
        path: `/v1/subscribers/${encodeURIComponent(appUserId)}`,
        method: 'GET',
        headers: { Authorization: `Bearer ${RC_KEY}`, Accept: 'application/json' },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode === 404) return resolve(null);
          if (res.statusCode >= 400) return reject(new Error(`RC ${res.statusCode}: ${body.slice(0, 200)}`));
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

// Map a RevenueCat subscriber payload → the same `subscription` shape the
// webhook writes. Returns null if RC has no relevant record for this user.
function mapSubscription(rc) {
  const sub = rc && rc.subscriber;
  if (!sub) return null;
  const ent = (sub.entitlements || {})[ENTITLEMENT_ID];
  const subs = sub.subscriptions || {};

  // Find the subscription backing the entitlement (by product), else the one
  // with the latest expiry.
  let detail = null;
  if (ent && ent.product_identifier && subs[ent.product_identifier]) {
    detail = subs[ent.product_identifier];
  } else {
    detail = Object.values(subs)
      .sort((a, b) => new Date(b.expires_date || 0) - new Date(a.expires_date || 0))[0] || null;
  }
  if (!ent && !detail) return null; // RC has nothing for this user → skip

  const now = Date.now();
  const expiresAt = (ent && ent.expires_date) || (detail && detail.expires_date) || null;
  const expiresMs = expiresAt ? new Date(expiresAt).getTime() : null;
  const entitlementActive = ent ? (expiresMs ? expiresMs > now : true) : false;
  const periodType = detail && detail.period_type ? String(detail.period_type).toUpperCase() : null; // TRIAL | NORMAL | INTRO
  const isTrial = periodType === 'TRIAL';
  const cancelled = !!(detail && detail.unsubscribe_detected_at);

  return {
    entitlementActive,
    status: !entitlementActive ? 'expired' : (isTrial ? 'trial' : 'active'),
    periodType,
    expiresAt,
    trialEndsAt: isTrial && entitlementActive ? expiresAt : null,
    willRenew: cancelled ? false : entitlementActive,
    lastEventType: 'BACKFILL',
    updatedAt: new Date().toISOString(),
  };
}

(async () => {
  const snap = await db.collection('users').get();
  console.log(`Scanning ${snap.size} users  (${APPLY ? 'APPLY — writing' : 'DRY RUN — no writes'})\n`);
  let stamped = 0, skipped = 0, errors = 0;

  for (const doc of snap.docs) {
    const uid = doc.id;
    try {
      const subscription = mapSubscription(await rcGetSubscriber(uid));
      if (!subscription) { skipped++; continue; }
      console.log(
        `  ${uid}  active=${subscription.entitlementActive}  status=${subscription.status}` +
        `  willRenew=${subscription.willRenew}  trialEndsAt=${subscription.trialEndsAt || '-'}`
      );
      if (APPLY) await doc.ref.set({ subscription }, { merge: true });
      stamped++;
    } catch (e) {
      errors++;
      console.warn(`  ${uid}  ERROR ${e.message}`);
    }
    await sleep(120); // gentle throttle for RC rate limits
  }

  console.log(`\nDone. stamped=${stamped} skipped(no RC record)=${skipped} errors=${errors}` +
    `${APPLY ? '' : '  → re-run with --apply to write'}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
