/**
 * Challenge Service for DaySeven
 *
 * Handles 1v1 (and later, group) friend challenges:
 *  - createChallenge: snapshot the challenger's activity, derive a match rule, write a pending challenge doc
 *  - acceptChallenge / declineChallenge: friend transitions
 *  - cancelChallenge: challenger pulls back a still-pending challenge
 *  - getChallengesForUser: read all challenges I'm a participant in (challenger or recipient)
 *  - countActiveChallengesByUser: enforces the free-tier cap of 3 active outgoing challenges
 *
 * All win/loss writes (challengeStats counters) live server-side in Cloud Functions.
 * Clients can only mutate the lifecycle (status + acceptedAt + fulfillingActivityId).
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp
} from 'firebase/firestore';
import { db } from '../firebase';
import { Capacitor } from '@capacitor/core';
import { FirebaseFirestore } from '@capacitor-firebase/firestore';

const isNative = Capacitor.isNativePlatform();

// Free users can receive challenges but can't send any — sending is a Pro feature.
// Pro users have no sent cap.
export const FREE_ACTIVE_CHALLENGE_CAP = 0;
export const CHALLENGE_WINDOW_HOURS = [24, 48, 72];

// Challenges are same-day only — activity must be logged for today (user's local date).
// Keeps the feature kinetic ("I just did this, your turn") and avoids stale invites.

// Distance-bearing cardio types: a "Running" challenge can only be won with a Run, not a Bike.
// All other activities just need to match category — any duration/distance counts.
const DISTANCE_TYPES = ['Running', 'Cycle', 'Swimming', 'Rowing', 'Hiking'];

const withTimeout = (promise, ms = 10000) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), ms)),
]);

/**
 * Whether an activity is eligible to be sent as a challenge.
 * Rule: activity must be logged for today (user's local date).
 */
export function isChallengeable(activity) {
  if (!activity) return false;
  const category = getChallengeCategory(activity);
  if (!category || category === 'warmup') return false;
  if (!activity.date) return true; // brand-new save without a date yet — assume today
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return activity.date === todayStr;
}

/**
 * Compute the canonical category for an activity. Mirrors the server-side
 * getActivityCategoryForGoals in functions/index.js — keep them in sync.
 */
export function getChallengeCategory(activity) {
  const ct = activity.countToward || '';
  if (ct === 'lifting' || ct === 'strength') return 'lifting';
  if (ct === 'cardio') return 'cardio';
  if (ct === 'recovery') return 'recovery';
  if (ct === 'warmup') return 'warmup';

  const cc = activity.customActivityCategory || '';
  if (cc === 'lifting' || cc === 'strength') return 'lifting';
  if (cc === 'cardio') return 'cardio';
  if (cc === 'recovery') return 'recovery';

  const type = activity.type || '';
  const subtype = activity.subtype || '';
  if (['Strength Training', 'Weightlifting', 'Bodyweight', 'Circuit'].includes(type)) return 'lifting';
  if (['Running', 'Cycle', 'Sports', 'Stair Climbing', 'Elliptical', 'Swimming', 'Rowing', 'Hiking', 'Dance'].includes(type)) return 'cardio';
  if (type === 'Yoga') return ['Power', 'Hot', 'Vinyasa'].includes(subtype) ? 'cardio' : 'recovery';
  if (['Pilates', 'Stretching', 'Foam Rolling', 'Cold Plunge', 'Sauna', 'Contrast Therapy', 'Massage', 'Chiropractic'].includes(type)) return 'recovery';
  return null;
}

/**
 * Build a match rule from the challenger's activity. Distance-bearing cardio types
 * lock to the same activityType (Running stays Running) so a "go run" challenge can't
 * be answered with a bike ride. All other activities just need to match category —
 * any duration/distance counts as a win. The challenger's stats are visible on the card
 * for context; volume parity is on the friend's honor.
 */
export function buildMatchRule(activity) {
  const category = getChallengeCategory(activity);
  if (!category || category === 'warmup') return null;

  const rule = { category };

  if (category === 'cardio' && DISTANCE_TYPES.includes(activity.type)) {
    rule.activityType = activity.type;
  }

  return rule;
}

/**
 * Plain-English description of the match rule for UI.
 *  - "Go for a run"
 *  - "Do any strength workout"
 *  - "Do any recovery activity"
 */
export function describeMatchRule(rule) {
  if (!rule) return 'Match the activity';
  const { category, activityType } = rule;

  if (activityType) {
    const verb = {
      Running: 'Go for a run',
      Cycle: 'Go for a ride',
      Swimming: 'Go for a swim',
      Rowing: 'Hit the rower',
      Hiking: 'Go on a hike',
    }[activityType] || `Do a ${activityType.toLowerCase()}`;
    return verb;
  }

  return {
    lifting: 'Do any strength workout',
    cardio: 'Do any cardio',
    recovery: 'Do any recovery activity',
  }[category] || 'Match the activity';
}

function buildActivitySnapshot(activity) {
  return {
    activityId: String(activity.id || ''),
    type: activity.type || '',
    subtype: activity.subtype || '',
    duration: parseInt(activity.duration, 10) || 0,
    distance: parseFloat(activity.distance) || 0,
    calories: parseInt(activity.calories, 10) || 0,
    countToward: activity.countToward || '',
    date: activity.date || '',
  };
}

/**
 * Create a challenge against one or more friends.
 *  - 1 friend  → type: '1v1'  (also writes legacy friendUid/friendStatus for backward compat)
 *  - 2+ friends → type: 'group' (mode: all_complete — every accepter who matches in time wins)
 *
 * Returns { challengeId } on success or { error } on failure.
 */
export async function createChallenge({ challengerUid, challengerName, friendUid, friendUids, activity, windowHours, title, requirePhoto = false }) {
  // Accept both shapes: friendUid (legacy single-friend caller) or friendUids (array).
  const targets = Array.from(new Set((friendUids && friendUids.length ? friendUids : (friendUid ? [friendUid] : []))));
  if (!challengerUid || targets.length === 0 || !activity) {
    return { error: 'missing_args' };
  }
  if (!CHALLENGE_WINDOW_HOURS.includes(windowHours)) {
    return { error: 'invalid_window' };
  }

  const matchRule = buildMatchRule(activity);
  if (!matchRule) {
    return { error: 'unsupported_activity' };
  }

  const isGroup = targets.length > 1;
  const now = new Date();
  const windowMs = windowHours * 60 * 60 * 1000;
  const expiresAt = new Date(now.getTime() + windowMs);
  // Pending challenges auto-decline halfway through the window — keeps stale invites from
  // lingering and creates urgency to respond.
  const respondByAt = new Date(now.getTime() + windowMs / 2);
  const challengeId = `${challengerUid}_${isGroup ? 'group' : targets[0]}_${now.getTime()}`;

  // participants map drives all per-friend state — used for both 1v1 and group going forward.
  const participants = {};
  for (const uid of targets) {
    participants[uid] = { status: 'pending' };
  }

  const cleanTitle = (title || '').trim().slice(0, 60);

  const data = {
    id: challengeId,
    type: isGroup ? 'group' : '1v1',
    mode: 'all_complete',
    challengerUid,
    challengerName: challengerName || '',
    title: cleanTitle,
    participantUids: [challengerUid, ...targets],
    participants,
    challengerActivity: buildActivitySnapshot(activity),
    matchRule,
    windowHours,
    requirePhoto: !!requirePhoto,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    respondByAt: respondByAt.toISOString(),
    status: 'pending',
  };

  // Legacy 1v1 fields — keep populated so old cards / Cloud Function paths still read them.
  if (!isGroup) {
    data.friendUid = targets[0];
    data.friendStatus = 'pending';
  }

  try {
    if (isNative) {
      await FirebaseFirestore.setDocument({ reference: `challenges/${challengeId}`, data });
    } else {
      await withTimeout(setDoc(doc(db, 'challenges', challengeId), {
        ...data,
        createdAt: serverTimestamp(),
      }));
    }
    return { challengeId };
  } catch (error) {
    console.error('[challengeService] createChallenge failed:', error);
    return { error: 'write_failed' };
  }
}

/**
 * Internal: figure out whether this user is a recipient in a challenge,
 * and what their current status is. Handles both new (participants map)
 * and legacy 1v1 (friendUid/friendStatus) shapes.
 */
function getMyParticipantStatus(challenge, uid) {
  if (challenge?.participants && challenge.participants[uid]) {
    return challenge.participants[uid].status;
  }
  if (challenge?.friendUid === uid) return challenge.friendStatus;
  return null;
}

/**
 * Friend accepts. Timer does NOT reset — the original window from creation still applies
 * (predictable end time for both parties). Late accepters get whatever's left.
 */
export async function acceptChallenge(challengeId, friendUid) {
  if (!challengeId || !friendUid) return { error: 'missing_args' };

  try {
    const existing = await getChallengeById(challengeId);
    if (!existing) return { error: 'not_found' };
    if (getMyParticipantStatus(existing, friendUid) !== 'pending') return { error: 'already_resolved' };

    const now = new Date();
    const isGroup = existing.type === 'group';

    const update = {};
    if (existing.participants) {
      update[`participants.${friendUid}.status`] = 'accepted';
      update[`participants.${friendUid}.acceptedAt`] = now.toISOString();
    }
    // Overall challenge status moves to active on first acceptance
    update.status = 'active';

    // Legacy 1v1 fields
    if (!isGroup && existing.friendUid === friendUid) {
      update.friendStatus = 'accepted';
      update.acceptedAt = now.toISOString();
    }

    if (isNative) {
      await FirebaseFirestore.updateDocument({ reference: `challenges/${challengeId}`, data: update });
    } else {
      await withTimeout(updateDoc(doc(db, 'challenges', challengeId), update));
    }
    return { success: true };
  } catch (error) {
    console.error('[challengeService] acceptChallenge failed:', error);
    return { error: 'write_failed' };
  }
}

export async function declineChallenge(challengeId, friendUid) {
  if (!challengeId || !friendUid) return { error: 'missing_args' };

  try {
    const existing = await getChallengeById(challengeId);
    if (!existing) return { error: 'not_found' };
    if (getMyParticipantStatus(existing, friendUid) !== 'pending') return { error: 'already_resolved' };

    const isGroup = existing.type === 'group';
    const now = new Date();
    const update = {};

    if (existing.participants) {
      update[`participants.${friendUid}.status`] = 'declined';
      update[`participants.${friendUid}.resolvedAt`] = now.toISOString();
    }

    if (!isGroup) {
      // 1v1: declining ends the challenge for everyone.
      update.status = 'declined';
      update.friendStatus = 'declined';
      update.resolvedAt = now.toISOString();
    }
    // For groups, the overall status stays 'pending' or 'active' depending on others —
    // the expireChallenges cron will flip it to terminal when all participants resolve.

    if (isNative) {
      await FirebaseFirestore.updateDocument({ reference: `challenges/${challengeId}`, data: update });
    } else {
      await withTimeout(updateDoc(doc(db, 'challenges', challengeId), update));
    }
    return { success: true };
  } catch (error) {
    console.error('[challengeService] declineChallenge failed:', error);
    return { error: 'write_failed' };
  }
}

/**
 * Challenger cancels their own challenge — only allowed while still pending
 * (once the friend accepts, the timer's running and it's not fair to retract).
 */
export async function cancelChallenge(challengeId, challengerUid) {
  if (!challengeId || !challengerUid) return { error: 'missing_args' };

  try {
    const existing = await getChallengeById(challengeId);
    if (!existing) return { error: 'not_found' };
    if (existing.challengerUid !== challengerUid) return { error: 'not_challenger' };
    if (existing.status !== 'pending') return { error: 'already_active' };

    const update = {
      status: 'cancelled',
      resolvedAt: new Date().toISOString(),
    };

    if (isNative) {
      await FirebaseFirestore.updateDocument({ reference: `challenges/${challengeId}`, data: update });
    } else {
      await withTimeout(updateDoc(doc(db, 'challenges', challengeId), update));
    }
    return { success: true };
  } catch (error) {
    console.error('[challengeService] cancelChallenge failed:', error);
    return { error: 'write_failed' };
  }
}

export async function getChallengeById(challengeId) {
  try {
    if (isNative) {
      const { snapshot } = await FirebaseFirestore.getDocument({ reference: `challenges/${challengeId}` });
      return snapshot?.data ? { id: snapshot.id, ...snapshot.data } : null;
    } else {
      const snap = await withTimeout(getDoc(doc(db, 'challenges', challengeId)));
      return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    }
  } catch (error) {
    console.error('[challengeService] getChallengeById failed:', error);
    return null;
  }
}

/**
 * Read all challenges this user is a participant in (challenger or recipient).
 * Filtered client-side into buckets by the caller.
 */
export async function getChallengesForUser(uid) {
  if (!uid) return [];

  try {
    let challenges = [];

    if (isNative) {
      const { snapshots } = await FirebaseFirestore.getCollection({
        reference: 'challenges',
        compositeFilter: {
          type: 'and',
          queryConstraints: [
            { type: 'where', fieldPath: 'participantUids', opStr: 'array-contains', value: uid },
          ],
        },
      });
      challenges = (snapshots || []).map(s => ({ id: s.id, ...s.data })).filter(c => c.id);
    } else {
      const q = query(
        collection(db, 'challenges'),
        where('participantUids', 'array-contains', uid),
        orderBy('createdAt', 'desc')
      );
      const snap = await withTimeout(getDocs(q));
      challenges = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    // Sort newest first (native plugin doesn't accept orderBy with array-contains cleanly)
    challenges.sort((a, b) => {
      const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bt - at;
    });

    return challenges;
  } catch (error) {
    console.error('[challengeService] getChallengesForUser failed:', error);
    return [];
  }
}

/**
 * Real-time listener for this user's challenges. Calls `onUpdate(challenges)` whenever
 * any challenge they're a participant in is created/updated/deleted. Returns an
 * unsubscribe function — call it on cleanup.
 *
 * Fires immediately on subscribe with the current state, then again on every change.
 */
export function subscribeToChallenges(uid, onUpdate) {
  if (!uid || typeof onUpdate !== 'function') return () => {};

  const sortNewestFirst = (list) => {
    list.sort((a, b) => {
      const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bt - at;
    });
    return list;
  };

  if (isNative) {
    // Native plugin: addCollectionSnapshotListener returns a Promise<callbackId>.
    // We track the resolved id via a ref so the returned unsubscribe can clean it up.
    const callbackIdRef = { current: null };
    let cancelled = false;

    FirebaseFirestore.addCollectionSnapshotListener(
      {
        reference: 'challenges',
        compositeFilter: {
          type: 'and',
          queryConstraints: [
            { type: 'where', fieldPath: 'participantUids', opStr: 'array-contains', value: uid },
          ],
        },
      },
      (event, error) => {
        if (error) {
          console.error('[challengeService] subscribeToChallenges error:', error);
          return;
        }
        const list = (event?.snapshots || [])
          .map(s => ({ id: s.id, ...s.data }))
          .filter(c => c.id);
        onUpdate(sortNewestFirst(list));
      }
    ).then(callbackId => {
      if (cancelled) {
        // Unsub was called before the listener finished registering — remove immediately.
        FirebaseFirestore.removeSnapshotListener({ callbackId }).catch(() => {});
      } else {
        callbackIdRef.current = callbackId;
      }
    }).catch(err => {
      console.error('[challengeService] subscribeToChallenges init failed:', err);
    });

    return () => {
      cancelled = true;
      if (callbackIdRef.current) {
        FirebaseFirestore.removeSnapshotListener({ callbackId: callbackIdRef.current }).catch(() => {});
        callbackIdRef.current = null;
      }
    };
  }

  const q = query(
    collection(db, 'challenges'),
    where('participantUids', 'array-contains', uid),
    orderBy('createdAt', 'desc')
  );
  const unsub = onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      onUpdate(sortNewestFirst(list));
    },
    (err) => {
      console.error('[challengeService] subscribeToChallenges error:', err);
    }
  );
  return unsub;
}

/**
 * Count active outgoing challenges for the free-tier cap.
 * "Active" = pending + active (not declined/cancelled/completed/expired).
 */
export function countActiveOutgoing(challenges, uid) {
  return challenges.filter(c =>
    c.challengerUid === uid &&
    (c.status === 'pending' || c.status === 'active')
  ).length;
}

/**
 * Bucket challenges into the four UI sections the Home tab cares about.
 *
 * For groups, my personal participant status drives bucketing:
 *  - my status 'pending'   → pendingReceived
 *  - my status 'accepted'  → active
 *  - my status 'completed' → completed
 * For 1v1 (legacy or new), falls back to overall status / friendUid.
 */
export function bucketChallenges(challenges, uid) {
  const pendingReceived = [];
  const active = [];
  const pendingSent = [];
  const completed = [];

  for (const c of challenges) {
    const isChallenger = c.challengerUid === uid;
    const myStatus = getMyParticipantStatus(c, uid);

    if (isChallenger) {
      // Bucket by overall challenge status
      if (c.status === 'pending') pendingSent.push(c);
      else if (c.status === 'active') active.push(c);
      else if (c.status === 'completed') completed.push(c);
      continue;
    }

    // Recipient bucket by personal status
    if (myStatus === 'pending') pendingReceived.push(c);
    else if (myStatus === 'accepted') active.push(c);
    else if (myStatus === 'completed') completed.push(c);
    // declined/expired: not surfaced
  }

  return { pendingReceived, active, pendingSent, completed };
}
