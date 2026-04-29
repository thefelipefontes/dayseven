import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { describeMatchRule, getChallengeOutcome } from '../services/challengeService';
import { getUserProfile } from '../services/userService';
import ActivityIcon from './ActivityIcon';

const CATEGORY_COLOR = {
  lifting: '#00FF94',
  cardio: '#FF9500',
  recovery: '#00D1FF',
};

// Maps a challenge's status (+ accepter perspective) to a presentation pill.
// Resolved-without-winner states (cancelled/declined/accept_expired) use a
// muted treatment so the modal still opens but doesn't pretend there's a result.
function getStatusPresentation(challenge, currentUid) {
  const outcome = getChallengeOutcome(challenge, currentUid);
  if (challenge.status === 'pending') {
    return { label: 'Pending', color: 'rgba(255,255,255,0.65)' };
  }
  if (challenge.status === 'active') {
    return { label: 'Live', color: '#00FF94' };
  }
  if (challenge.status === 'completed') {
    if (outcome === 'won') return { label: 'Won', color: '#00FF94' };
    if (outcome === 'lost') return { label: 'Lost', color: '#FF453A' };
    return { label: 'Completed', color: '#00FF94' };
  }
  if (challenge.status === 'expired') {
    return { label: outcome === 'lost' ? 'Lost' : 'Expired', color: '#FF453A' };
  }
  if (challenge.status === 'accept_expired') {
    return { label: 'Expired', color: 'rgba(255,255,255,0.55)' };
  }
  if (challenge.status === 'cancelled') {
    return { label: 'Cancelled', color: 'rgba(255,255,255,0.55)' };
  }
  if (challenge.status === 'declined') {
    return { label: 'Declined', color: 'rgba(255,255,255,0.55)' };
  }
  return { label: challenge.status || 'Unknown', color: 'rgba(255,255,255,0.55)' };
}

function formatRemaining(expiresAt) {
  if (!expiresAt) return '';
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const remMins = mins % 60;
    return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

function formatActivity(ca) {
  if (!ca) return '—';
  const label = ca.subtype || ca.type || 'Activity';
  const bits = [];
  if (ca.distance) bits.push(`${ca.distance.toFixed(ca.distance % 1 === 0 ? 0 : 1)} mi`);
  if (ca.duration) bits.push(`${ca.duration} min`);
  if (ca.calories && !ca.distance) bits.push(`${ca.calories} cal`);
  return bits.length ? `${label} · ${bits.join(' · ')}` : label;
}

/**
 * Tale-of-the-tape detail view for a single challenge. Opens from both the
 * Home "Active Challenges" cards and the Challenges-tab list. Renders for every
 * challenge state — the status pill at the top swaps based on the lifecycle phase.
 *
 * Stats source: current user's stats come from `userProfile` (already live in App).
 * Opponent's stats are lazy-fetched via getUserProfile (cached). While the fetch
 * is in flight, opponent W-L renders 0-0 and the master streak falls back to the
 * lightweight friend record (same pattern as FriendProfileCard).
 */
export default function ChallengeDetailModal({
  challenge,
  currentUid,
  userProfile,
  friendsByUid = {},
  onClose,
  onOpenOpponentProfile,
  onAccept,
  onDecline,
  onCancel,
  onRequestCancel,
  onRespondCancel,
  onStartWorkout,
  onApplyPastActivity,
}) {
  const [isAnimating, setIsAnimating] = useState(false);
  const [opponentProfile, setOpponentProfile] = useState(null);
  // Inline confirm steps for destructive actions (matches the card's pattern —
  // tap once to "arm," tap again to commit). Avoids native confirm() which
  // doesn't fit the modal's visual style.
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmRequestCancel, setConfirmRequestCancel] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setIsAnimating(true), 10);
    return () => clearTimeout(t);
  }, []);

  // Same scroll-lock recipe as FriendProfileCard — html/body/#root all need it
  // or iOS WKWebView rubber-bands the page underneath.
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

  const isChallenger = challenge.challengerUid === currentUid;
  const opponentUid = isChallenger
    ? (challenge.participantUids || []).find((u) => u !== currentUid) || challenge.friendUid
    : challenge.challengerUid;
  const opponentFriend = opponentUid ? friendsByUid[opponentUid] : null;

  useEffect(() => {
    let cancelled = false;
    if (!opponentUid) return;
    (async () => {
      try {
        const p = await getUserProfile(opponentUid);
        if (!cancelled) setOpponentProfile(p);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [opponentUid]);

  const handleClose = () => {
    setIsAnimating(false);
    setTimeout(() => onClose?.(), 250);
  };

  const category = challenge.matchRule?.category;
  const color = CATEGORY_COLOR[category] || '#888';

  const meName = userProfile?.displayName || userProfile?.username || 'You';
  const mePhotoURL = userProfile?.photoURL || null;
  const meInitial = (meName[0] || '?').toUpperCase();
  const meStreak = userProfile?.streaks?.master ?? 0;
  const meStats = userProfile?.challengeStats || {};
  const meWins = meStats.wins || 0;
  const meLosses = meStats.losses || 0;

  const opponentName =
    opponentFriend?.displayName ||
    opponentFriend?.username ||
    (isChallenger ? challenge.friendName : challenge.challengerName) ||
    'Friend';
  const opponentPhotoURL = opponentProfile?.photoURL || opponentFriend?.photoURL || null;
  const opponentInitial = (opponentName[0] || '?').toUpperCase();
  const opponentStreak =
    opponentProfile?.streaks?.master ?? opponentFriend?.masterStreak ?? 0;
  const opponentStats = opponentProfile?.challengeStats || {};
  const opponentWins = opponentStats.wins || 0;
  const opponentLosses = opponentStats.losses || 0;

  const status = getStatusPresentation(challenge, currentUid);
  const outcome = getChallengeOutcome(challenge, currentUid);

  // Countdown selection mirrors the card's logic: pending uses respondByAt,
  // active uses participant-personal expiresAt for accepters and the doc-level
  // expiresAt for the challenger.
  const isPendingPhase = challenge.status === 'pending';
  const myParticipant = challenge.participants?.[currentUid];
  const personalExpiresAt = myParticipant?.expiresAt || challenge.expiresAt;
  const countdownTarget = isPendingPhase
    ? challenge.respondByAt || challenge.expiresAt
    : isChallenger
      ? challenge.expiresAt
      : personalExpiresAt;
  const showCountdown = challenge.status === 'pending' || challenge.status === 'active';
  const countdownText = showCountdown ? formatRemaining(countdownTarget) : null;
  const countdownSuffix = isPendingPhase ? 'to accept' : 'left';

  const ca = challenge.challengerActivity;
  const matchRuleLabel = describeMatchRule(challenge.matchRule);

  // Winner highlighting on the panel border. Only fires when challenge.status === 'completed'.
  const meIsWinner = challenge.status === 'completed' && outcome === 'won';
  const opponentIsWinner =
    challenge.status === 'completed' && outcome === 'lost';

  // Action visibility — mirrors ChallengeCard's logic so behavior matches the
  // inline buttons users already know. The modal drops the card's `!compact`
  // gate since this surface is always interactive.
  const isGroup = challenge.type === 'group';
  const myStatus =
    myParticipant?.status ||
    (challenge.friendUid === currentUid ? challenge.friendStatus : null);
  const cancelRequest =
    challenge.cancelRequest &&
    !challenge.cancelRequest.response &&
    challenge.status === 'active'
      ? challenge.cancelRequest
      : null;
  const isCancelRequester =
    cancelRequest && cancelRequest.requestedBy === currentUid;
  const isCancelResponder =
    cancelRequest && !isCancelRequester && myStatus === 'accepted';
  const showAcceptDecline =
    !isChallenger && myStatus === 'pending' && challenge.status === 'pending';
  const showStartWorkout =
    !isChallenger &&
    myStatus === 'accepted' &&
    challenge.status === 'active' &&
    !cancelRequest;
  const showCancel = isChallenger && challenge.status === 'pending';
  const showRequestCancel =
    isChallenger && challenge.status === 'active' && !isGroup && !cancelRequest;
  const hasActions =
    showAcceptDecline ||
    showStartWorkout ||
    showCancel ||
    showRequestCancel ||
    !!cancelRequest;

  // After-action helper: every action call closes the modal so the user sees
  // the new state on the underlying card (via the live Firestore subscription).
  const runAndClose = (fn, ...args) => {
    if (!fn) return;
    Promise.resolve(fn(...args)).finally(() => handleClose());
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[60] overflow-y-auto transition-all duration-300"
      style={{
        backgroundColor: isAnimating ? 'rgba(0,0,0,0.8)' : 'rgba(0,0,0,0)',
        WebkitOverflowScrolling: 'touch',
        overscrollBehavior: 'none',
      }}
      onClick={handleClose}
    >
      <div className="min-h-full flex items-center justify-center p-4">
        <div
          className="w-full max-w-sm rounded-3xl overflow-hidden transition-all duration-300 ease-out"
          style={{
            backgroundColor: '#0F0F10',
            border: `1px solid ${color}25`,
            transform: isAnimating ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(20px)',
            opacity: isAnimating ? 1 : 0,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Hero — gold "Challenge Details" header (matches the trophy-case
              aesthetic from FriendProfileCard) + status pill + optional flavor title.
              The aurora is gold rather than the category color so the modal feels
              like a "card you opened from your trophy shelf" instead of a generic
              category-tinted panel. */}
          <div className="relative pt-5 pb-3 px-5 text-center">
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(255,214,10,0.22) 0%, rgba(255,214,10,0.06) 38%, transparent 72%)',
              }}
            />
            <div className="relative flex flex-col items-center">
              <p
                className="text-[11px] font-bold uppercase tracking-[0.18em] mb-2"
                style={{ color: '#FFD60A' }}
              >
                Challenge Details
              </p>
              <div className="flex items-center gap-2">
                <span
                  className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider"
                  style={{
                    color: status.color,
                    backgroundColor: `${status.color}1A`,
                    border: `1px solid ${status.color}40`,
                  }}
                >
                  {status.label}
                </span>
                {countdownText && (
                  <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.55)' }}>
                    · {countdownText} {countdownSuffix}
                  </span>
                )}
              </div>
              {challenge.title && (
                <p className="mt-1.5 text-[13px] italic" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  “{challenge.title}”
                </p>
              )}
            </div>
          </div>

          {/* Tale of the tape — large free-standing avatars (no boxes), name +
              streak + W-L stacked beneath each, and a gold "VS" pill centered
              between them. Winner gets a gold ring around the avatar when the
              challenge is completed. */}
          <div className="px-4 pb-4 pt-1">
            <div className="flex items-center justify-between gap-2">
              <CompetitorPanel
                name={meName}
                photoURL={mePhotoURL}
                initial={meInitial}
                streak={meStreak}
                wins={meWins}
                losses={meLosses}
                isWinner={meIsWinner}
              />
              <div className="flex-shrink-0 flex items-center justify-center">
                <span
                  className="px-3 py-1 rounded-full text-[12px] font-black tracking-wider"
                  style={{
                    color: '#0F0F10',
                    backgroundColor: '#FFD60A',
                    boxShadow: '0 0 18px rgba(255,214,10,0.45)',
                  }}
                >
                  VS
                </span>
              </div>
              <CompetitorPanel
                name={opponentName}
                photoURL={opponentPhotoURL}
                initial={opponentInitial}
                streak={opponentStreak}
                wins={opponentWins}
                losses={opponentLosses}
                isWinner={opponentIsWinner}
                onTap={
                  onOpenOpponentProfile && opponentUid
                    ? () => onOpenOpponentProfile(opponentUid)
                    : null
                }
              />
            </div>
          </div>

          {/* The bet — the workout the challenger logged */}
          {ca && (
            <div className="px-4 pb-3">
              <SectionHeader emoji="🎯" label="The Bet" />
              <div
                className="rounded-xl p-3 flex items-center gap-3"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.03)',
                  border: `1px solid ${color}1A`,
                }}
              >
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: `${color}20` }}
                >
                  <ActivityIcon
                    type={ca.type}
                    subtype={ca.subtype}
                    size={22}
                    sportEmoji={ca.sportEmoji}
                    customEmoji={ca.customEmoji}
                    customIcon={ca.customIcon}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-gray-500 mb-0.5">
                    {challenge.challengerName || 'Challenger'} completed
                  </p>
                  <p className="text-white text-sm font-semibold">{formatActivity(ca)}</p>
                </div>
              </div>
            </div>
          )}

          {/* Match this — the rule that fulfills. Icon mirrors the bet's activity
              type when available (matchRule.activityType) so the rule reads as a
              direct counterpart to The Bet above. */}
          <div className="px-4 pb-3">
            <SectionHeader emoji="⚡" label="Match This" />
            <div
              className="rounded-xl p-3 flex items-center gap-3"
              style={{
                backgroundColor: 'rgba(255,255,255,0.03)',
                border: `1px solid ${color}1A`,
              }}
            >
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: `${color}20` }}
              >
                <ActivityIcon
                  type={challenge.matchRule?.activityType || ca?.type}
                  subtype={ca?.subtype}
                  size={22}
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-semibold">{matchRuleLabel}</p>
                {challenge.requirePhoto && (
                  <p className="text-[11px] mt-1" style={{ color: '#FFD60A' }}>
                    📸 Photo required
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Cancel-request banner — shown above actions when an open cancel request
              exists on an active 1v1. Both sides see the context; only the responder
              gets the Keep/Cancel buttons. Mirrors the card pattern. */}
          {cancelRequest && (
            <div className="px-4 pb-3">
              <div
                className="p-3 rounded-xl"
                style={{
                  backgroundColor: 'rgba(255,214,10,0.08)',
                  border: '1px solid rgba(255,214,10,0.25)',
                }}
              >
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.85)' }}>
                  {isCancelRequester
                    ? 'You asked to cancel. Waiting for them to respond.'
                    : `${challenge.challengerName || 'Your friend'} wants to cancel this challenge.`}
                </p>
                {isCancelResponder && (
                  <div className="flex gap-2 mt-2.5">
                    <button
                      onClick={() => runAndClose(onRespondCancel, challenge, false)}
                      className="flex-1 py-2 rounded-md text-sm font-medium bg-zinc-800 text-gray-300"
                    >
                      Keep going
                    </button>
                    <button
                      onClick={() => runAndClose(onRespondCancel, challenge, true)}
                      className="flex-1 py-2 rounded-md text-sm font-semibold"
                      style={{ backgroundColor: '#FFD60A', color: 'black' }}
                    >
                      Cancel it
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          <div
            className="px-4 pb-4 pt-2.5 space-y-2"
            style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
          >
            {/* Pending received: Decline / Accept */}
            {showAcceptDecline && (
              <div className="flex gap-2">
                <button
                  onClick={() => runAndClose(onDecline, challenge)}
                  className="flex-1 py-2.5 rounded-xl bg-zinc-800 text-gray-300 text-sm font-medium transition-all duration-150 active:scale-95"
                >
                  Decline
                </button>
                <button
                  onClick={() => runAndClose(onAccept, challenge)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150 active:scale-95"
                  style={{ backgroundColor: color, color: 'black' }}
                >
                  Accept
                </button>
              </div>
            )}

            {/* Active accepter: Use completed activity / Start activity */}
            {showStartWorkout && (
              <div className="flex gap-2">
                <button
                  onClick={() => runAndClose(onApplyPastActivity, challenge)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 active:scale-95"
                  style={{
                    backgroundColor: 'transparent',
                    color: 'rgba(255,255,255,0.85)',
                    border: `1px solid ${color}55`,
                  }}
                >
                  Use completed activity
                </button>
                <button
                  onClick={() => runAndClose(onStartWorkout, challenge)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150 active:scale-95"
                  style={{ backgroundColor: color, color: 'black' }}
                >
                  Start activity
                </button>
              </div>
            )}

            {/* Pending sent: Cancel (with inline confirm) */}
            {showCancel && (
              confirmCancel ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmCancel(false)}
                    className="flex-1 py-2.5 rounded-xl bg-zinc-800 text-gray-300 text-sm font-medium transition-all duration-150 active:scale-95"
                  >
                    Keep it
                  </button>
                  <button
                    onClick={() => runAndClose(onCancel, challenge)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150 active:scale-95"
                    style={{ backgroundColor: '#FF453A', color: 'white' }}
                  >
                    Cancel challenge
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmCancel(true)}
                  className="w-full py-2.5 rounded-xl text-sm font-medium transition-all duration-150 active:scale-95"
                  style={{
                    backgroundColor: 'transparent',
                    color: '#FF453A',
                    border: '1px solid rgba(255,69,58,0.4)',
                  }}
                >
                  Cancel challenge
                </button>
              )
            )}

            {/* Active sender: Request cancel (with inline confirm) */}
            {showRequestCancel && (
              confirmRequestCancel ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmRequestCancel(false)}
                    className="flex-1 py-2.5 rounded-xl bg-zinc-800 text-gray-300 text-sm font-medium transition-all duration-150 active:scale-95"
                  >
                    Nevermind
                  </button>
                  <button
                    onClick={() => runAndClose(onRequestCancel, challenge)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150 active:scale-95"
                    style={{ backgroundColor: '#FF453A', color: 'white' }}
                  >
                    Send request
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmRequestCancel(true)}
                  className="w-full py-2.5 rounded-xl text-sm font-medium transition-all duration-150 active:scale-95"
                  style={{
                    backgroundColor: 'transparent',
                    color: '#FF453A',
                    border: '1px solid rgba(255,69,58,0.4)',
                  }}
                >
                  Ask to cancel
                </button>
              )
            )}

            {/* Always-visible Close. When actions exist it's a subtler secondary
                so the primary CTA carries the visual weight; resolved states get
                the normal filled Close as the only button. */}
            <button
              onClick={handleClose}
              className={`w-full font-medium transition-all duration-150 active:scale-95 ${hasActions ? 'py-1.5 text-[13px] text-gray-400' : 'py-2.5 rounded-xl text-sm bg-zinc-800 text-white'}`}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function CompetitorPanel({ name, photoURL, initial, streak, wins, losses, isWinner, onTap }) {
  const Tag = onTap ? 'button' : 'div';
  // Winner gets a gold ring + soft glow on the avatar — without a surrounding
  // box this is the only visual signal of victory in the head-to-head.
  const ringColor = isWinner ? '#FFD60A' : 'rgba(255,255,255,0.15)';
  const ringWidth = isWinner ? 3 : 2;
  return (
    <Tag
      onClick={onTap || undefined}
      className={`flex-1 min-w-0 flex flex-col items-center text-center px-1 ${onTap ? 'active:opacity-70 transition-opacity' : ''}`}
    >
      <div
        className="w-20 h-20 rounded-full overflow-hidden flex items-center justify-center"
        style={{
          backgroundColor: 'rgba(255,255,255,0.06)',
          border: `${ringWidth}px solid ${ringColor}`,
          boxShadow: isWinner ? '0 0 24px rgba(255,214,10,0.35)' : 'none',
        }}
      >
        {photoURL ? (
          <img src={photoURL} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-white text-2xl font-semibold">{initial}</span>
        )}
      </div>
      <p className="text-white text-sm font-semibold truncate max-w-full leading-tight mt-2">
        {name}
      </p>
      {streak > 0 && (
        <p className="text-[11px] mt-0.5" style={{ color: '#FFD60A' }}>
          🔥 {streak}
        </p>
      )}
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="text-xl font-black" style={{ color: '#00FF94' }}>
          {wins}
        </span>
        <span className="text-gray-600 text-sm">-</span>
        <span className="text-xl font-black" style={{ color: '#FF453A' }}>
          {losses}
        </span>
      </div>
    </Tag>
  );
}

function SectionHeader({ emoji, label }) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5 px-1">
      <span className="text-[12px]">{emoji}</span>
      <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
        {label}
      </span>
    </div>
  );
}
