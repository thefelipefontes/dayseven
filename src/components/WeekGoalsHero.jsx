import React, { useLayoutEffect, useEffect, useRef, useState } from 'react';
import { ImpactStyle } from '@capacitor/haptics';
import CategoryIcon from './CategoryIcon';
import { triggerHaptic } from '../utils/haptics';
import {
  BAR, TEXT_MUTED, TEXT_FAINT, CARD_BG_SOLID, WEEK_WON_GLOW,
  hexToRgb, trackColor, doneGlow, goldMix,
} from '../utils/designTokens';

// The top of Home's "This Week's Goals" card (Nov 2026 redesign, mock option F1): the week's
// progress as one big number that warms white → gold, then a row per goal: one block per
// session for Strength and Cardio, one continuous bar with a pace notch for Steps.
//
// It plays "Light up" once when it mounts (Home opening): sessions switch on one at a time
// with a white flash, the steps bar runs, a finished goal blooms and gets its check, and the
// big number counts up alongside. Under Reduce Motion it just shows the final state. The
// timings are the ones Felipe picked in mocks/mock-home-light.html (`animateHome('light')`).

const START = 150;        // first block switches on
const STEP = 150;         // between blocks
const FLASH = 460;        // one block's flash
const STEPS_GAP = 80;     // last block → steps bar starts
const STEPS_RUN = 760;    // steps bar fill
const BLOOM_AFTER = 280;  // a finished row's glow + check, after its last block
const BLOOM_FADE = 600;
const CHECK_POP = 420;
const WON_POP = 520;

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const NO_SHADOW = '0 0 0 0 rgba(255,255,255,0)';

const prefersReducedMotion = () => {
  try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

// Tinted circle with a check in the goal's colour — also used by Today's Activity.
export const CheckBadge = ({ color, size = 20, ...rest }) => (
  <span
    {...rest}
    className="inline-flex items-center justify-center rounded-full flex-shrink-0"
    style={{ width: size, height: size, backgroundColor: `rgba(${hexToRgb(color)},0.14)`, ...(rest.style || {}) }}
  >
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12l5 5l10 -10" />
    </svg>
  </span>
);

// Slides its content open and shut (a 0fr → 1fr grid row, so no measuring). The content stays
// mounted while shut so closing can animate too; `inert` keeps it out of reach meanwhile.
// iOS before 17.4 can't animate grid rows and just snaps open, which is fine.
export const Collapse = ({ open, children }) => {
  const [reduced] = useState(prefersReducedMotion);
  return (
    <div
      aria-hidden={!open}
      inert={open ? undefined : ''}
      style={{
        display: 'grid',
        gridTemplateRows: open ? '1fr' : '0fr',
        transition: reduced ? 'none' : 'grid-template-rows 300ms cubic-bezier(.2,.8,.2,1), opacity 300ms ease',
        opacity: open ? 1 : 0,
      }}
    >
      <div style={{ overflow: 'hidden', minHeight: 0 }}>{children}</div>
    </div>
  );
};

// Which blocks a row lights: one per session up to the goal (extra sessions don't add blocks).
const litCount = (r) => (r.kind === 'blocks' ? Math.min(r.done, r.goal) : 0);
const isMet = (r) => (r.kind === 'steps' ? r.goal > 0 && r.total >= r.goal : r.goal > 0 && r.done >= r.goal);
const stepsOpen = (r) => r.dayIndex > 0 && r.total < r.goal;

// The intro schedule, fixed from the values on screen when Home opens.
function buildPlan(rows) {
  let k = 0;
  const blocks = {};
  const lastAt = {};
  rows.forEach((r) => {
    const n = litCount(r);
    if (!n) return;
    blocks[r.key] = Array.from({ length: n }, () => START + (k++) * STEP);
    lastAt[r.key] = blocks[r.key][n - 1];
  });
  const stepsAt = START + k * STEP + STEPS_GAP;
  const wonAt = stepsAt + STEPS_RUN;
  return { blocks, lastAt, stepsAt, wonAt, end: wonAt + Math.max(WON_POP, BLOOM_FADE + 100) };
}

/**
 * @param {number} percent   the week's progress, 0–100 (HomeTab's overallPercent)
 * @param {number} daysLeft  including today
 * @param {Array}  rows      [{ key, label, color, kind: 'blocks'|'steps', done, goal, total, dayIndex,
 *                             streak, paused: {emoji,color}|null, expanded, onToggle, formatK,
 *                             detail: the breakdown that opens under the row }]
 */
export default function WeekGoalsHero({ percent, daysLeft, rows }) {
  const rootRef = useRef(null);
  const planRef = useRef(null);
  const [introT, setIntroT] = useState(() => (prefersReducedMotion() ? null : 0));
  if (introT !== null && !planRef.current) planRef.current = buildPlan(rows);
  const plan = planRef.current;
  const won = percent >= 100;

  // Light up — once, on mount.
  useLayoutEffect(() => {
    if (introT === null || !rootRef.current) return undefined;
    const root = rootRef.current;
    const q = (sel) => root.querySelector(sel);
    const anims = [];
    const A = (el, kf, o) => { if (el?.animate) anims.push(el.animate(kf, o)); };

    rows.forEach((r) => {
      const met = isMet(r);
      if (r.kind === 'blocks' && plan.blocks[r.key]) {
        const bloomAt = plan.lastAt[r.key] + BLOOM_AFTER;
        plan.blocks[r.key].forEach((t, i) => {
          const el = q(`[data-block="${r.key}-${i}"]`);
          // The finished-goal halo first, so the flash (created after it) wins while it runs.
          if (met) A(el, [{ boxShadow: NO_SHADOW }, { boxShadow: NO_SHADOW, offset: bloomAt / (bloomAt + BLOOM_FADE), easing: 'ease-out' }, { boxShadow: doneGlow(r.color) }], { duration: bloomAt + BLOOM_FADE, fill: 'backwards' });
          A(el, [
            { backgroundColor: trackColor(r.color), boxShadow: NO_SHADOW },
            { backgroundColor: '#fff', boxShadow: '0 0 18px 3px rgba(255,255,255,.85)', offset: 0.35 },
            { backgroundColor: r.color, boxShadow: NO_SHADOW },
          ], { duration: FLASH, delay: t, easing: 'ease-out', fill: 'backwards' });
        });
        if (met) A(q(`[data-check="${r.key}"]`), [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1.3)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }], { duration: CHECK_POP, delay: bloomAt, easing: 'ease-out', fill: 'backwards' });
      }
      if (r.kind === 'steps') {
        const fill = q(`[data-fill="${r.key}"]`);
        const bloomAt = plan.stepsAt + 700;
        if (met) A(fill, [{ boxShadow: NO_SHADOW }, { boxShadow: NO_SHADOW, offset: bloomAt / (bloomAt + BLOOM_FADE), easing: 'ease-out' }, { boxShadow: doneGlow(r.color) }], { duration: bloomAt + BLOOM_FADE, fill: 'backwards' });
        A(fill, [{ width: '0%' }, { width: `${Math.min(100, r.goal > 0 ? (r.total / r.goal) * 100 : 0)}%` }], { duration: STEPS_RUN, delay: plan.stepsAt, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
        A(q(`[data-notch="${r.key}"]`), [{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: plan.stepsAt + 680, fill: 'backwards' });
        if (met) A(q(`[data-check="${r.key}"]`), [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1.3)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }], { duration: CHECK_POP, delay: bloomAt, easing: 'ease-out', fill: 'backwards' });
      }
    });
    if (won) {
      A(q('[data-week-number]'), [
        { transform: 'scale(1)', textShadow: '0 0 0 rgba(255,215,0,0)' },
        { transform: 'scale(1.08)', textShadow: '0 0 30px rgba(255,215,0,.7)', offset: 0.45 },
        { transform: 'scale(1)', textShadow: WEEK_WON_GLOW },
      ], { duration: WON_POP, delay: plan.wonAt, easing: 'ease-out', fill: 'backwards' });
    }

    // One clock for the numbers (the big %, each row's count, the steps count).
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      const t = performance.now() - t0;
      if (t >= plan.end) { setIntroT(null); return; }
      setIntroT(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); anims.forEach((a) => a.cancel()); };
    // Mount only: re-renders (and new data) don't replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After the intro: a session logged while Home is open switches on with the same flash, and a
  // goal it finishes gets its check pop. (The glow itself just appears with the new style.)
  const prevDone = useRef(null);
  useEffect(() => {
    const now = Object.fromEntries(rows.map((r) => [r.key, r.kind === 'blocks' ? litCount(r) : null]));
    const prev = prevDone.current;
    prevDone.current = now;
    if (!prev || introT !== null || prefersReducedMotion() || !rootRef.current) return;
    rows.forEach((r) => {
      if (r.kind !== 'blocks' || prev[r.key] == null || now[r.key] <= prev[r.key]) return;
      for (let i = prev[r.key]; i < now[r.key]; i++) {
        rootRef.current.querySelector(`[data-block="${r.key}-${i}"]`)?.animate?.([
          { backgroundColor: trackColor(r.color), boxShadow: NO_SHADOW },
          { backgroundColor: '#fff', boxShadow: '0 0 18px 3px rgba(255,255,255,.85)', offset: 0.35 },
          { backgroundColor: r.color, boxShadow: isMet(r) ? doneGlow(r.color) : NO_SHADOW },
        ], { duration: FLASH, easing: 'ease-out' });
      }
      if (isMet(r)) {
        rootRef.current.querySelector(`[data-check="${r.key}"]`)?.animate?.([{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1.3)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }], { duration: CHECK_POP, delay: BLOOM_AFTER, easing: 'ease-out', fill: 'backwards' });
      }
    });
  });

  const inIntro = introT !== null;
  // What the numbers read right now.
  const shownPercent = inIntro
    ? Math.round(percent * easeOutCubic(clamp01((introT - START) / (plan.wonAt - START))))
    : percent;
  const showWon = won && (!inIntro || introT >= plan.wonAt);
  const rowCount = (r) => {
    if (!inIntro) return r.done;
    const times = plan.blocks[r.key];
    if (!times) return r.done; // nothing to light (0 done): already reads its value
    const lit = times.filter((t) => introT >= t + 60).length;
    return lit >= times.length ? r.done : lit;
  };
  const stepsShown = (r) => (inIntro ? r.total * easeOutCubic(clamp01((introT - plan.stepsAt) / STEPS_RUN)) : r.total);

  const valueStyle = { fontSize: 30, fontWeight: 800, letterSpacing: '-0.8px', lineHeight: 0.9 };
  const subStyle = { fontSize: 16, fontWeight: 700, color: TEXT_FAINT, letterSpacing: '-0.2px', marginLeft: 1 };
  const pressIn = (e) => { e.currentTarget.style.transform = 'scale(0.98)'; };
  const pressOut = (e) => { e.currentTarget.style.transform = 'scale(1)'; };

  return (
    <div ref={rootRef}>
      {/* Header: the week's % and the days left */}
      <div className="flex items-end justify-between" style={{ marginBottom: 20, paddingBottom: 18, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div>
          <div
            data-week-number
            className="inline-block"
            style={{
              fontSize: 60, fontWeight: 800, letterSpacing: '-3px', lineHeight: 0.8,
              color: goldMix(shownPercent),
              textShadow: showWon ? WEEK_WON_GLOW : 'none',
              transformOrigin: 'left bottom',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {shownPercent}<span style={{ fontSize: 28, letterSpacing: '-1px', marginLeft: 3 }}>%</span>
          </div>
          <div className="uppercase" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', marginTop: 12, color: showWon ? 'rgba(255,215,0,0.92)' : TEXT_MUTED }}>
            {showWon ? 'Week won' : 'Week progress'}
          </div>
        </div>
        <div className="text-right uppercase" style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', color: TEXT_MUTED }}>
          <b className="block text-white normal-case" style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.8px', lineHeight: 1, marginBottom: 6 }}>{daysLeft}</b>
          {showWon
            ? (daysLeft === 1 ? 'day to spare' : 'days to spare')
            : (daysLeft === 1 ? 'day left' : 'days left')}
        </div>
      </div>

      {/* One row per goal, 22px apart. Tapping a row opens its breakdown right under it. */}
      <div className="flex flex-col" style={{ gap: 22 }}>
        {rows.map((r) => {
          const met = isMet(r);
          const rgbColor = r.color;
          return (
            <div key={r.key}>
            <button
              className="w-full block text-left transition-transform duration-150"
              onClick={r.onToggle}
              onTouchStart={(e) => { pressIn(e); triggerHaptic(ImpactStyle.Light); }}
              onTouchEnd={pressOut}
              onMouseDown={pressIn}
              onMouseUp={pressOut}
              onMouseLeave={pressOut}
            >
              <div className="flex items-end justify-between" style={{ marginBottom: 11 }}>
                <div className="flex items-center gap-2 min-w-0" style={{ fontSize: 15, fontWeight: 600, paddingBottom: 2 }}>
                  <CategoryIcon category={r.key} size={18} className="flex-shrink-0" />
                  <span>{r.label}</span>
                  {r.streak > 0 && (
                    <span style={{ fontSize: 12, fontWeight: 600, marginLeft: 3, color: r.paused ? r.paused.color : TEXT_MUTED }}>
                      {r.paused ? r.paused.emoji : '🔥'} {r.streak}w
                    </span>
                  )}
                  <span className="text-[9px]" style={{ color: '#555', marginLeft: 1 }}>{r.expanded ? '▲' : '▼'}</span>
                </div>
                <div className="flex items-baseline flex-shrink-0" style={{ ...valueStyle, fontVariantNumeric: 'tabular-nums' }}>
                  {r.kind === 'steps'
                    ? <><span>{r.formatK(stepsShown(r))}</span><span style={subStyle}>/{r.formatK(r.goal)}</span></>
                    : <><span>{rowCount(r)}</span><span style={subStyle}>/{r.goal}</span></>}
                  {met && <CheckBadge color={rgbColor} data-check={r.key} style={{ alignSelf: 'center', marginLeft: 8 }} />}
                </div>
              </div>

              {r.kind === 'blocks' ? (
                <div className="flex" style={{ gap: BAR.gap }}>
                  {Array.from({ length: Math.max(1, r.goal) }, (_, i) => {
                    const on = i < litCount(r);
                    return (
                      <i
                        key={i}
                        data-block={`${r.key}-${i}`}
                        className="flex-1 block"
                        style={{
                          height: BAR.height,
                          borderRadius: BAR.radius,
                          backgroundColor: on ? rgbColor : trackColor(rgbColor),
                          boxShadow: on && met ? doneGlow(rgbColor) : 'none',
                        }}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="relative" style={{ height: BAR.height, borderRadius: BAR.radius, backgroundColor: trackColor(rgbColor) }}>
                  <i
                    data-fill={r.key}
                    className="absolute left-0 top-0 bottom-0 block"
                    style={{
                      width: `${Math.min(100, r.goal > 0 ? (r.total / r.goal) * 100 : 0)}%`,
                      borderRadius: BAR.radius,
                      backgroundColor: rgbColor,
                      boxShadow: met ? doneGlow(rgbColor) : 'none',
                      transition: 'width 0.6s cubic-bezier(.2,.8,.2,1)',
                    }}
                  />
                  {/* Pace notch: where the daily goal × finished days would put the bar */}
                  {stepsOpen(r) && (
                    <b
                      data-notch={r.key}
                      className="absolute block"
                      style={{ top: -5, bottom: -5, width: 2, marginLeft: -1, left: `${(r.dayIndex / 7) * 100}%`, background: '#fff', borderRadius: 1, boxShadow: `0 0 0 2px ${CARD_BG_SOLID}` }}
                    />
                  )}
                </div>
              )}
            </button>
            {r.detail && <Collapse open={!!r.expanded}>{r.detail}</Collapse>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

