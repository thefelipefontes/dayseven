import React, { useEffect, useRef, useState } from 'react';
import { ImpactStyle } from '@capacitor/haptics';
import { triggerHaptic } from '../utils/haptics';

// The first-run tour: a spotlight on one part of the app per step, with a card that
// explains it. Shown automatically once a new account reaches Home, and again from
// Settings → Take the Tour or a triple tap on the logo.
//
// The spotlight follows its target every frame rather than measuring once. A one-off
// measurement went wrong whenever the page was still settling when the step began: after
// a purchase, the + button was measured near the top of the screen while the paywall was
// closing, and the spotlight stayed there. The card is placed from its real size and the
// screen's, so it stays on screen on every iPhone.

const TOUR_STEPS = [
  {
    title: 'Log Activity',
    description: 'Tap here to log workouts, runs, recovery sessions, and more.',
    position: 'above',
    tab: 'home',
    features: null
  },
  {
    title: 'Weekly Goals',
    description: 'Track your weekly progress here. Hit Strength, Cardio and your weekly Steps to win the week and grow your streak. Recovery is a bonus.',
    position: 'below',
    tab: 'home',
    features: null
  },
  {
    title: 'Plan',
    description: 'Plan your week: drop strength, cardio and recovery sessions onto the days you\'ll do them.',
    position: 'above',
    tab: 'plan',
    features: [
      { emoji: '🗓️', text: 'Drag sessions onto days' },
      { emoji: '✨', text: 'Suggest a plan in one tap' },
      { emoji: '👟', text: 'See the steps each day needs' },
      { emoji: '✅', text: 'Tap to log a planned session' }
    ]
  },
  {
    title: 'Friends',
    description: 'Stay motivated together with friends.',
    position: 'above',
    tab: 'feed',
    features: [
      { emoji: '👥', text: 'See friend activity' },
      { emoji: '🎉', text: 'React & comment' },
      { emoji: '🏅', text: 'Leaderboard (streaks and activities)' },
      { emoji: '⚡', text: 'Challenge friends head-to-head' },
      { emoji: '➕', text: 'Add new friends' }
    ]
  },
  {
    title: 'Profile',
    description: 'Your fitness home base.',
    position: 'above',
    tab: 'profile',
    features: [
      { emoji: '📊', text: 'See your stats' },
      { emoji: '📅', text: 'Browse your history' },
      { emoji: '🎯', text: 'Set goals & share wins' }
    ]
  }
];

// Steps 2-4 point at bottom-nav tabs, which sit under the + button.
const isNavStep = (step) => step >= 2;

const TOOLTIP_MAX_WIDTH = 280;
const EDGE = 12; // nearest the card gets to a screen edge or the nav bar
const GAP = 14; // between the card and what it points at
const HIGHLIGHT_PAD = 4;
const STABLE_FRAMES = 3; // the first step waits for its target to hold still this long
const MAX_SETTLE_MS = 1500; // ...or this long, if it never quite does
const MISSING_TARGET_MS = 3000; // a step whose target never appears is skipped

const rectOf = (el) => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom };
};

const sameRect = (a, b) => (!a && !b) || (a && b
  && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5
  && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5);

const sameLayout = (a, b) => a && b && a.vw === b.vw && a.vh === b.vh && a.tipH === b.tipH
  && sameRect(a.target, b.target) && sameRect(a.home, b.home) && sameRect(a.fab, b.fab);

const readSafeArea = () => {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;'
    + 'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const safe = { top: parseFloat(style.paddingTop) || 0, bottom: parseFloat(style.paddingBottom) || 0 };
  probe.remove();
  return safe;
};

const scrollParentOf = (el) => {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const overflowY = getComputedStyle(p).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
};

const clamp = (n, min, max) => Math.max(min, Math.min(n, max));

// Where the card goes: on its preferred side of the target if it fits there, else the
// other side, else kept on screen over the target's edge (no arrow then). It never goes
// under the status bar, and it stays clear of the nav bar unless pointing at it.
export const placeTooltip = ({ step, target, home, fab, vw, vh, safe, tipH }) => {
  const width = Math.min(TOOLTIP_MAX_WIDTH, vw - EDGE * 2);
  const left = clamp(target.left + target.width / 2 - width / 2, EDGE, vw - width - EDGE);
  const minTop = safe.top + EDGE;
  const navTop = Math.min(home ? home.top : vh, fab ? fab.top : vh);
  const pointsAtNav = isNavStep(step) || step === 0;
  const maxBottom = pointsAtNav ? vh - safe.bottom - EDGE : navTop - EDGE;

  // A nav tab's card also clears the + button, which rises above the tabs.
  const anchorTop = isNavStep(step) && fab ? Math.min(target.top, fab.top) : target.top;
  const aboveTop = anchorTop - GAP - tipH;
  const belowTop = target.bottom + GAP;
  const fits = { above: aboveTop >= minTop, below: belowTop + tipH <= maxBottom };
  const tops = { above: aboveTop, below: belowTop };

  const preferred = TOUR_STEPS[step]?.position === 'below' ? 'below' : 'above';
  const other = preferred === 'above' ? 'below' : 'above';
  const side = fits[preferred] ? preferred : fits[other] ? other : null;
  const top = side ? tops[side] : clamp(tops[preferred], minTop, Math.max(minTop, maxBottom - tipH));

  const arrowLeft = clamp(target.left + target.width / 2 - left - 8, 16, width - 32);
  return { top, left, width, side, arrowLeft };
};

const AppTour = ({ step, onNext, onBack, onSkip, targetRef, onSwitchTab, homeTabRef, fabRef }) => {
  const [layout, setLayout] = useState(null);
  const [shown, setShown] = useState(false);
  const tooltipRef = useRef(null);
  const safeRef = useRef({ top: 0, bottom: 0 });
  const onNextRef = useRef(onNext);
  onNextRef.current = onNext;

  const currentStep = TOUR_STEPS[step] || TOUR_STEPS[0];

  // Open the step's tab.
  useEffect(() => {
    if (currentStep.tab && onSwitchTab) onSwitchTab(currentStep.tab);
  }, [step, currentStep.tab, onSwitchTab]);

  // The page can't scroll under the tour.
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Safe-area insets, re-read when the screen changes size.
  useEffect(() => {
    const read = () => { safeRef.current = readSafeArea(); };
    read();
    window.addEventListener('resize', read);
    window.visualViewport?.addEventListener('resize', read);
    return () => {
      window.removeEventListener('resize', read);
      window.visualViewport?.removeEventListener('resize', read);
    };
  }, []);

  // Follow the target every frame.
  useEffect(() => {
    let frame;
    let last = null;
    let stableFrames = 0;
    let scrolled = isNavStep(step) || step === 0; // fixed elements never need scrolling
    const startedAt = Date.now();

    const tick = () => {
      const el = targetRef?.current;
      const target = rectOf(el);
      if (!target) {
        if (Date.now() - startedAt > MISSING_TARGET_MS) {
          onNextRef.current?.();
          return;
        }
        frame = requestAnimationFrame(tick);
        return;
      }

      // A content step starts from the top of its scrolling page.
      if (!scrolled) {
        scrolled = true;
        const scroller = scrollParentOf(el);
        if (scroller) scroller.scrollTop = 0;
        else window.scrollTo({ top: 0, behavior: 'instant' });
        frame = requestAnimationFrame(tick);
        return;
      }

      const next = {
        target,
        home: rectOf(homeTabRef?.current),
        fab: rectOf(fabRef?.current),
        vw: window.innerWidth,
        vh: window.innerHeight,
        tipH: tooltipRef.current ? Math.round(tooltipRef.current.offsetHeight) : 0,
      };
      if (sameLayout(last, next)) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
        last = next;
        setLayout(next);
      }
      const settled = stableFrames >= STABLE_FRAMES || Date.now() - startedAt > MAX_SETTLE_MS;
      if (settled && next.tipH > 0) setShown(true);
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [step, targetRef, homeTabRef, fabRef]);

  // Until the first step has a steady target: just the dimmed screen.
  if (!layout) {
    return <div className="fixed inset-0 z-[100] bg-black/80" />;
  }

  const { target, home, vw, vh, tipH } = layout;
  const placement = placeTooltip({ step, target, home, fab: layout.fab, vw, vh, safe: safeRef.current, tipH });

  const cutout = {
    top: target.top - HIGHLIGHT_PAD,
    left: target.left - HIGHLIGHT_PAD,
    width: target.width + HIGHLIGHT_PAD * 2,
    height: target.height + HIGHLIGHT_PAD * 2,
  };

  // Weekly Goals also lights up the Home tab, where those goals live.
  const homeCutout = step === 1 && home ? {
    top: home.top - HIGHLIGHT_PAD,
    left: home.left - HIGHLIGHT_PAD,
    width: home.width + HIGHLIGHT_PAD * 2,
    height: home.height + HIGHLIGHT_PAD * 2,
  } : null;

  // Hidden, and not animating, until the first placement is final: otherwise the card
  // would slide in from where it was measured with no height yet.
  const hidden = shown ? {} : { visibility: 'hidden', transition: 'none' };
  const arrowBorder = '1px solid rgba(255,255,255,0.1)';

  return (
    <div className="fixed inset-0 z-[100]" style={{ pointerEvents: 'none' }}>
      {/* Dark overlay with SVG mask for the cutouts */}
      <svg
        className="fixed inset-0 w-full h-full"
        style={{ pointerEvents: 'auto', cursor: 'pointer' }}
        onClick={() => {
          triggerHaptic(ImpactStyle.Light);
          onSkip();
        }}
      >
        <defs>
          <mask id="tour-mask">
            {/* White = visible (dark overlay), Black = hidden (cutout) */}
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {shown && (
              <rect x={cutout.left} y={cutout.top} width={cutout.width} height={cutout.height} rx="12" fill="black" />
            )}
            {shown && homeCutout && (
              <rect x={homeCutout.left} y={homeCutout.top} width={homeCutout.width} height={homeCutout.height} rx="12" fill="black" />
            )}
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill={shown ? 'rgba(0,0,0,0.65)' : 'rgba(0,0,0,0.8)'} mask="url(#tour-mask)" />
      </svg>

      {/* Highlight ring around the target */}
      <div
        className="fixed rounded-xl transition-all duration-300"
        style={{
          ...hidden,
          top: cutout.top,
          left: cutout.left,
          width: cutout.width,
          height: cutout.height,
          border: '2px solid #00FF94',
          boxShadow: '0 0 20px rgba(0, 255, 148, 0.4)',
          pointerEvents: 'none'
        }}
      />

      {homeCutout && (
        <div
          className="fixed rounded-xl transition-all duration-300"
          style={{
            ...hidden,
            top: homeCutout.top,
            left: homeCutout.left,
            width: homeCutout.width,
            height: homeCutout.height,
            border: '2px solid rgba(255, 255, 255, 0.6)',
            boxShadow: '0 0 12px rgba(255, 255, 255, 0.3)',
            pointerEvents: 'none'
          }}
        />
      )}

      {/* Tooltip. Rendered hidden first so its height is known before it's placed. */}
      <div
        ref={tooltipRef}
        className="fixed p-4 rounded-2xl transition-all duration-300"
        style={{
          ...hidden,
          top: placement.top,
          left: placement.left,
          width: placement.width,
          backgroundColor: '#1a1a1a',
          border: arrowBorder,
          pointerEvents: shown ? 'auto' : 'none'
        }}
      >
        {placement.side && (
          <div
            className="absolute w-4 h-4 rotate-45"
            style={{
              ...(placement.side === 'above' ? { bottom: '-8px' } : { top: '-8px' }),
              left: placement.arrowLeft,
              backgroundColor: '#1a1a1a',
              borderLeft: placement.side === 'below' ? arrowBorder : 'none',
              borderTop: placement.side === 'below' ? arrowBorder : 'none',
              borderRight: placement.side === 'above' ? arrowBorder : 'none',
              borderBottom: placement.side === 'above' ? arrowBorder : 'none'
            }}
          />
        )}

        {/* Step indicator */}
        <div className="flex gap-1 mb-3">
          {TOUR_STEPS.map((_, i) => (
            <div
              key={i}
              className="h-1 rounded-full transition-all duration-200"
              style={{
                width: i === step ? 24 : 8,
                backgroundColor: i === step ? '#00FF94' : 'rgba(255,255,255,0.2)'
              }}
            />
          ))}
        </div>

        <h3 className="text-white font-semibold text-base mb-1">{currentStep.title}</h3>
        <p className="text-gray-400 text-sm mb-2">{currentStep.description}</p>

        {currentStep.features && (
          <div className="mb-3 py-2 px-2.5 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
            {currentStep.features.map((feature, index) => (
              <div key={index} className="flex items-center gap-2 py-1">
                <span className="text-sm">{feature.emoji}</span>
                <span className="text-xs text-gray-400">{feature.text}</span>
              </div>
            ))}
          </div>
        )}

        {!currentStep.features && <div className="mb-2" />}

        <div className="flex items-center justify-between">
          <button
            onClick={() => {
              triggerHaptic(ImpactStyle.Light);
              onSkip();
            }}
            className="text-gray-500 text-sm px-3 py-2"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={() => {
                  triggerHaptic(ImpactStyle.Light);
                  onBack();
                }}
                className="px-3 py-2 rounded-full text-sm font-medium transition-all duration-150"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.1)',
                  color: 'rgba(255,255,255,0.7)'
                }}
                onTouchStart={(e) => e.currentTarget.style.transform = 'scale(0.95)'}
                onTouchEnd={(e) => e.currentTarget.style.transform = 'scale(1)'}
              >
                Back
              </button>
            )}
            <button
              onClick={() => {
                triggerHaptic(ImpactStyle.Light);
                onNext();
              }}
              className="px-4 py-2 rounded-full text-sm font-medium transition-all duration-150"
              style={{
                backgroundColor: '#00FF94',
                color: '#000'
              }}
              onTouchStart={(e) => e.currentTarget.style.transform = 'scale(0.95)'}
              onTouchEnd={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              {step === TOUR_STEPS.length - 1 ? "Let's go!" : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AppTour;
