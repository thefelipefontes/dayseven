#!/usr/bin/env node
/**
 * READ-ONLY. Measures how close each user doc is to Firestore's 1 MiB
 * document limit, driven by the `activities` array stored inside
 * `users/{uid}`. Prints counts and sizes only: no uids, usernames, emails
 * or activity contents.
 *
 * Sizes use Firestore's documented storage-size formula
 * (https://cloud.google.com/firestore/docs/storage-size): strings are UTF-8
 * bytes + 1, numbers/timestamps 8, booleans/null 1, map keys count as
 * strings, plus the document name and a 32-byte overhead.
 *
 * Pace is activities dated in the last 90 days, per month. "Months to 1 MiB"
 * assumes that pace and the user's average bytes per activity hold. It also
 * prints what a one-doc-per-week layout would hold (weeks per user, busiest
 * week) and friends per user (a count query each), for
 * docs/activities-storage-plan.md.
 *
 * Auth: ADC (`gcloud auth application-default login`). When ADC wants a
 * re-login (`invalid_rapt`), a gcloud user token works too:
 *   GCLOUD_ACCESS_TOKEN=$(gcloud auth print-access-token) node functions/scripts/activityStorageStats.js
 *
 * Usage:
 *   node functions/scripts/activityStorageStats.js            # top 20
 *   node functions/scripts/activityStorageStats.js --top 50
 */

const admin = require('firebase-admin');
const PROJECT_ID = 'dayseven-f1a89';

function openDb() {
  const token = process.env.GCLOUD_ACCESS_TOKEN;
  if (!token) {
    admin.initializeApp({ projectId: PROJECT_ID });
    return admin.firestore();
  }
  // The Admin SDK only takes ADC or a service account, so go straight to the
  // Firestore client it wraps (same Timestamp/FieldPath classes).
  const { Firestore } = require('@google-cloud/firestore');
  const { GoogleAuth, OAuth2Client } = require('google-auth-library');
  const authClient = new OAuth2Client();
  authClient.setCredentials({ access_token: token });
  return new Firestore({ projectId: PROJECT_ID, auth: new GoogleAuth({ authClient, projectId: PROJECT_ID }) });
}
const db = openDb();

const args = process.argv.slice(2);
const topIdx = args.indexOf('--top');
const TOP = topIdx >= 0 ? parseInt(args[topIdx + 1], 10) || 20 : 20;
const PAGE = 100;
const LIMIT = 1048576; // 1 MiB
const DAY = 86400000;
const now = Date.now();

const strSize = (s) => Buffer.byteLength(s, 'utf8') + 1;

function valueSize(v) {
  if (v === null || v === undefined) return 1;
  if (typeof v === 'string') return strSize(v);
  if (typeof v === 'number') return 8;
  if (typeof v === 'boolean') return 1;
  if (v instanceof admin.firestore.Timestamp) return 8;
  if (v instanceof admin.firestore.GeoPoint) return 16;
  if (v instanceof admin.firestore.DocumentReference) return docNameSize(v.path);
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return v.length;
  if (Array.isArray(v)) return v.reduce((n, x) => n + valueSize(x), 0);
  if (typeof v === 'object') {
    let n = 0;
    for (const [k, x] of Object.entries(v)) n += strSize(k) + valueSize(x);
    return n;
  }
  return 8;
}

const docNameSize = (path) => path.split('/').reduce((n, seg) => n + strSize(seg), 0) + 16;

const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0;
const kb = (b) => (b / 1024).toFixed(1);
// Sunday-start week key, the same calendar math as src/utils/weekGoals weekKeyFromDateStr.
const weekKey = (t) => new Date(t - new Date(t).getUTCDay() * DAY).toISOString().slice(0, 10);
const idShape = (id) => {
  if (typeof id === 'number') return 'number';
  const s = String(id);
  if (/^\d+$/.test(s)) return 'digits-string';
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) return 'identifier-string';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return 'uuid';
  return 'other-string';
};
const parseDay = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
};

(async () => {
  const rows = [];
  const otherFieldTotals = {}; // non-activities top-level field -> bytes summed over all users
  const activityFieldTotals = {}; // activity field -> bytes summed over all activities
  let totalActivities = 0;
  let noId = 0;
  let dupIds = 0;
  let undated = 0;
  const idShapes = {};
  const friendCounts = [];

  let last = null;
  for (;;) {
    let q = db.collection('users').orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    last = snap.docs[snap.docs.length - 1];

    for (const doc of snap.docs) {
      const data = doc.data();
      const acts = Array.isArray(data.activities) ? data.activities : [];
      let docSize = docNameSize(doc.ref.path) + 32;
      let actsSize = 0;
      for (const [k, v] of Object.entries(data)) {
        const s = strSize(k) + valueSize(v);
        docSize += s;
        if (k === 'activities') actsSize = s;
        else otherFieldTotals[k] = (otherFieldTotals[k] || 0) + s;
      }

      let maxAct = 0;
      let last90 = 0;
      let last56Bytes = 0;
      let first = null;
      const ids = new Set();
      const weeks = new Map(); // week key -> { n, bytes }
      for (const a of acts) {
        const s = valueSize(a);
        if (s > maxAct) maxAct = s;
        if (a && typeof a === 'object') {
          for (const [k, v] of Object.entries(a)) {
            activityFieldTotals[k] = (activityFieldTotals[k] || 0) + strSize(k) + valueSize(v);
          }
          if (a.id !== undefined && a.id !== null) idShapes[idShape(a.id)] = (idShapes[idShape(a.id)] || 0) + 1;
          if (a.id === undefined || a.id === null || a.id === '') noId++;
          else if (ids.has(String(a.id))) dupIds++;
          else ids.add(String(a.id));
        }
        const t = parseDay(a && a.date);
        if (t === null) { undated++; continue; }
        if (first === null || t < first) first = t;
        const w = weeks.get(weekKey(t)) || { n: 0, bytes: 0 };
        w.n++; w.bytes += s;
        weeks.set(weekKey(t), w);
        if (now - t <= 90 * DAY && t <= now + DAY) last90++;
        if (now - t <= 56 * DAY && t <= now + DAY) last56Bytes += s;
      }
      totalActivities += acts.length;
      if (data.demoMode !== true) {
        friendCounts.push((await doc.ref.collection('friends').count().get()).data().count);
      }

      const perMonth = last90 / 3;
      const avgAct = acts.length ? (actsSize - strSize('activities')) / acts.length : 0;
      const growthPerMonth = perMonth * avgAct;
      const monthsTo1MiB = growthPerMonth > 0 ? (LIMIT - docSize) / growthPerMonth : Infinity;
      rows.push({
        demo: data.demoMode === true,
        count: acts.length,
        docSize,
        actsSize,
        avgAct,
        maxAct,
        perMonth,
        monthsTo1MiB,
        last56Bytes,
        historyMonths: first === null ? 0 : (now - first) / (30.44 * DAY),
        weeks: weeks.size,
        maxWeekN: Math.max(0, ...[...weeks.values()].map((w) => w.n)),
        maxWeekBytes: Math.max(0, ...[...weeks.values()].map((w) => w.bytes)),
      });
    }
  }

  const real = rows.filter((r) => !r.demo);
  const sizes = real.map((r) => r.docSize).sort((a, b) => a - b);
  const counts = real.map((r) => r.count).sort((a, b) => a - b);
  const withActs = real.filter((r) => r.count > 0);
  const bytesPerAct = withActs.reduce((n, r) => n + (r.actsSize - strSize('activities')), 0) /
    Math.max(1, withActs.reduce((n, r) => n + r.count, 0));

  console.log(`\nUser docs: ${rows.length} (${rows.length - real.length} demoMode excluded from stats below)`);
  console.log(`Users with ≥1 activity: ${withActs.length}`);
  console.log(`Total activities (all docs): ${totalActivities}  | no id: ${noId}  | duplicate ids: ${dupIds}  | undated: ${undated}`);
  console.log(`Average bytes per activity (non-demo): ${bytesPerAct.toFixed(0)}`);
  console.log(`\nDoc size  p50 ${kb(pct(sizes, 0.5))} KB  p90 ${kb(pct(sizes, 0.9))} KB  p99 ${kb(pct(sizes, 0.99))} KB  max ${kb(sizes[sizes.length - 1] || 0)} KB`);
  console.log(`Activities p50 ${pct(counts, 0.5)}  p90 ${pct(counts, 0.9)}  p99 ${pct(counts, 0.99)}  max ${counts[counts.length - 1] || 0}`);
  for (const t of [100, 250, 500, 750]) {
    console.log(`  docs over ${String(t).padStart(3)} KB: ${real.filter((r) => r.docSize > t * 1024).length}`);
  }

  const top = [...real].sort((a, b) => b.docSize - a.docSize).slice(0, TOP);
  console.log(`\nTop ${top.length} by doc size (ranked, no identifiers):`);
  console.log('  #  acts   docKB  actsKB  acts%  avgB  maxB  acts/mo  hist(mo)  last8wKB  months→1MiB');
  top.forEach((r, i) => {
    const m = Number.isFinite(r.monthsTo1MiB) ? r.monthsTo1MiB.toFixed(0) : '—';
    console.log(
      `${String(i + 1).padStart(3)} ${String(r.count).padStart(5)} ${kb(r.docSize).padStart(7)} ${kb(r.actsSize).padStart(7)}` +
      ` ${((100 * r.actsSize) / r.docSize).toFixed(0).padStart(5)}% ${r.avgAct.toFixed(0).padStart(5)} ${String(r.maxAct).padStart(5)}` +
      ` ${r.perMonth.toFixed(1).padStart(8)} ${r.historyMonths.toFixed(1).padStart(9)} ${kb(r.last56Bytes).padStart(9)} ${m.padStart(12)}`,
    );
  });

  const fast = [...real].filter((r) => Number.isFinite(r.monthsTo1MiB)).sort((a, b) => a.monthsTo1MiB - b.monthsTo1MiB).slice(0, 5);
  console.log('\nSoonest to 1 MiB at current pace:');
  fast.forEach((r) => console.log(`  ${r.count} acts, ${kb(r.docSize)} KB, ${r.perMonth.toFixed(1)} acts/mo, ${r.avgAct.toFixed(0)} B/act → ${r.monthsTo1MiB.toFixed(0)} months`));

  const weekCounts = withActs.map((r) => r.weeks).sort((a, b) => a - b);
  console.log(`\nWeeks with ≥1 activity per user  p50 ${pct(weekCounts, 0.5)}  p90 ${pct(weekCounts, 0.9)}  max ${weekCounts[weekCounts.length - 1] || 0}`);
  console.log(`Busiest single week: ${Math.max(0, ...withActs.map((r) => r.maxWeekN))} activities, largest week ${kb(Math.max(0, ...withActs.map((r) => r.maxWeekBytes)))} KB`);
  console.log(`Week docs a per-week backfill would write: ${withActs.reduce((n, r) => n + r.weeks, 0)}`);
  console.log(`Activities dated in the last 90 days, per month (all users): ${real.reduce((n, r) => n + r.perMonth, 0).toFixed(0)}`);
  friendCounts.sort((a, b) => a - b);
  console.log(`Friends per user  p50 ${pct(friendCounts, 0.5)}  p90 ${pct(friendCounts, 0.9)}  max ${friendCounts[friendCounts.length - 1] || 0}`);
  console.log(`Activity id shapes: ${Object.entries(idShapes).map(([k, v]) => `${k} ${v}`).join(', ')}`);

  const fmtFields = (totals, n) => Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([k, v]) => `  ${k.padEnd(28)} ${kb(v).padStart(10)} KB`).join('\n');
  console.log('\nLargest activity fields (bytes summed over every activity):');
  console.log(fmtFields(activityFieldTotals, 15));
  console.log('\nLargest non-activities top-level fields (summed over every user doc):');
  console.log(fmtFields(otherFieldTotals, 12));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
