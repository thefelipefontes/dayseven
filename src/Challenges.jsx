import React, { useState, useEffect, useRef } from 'react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import {
  createChallenge,
  subscribeToChallenges,
  bucketChallenges,
  countActiveOutgoing,
  describeMatchRule,
  buildMatchRule,
  isChallengeable,
  CHALLENGE_WINDOW_HOURS,
  FREE_ACTIVE_CHALLENGE_CAP,
  applyOptimisticChallengeCompletions,
  evaluateActivityAgainstChallenge,
  availableChallengeMetrics,
  formatPace,
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

  // Filter to challengeable activities (same day only, non-warmup, has matchable category)
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
          Challenge {friend?.displayName || friend?.username || 'them'} with a workout from today.
        </p>

        <div className="flex-1 overflow-y-auto pb-8 px-4">
          {eligible.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-gray-400 mb-2">No workouts logged today.</p>
              <p className="text-gray-500 text-sm">Challenges are same-day only — log a workout first, then come back here.</p>
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
// Modal: from an active challenge card, pick an already-logged activity to apply.
// Filters to activities matching the challenge's rule (category + type + target threshold).
// =====================================================================

export function ChallengeApplyPastActivityModal({ isOpen, onClose, activities = [], challenge, onPick }) {
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => { if (isOpen) setIsClosing(false); }, [isOpen]);

  if (!isOpen || !challenge) return null;

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => onClose(), 250);
  };

  // Show only activities that fully match the challenge rule (qualifying type AND target met).
  // Cap to last 14 days so the list stays scannable.
  const cutoffMs = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const eligible = (activities || []).filter(a => {
    const at = new Date(a.date || 0).getTime();
    if (!at || at < cutoffMs) return false;
    return evaluateActivityAgainstChallenge(a, challenge.matchRule).matches;
  });
  // Newest first (date + small id tiebreak so multiple-on-same-day aren't shuffled).
  eligible.sort((a, b) => {
    const ta = new Date(a.date || 0).getTime() + (parseInt(a.id, 10) || 0) % 1000;
    const tb = new Date(b.date || 0).getTime() + (parseInt(b.id, 10) || 0) % 1000;
    return tb - ta;
  });

  const ruleLabel = describeMatchRule(challenge.matchRule);
  const cat = challenge.matchRule?.category;
  const color = CATEGORY_COLOR[cat] || '#888';

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
          <h1 className="text-white text-base font-semibold">Pick an activity</h1>
          <div className="w-12" />
        </div>

        <p className="text-xs px-4 pb-3" style={{ color }}>
          Must match: {ruleLabel}
        </p>

        <div className="flex-1 overflow-y-auto pb-8 px-4">
          {eligible.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-gray-400 mb-2">No matching activities yet.</p>
              <p className="text-gray-500 text-sm">Log a workout that meets the target ({ruleLabel}) and it'll show up here.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {eligible.map(activity => (
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
                      <p className="text-gray-500 text-xs">{activity.date}{activity.duration ? ` · ${activity.duration} min` : ''}{activity.distance ? ` · ${parseFloat(activity.distance).toFixed(1)} mi` : ''}</p>
                    </div>
                  </div>
                </button>
              ))}
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
  const [requirePhoto, setRequirePhoto] = useState(false);
  // Which dimension of the activity the recipient must match: 'distance', 'duration', or 'pace'.
  // Only meaningful when 2+ metrics are available (distance cardio with both miles + minutes).
  const [metric, setMetric] = useState('auto');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [isClosing, setIsClosing] = useState(false);

  const metrics = React.useMemo(() => availableChallengeMetrics(activity), [activity]);

  useEffect(() => {
    if (isOpen) {
      setSelectedFriendUids(preSelectedFriendUid ? new Set([preSelectedFriendUid]) : new Set());
      setWindowHours(24);
      setSendMode('group');
      setTitle('');
      setRequirePhoto(false);
      // Default metric: distance for distance-cardio (preserves prior behavior), else first available.
      setMetric(metrics.includes('distance') ? 'distance' : (metrics[0] || 'auto'));
      setError(null);
      setIsClosing(false);
    }
  }, [isOpen, preSelectedFriendUid, metrics]);

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

  const matchRule = activity ? buildMatchRule(activity, metric) : null;
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
          requirePhoto,
          metric,
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
        requirePhoto,
        metric,
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

              {/* Metric picker — only when 2+ are available (distance cardio with miles + minutes).
                  Each segment shows the value the recipient must match, so the choice is concrete. */}
              {metrics.length > 1 && (() => {
                const distance = parseFloat(activity?.distance) || 0;
                const duration = parseInt(activity?.duration, 10) || 0;
                const labels = {
                  distance: distance ? `${distance.toFixed(distance % 1 === 0 ? 0 : 1)} mi` : '—',
                  duration: duration ? `${duration} min` : '—',
                  pace: (distance && duration) ? `${formatPace(Math.round((duration * 60) / distance))} /mi` : '—',
                };
                const titles = { distance: 'Distance', duration: 'Time', pace: 'Pace' };
                const ruleColor = CATEGORY_COLOR[matchRule.category] || '#888';
                return (
                  <>
                    <p className="text-xs text-gray-400 mb-2">Match on</p>
                    <div className="flex gap-2 mb-3">
                      {metrics.map(m => {
                        const isSelected = metric === m;
                        return (
                          <button
                            key={m}
                            onClick={() => { setMetric(m); triggerHaptic(ImpactStyle.Light); }}
                            className="flex-1 py-2 rounded-xl text-xs font-medium transition-colors"
                            style={{
                              backgroundColor: isSelected ? `${ruleColor}1A` : 'rgba(255,255,255,0.04)',
                              color: isSelected ? 'white' : 'rgba(255,255,255,0.6)',
                              border: `1px solid ${isSelected ? ruleColor : 'transparent'}`,
                            }}
                          >
                            <div className="font-semibold">{titles[m]}</div>
                            <div className="text-[10px] mt-0.5 opacity-80">{labels[m]}</div>
                          </button>
                        );
                      })}
                    </div>
                  </>
                );
              })()}

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

              {/* Require-photo toggle */}
              <button
                onClick={() => { setRequirePhoto(p => !p); triggerHaptic(ImpactStyle.Light); }}
                className="w-full flex items-center justify-between p-3 rounded-xl mb-5 text-left"
                style={{
                  backgroundColor: requirePhoto ? 'rgba(255,214,10,0.08)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${requirePhoto ? 'rgba(255,214,10,0.3)' : 'transparent'}`,
                }}
              >
                <div>
                  <p className="text-sm font-medium text-white">📸 Require photo proof</p>
                  <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    They must attach a photo to their workout for it to count.
                  </p>
                </div>
                <div
                  className="w-10 h-6 rounded-full relative transition-colors flex-shrink-0 ml-3"
                  style={{ backgroundColor: requirePhoto ? '#FFD60A' : 'rgba(255,255,255,0.15)' }}
                >
                  <div
                    className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all"
                    style={{ left: requirePhoto ? '18px' : '2px' }}
                  />
                </div>
              </button>

              {/* Free-tier gate: sending challenges is Pro-only */}
              {overCap && (
                <button
                  onClick={onPresentPaywall}
                  className="w-full mb-4 p-3 rounded-xl text-left"
                  style={{ backgroundColor: 'rgba(255,149,0,0.08)', border: '1px solid rgba(255,149,0,0.2)' }}
                >
                  <p className="text-sm font-medium" style={{ color: '#FF9500' }}>
                    Sending challenges is a Pro feature.
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'rgba(255,149,0,0.8)' }}>
                    Upgrade to challenge your friends.
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

// Small mono SVG glyph keyed off the matchRule category. Used inside the center
// "vs" badge between the two avatars on a challenge card.
function ActivityGlyph({ category, size = 11, color = 'black' }) {
  const stroke = { stroke: color, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' };
  if (category === 'lifting') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
        <path d="M3 9v6M21 9v6M6 7v10M18 7v10M6 12h12" />
      </svg>
    );
  }
  if (category === 'cardio') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <path d="M13 2L3 14h7l-1 8 11-13h-7l0-7z" />
      </svg>
    );
  }
  if (category === 'recovery') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
        <path d="M12 3c4 4 4 10 0 14M12 3c-4 4-4 10 0 14M12 17v4" />
      </svg>
    );
  }
  return null;
}

// Tiny avatar bubble. Renders a square photo if available, otherwise an initial on a
// neutral background. Used inside ChallengeIcon for the stacked "you vs them" badge.
function MiniAvatar({ photoURL, initial, size, borderColor }) {
  return (
    <div
      className="rounded-full overflow-hidden flex items-center justify-center flex-shrink-0"
      style={{
        width: size,
        height: size,
        backgroundColor: '#27272a',
        border: `1.5px solid ${borderColor}`,
        boxSizing: 'border-box',
      }}
    >
      {photoURL ? (
        <img src={photoURL} alt="" className="w-full h-full object-cover" />
      ) : (
        <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: Math.round(size * 0.45), fontWeight: 600 }}>
          {(initial || '?').toUpperCase()}
        </span>
      )}
    </div>
  );
}

/**
 * Visual identity of a challenge row: two overlapping avatars (you + opponent)
 * with the category-colored activity badge centered on top of the overlap zone
 * as a "vs" stamp. Avatars stay in-flow (negative margin for overlap) — only the
 * single small icon uses absolute positioning, which kept iOS WebKit happy where
 * an earlier all-absolute version did not.
 */
function ChallengeIcon({ category, color, mePhotoURL, meInitial, opponentPhotoURL, opponentInitial, isGroup, groupCount }) {
  const avatarSize = 40;
  const iconSize = 19;
  const overlap = 8;
  const cardBg = '#0d0d0e'; // matches the card background blend; used as avatar/badge border
  return (
    <div className="relative flex items-center flex-shrink-0">
      <MiniAvatar photoURL={mePhotoURL} initial={meInitial} size={avatarSize} borderColor={cardBg} />
      <div className="relative flex-shrink-0" style={{ marginLeft: -overlap, width: avatarSize, height: avatarSize }}>
        <MiniAvatar photoURL={opponentPhotoURL} initial={opponentInitial} size={avatarSize} borderColor={cardBg} />
        {isGroup && (
          <div
            className="absolute rounded-full flex items-center justify-center"
            style={{
              right: -4,
              bottom: -4,
              minWidth: 16,
              height: 16,
              padding: '0 4px',
              backgroundColor: color,
              color: 'black',
              fontSize: 9,
              fontWeight: 700,
              border: `1.5px solid ${cardBg}`,
              boxSizing: 'border-box',
              lineHeight: '12px',
            }}
          >
            +{Math.max(1, groupCount || 1)}
          </div>
        )}
      </div>
      {/* Activity badge — single absolutely-positioned element centered on the overlap zone. */}
      <div
        className="absolute rounded-full flex items-center justify-center pointer-events-none"
        style={{
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: iconSize,
          height: iconSize,
          backgroundColor: color,
          border: `2px solid ${cardBg}`,
          boxSizing: 'border-box',
          zIndex: 10,
        }}
      >
        <ActivityGlyph category={category} size={Math.round(iconSize * 0.55)} color="black" />
      </div>
    </div>
  );
}

// Tiny pill shown next to the friend's name on a challenge card so you can tell
// at a glance whether you're the challenger (Sent) or the recipient (Received).
function PerspectivePill({ isChallenger }) {
  const label = isChallenger ? 'Sent' : 'Received';
  const color = isChallenger ? '#FFD60A' : '#00D1FF';
  return (
    <span
      className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0"
      style={{
        color,
        backgroundColor: `${color}18`,
        border: `1px solid ${color}40`,
        lineHeight: '12px',
      }}
    >
      {label}
    </span>
  );
}

export function ChallengeCard({ challenge, currentUid, userProfile, friendsByUid = {}, compact = false, onSeeDetails, onAccept, onDecline, onCancel, onRequestCancel, onRespondCancel, onStartWorkout, onApplyPastActivity }) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmRequestCancel, setConfirmRequestCancel] = useState(false);
  const isChallenger = challenge.challengerUid === currentUid;
  const isGroup = challenge.type === 'group';
  const category = challenge.matchRule?.category;
  const color = CATEGORY_COLOR[category] || '#888';
  const ruleLabel = describeMatchRule(challenge.matchRule);

  // For groups, my personal status drives accept/decline; for 1v1 fall back to legacy fields.
  const myParticipant = challenge.participants?.[currentUid];
  const myStatus = myParticipant?.status || (challenge.friendUid === currentUid ? challenge.friendStatus : null);

  // Pending = "waiting to accept"; the deadline shown is respondByAt (8h from send),
  // not the workout window. Once accepted, expiresAt drives the countdown.
  const isPendingPhase = challenge.status === 'pending';
  const personalExpiresAt = myParticipant?.expiresAt || challenge.expiresAt;
  const countdownTarget = isPendingPhase
    ? (challenge.respondByAt || challenge.expiresAt)
    : (isChallenger ? challenge.expiresAt : personalExpiresAt);
  const remaining = formatRemaining(countdownTarget);
  const remainingMs = countdownTarget ? new Date(countdownTarget).getTime() - Date.now() : 0;
  const isExpired = remaining === 'Expired';
  const isUrgent = !isExpired && remainingMs > 0 && remainingMs < 60 * 60 * 1000; // <1h left

  // Resolve "me" + "opponent" identities for the stacked-avatar icon.
  const meDisplayName = userProfile?.displayName || userProfile?.username || 'You';
  const mePhotoURL = userProfile?.photoURL || null;
  const meInitial = meDisplayName.charAt(0);

  // Opponent for the icon: in 1v1, that's the other party; in group, the challenger
  // (when you're a recipient) or the first non-you participant (when you're the challenger).
  let opponentUid = null;
  if (isChallenger) {
    opponentUid = (challenge.participantUids || []).find(u => u !== currentUid) || challenge.friendUid;
  } else {
    opponentUid = challenge.challengerUid;
  }
  const opponentFriend = opponentUid ? friendsByUid[opponentUid] : null;
  const opponentName = opponentFriend?.displayName
    || opponentFriend?.username
    || (isChallenger ? challenge.friendName : challenge.challengerName)
    || 'Friend';
  const opponentPhotoURL = opponentFriend?.photoURL || null;
  const opponentInitial = opponentName.charAt(0);

  // Group "+N" badge counts the *other* participants (not me, not the named opponent).
  const groupExtraCount = isGroup
    ? Math.max(1, (challenge.participantUids || []).length - 2)
    : 0;

  // Primary text row: friend name (1v1) or group label, with optional title above as flavor.
  let primaryName;
  if (isGroup) {
    primaryName = isChallenger
      ? `Group · ${(challenge.participantUids || []).length - 1} friends`
      : `${challenge.challengerName || 'Friend'} + group`;
  } else {
    primaryName = opponentName;
  }

  // Group progress count (challenger view)
  let groupProgress = null;
  if (isGroup && isChallenger && challenge.participants) {
    const states = Object.values(challenge.participants);
    const completed = states.filter(p => p.status === 'completed').length;
    const total = states.length;
    groupProgress = `${completed} of ${total} complete`;
  }

  // Status label only shows when it carries new info — not for active 1v1 ("In progress"
  // is redundant with the burst-icon + visible countdown). Group sender keeps the
  // "X of Y complete" progress line because that's actually informative.
  let statusLabel = null;
  if (isChallenger) {
    if (challenge.status === 'pending') statusLabel = 'Waiting for response';
    else if (challenge.status === 'active' && isGroup) statusLabel = groupProgress;
    else if (challenge.status === 'completed') statusLabel = groupProgress || 'Completed';
  } else {
    if (myStatus === 'pending') statusLabel = isGroup ? 'Group challenge for you' : 'Wants to challenge you';
    else if (myStatus === 'completed') statusLabel = 'You completed it';
    // accepted (active) recipient: drop "Your challenge" label — the rule line below carries the action.
  }

  // Mutual cancel state (1v1 active only). Open = request awaiting accepter response.
  const cancelRequest = challenge.cancelRequest && !challenge.cancelRequest.response ? challenge.cancelRequest : null;
  const isCancelRequester = cancelRequest && cancelRequest.requestedBy === currentUid;
  const isCancelResponder = cancelRequest && !isCancelRequester && myStatus === 'accepted';

  // In compact mode (Home tab), all action UI is hidden — users get a "See details ›"
  // link that hops them to the Challenges tab where the full action surface lives.
  const showAcceptDecline = !compact && !isChallenger && myStatus === 'pending';
  // "Start workout" CTA: only for accepters on an active challenge. Stamps `intendedChallengeIds`
  // on the resulting activity so the cloud function fulfills this specific challenge (instead of
  // the multi-match deferral path).
  const showStartWorkout = !compact && !isChallenger && myStatus === 'accepted' && challenge.status === 'active' && !cancelRequest;
  const showCancel = !compact && isChallenger && challenge.status === 'pending';
  // Sender can request cancel of an active 1v1 (group cancel unsupported in v1)
  const showRequestCancel = !compact && isChallenger && challenge.status === 'active' && !isGroup && !cancelRequest;
  const showCancelBanner = !compact && cancelRequest;
  // Pending shows accept-window countdown (visible to both sides);
  // active shows workout countdown to challenger always, and accepter once they've accepted.
  const showCountdown = isPendingPhase
    ? (isChallenger || myStatus === 'pending')
    : (isChallenger
        ? (challenge.status !== 'completed')
        : (myStatus === 'accepted'));
  const countdownPrefix = isPendingPhase ? 'to accept · ' : '';

  // Rule line: always shown — it's the action context ("Do any strength workout").
  const ruleLine = ruleLabel;

  // Compact countdown chip: drops "left", short prefix for pending.
  const countdownChipText = remaining
    .replace(' left', '')
    .replace('Expired', 'Expired');
  const countdownChipLabel = isPendingPhase ? `accept · ${countdownChipText}` : countdownChipText;
  const chipColor = isExpired ? '#FF453A' : (isUrgent ? '#FF453A' : 'rgba(255,255,255,0.65)');
  const chipBg = (isExpired || isUrgent) ? 'rgba(255,69,58,0.12)' : 'rgba(255,255,255,0.06)';

  // In compact mode (Home), the whole card is tappable — jumps to the Challenges tab
  // on the active segment with the correct perspective for this card.
  const handleCardTap = compact && onSeeDetails
    ? () => { triggerHaptic(ImpactStyle.Light); onSeeDetails(challenge); }
    : null;

  return (
    <div
      role={handleCardTap ? 'button' : undefined}
      onClick={handleCardTap || undefined}
      className={`relative p-3 rounded-xl ${handleCardTap ? 'active:opacity-70 transition-opacity cursor-pointer' : ''}`}
      style={{
        backgroundColor: 'rgba(255,255,255,0.03)',
        border: `1px solid ${color}25`,
      }}
    >
      {/* Top-right countdown chip — frees a row inside the body. Color flips red <1h. */}
      {showCountdown && (
        <div
          className="absolute px-2 py-0.5 rounded-md"
          style={{
            top: 8,
            right: 8,
            backgroundColor: chipBg,
            color: chipColor,
            fontSize: 11,
            fontWeight: 500,
            lineHeight: '14px',
          }}
        >
          {countdownChipLabel}
        </div>
      )}

      <div className="flex items-center gap-3" style={{ paddingRight: showCountdown ? 70 : 0 }}>
        {/* Avatar stack + perspective caption — left column treats "who and from whose side"
            as a single unit, freeing the name row from competing with a Sent/Received chip. */}
        <div className="flex flex-col items-center gap-1 flex-shrink-0">
          <ChallengeIcon
            category={category}
            color={color}
            mePhotoURL={mePhotoURL}
            meInitial={meInitial}
            opponentPhotoURL={opponentPhotoURL}
            opponentInitial={opponentInitial}
            isGroup={isGroup}
            groupCount={groupExtraCount}
          />
          <PerspectivePill isChallenger={isChallenger} />
        </div>
        <div className="flex-1 min-w-0">
          {/* Optional flavor title sits above the friend name as small italic text.
              Friend name is always the primary identifier — that's the unique "who am I betting against." */}
          {challenge.title && (
            <p className="text-[11px] italic truncate" style={{ color: 'rgba(255,255,255,0.55)' }}>
              {challenge.title}
            </p>
          )}
          <p className="text-white text-sm font-semibold truncate">{primaryName}</p>
          {statusLabel && (
            <p className="text-gray-500 text-xs">{statusLabel}</p>
          )}
          <p className="text-white text-sm">{ruleLine}</p>
          {/* Bottom meta row: photo-required tag (left) + cancel link (right). Shares one
              row to save vertical space. Negative margin-right escapes the inner row's
              chip-clearance padding so the cancel link sits flush with the card's edge. */}
          {(challenge.requirePhoto || ((showCancel && !confirmCancel) || (showRequestCancel && !confirmRequestCancel))) && (
            <div
              className="flex items-center justify-between gap-2 mt-0.5"
              style={{ marginRight: showCountdown ? -70 : 0 }}
            >
              {challenge.requirePhoto ? (
                <p className="text-[11px]" style={{ color: '#FFD60A' }}>
                  📸 Photo required
                </p>
              ) : <span />}
              {showCancel && !confirmCancel && (
                <button
                  onClick={(e) => { e.stopPropagation(); triggerHaptic(ImpactStyle.Light); setConfirmCancel(true); }}
                  className="text-[11px] font-medium px-1"
                  style={{ color: '#FF453A' }}
                >
                  Cancel
                </button>
              )}
              {showRequestCancel && !confirmRequestCancel && (
                <button
                  onClick={(e) => { e.stopPropagation(); triggerHaptic(ImpactStyle.Light); setConfirmRequestCancel(true); }}
                  className="text-[11px] font-medium px-1"
                  style={{ color: '#FF453A' }}
                >
                  Cancel
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Mutual-cancel banner: shown when there's an open request, instead of the
          regular request-cancel button. Both sides see context; only the responder
          gets Accept/Decline buttons. Hidden in compact mode (Home) — Challenges tab
          handles all action UI. */}
      {showCancelBanner && (
        <div
          className="mt-3 p-2.5 rounded-lg"
          style={{ backgroundColor: 'rgba(255,214,10,0.08)', border: '1px solid rgba(255,214,10,0.25)' }}
        >
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.85)' }}>
            {isCancelRequester
              ? 'You asked to cancel. Waiting for them to respond.'
              : `${challenge.challengerName || 'Your friend'} wants to cancel this challenge.`}
          </p>
          {isCancelResponder && (
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => onRespondCancel?.(challenge, false)}
                className="flex-1 py-1.5 rounded-md text-xs font-medium bg-zinc-800 text-gray-300"
              >
                Keep going
              </button>
              <button
                onClick={() => onRespondCancel?.(challenge, true)}
                className="flex-1 py-1.5 rounded-md text-xs font-semibold"
                style={{ backgroundColor: '#FFD60A', color: 'black' }}
              >
                Cancel it
              </button>
            </div>
          )}
        </div>
      )}

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

      {showStartWorkout && (
        <div className="flex gap-2 mt-3">
          <button
            onClick={(e) => { e.stopPropagation(); triggerHaptic(ImpactStyle.Light); onApplyPastActivity?.(challenge); }}
            className="flex-1 py-1.5 rounded-lg text-xs font-medium"
            style={{
              backgroundColor: 'transparent',
              color: 'rgba(255,255,255,0.85)',
              border: `1px solid ${color}55`,
            }}
          >
            Use completed activity
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); triggerHaptic(ImpactStyle.Medium); onStartWorkout?.(challenge); }}
            className="flex-1 py-1.5 rounded-lg text-xs font-semibold"
            style={{ backgroundColor: color, color: 'black' }}
          >
            Start activity
          </button>
        </div>
      )}

      {/* Cancel confirm rows — only render when user has tapped the inline cancel link.
          Idle state lives inline in the photo-required row above. */}
      {showCancel && confirmCancel && (
        <div className="mt-2 flex justify-end">
          <div className="flex items-center gap-3 text-xs">
            <span className="text-gray-500">Cancel this challenge?</span>
            <button
              onClick={(e) => { e.stopPropagation(); triggerHaptic(ImpactStyle.Light); setConfirmCancel(false); }}
              className="font-medium text-gray-300"
            >
              Keep
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); triggerHaptic(ImpactStyle.Medium); onCancel?.(challenge); }}
              className="font-semibold"
              style={{ color: '#FF453A' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showRequestCancel && confirmRequestCancel && (
        <div className="mt-2 flex justify-end">
          <div className="flex items-center gap-3 text-xs">
            <span className="text-gray-500 truncate">Ask {opponentName.split(' ')[0]}?</span>
            <button
              onClick={(e) => { e.stopPropagation(); triggerHaptic(ImpactStyle.Light); setConfirmRequestCancel(false); }}
              className="font-medium text-gray-300"
            >
              Nevermind
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); triggerHaptic(ImpactStyle.Medium); setConfirmRequestCancel(false); onRequestCancel?.(challenge); }}
              className="font-semibold"
              style={{ color: '#FF453A' }}
            >
              Send
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

// =====================================================================
// Section: rendered on the Home tab. Self-loads challenges + handles actions.
// =====================================================================

export function ChallengesSection({ user, userProfile, friends = [], onChallengeCountsChange, onSeeDetails, optimisticCompletions = new Map() }) {
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

  // Apply optimistic completion overlay before bucketing — flips Active → Completed instantly
  // when the user logs a fulfilling activity, without waiting on the cloud function trigger.
  const overlaidChallenges = React.useMemo(
    () => applyOptimisticChallengeCompletions(challenges, optimisticCompletions, user?.uid),
    [challenges, optimisticCompletions, user?.uid]
  );

  const enriched = React.useMemo(() => overlaidChallenges.map(c => ({
    ...c,
    friendName: friendsByUid[c.friendUid]?.displayName || friendsByUid[c.friendUid]?.username || c.friendName || '',
  })), [overlaidChallenges, friendsByUid]);

  const buckets = React.useMemo(() => bucketChallenges(enriched, user?.uid), [enriched, user?.uid]);

  // Notify parent of pending-received count for badging the home tab
  useEffect(() => {
    onChallengeCountsChange?.({
      pendingReceivedCount: buckets.pendingReceived.length,
      activeOutgoingCount: countActiveOutgoing(enriched, user?.uid),
    });
  }, [buckets.pendingReceived.length, enriched, user?.uid, onChallengeCountsChange]);

  // Home only surfaces active challenges — pending/completed live on the Challenges tab.
  // All actions (accept/decline/cancel/request-cancel) live there too; Home cards are
  // read-only summaries with a "See details ›" link.
  if (!isLoading && buckets.active.length === 0) return null;

  return (
    <div className="px-4 mb-4">
      <div className="mb-3">
        <div className="flex items-center gap-2">
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#04d1ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
          <span className="text-[20px] font-semibold text-white" style={{ letterSpacing: '-0.3px' }}>Active Challenges</span>
        </div>
        <div className="flex items-center justify-between gap-3 -mt-1 pl-[30px]">
          <p className="text-[13px]" style={{ color: '#777' }}>Bets in progress with your friends</p>
          {!isLoading && buckets.active.length > 0 && (
            <button
              onClick={() => onSeeDetails?.()}
              className="text-xs font-medium flex-shrink-0"
              style={{ color: 'rgba(255,255,255,0.55)' }}
            >
              See all ›
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="py-6 flex justify-center">
          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          {buckets.active.map(c => (
            <ChallengeCard
              key={c.id}
              challenge={c}
              currentUid={user.uid}
              userProfile={userProfile}
              friendsByUid={friendsByUid}
              compact
              onSeeDetails={onSeeDetails}
            />
          ))}
        </div>
      )}
    </div>
  );
}
