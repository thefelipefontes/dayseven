import { useState, useLayoutEffect, useRef } from 'react';
import { triggerHaptic } from './utils/haptics';
import { ImpactStyle } from '@capacitor/haptics';
import { GoalRowsMini } from './components/GoalCard';
import { CARD_SURFACE, GOLD, goldMix } from './utils/designTokens';

// Subscription-only hard paywall surface.
//
// Rendered by App.jsx in place of the main app when a post-cutover account
// (`subscriptionRequired: true`) has no active subscription — i.e. they
// dismissed the onboarding paywall, or a trial/subscription lapsed. This is the
// deliberate "X → locked home" landing: a real, non-trapping screen (they can
// restore or sign out) whose primary action re-opens the native RevenueCat
// paywall. It is NOT an auto-re-prompt loop, which App Review treats as a dead
// end. On a successful purchase/restore the parent flips isPro and this screen
// unmounts into the app.
//
// Props:
//   onSubscribe  async () => boolean   present the paywall; resolves to whether they purchased
//   onRestore    async () => boolean   restore purchases; resolves to whether an entitlement was found
//   onSignOut    () => void            sign out (escape hatch — never trap the user)
//   userProfile  object                used only for a light personalized greeting
const BENEFITS = [
  'Winning Streak plus Strength, Cardio and Steps streaks',
  'Full workout history & detailed stats + trends',
  'Challenge friends head-to-head',
  'Compete on leaderboards',
  'Streak shields & vacation mode protection',
];

// Neutral: green now means Strength (Nov 2026 redesign).
const CheckIcon = () => (
  <span className="shrink-0 mt-0.5 inline-flex items-center justify-center rounded-full" style={{ width: 20, height: 20, backgroundColor: 'rgba(255,255,255,0.1)' }}>
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  </span>
);

// The illustration under the benefits: a small Home card. Illustrative, NOT the user's data.
const HERO_ROWS = [
  { key: 'lifts', done: 3, goal: 3 },
  { key: 'cardio', done: 1, goal: 2 },
  { key: 'steps', done: 59000, goal: 70000 },
];

export default function LockedScreen({ onSubscribe, onRestore, onSignOut, userProfile }) {
  const [busy, setBusy] = useState(null); // 'subscribe' | 'restore' | null
  const [restoreMsg, setRestoreMsg] = useState('');

  const firstName = (userProfile?.displayName || '').trim().split(' ')[0];

  // Keep the headline to exactly two lines on every device: each line is
  // nowrap, and we shrink the font until the widest line fits the container,
  // rather than letting a long name wrap to a 3rd line on smaller phones.
  const headlineRef = useRef(null);
  useLayoutEffect(() => {
    const el = headlineRef.current;
    if (!el) return;
    const fit = () => {
      let size = 34;
      el.style.fontSize = size + 'px';
      while (el.scrollWidth > el.clientWidth && size > 18) {
        size -= 1;
        el.style.fontSize = size + 'px';
      }
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [firstName]);

  const handleSubscribe = async () => {
    if (busy) return;
    setRestoreMsg('');
    triggerHaptic(ImpactStyle.Medium);
    setBusy('subscribe');
    try {
      await onSubscribe?.();
      // On success the parent flips isPro and unmounts us; nothing else to do.
    } catch (e) {
      console.error('[LockedScreen] subscribe error:', e);
    } finally {
      setBusy(null);
    }
  };

  const handleRestore = async () => {
    if (busy) return;
    setRestoreMsg('');
    triggerHaptic(ImpactStyle.Light);
    setBusy('restore');
    try {
      const restored = await onRestore?.();
      if (!restored) setRestoreMsg('No active subscription found on this Apple ID.');
    } catch (e) {
      console.error('[LockedScreen] restore error:', e);
      setRestoreMsg('Couldn’t restore right now. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black text-white flex flex-col overflow-y-auto"
      style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 32px)',
        paddingBottom: 'max(env(safe-area-inset-bottom, 16px), 24px)',
      }}
    >
      <div className="flex-1 flex flex-col px-7">
        {/* Brand lockup — real DaySeven logo + wordmark (flush, matches the
            in-app header lockup). */}
        <div className="flex items-center gap-0 mb-9">
          <img src="/icon-transparent.png" alt="" className="h-9" />
          <img src="/wordmark.png" alt="DaySeven" className="h-5" />
        </div>

        {/* Headline — always exactly two lines; font auto-shrinks to fit on
            narrow screens (see the useLayoutEffect above) instead of wrapping. */}
        <h1
          ref={headlineRef}
          className="leading-[1.08] font-bold tracking-tight"
          style={{ fontSize: '34px', whiteSpace: 'nowrap' }}
        >
          {firstName ? `${firstName}, unlock the full` : 'Unlock the full'}
          <br />
          <span className="text-white">DaySeven</span> experience
        </h1>
        <p className="text-gray-400 text-[15px] mt-3 leading-snug">
          One membership. Everything included — no limits, no add-ons.
        </p>

        {/* Benefits */}
        <ul className="mt-5 space-y-3.5">
          {BENEFITS.map((b) => (
            <li key={b} className="flex items-start gap-3">
              <CheckIcon />
              <span className="text-[15px] text-gray-100 leading-snug">{b}</span>
            </li>
          ))}
        </ul>

        {/* Aspirational tease — a small Home card: a 12-week Winning Streak over this week's
            goals. Illustrative hero, NOT the user's real data. */}
        <div className="flex-1 flex items-center justify-center min-h-[180px] py-5">
          <div className="w-full" style={{ ...CARD_SURFACE, padding: '16px 18px 18px' }}>
            <div className="flex items-end justify-between" style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div>
                <div className="flex items-baseline" style={{ gap: 6 }}>
                  <span style={{ fontSize: 15, lineHeight: 1 }}>🔥</span>
                  <span style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-1.4px', lineHeight: 0.82, color: GOLD, textShadow: '0 0 18px rgba(255,215,0,0.35)' }}>12</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'rgba(255,215,0,0.85)' }}>weeks</span>
                </div>
                <div className="uppercase" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', marginTop: 9, color: 'rgba(255,215,0,0.9)' }}>Winning streak</div>
              </div>
              <div className="text-right">
                <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-1px', lineHeight: 0.82, color: goldMix(78) }}>78<small style={{ fontSize: 15, marginLeft: 1 }}>%</small></div>
                <div className="uppercase" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', marginTop: 9, color: '#8a8a8a' }}>This week</div>
              </div>
            </div>
            <GoalRowsMini rows={HERO_ROWS} />
          </div>
        </div>

        {/* CTA */}
        <button
          onClick={handleSubscribe}
          disabled={!!busy}
          className="w-full rounded-2xl font-bold text-black text-[17px] py-4 mt-3 transition-opacity active:opacity-80 disabled:opacity-60"
          style={{ backgroundColor: '#fff' }}
        >
          {busy === 'subscribe' ? 'Opening…' : 'See plans'}
        </button>
        <p className="text-center text-gray-500 text-[12px] mt-3 leading-snug px-2">
          Monthly and yearly start with 7 days free and auto-renew until cancelled.
          Lifetime is a one-time purchase. Cancel anytime in Settings.
        </p>

        {/* Secondary actions */}
        <div className="flex items-center justify-center gap-6 mt-5">
          <button
            onClick={handleRestore}
            disabled={!!busy}
            className="text-gray-400 text-[14px] active:opacity-60 disabled:opacity-40"
          >
            {busy === 'restore' ? 'Restoring…' : 'Restore purchases'}
          </button>
          <span className="text-gray-700">·</span>
          <button
            onClick={() => { triggerHaptic(ImpactStyle.Light); onSignOut?.(); }}
            disabled={!!busy}
            className="text-gray-400 text-[14px] active:opacity-60 disabled:opacity-40"
          >
            Sign out
          </button>
        </div>
        {restoreMsg && (
          <p className="text-center text-gray-500 text-[12px] mt-3">{restoreMsg}</p>
        )}
      </div>
    </div>
  );
}
