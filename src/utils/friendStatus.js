// What someone's streaks are doing right now, for the badge on their profile card and next
// to their name on the leaderboard: on vacation, on an injury pause, or held by the Streak
// Shield last week. One at a time, in that order.
//
// Read from their profile as stored, which only updates when they open the app, so this
// applies the same auto-ends their app would on its next launch: vacation after 14 days
// (App.jsx's vacation load), injury at its end week (App.jsx's injury load).

import { weekKeyFromDate } from './weekGoals';
import { addWeeks, isHoldWeek } from './streakShield';

const DAY_MS = 24 * 60 * 60 * 1000;

export const FRIEND_STATUS = {
  vacation: { emoji: '🌴', label: 'On vacation', detail: 'streaks paused' },
  injury: { emoji: '🩹', label: 'Injury pause', detail: 'streaks paused' },
  held: { emoji: '🛡️', label: 'Last week held', detail: 'streak safe' },
};

/** 'vacation' | 'injury' | 'held' | null for a user profile doc. */
export const friendStatus = (profile, now = new Date()) => {
  if (!profile) return null;
  const thisWeek = weekKeyFromDate(now);

  const vm = profile.vacationMode;
  if (vm?.isActive) {
    const start = vm.startDate ? new Date(`${vm.startDate}T12:00:00`) : null;
    if (!start || Math.floor((now - start) / DAY_MS) < 14) return 'vacation';
  }

  const im = profile.injuryMode;
  if (im?.isActive) {
    const endWeek = im.endWeek || im.estimatedEndWeek;
    if (!endWeek || thisWeek < endWeek) return 'injury';
  }

  // A hold lands once a week closes, so "held" means last week, shown all of this week.
  if (isHoldWeek(profile.streakShield, addWeeks(thisWeek, -1))) return 'held';
  return null;
};
