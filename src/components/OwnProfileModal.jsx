import React, { useState, useEffect } from 'react';

/**
 * Modal showing the current user's own profile card. Mirrors FriendProfileModal in
 * ActivityFeed.jsx but trimmed: no head-to-head, no challenge button (you can't
 * challenge yourself), no friendship-state branching.
 */
export default function OwnProfileModal({ user, userProfile, userData, onClose }) {
  const [isAnimating, setIsAnimating] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [showFullPhoto, setShowFullPhoto] = useState(false);

  useEffect(() => {
    if (user) {
      setIsClosing(false);
      setShowFullPhoto(false);
      const t = setTimeout(() => setIsAnimating(true), 10);
      return () => clearTimeout(t);
    }
    setIsAnimating(false);
  }, [user]);

  const handleClose = () => {
    setIsAnimating(false);
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose?.();
    }, 250);
  };

  if (!user && !isClosing) return null;

  const initial = (userProfile?.displayName?.[0] || userProfile?.username?.[0] || '?').toUpperCase();
  const masterStreak = userData?.streaks?.master || 0;
  const liftsStreak = userData?.streaks?.lifts || 0;
  const cardioStreak = userData?.streaks?.cardio || 0;
  const recoveryStreak = userData?.streaks?.recovery || 0;
  const weeksWon = userData?.personalRecords?.weeksWon || 0;
  const challengesWon = userProfile?.challengeStats?.wins || 0;
  const challengesLost = userProfile?.challengeStats?.losses || 0;
  const challengesAccepted = userProfile?.challengeStats?.accepted || 0;
  const completionRate = challengesAccepted > 0 ? Math.round((challengesWon / challengesAccepted) * 100) : null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-300"
        style={{ backgroundColor: isAnimating ? 'rgba(0,0,0,0.8)' : 'rgba(0,0,0,0)' }}
        onClick={handleClose}
      >
        <div
          className="w-full max-w-sm bg-zinc-900 rounded-2xl p-6 transition-all duration-300 ease-out"
          style={{
            transform: isAnimating ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(20px)',
            opacity: isAnimating ? 1 : 0,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center gap-4 mb-6">
            <button
              onClick={() => userProfile?.photoURL && setShowFullPhoto(true)}
              className={`w-16 h-16 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0 ${userProfile?.photoURL ? 'cursor-pointer' : ''}`}
              style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
            >
              {userProfile?.photoURL ? (
                <img src={userProfile.photoURL} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-white text-2xl font-semibold">{initial}</span>
              )}
            </button>
            <div className="min-w-0">
              <p className="text-white font-bold text-lg truncate">{userProfile?.displayName || userProfile?.username || 'You'}</p>
              {userProfile?.username && <p className="text-gray-400 truncate">@{userProfile.username}</p>}
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="bg-zinc-800 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-white">{masterStreak}</p>
              <p className="text-gray-500 text-xs">Hybrid Streak</p>
            </div>
            <div className="bg-zinc-800 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-white">{weeksWon}</p>
              <p className="text-gray-500 text-xs">Weeks Won</p>
            </div>
            <div className="bg-zinc-800 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold">
                <span style={{ color: '#00FF94' }}>{challengesWon}</span>
                <span className="text-gray-600 mx-0.5">-</span>
                <span style={{ color: '#FF453A' }}>{challengesLost}</span>
              </p>
              <p className="text-gray-500 text-xs">Challenges W-L</p>
            </div>
          </div>

          {/* Streak breakdown */}
          <div className="space-y-2 mb-6">
            <div className="flex items-center justify-between bg-zinc-800 rounded-lg p-3">
              <span className="text-gray-400">💪 Strength Streak</span>
              <span className="text-white font-bold">{liftsStreak}</span>
            </div>
            <div className="flex items-center justify-between bg-zinc-800 rounded-lg p-3">
              <span className="text-gray-400">🏃 Cardio Streak</span>
              <span className="text-white font-bold">{cardioStreak}</span>
            </div>
            <div className="flex items-center justify-between bg-zinc-800 rounded-lg p-3">
              <span className="text-gray-400">🧘 Recovery Streak</span>
              <span className="text-white font-bold">{recoveryStreak}</span>
            </div>
            {completionRate !== null && (
              <div className="flex items-center justify-between rounded-lg p-3" style={{ backgroundColor: 'rgba(255,214,10,0.05)' }}>
                <span className="text-gray-400">🎯 Challenge Completion</span>
                <span className="text-white font-bold">{completionRate}%</span>
              </div>
            )}
          </div>

          <button
            onClick={handleClose}
            className="w-full py-3 rounded-full bg-zinc-800 text-white font-medium transition-all duration-150"
          >
            Close
          </button>
        </div>
      </div>

      {/* Fullscreen photo overlay */}
      {userProfile?.photoURL && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black transition-opacity duration-150"
          style={{
            opacity: showFullPhoto ? 1 : 0,
            pointerEvents: showFullPhoto ? 'auto' : 'none',
            visibility: showFullPhoto ? 'visible' : 'hidden',
          }}
          onClick={() => setShowFullPhoto(false)}
        >
          <div className="relative max-w-full max-h-full flex flex-col items-end" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setShowFullPhoto(false)}
              className="mb-2 mr-1 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center"
            >
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <img
              src={userProfile.photoURL}
              alt={userProfile.displayName || ''}
              className="max-w-[90vw] max-h-[85vh] rounded-2xl object-contain"
            />
          </div>
        </div>
      )}
    </>
  );
}
