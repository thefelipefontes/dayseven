import { useState, useLayoutEffect, useRef } from 'react';
import { triggerHaptic } from './utils/haptics';
import { ImpactStyle } from '@capacitor/haptics';

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
  'Build unbreakable weekly streaks',
  'Unlimited friends & challenges',
  'Full activity history, photos & advanced trends',
  'Every leaderboard — week, month, year, all-time',
  'Streak Shield & Vacation Mode protection',
];

const CheckIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="shrink-0 mt-0.5">
    <circle cx="10" cy="10" r="10" fill="#00FF94" fillOpacity="0.15" />
    <path d="M6 10.2l2.6 2.6L14.2 7.2" stroke="#00FF94" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

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
          <span style={{ color: '#00FF94' }}>DaySeven</span> experience
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

        {/* Aspirational tease — the concentric rings + weekly-streak system
            they're unlocking. Illustrative hero, NOT the user's real data. */}
        <div className="flex-1 flex items-center justify-center min-h-[180px] py-5">
          <div className="relative w-[180px] h-[180px]">
            <svg viewBox="0 0 200 200" className="w-full h-full -rotate-90">
              {/* tracks */}
              <circle cx="100" cy="100" r="86" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="11" />
              <circle cx="100" cy="100" r="68" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="11" />
              <circle cx="100" cy="100" r="50" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="11" />
              {/* progress arcs — recovery (blue) fully closed, cardio (orange) 60%,
                  strength (green) 75%. Circumferences: r86≈540, r68≈427, r50≈314. */}
              <circle cx="100" cy="100" r="86" fill="none" stroke="#00FF94" strokeWidth="11"
                strokeLinecap="round" strokeDasharray="405 540" />
              <circle cx="100" cy="100" r="68" fill="none" stroke="#FF9500" strokeWidth="11"
                strokeLinecap="round" strokeDasharray="256 428" />
              <circle cx="100" cy="100" r="50" fill="none" stroke="#00D1FF" strokeWidth="11" />
            </svg>
            {/* Streak in the center */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" className="-mb-0.5">
                <path fill="#FFD60A" d="M12 2c.6 3 2.5 4.6 3.9 6.4 1.2 1.6 2.1 3.2 2.1 5.1A6 6 0 0 1 6 13.5c0-1.6.6-3 1.6-4.2.3 1.1 1.1 1.9 2.1 2.2C8.9 8.4 10.2 5 12 2z" />
              </svg>
              <span className="text-[23px] font-bold leading-none">12</span>
              <span className="text-[10px] font-semibold tracking-[0.1em] text-gray-400 leading-none mt-0.5">WEEKS</span>
            </div>
          </div>
        </div>

        {/* CTA */}
        <button
          onClick={handleSubscribe}
          disabled={!!busy}
          className="w-full rounded-2xl font-bold text-black text-[17px] py-4 mt-8 transition-opacity active:opacity-80 disabled:opacity-60"
          style={{ backgroundColor: '#00FF94' }}
        >
          {busy === 'subscribe' ? 'Opening…' : 'Start 7-day free trial'}
        </button>
        <p className="text-center text-gray-500 text-[12px] mt-3 leading-snug px-2">
          7 days free, then your chosen monthly or annual plan. Cancel anytime in Settings.
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
