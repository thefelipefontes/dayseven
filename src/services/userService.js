import { doc, getDoc, getDocFromServer, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, limit, onSnapshot, runTransaction } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '../firebase';
import { Capacitor } from '@capacitor/core';
import { FirebaseFirestore } from '@capacitor-firebase/firestore';
import { FirebaseStorage } from '@capacitor-firebase/storage';
import { Filesystem, Directory } from '@capacitor/filesystem';
import * as Sentry from '@sentry/react';
import { callFunction } from './cloudFunctions';

// Convert a Date to YYYY-MM-DD string in local timezone (avoids UTC date shifting)
const toLocalDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Check if running in native app
const isNative = Capacitor.isNativePlatform();

// Simple in-memory cache for frequently accessed data
const cache = {
  userProfiles: new Map(),
  userActivities: new Map(),
  userGoals: new Map(),
  customActivities: new Map(),
  cacheExpiry: 60000, // 1 minute cache expiry
  timestamps: new Map(),
};

// Check if cache is still valid
const isCacheValid = (key) => {
  const timestamp = cache.timestamps.get(key);
  if (!timestamp) return false;
  return Date.now() - timestamp < cache.cacheExpiry;
};

// Set cache with timestamp
const setCache = (cacheMap, key, value) => {
  cacheMap.set(key, value);
  cache.timestamps.set(`${cacheMap}_${key}`, Date.now());
};

// Clear cache for a specific user (call after updates)
export const clearUserCache = (uid) => {
  cache.userProfiles.delete(uid);
  cache.userActivities.delete(uid);
  cache.userGoals.delete(uid);
  cache.customActivities.delete(uid);
  // Also clear timestamps
  cache.timestamps.delete(`profile_${uid}`);
  cache.timestamps.delete(`activities_${uid}`);
  cache.timestamps.delete(`goals_${uid}`);
  cache.timestamps.delete(`customActivities_${uid}`);
};

// Sign-out: drop every cached read, so the next sign-in (the same account or another)
// starts from fresh reads before anything is saved. Unsent activity changes stay in
// localStorage and go out the next time that account signs in.
export const resetUserServiceSession = () => {
  Object.values(cache).forEach((v) => { if (v instanceof Map) v.clear(); });
  serverActivitiesLoaded.clear();
  outboxMemory.clear();
};

// Helper function to add timeout to Firestore operations (for web SDK fallback)
const withTimeout = (promise, timeoutMs = 10000) => {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Firestore operation timed out')), timeoutMs)
    )
  ]);
};

// Retry wrapper for transient failures
const withRetry = async (fn, maxRetries = 2, delayMs = 500) => {
  let lastError;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < maxRetries) {
        // Only retry on network/timeout errors, not permission errors
        if (error.code === 'permission-denied' || error.code === 'not-found') {
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, delayMs * (i + 1)));
      }
    }
  }
  throw lastError;
};

// Firebase project ID for REST API calls
const FIREBASE_PROJECT_ID = 'dayseven-f1a89';

// Convert a JS value to Firestore REST API format
// Used for REST-based writes to bypass Firestore SDK's offline persistence queue
const jsToFirestoreValue = (value) => {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return value.length > 0
      ? { arrayValue: { values: value.map(jsToFirestoreValue) } }
      : { arrayValue: {} };
  }
  if (typeof value === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) fields[k] = jsToFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
};

// Users whose activities were read successfully this session. A failed read shows as an
// empty list, so anything that would act on "the whole history" (records, the launch
// recalc) checks this before trusting what it has.
const serverActivitiesLoaded = new Set();

export const activitiesLoadedFromServer = (uid) => serverActivitiesLoaded.has(uid);

export async function createUserProfile(user) {
  const path = `users/${user.uid}`;

  try {
    if (isNative) {
      // Use native Firestore
      const { snapshot } = await withTimeout(FirebaseFirestore.getDocument({ reference: path }));

      if (!snapshot?.data) {
        // Use merge: true so we never wipe existing data (e.g. goals, hasCompletedOnboarding)
        // Only include safe profile metadata — onboarding fields are set by the onboarding flow itself
        await FirebaseFirestore.setDocument({
          reference: path,
          data: {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName || null,
            photoURL: user.photoURL || null,
            authProvider: user.authProvider || null,
            createdAt: new Date().toISOString(),
            // Subscription-only cutover: brand-new accounts must hold an active
            // subscription to enter the app. Existing accounts predate this field
            // and are grandfathered into full access for life (see applyProStatus
            // / the hard-paywall gate in App.jsx). Only ever set on first creation.
            subscriptionRequired: true
          },
          merge: true
        });
      } else if (user.authProvider && !snapshot.data.authProvider) {
        // Update authProvider if it wasn't set before (for existing users)
        await FirebaseFirestore.setDocument({
          reference: path,
          data: { authProvider: user.authProvider },
          merge: true
        });
      }
    } else {
      // Use web Firestore
      const userRef = doc(db, 'users', user.uid);
      const userDoc = await withTimeout(getDoc(userRef));

      if (!userDoc.exists()) {
        // Use merge: true so we never wipe existing data (e.g. goals, hasCompletedOnboarding)
        // Only include safe profile metadata — onboarding fields are set by the onboarding flow itself
        await withTimeout(setDoc(userRef, {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName || null,
          photoURL: user.photoURL || null,
          authProvider: user.authProvider || null,
          createdAt: new Date().toISOString(),
          // Subscription-only cutover: brand-new accounts must hold an active
          // subscription to enter the app. Existing accounts predate this field
          // and are grandfathered into full access for life (see applyProStatus
          // / the hard-paywall gate in App.jsx). Only ever set on first creation.
          subscriptionRequired: true
        }, { merge: true }));
      } else if (user.authProvider && !userDoc.data().authProvider) {
        // Update authProvider if it wasn't set before (for existing users)
        await withTimeout(setDoc(userRef, { authProvider: user.authProvider }, { merge: true }));
      }
    }
  } catch (error) {
    // Continue anyway - profile will be created later
  }

  return path;
}

export async function getUserProfile(uid, forceRefresh = false) {
  // Check cache first (unless force refresh)
  const cacheKey = `profile_${uid}`;
  if (!forceRefresh && cache.userProfiles.has(uid) && isCacheValid(cacheKey)) {
    return cache.userProfiles.get(uid);
  }

  const path = `users/${uid}`;

  try {
    let profile;
    if (isNative && forceRefresh) {
      // Bypass Capacitor Firestore SDK cache by calling REST API directly
      // This ensures we get fresh data (e.g., weekCelebrations set by watch)
      try {
        const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
        const { token } = await FirebaseAuthentication.getIdToken();
        const restUrl = `https://firestore.googleapis.com/v1/projects/dayseven-f1a89/databases/(default)/documents/users/${uid}`;
        const response = await fetch(restUrl, {
          headers: { 'Authorization': `Bearer ${token}` },
          cache: 'no-store'
        });
        const json = await response.json();
        const fields = json?.fields;
        if (fields) {
          profile = parseFirestoreFields(fields);
        } else {
          profile = null;
        }
      } catch (restErr) {
        console.warn('[getUserProfile] REST failed, using Capacitor:', restErr);
        const { snapshot } = await withTimeout(FirebaseFirestore.getDocument({ reference: path }));
        profile = snapshot?.data || null;
      }
    } else if (isNative) {
      // Wrap the native plugin read in withTimeout: the Capacitor Firestore
      // call can hang indefinitely if the server round-trip never settles
      // (cold cache + unreachable backend), which would otherwise trap the
      // startup auth gate forever. On timeout this rejects → caught below.
      const { snapshot } = await withTimeout(FirebaseFirestore.getDocument({ reference: path }));
      profile = snapshot?.data || null;
    } else {
      const userRef = doc(db, 'users', uid);
      const userDoc = await withTimeout(getDoc(userRef));
      profile = userDoc.exists() ? userDoc.data() : null;
    }

    // Cache the result
    if (profile) {
      cache.userProfiles.set(uid, profile);
      cache.timestamps.set(cacheKey, Date.now());
    }

    return profile;
  } catch (error) {
    // Report before falling back — this read gates app startup, so a timeout or
    // error here is the prime suspect for the "stuck on 7" stall. `timedOut`
    // distinguishes a genuine hang (withTimeout fired) from a real backend error.
    Sentry.captureException(error, {
      tags: { phase: 'getUserProfile', isNative, timedOut: error?.message === 'Firestore operation timed out' },
      extra: { servedFromCache: cache.userProfiles.has(uid) },
    });
    // Return cached data if available, even if expired
    if (cache.userProfiles.has(uid)) {
      return cache.userProfiles.get(uid);
    }
    return null;
  }
}

/**
 * Real-time subscription to a user doc's `challengeStats` field. The cloud function
 * increments wins/losses/accepted server-side; without a listener the local userProfile
 * stays stuck on whatever was loaded at login (no auto-refresh). This keeps the
 * Challenges-tab W-L pill, OwnProfileModal, and completion-rate computation in sync
 * the moment the server resolves a challenge.
 *
 * Also invalidates the cached profile so any `getUserProfile(uid)` re-fetch returns fresh data.
 */
export function subscribeToUserChallengeStats(uid, onUpdate) {
  if (!uid || typeof onUpdate !== 'function') return () => {};

  // The listener sees every write to the user doc (activity saves, badge resets, streaks),
  // so only report a real challengeStats change. Reporting each snapshot re-rendered the
  // whole app and reloaded the Friends feed on every unrelated write.
  let lastJson = null;
  const apply = (challengeStats) => {
    const json = JSON.stringify(challengeStats);
    if (json === lastJson) return;
    lastJson = json;
    // Refresh cached profile in place so other readers see the new counters.
    if (cache.userProfiles.has(uid)) {
      const cached = cache.userProfiles.get(uid);
      cache.userProfiles.set(uid, { ...cached, challengeStats });
    }
    onUpdate(challengeStats);
  };

  if (isNative) {
    const callbackIdRef = { current: null };
    let cancelled = false;

    FirebaseFirestore.addDocumentSnapshotListener(
      { reference: `users/${uid}` },
      (event, error) => {
        if (error) {
          console.error('[userService] subscribeToUserChallengeStats error:', error);
          return;
        }
        const stats = event?.snapshot?.data?.challengeStats;
        if (stats !== undefined) apply(stats);
      }
    ).then(callbackId => {
      if (cancelled) {
        FirebaseFirestore.removeSnapshotListener({ callbackId }).catch(() => {});
      } else {
        callbackIdRef.current = callbackId;
      }
    }).catch(err => {
      console.error('[userService] subscribeToUserChallengeStats init failed:', err);
    });

    return () => {
      cancelled = true;
      if (callbackIdRef.current) {
        FirebaseFirestore.removeSnapshotListener({ callbackId: callbackIdRef.current }).catch(() => {});
        callbackIdRef.current = null;
      }
    };
  }

  const userRef = doc(db, 'users', uid);
  const unsub = onSnapshot(
    userRef,
    (snap) => {
      const stats = snap.data()?.challengeStats;
      if (stats !== undefined) apply(stats);
    },
    (err) => console.error('[userService] subscribeToUserChallengeStats:', err)
  );
  return unsub;
}

// Parse Firestore REST API fields into plain JS objects
function parseFirestoreFields(fields) {
  const result = {};
  for (const [key, val] of Object.entries(fields)) {
    result[key] = parseFirestoreValue(val);
  }
  return result;
}

function parseFirestoreValue(val) {
  if (val.stringValue !== undefined) return val.stringValue;
  if (val.integerValue !== undefined) return parseInt(val.integerValue);
  if (val.doubleValue !== undefined) return val.doubleValue;
  if (val.booleanValue !== undefined) return val.booleanValue;
  if (val.nullValue !== undefined) return null;
  if (val.timestampValue !== undefined) return val.timestampValue;
  if (val.arrayValue) {
    return (val.arrayValue.values || []).map(v => parseFirestoreValue(v));
  }
  if (val.mapValue) {
    return parseFirestoreFields(val.mapValue.fields || {});
  }
  return null;
}

// `replace: true` writes each top-level field in `data` whole. The default merge is a deep
// merge, so a key removed from a nested map (an injury week dropped from
// injuryMode.frozenWeeks, an old week in weeklyPlan.weeks) stays on the server and comes
// back on the next launch. Only replace fields the caller holds in full.
export async function updateUserProfile(uid, data, { replace = false } = {}) {
  const path = `users/${uid}`;

  // Optimistically update cache if we have it
  if (cache.userProfiles.has(uid)) {
    const current = cache.userProfiles.get(uid);
    cache.userProfiles.set(uid, { ...current, ...data });
    cache.timestamps.set(`profile_${uid}`, Date.now());
  }

  try {
    if (replace) {
      // updateData/updateDoc set each top-level key to exactly this value.
      if (isNative) {
        await FirebaseFirestore.updateDocument({ reference: path, data });
      } else {
        await withTimeout(updateDoc(doc(db, 'users', uid), data));
      }
    } else if (isNative) {
      // Use setDocument with merge instead of updateDocument to prevent
      // Firestore SDK offline cache issues from wiping unrelated fields
      await FirebaseFirestore.setDocument({
        reference: path,
        data: data,
        merge: true
      });
    } else {
      const userRef = doc(db, 'users', uid);
      await withTimeout(setDoc(userRef, data, { merge: true }));
    }
  } catch (error) {
    // Revert cache on error
    cache.userProfiles.delete(uid);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Activity writes: an outbox of changes, sent by read-modify-write.
//
// Every change to the activities array (add, edit, delete) is an operation keyed by
// activity id, kept in a per-user outbox that survives a relaunch (localStorage). Sending
// it reads the server's current array along with the document's updateTime, applies the
// queued operations, and writes back with that updateTime as a precondition, the same
// way the Watch's FirestoreService.batchSave does. If anything changed the document in
// between (usually the Watch), Firestore rejects the write and we re-read and try again.
//
// What this replaces: the phone used to PATCH its whole in-memory list with no
// precondition, and swallow every failure. An activity logged with no signal was never
// saved and then vanished at the next foreground refresh, which replaced the local list
// with the server copy; and a stale list could overwrite what the Watch had just saved.
//
// Operations are idempotent (upsert by id, delete by id), so applying the outbox to a
// list that already reflects some of it is harmless. That is what lets every fresh read
// merge in the unsent changes (getUserActivities) without double-adding anything.
// ---------------------------------------------------------------------------

const outboxKey = (uid) => `activityOutbox:${uid}`;
// The live copy, per uid. localStorage is the durable copy, and it can refuse a write
// (quota, private mode); the session keeps working from memory when it does.
const outboxMemory = new Map();
let outboxSeq = 0;

const readOutbox = (uid) => {
  if (outboxMemory.has(uid)) return outboxMemory.get(uid);
  let ops = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(outboxKey(uid)) || '[]');
    if (Array.isArray(parsed)) ops = parsed.filter(o => o && o.id != null && (o.op === 'delete' || (o.op === 'upsert' && o.activity)));
  } catch (e) {
    ops = [];
  }
  outboxMemory.set(uid, ops);
  return ops;
};

const writeOutbox = (uid, ops) => {
  outboxMemory.set(uid, ops);
  try {
    if (ops.length > 0) localStorage.setItem(outboxKey(uid), JSON.stringify(ops));
    else localStorage.removeItem(outboxKey(uid));
  } catch (e) {
    Sentry.captureException(e, { tags: { phase: 'activityOutbox.persist' }, extra: { pending: ops.length } });
  }
};

export const hasPendingActivityChanges = (uid) => !!uid && readOutbox(uid).length > 0;

// Apply outbox operations to a list of activities. New activities go to the front, in the
// order they were queued — the same place the app puts a freshly logged one.
const applyActivityOps = (list, ops) => {
  let result = [...(list || [])];
  const added = [];
  for (const o of ops || []) {
    const key = String(o.id);
    if (o.op === 'delete') {
      result = result.filter(a => String(a?.id) !== key);
      for (let i = added.length - 1; i >= 0; i--) if (String(added[i].id) === key) added.splice(i, 1);
    } else if (o.op === 'upsert' && o.activity) {
      const i = result.findIndex(a => String(a?.id) === key);
      const j = added.findIndex(a => String(a.id) === key);
      if (i >= 0) result[i] = o.activity;
      else if (j >= 0) added[j] = o.activity;
      else added.push(o.activity);
    }
  }
  return [...added, ...result];
};

// Entries the screens can't render — a missing or non-string `date` crashed Home's sort in
// a loop. Hidden from reads only: writes keep the server's array as it is, so nothing is
// deleted on the user's behalf.
const reportedMalformed = new Set();
const withoutMalformed = (uid, list) => {
  const ok = (list || []).filter(a => a && typeof a === 'object' && typeof a.date === 'string');
  if (ok.length !== (list || []).length && !reportedMalformed.has(uid)) {
    reportedMalformed.add(uid);
    console.warn(`[getUserActivities] skipped ${(list || []).length - ok.length} malformed activities`);
    Sentry.captureMessage('Malformed activities skipped', { level: 'warning', extra: { skipped: (list || []).length - ok.length } });
  }
  return ok;
};

// Strip undefined (Firestore rejects it) and anything JSON can't hold, so what is sent is
// exactly what the outbox persisted.
const cleanActivity = (activity) => JSON.parse(JSON.stringify(activity));

const getIdToken = async (forceRefresh = false) => {
  const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
  const { token } = await FirebaseAuthentication.getIdToken(forceRefresh ? { forceRefresh: true } : undefined);
  return token;
};

const activitiesDocUrl = (uid) => `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${uid}`;

// Activities are parsed field by field; a value type we don't handle is left out rather
// than guessed at.
const parseRestActivityValue = (val) => {
  if (val.stringValue !== undefined) return val.stringValue;
  if (val.integerValue !== undefined) return parseInt(val.integerValue);
  if (val.doubleValue !== undefined) return val.doubleValue;
  if (val.booleanValue !== undefined) return val.booleanValue;
  if (val.nullValue !== undefined) return null;
  if (val.arrayValue) return (val.arrayValue.values || []).map(parseRestActivityValue);
  if (val.mapValue) {
    const obj = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      obj[k] = parseRestActivityValue(v);
    }
    return obj;
  }
  return undefined;
};

// users/{uid}.activities over REST, plus the document's updateTime for use as a write
// precondition. Throws on any failure: an error body (401/429/5xx) has no fields and used
// to parse as "no activities", which could then be saved over the real history.
const fetchActivitiesREST = async (uid, token) => {
  const response = await withTimeout(fetch(`${activitiesDocUrl(uid)}?mask.fieldPaths=activities`, {
    headers: { 'Authorization': `Bearer ${token}` },
    cache: 'no-store'
  }), 15000);
  if (!response.ok) {
    const error = new Error(`REST ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const json = await response.json();
  const values = json?.fields?.activities?.arrayValue?.values || [];
  const activities = values.map(v => {
    const parsed = {};
    for (const [key, val] of Object.entries(v.mapValue?.fields || {})) {
      const parsedVal = parseRestActivityValue(val);
      if (parsedVal !== undefined) parsed[key] = parsedVal;
    }
    return parsed;
  });
  return { activities, updateTime: json?.updateTime || null };
};

const preconditionError = () => {
  const error = new Error('activities changed since they were read');
  error.code = 'precondition-failed';
  return error;
};

// One read-modify-write over REST. Throws `precondition-failed` when the document changed
// after our read (or the write contended with another one), so the caller re-reads.
const writeOpsOnceREST = async (uid, ops, token) => {
  const { activities: serverList, updateTime } = await fetchActivitiesREST(uid, token);
  const next = applyActivityOps(serverList, ops);
  if (!updateTime) {
    // Shouldn't happen (every read of an existing document carries one). Without it the
    // write below has no conflict check, so make it visible.
    console.warn('[activityOutbox] read returned no updateTime; writing without a precondition');
    Sentry.captureMessage('activityOutbox: no updateTime on read', { level: 'warning' });
  }

  let url = `${activitiesDocUrl(uid)}?updateMask.fieldPaths=activities`;
  url += updateTime
    ? `&currentDocument.updateTime=${encodeURIComponent(updateTime)}`
    : '&currentDocument.exists=true';
  const response = await withTimeout(fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields: { activities: jsToFirestoreValue(next) } }),
    cache: 'no-store'
  }), 15000);

  if (!response.ok) {
    const text = await response.text();
    let status = null;
    try { status = JSON.parse(text)?.error?.status || null; } catch (e) { /* not JSON */ }
    if (status === 'FAILED_PRECONDITION' || status === 'ABORTED' || response.status === 409) {
      throw preconditionError();
    }
    const error = new Error(`REST save failed: ${response.status} ${text.slice(0, 200)}`);
    error.status = response.status;
    throw error;
  }
  return next;
};

// Send these operations. Returns the array as written. Throws when they could not be sent.
//
// Native writes go over REST, never the Firestore SDK: the SDK queues writes while the app
// is backgrounded and replays them on foreground, and those replays used to overwrite what
// the Watch had saved in between.
const writeOpsToServer = async (uid, ops) => {
  if (!isNative) {
    // A transaction is the web SDK's read-modify-write: it re-runs if the document changes
    // underneath it, and fails while offline.
    const userRef = doc(db, 'users', uid);
    let written = null;
    await withTimeout(runTransaction(db, async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists()) throw new Error('user document missing');
      written = applyActivityOps(snap.data().activities || [], ops);
      tx.update(userRef, { activities: written });
    }), 20000);
    return written;
  }

  let token = await getIdToken();
  let refreshedToken = false;
  let networkRetried = false;
  for (let attempt = 0; ; attempt++) {
    try {
      return await writeOpsOnceREST(uid, ops, token);
    } catch (error) {
      if (error.status === 401 && !refreshedToken) {
        refreshedToken = true;
        token = await getIdToken(true);
        continue;
      }
      if (error.code === 'precondition-failed' && attempt < 5) {
        await new Promise(resolve => setTimeout(resolve, 150 + Math.random() * 350));
        continue;
      }
      // One quick retry for a dropped request (a fetch TypeError or our timeout). A 4xx
      // means the server answered, so retrying right away won't change it.
      if (!error.status && error.code !== 'precondition-failed' && !networkRetried) {
        networkRetried = true;
        await new Promise(resolve => setTimeout(resolve, 800));
        continue;
      }
      throw error;
    }
  }
};

// One pass: send everything queued right now, then drop exactly those operations.
// Anything queued while this was in flight stays for the next pass.
const flushOnce = async (uid) => {
  const ops = readOutbox(uid);
  if (ops.length === 0) return;
  const written = await writeOpsToServer(uid, ops);
  const sent = new Set(ops.map(o => o.seq));
  const remaining = readOutbox(uid).filter(o => !sent.has(o.seq));
  writeOutbox(uid, remaining);
  serverActivitiesLoaded.add(uid);
  cache.userActivities.set(uid, withoutMalformed(uid, applyActivityOps(written, remaining)));
  cache.timestamps.set(`activities_${uid}`, Date.now());
  console.log('[activityOutbox] sent', ops.length, 'change(s);', written.length, 'activities on server');
};

const flushState = new Map(); // uid -> { running: Promise | null, again: boolean }

// Send the outbox. Resolves once everything queued before (and during) the call is on the
// server; rejects if a pass fails, leaving the changes queued. Safe to call often: calls
// that overlap share one run, which keeps going while new changes arrive.
export function flushActivityOutbox(uid) {
  if (!uid) return Promise.resolve();
  let state = flushState.get(uid);
  if (state?.running) {
    state.again = true;
    return state.running;
  }
  state = { running: null, again: false };
  flushState.set(uid, state);
  state.running = (async () => {
    try {
      do {
        state.again = false;
        await flushOnce(uid);
      } while (state.again);
    } finally {
      state.running = null;
    }
  })();
  return state.running;
}

// Queue activity changes and send them. `upserts` are whole activity objects (added or
// edited); `deletes` are activity ids. Resolves once the server has them. On failure it
// throws with `error.queued = true`: the changes are kept, shown in every read, and sent
// on the next foreground, reconnect or retry tick.
export async function saveActivityChanges(uid, { upserts = [], deletes = [] } = {}) {
  if (!uid) throw new Error('saveActivityChanges: no uid');
  if (upserts.some(a => a && a.id == null)) {
    // Ops are keyed by id; one without can't be applied or matched later.
    console.warn('[saveActivityChanges] skipped an activity with no id');
    Sentry.captureMessage('saveActivityChanges: activity without id', { level: 'warning' });
  }
  const ops = [
    ...upserts.filter(a => a && a.id != null).map(a => ({ op: 'upsert', id: String(a.id), activity: cleanActivity(a) })),
    ...deletes.filter(id => id != null).map(id => ({ op: 'delete', id: String(id) })),
  ].map(o => ({ ...o, seq: `${Date.now()}-${outboxSeq++}` }));
  if (ops.length === 0) return;

  // A newer change to the same activity replaces the queued one.
  const ids = new Set(ops.map(o => o.id));
  writeOutbox(uid, [...readOutbox(uid).filter(o => !ids.has(o.id)), ...ops]);
  if (cache.userActivities.has(uid)) {
    cache.userActivities.set(uid, withoutMalformed(uid, applyActivityOps(cache.userActivities.get(uid), ops)));
    cache.timestamps.set(`activities_${uid}`, Date.now());
  }

  try {
    await flushActivityOutbox(uid);
  } catch (error) {
    console.warn('[saveActivityChanges] not sent yet, kept in outbox:', error.message);
    const queued = new Error(`Saved on this device; not synced yet (${error.message})`);
    queued.queued = true;
    queued.cause = error;
    throw queued;
  }
}

export async function getUserActivities(uid, forceRefresh = false) {
  // Check cache first (unless force refresh)
  if (!forceRefresh && cache.userActivities.has(uid) && isCacheValid(`activities_${uid}`)) {
    return cache.userActivities.get(uid);
  }

  const path = `users/${uid}`;

  try {
    let activities;
    if (isNative && forceRefresh) {
      // Bypass Capacitor Firestore cache by calling REST API directly
      try {
        ({ activities } = await fetchActivitiesREST(uid, await getIdToken()));
        console.log('[getUserActivities] REST got', activities.length, 'activities');
      } catch (restErr) {
        // This session's own copy beats the native SDK's cache, which never sees the REST
        // writes and can be days old: offline, falling back to it hid recently synced
        // workouts. Use the SDK only when there's nothing better (a cold launch offline).
        if (cache.userActivities.has(uid)) throw restErr;
        console.warn('[getUserActivities] REST failed, using Capacitor:', restErr);
        const { snapshot } = await withTimeout(FirebaseFirestore.getDocument({ reference: path }));
        activities = snapshot?.data?.activities || [];
      }
    } else if (isNative) {
      const { snapshot } = await withTimeout(FirebaseFirestore.getDocument({ reference: path }));
      activities = snapshot?.data?.activities || [];
    } else {
      const userRef = doc(db, 'users', uid);
      const userDoc = await withTimeout(getDoc(userRef));
      activities = userDoc.exists() ? (userDoc.data().activities || []) : [];
    }

    // Unsent changes from this device go on top of whatever the server has, so a refresh
    // never takes away a workout that just hasn't synced yet.
    activities = withoutMalformed(uid, applyActivityOps(activities, readOutbox(uid)));
    cache.userActivities.set(uid, activities);
    cache.timestamps.set(`activities_${uid}`, Date.now());
    serverActivitiesLoaded.add(uid);

    return activities;
  } catch (error) {
    // Return cached data if available, even if expired. Either way, include the outbox:
    // offline, the unsent changes are the part the user is most likely looking for.
    const base = cache.userActivities.get(uid) || [];
    return withoutMalformed(uid, applyActivityOps(base, readOutbox(uid)));
  }
}

export async function checkUsernameAvailable(username, currentUid = null) {
  const lowerUsername = username.toLowerCase();
  const path = `usernames/${lowerUsername}`;

  try {
    if (isNative) {
      // Check /usernames collection first
      const { snapshot } = await withTimeout(FirebaseFirestore.getDocument({ reference: path }));
      if (snapshot?.data) {
        // Allow if it belongs to the current user (reclaiming their own username)
        if (currentUid && snapshot.data.uid === currentUid) return true;
        return false; // Reserved by someone else
      }

      // Also check public profiles for legacy users who don't have a /usernames doc
      // (user docs can't be queried; publicProfiles mirrors their usernames)
      const { snapshots } = await FirebaseFirestore.getCollection({
        reference: 'publicProfiles',
        compositeFilter: {
          type: 'and',
          queryConstraints: [
            { type: 'where', fieldPath: 'username', opStr: '==', value: lowerUsername }
          ]
        },
        queryConstraints: [
          { type: 'limit', limit: 2 }
        ]
      });
      if (snapshots?.length) {
        // Allow if the only match is the current user
        if (currentUid && snapshots.length === 1 && snapshots[0]?.id === currentUid) return true;
        return false;
      }
      return true;
    } else {
      // Check /usernames collection first
      const usernameRef = doc(db, 'usernames', lowerUsername);
      const usernameDoc = await getDoc(usernameRef);
      if (usernameDoc.exists()) {
        // Allow if it belongs to the current user
        if (currentUid && usernameDoc.data().uid === currentUid) return true;
        return false; // Reserved by someone else
      }

      // Also check public profiles for legacy users (user docs can't be queried)
      const usersQuery = query(collection(db, 'publicProfiles'), where('username', '==', lowerUsername), limit(2));
      const usersSnapshot = await getDocs(usersQuery);
      if (!usersSnapshot.empty) {
        if (currentUid && usersSnapshot.size === 1 && usersSnapshot.docs[0].id === currentUid) return true;
        return false;
      }
      return true;
    }
  } catch (error) {
    return true; // Assume available on error
  }
}

export async function saveUsername(uid, username) {
  const lowerUsername = username.toLowerCase();
  const userPath = `users/${uid}`;
  const usernamePath = `usernames/${lowerUsername}`;

  try {
    if (isNative) {
      await FirebaseFirestore.setDocument({
        reference: userPath,
        data: { username: lowerUsername },
        merge: true
      });
      await FirebaseFirestore.setDocument({
        reference: usernamePath,
        data: { uid }
      });
    } else {
      const userRef = doc(db, 'users', uid);
      await setDoc(userRef, { username: lowerUsername }, { merge: true });
      const usernameRef = doc(db, 'usernames', lowerUsername);
      await setDoc(usernameRef, { uid });
    }
  } catch (error) {
    throw error;
  }
}

/**
 * Rename the user's username. Claims the new /usernames/{new} reservation
 * before releasing the old one — if the claim fails (race / taken), the old
 * handle is still ours. Friends lists / feed / leaderboard re-resolve the
 * handle live via getUserProfile, so no denormalization backfill needed.
 */
export async function updateUsername(uid, currentUsername, newUsername) {
  const lowerNew = String(newUsername || '').toLowerCase();
  const lowerOld = String(currentUsername || '').toLowerCase();
  if (!uid) throw new Error('missing_uid');
  if (!lowerNew) throw new Error('missing_username');
  if (lowerNew === lowerOld) return;

  // Claim new reservation first so we never lose the lock on our own handle.
  if (isNative) {
    await FirebaseFirestore.setDocument({
      reference: `usernames/${lowerNew}`,
      data: { uid }
    });
    await FirebaseFirestore.setDocument({
      reference: `users/${uid}`,
      data: { username: lowerNew },
      merge: true
    });
    if (lowerOld && lowerOld !== lowerNew) {
      try {
        await FirebaseFirestore.deleteDocument({ reference: `usernames/${lowerOld}` });
      } catch (e) {
        // Old reservation may already be gone — non-fatal.
      }
    }
  } else {
    await setDoc(doc(db, 'usernames', lowerNew), { uid });
    await setDoc(doc(db, 'users', uid), { username: lowerNew }, { merge: true });
    if (lowerOld && lowerOld !== lowerNew) {
      try {
        await deleteDoc(doc(db, 'usernames', lowerOld));
      } catch (e) {
        // Old reservation may already be gone — non-fatal.
      }
    }
  }

  if (cache.userProfiles.has(uid)) {
    cache.userProfiles.set(uid, { ...cache.userProfiles.get(uid), username: lowerNew });
    cache.timestamps.set(`profile_${uid}`, Date.now());
  }
}

/**
 * Update the user's display name. Writes both Firestore (`users/{uid}.displayName`)
 * and the Firebase Auth profile, since the rest of the app reads from either.
 * Friends/feed/leaderboard re-resolve the name live via getUserProfile.
 */
export async function updateDisplayName(uid, displayName) {
  if (!uid) throw new Error('missing_uid');
  const trimmed = String(displayName || '').trim();
  if (!trimmed) throw new Error('missing_displayName');

  if (isNative) {
    await FirebaseFirestore.setDocument({
      reference: `users/${uid}`,
      data: { displayName: trimmed },
      merge: true
    });
    try {
      const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
      await FirebaseAuthentication.updateProfile({ displayName: trimmed });
    } catch (e) {
      // Auth profile sync is best-effort — Firestore is the source of truth in-app.
    }
  } else {
    await setDoc(doc(db, 'users', uid), { displayName: trimmed }, { merge: true });
    try {
      const { updateProfile } = await import('firebase/auth');
      const { auth } = await import('../firebase');
      if (auth.currentUser) await updateProfile(auth.currentUser, { displayName: trimmed });
    } catch (e) {
      // Best-effort.
    }
  }

  if (cache.userProfiles.has(uid)) {
    cache.userProfiles.set(uid, { ...cache.userProfiles.get(uid), displayName: trimmed });
    cache.timestamps.set(`profile_${uid}`, Date.now());
  }
}

export async function saveCustomActivities(uid, customActivities) {
  // Update cache immediately (optimistic update)
  cache.customActivities.set(uid, customActivities);
  cache.timestamps.set(`customActivities_${uid}`, Date.now());

  const path = `users/${uid}`;

  try {
    await withRetry(async () => {
      if (isNative) {
        await FirebaseFirestore.setDocument({
          reference: path,
          data: { customActivities },
          merge: true
        });
      } else {
        const userRef = doc(db, 'users', uid);
        await withTimeout(setDoc(userRef, { customActivities }, { merge: true }));
      }
    });
  } catch (error) {
    // Don't throw - optimistic update already applied
  }
}

export async function getCustomActivities(uid, forceRefresh = false) {
  // Check cache first
  if (!forceRefresh && cache.customActivities.has(uid) && isCacheValid(`customActivities_${uid}`)) {
    return cache.customActivities.get(uid);
  }

  const path = `users/${uid}`;

  try {
    let customActivities;
    if (isNative) {
      const { snapshot } = await withTimeout(FirebaseFirestore.getDocument({ reference: path }));
      customActivities = snapshot?.data?.customActivities || [];
    } else {
      const userRef = doc(db, 'users', uid);
      const userDoc = await withTimeout(getDoc(userRef));
      customActivities = userDoc.exists() ? (userDoc.data().customActivities || []) : [];
    }

    // Cache the result
    cache.customActivities.set(uid, customActivities);
    cache.timestamps.set(`customActivities_${uid}`, Date.now());

    return customActivities;
  } catch (error) {
    // Return cached data if available
    if (cache.customActivities.has(uid)) {
      return cache.customActivities.get(uid);
    }
    // null, not []: the caller must not take a failed read for "no custom activities" and
    // let the next edit save a one-item list over the real one.
    return null;
  }
}

// Sunday-start week key ('YYYY-MM-DD') for today, matching utils/streaks.
function currentWeekKey() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function saveUserGoals(uid, goals) {
  // Update cache immediately (optimistic update)
  cache.userGoals.set(uid, goals);
  cache.timestamps.set(`goals_${uid}`, Date.now());

  const path = `users/${uid}`;

  // Record which goals took effect from which week, so streak math can judge each past
  // week against the goals that were actually in force then. Without this, lowering a
  // goal retroactively marks earlier weeks as met and inflates the streak.
  //
  // Goals only ever change on a Sunday (see utils/goalsSchedule), so a week key is
  // exactly the right granularity — an entry always covers whole weeks, never a split one.
  //
  // Appended here rather than at the call sites: every goal write funnels through this
  // function, so history can't be missed by a path that forgot to record it.
  // Read the existing history here rather than making callers pass it — this function has
  // five call sites and one forgetting would silently truncate the record to a single entry.
  //
  // If that read fails we write goals ALONE and leave goalHistory untouched. Writing a
  // fresh single-entry array on a failed read would destroy the very history we're keeping.
  const weekKey = currentWeekKey();
  let history = null;
  try {
    const profile = await getUserProfile(uid);
    if (profile) {
      const existing = Array.isArray(profile.goalHistory) ? profile.goalHistory : [];
      history = [
        // Replace rather than append when this week already has an entry: goals can only
        // change on a Sunday, and the launch-time re-persist calls through here too, so a
        // week must end up with exactly one record of what was in force.
        ...existing.filter(h => h?.fromWeek !== weekKey),
        {
          fromWeek: weekKey,
          liftsPerWeek: goals.liftsPerWeek ?? null,
          cardioPerWeek: goals.cardioPerWeek ?? null,
          recoveryPerWeek: goals.recoveryPerWeek ?? null,
          // Weekly steps (stepsPerDay × 7) will count toward the Winning Streak, so past
          // weeks need the steps goal in force then too. Entries written before this field
          // existed fall back to current goals (utils/weekGoals).
          stepsPerDay: goals.stepsPerDay ?? null,
        },
      ]
        .sort((a, b) => (a.fromWeek || '').localeCompare(b.fromWeek || ''))
        .slice(-260); // ~5 years of weekly entries; the walk only needs recent ones
    }
  } catch (error) {
    // history stays null — goals are written without touching goalHistory.
  }

  const data = history ? { goals, goalHistory: history } : { goals };

  try {
    await withRetry(async () => {
      if (isNative) {
        await FirebaseFirestore.setDocument({ reference: path, data, merge: true });
      } else {
        const userRef = doc(db, 'users', uid);
        await withTimeout(setDoc(userRef, data, { merge: true }));
      }
    });
  } catch (error) {
    // Don't throw - optimistic update already applied
  }

  return history;
}

// Queued goals change. Non-Sunday edits write here instead of `goals` so the
// streak/progress math doesn't shift mid-week. `pending` shape mirrors `goals`
// plus an `applyOn: YYYY-MM-DD` field for the next Sunday.
export async function savePendingGoals(uid, pending) {
  const path = `users/${uid}`;
  try {
    if (isNative) {
      await FirebaseFirestore.setDocument({
        reference: path,
        data: { pendingGoals: pending },
        merge: true
      });
    } else {
      const userRef = doc(db, 'users', uid);
      await withTimeout(setDoc(userRef, { pendingGoals: pending }, { merge: true }));
    }
  } catch (error) {
    // Best-effort; caller has already updated local state.
  }
}

export async function clearPendingGoals(uid) {
  const path = `users/${uid}`;
  try {
    if (isNative) {
      await FirebaseFirestore.setDocument({
        reference: path,
        data: { pendingGoals: null },
        merge: true
      });
    } else {
      const userRef = doc(db, 'users', uid);
      await withTimeout(setDoc(userRef, { pendingGoals: null }, { merge: true }));
    }
  } catch (error) {
    // Best-effort
  }
}

export async function getUserGoals(uid, forceRefresh = false) {
  // Check cache first
  if (!forceRefresh && cache.userGoals.has(uid) && isCacheValid(`goals_${uid}`)) {
    return cache.userGoals.get(uid);
  }

  const path = `users/${uid}`;

  try {
    let goals;
    if (isNative) {
      const { snapshot } = await withTimeout(FirebaseFirestore.getDocument({ reference: path }));
      goals = snapshot?.data?.goals || null;
    } else {
      const userRef = doc(db, 'users', uid);
      const userDoc = await withTimeout(getDoc(userRef));
      goals = userDoc.exists() ? (userDoc.data().goals || null) : null;
    }

    // Cache the result
    if (goals) {
      cache.userGoals.set(uid, goals);
      cache.timestamps.set(`goals_${uid}`, Date.now());
    }

    return goals;
  } catch (error) {
    // Return cached data if available
    if (cache.userGoals.has(uid)) {
      return cache.userGoals.get(uid);
    }
    return null;
  }
}

export async function setOnboardingComplete(uid) {
  const path = `users/${uid}`;

  try {
    if (isNative) {
      await FirebaseFirestore.setDocument({
        reference: path,
        data: { hasCompletedOnboarding: true },
        merge: true
      });
    } else {
      const userRef = doc(db, 'users', uid);
      await setDoc(userRef, { hasCompletedOnboarding: true }, { merge: true });
    }
  } catch (error) {
    throw error;
  }
}

export async function setTourComplete(uid) {
  const path = `users/${uid}`;

  try {
    if (isNative) {
      await FirebaseFirestore.setDocument({
        reference: path,
        data: { hasCompletedTour: true },
        merge: true
      });
    } else {
      const userRef = doc(db, 'users', uid);
      await setDoc(userRef, { hasCompletedTour: true }, { merge: true });
    }
  } catch (error) {
    throw error;
  }
}

export async function savePersonalRecords(uid, personalRecords) {
  const path = `users/${uid}`;

  try {
    await withRetry(async () => {
      if (isNative) {
        await FirebaseFirestore.setDocument({
          reference: path,
          data: { personalRecords },
          merge: true
        });
      } else {
        const userRef = doc(db, 'users', uid);
        await withTimeout(setDoc(userRef, { personalRecords }, { merge: true }));
      }
    });
  } catch (error) {
    // Don't throw - optimistic update already applied
  }
}

export async function getPersonalRecords(uid) {
  const path = `users/${uid}`;

  try {
    let personalRecords, streaks;
    if (isNative) {
      const { snapshot } = await withTimeout(FirebaseFirestore.getDocument({ reference: path }));
      personalRecords = snapshot?.data?.personalRecords || null;
      streaks = snapshot?.data?.streaks || null;
    } else {
      const userRef = doc(db, 'users', uid);
      const userDoc = await withTimeout(getDoc(userRef));
      if (userDoc.exists()) {
        const data = userDoc.data();
        personalRecords = data.personalRecords || null;
        streaks = data.streaks || null;
      }
    }

    return { personalRecords, streaks };
  } catch (error) {
    // `failed` tells "couldn't read" apart from "has no records yet": the launch recalc
    // must not save over records it never saw.
    return { personalRecords: null, streaks: null, failed: true };
  }
}

export async function uploadProfilePhoto(uid, file) {
  const storagePath = `profilePhotos/${uid}`;
  let downloadURL;

  if (isNative) {
    // Convert File/Blob to base64
    const base64 = await fileToBase64(file);

    // Save to temporary file
    const tempFileName = `temp_profile_${Date.now()}.jpg`;
    const writeResult = await Filesystem.writeFile({
      path: tempFileName,
      data: base64,
      directory: Directory.Cache
    });

    // Upload using native Firebase Storage
    await new Promise((resolve, reject) => {
      FirebaseStorage.uploadFile(
        {
          path: storagePath,
          uri: writeResult.uri
        },
        (event, error) => {
          if (error) {
            reject(error);
          } else if (event?.completed) {
            resolve();
          }
        }
      );
    });

    // Clean up temp file
    try {
      await Filesystem.deleteFile({
        path: tempFileName,
        directory: Directory.Cache
      });
    } catch (e) {
      // Ignore cleanup errors
    }

    // Get the download URL
    const result = await FirebaseStorage.getDownloadUrl({ path: storagePath });
    downloadURL = result.downloadUrl;
  } else {
    // Web SDK fallback
    const photoRef = ref(storage, storagePath);
    await uploadBytes(photoRef, file);
    downloadURL = await getDownloadURL(photoRef);
  }

  // Update the user's profile with the new photo URL
  await updateUserProfile(uid, { photoURL: downloadURL });

  return downloadURL;
}

// Helper function to convert File/Blob to base64
async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // Remove the data URL prefix (e.g., "data:image/jpeg;base64,")
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Offline, the native Storage upload retries for up to 10 minutes before failing, and the
// activity save waits on it. Fail fast instead: the save carries on without the photo.
const PHOTO_UPLOAD_TIMEOUT_MS = 60000;

export async function uploadActivityPhoto(uid, activityId, file) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Offline: photo not uploaded');
  }
  const timestamp = Date.now();
  const storagePath = `activityPhotos/${uid}/${activityId}/${timestamp}`;
  let downloadURL;

  if (isNative) {
    // Convert File/Blob to base64
    const base64 = await fileToBase64(file);

    // Save to temporary file
    const tempFileName = `temp_activity_${timestamp}.jpg`;
    const writeResult = await Filesystem.writeFile({
      path: tempFileName,
      data: base64,
      directory: Directory.Cache
    });

    // Upload using native Firebase Storage
    await withTimeout(new Promise((resolve, reject) => {
      FirebaseStorage.uploadFile(
        {
          path: storagePath,
          uri: writeResult.uri
        },
        (event, error) => {
          if (error) {
            reject(error);
          } else if (event?.completed) {
            resolve();
          }
        }
      );
    }), PHOTO_UPLOAD_TIMEOUT_MS);

    // Clean up temp file
    try {
      await Filesystem.deleteFile({
        path: tempFileName,
        directory: Directory.Cache
      });
    } catch (e) {
      // Ignore cleanup errors
    }

    // Get the download URL
    const result = await FirebaseStorage.getDownloadUrl({ path: storagePath });
    downloadURL = result.downloadUrl;
  } else {
    // Web SDK fallback
    const photoRef = ref(storage, storagePath);
    await withTimeout(uploadBytes(photoRef, file), PHOTO_UPLOAD_TIMEOUT_MS);
    downloadURL = await getDownloadURL(photoRef);
  }

  return downloadURL;
}

export async function deleteActivityPhoto(photoURL) {
  if (!photoURL) return;

  try {
    if (isNative) {
      // Extract storage path from the Firebase Storage download URL
      // URLs contain the path encoded as: /o/path%2Fto%2Ffile?...
      const match = photoURL.match(/\/o\/(.+?)\?/);
      if (match) {
        const storagePath = decodeURIComponent(match[1]);
        await FirebaseStorage.deleteFile({ path: storagePath });
      }
    } else {
      // Web SDK ref() accepts full download URLs
      const photoRef = ref(storage, photoURL);
      await deleteObject(photoRef);
    }
  } catch (error) {
    console.warn('[Storage] Failed to delete activity photo:', error);
    // Don't throw — photo cleanup failure shouldn't block deletion
  }
}

// Deletes the account on the server (the deleteAccount Cloud Function): every doc and file
// it left anywhere — friends' lists, comments and reactions on friends' activities,
// challenges, daily health, photos — and then the Auth account, last. The server wants a
// sign-in from the last few minutes, as Firebase's own account delete does; without one
// this throws an error whose code is 'auth/requires-recent-login', and the caller signs the
// user in again and calls it once more.
export async function deleteUserAccount(uid) {
  try {
    await callFunction('deleteAccount', {}, { freshToken: true });
  } catch (error) {
    if (error.message === 'requires-recent-login') error.code = 'auth/requires-recent-login';
    throw error;
  }

  // Clear all caches for this user
  clearUserCache(uid);

  return true;
}

// Daily Health Data - for syncing HealthKit data to Firestore for desktop access

// Cache for daily health data
const dailyHealthCache = new Map();

/**
 * Save daily health data (steps and calories) to Firestore
 * @param {string} uid - User ID
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {number} steps - Step count for the day
 * @param {number} calories - Calories burned for the day
 * @returns {Promise<boolean>} - True if saved successfully
 */
export async function saveDailyHealthData(uid, date, steps, calories) {
  const path = `users/${uid}/dailyHealth/${date}`;
  const data = {
    date,
    steps: steps || 0,
    calories: calories || 0,
    lastUpdated: new Date().toISOString()
  };

  // Update cache immediately (optimistic update)
  dailyHealthCache.set(`${uid}_${date}`, { ...data, _cachedAt: Date.now() });

  try {
    if (isNative) {
      await FirebaseFirestore.setDocument({
        reference: path,
        data: data,
        merge: true
      });
    } else {
      const docRef = doc(db, 'users', uid, 'dailyHealth', date);
      await withTimeout(setDoc(docRef, data, { merge: true }));
    }
    return true;
  } catch (error) {
    // Don't throw - optimistic update already applied
    return false;
  }
}

/**
 * Get daily health data for a specific date
 * @param {string} uid - User ID
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {Promise<{date: string, steps: number, calories: number, lastUpdated: string} | null>}
 */
export async function getDailyHealthData(uid, date) {
  // Check cache first
  const cacheKey = `${uid}_${date}`;
  const cached = dailyHealthCache.get(cacheKey);
  if (cached && (Date.now() - cached._cachedAt) < cache.cacheExpiry) {
    const { _cachedAt, ...data } = cached;
    return data;
  }

  const path = `users/${uid}/dailyHealth/${date}`;

  try {
    let data;
    if (isNative) {
      const { snapshot } = await withTimeout(FirebaseFirestore.getDocument({ reference: path }));
      data = snapshot?.data || null;
    } else {
      const docRef = doc(db, 'users', uid, 'dailyHealth', date);
      const docSnap = await withTimeout(getDoc(docRef));
      data = docSnap.exists() ? docSnap.data() : null;
    }

    // Cache the result
    if (data) {
      dailyHealthCache.set(cacheKey, { ...data, _cachedAt: Date.now() });
    }

    return data;
  } catch (error) {
    // Return cached data if available
    if (cached) {
      const { _cachedAt, ...data } = cached;
      return data;
    }
    return null;
  }
}

/**
 * Get daily health history for a range of days
 * @param {string} uid - User ID
 * @param {number} days - Number of days of history to fetch (default 30)
 * @returns {Promise<Array<{date: string, steps: number, calories: number, lastUpdated: string}>>}
 */
export async function getDailyHealthHistory(uid, days = 30) {
  try {
    const results = [];
    const today = new Date();

    if (isNative) {
      // Only the window asked for: the unfiltered read downloaded every day ever stored
      // (two years is ~730 docs) at launch, on every pull-to-refresh and once per friend on
      // the leaderboard. The client-side check below stays as a guard.
      const cutoffDate = new Date(today);
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const cutoffStr = toLocalDateStr(cutoffDate);
      const collectionPath = `users/${uid}/dailyHealth`;
      const { snapshots } = await FirebaseFirestore.getCollection({
        reference: collectionPath,
        compositeFilter: {
          type: 'and',
          queryConstraints: [
            { type: 'where', fieldPath: 'date', opStr: '>=', value: cutoffStr },
          ],
        },
      });

      if (snapshots) {

        for (const snap of snapshots) {
          if (snap.data && snap.data.date >= cutoffStr) {
            results.push(snap.data);
            // Update cache
            dailyHealthCache.set(`${uid}_${snap.data.date}`, { ...snap.data, _cachedAt: Date.now() });
          }
        }
      }
    } else {
      // For web, fetch documents for each day
      // This approach is simpler and avoids complex queries
      const promises = [];
      for (let i = 0; i < days; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = toLocalDateStr(date);
        promises.push(getDailyHealthData(uid, dateStr));
      }

      const dayResults = await Promise.all(promises);
      for (const data of dayResults) {
        if (data) {
          results.push(data);
        }
      }
    }

    // Sort by date descending (most recent first)
    results.sort((a, b) => b.date.localeCompare(a.date));

    return results;
  } catch (error) {
    return [];
  }
}
