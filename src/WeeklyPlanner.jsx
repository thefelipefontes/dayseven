import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { triggerHaptic, ImpactStyle } from './utils/haptics';
import { toLocalDateStr } from './utils/dateHelpers';

// ---------------------------------------------------------------------------
// Weekly Planner
// Users drag (or tap) cardio / strength / recovery "pills" — one per weekly
// goal session — onto the days they intend to train, and optionally tap a
// placed pill to give it a specific type (e.g. Cardio → Run). Placed pills
// reconcile against logged activities so each planned session shows done vs.
// pending. The plan lives on the user doc as `weeklyPlan` (see
// handleSaveWeeklyPlan in App.jsx). Week starts Sunday to match the app.
//
// A pill is stored as { cat, type } where type is optional (null = generic).
// Legacy plans stored pills as bare category strings; normalizePill upgrades
// those transparently.
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

// Pill categories → weekly goal field + display.
// Emoji + colors mirror the app's goal rings (see the weekly rings in App.jsx).
const CATS = {
  strength: { label: 'Strength', color: '#00FF94', bg: 'rgba(0,255,148,0.14)', emoji: '💪', goalKey: 'liftsPerWeek' },
  cardio:   { label: 'Cardio',   color: '#FF9500', bg: 'rgba(255,149,0,0.14)', emoji: '❤️‍🔥', goalKey: 'cardioPerWeek' },
  recovery: { label: 'Recovery', color: '#00D1FF', bg: 'rgba(0,209,255,0.14)', emoji: '🧊', goalKey: 'recoveryPerWeek' },
};
const CAT_ORDER = ['strength', 'cardio', 'recovery'];

// Specific types a pill can carry, per category. Values match how the app
// names activities so a planned type lines up with what gets logged.
const TYPE_OPTIONS = {
  strength: ['Full Body', 'Upper', 'Lower', 'Push', 'Pull', 'Core'],
  cardio: ['Running', 'Cycling', 'Swimming', 'Rowing', 'Walking', 'Stair Climbing', 'Elliptical', 'Sports'],
  recovery: ['Yoga', 'Pilates', 'Cold Plunge', 'Sauna', 'Contrast Therapy', 'Massage'],
};
// Shorter labels for the chip itself (the picker shows the full name).
const TYPE_SHORT = {
  Running: 'Run', Cycling: 'Bike', Swimming: 'Swim', Rowing: 'Row',
  Walking: 'Walk', 'Stair Climbing': 'Stairs', Sports: 'Sport',
  'Contrast Therapy': 'Contrast',
};
const chipLabel = (pill) => pill.type ? (TYPE_SHORT[pill.type] || pill.type) : CATS[pill.cat].label;

const emptyPlan = () => DAYS.reduce((acc, d) => { acc[d.key] = []; return acc; }, {});

// Upgrade a stored entry (bare string OR {cat,type}) to a normalized pill,
// dropping unknown categories/types. Returns null if unusable.
const normalizePill = (raw) => {
  if (typeof raw === 'string') return CATS[raw] ? { cat: raw, type: null } : null;
  if (raw && typeof raw === 'object' && CATS[raw.cat]) {
    const type = raw.type && TYPE_OPTIONS[raw.cat]?.includes(raw.type) ? raw.type : null;
    return { cat: raw.cat, type };
  }
  return null;
};

const normalizePlan = (raw) => {
  const out = emptyPlan();
  if (raw && typeof raw === 'object') {
    DAYS.forEach(d => {
      const arr = raw[d.key];
      if (Array.isArray(arr)) out[d.key] = arr.map(normalizePill).filter(Boolean);
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

  // persist is stored in a ref and refreshed every render so the debounce
  // effect can depend ONLY on [plan, repeatWeekly] — never on onSave/weeklyPlan
  // identity. Depending on those created a save↔re-render feedback loop that
  // wrote to Firestore every 700ms and thrashed the whole app.
  const persistRef = useRef(null);
  persistRef.current = () => {
    pendingSave.current = false;
    if (!onSave) return;
    const { plan: p, repeatWeekly: r } = latest.current;
    onSave({
      repeatWeekly: r,
      template: r ? normalizePlan(p) : (weeklyPlan?.template || null),
      weeks: { [weekKey]: { ...normalizePlan(p), confirmedAt: new Date().toISOString() } },
    });
  };

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    pendingSave.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persistRef.current?.(), 700);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [plan, repeatWeekly]);

  // Flush a still-pending debounced save on unmount, so a quick Continue (in
  // onboarding) or tab switch (on Home) right after a drag doesn't drop the
  // last edit. Only fires when there's an unsaved change — no spurious writes.
  useEffect(() => () => {
    if (pendingSave.current) {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      persistRef.current?.();
    }
  }, []);

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
  DAYS.forEach(d => plan[d.key].forEach(p => { placedByCat[p.cat]++; }));
  const trayPills = CAT_ORDER.flatMap(cat => {
    const remaining = Math.max(0, goalCount[cat] - placedByCat[cat]);
    return Array.from({ length: remaining }, () => ({ cat, type: null }));
  });

  // --- Drag + tap interaction ----------------------------------------------
  const zonesRef = useRef({});          // dropzone key -> element
  const dragRef = useRef(null);         // active drag descriptor
  const justDragged = useRef(false);    // swallow the click synthesised after a drag
  const cardRef = useRef(null);         // root element, for locating the scroller
  const scrollLock = useRef(null);      // saved scroller styles while dragging
  const [ghost, setGhost] = useState(null);   // { pill, x, y }
  const [hoverKey, setHoverKey] = useState(null);
  const [selected, setSelected] = useState(null); // tap-to-place a tray pill { cat }
  const [picker, setPicker] = useState(null);      // type picker { day, index, cat }

  const registerZone = (key) => (el) => {
    if (el) zonesRef.current[key] = el;
    else delete zonesRef.current[key];
  };

  // Move a pill between the tray and days. Day→day preserves the exact pill
  // (and its type); tray→day always creates a fresh generic pill.
  const movePill = useCallback((pill, from, fromIndex, to) => {
    if (from === to) return;
    setPlan(prev => {
      const next = { ...prev };
      let moving = { cat: pill.cat, type: pill.type ?? null };
      if (from !== 'tray') {
        const arr = [...next[from]];
        const removed = arr.splice(fromIndex, 1)[0];
        if (removed) moving = removed;
        next[from] = arr;
      } else {
        moving = { cat: pill.cat, type: null };
      }
      if (to !== 'tray') next[to] = [...next[to], moving];
      return next;
    });
    triggerHaptic(ImpactStyle.Light);
  }, []);

  const setPillType = (day, index, type) => {
    setPlan(prev => {
      const arr = [...(prev[day] || [])];
      if (!arr[index]) return prev;
      arr[index] = { ...arr[index], type };
      return { ...prev, [day]: arr };
    });
    triggerHaptic(ImpactStyle.Light);
  };

  const hitTest = (x, y) => {
    const zones = zonesRef.current;
    for (const key of Object.keys(zones)) {
      const r = zones[key].getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return key;
    }
    return null;
  };

  // Freeze the page's scroll container for the duration of a drag so the page
  // can't slide out from under it (pins the nearest scrollable ancestor).
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
    setGhost({ pill: st.pill, x: e.clientX, y: e.clientY });
    setHoverKey(st.target);
  }, []);

  // iOS WKWebView ignores preventDefault on pointer events for native scroll,
  // so we cancel the underlying touchmove directly while a pill is grabbed.
  // Attached ONLY for the duration of a drag (see onPillPointerDown / endDrag)
  // — leaving a global non-passive touch listener attached at rest makes WebKit
  // gate every tap on it, which broke first-tap navigation elsewhere.
  const blockTouchMove = useCallback((e) => {
    if (dragRef.current && e.cancelable) e.preventDefault();
  }, []);

  // All drag handlers are memoized with stable deps (onPointerMove/movePill/
  // blockTouchMove never change identity), so the exact same function refs are
  // used for add and remove — no ref bookkeeping needed.
  const endDrag = useCallback(() => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
    document.removeEventListener('touchmove', blockTouchMove, { capture: true });
    unlockPageScroll();
    const st = dragRef.current;
    dragRef.current = null;
    setGhost(null);
    setHoverKey(null);
    if (!st) return;
    if (st.active) {
      justDragged.current = true;
      if (st.target && st.target !== st.from) movePill(st.pill, st.from, st.fromIndex, st.target);
    }
  }, [onPointerMove, blockTouchMove, movePill]);

  const onPillPointerDown = (e, pill, from, index) => {
    if (e.button && e.button !== 0) return;
    // No setPointerCapture — on iOS it suppresses the click tap-to-place relies on.
    justDragged.current = false;
    dragRef.current = { pill, from, fromIndex: index, startX: e.clientX, startY: e.clientY, active: false, target: null };
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    document.addEventListener('touchmove', blockTouchMove, { passive: false, capture: true });
  };

  // Safety net: if the component unmounts mid-drag, tear everything down and
  // release the scroll lock so nothing leaks into the rest of the app.
  useEffect(() => () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
    document.removeEventListener('touchmove', blockTouchMove, { capture: true });
    unlockPageScroll();
  }, [onPointerMove, endDrag, blockTouchMove]);

  // Tap: a tray pill selects itself (then tap a day to place it); a placed pill
  // opens the type picker. Placed pills are moved by dragging.
  const onPillClick = (pill, from, index) => {
    if (justDragged.current) { justDragged.current = false; return; }
    if (from === 'tray') {
      setSelected(prev => (prev && prev.cat === pill.cat) ? null : { cat: pill.cat });
    } else {
      setSelected(null);
      setPicker({ day: from, index, cat: pill.cat });
    }
  };
  const onZoneClick = (key) => {
    if (justDragged.current) { justDragged.current = false; return; }
    setSelected(prev => {
      if (prev && key !== 'tray') movePill({ cat: prev.cat, type: null }, 'tray', -1, key);
      return null;
    });
  };

  if (totalGoal === 0) return null; // no standards set yet

  const Pill = ({ pill, from, index, done = false }) => {
    const c = CATS[pill.cat];
    const sel = from === 'tray' && selected && selected.cat === pill.cat;
    return (
      <button
        onPointerDown={(e) => onPillPointerDown(e, pill, from, index)}
        onClick={(e) => { e.stopPropagation(); onPillClick(pill, from, index); }}
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
        {chipLabel(pill)}
      </button>
    );
  };

  const pickerType = picker ? (plan[picker.day]?.[picker.index]?.type ?? null) : null;

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
              <span>✓</span> All {totalGoal} sessions placed{selected ? ' · tap a day to move' : ' · tap one to set its type'}
            </div>
          ) : (
            <>
              <span className="w-full text-[11px] mb-0.5" style={{ color: '#777' }}>
                Drag onto a day{selected ? ' · or tap a day' : ''}
              </span>
              {trayPills.map((pill, i) => (
                <Pill key={`tray-${pill.cat}-${i}`} pill={pill} from="tray" index={i} />
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
                    dayPills.map((pill, i) => {
                      const done = usedDone[pill.cat] < logged[pill.cat];
                      if (done) usedDone[pill.cat]++;
                      return <Pill key={`${d.key}-${i}`} pill={pill} from={d.key} index={i} done={done} />;
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
        const c = CATS[ghost.pill.cat];
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
            <span style={{ fontSize: 11 }}>{c.emoji}</span>{chipLabel(ghost.pill)}
          </div>
        );
      })()}

      {/* Type picker sheet */}
      {picker && (() => {
        const c = CATS[picker.cat];
        const opts = [null, ...TYPE_OPTIONS[picker.cat]];
        return (
          <div
            className="fixed inset-0 z-[110] flex items-end"
            style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
            onClick={() => setPicker(null)}
          >
            <div
              className="w-full rounded-t-2xl p-4"
              style={{ backgroundColor: '#161616', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 mb-3">
                <span style={{ fontSize: 15 }}>{c.emoji}</span>
                <span className="text-white font-semibold text-[15px]">Pick a {c.label.toLowerCase()} type</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {opts.map((t) => {
                  const active = pickerType === t;
                  const label = t == null ? 'Any' : t;
                  return (
                    <button
                      key={label}
                      onClick={() => { setPillType(picker.day, picker.index, t); setPicker(null); }}
                      className="px-3 py-2 rounded-full text-[13px] font-semibold transition-transform active:scale-95"
                      style={{
                        color: active ? '#0A0A0A' : c.color,
                        backgroundColor: active ? c.color : c.bg,
                        border: `1px solid ${active ? c.color : 'transparent'}`,
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
