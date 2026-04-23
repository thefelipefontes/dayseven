import React, { useState, useEffect, useRef } from 'react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import {
  createChallenge,
  acceptChallenge,
  declineChallenge,
  cancelChallenge,
  subscribeToChallenges,
  bucketChallenges,
  countActiveOutgoing,
  describeMatchRule,
  buildMatchRule,
  isChallengeable,
  CHALLENGE_WINDOW_HOURS,
  FREE_ACTIVE_CHALLENGE_CAP,
} from './services/challengeService';
import { getFriends } from './services/friendService';

const triggerHaptic = async (style = ImpactStyle.Light) => {
  try { await Haptics.impact({ style }); } catch {
    if (navigator.vibrate) navigator.vibrate(10);
  }
};

const CATEGORY_COLOR = {
  lifting: '#00FF94',
  cardio: '#FF9500',
  recovery: '#00D1FF',
};

function formatRemaining(expiresAt) {
  if (!expiresAt) return '';
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m left`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const remMins = mins % 60;
    return remMins > 0 ? `${hours}h ${remMins}m left` : `${hours}h left`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h left` : `${days}d left`;
}

/**
 * Hook: re-render every minute so countdowns stay fresh without a full page reload.
 */
function useTicker(intervalMs = 60000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

// =====================================================================
// Modal: pick which past activity to challenge with (opened from friend profile)
// =====================================================================

export function ChallengeActivityPickerModal({ isOpen, onClose, activities = [], friend, onPick }) {
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => { if (isOpen) setIsClosing(false); }, [isOpen]);

  if (!isOpen) return null;

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => onClose(), 250);
  };

  // Filter to challengeable activities (last 7 days, non-warmup, has matchable category)
  const eligible = (activities || []).filter(isChallengeable);
  // Sort newest first
  eligible.sort((a, b) => {
    const ta = new Date(a.date || 0).getTime() + (parseInt(a.id, 10) || 0) % 1000;
    const tb = new Date(b.date || 0).getTime() + (parseInt(b.id, 10) || 0) % 1000;
    return tb - ta;
  });

  return (
    <div
      className={`fixed inset-0 z-[70] flex items-end justify-center transition-all duration-250 ${isClosing ? 'bg-black/0' : 'bg-black/80'}`}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        className={`w-full bg-zinc-900 rounded-t-3xl flex flex-col ${isClosing ? 'animate-slide-down' : 'animate-slide-up'}`}
        style={{ maxHeight: '80vh' }}
      >
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 bg-zinc-700 rounded-full" />
        </div>

        <div className="flex items-center justify-between px-4 pb-3">
          <button onClick={handleClose} className="text-gray-400 text-sm font-medium">Cancel</button>
          <h1 className="text-white text-base font-semibold">Pick a workout</h1>
          <div className="w-12" />
        </div>

        <p className="text-xs text-gray-400 px-4 pb-3">
          Challenge {friend?.displayName || friend?.username || 'them'} with one of your last 7 days of workouts.
        </p>

        <div className="flex-1 overflow-y-auto pb-8 px-4">
          {eligible.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-gray-400 mb-2">No challengeable workouts in the last 7 days.</p>
              <p className="text-gray-500 text-sm">Log a workout, then come back here.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {eligible.map(activity => {
                const rule = buildMatchRule(activity);
                const color = CATEGORY_COLOR[rule?.category] || '#888';
                return (
                  <button
                    key={activity.id}
                    onClick={() => { triggerHaptic(ImpactStyle.Light); onPick?.(activity); }}
                    className="w-full p-3 rounded-xl text-left transition-colors"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.04)',
                      border: `1px solid ${color}25`,
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: `${color}20` }}
                      >
                        <span style={{ color, fontSize: 16 }}>⚡</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">
                          {activity.type === 'Other' ? (activity.subtype || 'Other') : activity.type}
                          {activity.subtype && activity.type !== 'Other' && ` · ${activity.subtype}`}
                        </p>
                        <p className="text-gray-500 text-xs">{activity.date} · {activity.duration || 0} min{activity.distance ? ` · ${activity.distance} mi` : ''}</p>
                        <p className="text-xs mt-1" style={{ color }}>Match: {describeMatchRule(rule)}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Modal: shown right after a user logs an activity, lets them challenge a friend
// =====================================================================

export function ChallengeFriendModal({ isOpen, onClose, user, userProfile, activity, friends = [], activeOutgoingCount = 0, isPro = false, onPresentPaywall, onCreated, preSelectedFriendUid = null }) {
  const [selectedFriendUids, setSelectedFriendUids] = useState(() => new Set());
  const [windowHours, setWindowHours] = useState(24);
  const [sendMode, setSendMode] = useState('group'); // 'group' or 'individual' — only relevant when 2+ selected
  const [title, setTitle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSelectedFriendUids(preSelectedFriendUid ? new Set([preSelectedFriendUid]) : new Set());
      setWindowHours(24);
      setSendMode('group');
      setTitle('');
      setError(null);
      setIsClosing(false);
    }
  }, [isOpen, preSelectedFriendUid]);

  if (!isOpen) return null;

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => onClose(), 250);
  };

  const toggleFriend = (uid) => {
    triggerHaptic(ImpactStyle.Light);
    setSelectedFriendUids(prev => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  };

  const matchRule = activity ? buildMatchRule(activity) : null;
  const canChallenge = !!matchRule;
  const overCap = !isPro && activeOutgoingCount >= FREE_ACTIVE_CHALLENGE_CAP;
  const selectedCount = selectedFriendUids.size;
  const isGroup = selectedCount > 1;

  const handleSend = async () => {
    if (selectedCount === 0 || !user?.uid) return;
    if (overCap) {
      onPresentPaywall?.();
      return;
    }

    setIsSubmitting(true);
    setError(null);
    triggerHaptic(ImpactStyle.Medium);

    const friendUidsArray = Array.from(selectedFriendUids);
    const challengerName = userProfile?.displayName || userProfile?.username || '';

    let allFailed = false;
    if (selectedCount > 1 && sendMode === 'individual') {
      // Fan out: one separate 1v1 challenge per friend
      const results = await Promise.all(friendUidsArray.map(uid =>
        createChallenge({
          challengerUid: user.uid,
          challengerName,
          friendUids: [uid],
          activity,
          windowHours,
          title,
        })
      ));
      allFailed = results.every(r => r.error);
    } else {
      // 1v1 OR group (single shared challenge)
      const result = await createChallenge({
        challengerUid: user.uid,
        challengerName,
        friendUids: friendUidsArray,
        activity,
        windowHours,
        title,
      });
      allFailed = !!result.error;
    }

    setIsSubmitting(false);

    if (allFailed) {
      setError('Could not send challenge. Try again.');
      return;
    }

    onCreated?.();
    handleClose();
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end justify-center transition-all duration-250 ${isClosing ? 'bg-black/0' : 'bg-black/80'}`}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        className={`w-full bg-zinc-900 rounded-t-3xl flex flex-col ${isClosing ? 'animate-slide-down' : 'animate-slide-up'}`}
        style={{ maxHeight: '80vh' }}
      >
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 bg-zinc-700 rounded-full" />
        </div>

        <div className="flex items-center justify-between px-4 pb-3">
          <button onClick={handleClose} className="text-gray-400 text-sm font-medium">Skip</button>
          <h1 className="text-white text-lg font-semibold">Challenge a friend</h1>
          <div className="w-10" />
        </div>

        {!canChallenge ? (
          <div className="px-6 py-12 text-center">
            <p className="text-gray-400 mb-2">This activity can't be challenged.</p>
            <p className="text-gray-500 text-sm">Warmups and untracked activities aren't supported yet.</p>
            <button onClick={handleClose} className="mt-6 px-6 py-3 rounded-xl bg-zinc-800 text-white font-medium">Close</button>
          </div>
        ) : (
          <>
            {/* Scrollable middle */}
            <div className="flex-1 overflow-y-auto px-4 pb-3">
              {/* Title (optional) */}
              <p className="text-xs text-gray-400 mb-2">Title (optional)</p>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={60}
                placeholder="e.g. Saturday long run"
                className="w-full mb-4 px-3 py-3 rounded-xl text-white placeholder-gray-600 text-sm focus:outline-none"
                style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              />

              {/* Match rule preview */}
              <div
                className="mb-4 p-3 rounded-xl"
                style={{
                  backgroundColor: `${CATEGORY_COLOR[matchRule.category] || '#888'}10`,
                  border: `1px solid ${CATEGORY_COLOR[matchRule.category] || '#888'}30`
                }}
              >
                <p className="text-xs text-gray-400 mb-0.5">They'll need to:</p>
                <p className="text-white font-medium">{describeMatchRule(matchRule)}</p>
              </div>

              {/* Window picker */}
              <p className="text-xs text-gray-400 mb-2">Time to complete</p>
              <div className="flex gap-2 mb-5">
                {CHALLENGE_WINDOW_HOURS.map(hrs => (
                  <button
                    key={hrs}
                    onClick={() => { setWindowHours(hrs); triggerHaptic(ImpactStyle.Light); }}
                    className="flex-1 py-3 rounded-xl text-sm font-medium transition-colors"
                    style={{
                      backgroundColor: windowHours === hrs ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)',
                      color: windowHours === hrs ? 'white' : 'rgba(255,255,255,0.6)',
                      border: windowHours === hrs ? '1px solid rgba(255,255,255,0.2)' : '1px solid transparent'
                    }}
                  >
                    {hrs}h
                  </button>
                ))}
              </div>

              {/* Free-tier cap banner */}
              {overCap && (
                <button
                  onClick={onPresentPaywall}
                  className="w-full mb-4 p-3 rounded-xl text-left"
                  style={{ backgroundColor: 'rgba(255,149,0,0.08)', border: '1px solid rgba(255,149,0,0.2)' }}
                >
                  <p className="text-sm" style={{ color: '#FF9500' }}>
                    You have {activeOutgoingCount} active challenges. Upgrade to Pro for unlimited.
                  </p>
                </button>
              )}

              {/* Friend picker (multi-select) */}
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-gray-400">{isGroup ? `Pick friends (${selectedCount} selected)` : 'Pick a friend'}</p>
                {selectedCount > 0 && (
                  <button onClick={() => setSelectedFriendUids(new Set())} className="text-xs text-gray-500">Clear</button>
                )}
              </div>

              {/* Group / Individual mode toggle — only when 2+ selected */}
              {isGroup && (
                <div className="flex p-1 rounded-lg mb-3" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  {[
                    { key: 'group', label: 'Group', sublabel: 'One shared challenge' },
                    { key: 'individual', label: 'Individual', sublabel: 'Separate 1v1 with each' }
                  ].map(opt => {
                    const active = sendMode === opt.key;
                    return (
                      <button
                        key={opt.key}
                        onClick={() => { setSendMode(opt.key); triggerHaptic(ImpactStyle.Light); }}
                        className="flex-1 py-2 rounded-md text-center transition-colors"
                        style={{
                          backgroundColor: active ? 'rgba(255,214,10,0.15)' : 'transparent',
                          color: active ? '#FFD60A' : 'rgba(255,255,255,0.5)',
                          border: active ? '1px solid rgba(255,214,10,0.3)' : '1px solid transparent',
                        }}
                      >
                        <div className="text-sm font-semibold">{opt.label}</div>
                        <div className="text-[10px] mt-0.5" style={{ color: active ? 'rgba(255,214,10,0.7)' : 'rgba(255,255,255,0.35)' }}>{opt.sublabel}</div>
                      </button>
                    );
                  })}
                </div>
              )}

              {friends.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-gray-500 text-sm">Add some friends first to send challenges.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {friends.map(f => {
                    const selected = selectedFriendUids.has(f.uid);
                    return (
                      <button
                        key={f.uid}
                        onClick={() => toggleFriend(f.uid)}
                        className="w-full flex items-center gap-3 p-3 rounded-xl transition-colors"
                        style={{
                          backgroundColor: selected ? 'rgba(255,255,255,0.08)' : 'transparent',
                          border: selected ? '1px solid rgba(255,255,255,0.15)' : '1px solid transparent'
                        }}
                      >
                        <div className="w-10 h-10 rounded-full bg-zinc-800 overflow-hidden flex items-center justify-center text-white text-sm">
                          {f.photoURL ? <img src={f.photoURL} className="w-full h-full object-cover" alt="" /> : (f.displayName || f.username || '?').charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 text-left">
                          <p className="text-white text-sm font-medium">{f.displayName || f.username}</p>
                          {f.username && f.displayName && <p className="text-gray-500 text-xs">@{f.username}</p>}
                        </div>
                        <div
                          className="w-5 h-5 rounded-md flex items-center justify-center transition-colors"
                          style={{
                            backgroundColor: selected ? '#FFD60A' : 'transparent',
                            border: selected ? '1px solid #FFD60A' : '1px solid rgba(255,255,255,0.2)'
                          }}
                        >
                          {selected && (
                            <svg className="w-3.5 h-3.5" fill="none" stroke="black" viewBox="0 0 24 24" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                            </svg>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Sticky footer — CTA always visible */}
            <div
              className="px-4 pt-3 border-t"
              style={{
                borderColor: 'rgba(255,255,255,0.06)',
                paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
                backgroundColor: '#18181b'
              }}
            >
              {error && (
                <p className="text-red-400 text-sm text-center mb-2">{error}</p>
              )}
              <button
                onClick={handleSend}
                disabled={selectedCount === 0 || isSubmitting}
                className="w-full py-3.5 rounded-xl font-semibold transition-opacity"
                style={{
                  backgroundColor: selectedCount > 0 ? '#FFD60A' : 'rgba(255,255,255,0.1)',
                  color: selectedCount > 0 ? 'black' : 'rgba(255,255,255,0.4)',
                  opacity: isSubmitting ? 0.6 : 1
                }}
              >
                {isSubmitting
                  ? 'Sending...'
                  : overCap
                    ? 'Upgrade to Pro'
                    : selectedCount === 0
                      ? 'Pick a friend'
                      : selectedCount === 1
                        ? 'Send Challenge'
                        : sendMode === 'individual'
                          ? `Send ${selectedCount} individual challenges`
                          : `Challenge ${selectedCount} friends as a group`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// =====================================================================
// Card: one challenge row in the Home section
// =====================================================================

export function ChallengeCard({ challenge, currentUid, onAccept, onDecline, onCancel }) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const isChallenger = challenge.challengerUid === currentUid;
  const isGroup = challenge.type === 'group';
  const color = CATEGORY_COLOR[challenge.matchRule?.category] || '#888';
  const ruleLabel = describeMatchRule(challenge.matchRule);

  // For groups, my personal status drives accept/decline; for 1v1 fall back to legacy fields.
  const myParticipant = challenge.participants?.[currentUid];
  const myStatus = myParticipant?.status || (challenge.friendUid === currentUid ? challenge.friendStatus : null);

  // Personal countdown: groups have per-participant expiresAt once accepted; otherwise overall.
  const personalExpiresAt = myParticipant?.expiresAt || challenge.expiresAt;
  const remaining = formatRemaining(isChallenger ? challenge.expiresAt : personalExpiresAt);

  // Title row varies by 1v1 vs group, and challenger vs recipient
  let title;
  if (isGroup) {
    if (isChallenger) {
      const total = (challenge.participantUids || []).length - 1; // excludes challenger
      title = `Group challenge · ${total} friends`;
    } else {
      title = `${challenge.challengerName || 'Friend'} + group`;
    }
  } else {
    title = isChallenger
      ? (challenge.friendName || 'Friend')
      : (challenge.challengerName || 'Friend');
  }

  // Group progress count (challenger view)
  let groupProgress = null;
  if (isGroup && isChallenger && challenge.participants) {
    const states = Object.values(challenge.participants);
    const completed = states.filter(p => p.status === 'completed').length;
    const total = states.length;
    groupProgress = `${completed} of ${total} complete`;
  }

  let statusLabel;
  if (isChallenger) {
    if (challenge.status === 'pending') statusLabel = 'Waiting for response';
    else if (challenge.status === 'active') statusLabel = groupProgress || 'In progress';
    else if (challenge.status === 'completed') statusLabel = groupProgress || 'Completed';
  } else {
    if (myStatus === 'pending') statusLabel = isGroup ? 'Group challenge for you' : 'Wants to challenge you';
    else if (myStatus === 'accepted') statusLabel = 'Your challenge';
    else if (myStatus === 'completed') statusLabel = 'You completed it';
  }

  const showAcceptDecline = !isChallenger && myStatus === 'pending';
  const showCancel = isChallenger && challenge.status === 'pending';
  const showCountdown = isChallenger
    ? (challenge.status !== 'completed')
    : (myStatus === 'accepted'); // recipients only see countdown once they've accepted

  return (
    <div
      className="p-3 rounded-xl"
      style={{
        backgroundColor: 'rgba(255,255,255,0.03)',
        border: `1px solid ${color}25`,
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${color}20` }}
        >
          <span style={{ color, fontSize: 18 }}>{isGroup ? '👥' : '⚡'}</span>
        </div>
        <div className="flex-1 min-w-0">
          {challenge.title ? (
            <>
              <p className="text-white text-sm font-semibold truncate">{challenge.title}</p>
              <p className="text-gray-500 text-xs truncate">{title}</p>
            </>
          ) : (
            <p className="text-white text-sm font-medium truncate">{title}</p>
          )}
          <p className="text-gray-500 text-xs">{statusLabel}</p>
          <p className="text-white text-sm mt-1">{ruleLabel}</p>
          {showCountdown && (
            <p className="text-xs mt-0.5" style={{ color: remaining === 'Expired' ? '#ef4444' : 'rgba(255,255,255,0.5)' }}>
              {remaining}
            </p>
          )}
        </div>
      </div>

      {showAcceptDecline && (
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => onDecline?.(challenge)}
            className="flex-1 py-2 rounded-lg text-sm font-medium bg-zinc-800 text-gray-300"
          >
            Decline
          </button>
          <button
            onClick={() => onAccept?.(challenge)}
            className="flex-1 py-2 rounded-lg text-sm font-semibold"
            style={{ backgroundColor: color, color: 'black' }}
          >
            Accept
          </button>
        </div>
      )}

      {showCancel && (
        <div className="mt-3">
          {!confirmCancel ? (
            <button
              onClick={() => { triggerHaptic(ImpactStyle.Light); setConfirmCancel(true); }}
              className="w-full py-2 rounded-lg text-sm font-medium"
              style={{ backgroundColor: 'rgba(255,69,58,0.08)', color: '#FF453A' }}
            >
              Cancel Challenge
            </button>
          ) : (
            <div>
              <p className="text-xs text-gray-400 text-center mb-2">Cancel this challenge?</p>
              <div className="flex gap-2">
                <button
                  onClick={() => { triggerHaptic(ImpactStyle.Light); setConfirmCancel(false); }}
                  className="flex-1 py-2 rounded-lg text-sm font-medium bg-zinc-800 text-gray-300"
                >
                  Keep It
                </button>
                <button
                  onClick={() => { triggerHaptic(ImpactStyle.Medium); onCancel?.(challenge); }}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold text-white"
                  style={{ backgroundColor: '#FF453A' }}
                >
                  Yes, Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Section: rendered on the Home tab. Self-loads challenges + handles actions.
// =====================================================================

export function ChallengesSection({ user, friends = [], onChallengeCountsChange }) {
  const [challenges, setChallenges] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  useTicker(60000);

  // Real-time subscription: fires immediately on mount with current state,
  // then pushes any update — create, accept, decline, complete, expire — within ms.
  useEffect(() => {
    if (!user?.uid) return;
    const unsub = subscribeToChallenges(user.uid, (list) => {
      setChallenges(list);
      setIsLoading(false);
    });
    return () => { try { unsub?.(); } catch {} };
  }, [user?.uid]);

  // Hydrate friend names onto challenges (challenger snapshot already has challengerName,
  // but for outgoing challenges we want to show the recipient's name)
  const friendsByUid = React.useMemo(() => {
    const map = {};
    for (const f of friends) map[f.uid] = f;
    return map;
  }, [friends]);

  const enriched = React.useMemo(() => challenges.map(c => ({
    ...c,
    friendName: friendsByUid[c.friendUid]?.displayName || friendsByUid[c.friendUid]?.username || c.friendName || '',
  })), [challenges, friendsByUid]);

  const buckets = React.useMemo(() => bucketChallenges(enriched, user?.uid), [enriched, user?.uid]);

  // Notify parent of pending-received count for badging the home tab
  useEffect(() => {
    onChallengeCountsChange?.({
      pendingReceivedCount: buckets.pendingReceived.length,
      activeOutgoingCount: countActiveOutgoing(enriched, user?.uid),
    });
  }, [buckets.pendingReceived.length, enriched, user?.uid, onChallengeCountsChange]);

  // Accept/decline/cancel — the real-time listener picks up the write automatically,
  // so no manual reload needed.
  const handleAccept = async (c) => {
    triggerHaptic(ImpactStyle.Medium);
    await acceptChallenge(c.id, user.uid);
  };

  const handleDecline = async (c) => {
    triggerHaptic(ImpactStyle.Light);
    await declineChallenge(c.id, user.uid);
  };

  const handleCancel = async (c) => {
    triggerHaptic(ImpactStyle.Light);
    await cancelChallenge(c.id, user.uid);
  };

  const totalVisible = buckets.pendingReceived.length + buckets.active.length + buckets.pendingSent.length;

  // Don't render anything if no challenges and not loading — keeps the home tab clean for new users
  if (!isLoading && totalVisible === 0) return null;

  return (
    <div className="px-4 mb-4">
      <div className="mb-3">
        <div className="flex items-center gap-2">
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#04d1ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
          <span className="text-[20px] font-semibold text-white" style={{ letterSpacing: '-0.3px' }}>Challenges</span>
          {buckets.pendingReceived.length > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#FFD60A', color: 'black' }}>
              {buckets.pendingReceived.length}
            </span>
          )}
        </div>
        <p className="text-[13px] -mt-1 pl-[30px]" style={{ color: '#777' }}>Active bets with your friends</p>
      </div>

      {isLoading ? (
        <div className="py-6 flex justify-center">
          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          {buckets.pendingReceived.map(c => (
            <ChallengeCard key={c.id} challenge={c} currentUid={user.uid}
              onAccept={handleAccept} onDecline={handleDecline} />
          ))}
          {buckets.active.map(c => (
            <ChallengeCard key={c.id} challenge={c} currentUid={user.uid} />
          ))}
          {buckets.pendingSent.map(c => (
            <ChallengeCard key={c.id} challenge={c} currentUid={user.uid}
              onCancel={handleCancel} />
          ))}
        </div>
      )}
    </div>
  );
}
