import React from 'react';
import FriendProfileCard from './FriendProfileCard';

/**
 * Modal showing the current user's own profile card. Thin wrapper around the shared
 * FriendProfileCard component so the user's view of themselves matches what friends see
 * when they tap a friend's avatar — same trophy-case layout, same stats, same shape.
 *
 * Skips the lazy fetch by passing `preloadedProfile` since App.jsx already has the user's
 * profile loaded (and live-subscribed for challengeStats updates) — `userData` carries
 * the most up-to-date streaks/personalRecords for the active session.
 */
export default function OwnProfileModal({ user, userProfile, userData, onClose }) {
  if (!user) return null;

  // Synthesize a friend-shaped identity object from auth + userProfile.
  const friend = {
    uid: user.uid,
    username: userProfile?.username,
    displayName: userProfile?.displayName,
    photoURL: userProfile?.photoURL,
  };

  // Preloaded profile blends userData (live local state, more recent than userProfile
  // for streaks/records) with userProfile (carries challengeStats from the live listener).
  const preloadedProfile = {
    streaks: userData?.streaks || userProfile?.streaks || {},
    personalRecords: userData?.personalRecords || userProfile?.personalRecords || {},
    challengeStats: userProfile?.challengeStats || {},
  };

  return (
    <FriendProfileCard
      friend={friend}
      preloadedProfile={preloadedProfile}
      onClose={onClose}
    />
  );
}
