// What a push shows when it arrives with the app open. The server writes every push's
// title and body; this only rearranges them so the person comes first and the kind of
// notification shows as an emoji, the way the in-app banner lays it out.

import { getActivityCategory } from './activityCategory';

// Social pushes: the badge on the sender's photo, and how to read their name back out of
// the body the server wrote (sendNotificationToUser in functions/index.js).
const SOCIAL = {
  comment: { badge: '💬', name: /^(.+?): "/, action: () => 'commented on your', quote: true },
  reply: { badge: '💬', name: /^(.+?) replied: "/, action: () => 'replied to your comment', quote: true },
  reaction: { badge: null, name: /^(.+?) reacted /, action: (emoji) => `reacted ${emoji} to your` },
  friend_request: { badge: '👋', name: /^(.+?) wants to be your friend/, action: () => 'wants to be your friend', detail: 'Tap to see the request' },
  friend_accepted: { badge: '🤝', name: /^(.+?) accepted your friend request/, action: () => 'accepted your friend request' },
  friend_workout: { badge: '💪', name: /^(.+?) completed /, action: () => 'just worked out' },
};

// For pushes whose title doesn't end in an emoji of its own.
const TYPE_EMOJI = {
  challenge_received: '🎯',
  challenge_accepted: '🎯',
  challenge_completed: '🏆',
  challenge_expiring: '⏰',
  challenge_accept_expired: '⌛',
  challenge_cancel_requested: '🤝',
  challenge_cancel_accepted: '🤝',
  challenge_cancel_declined: '🤝',
  challenge_pick_which: '🎯',
  streak_reminder: '🔥',
  goal_reminder: '🎯',
  daily_reminder: '⏰',
  streak_milestone: '🔥',
  goal_achieved: '🏆',
  weekly_summary: '📊',
  monthly_summary: '📊',
  new_activity_detected: '⌚',
  add_strength_details: '💪',
  trial_ending: '⏳',
  trial_final: '⏳',
  winback: '👋',
  activation: '🔥',
};

const TRAILING_EMOJI = /\s*(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)\s*$/u;

const ACTIVITY_NOUNS = [
  [/run/i, 'run'],
  [/walk/i, 'walk'],
  [/cycl|bike|ride/i, 'ride'],
  [/swim/i, 'swim'],
  [/hik/i, 'hike'],
  [/yoga/i, 'yoga'],
  [/pilates/i, 'pilates'],
];

// "run", "lift" and so on, for "commented on your run". Only the user's own activities
// get comments and reactions, so the id is looked up in their list.
const activityNoun = (activity) => {
  if (!activity) return 'activity';
  const match = ACTIVITY_NOUNS.find(([pattern]) => pattern.test(activity.type || ''));
  if (match) return match[1];
  const category = getActivityCategory(activity);
  if (category === 'lifting' || category === 'lifting+cardio') return 'lift';
  if (category === 'cardio') return 'workout';
  return 'activity';
};

const activitySummary = (activity) => {
  if (!activity?.type) return '';
  return activity.duration ? `${activity.type} · ${Math.round(activity.duration)} min` : activity.type;
};

// { type, uid, person, name, action, detail, emoji, avatar }: `avatar` means `emoji` is a
// badge on the photo of `uid`, whose name is `person` when the body gives it; otherwise
// the emoji fills a grey tile. `name` is the bold start of the first line and `action`
// the rest of it.
export function describeInAppNotification(notification, { activities = [] } = {}) {
  const n = notification?.notification || notification || {};
  const data = n.data || notification?.data || {};
  const type = data.type || '';
  const uid = data.fromUserId || data.friendUserId || null;
  const rawTitle = (n.title || '').trim();
  const body = (n.body || '').trim();

  const titleEmoji = rawTitle.match(TRAILING_EMOJI)?.[1] || null;
  const title = rawTitle.replace(TRAILING_EMOJI, '');

  const social = SOCIAL[type];
  const name = social ? (body.match(social.name)?.[1] || data.fromUserName || null) : null;

  if (social && name) {
    const activity = data.activityId
      ? activities.find((a) => String(a.id) === String(data.activityId))
      : null;
    let action = social.action(data.emoji || '👍');
    if (action.endsWith('your')) action += ` ${activityNoun(activity)}`;
    let detail = social.detail || '';
    if (social.quote) {
      const quoted = body.match(/"([\s\S]*)"\s*$/)?.[1];
      detail = quoted ? `“${quoted}”` : '';
    } else if (type === 'reaction') {
      detail = activitySummary(activity);
    } else if (type === 'friend_workout') {
      detail = body.slice(name.length).trim().replace(/^completed/, 'Completed');
    }
    return {
      type,
      uid,
      person: name,
      name,
      action,
      detail,
      emoji: social.badge || data.emoji || '👍',
      avatar: Boolean(uid),
    };
  }

  return {
    type,
    uid,
    person: name || data.fromUserName || null,
    name: title || body,
    action: '',
    detail: title ? body : '',
    emoji: titleEmoji || social?.badge || TYPE_EMOJI[type] || '🔔',
    avatar: Boolean(uid),
  };
}
