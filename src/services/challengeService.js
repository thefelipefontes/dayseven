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
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../firebase';
import { Capacitor } from '@capacitor/core';
import { FirebaseFirestore } from '@capacitor-firebase/firestore';

const isNative = Capacitor.isNativePlatform();

// Free users can receive challenges but can't send any — sending is a Pro feature.
// Pro users have no sent cap.
// TEMP (testing): lifted from 0 to 999 to test the new fulfillment flows on a free account.
// Revert to 0 before shipping to restore the Pro-only send gate.
export const FREE_ACTIVE_CHALLENGE_CAP = 999;
export const CHALLENGE_WINDOW_HOURS = [24, 48, 72];

// Hard cap on how long a recipient has to accept a pending challenge.
// Timer for the workout itself (windowHours) does NOT start until accept — this just
// bounds how long the invite stays open so the same-day-ish kineticism is preserved.
export const ACCEPT_WINDOW_HOURS = 8;

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
  if (!activity) return null;
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
 * Whether an activity (in any state, including in-progress in the logger) matches a challenge's
 * match rule. Mirrors the server-side `activityMatchesRule` in functions/index.js — keep in sync.
 * Used by the finish-workout modal to surface "this fulfills these challenges" before save.
 */
export function activityMatchesChallengeRule(activity, rule) {
  if (!activity || !rule) return false;
  const category = getChallengeCategory(activity);
  if (category !== rule.category) return false;
  if (rule.activityType && activity.type !== rule.activityType) return false;
  if (rule.distanceMin) {
    const distance = parseFloat(activity.distance) || 0;
    return distance >= rule.distanceMin;
  }
  if (rule.durationMin) {
    const duration = parseInt(activity.duration, 10) || 0;
    return duration >= rule.durationMin;
  }
  if (rule.paceMaxSecondsPerMile) {
    const distance = parseFloat(activity.distance) || 0;
    const duration = parseInt(activity.duration, 10) || 0;
    if (distance <= 0 || duration <= 0) return false;
    const pace = (duration * 60) / distance; // seconds per mile
    return pace <= rule.paceMaxSecondsPerMile;
  }
  return true;
}

/**
 * Like activityMatchesChallengeRule but also returns near-miss info so the UI can show
 * "you're 2mi short" affordances. Returns:
 *   { matches: bool, qualifies: bool, shortBy: { distance?, duration? }|null }
 *  - qualifies = passes category/type filters (but might fall short of target)
 *  - matches   = qualifies AND meets the target threshold
 */
export function evaluateActivityAgainstChallenge(activity, rule) {
  if (!activity || !rule) return { matches: false, qualifies: false, shortBy: null };
  const category = getChallengeCategory(activity);
  if (category !== rule.category) return { matches: false, qualifies: false, shortBy: null };
  if (rule.activityType && activity.type !== rule.activityType) return { matches: false, qualifies: false, shortBy: null };

  if (rule.distanceMin) {
    const distance = parseFloat(activity.distance) || 0;
    const matches = distance >= rule.distanceMin;
    return {
      matches,
      qualifies: true,
      shortBy: matches ? null : { distance: rule.distanceMin - distance },
    };
  }
  if (rule.durationMin) {
    const duration = parseInt(activity.duration, 10) || 0;
    const matches = duration >= rule.durationMin;
    return {
      matches,
      qualifies: true,
      shortBy: matches ? null : { duration: rule.durationMin - duration },
    };
  }
  if (rule.paceMaxSecondsPerMile) {
    const distance = parseFloat(activity.distance) || 0;
    const duration = parseInt(activity.duration, 10) || 0;
    if (distance <= 0 || duration <= 0) {
      // Can't compute pace yet — treat as below-target so user can keep typing.
      return { matches: false, qualifies: true, shortBy: { paceSeconds: rule.paceMaxSecondsPerMile } };
    }
    const pace = (duration * 60) / distance;
    const matches = pace <= rule.paceMaxSecondsPerMile;
    return {
      matches,
      qualifies: true,
      shortBy: matches ? null : { paceSeconds: pace - rule.paceMaxSecondsPerMile },
    };
  }
  return { matches: true, qualifies: true, shortBy: null };
}

/**
 * Available metrics for a given activity. Distance cardio with both distance + duration > 0
 * gets all three; otherwise the picker collapses to the only meaningful option.
 *  - 'distance': accepter must cover ≥ challenger's miles (any pace, any time)
 *  - 'duration': accepter must move ≥ challenger's minutes (any distance)
 *  - 'pace':     accepter must hit ≤ challenger's seconds-per-mile (any distance/time)
 */
export function availableChallengeMetrics(activity) {
  const category = getChallengeCategory(activity);
  if (!category || category === 'warmup') return [];
  const isDistanceCardio = category === 'cardio' && DISTANCE_TYPES.includes(activity?.type);
  const distance = parseFloat(activity?.distance);
  const duration = parseInt(activity?.duration, 10);
  const hasDistance = Number.isFinite(distance) && distance > 0;
  const hasDuration = Number.isFinite(duration) && duration > 0;
  if (!isDistanceCardio) {
    return hasDuration ? ['duration'] : [];
  }
  const out = [];
  if (hasDistance) out.push('distance');
  if (hasDuration) out.push('duration');
  if (hasDistance && hasDuration) out.push('pace');
  return out;
}

/**
 * Build a match rule from the challenger's activity. The accepter must hit the same target
 * the challenger hit — no softer/harder adjustment: the challenger's stats ARE the bar.
 *
 * `metric` selects which dimension the accepter must match:
 *  - 'distance' → distanceMin (challenger's miles)
 *  - 'duration' → durationMin (challenger's minutes)
 *  - 'pace'     → paceMaxSecondsPerMile (challenger's pace; lower = faster)
 *  - 'auto' / undefined → distance for distance-cardio, duration for everything else (legacy default)
 *
 * activityType is still locked for distance cardio (Running stays Running) regardless of metric.
 */
export function buildMatchRule(activity, metric = 'auto') {
  const category = getChallengeCategory(activity);
  if (!category || category === 'warmup') return null;

  const rule = { category };
  const isDistanceCardio = category === 'cardio' && DISTANCE_TYPES.includes(activity.type);
  if (isDistanceCardio) rule.activityType = activity.type;

  const distance = parseFloat(activity.distance);
  const duration = parseInt(activity.duration, 10);
  const hasDistance = Number.isFinite(distance) && distance > 0;
  const hasDuration = Number.isFinite(duration) && duration > 0;

  const chosen = metric === 'auto'
    ? (isDistanceCardio && hasDistance ? 'distance' : 'duration')
    : metric;

  if (chosen === 'distance' && hasDistance) {
    rule.distanceMin = distance;
  } else if (chosen === 'duration' && hasDuration) {
    rule.durationMin = duration;
  } else if (chosen === 'pace' && hasDistance && hasDuration) {
    // Pace stored as max seconds per mile (faster = lower number). Round to whole seconds
    // so the target reads cleanly as M:SS in the UI.
    rule.paceMaxSecondsPerMile = Math.round((duration * 60) / distance);
  } else if (hasDistance) {
    // Fallback: caller asked for a metric we can't compute → use whatever is available.
    rule.distanceMin = distance;
  } else if (hasDuration) {
    rule.durationMin = duration;
  }

  return rule;
}

/** Format seconds-per-mile as M:SS (e.g. 450 → "7:30"). */
export function formatPace(secondsPerMile) {
  const total = Math.max(0, Math.round(secondsPerMile || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Plain-English description of the match rule for UI. Targets ARE the rule —
 * "Run 7 mi" is more honest about what fulfills than "Go for a run."
 */
export function describeMatchRule(rule) {
  if (!rule) return 'Match the activity';
  const { category, activityType, distanceMin, durationMin, paceMaxSecondsPerMile } = rule;
  const fmtMi = (mi) => `${parseFloat(mi).toFixed(parseFloat(mi) % 1 === 0 ? 0 : 1)} mi`;
  const fmtMin = (min) => `${min} min`;

  if (activityType) {
    const verb = {
      Running: 'Run',
      Cycle: 'Ride',
      Swimming: 'Swim',
      Rowing: 'Row',
      Hiking: 'Hike',
    }[activityType] || `Do a ${activityType.toLowerCase()}`;
    if (distanceMin) return `${verb} ${fmtMi(distanceMin)}`;
    if (durationMin) return `${verb} for ${fmtMin(durationMin)}`;
    if (paceMaxSecondsPerMile) return `${verb} at ${formatPace(paceMaxSecondsPerMile)} /mi or faster`;
    return `Go for a ${verb.toLowerCase()}`;
  }

  const noun = {
    lifting: 'strength workout',
    cardio: 'cardio',
    recovery: 'recovery activity',
  }[category] || 'workout';
  if (durationMin) return `${fmtMin(durationMin)} ${noun}`;
  return `Do any ${noun}`;
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
export async function createChallenge({ challengerUid, challengerName, friendUid, friendUids, activity, windowHours, title, requirePhoto = false, metric = 'auto' }) {
  // Accept both shapes: friendUid (legacy single-friend caller) or friendUids (array).
  const targets = Array.from(new Set((friendUids && friendUids.length ? friendUids : (friendUid ? [friendUid] : []))));
  if (!challengerUid || targets.length === 0 || !activity) {
    return { error: 'missing_args' };
  }
  if (!CHALLENGE_WINDOW_HOURS.includes(windowHours)) {
    return { error: 'invalid_window' };
  }

  const matchRule = buildMatchRule(activity, metric);
  if (!matchRule) {
    return { error: 'unsupported_activity' };
  }

  const isGroup = targets.length > 1;
  const now = new Date();
  // Hard 8h to accept. The workout timer (windowHours) starts on accept, not on send,
  // so a busy accepter who sees the invite hours later still gets the full window to do it.
  const respondByAt = new Date(now.getTime() + ACCEPT_WINDOW_HOURS * 60 * 60 * 1000);
  // expiresAt is provisional until someone accepts — match respondByAt so any code path that
  // reads it for an unaccepted challenge gets a sane "deadline." Overwritten on accept.
  const expiresAt = respondByAt;
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
 * Friend accepts. Timer for the workout starts NOW — expiresAt is set to acceptedAt + windowHours.
 * For groups, this is the first accept's clock; subsequent accepters race against the same end time
 * so the challenger has one predictable deadline to watch.
 */
export async function acceptChallenge(challengeId, friendUid) {
  if (!challengeId || !friendUid) return { error: 'missing_args' };

  try {
    const existing = await getChallengeById(challengeId);
    if (!existing) return { error: 'not_found' };
    if (getMyParticipantStatus(existing, friendUid) !== 'pending') return { error: 'already_resolved' };

    const now = new Date();
    const isGroup = existing.type === 'group';
    const windowMs = (existing.windowHours || 24) * 60 * 60 * 1000;

    const update = {};
    if (existing.participants) {
      update[`participants.${friendUid}.status`] = 'accepted';
      update[`participants.${friendUid}.acceptedAt`] = now.toISOString();
    }
    // Overall challenge status moves to active on first acceptance
    update.status = 'active';

    // Timer-on-accept: only set expiresAt if this is the first acceptance.
    // (For groups, second+ accepters slot into the existing deadline.)
    if (existing.status === 'pending') {
      update.expiresAt = new Date(now.getTime() + windowMs).toISOString();
      update.firstAcceptedAt = now.toISOString();
    }

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
 * Sender requests to cancel an active challenge (1v1 only). The accepter must
 * agree via respondToCancelRequest before the challenge is actually cancelled —
 * this prevents the accepter from being on the hook with no escape, while also
 * preventing the sender from unilaterally retracting once the timer's started.
 *
 * For pending (not-yet-accepted) challenges, sender uses cancelChallenge instead
 * (no mutual approval needed — nothing's at stake yet).
 */
export async function requestCancelChallenge(challengeId, requesterUid) {
  if (!challengeId || !requesterUid) return { error: 'missing_args' };

  try {
    const existing = await getChallengeById(challengeId);
    if (!existing) return { error: 'not_found' };
    if (existing.challengerUid !== requesterUid) return { error: 'not_challenger' };
    if (existing.status !== 'active') return { error: 'not_active' };
    // Group cancel is intentionally unsupported in v1 — semantics with N accepters get messy.
    if (existing.type === 'group') return { error: 'group_unsupported' };
    if (existing.cancelRequest && !existing.cancelRequest.response) return { error: 'already_requested' };

    const update = {
      cancelRequest: {
        requestedBy: requesterUid,
        requestedAt: new Date().toISOString(),
        response: null,
        respondedAt: null,
      },
    };

    if (isNative) {
      await FirebaseFirestore.updateDocument({ reference: `challenges/${challengeId}`, data: update });
    } else {
      await withTimeout(updateDoc(doc(db, 'challenges', challengeId), update));
    }
    return { success: true };
  } catch (error) {
    console.error('[challengeService] requestCancelChallenge failed:', error);
    return { error: 'write_failed' };
  }
}

/**
 * Accepter responds to the sender's cancel request — accept (challenge ends, no stats
 * impact for either side) or decline (challenge continues normally, request is cleared).
 */
export async function respondToCancelRequest(challengeId, accepterUid, accept) {
  if (!challengeId || !accepterUid) return { error: 'missing_args' };

  try {
    const existing = await getChallengeById(challengeId);
    if (!existing) return { error: 'not_found' };
    if (existing.status !== 'active') return { error: 'not_active' };
    if (!existing.cancelRequest || existing.cancelRequest.response) return { error: 'no_open_request' };
    if (existing.cancelRequest.requestedBy === accepterUid) return { error: 'cant_respond_own_request' };

    // Sanity check: the responder must actually be a participant who accepted.
    const myStatus = getMyParticipantStatus(existing, accepterUid);
    if (myStatus !== 'accepted') return { error: 'not_accepter' };

    const now = new Date().toISOString();
    const update = {
      'cancelRequest.response': accept ? 'accepted' : 'declined',
      'cancelRequest.respondedAt': now,
    };

    if (accept) {
      update.status = 'cancelled';
      update.resolvedAt = now;
    }

    if (isNative) {
      await FirebaseFirestore.updateDocument({ reference: `challenges/${challengeId}`, data: update });
    } else {
      await withTimeout(updateDoc(doc(db, 'challenges', challengeId), update));
    }
    return { success: true };
  } catch (error) {
    console.error('[challengeService] respondToCancelRequest failed:', error);
    return { error: 'write_failed' };
  }
}

/**
 * Challenger cancels their own challenge — only allowed while still pending
 * (once the friend accepts, mutual cancel via requestCancelChallenge is required).
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
 * Apply user's choice from the multi-match chooser modal — calls the `applyChallengeIntent`
 * cloud function which validates eligibility and runs fulfillment for each chosen challenge.
 * Returns the per-challenge results array.
 */
export async function applyChallengeIntent(activityId, challengeIds) {
  if (!activityId || !Array.isArray(challengeIds) || challengeIds.length === 0) {
    return { results: [] };
  }
  try {
    const functions = getFunctions();
    const callable = httpsCallable(functions, 'applyChallengeIntent');
    const res = await callable({ activityId: String(activityId), challengeIds: challengeIds.map(String) });
    return res.data || { results: [] };
  } catch (err) {
    console.error('[challengeService] applyChallengeIntent failed:', err);
    return { results: [], error: err?.message || 'unknown' };
  }
}

/**
 * Read completed challenges where any of the given uids is a winner (accepter who
 * completed). Used by the friends feed to tag activities that fulfilled a challenge.
 * Firestore array-contains-any caps at 30 values; callers with larger lists should chunk.
 */
export async function getCompletedChallengesByWinners(uids) {
  if (!uids || uids.length === 0) return [];
  const slice = uids.slice(0, 30);

  try {
    if (isNative) {
      // Chunk into one `array-contains` query per uid (the native plugin doesn't reliably
      // handle `array-contains-any`). The `status == 'completed'` filter is REQUIRED at the
      // query level — Firestore rules grant cross-user reads only on completed challenges,
      // and rules verify queries by constraints, not by per-doc filtering.
      const results = [];
      await Promise.all(slice.map(async (uid) => {
        try {
          const { snapshots } = await FirebaseFirestore.getCollection({
            reference: 'challenges',
            compositeFilter: {
              type: 'and',
              queryConstraints: [
                { type: 'where', fieldPath: 'status', opStr: '==', value: 'completed' },
                { type: 'where', fieldPath: 'winnerUids', opStr: 'array-contains', value: uid },
              ],
            },
          });
          for (const s of (snapshots || [])) {
            results.push({ id: s.id, ...s.data });
          }
        } catch (err) {
          console.error('[getCompletedChallengesByWinners] uid query failed:', uid, err);
        }
      }));
      // Dedupe by id (a challenge can include multiple winners — group challenges).
      const dedup = new Map();
      for (const c of results) if (c.id) dedup.set(c.id, c);
      return Array.from(dedup.values());
    }
    const q = query(
      collection(db, 'challenges'),
      where('status', '==', 'completed'),
      where('winnerUids', 'array-contains-any', slice),
    );
    const snap = await withTimeout(getDocs(q));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.error('[challengeService] getCompletedChallengesByWinners failed:', error);
    return [];
  }
}

/**
 * Apply optimistic completions on top of the listener-delivered challenges so the UI flips
 * Active → Completed instantly, without waiting for the cloud function + Firestore round trip.
 *
 *  - challenges: array from subscribeToChallenges (or any listener)
 *  - optimisticCompletions: Map<challengeId, { activityId, completedAt }>
 *  - currentUid: viewer's uid (used to write the per-participant flip)
 *
 * Returns a new array. Challenge docs in the map get their participant + (for 1v1) overall
 * status flipped to 'completed'. The cloud function will eventually write the same fields;
 * once the listener delivers them, the overlay is a no-op.
 */
export function applyOptimisticChallengeCompletions(challenges, optimisticCompletions, currentUid) {
  if (!optimisticCompletions || optimisticCompletions.size === 0 || !currentUid) return challenges;
  return challenges.map(c => {
    const opt = optimisticCompletions.get(c.id);
    if (!opt) return c;
    // If the listener already delivered the real completion, skip the overlay.
    const myStatusReal = c.participants?.[currentUid]?.status
      || (c.friendUid === currentUid ? c.friendStatus : null);
    if (myStatusReal === 'completed') return c;

    const nowIso = new Date(opt.completedAt || Date.now()).toISOString();
    const next = { ...c };
    if (next.participants) {
      next.participants = {
        ...next.participants,
        [currentUid]: {
          ...(next.participants[currentUid] || {}),
          status: 'completed',
          completedAt: nowIso,
          fulfillingActivityId: String(opt.activityId || ''),
        },
      };
    }
    if (next.friendUid === currentUid) {
      next.friendStatus = 'completed';
      next.fulfillingActivityId = String(opt.activityId || '');
    }
    // For 1v1, the challenge itself is now complete. For group, only flip overall when every
    // other participant is already resolved (no pending or accepted).
    let overallComplete = next.type !== 'group';
    if (next.type === 'group' && next.participants) {
      const stillOpen = Object.entries(next.participants).some(([uid, p]) => {
        if (uid === currentUid) return false;
        return p.status === 'pending' || p.status === 'accepted';
      });
      overallComplete = !stillOpen;
    }
    if (overallComplete) {
      next.status = 'completed';
      next.completedAt = nowIso;
      const winners = new Set([...(next.winnerUids || []), currentUid]);
      if (next.participants) {
        for (const [uid, p] of Object.entries(next.participants)) {
          if (p.status === 'completed') winners.add(uid);
        }
      }
      next.winnerUids = Array.from(winners);
    }
    return next;
  });
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
