import AvatarImage from './components/AvatarImage';
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
import ChallengeDetailModal from './components/ChallengeDetailModal';
import { isDemoAccount, getDemoChallenges } from './demoData';
import { resolveUnit } from './utils/distance';
import { CARD_SURFACE, GOLD, NUM } from './utils/designTokens';

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

export default function ChallengesTab({ user, userProfile, userData, activities = [], friends = [], isPro = false, onChallengeCountsChange, navTarget = null, onStartChallengeWorkout, onApplyPastActivityToChallenge, optimisticCompletions = new Map(), embedded = false, sharedChallenges }) {
  const [challenges, setChallenges] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [segment, setSegment] = useState('active');
  // Outcome filter on the Completed segment — 'all' | 'won' | 'lost'.
  // Lets users isolate just their wins or losses on either Sent or Received.
  const [resultFilter, setResultFilter] = useState('all');
  const [selectedFriend, setSelectedFriend] = useState(null);
  // Card tap opens the detail modal; opponent panel inside the modal can then
  // open the FriendProfileCard via the existing setSelectedFriend hook.
  const [detailChallenge, setDetailChallenge] = useState(null);
  // Notification-tap navigation: when navTarget changes (parent bumps `nonce` per tap),
  // jump to the segment/sub-segment the notification is about.
  useEffect(() => {
    if (!navTarget) return;
    if (navTarget.segment) setSegment(navTarget.segment);
  }, [navTarget]);

  // Measure the sticky header so the cards container can size itself to JUST barely
  // overflow the viewport — that's the minimum needed for iOS rubber-band to engage
  // without adding ugly empty space below the cards. Header height changes with segment
  // (Completed shows ResultFilter), so re-measure on every
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
    // App keeps an always-on listener and passes its list in (null while it loads), so we
    // don't open a second one. Only subscribe ourselves when used without it.
    if (sharedChallenges !== undefined) {
      if (sharedChallenges) { setChallenges(sharedChallenges); setIsLoading(false); }
      return;
    }
    const unsub = subscribeToChallenges(user.uid, (list) => {
      setChallenges(list);
      setIsLoading(false);
    });
    return () => { try { unsub?.(); } catch {} };
  }, [user?.uid, userProfile?.username, user?.email, sharedChallenges]);

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

  // Won/lost counts across completed challenges, used to badge the filter chips.
  const completedCounts = useMemo(() => {
    let won = 0, lost = 0;
    for (const c of buckets.completed) {
      const o = getChallengeOutcome(c, user?.uid);
      if (o === 'won') won += 1;
      else if (o === 'lost') lost += 1;
    }
    return { all: buckets.completed.length, won, lost };
  }, [buckets.completed, user?.uid]);

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

  // One list per status (Active / Pending / Completed), both sides mixed. Each card gets the
  // actions for its own side, and its "Your move" / "Their move" pill says whose turn it is —
  // this replaced the Received / Sent toggle when Challenges moved into Friends.
  const receivedHandlers = {
    active: { onRespondCancel: handleRespondCancel, onStartWorkout: onStartChallengeWorkout, onApplyPastActivity: onApplyPastActivityToChallenge },
    pending: { onAccept: handleAccept, onDecline: handleDecline },
    completed: {},
  };
  const sentHandlers = {
    active: { onRequestCancel: handleRequestCancel, onRespondCancel: handleRespondCancel },
    pending: { onCancel: handleCancel },
    completed: {},
  };
  const handlersFor = (c) => (c.challengerUid === user?.uid ? sentHandlers : receivedHandlers)[segment];
  const views = {
    active: {
      // Your move first: challenges you still have to finish sit above ones you're waiting on.
      list: [...splits.activeReceived, ...splits.activeSent],
      emptyTitle: "No active challenges",
      emptySubtitle: "Accepted challenges show up here until they're finished.",
    },
    pending: {
      list: [...buckets.pendingReceived, ...buckets.pendingSent],
      emptyTitle: "No pending challenges",
      emptySubtitle: "Invites you've received or sent show up here until they're accepted.",
    },
    completed: {
      list: filterByResult(buckets.completed, resultFilter, user?.uid),
      emptyTitle: emptyTitleForResult(resultFilter, "No completed challenges yet"),
      emptySubtitle: emptySubtitleForResult(resultFilter, "Finished challenges land here."),
    },
  };
  const view = views[segment];

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
        className={embedded ? 'px-4 pb-2' : 'sticky top-0 z-10 px-4 pb-2'}
        style={{
          background: 'linear-gradient(to bottom, rgba(10, 10, 10, 1) 0%, rgba(10, 10, 10, 1) 15%, rgba(10, 10, 10, 0.65) 90%, rgba(10, 10, 10, 0.65) 100%)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          maskImage: 'linear-gradient(to bottom, black calc(100% - 18px), transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black calc(100% - 18px), transparent 100%)',
        }}
      >
      {/* Header — Friends already has its own title and tabs when this is embedded there */}
      {!embedded && (
      <div className="pt-2 pb-4">
        <h1 className="text-xl font-bold text-white">Challenges</h1>
        <p className="text-sm text-gray-500">Head-to-head bets with your friends.</p>
      </div>
      )}

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
        className="p-4 mb-3.5 flex items-center gap-3.5"
        style={CARD_SURFACE}
      >
        <button
          onClick={() => { triggerHaptic(ImpactStyle.Light); setShowSelfProfile(true); }}
          aria-label="Open your profile"
          className="w-16 h-16 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0 active:scale-95 transition-transform"
          style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
        >
          {userProfile?.photoURL ? (
            <AvatarImage src={userProfile.photoURL} alt="" />
          ) : (
            <span className="text-white text-xl font-semibold">{initial}</span>
          )}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-white text-[17px] font-bold truncate">
              {userProfile?.displayName || userProfile?.username || 'You'}
            </p>
            {(userData?.streaks?.master || 0) > 0 && (
              <span className="flex-shrink-0 flex items-baseline">
                <span className="text-[17px] font-extrabold" style={{ color: GOLD }}>{userData.streaks.master}</span>
                <span className="text-[14px]">🔥</span>
              </span>
            )}
          </div>
          <p className="text-[13px] truncate flex items-center" style={{ color: '#aaa' }}>
            {userProfile?.username && <span className="truncate">@{userProfile.username}</span>}
            {isPro ? (
              <span className="ml-1.5 flex-shrink-0 text-[10px] font-extrabold px-1.5 py-[1px] rounded-[5px]" style={{ letterSpacing: '0.1em', border: '1px solid rgba(255,255,255,0.25)', color: '#ddd' }}>PRO</span>
            ) : (
              <span className="flex-shrink-0 whitespace-pre">{userProfile?.username ? ' · ' : ''}Free</span>
            )}
          </p>
          {/* Your record. No single big number on this screen, so these are text size (17px). */}
          <div className="flex items-end gap-4 mt-2">
            <RecordPill label="Active" value={activeCount} />
            <RecordPill label="Completed" value={completedCount} />
            {/* W-L instead of Pending — Pending is already shown in the segment toggle
                below, and W-L is a more useful trophy-style stat for this row. Live-
                subscribed via subscribeToUserChallengeStats so it ticks up immediately. */}
            <RecordPill label="W–L" value={`${userProfile?.challengeStats?.wins || 0}–${userProfile?.challengeStats?.losses || 0}`} />
          </div>
        </div>
      </div>

      {/* Status filter — one row of chips (the Received / Sent split lives on each card now) */}
      <div className="flex gap-2 mb-3.5">
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
              className="px-3.5 py-2 rounded-full text-[15px] font-semibold transition-colors duration-200 flex items-center gap-2"
              style={{
                backgroundColor: selected ? '#fff' : 'rgba(255,255,255,0.06)',
                color: selected ? '#000' : '#aaa',
              }}
            >
              <span>{s.label}</span>
              {badgeCount > 0 && (() => {
                // Pending's attention badge stays (white now, not yellow): something waits on you
                const attention = s.key === 'pending' && buckets.pendingReceived.length > 0;
                return (
                <span
                  className="inline-flex items-center justify-center rounded-full text-[12px] font-extrabold"
                  style={{
                    backgroundColor: selected ? 'rgba(0,0,0,0.12)' : attention ? '#fff' : 'rgba(255,255,255,0.12)',
                    color: selected || attention ? '#000' : '#ddd',
                    minWidth: 20,
                    height: 20,
                    padding: '0 6px',
                  }}
                >
                  {badgeCount}
                </span>
                );
              })()}
            </button>
          );
        })}
      </div>

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
                {...handlersFor(c)}
                onOpenProfile={(uid) => {
                  const f = friendsByUid[uid];
                  if (f) setSelectedFriend(f);
                }}
                onSeeDetails={(ch) => setDetailChallenge(ch)}
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
          distanceUnit={resolveUnit(userProfile)}
        />
      )}

      {detailChallenge && (
        <ChallengeDetailModal
          challenge={detailChallenge}
          currentUid={user.uid}
          userProfile={userProfile}
          friendsByUid={friendsByUid}
          onClose={() => setDetailChallenge(null)}
          onOpenOpponentProfile={(uid) => {
            const f = friendsByUid[uid];
            if (f) setSelectedFriend(f);
          }}
          onAccept={handleAccept}
          onDecline={handleDecline}
          onCancel={handleCancel}
          onRequestCancel={handleRequestCancel}
          onRespondCancel={handleRespondCancel}
          onStartWorkout={onStartChallengeWorkout}
          onApplyPastActivity={onApplyPastActivityToChallenge}
        />
      )}
    </>
  );
}

function RecordPill({ label, value }) {
  return (
    <div className="uppercase" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: '#8a8a8a' }}>
      <span className="block text-white normal-case" style={{ ...NUM.value, marginBottom: 3 }}>{value}</span>
      {label}
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
// easy to scan just one side of the record. Tinted by outcome.
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

