import React, { useState, useEffect, useMemo } from 'react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import {
  subscribeToChallenges,
  bucketChallenges,
  acceptChallenge,
  declineChallenge,
  cancelChallenge,
  countActiveOutgoing,
} from './services/challengeService';
import { ChallengeCard } from './Challenges';

const triggerHaptic = async (style = ImpactStyle.Light) => {
  try { await Haptics.impact({ style }); } catch {
    if (navigator.vibrate) navigator.vibrate(10);
  }
};

// Re-render every minute so ChallengeCard countdowns stay fresh
function useTicker(intervalMs = 60000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

const SEGMENTS = [
  { key: 'active', label: 'Active' },
  { key: 'pending', label: 'Pending' },
  { key: 'completed', label: 'Completed' },
];

export default function ChallengesTab({ user, userProfile, friends = [], onChallengeCountsChange }) {
  const [challenges, setChallenges] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [segment, setSegment] = useState('active');
  useTicker(60000);

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = subscribeToChallenges(user.uid, (list) => {
      setChallenges(list);
      setIsLoading(false);
    });
    return () => { try { unsub?.(); } catch {} };
  }, [user?.uid]);

  const friendsByUid = useMemo(() => {
    const map = {};
    for (const f of friends) map[f.uid] = f;
    return map;
  }, [friends]);

  const enriched = useMemo(() => challenges.map(c => ({
    ...c,
    friendName: friendsByUid[c.friendUid]?.displayName || friendsByUid[c.friendUid]?.username || c.friendName || '',
  })), [challenges, friendsByUid]);

  const buckets = useMemo(() => bucketChallenges(enriched, user?.uid), [enriched, user?.uid]);

  // Mirror the home section's badge/cap accounting so counts stay in sync when the user
  // lands here first without mounting HomeTab.
  useEffect(() => {
    onChallengeCountsChange?.({
      pendingReceivedCount: buckets.pendingReceived.length,
      activeOutgoingCount: countActiveOutgoing(enriched, user?.uid),
    });
  }, [buckets.pendingReceived.length, enriched, user?.uid, onChallengeCountsChange]);

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

  const pendingCount = buckets.pendingReceived.length + buckets.pendingSent.length;
  const activeCount = buckets.active.length;
  const completedCount = buckets.completed.length;

  const initial = (userProfile?.displayName?.[0] || userProfile?.username?.[0] || '?').toUpperCase();

  const onSegment = (key) => {
    triggerHaptic(ImpactStyle.Light);
    setSegment(key);
  };

  return (
    <div className="px-4 pb-32">
      {/* Header */}
      <div className="pt-2 pb-4">
        <h1 className="text-xl font-bold text-white">Challenges</h1>
        <p className="text-sm text-gray-500">Head-to-head bets with your friends.</p>
      </div>

      {/* Profile card */}
      <div
        className="rounded-2xl p-4 mb-4 flex items-center gap-4"
        style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div
          className="w-16 h-16 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
        >
          {userProfile?.photoURL ? (
            <img src={userProfile.photoURL} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-white text-xl font-semibold">{initial}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-base font-semibold truncate">
            {userProfile?.displayName || userProfile?.username || 'You'}
          </p>
          <div className="flex items-center gap-3 mt-1">
            <RecordPill label="Active" value={activeCount} color="#FFD60A" />
            <RecordPill label="Completed" value={completedCount} color="#00FF94" />
            <RecordPill label="Pending" value={pendingCount} color="rgba(255,255,255,0.6)" />
          </div>
        </div>
      </div>

      {/* Segmented control */}
      <div
        className="flex items-center p-1 rounded-xl mb-4"
        style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
      >
        {SEGMENTS.map(s => {
          const selected = segment === s.key;
          const badgeCount =
            s.key === 'active' ? activeCount :
            s.key === 'pending' ? pendingCount :
            completedCount;
          return (
            <button
              key={s.key}
              onClick={() => onSegment(s.key)}
              className="flex-1 py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-1.5"
              style={{
                backgroundColor: selected ? 'rgba(255,255,255,0.08)' : 'transparent',
                color: selected ? 'white' : 'rgba(255,255,255,0.5)',
              }}
            >
              <span>{s.label}</span>
              {badgeCount > 0 && (
                <span
                  className="text-[10px] px-1.5 rounded-full font-semibold"
                  style={{
                    backgroundColor: selected ? '#FFD60A' : 'rgba(255,255,255,0.1)',
                    color: selected ? 'black' : 'rgba(255,255,255,0.6)',
                    minWidth: 18,
                    lineHeight: '16px',
                  }}
                >
                  {badgeCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="py-10 flex justify-center">
          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
        </div>
      ) : segment === 'active' ? (
        buckets.active.length === 0 ? (
          <EmptyState
            title="No active challenges"
            subtitle="Challenge a friend from the friends feed or after logging an activity."
          />
        ) : (
          <div className="space-y-2">
            {buckets.active.map(c => (
              <ChallengeCard key={c.id} challenge={c} currentUid={user.uid} />
            ))}
          </div>
        )
      ) : segment === 'pending' ? (
        pendingCount === 0 ? (
          <EmptyState
            title="No pending challenges"
            subtitle="Invites you send or receive show up here."
          />
        ) : (
          <>
            {buckets.pendingReceived.length > 0 && (
              <div className="mb-4">
                <p className="text-xs uppercase tracking-wider mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>Received</p>
                <div className="space-y-2">
                  {buckets.pendingReceived.map(c => (
                    <ChallengeCard
                      key={c.id}
                      challenge={c}
                      currentUid={user.uid}
                      onAccept={handleAccept}
                      onDecline={handleDecline}
                    />
                  ))}
                </div>
              </div>
            )}
            {buckets.pendingSent.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wider mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>Sent</p>
                <div className="space-y-2">
                  {buckets.pendingSent.map(c => (
                    <ChallengeCard
                      key={c.id}
                      challenge={c}
                      currentUid={user.uid}
                      onCancel={handleCancel}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )
      ) : (
        buckets.completed.length === 0 ? (
          <EmptyState
            title="No completed challenges yet"
            subtitle="Finished challenges will land here."
          />
        ) : (
          <div className="space-y-2">
            {buckets.completed.map(c => (
              <ChallengeCard key={c.id} challenge={c} currentUid={user.uid} />
            ))}
          </div>
        )
      )}
    </div>
  );
}

function RecordPill({ label, value, color }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-sm font-bold" style={{ color }}>{value}</span>
      <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.5)' }}>{label}</span>
    </div>
  );
}

function EmptyState({ title, subtitle }) {
  return (
    <div className="py-12 text-center">
      <p className="text-white text-sm font-medium">{title}</p>
      <p className="text-xs mt-1 px-8" style={{ color: 'rgba(255,255,255,0.5)' }}>{subtitle}</p>
    </div>
  );
}
