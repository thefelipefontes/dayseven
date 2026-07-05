import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { triggerHaptic, ImpactStyle } from './utils/haptics';
import { toLocalDateStr } from './utils/dateHelpers';

// ---------------------------------------------------------------------------
// Weekly Planner
// Users drag (or tap) cardio / strength / recovery "pills" — one per weekly
// goal session — onto the days they intend to train. Placed pills reconcile
// against logged activities so each planned session shows done vs. pending.
// The plan lives on the user doc as `weeklyPlan` (see handleSaveWeeklyPlan in
// App.jsx). Week starts Sunday to match the rest of the app.
// ---------------------------------------------------------------------------

const DAYS = [
  { key: 'sun', label: 'Sun' },
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
];

// Pill categories → weekly goal field + display. `match` lists the activity
// categories (from getActivityCategory) that satisfy a pill of this type.
// Emoji + colors mirror the app's goal rings (see the weekly rings in App.jsx).
const CATS = {
  strength: { label: 'Strength', color: '#00FF94', bg: 'rgba(0,255,148,0.14)', emoji: '💪', goalKey: 'liftsPerWeek' },
  cardio:   { label: 'Cardio',   color: '#FF9500', bg: 'rgba(255,149,0,0.14)', emoji: '❤️‍🔥', goalKey: 'cardioPerWeek' },
  recovery: { label: 'Recovery', color: '#00D1FF', bg: 'rgba(0,209,255,0.14)', emoji: '🧊', goalKey: 'recoveryPerWeek' },
};
const CAT_ORDER = ['strength', 'cardio', 'recovery'];

const emptyPlan = () => DAYS.reduce((acc, d) => { acc[d.key] = []; return acc; }, {});

// Ensure every day key exists and holds only known categories.
const normalizePlan = (raw) => {
  const out = emptyPlan();
  if (raw && typeof raw === 'object') {
    DAYS.forEach(d => {
      const arr = raw[d.key];
      if (Array.isArray(arr)) out[d.key] = arr.filter(c => CATS[c]);
    });
  }
  return out;
};

// Mirror of getActivityCategory in App.jsx, collapsed to strength/cardio/recovery.
const activityCat = (a) => {
  let c = a.countToward || a.customActivityCategory || '';
  if (!c) {
    if (a.type === 'Strength Training') c = 'lifting';
    else if (['Running', 'Cycle', 'Sports', 'Stair Climbing', 'Elliptical', 'Swimming', 'Rowing'].includes(a.type)) c = 'cardio';
    else if (['Cold Plunge', 'Sauna', 'Contrast Therapy', 'Massage', 'Chiropractic', 'Yoga', 'Pilates'].includes(a.type)) c = 'recovery';
    else c = 'other';
  }
  if (c === 'strength') c = 'lifting';
  return c; // 'lifting' | 'cardio' | 'recovery' | 'lifting+cardio' | 'other'
};

export default function WeeklyPlanner({ goals, activities = [], weeklyPlan, onSave }) {
  // --- Week boundaries (Sunday-based) ---------------------------------------
  const { weekKey, dayDates, todayKey, rangeLabel } = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    start.setHours(0, 0, 0, 0);
    const dates = DAYS.map((_, i) => {
      const dt = new Date(start);
      dt.setDate(start.getDate() + i);
      return toLocalDateStr(dt);
    });
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return {
      weekKey: toLocalDateStr(start),
      dayDates: dates,
      todayKey: DAYS[now.getDay()].key,
      rangeLabel: `${fmt(start)} – ${fmt(end)}`,
    };
  }, []);

  const goalCount = {
    strength: goals?.liftsPerWeek || 0,
    cardio: goals?.cardioPerWeek || 0,
    recovery: goals?.recoveryPerWeek || 0,
  };
  const totalGoal = goalCount.strength + goalCount.cardio + goalCount.recovery;

  // --- Plan state (initialised once from the saved plan) --------------------
  const [plan, setPlan] = useState(() => {
    const wp = weeklyPlan || {};
    if (wp.weeks && wp.weeks[weekKey]) return normalizePlan(wp.weeks[weekKey]);
    if (wp.repeatWeekly && wp.template) return normalizePlan(wp.template);
    return emptyPlan();
  });
  const [repeatWeekly, setRepeatWeekly] = useState(!!weeklyPlan?.repeatWeekly);

  // --- Persistence (debounced; skips the initial render) --------------------
  const firstRender = useRef(true);
  const saveTimer = useRef(null);
  const pendingSave = useRef(false);
  const latest = useRef({ plan, repeatWeekly });
  latest.current = { plan, repeatWeekly };

  const persist = useCallback(() => {
    pendingSave.current = false;
    if (!onSave) return;
    const { plan: p, repeatWeekly: r } = latest.current;
    onSave({
      repeatWeekly: r,
      template: r ? normalizePlan(p) : (weeklyPlan?.template || null),
      weeks: { [weekKey]: { ...normalizePlan(p), confirmedAt: new Date().toISOString() } },
    });
  }, [onSave, weekKey, weeklyPlan?.template]);

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    pendingSave.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persist, 700);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [plan, repeatWeekly, persist]);

  // Flush a still-pending debounced save on unmount, so a quick Continue (in
  // onboarding) or tab switch (on Home) right after a drag doesn't drop the
  // last edit. Only fires when there's an unsaved change — no spurious writes.
  useEffect(() => () => {
    if (pendingSave.current) {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      persist();
    }
  }, [persist]);

  // --- Reconciliation: logged sessions per day, per category ----------------
  const loggedByDay = useMemo(() => {
    const map = {};
    DAYS.forEach(d => { map[d.key] = { strength: 0, cardio: 0, recovery: 0 }; });
    (activities || []).forEach(a => {
      if (!a.date) return;
      const idx = dayDates.indexOf(a.date);
      if (idx < 0) return;
      const c = activityCat(a);
      const day = map[DAYS[idx].key];
      if (c === 'lifting' || c === 'lifting+cardio') day.strength++;
      if (c === 'cardio' || c === 'lifting+cardio') day.cardio++;
      if (c === 'recovery') day.recovery++;
    });
    return map;
  }, [activities, dayDates]);

  // Placed counts + unplaced (tray) pills per category.
  const placedByCat = { strength: 0, cardio: 0, recovery: 0 };
  DAYS.forEach(d => plan[d.key].forEach(c => { placedByCat[c]++; }));
  const trayPills = CAT_ORDER.flatMap(cat => {
    const remaining = Math.max(0, goalCount[cat] - placedByCat[cat]);
    return Array.from({ length: remaining }, () => cat);
  });

  // --- Drag + tap interaction ----------------------------------------------
  const zonesRef = useRef({});          // dropzone key -> element
  const dragRef = useRef(null);         // active drag descriptor
  const justDragged = useRef(false);    // swallow the click synthesised after a drag
  const cardRef = useRef(null);         // root element, for locating the scroller
  const scrollLock = useRef(null);      // saved scroller styles while dragging
  const [ghost, setGhost] = useState(null);   // { cat, x, y }
  const [hoverKey, setHoverKey] = useState(null);
  const [selected, setSelected] = useState(null); // tap-to-move { cat, from }

  const registerZone = (key) => (el) => {
    if (el) zonesRef.current[key] = el;
    else delete zonesRef.current[key];
  };

  const movePill = useCallback((cat, from, to) => {
    if (from === to) return;
    setPlan(prev => {
      const next = { ...prev };
      if (from !== 'tray') {
        const arr = [...next[from]];
        const i = arr.indexOf(cat);
        if (i >= 0) arr.splice(i, 1);
        next[from] = arr;
      }
      if (to !== 'tray') next[to] = [...next[to], cat];
      return next;
    });
    triggerHaptic(ImpactStyle.Light);
  }, []);

  const hitTest = (x, y) => {
    const zones = zonesRef.current;
    for (const key of Object.keys(zones)) {
      const r = zones[key].getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return key;
    }
    return null;
  };

  // Freeze the page's scroll container for the duration of a drag. This is the
  // guarantee that the page can't slide (works regardless of pointer-event
  // quirks) — we find the nearest scrollable ancestor and pin its overflow.
  const lockPageScroll = () => {
    if (scrollLock.current) return;
    let n = cardRef.current;
    while (n) {
      const s = window.getComputedStyle(n);
      if (/(auto|scroll|overlay)/.test(s.overflowY) && n.scrollHeight > n.clientHeight) break;
      n = n.parentElement;
    }
    if (!n) return;
    scrollLock.current = { el: n, overflow: n.style.overflow, touchAction: n.style.touchAction };
    n.style.overflow = 'hidden';
    n.style.touchAction = 'none';
  };
  const unlockPageScroll = () => {
    const l = scrollLock.current;
    if (!l) return;
    l.el.style.overflow = l.overflow;
    l.el.style.touchAction = l.touchAction;
    scrollLock.current = null;
  };

  const onPointerMove = useCallback((e) => {
    const st = dragRef.current;
    if (!st) return;
    // Block the page's native scroll the instant a pill touch moves, so the
    // page can't slide out from under the drag on iOS. Must happen before the
    // threshold check — otherwise the first few px start a native scroll that
    // can no longer be cancelled.
    if (e.cancelable) e.preventDefault();
    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;
    if (!st.active) {
      if (Math.hypot(dx, dy) < 6) return;
      st.active = true;
      lockPageScroll();
      triggerHaptic(ImpactStyle.Light);
    }
    st.target = hitTest(e.clientX, e.clientY);
    setGhost({ cat: st.cat, x: e.clientX, y: e.clientY });
    setHoverKey(st.target);
  }, []);

  const endDrag = useCallback(() => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
    unlockPageScroll();
    const st = dragRef.current;
    dragRef.current = null;
    setGhost(null);
    setHoverKey(null);
    if (!st) return;
    if (st.active) {
      justDragged.current = true;
      if (st.target && st.target !== st.from) movePill(st.cat, st.from, st.target);
    }
  }, [onPointerMove, movePill]);

  const onPillPointerDown = (e, cat, from) => {
    if (e.button && e.button !== 0) return;
    // NB: intentionally NOT calling setPointerCapture — on iOS it suppresses the
    // synthesised click that tap-to-place relies on. Drag tracking uses
    // window-level pointer listeners + coordinate hit-testing, so capture isn't
    // needed. justDragged is reset here so a fresh tap is never eaten by a stale
    // flag left over from a previous drag that fired no trailing click.
    justDragged.current = false;
    dragRef.current = { cat, from, startX: e.clientX, startY: e.clientY, active: false, target: null };
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
  };

  useEffect(() => () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
  }, [onPointerMove, endDrag]);

  // iOS WKWebView ignores preventDefault on pointer events for native scroll,
  // so block the underlying touchmove directly — capture phase + non-passive —
  // for the whole gesture once a pill is grabbed. This is what actually keeps
  // the page from scrolling out from under the drag.
  useEffect(() => {
    const block = (e) => { if (dragRef.current && e.cancelable) e.preventDefault(); };
    document.addEventListener('touchmove', block, { passive: false, capture: true });
    return () => document.removeEventListener('touchmove', block, { capture: true });
  }, []);

  // Tap fallback: tap a pill to pick it up, tap a day (or the tray) to drop it.
  const onPillClick = (cat, from) => {
    if (justDragged.current) { justDragged.current = false; return; }
    setSelected(prev => (prev && prev.cat === cat && prev.from === from) ? null : { cat, from });
  };
  const onZoneClick = (key) => {
    if (justDragged.current) { justDragged.current = false; return; }
    setSelected(prev => {
      if (prev && key !== prev.from) movePill(prev.cat, prev.from, key);
      return null;
    });
  };

  if (totalGoal === 0) return null; // no standards set yet

  const isSelected = (cat, from) => selected && selected.cat === cat && selected.from === from;

  const Pill = ({ cat, from, done = false }) => {
    const c = CATS[cat];
    const sel = isSelected(cat, from);
    return (
      <button
        onPointerDown={(e) => onPillPointerDown(e, cat, from)}
        onClick={(e) => { e.stopPropagation(); onPillClick(cat, from); }}
        className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold transition-transform active:scale-95 select-none"
        style={{
          touchAction: 'none',
          color: done ? '#0A0A0A' : c.color,
          backgroundColor: done ? c.color : c.bg,
          border: `1px solid ${sel ? c.color : (done ? c.color : 'transparent')}`,
          boxShadow: sel ? `0 0 0 2px ${c.bg}` : 'none',
          opacity: done ? 0.92 : 1,
        }}
      >
        <span style={{ fontSize: 11 }}>{done ? '✓' : c.emoji}</span>
        {c.label}
      </button>
    );
  };

  return (
    <div className="px-4 mb-4" ref={cardRef}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg">🗓️</span>
            <span className="text-[20px] font-semibold text-white" style={{ letterSpacing: '-0.3px' }}>This Week's Plan</span>
          </div>
          <p className="text-[13px] -mt-1 pl-[30px]" style={{ color: '#777' }}>{rangeLabel}</p>
        </div>
        <button
          onClick={() => { triggerHaptic(ImpactStyle.Light); setRepeatWeekly(v => !v); }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full transition-all active:scale-95"
          style={{
            backgroundColor: repeatWeekly ? 'rgba(48,209,88,0.12)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${repeatWeekly ? 'rgba(48,209,88,0.4)' : 'rgba(255,255,255,0.1)'}`,
          }}
        >
          <span className="text-[11px] font-semibold" style={{ color: repeatWeekly ? '#30D158' : '#999' }}>
            {repeatWeekly ? '✓ Repeats weekly' : 'Repeat weekly'}
          </span>
        </button>
      </div>

      <div className="p-4 rounded-2xl" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
        {/* Tray of unplaced pills */}
        <div
          ref={registerZone('tray')}
          onClick={() => onZoneClick('tray')}
          className="flex flex-wrap gap-2 pb-3 mb-3 border-b transition-colors"
          style={{
            borderColor: 'rgba(255,255,255,0.08)',
            minHeight: 44,
            backgroundColor: hoverKey === 'tray' ? 'rgba(255,255,255,0.04)' : 'transparent',
            borderRadius: hoverKey === 'tray' ? 12 : 0,
          }}
        >
          {trayPills.length === 0 ? (
            <div className="flex items-center gap-1.5 text-[12px]" style={{ color: '#30D158' }}>
              <span>✓</span> All {totalGoal} sessions placed{selected ? ' · tap a day to move' : ''}
            </div>
          ) : (
            <>
              <span className="w-full text-[11px] mb-0.5" style={{ color: '#777' }}>
                Drag onto a day{selected ? ' · or tap a day' : ''}
              </span>
              {trayPills.map((cat, i) => (
                <Pill key={`tray-${cat}-${i}`} cat={cat} from="tray" />
              ))}
            </>
          )}
        </div>

        {/* Day rows */}
        <div className="space-y-1.5">
          {DAYS.map(d => {
            const dayPills = plan[d.key];
            const logged = loggedByDay[d.key];
            const isToday = d.key === todayKey;
            // How many placed pills of each cat are satisfied by logged activity.
            const usedDone = { strength: 0, cardio: 0, recovery: 0 };
            return (
              <div
                key={d.key}
                ref={registerZone(d.key)}
                onClick={() => onZoneClick(d.key)}
                className="flex items-start gap-3 rounded-xl px-2.5 py-2 transition-colors"
                style={{
                  minHeight: 46,
                  backgroundColor: hoverKey === d.key
                    ? 'rgba(255,255,255,0.07)'
                    : isToday ? 'rgba(255,255,255,0.04)' : 'transparent',
                  border: `1px solid ${hoverKey === d.key ? 'rgba(255,255,255,0.2)' : isToday ? 'rgba(255,255,255,0.08)' : 'transparent'}`,
                }}
              >
                <div className="w-10 shrink-0 pt-1">
                  <div className="text-[13px] font-semibold" style={{ color: isToday ? '#fff' : '#999' }}>{d.label}</div>
                  {isToday && <div className="text-[9px] font-bold" style={{ color: '#0A84FF' }}>TODAY</div>}
                </div>
                <div className="flex-1 flex flex-wrap gap-1.5 items-center min-h-[28px]">
                  {dayPills.length === 0 ? (
                    <span className="text-[12px]" style={{ color: '#555' }}>Rest day</span>
                  ) : (
                    dayPills.map((cat, i) => {
                      const done = usedDone[cat] < logged[cat];
                      if (done) usedDone[cat]++;
                      return <Pill key={`${d.key}-${cat}-${i}`} cat={cat} from={d.key} done={done} />;
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Drag ghost */}
      {ghost && (() => {
        const c = CATS[ghost.cat];
        return (
          <div
            className="fixed z-[100] pointer-events-none inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold"
            style={{
              left: ghost.x, top: ghost.y,
              transform: 'translate(-50%, -50%) scale(1.08)',
              color: c.color, backgroundColor: c.bg,
              border: `1px solid ${c.color}`,
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            }}
          >
            <span style={{ fontSize: 11 }}>{c.emoji}</span>{c.label}
          </div>
        );
      })()}
    </div>
  );
}
