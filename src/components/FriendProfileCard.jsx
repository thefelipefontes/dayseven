import AvatarImage from './AvatarImage';
import CategoryIcon from './CategoryIcon';
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getUserProfile } from '../services/userService';
import { getDemoFriendProfile } from '../demoData';
import { friendStatus, FRIEND_STATUS } from '../utils/friendStatus';
import ZoomablePhoto from './ZoomablePhoto';
import { formatDistanceValue, formatPace as formatPaceForUnit, unitLabel } from '../utils/distance';
import ActivityIcon from './ActivityIcon';

const GOLD = '#FFD700';
const CAPS = { fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8a8a8a' };
const CARD = {
  borderRadius: 22,
  background: 'linear-gradient(180deg, rgba(255,255,255,0.065), rgba(255,255,255,0.035))',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), inset 0 0 0 1px rgba(255,255,255,0.035)',
};
const LineIcon = ({ d, color, size = 15, strokeWidth = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-shrink-0">
    {d.map((p) => <path key={p} d={p} />)}
  </svg>
);
const ICON = {
  shield: ['M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3'],
  bolt: ['M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11'],
  pin: ['M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0', 'M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0z'],
};

/**
 * Shared friend profile card — opens as a centered-card modal from the Challenges tab,
 * Friends tab, and ActivityFeed leaderboard. Replaces three drifted FriendProfileModal
 * implementations. Borrows the share-card "trophy case" aesthetic (gold aurora, streak
 * record row, all-time bests list) but stays in-app rather than as an exportable PNG.
 *
 * The `friend` prop is the lightweight record from getFriends() — username, displayName,
 * photoURL, uid. Full stats (streaks, personalRecords, challengeStats) are lazily fetched
 * via getUserProfile() on mount; values render as 0/— while the fetch is in flight.
 *
 * `actions` is a ReactNode rendered in the footer — parents control which buttons show
 * (Challenge / Remove Friend / Send Request / Close) since friendship-state logic lives
 * outside this component.
 *
 * `statsVisible` is false for someone who isn't a friend (search results, friend
 * requests): only friends can read a user's stats, so the card shows name and photo and
 * a line saying to add them, instead of a block of zeros.
 */
const RecoveryBonusRow = ({ children }) => (
  <div className="flex items-center justify-between" style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
    <div className="flex items-center gap-1.5" style={{ fontSize: 12.5, color: '#ccc' }}>
      <CategoryIcon category="recovery" size={13} />
      <span>Recovery</span>
      {children}
    </div>
    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', padding: '2px 6px', borderRadius: 999, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.22)', color: '#aaa' }}>BONUS</span>
  </div>
);

export default function FriendProfileCard({ friend, onClose, actions = null, preloadedProfile = null, statsVisible = true, distanceUnit = 'mi' }) {
  const [isAnimating, setIsAnimating] = useState(false);
  // When `preloadedProfile` is provided (e.g., the current user's own card — App already
  // has userProfile + userData loaded and live-subscribed), seed state with it and skip
  // the network fetch. Otherwise lazy-fetch on mount via getUserProfile. The demo
  // account's friends have no user doc to fetch, so their demo profile stands in for it.
  const demoProfile = useMemo(() => getDemoFriendProfile(friend?.uid), [friend?.uid]);
  const [profile, setProfile] = useState(preloadedProfile || demoProfile || null);
  const [showFullPhoto, setShowFullPhoto] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setIsAnimating(true), 10);
    return () => clearTimeout(t);
  }, []);

  // Full scroll lock — applied to html, body, AND #root (the app's actual scroll
  // container). Without all three, iOS WKWebView still rubber-bands the page underneath
  // when the touch hits a boundary, and the gesture leaks past the overlay. Mirrors the
  // pattern App.jsx uses for tour/onboarding overlays.
  useEffect(() => {
    const root = document.getElementById('root');
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      rootOverflow: root?.style.overflow,
      rootOverscroll: root?.style.overscrollBehavior,
      htmlOverscroll: html.style.overscrollBehavior,
      bodyOverscroll: body.style.overscrollBehavior,
    };
    if (root) {
      root.style.overflow = 'hidden';
      root.style.overscrollBehavior = 'none';
    }
    html.style.overscrollBehavior = 'none';
    body.style.overscrollBehavior = 'none';
    return () => {
      if (root) {
        root.style.overflow = prev.rootOverflow || '';
        root.style.overscrollBehavior = prev.rootOverscroll || '';
      }
      html.style.overscrollBehavior = prev.htmlOverscroll || '';
      body.style.overscrollBehavior = prev.bodyOverscroll || '';
    };
  }, []);

  // Lazy-fetch the full user doc for stats + records. getUserProfile is cached, so a
  // re-tap on the same friend within 60s returns instantly. Skipped entirely when a
  // preloadedProfile was provided — saves an unnecessary round-trip for own-profile.
  useEffect(() => {
    let cancelled = false;
    if (preloadedProfile || demoProfile) return;
    if (!friend?.uid || !statsVisible) return;
    (async () => {
      try {
        const p = await getUserProfile(friend.uid);
        if (!cancelled) setProfile(p);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [friend?.uid, preloadedProfile, demoProfile, statsVisible]);

  const handleClose = () => {
    setIsAnimating(false);
    setTimeout(() => onClose?.(), 250);
  };

  const initial = (friend?.displayName?.[0] || friend?.username?.[0] || '?').toUpperCase();

  // Source of truth: hydrated profile when available, else fall back to whatever the
  // lightweight friend record carried (some leaderboard call sites already pre-hydrate).
  const streaks = profile?.streaks || {};
  const records = profile?.personalRecords || {};
  const challengeStats = profile?.challengeStats || friend?.challengeStats || {};

  const masterStreak = streaks.master ?? friend?.masterStreak ?? 0;
  const liftsStreak = streaks.lifts ?? friend?.strengthStreak ?? 0;
  const cardioStreak = streaks.cardio ?? friend?.cardioStreak ?? 0;
  const recoveryStreak = streaks.recovery ?? friend?.recoveryStreak ?? 0;
  const stepsStreak = streaks.steps ?? friend?.stepsStreak ?? 0;
  // On vacation, on an injury pause, or held last week (utils/friendStatus). Needs the full
  // profile, so it shows only for friends (and on your own card).
  const status = FRIEND_STATUS[friendStatus(profile)];

  // Records should never read lower than the current streak — that's a data invariant
  // (a "longest ever" can't be less than what's happening right now). Clamp on display
  // to defend against any stored-record drift; the recalc on login also fixes the data.
  const bestMaster = Math.max(records.longestMasterStreak || 0, masterStreak, friend?.longestMasterStreak || 0);
  const bestStrength = Math.max(records.longestStrengthStreak || 0, liftsStreak);
  const bestCardio = Math.max(records.longestCardioStreak || 0, cardioStreak);
  const bestRecovery = Math.max(records.longestRecoveryStreak || 0, recoveryStreak);
  const bestSteps = Math.max(records.longestStepsStreak || 0, stepsStreak);

  const wins = challengeStats.wins || 0;
  const losses = challengeStats.losses || 0;

  // Personal-record fields can be either { value, activityType } objects (single-workout
  // PRs) or raw numbers (weekly aggregates). Normalize via a small helper.
  const recVal = (v) => (v && typeof v === 'object' ? v.value : v) || 0;
  const longestDistance = recVal(records.longestDistance);
  const highestCalories = recVal(records.highestCalories);
  const fastestPace = recVal(records.fastestPace);
  const mostMilesWeek = records.mostMilesWeek || 0;

  // Render via portal directly into document.body. This takes the modal out of #root's
  // DOM subtree entirely — touches inside the modal physically can't bubble up to #root
  // (the app's scroll container), which kills the "background page scrolls instead of
  // the card" issue at its root. Without this, even with overscroll-behavior locks, iOS
  // WKWebView found a way to route the gesture to the nearest scrollable ancestor.
  return createPortal(
    <>
      {/* The card stays between the status bar and the home indicator. When it's taller
          than that space (on most phones, with records and bests), the photo and stats
          scroll inside the card and the buttons stay pinned at the bottom. The overlay
          itself doesn't scroll, and the portal keeps touches away from #root, so a drag
          can't move the page underneath. */}
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center transition-all duration-300"
        style={{
          backgroundColor: isAnimating ? 'rgba(0,0,0,0.8)' : 'rgba(0,0,0,0)',
          padding: 'calc(env(safe-area-inset-top, 0px) + 12px) 16px calc(env(safe-area-inset-bottom, 0px) + 12px)',
          overscrollBehavior: 'none',
        }}
        onClick={handleClose}
      >
        <div
          className="relative w-full max-w-sm flex flex-col overflow-hidden transition-all duration-300 ease-out"
          style={{
            maxHeight: '100%',
            // The portal renders into <body>, which sets no text colour, so anything
            // without its own colour would be black on the dark card.
            color: '#fff',
            borderRadius: 28,
            background: 'linear-gradient(180deg, #1a1a1c, #121214)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), inset 0 0 0 1px rgba(255,255,255,0.05)',
            transform: isAnimating ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(20px)',
            opacity: isAnimating ? 1 : 0,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="relative min-h-0 overflow-y-auto"
            style={{ flex: '1 1 auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}
          >
          {/* Hero — gold aurora glow + photo + name. Tighter padding (pt-5/pb-3) and a
              smaller photo (64px) than the first cut so the card doesn't dominate the
              screen — feels like a card, not a takeover. */}
          {/* Soft gold glow (Felipe's option A): gold is the winning streak's colour */}
          <div
            className="absolute left-0 right-0 top-0 pointer-events-none"
            style={{ height: 240, background: 'radial-gradient(ellipse 85% 60% at 50% 0%, rgba(255,215,0,0.16) 0%, rgba(255,215,0,0.05) 42%, transparent 74%)' }}
          />
          <div className="relative px-5" style={{ paddingTop: 20, paddingBottom: 14 }}>
            <div className="relative flex flex-col items-center">
              <button
                onClick={() => friend?.photoURL && setShowFullPhoto(true)}
                className={`w-16 h-16 rounded-full overflow-hidden flex items-center justify-center mb-2 ${friend?.photoURL ? 'cursor-pointer active:scale-95 transition-transform' : ''}`}
                style={{
                  backgroundColor: 'rgba(255,255,255,0.06)',
                  border: '2px solid rgba(255,215,0,0.35)',
                }}
              >
                {friend?.photoURL ? (
                  <AvatarImage src={friend.photoURL} alt="" />
                ) : (
                  <span className="text-white text-xl font-semibold">{initial}</span>
                )}
              </button>
              <p className="text-white truncate max-w-full leading-tight" style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.2px' }}>
                {friend?.displayName || friend?.username || 'Friend'}
              </p>
              {friend?.username && (
                <p className="truncate" style={{ fontSize: 12.5, color: '#9a9a9a', marginTop: 2 }}>@{friend.username}</p>
              )}
              {status && (
                <div className="mt-2.5 inline-flex items-center gap-1.5 text-xs rounded-full px-3 py-1" style={{ backgroundColor: 'rgba(255,255,255,0.07)', color: '#ddd' }}>
                  <LineIcon d={ICON.shield} color="#ddd" size={13} />
                  <span>{status.label}</span>
                  <span style={{ color: '#8a8a8a' }}>· {status.detail}</span>
                </div>
              )}
            </div>
          </div>

          {!statsVisible && (
            <p className="px-6 pb-4 text-center text-sm text-gray-500">
              Add {friend?.displayName?.split(' ')[0] || friend?.username || 'them'} as a friend to see their streaks and records.
            </p>
          )}

          {/* Body — natural height; it scrolls with the photo above when the card
              doesn't fit the screen. */}
          {statsVisible && (
          <div className="px-4 pb-3">
            {/* Their winning streak is the card's one big number, in gold; Best and the
                challenge record sit beside it at text size. */}
            <div className="mb-3" style={{ ...CARD, padding: '16px 18px' }}>
              <div className="flex items-end justify-between">
                <div>
                  <div className="flex items-baseline gap-1.5">
                    <span style={{ fontSize: 46, fontWeight: 800, letterSpacing: '-2.2px', lineHeight: 0.8, color: GOLD }}>{masterStreak}</span>
                    <span style={{ fontSize: 20, fontWeight: 700, color: 'rgba(255,215,0,0.8)' }}>{masterStreak === 1 ? 'week' : 'weeks'}</span>
                  </div>
                  <div style={{ ...CAPS, fontSize: 11, marginTop: 10, color: 'rgba(255,215,0,0.9)' }}>Winning streak</div>
                </div>
                <div className="flex text-right" style={{ gap: 18 }}>
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 700 }}>{bestMaster}<span style={{ fontSize: 13, color: '#666', fontWeight: 600 }}>w</span></div>
                    <div style={{ ...CAPS, marginTop: 6 }}>Best</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 700 }}>{wins}–{losses}</div>
                    <div style={{ ...CAPS, marginTop: 6 }}>Challenges</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Streak records — longest streaks ever in each category */}
            <SectionHeader label="Streak records" />
            <div className="mb-3 grid grid-cols-4" style={{ ...CARD, padding: '12px 14px' }}>
              <StreakCol value={bestMaster} label="Winning" winning />
              <StreakCol value={bestStrength} label="Strength" category="lifts" />
              <StreakCol value={bestCardio} label="Cardio" category="cardio" />
              <StreakCol value={bestSteps} label="Steps" category="steps" />
            </div>

            {/* All-time bests */}
            <SectionHeader label="All-time bests" />
            <div className="mb-3" style={{ ...CARD, padding: '2px 14px' }}>
              <BestRow first icon={<ActivityIcon type="Running" size={15} color="#FF9500" />} label="Longest run" value={longestDistance ? `${formatDistanceValue(longestDistance, distanceUnit, 1)} ${unitLabel(distanceUnit)}` : '—'} />
              <BestRow icon={<CategoryIcon category="calories" size={15} />} label="Top calorie workout" value={highestCalories ? highestCalories.toLocaleString() : '—'} />
              <BestRow icon={<LineIcon d={ICON.bolt} color="#FF9500" />} label="Fastest pace" value={fastestPace ? formatPaceForUnit(fastestPace * 60, distanceUnit) : '—'} />
              <BestRow icon={<LineIcon d={ICON.pin} color="#aaa" />} label={distanceUnit === 'km' ? 'Most km in a week' : 'Most miles in a week'} value={mostMilesWeek ? `${formatDistanceValue(mostMilesWeek, distanceUnit, 1)} ${unitLabel(distanceUnit)}` : '—'} />
            </div>

            {/* Current streaks — the three goals that win the week, then Recovery as a bonus row.
                Winning is already the big number above. */}
            <SectionHeader label="Current streaks" />
            <div style={{ ...CARD, padding: '12px 14px' }}>
              <div className="grid grid-cols-3">
                <StreakCol value={liftsStreak} label="Strength" category="lifts" />
                <StreakCol value={cardioStreak} label="Cardio" category="cardio" />
                <StreakCol value={stepsStreak} label="Steps" category="steps" />
              </div>
              {/* Recovery is a bonus (its own streak, doesn't win the week); hidden when Recovery is off */}
              {(profile?.goals?.recoveryPerWeek ?? 2) > 0 && (
                <RecoveryBonusRow><b className="text-white">{recoveryStreak}w</b><span style={{ color: '#777' }}>· best {bestRecovery}w</span></RecoveryBonusRow>
              )}
            </div>
          </div>
          )}
          </div>

          {/* Action footer — parent-controlled. Falls back to a Close button if nothing
              else was passed (e.g., the ChallengesTab quick-profile case). Pinned: it
              never scrolls out of view. */}
          <div className="relative flex-shrink-0 px-4 pb-4 pt-2.5" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            {actions || (
              <button
                onClick={handleClose}
                className="w-full py-3 rounded-full bg-zinc-800 text-white font-medium transition-all duration-150 active:scale-95"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Fullscreen photo overlay — same pattern as OwnProfileModal. */}
      {friend?.photoURL && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black transition-opacity duration-150"
          style={{
            opacity: showFullPhoto ? 1 : 0,
            pointerEvents: showFullPhoto ? 'auto' : 'none',
            visibility: showFullPhoto ? 'visible' : 'hidden',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={(e) => { e?.stopPropagation?.(); setShowFullPhoto(false); }}
            className="absolute right-3 z-10 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center"
            style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
          >
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <ZoomablePhoto
            src={friend.photoURL}
            alt={friend?.displayName || ''}
            className="w-full h-full flex items-center justify-center"
            onSingleTap={() => setShowFullPhoto(false)}
          />
        </div>
      )}
    </>,
    document.body
  );
}

function SectionHeader({ label }) {
  return <div style={{ ...CAPS, margin: '0 4px 8px' }}>{label}</div>;
}

// One streak column: line icon (🔥 for Winning) + label, then the weeks at 17px.
function StreakCol({ value, label, category, winning = false }) {
  return (
    <div>
      <div className="flex items-center gap-[5px]" style={{ fontSize: 11, fontWeight: 600, color: '#aaa' }}>
        {winning ? <span style={{ fontSize: 11 }}>🔥</span> : <CategoryIcon category={category} size={12} />}
        {label}
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, marginTop: 4, color: winning ? GOLD : '#fff' }}>
        {value}<span style={{ fontSize: 13, fontWeight: 600, color: winning ? 'rgba(255,215,0,0.6)' : '#666' }}>w</span>
      </div>
    </div>
  );
}

function BestRow({ icon, label, value, first = false }) {
  return (
    <div className="flex items-center gap-2.5" style={{ padding: '9px 0', borderTop: first ? 'none' : '1px solid rgba(255,255,255,0.06)' }}>
      {icon}
      <span className="flex-1" style={{ fontSize: 13, color: '#ccc' }}>{label}</span>
      <b style={{ fontSize: 15, letterSpacing: '-0.1px' }}>{value}</b>
    </div>
  );
}
