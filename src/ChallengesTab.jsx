import React, { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import {
  subscribeToChallenges,
  bucketChallenges,
  acceptChallenge,
  declineChallenge,
  cancelChallenge,
  requestCancelChallenge,
  respondToCancelRequest,
  countOutgoingThisMonth,
  applyOptimisticChallengeCompletions,
  getChallengeOutcome,
} from './services/challengeService';
import { ChallengeCard } from './Challenges';
import OwnProfileModal from './components/OwnProfileModal';
import FriendProfileCard from './components/FriendProfileCard';
import { isDemoAccount, getDemoChallenges } from './demoData';

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

export default function ChallengesTab({ user, userProfile, userData, activities = [], friends = [], isPro = false, onChallengeCountsChange, navTarget = null, onStartChallengeWorkout, onApplyPastActivityToChallenge, optimisticCompletions = new Map() }) {
  const [challenges, setChallenges] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [segment, setSegment] = useState('active');
  // Shared across all three main segments — perspective (received/sent) is "sticky"
  // so switching from Pending→Active keeps you on the same side you were looking at.
  const [subSegment, setSubSegment] = useState('received');
  // Outcome filter on the Completed segment — 'all' | 'won' | 'lost'.
  // Lets users isolate just their wins or losses on either Sent or Received.
  const [resultFilter, setResultFilter] = useState('all');
  const [selectedFriend, setSelectedFriend] = useState(null);
  // Notification-tap navigation: when navTarget changes (parent bumps `nonce` per tap),
  // jump to the segment/sub-segment the notification is about.
  useEffect(() => {
    if (!navTarget) return;
    if (navTarget.segment) setSegment(navTarget.segment);
    if (navTarget.subSegment) setSubSegment(navTarget.subSegment);
  }, [navTarget]);

  // Measure the sticky header so the cards container can size itself to JUST barely
  // overflow the viewport — that's the minimum needed for iOS rubber-band to engage
  // without adding ugly empty space below the cards. Header height changes with segment
  // (Completed shows ResultFilter; non-loading shows SubToggle), so re-measure on every
  // size change via ResizeObserver.
  const headerRef = useRef(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useLayoutEffect(() => {
    if (!headerRef.current) return;
    const measure = () => setHeaderHeight(headerRef.current.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(headerRef.current);
    return () => ro.disconnect();
  }, []);
  const [showSelfProfile, setShowSelfProfile] = useState(false);
  const [introDismissed, setIntroDismissed] = useState(() => {
    try { return localStorage.getItem('dismissedChallengesIntro') === '1'; } catch { return false; }
  });
  const dismissIntro = () => {
    try { localStorage.setItem('dismissedChallengesIntro', '1'); } catch {}
    setIntroDismissed(true);
  };
  useTicker(60000);

  useEffect(() => {
    if (!user?.uid) return;
    // Demo mode: skip Firestore, use mock challenges so screen recordings show a populated tab.
    if (isDemoAccount(userProfile, user)) {
      const name = userProfile?.displayName || userProfile?.username || 'You';
      setChallenges(getDemoChallenges(user.uid, name));
      setIsLoading(false);
      return;
    }
    const unsub = subscribeToChallenges(user.uid, (list) => {
      setChallenges(list);
      setIsLoading(false);
    });
    return () => { try { unsub?.(); } catch {} };
  }, [user?.uid, userProfile?.username, user?.email]);

  const friendsByUid = useMemo(() => {
    const map = {};
    for (const f of friends) map[f.uid] = f;
    return map;
  }, [friends]);

  // Optimistic overlay: flips Active → Completed instantly when an activity fulfills a challenge.
  // The cloud function trigger writes the same fields a beat later; once the listener delivers
  // the real status, the overlay no-ops.
  const overlaidChallenges = useMemo(
    () => applyOptimisticChallengeCompletions(challenges, optimisticCompletions, user?.uid),
    [challenges, optimisticCompletions, user?.uid]
  );

  const enriched = useMemo(() => overlaidChallenges.map(c => ({
    ...c,
    friendName: friendsByUid[c.friendUid]?.displayName || friendsByUid[c.friendUid]?.username || c.friendName || '',
  })), [overlaidChallenges, friendsByUid]);

  const buckets = useMemo(() => bucketChallenges(enriched, user?.uid), [enriched, user?.uid]);

  // Split the flat active/completed buckets into received (I'm an accepter) vs sent (I'm the challenger).
  const splits = useMemo(() => {
    const activeReceived = buckets.active.filter(c => c.challengerUid !== user?.uid);
    const activeSent = buckets.active.filter(c => c.challengerUid === user?.uid);
    const completedReceived = buckets.completed.filter(c => c.challengerUid !== user?.uid);
    const completedSent = buckets.completed.filter(c => c.challengerUid === user?.uid);
    return { activeReceived, activeSent, completedReceived, completedSent };
  }, [buckets.active, buckets.completed, user?.uid]);

  // Won/lost counts within the current sub-segment (Received vs Sent), used to badge the filter chips.
  const completedListForSub = subSegment === 'received' ? splits.completedReceived : splits.completedSent;
  const completedCounts = useMemo(() => {
    let won = 0, lost = 0;
    for (const c of completedListForSub) {
      const o = getChallengeOutcome(c, user?.uid);
      if (o === 'won') won += 1;
      else if (o === 'lost') lost += 1;
    }
    return { all: completedListForSub.length, won, lost };
  }, [completedListForSub, user?.uid]);

  // Mirror the home section's badge/cap accounting so counts stay in sync when the user
  // lands here first without mounting HomeTab.
  useEffect(() => {
    onChallengeCountsChange?.({
      pendingReceivedCount: buckets.pendingReceived.length,
      outgoingThisMonthCount: countOutgoingThisMonth(enriched, user?.uid),
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
  const handleRequestCancel = async (c) => {
    triggerHaptic(ImpactStyle.Light);
    await requestCancelChallenge(c.id, user.uid);
  };
  const handleRespondCancel = async (c, accept) => {
    triggerHaptic(accept ? ImpactStyle.Medium : ImpactStyle.Light);
    await respondToCancelRequest(c.id, user.uid, accept);
  };

  const pendingCount = buckets.pendingReceived.length + buckets.pendingSent.length;
  const activeCount = buckets.active.length;
  const completedCount = buckets.completed.length;

  const initial = (userProfile?.displayName?.[0] || userProfile?.username?.[0] || '?').toUpperCase();

  const onSegment = (key) => {
    triggerHaptic(ImpactStyle.Light);
    setSegment(key);
  };

  // Pick the list + empty copy for the current (segment, subSegment) combo.
  // Lifted out of the JSX IIFE so the SubToggle / ResultFilter can render inside the
  // sticky-top header (they need view counts) while the list itself stays below.
  const views = {
    'active|received': {
      list: splits.activeReceived,
      emptyTitle: "Nothing for you to finish",
      emptySubtitle: "Challenges you've accepted and still need to complete will show up here.",
      onRespondCancel: handleRespondCancel,
      onStartWorkout: onStartChallengeWorkout,
      onApplyPastActivity: onApplyPastActivityToChallenge,
    },
    'active|sent': {
      list: splits.activeSent,
      emptyTitle: "Nothing waiting on friends",
      emptySubtitle: "Challenges you've sent that friends accepted will show up here until they finish.",
      onRequestCancel: handleRequestCancel,
      onRespondCancel: handleRespondCancel,
    },
    'pending|received': {
      list: buckets.pendingReceived,
      emptyTitle: "No received invites",
      emptySubtitle: "Challenge requests from friends will show up here.",
      onAccept: handleAccept,
      onDecline: handleDecline,
    },
    'pending|sent': {
      list: buckets.pendingSent,
      emptyTitle: "No sent invites",
      emptySubtitle: "Challenges you've sent waiting for a friend to accept will show up here.",
      onCancel: handleCancel,
    },
    'completed|received': {
      list: filterByResult(splits.completedReceived, resultFilter, user?.uid),
      emptyTitle: emptyTitleForResult(resultFilter, "No completed challenges yet"),
      emptySubtitle: emptySubtitleForResult(resultFilter, "Challenges you've accepted and finished will land here."),
    },
    'completed|sent': {
      list: filterByResult(splits.completedSent, resultFilter, user?.uid),
      emptyTitle: emptyTitleForResult(resultFilter, "No completed challenges yet"),
      emptySubtitle: emptySubtitleForResult(resultFilter, "Challenges you sent that friends finished will land here."),
    },
  };
  const subCounts = {
    active: { received: splits.activeReceived.length, sent: splits.activeSent.length },
    pending: { received: buckets.pendingReceived.length, sent: buckets.pendingSent.length },
    completed: { received: splits.completedReceived.length, sent: splits.completedSent.length },
  }[segment];
  const view = views[`${segment}|${subSegment}`];

  return (
    // Fragment-style render: content lives in the App's outer body scroll so iOS
    // rubber-band engages on overpull (WKWebView doesn't bounce inner scrollers).
    // Sticky header keeps the frosted-glass-over-cards effect during regular scroll.
    <>
      {/* Header — vertical gradient that's solid black at the top (matches the App's
          status-bar/spacer area above for a seamless join, no hard boundary line) and
          transitions into a frosted-glass tint around the profile card. backdrop-blur is
          applied uniformly to the whole element, but the opaque top half hides it; only
          the lower half reveals the blurred backdrop. mask-image fades just the bottom
          18px so cards dissolve into the header instead of meeting at a hard line. */}
      <div
        ref={headerRef}
        className="sticky top-0 z-10 px-4 pb-2"
        style={{
          background: 'linear-gradient(to bottom, rgba(10, 10, 10, 1) 0%, rgba(10, 10, 10, 1) 15%, rgba(10, 10, 10, 0.65) 90%, rgba(10, 10, 10, 0.65) 100%)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          maskImage: 'linear-gradient(to bottom, black calc(100% - 18px), transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black calc(100% - 18px), transparent 100%)',
        }}
      >
      {/* Header */}
      <div className="pt-2 pb-4">
        <h1 className="text-xl font-bold text-white">Challenges</h1>
        <p className="text-sm text-gray-500">Head-to-head bets with your friends.</p>
      </div>

      {/* First-time intro — explains how challenges work. Dismissible; persisted in localStorage. */}
      {!introDismissed && (
        <div
          className="relative mb-4 p-3 pr-10 rounded-xl"
          style={{ backgroundColor: 'rgba(4,209,255,0.06)', border: '1px solid rgba(4,209,255,0.2)' }}
        >
          <div className="flex items-start gap-2">
            <span className="text-base flex-shrink-0">⚡</span>
            <div>
              <p className="text-[13px] font-semibold text-white mb-1">How challenges work</p>
              <p className="text-[11px] leading-snug" style={{ color: 'rgba(255,255,255,0.65)' }}>
                After logging an activity, challenge a friend to match it. They have 8 hours to accept — once they do, the 24–72 hour timer starts. Everyone who finishes the same kind of workout in time wins.
              </p>
            </div>
          </div>
          <button
            onClick={dismissIntro}
            aria-label="Dismiss"
            className="absolute top-1 right-1 w-8 h-8 flex items-center justify-center"
            style={{ color: 'rgba(255,255,255,0.4)' }}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}

      {/* Profile card */}
      <div
        className="rounded-2xl p-4 mb-4 flex items-center gap-4"
        style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        <button
          onClick={() => { triggerHaptic(ImpactStyle.Light); setShowSelfProfile(true); }}
          aria-label="Open your profile"
          className="w-16 h-16 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0 active:scale-95 transition-transform"
          style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
        >
          {userProfile?.photoURL ? (
            <img src={userProfile.photoURL} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-white text-xl font-semibold">{initial}</span>
          )}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-white text-base font-semibold truncate">
              {userProfile?.displayName || userProfile?.username || 'You'}
            </p>
            {(userData?.streaks?.master || 0) > 0 && (
              <span className="text-sm flex-shrink-0" style={{ color: '#FFD60A' }}>
                {userData.streaks.master}🔥
              </span>
            )}
          </div>
          <p className="text-xs truncate" style={{ color: 'rgba(255,255,255,0.5)' }}>
            {userProfile?.username && <>@{userProfile.username} · </>}
            <span style={{ color: isPro ? '#FFD60A' : 'rgba(255,255,255,0.5)', fontWeight: isPro ? 600 : 400 }}>
              {isPro ? 'Pro' : 'Free'}
            </span>
          </p>
          <div className="flex items-center gap-3 mt-1">
            <RecordPill label="Active" value={activeCount} color="#FFD60A" />
            <RecordPill label="Completed" value={completedCount} color="#00FF94" />
            {/* W-L instead of Pending — Pending is already shown in the segment toggle
                below, and W-L is a more useful trophy-style stat for this row. Live-
                subscribed via subscribeToUserChallengeStats so it ticks up immediately. */}
            <div className="flex items-baseline gap-1">
              <span className="text-sm font-bold leading-none">
                <span style={{ color: '#00FF94' }}>{userProfile?.challengeStats?.wins || 0}</span>
                <span className="mx-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>-</span>
                <span style={{ color: '#FF453A' }}>{userProfile?.challengeStats?.losses || 0}</span>
              </span>
              <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.5)' }}>W-L</span>
            </div>
          </div>
        </div>
      </div>

      {/* Segmented control */}
      <div
        className="relative flex items-center p-1 rounded-xl mb-3"
        style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
      >
        <div
          className="absolute top-1 bottom-1 rounded-lg transition-all duration-300 ease-out"
          style={{
            backgroundColor: 'rgba(255,255,255,0.08)',
            width: 'calc((100% - 8px) / 3)',
            left: segment === 'active'
              ? '4px'
              : segment === 'pending'
                ? 'calc(4px + (100% - 8px) / 3)'
                : 'calc(4px + 2 * (100% - 8px) / 3)',
          }}
        />
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
              className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors duration-200 flex items-center justify-center gap-1.5 relative z-10"
              style={{
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

      {/* Sub-toggles live in the sticky header too — perspective + outcome filter follow
          you as you scroll through cards. */}
      {!isLoading && (
        <SubToggle
          value={subSegment}
          onChange={(k) => { triggerHaptic(ImpactStyle.Light); setSubSegment(k); }}
          receivedCount={subCounts.received}
          sentCount={subCounts.sent}
        />
      )}
      {!isLoading && segment === 'completed' && (
        <ResultFilter
          value={resultFilter}
          onChange={(k) => { triggerHaptic(ImpactStyle.Light); setResultFilter(k); }}
          allCount={completedCounts.all}
          wonCount={completedCounts.won}
          lostCount={completedCounts.lost}
        />
      )}
      </div>
      {/* /header overlay */}

      {/* Card list — sits in normal flow underneath the sticky header. minHeight is
          calibrated to be JUST tall enough that the body scroll overflows by ~1px so
          iOS rubber-band engages on overpull, without adding visible empty space below
          the cards. Math: visible scroll area = 100dvh - safe-area-top - 16px (the App
          spacer above the tab content). Subtract the measured header height so the
          cards container fills exactly the rest of the visible area, +1px overflow. */}
      <div
        className="px-4 pb-32"
        style={{
          minHeight: `calc(100dvh - env(safe-area-inset-top, 0px) - 16px - ${headerHeight}px + 1px)`,
        }}
      >
        {isLoading ? (
          <div className="py-10 flex justify-center">
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          </div>
        ) : view.list.length === 0 ? (
          <EmptyState title={view.emptyTitle} subtitle={view.emptySubtitle} />
        ) : (
          <div className="space-y-2 pt-1">
            {view.list.map(c => (
              <ChallengeCard
                key={c.id}
                challenge={c}
                currentUid={user.uid}
                userProfile={userProfile}
                friendsByUid={friendsByUid}
                onAccept={view.onAccept}
                onDecline={view.onDecline}
                onCancel={view.onCancel}
                onRequestCancel={view.onRequestCancel}
                onRespondCancel={view.onRespondCancel}
                onStartWorkout={view.onStartWorkout}
                onApplyPastActivity={view.onApplyPastActivity}
                onOpenProfile={(uid) => {
                  const f = friendsByUid[uid];
                  if (f) setSelectedFriend(f);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {showSelfProfile && (
        <OwnProfileModal
          user={user}
          userProfile={userProfile}
          userData={userData}
          activities={activities}
          onClose={() => setShowSelfProfile(false)}
        />
      )}

      {selectedFriend && (
        <FriendProfileCard
          friend={selectedFriend}
          onClose={() => setSelectedFriend(null)}
        />
      )}
    </>
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

// Apply the Won/Lost result filter to a list of completed challenges.
function filterByResult(list, filter, uid) {
  if (filter === 'all') return list;
  return list.filter(c => getChallengeOutcome(c, uid) === filter);
}

function emptyTitleForResult(filter, fallback) {
  if (filter === 'won') return 'No wins here yet';
  if (filter === 'lost') return 'No losses here';
  return fallback;
}

function emptySubtitleForResult(filter, fallback) {
  if (filter === 'won') return 'Finished challenges that scored as wins will land here.';
  if (filter === 'lost') return 'Challenges that timed out before finishing will land here.';
  return fallback;
}

// Outcome filter — All / Won / Lost — rendered on the Completed segment to make it
// easy to scan just one side of the record. Styled like SubToggle but tinted by outcome.
function ResultFilter({ value, onChange, allCount, wonCount, lostCount }) {
  const items = [
    { key: 'all', label: 'All', count: allCount, accent: '#FFFFFF' },
    { key: 'won', label: 'Won', count: wonCount, accent: '#00FF94' },
    { key: 'lost', label: 'Lost', count: lostCount, accent: '#FF453A' },
  ];
  // Animated pill width: divide track into 3 equal slots
  const pillLeft = value === 'all'
    ? '4px'
    : value === 'won'
      ? 'calc(4px + (100% - 8px) / 3)'
      : 'calc(4px + 2 * (100% - 8px) / 3)';
  return (
    <div
      className="relative flex items-center p-1 rounded-lg mb-3 max-w-[300px] mx-auto"
      style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}
    >
      <div
        className="absolute top-1 bottom-1 rounded-md transition-all duration-300 ease-out"
        style={{
          backgroundColor: 'rgba(255,255,255,0.08)',
          width: 'calc((100% - 8px) / 3)',
          left: pillLeft,
        }}
      />
      {items.map(s => {
        const selected = value === s.key;
        return (
          <button
            key={s.key}
            onClick={() => onChange(s.key)}
            className="flex-1 py-1 rounded-md text-[11px] font-medium transition-colors duration-200 flex items-center justify-center gap-1.5 relative z-10"
            style={{ color: selected ? s.accent : 'rgba(255,255,255,0.5)' }}
          >
            <span>{s.label}</span>
            {s.count > 0 && (
              <span
                className="text-[9px] px-1.5 rounded-full font-semibold"
                style={{
                  backgroundColor: selected ? s.accent : 'rgba(255,255,255,0.1)',
                  color: selected ? 'black' : 'rgba(255,255,255,0.6)',
                  minWidth: 16,
                  lineHeight: '14px',
                }}
              >
                {s.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function SubToggle({ value, onChange, receivedCount, sentCount }) {
  const items = [
    { key: 'received', label: 'Received', count: receivedCount },
    { key: 'sent', label: 'Sent', count: sentCount },
  ];
  return (
    <div
      className="relative flex items-center p-1 rounded-lg mb-3 max-w-[240px] mx-auto"
      style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}
    >
      <div
        className="absolute top-1 bottom-1 rounded-md transition-all duration-300 ease-out"
        style={{
          backgroundColor: 'rgba(255,255,255,0.08)',
          width: 'calc((100% - 8px) / 2)',
          left: value === 'received' ? '4px' : 'calc(4px + (100% - 8px) / 2)',
        }}
      />
      {items.map(s => {
        const selected = value === s.key;
        return (
          <button
            key={s.key}
            onClick={() => onChange(s.key)}
            className="flex-1 py-1 rounded-md text-[11px] font-medium transition-colors duration-200 flex items-center justify-center gap-1.5 relative z-10"
            style={{ color: selected ? 'white' : 'rgba(255,255,255,0.5)' }}
          >
            <span>{s.label}</span>
            {s.count > 0 && (
              <span
                className="text-[9px] px-1.5 rounded-full font-semibold"
                style={{
                  backgroundColor: selected ? '#FFD60A' : 'rgba(255,255,255,0.1)',
                  color: selected ? 'black' : 'rgba(255,255,255,0.6)',
                  minWidth: 16,
                  lineHeight: '14px',
                }}
              >
                {s.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
