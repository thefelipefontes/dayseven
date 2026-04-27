// Foreground snapshot of the Activity Feed used by App-level preload (so the
// first tap on the Friends tab renders instantly) and as the source of truth
// for the cache shape that ActivityFeed hydrates from.
//
// Returns { uid, activities, reactions, comments, replies, challengeMap } or
// null if no user. Demo accounts are not handled here — ActivityFeed builds
// dummy data inline since it's synchronous.

import { getUserActivities } from './userService';
import { getReactions, getComments, getReplies } from './friendService';
import { getCompletedChallengesByWinners } from './challengeService';

const ACTIVITY_LIMIT = 50;
const INITIAL_FETCH_COUNT = 10;

const parseActivityTime = (timeStr) => {
  if (!timeStr) return '12:00';
  const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return timeStr;
  let hours = parseInt(match[1]);
  const mins = match[2];
  const period = match[3].toUpperCase();
  if (period === 'AM' && hours === 12) hours = 0;
  else if (period === 'PM' && hours !== 12) hours += 12;
  return `${String(hours).padStart(2, '0')}:${mins}`;
};

export async function fetchFeedSnapshot({ user, userProfile, friends }) {
  if (!user?.uid) return null;
  const empty = { uid: user.uid, activities: [], reactions: {}, comments: {}, replies: {}, challengeMap: {} };
  if (!friends || friends.length === 0) return empty;

  // Fan out friend activity fetches in parallel
  const activityPromises = friends.map(async (friend) => {
    const activities = await getUserActivities(friend.uid);
    return activities.map(activity => ({
      ...activity,
      friend: {
        uid: friend.uid,
        username: friend.username,
        displayName: friend.displayName,
        photoURL: friend.photoURL,
      },
    }));
  });

  const allActivities = await Promise.all(activityPromises);
  const flatActivities = allActivities.flat();

  flatActivities.sort((a, b) => {
    const dateA = new Date(a.date + 'T' + parseActivityTime(a.time));
    const dateB = new Date(b.date + 'T' + parseActivityTime(b.time));
    return dateB - dateA;
  });

  const limitedActivities = flatActivities.slice(0, ACTIVITY_LIMIT);

  // Challenge tagging: single batched query keyed by friend uids; surfaces the
  // "Completed [sender]'s challenge" pill on each fulfilling activity.
  const challengeMap = {};
  try {
    const friendUids = friends.map(f => f.uid).filter(Boolean);
    if (friendUids.length > 0) {
      const completedChallenges = await getCompletedChallengesByWinners(friendUids);
      const friendsByUid = Object.fromEntries(friends.map(f => [f.uid, f]));
      for (const c of completedChallenges) {
        const isSelfChallenge = c.challengerUid === user.uid;
        const challengerFriend = !isSelfChallenge ? (friendsByUid[c.challengerUid] || null) : null;
        const meta = {
          challengeId: c.id,
          challengerUid: c.challengerUid,
          challengerName: c.challengerName || '',
          challengerUsername: isSelfChallenge
            ? (userProfile?.username || '')
            : (challengerFriend?.username || ''),
          challengerFriend,
          isSelfChallenge,
          originatingActivityId: c.challengerActivity?.activityId || null,
          requirePhoto: !!c.requirePhoto,
        };
        if (c.participants) {
          for (const [uid, p] of Object.entries(c.participants)) {
            if (p?.status === 'completed' && p?.fulfillingActivityId) {
              challengeMap[`${uid}-${p.fulfillingActivityId}`] = meta;
            }
          }
        }
        if (c.friendUid && c.friendStatus === 'completed' && c.fulfillingActivityId) {
          const k = `${c.friendUid}-${c.fulfillingActivityId}`;
          if (!challengeMap[k]) challengeMap[k] = meta;
        }
      }
    }
  } catch (err) {
    console.error('[feedService] challenge tagging failed:', err);
  }

  // Reactions/comments/replies for the first batch only — matching ActivityFeed's
  // behavior. The remaining 11–50 are fetched lazily when ActivityFeed mounts.
  const initialActivities = limitedActivities.slice(0, INITIAL_FETCH_COUNT);
  const reactions = {};
  const comments = {};
  const replies = {};

  await Promise.all(
    initialActivities.map(async (activity) => {
      if (!activity.id) return;
      const key = `${activity.friend.uid}-${activity.id}`;
      const [r, c] = await Promise.all([
        getReactions(activity.friend.uid, activity.id),
        getComments(activity.friend.uid, activity.id),
      ]);
      reactions[key] = r;
      comments[key] = c;

      if (c.length > 0) {
        replies[key] = {};
        await Promise.all(
          c.map(async (comment) => {
            const r2 = await getReplies(activity.friend.uid, activity.id, comment.id);
            if (r2.length > 0) {
              replies[key][comment.id] = r2;
            }
          })
        );
      }
    })
  );

  return {
    uid: user.uid,
    activities: limitedActivities,
    reactions,
    comments,
    replies,
    challengeMap,
  };
}
