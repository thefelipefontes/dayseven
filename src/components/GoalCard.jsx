import React from 'react';
import CategoryIcon from './CategoryIcon';
import { CheckBadge } from './WeekGoalsHero';
import { CATEGORY_COLORS, GOLD, WEEK_WON_GLOW, TEXT_MUTED, NUM, goldMix, trackColor, doneGlow } from '../utils/designTokens';

// Static pieces of Home's goals card (components/WeekGoalsHero), for places that show a
// week rather than live data: onboarding and the lock screen. Same shapes and colours as
// Home, no animation and no taps. Number sizes come from designTokens NUM ("One big number"):
//   - WeekHead: the week % as the screen's one big number (NUM.big, or NUM.bigCompact where
//     space is short), with a caps label, and a text-size number + label on the right
//   - GoalRows: Home's rows, values at text size (NUM.value)
//   - GoalRowsMini: one line per goal (name, blocks, number), where space is short
//
// A row is { key: 'lifts' | 'cardio' | 'steps', done, goal }. Steps are counted in steps.

const LABEL = { lifts: 'Strength', cardio: 'Cardio', steps: 'Steps' };
const fk = (n) => `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
const fmt = (key, n) => (key === 'steps' ? fk(n) : String(n));
const isMet = (r) => r.goal > 0 && r.done >= r.goal;

export function WeekHead({ pct, won = false, right, rightLabel, compact = false, label = 'Week progress', mb = 18, pb = 16 }) {
  const big = compact ? NUM.bigCompact : NUM.big;
  const bigSmall = compact ? NUM.bigCompactSmall : NUM.bigSmall;
  return (
    <div className="flex items-end justify-between" style={{ marginBottom: mb, paddingBottom: pb, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
      <div>
        <div
          className="flex items-baseline"
          style={{
            ...big, lineHeight: 0.8,
            color: won ? GOLD : goldMix(pct), textShadow: won ? WEEK_WON_GLOW : 'none', fontVariantNumeric: 'tabular-nums',
          }}
        >
          {Math.round(pct)}<span style={bigSmall}>%</span>
        </div>
        <div className="uppercase" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', marginTop: 12, color: won ? 'rgba(255,215,0,0.9)' : TEXT_MUTED }}>
          {won ? 'Week won' : label}
        </div>
      </div>
      <div className="text-right uppercase" style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', color: TEXT_MUTED }}>
        <b className="block text-white normal-case" style={{ ...NUM.value, marginBottom: 6 }}>{right}</b>
        {rightLabel}
      </div>
    </div>
  );
}

// One block per session (Strength, Cardio) or one bar (Steps), on the goal's tinted track.
// A finished goal glows.
export function GoalTrack({ row, h = 12, gap = 6 }) {
  const col = CATEGORY_COLORS[row.key];
  const met = isMet(row);
  const glow = met ? doneGlow(col) : 'none';
  if (row.key === 'steps') {
    const p = row.goal > 0 ? Math.min(100, (row.done / row.goal) * 100) : 0;
    return (
      <div className="relative" style={{ height: h, borderRadius: h / 2, backgroundColor: trackColor(col) }}>
        {p > 0 && <i className="absolute left-0 top-0 bottom-0 block" style={{ width: `${p}%`, borderRadius: h / 2, backgroundColor: col, boxShadow: glow }} />}
      </div>
    );
  }
  return (
    <div className="flex" style={{ gap }}>
      {Array.from({ length: Math.max(1, row.goal) }, (_, i) => (
        <i key={i} className="flex-1 block" style={{ height: h, borderRadius: h / 2, backgroundColor: i < row.done ? col : trackColor(col), boxShadow: glow }} />
      ))}
    </div>
  );
}

// Home's row spacing ("One big number"): 15px labels, 18px icons, 10px to the bar, 20px apart.
const ROW = { lab: 15, ic: 18, mb: 10, gap: 20 };

// goalOnly: nothing done yet, the value reads "3 a week". caption(row): a line under the bar.
export function GoalRows({ rows, goalOnly = false, caption }) {
  const z = ROW;
  return (
    <div className="flex flex-col" style={{ gap: z.gap }}>
      {rows.map((r) => {
        const row = goalOnly ? { ...r, done: 0 } : r;
        const met = !goalOnly && isMet(row);
        const cap = caption && caption(row);
        return (
          <div key={r.key}>
            <div className="flex items-end justify-between" style={{ marginBottom: z.mb }}>
              <span className="flex items-center gap-2 font-semibold" style={{ fontSize: z.lab, lineHeight: 1.2, paddingBottom: 2 }}>
                <CategoryIcon category={r.key} size={z.ic} />{LABEL[r.key]}
              </span>
              <span className="flex items-baseline" style={{ ...NUM.value, fontVariantNumeric: 'tabular-nums' }}>
                {goalOnly ? (
                  <>{fmt(r.key, r.goal)}<small style={{ ...NUM.valueSmall, marginLeft: 5 }}>a week</small></>
                ) : (
                  <>{fmt(r.key, row.done)}<small style={{ ...NUM.valueSmall, marginLeft: 1 }}>/{fmt(r.key, r.goal)}</small></>
                )}
                {met && <CheckBadge color={CATEGORY_COLORS[r.key]} style={{ alignSelf: 'center', marginLeft: 8 }} />}
              </span>
            </div>
            <GoalTrack row={row} />
            {cap && <div className="text-[13px]" style={{ color: '#9ca3af', marginTop: 9 }}>{cap}</div>}
          </div>
        );
      })}
    </div>
  );
}

// One line per goal: a 98px name column, 10px blocks with 5px gaps, the number on the right.
export function GoalRowsMini({ rows, goalOnly = false }) {
  return (
    <div className="flex flex-col" style={{ gap: 14 }}>
      {rows.map((r) => {
        const row = goalOnly ? { ...r, done: 0 } : r;
        return (
          <div key={r.key} className="flex items-center" style={{ gap: 12 }}>
            <span className="flex items-center flex-shrink-0 font-semibold" style={{ width: 98, gap: 7, fontSize: 13.5, lineHeight: 1.2 }}>
              <CategoryIcon category={r.key} size={15} />{LABEL[r.key]}
            </span>
            <div className="flex-1"><GoalTrack row={row} h={10} gap={5} /></div>
            <span className="text-right" style={{ minWidth: 62, ...NUM.mini, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>
              {goalOnly ? fmt(r.key, r.goal) : fmt(r.key, row.done)}
              <small style={NUM.miniSmall}>{goalOnly ? ' /wk' : `/${fmt(r.key, r.goal)}`}</small>
            </span>
          </div>
        );
      })}
    </div>
  );
}
