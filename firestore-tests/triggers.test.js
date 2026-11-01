// Cloud Function tests against the functions + auth emulators (project demo-dayseven, which
// the functions emulator serves). Data is written with rules disabled, as the app or the
// Admin SDK would leave it, and the test waits for the triggers' effects.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, deleteField } = require('firebase/firestore');

const PROJECT = 'demo-dayseven';
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const FUNCTIONS = `http://${process.env.FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001'}/${PROJECT}/us-central1`;
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'}`;
const SECRET = fs.readFileSync(path.join(__dirname, '..', 'functions', '.secret.local'), 'utf8')
  .match(/REVENUECAT_WEBHOOK_SECRET=(.*)/)[1].trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const uid = (label) => `${label}-${Date.now()}-${n++}`;

async function waitFor(check, what, timeoutMs = 30000) {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}

// An emulator account, signed in just now: { uid, idToken }.
async function signUp() {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${uid('u')}@example.com`, password: 'emulator-only', returnSecureToken: true }),
  });
  const json = await res.json();
  return { uid: json.localId, idToken: json.idToken };
}

async function createAuthUser() {
  return (await signUp()).uid;
}

const authAccountExists = async (idToken) => (await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=fake`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ idToken }),
})).ok;

const webhook = (event, secret = SECRET) => fetch(`${FUNCTIONS}/revenueCatWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: secret },
  body: JSON.stringify({ event }),
});

describe('Cloud Function triggers', () => {
  let env;
  let db;
  let release;
  let held;
  const read = async (p) => (await getDoc(doc(db, p))).data();
  const exists = async (p) => (await getDoc(doc(db, p))).exists();

  before(async () => {
    env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { host, port: Number(port) } });
    // Read and write as the Admin SDK would: no rules apply. The context only lives inside
    // its callback, so the callback stays open until the suite ends.
    db = await new Promise((resolve) => {
      held = env.withSecurityRulesDisabled((ctx) => {
        resolve(ctx.firestore());
        return new Promise((r) => { release = r; });
      });
    });
  });
  after(async () => {
    release();
    await held;
    await env.cleanup();
  });

  describe('protectUserFields', () => {
    it('mirrors only the public fields to publicProfiles, and follows changes', async () => {
      const id = uid('pub');
      await setDoc(doc(db, 'users', id), {
        uid: id, username: 'pubby', displayName: 'Pub', photoURL: 'https://x/p.jpg', email: 'secret@example.com',
        subscriptionRequired: true, activities: [{ id: 1 }], notificationPreferences: { timezone: 'UTC' },
      });
      const profile = await waitFor(() => read(`publicProfiles/${id}`), 'public profile');
      assert.deepEqual(profile, { uid: id, username: 'pubby', displayName: 'Pub', photoURL: 'https://x/p.jpg' });

      await updateDoc(doc(db, 'users', id), { displayName: 'Renamed' });
      await waitFor(async () => (await read(`publicProfiles/${id}`))?.displayName === 'Renamed', 'renamed profile');
    });

    it('a new account is stamped subscriptionRequired, createdAt and daily reminders on', async () => {
      const id = uid('new');
      await setDoc(doc(db, 'users', id), { goals: { liftsPerWeek: 3 } });
      const data = await waitFor(async () => {
        const d = await read(`users/${id}`);
        return d?.subscriptionRequired === true && d.notificationPreferences?.dailyReminders === true && d.createdAt ? d : null;
      }, 'new-account stamp');
      assert.equal(typeof data.createdAt, 'string');
    });

    it('a new account keeps what it chose', async () => {
      const id = uid('chose');
      await setDoc(doc(db, 'users', id), {
        subscriptionRequired: true, createdAt: '2026-10-01T00:00:00.000Z',
        notificationPreferences: { dailyReminders: false, timezone: 'UTC' }, username: 'chooser',
      });
      await waitFor(() => read(`publicProfiles/${id}`), 'profile (trigger ran)');
      await sleep(1500);
      const d = await read(`users/${id}`);
      assert.equal(d.notificationPreferences.dailyReminders, false);
      assert.equal(d.createdAt, '2026-10-01T00:00:00.000Z');
    });

    it('an existing account is never stamped', async () => {
      const id = uid('old');
      await setDoc(doc(db, 'users', id), { username: 'olduser', notificationPreferences: { timezone: 'UTC' } });
      await waitFor(async () => (await read(`users/${id}`))?.notificationPreferences?.dailyReminders === true, 'create stamp');
      // A grandfathered-style doc: no subscriptionRequired, reminders never chosen.
      await updateDoc(doc(db, 'users', id), { subscriptionRequired: deleteField(), 'notificationPreferences.dailyReminders': deleteField() });
      await updateDoc(doc(db, 'users', id), { displayName: 'Changed' });
      await waitFor(async () => (await read(`publicProfiles/${id}`))?.displayName === 'Changed', 'profile follows update');
      await sleep(1500);
      const d = await read(`users/${id}`);
      assert.equal(d.subscriptionRequired, undefined);
      assert.equal(d.notificationPreferences.dailyReminders, undefined);
    });

    it('deleting an account removes its public profile and push tokens', async () => {
      const id = uid('gone');
      await setDoc(doc(db, 'users', id), { username: 'goner', subscriptionRequired: true });
      await setDoc(doc(db, 'userTokens', id), { tokens: ['device-token'] });
      await waitFor(() => read(`publicProfiles/${id}`), 'public profile');
      await deleteDoc(doc(db, 'users', id));
      await waitFor(async () => !(await exists(`publicProfiles/${id}`)) && !(await exists(`userTokens/${id}`)), 'cleanup');
    });
  });

  describe('sendNotificationToUser', () => {
    it('a push for a deleted account drops its tokens and doesn\'t recreate the doc', async () => {
      const ghost = uid('ghost');
      const reactor = uid('reactor');
      await setDoc(doc(db, 'users', reactor), { username: 'reactor', displayName: 'Reactor', subscriptionRequired: true });
      await setDoc(doc(db, 'userTokens', ghost), { tokens: ['old-device'] });
      // onCommentCreated → sendNotificationToUser(ghost)
      await setDoc(doc(db, 'users', ghost, 'activityComments', '1', 'comments', 'c1'), {
        commenterUid: reactor, commenterName: 'Spoofed Name', text: 'hi', createdAt: new Date().toISOString(),
      });
      await waitFor(async () => !(await exists(`userTokens/${ghost}`)), 'orphaned tokens removed');
      assert.equal(await exists(`users/${ghost}`), false);
    });
  });

  describe('validateFriendDoc', () => {
    const seedUsers = async (...ids) => {
      for (const id of ids) await setDoc(doc(db, 'users', id), { username: id.slice(0, 15), subscriptionRequired: true });
    };

    it('removes a friend doc no request backs', async () => {
      const victim = uid('victim'); const intruder = uid('intruder');
      await seedUsers(victim, intruder);
      await setDoc(doc(db, 'users', victim, 'friends', intruder), { friendUid: intruder, addedAt: new Date().toISOString() });
      await waitFor(async () => !(await exists(`users/${victim}/friends/${intruder}`)), 'forged doc removed');
    });

    it('removes a friend doc backed only by a pending request', async () => {
      const a = uid('a'); const b = uid('b');
      await seedUsers(a, b);
      await setDoc(doc(db, 'friendRequests', `${a}_${b}`), { fromUid: a, toUid: b, status: 'pending' });
      await setDoc(doc(db, 'users', a, 'friends', b), { friendUid: b, addedAt: new Date().toISOString() });
      await waitFor(async () => !(await exists(`users/${a}/friends/${b}`)), 'unaccepted doc removed');
    });

    it('keeps friend docs the old app writes right after accepting', async () => {
      const a = uid('a'); const b = uid('b');
      await seedUsers(a, b);
      await setDoc(doc(db, 'friendRequests', `${a}_${b}`), { fromUid: a, toUid: b, status: 'pending' });
      await updateDoc(doc(db, 'friendRequests', `${a}_${b}`), { status: 'accepted' });
      await setDoc(doc(db, 'users', a, 'friends', b), { friendUid: b, addedAt: new Date().toISOString() });
      await setDoc(doc(db, 'users', b, 'friends', a), { friendUid: a, addedAt: new Date().toISOString() });
      await sleep(5000);
      assert.equal(await exists(`users/${a}/friends/${b}`), true);
      assert.equal(await exists(`users/${b}/friends/${a}`), true);
    });

    it('keeps friend docs from the new app\'s accept batch', async () => {
      const a = uid('a'); const b = uid('b'); const rid = `${a}_${b}`;
      await seedUsers(a, b);
      await setDoc(doc(db, 'friendRequests', rid), { fromUid: a, toUid: b, status: 'pending' });
      const batch = writeBatch(db);
      batch.update(doc(db, 'friendRequests', rid), { status: 'accepted' });
      batch.set(doc(db, 'users', a, 'friends', b), { friendUid: b, addedAt: new Date().toISOString(), requestId: rid });
      batch.set(doc(db, 'users', b, 'friends', a), { friendUid: a, addedAt: new Date().toISOString(), requestId: rid });
      await batch.commit();
      await sleep(5000);
      assert.equal(await exists(`users/${a}/friends/${b}`), true);
      assert.equal(await exists(`users/${b}/friends/${a}`), true);
    });
  });

  describe('account deletion', () => {
    const callDeleteAccount = (idToken) => fetch(`${FUNCTIONS}/deleteAccount`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ data: {} }),
    });

    async function seedAccount(id) {
      const friend = uid('friend');
      await setDoc(doc(db, 'users', id), { username: id.slice(0, 15), subscriptionRequired: true });
      await setDoc(doc(db, 'users', id, 'dailyHealth', '2026-10-28'), { date: '2026-10-28', steps: 5000 });
      await setDoc(doc(db, 'users', friend), { username: friend.slice(0, 15), subscriptionRequired: true });
      await setDoc(doc(db, 'users', friend, 'activityReactions', '5', 'reactions', id), { reactorUid: id, reactionType: '🔥' });
      return friend;
    }

    it('deleteAccount removes the data, then the Auth account', async () => {
      const { uid: id, idToken } = await signUp();
      const friend = await seedAccount(id);
      const res = await callDeleteAccount(idToken);
      assert.equal(res.status, 200);
      assert.deepEqual((await res.json()).result, { deleted: true });
      assert.equal(await exists(`users/${id}`), false);
      assert.equal(await exists(`users/${id}/dailyHealth/2026-10-28`), false);
      assert.equal(await exists(`users/${friend}/activityReactions/5/reactions/${id}`), false);
      assert.equal(await exists(`users/${friend}`), true);
      assert.equal(await authAccountExists(idToken), false);
    });

    it('deleting the Auth account some other way still clears the data', async () => {
      const { uid: id, idToken } = await signUp();
      const friend = await seedAccount(id);
      await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:delete?key=fake`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }),
      });
      await waitFor(async () => !(await exists(`users/${id}/dailyHealth/2026-10-28`))
        && !(await exists(`users/${friend}/activityReactions/5/reactions/${id}`)), 'cleanup after Auth deletion');
      assert.equal(await exists(`users/${id}`), false);
    });
  });

  describe('revenueCatWebhook', () => {
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;

    it('rejects a wrong secret', async () => {
      const res = await webhook({ type: 'RENEWAL', app_user_id: 'x' }, 'wrong');
      assert.equal(res.status, 401);
    });

    it('a lifetime purchase is active', async () => {
      const id = uid('life');
      await setDoc(doc(db, 'users', id), { username: 'life', subscriptionRequired: true });
      const res = await webhook({ type: 'NON_RENEWING_PURCHASE', app_user_id: id, expiration_at_ms: null, event_timestamp_ms: now });
      assert.equal(res.status, 200);
      const sub = (await read(`users/${id}`)).subscription;
      assert.equal(sub.entitlementActive, true);
      assert.equal(sub.status, 'active');
    });

    it('a billing issue in the grace period keeps access', async () => {
      const id = uid('grace');
      await setDoc(doc(db, 'users', id), { username: 'grace', subscriptionRequired: true });
      await webhook({ type: 'BILLING_ISSUE', app_user_id: id, expiration_at_ms: now - 1000, grace_period_expiration_at_ms: now + 6 * DAY, event_timestamp_ms: now });
      assert.equal((await read(`users/${id}`)).subscription.entitlementActive, true);
    });

    it('an older event arriving late doesn\'t undo a newer one', async () => {
      const id = uid('order');
      await setDoc(doc(db, 'users', id), { username: 'order', subscriptionRequired: true });
      await webhook({ type: 'EXPIRATION', app_user_id: id, expiration_at_ms: now - 1000, event_timestamp_ms: now });
      const res = await webhook({ type: 'RENEWAL', app_user_id: id, expiration_at_ms: now + 30 * DAY, event_timestamp_ms: now - DAY });
      assert.equal((await res.json()).result, 'stale');
      assert.equal((await read(`users/${id}`)).subscription.entitlementActive, false);
    });

    it('a SANDBOX event changes nothing', async () => {
      const id = uid('sandbox');
      await setDoc(doc(db, 'users', id), { username: 'sandboxer', subscriptionRequired: true, subscription: { entitlementActive: true, status: 'active', environment: 'PRODUCTION' } });
      const res = await webhook({ type: 'EXPIRATION', environment: 'SANDBOX', app_user_id: id, expiration_at_ms: now - 1000, event_timestamp_ms: now });
      assert.equal((await res.json()).skipped, 'sandbox');
      assert.equal((await read(`users/${id}`)).subscription.entitlementActive, true);
    });

    it('a TEST event changes nothing', async () => {
      const id = uid('test');
      await setDoc(doc(db, 'users', id), { username: 'tester', subscriptionRequired: true, subscription: { entitlementActive: true, status: 'active' } });
      await webhook({ type: 'TEST', app_user_id: id, event_timestamp_ms: now });
      assert.equal((await read(`users/${id}`)).subscription.entitlementActive, true);
    });

    it('a deleted account is not recreated', async () => {
      const id = uid('deleted');
      const res = await webhook({ type: 'RENEWAL', app_user_id: id, expiration_at_ms: now + 30 * DAY, event_timestamp_ms: now });
      assert.equal((await res.json()).result, 'no_account');
      assert.equal(await exists(`users/${id}`), false);
    });

    it('a purchase that beats the first profile write creates the doc for a live account', async () => {
      const id = await createAuthUser();
      const res = await webhook({ type: 'INITIAL_PURCHASE', app_user_id: id, period_type: 'TRIAL', expiration_at_ms: now + 7 * DAY, event_timestamp_ms: now });
      assert.equal((await res.json()).result, 'applied');
      assert.equal((await read(`users/${id}`)).subscription.status, 'trial');
      await waitFor(async () => (await read(`users/${id}`))?.subscriptionRequired === true, 'new-account stamp');
    });

    it('a transfer moves access from one account to the other', async () => {
      const from = uid('from'); const to = uid('to');
      await setDoc(doc(db, 'users', from), { username: 'from', subscriptionRequired: true, subscription: { entitlementActive: true, status: 'active' } });
      await setDoc(doc(db, 'users', to), { username: 'to', subscriptionRequired: true });
      await webhook({ type: 'TRANSFER', transferred_from: [from], transferred_to: [to], event_timestamp_ms: now });
      assert.equal((await read(`users/${from}`)).subscription.entitlementActive, false);
      assert.equal((await read(`users/${to}`)).subscription.entitlementActive, true);
    });
  });
});
