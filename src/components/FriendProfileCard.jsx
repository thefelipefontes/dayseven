import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getUserProfile } from '../services/userService';

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
 */
export default function FriendProfileCard({ friend, onClose, actions = null, preloadedProfile = null }) {
  const [isAnimating, setIsAnimating] = useState(false);
  // When `preloadedProfile` is provided (e.g., the current user's own card — App already
  // has userProfile + userData loaded and live-subscribed), seed state with it and skip
  // the network fetch. Otherwise lazy-fetch on mount via getUserProfile.
  const [profile, setProfile] = useState(preloadedProfile || null);
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
    if (preloadedProfile) return;
    if (!friend?.uid) return;
    (async () => {
      try {
        const p = await getUserProfile(friend.uid);
        if (!cancelled) setProfile(p);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [friend?.uid, preloadedProfile]);

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

  // Records should never read lower than the current streak — that's a data invariant
  // (a "longest ever" can't be less than what's happening right now). Clamp on display
  // to defend against any stored-record drift; the recalc on login also fixes the data.
  const bestMaster = Math.max(records.longestMasterStreak || 0, masterStreak, friend?.longestMasterStreak || 0);
  const bestStrength = Math.max(records.longestStrengthStreak || 0, liftsStreak);
  const bestCardio = Math.max(records.longestCardioStreak || 0, cardioStreak);
  const bestRecovery = Math.max(records.longestRecoveryStreak || 0, recoveryStreak);

  const wins = challengeStats.wins || 0;
  const losses = challengeStats.losses || 0;

  // Personal-record fields can be either { value, activityType } objects (single-workout
  // PRs) or raw numbers (weekly aggregates). Normalize via a small helper.
  const recVal = (v) => (v && typeof v === 'object' ? v.value : v) || 0;
  const longestDistance = recVal(records.longestDistance);
  const highestCalories = recVal(records.highestCalories);
  const fastestPace = recVal(records.fastestPace);
  const mostMilesWeek = records.mostMilesWeek || 0;

  const formatPace = (mins) => {
    if (!mins || mins <= 0) return '—';
    const m = Math.floor(mins);
    const s = Math.round((mins - m) * 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // Render via portal directly into document.body. This takes the modal out of #root's
  // DOM subtree entirely — touches inside the modal physically can't bubble up to #root
  // (the app's scroll container), which kills the "background page scrolls instead of
  // the card" issue at its root. Without this, even with overscroll-behavior locks, iOS
  // WKWebView found a way to route the gesture to the nearest scrollable ancestor.
  return createPortal(
    <>
      {/* Overlay is the scroll container — iOS WKWebView handles this much more reliably
          than the "fixed-height card with internal-scroll body" pattern (which kept letting
          touch-moves leak through to #root). The card sits naturally; if its content fits
          within the viewport the inner flex centers it, otherwise the overlay scrolls. */}
      <div
        className="fixed inset-0 z-[60] overflow-y-auto transition-all duration-300"
        style={{
          backgroundColor: isAnimating ? 'rgba(0,0,0,0.8)' : 'rgba(0,0,0,0)',
          WebkitOverflowScrolling: 'touch',
          // `none` (vs `contain`) also suppresses rubber-banding past the overlay's edges,
          // which iOS otherwise uses as an excuse to scroll the page underneath.
          overscrollBehavior: 'none',
        }}
        onClick={handleClose}
      >
        <div className="min-h-full flex items-center justify-center p-4">
        <div
          className="w-full max-w-sm rounded-3xl overflow-hidden transition-all duration-300 ease-out"
          style={{
            backgroundColor: '#0F0F10',
            border: '1px solid rgba(255,255,255,0.06)',
            transform: isAnimating ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(20px)',
            opacity: isAnimating ? 1 : 0,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Hero — gold aurora glow + photo + name. Tighter padding (pt-5/pb-3) and a
              smaller photo (64px) than the first cut so the card doesn't dominate the
              screen — feels like a card, not a takeover. */}
          <div className="relative pt-5 pb-3 px-5">
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(255,214,10,0.18) 0%, rgba(255,214,10,0.06) 35%, transparent 70%)',
              }}
            />
            <div className="relative flex flex-col items-center">
              <button
                onClick={() => friend?.photoURL && setShowFullPhoto(true)}
                className={`w-16 h-16 rounded-full overflow-hidden flex items-center justify-center mb-2 ${friend?.photoURL ? 'cursor-pointer active:scale-95 transition-transform' : ''}`}
                style={{
                  backgroundColor: 'rgba(255,255,255,0.06)',
                  border: '2px solid rgba(255,214,10,0.25)',
                }}
              >
                {friend?.photoURL ? (
                  <img src={friend.photoURL} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-white text-xl font-semibold">{initial}</span>
                )}
              </button>
              <p className="text-white font-bold text-base truncate max-w-full leading-tight">
                {friend?.displayName || friend?.username || 'Friend'}
              </p>
              <div className="flex items-center gap-1.5 text-xs mt-0.5">
                {friend?.username && (
                  <span className="text-gray-400 truncate">@{friend.username}</span>
                )}
                {masterStreak > 0 && (
                  <span style={{ color: '#FFD60A' }}>· {masterStreak}🔥</span>
                )}
              </div>
            </div>
          </div>

          {/* Body — natural height. The overlay above is the scroll container, so the
              card itself doesn't need internal scrolling. */}
          <div className="px-4 pb-3">
            {/* Headline triplet — Hybrid Streak (current), Best Streak (longestMasterStreak),
                Challenges (W-L stacked above completion %). Single-word labels avoid the
                two-line wrap problem the previous "Challenges W-L" had. */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              <StatTile label="Hybrid Streak" value={masterStreak} />
              <StatTile label="Best Streak" value={bestMaster} />
              <div
                className="rounded-xl p-2 text-center"
                style={{ backgroundColor: 'rgba(255,214,10,0.08)', border: '1px solid rgba(255,214,10,0.2)' }}
              >
                <p className="text-xl font-bold leading-none">
                  <span style={{ color: '#00FF94' }}>{wins}</span>
                  <span className="text-gray-600 mx-0.5">-</span>
                  <span style={{ color: '#FF453A' }}>{losses}</span>
                </p>
                <p className="text-gray-500 text-[10px] mt-1">Challenges</p>
              </div>
            </div>

            {/* 🔥 Streak Records — longest streaks ever in each category */}
            <SectionHeader emoji="🔥" label="Streak Records" />
            <div
              className="rounded-xl p-2.5 mb-3 grid grid-cols-4 gap-1"
              style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}
            >
              <StreakPill value={bestMaster} label="Master" color="#FFD60A" />
              <StreakPill value={bestStrength} label="Strength" color="#00FF94" />
              <StreakPill value={bestCardio} label="Cardio" color="#FF9500" />
              <StreakPill value={bestRecovery} label="Recovery" color="#00D1FF" />
            </div>

            {/* 🏆 All-Time Bests */}
            <SectionHeader emoji="🏆" label="All-Time Bests" />
            <div
              className="rounded-xl p-2.5 mb-3 space-y-1.5"
              style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}
            >
              <BestRow icon="🏃" label="Longest Run" value={longestDistance ? `${longestDistance.toFixed(1)} mi` : '—'} />
              <BestRow icon="🔥" label="Top Calorie Workout" value={highestCalories ? highestCalories.toLocaleString() : '—'} />
              <BestRow icon="⚡" label="Fastest Pace" value={fastestPace ? `${formatPace(fastestPace)} /mi` : '—'} />
              <BestRow icon="📍" label="Most Miles in a Week" value={mostMilesWeek ? `${mostMilesWeek.toFixed(1)} mi` : '—'} />
            </div>

            {/* Current Streaks — compact 3-up row matching Streak Records visual rhythm.
                Master is already in the headline triplet, so this only shows category breakdowns. */}
            <SectionHeader emoji="📈" label="Current Streaks" />
            <div
              className="rounded-xl p-2.5 grid grid-cols-3 gap-1"
              style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}
            >
              <StreakPill value={liftsStreak} label="Strength" color="#00FF94" />
              <StreakPill value={cardioStreak} label="Cardio" color="#FF9500" />
              <StreakPill value={recoveryStreak} label="Recovery" color="#00D1FF" />
            </div>
          </div>

          {/* Action footer — parent-controlled. Falls back to a Close button if nothing
              else was passed (e.g., the ChallengesTab quick-profile case). */}
          <div className="px-4 pb-4 pt-2.5" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
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
              src={friend.photoURL}
              alt={friend?.displayName || ''}
              className="max-w-[90vw] max-h-[85vh] rounded-2xl object-contain"
            />
          </div>
        </div>
      )}
    </>,
    document.body
  );
}

function StatTile({ label, value }) {
  return (
    <div className="rounded-xl p-2 text-center" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
      <p className="text-xl font-bold text-white leading-none">{value}</p>
      <p className="text-gray-500 text-[10px] mt-1">{label}</p>
    </div>
  );
}

function SectionHeader({ emoji, label }) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5 px-1">
      <span className="text-[12px]">{emoji}</span>
      <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">{label}</span>
    </div>
  );
}

function StreakPill({ value, label, color }) {
  return (
    <div className="text-center">
      <div className="text-base font-black leading-tight" style={{ color }}>{value}</div>
      <div className="text-[9px] text-gray-500">{label}</div>
    </div>
  );
}

function BestRow({ icon, label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[12px] text-gray-400 flex items-center gap-2">
        <span>{icon}</span> {label}
      </span>
      <span className="text-[13px] font-bold text-white">{value}</span>
    </div>
  );
}
