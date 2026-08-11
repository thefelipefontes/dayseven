import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { triggerHaptic, ImpactStyle } from './utils/haptics';
import { toLocalDateStr } from './utils/dateHelpers';
import { getActivityCategory } from './utils/activityCategory';

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

// Map a strength split to the muscle groups the log form prefills.
const STRENGTH_FOCUS = {
  'Full Body': ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Quads', 'Hamstrings', 'Glutes', 'Adductors', 'Calves', 'Abs'],
  Upper: ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps'],
  Lower: ['Quads', 'Hamstrings', 'Glutes', 'Adductors', 'Calves'],
  Push: ['Chest', 'Shoulders', 'Triceps'],
  Pull: ['Back', 'Biceps'],
  Core: ['Abs'],
};
// Cardio pill type → the app's activity type name (e.g. Cycling → 'Cycle').
const CARDIO_ACTIVITY_TYPE = {
  Running: 'Running', Cycling: 'Cycle', Swimming: 'Swimming', Rowing: 'Rowing',
  Walking: 'Walking', 'Stair Climbing': 'Stair Climbing', Elliptical: 'Elliptical', Sports: 'Sports',
};

// Build a pre-filled activity (for the add-activity modal) from a planned pill,
// so logging it satisfies that day's planned session. Generic pills fall back
// to a sensible default type the user can change in the modal.
const pillToActivity = (pill, date) => {
  const base = { date };
  if (pill.cat === 'strength') {
    return { ...base, type: 'Strength Training', strengthType: 'Weightlifting', countToward: 'lifting', focusAreas: pill.type ? (STRENGTH_FOCUS[pill.type] || []) : [] };
  }
  if (pill.cat === 'cardio') {
    return { ...base, type: pill.type ? (CARDIO_ACTIVITY_TYPE[pill.type] || 'Running') : 'Running', countToward: 'cardio' };
  }
  return { ...base, type: pill.type || 'Yoga', countToward: 'recovery' };
};

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

// Compare two normalized plans day-by-day. Drives the "this week differs from your
// repeating plan" prompt, so it must ignore key order and pill object identity.
const plansEqual = (a, b) => DAYS.every(d => {
  const x = a?.[d.key] || [], y = b?.[d.key] || [];
  return x.length === y.length
    && x.every((p, i) => p.cat === y[i].cat && (p.type || null) === (y[i].type || null));
});

// 'lifting' | 'cardio' | 'recovery' | 'lifting+cardio' | 'other'
const activityCat = getActivityCategory;

// `planLoaded` tells us the saved plan has been resolved (loaded, or confirmed absent).
// Defaults to true for callers that hand us a plan synchronously — e.g. Onboarding, which
// passes a seed built on mount. Home passes it explicitly, because there `userData.weeklyPlan`
// is undefined until the profile fetch lands while the planner is already on screen and
// interactive. Saving in that window used to write `repeatWeekly: false` + `template: null`
// and permanently wipe the user's recurring plan.
export default function WeeklyPlanner({ goals, activities = [], weeklyPlan, onSave, onLogActivity, planLoaded = true }) {
  // --- Week boundaries (Sunday-based) ---------------------------------------
  // Recomputed on a clock tick, not frozen at mount: phones sit open across
  // midnight, and nothing remounts this component (the foreground resync in
  // App.jsx only refreshes data). A stale weekKey meant edits after a Sat→Sun
  // rollover were written into the *previous* week's entry and, with repeat on,
  // rebuilt the template from a week that had already ended.
  const computeWeek = () => {
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
  };
  const [week, setWeek] = useState(computeWeek);
  const { weekKey, dayDates, todayKey, rangeLabel } = week;

  // Re-check the calendar on an interval and whenever the app returns to the
  // foreground (iOS throttles timers in the background, so the tick alone can't
  // be trusted to fire). setWeek only swaps state when the day actually changed,
  // so this is a no-op on every check but one.
  useEffect(() => {
    const check = () => setWeek(prev => {
      const next = computeWeek();
      return next.weekKey === prev.weekKey && next.todayKey === prev.todayKey ? prev : next;
    });
    const id = setInterval(check, 60000);
    document.addEventListener('visibilitychange', check);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', check); };
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
  const userEdited = useRef(false);  // true once the user drags/taps/toggles
  const adopted = useRef(false);     // true once we've synced the loaded plan in
  // Edits made before the saved plan arrived were made against a blank placeholder, not
  // the user's real plan — they must not latch userEdited (which would permanently block
  // adoption) and must not be persisted. markEdited() is the single gate for both.
  const planLoadedRef = useRef(planLoaded);
  planLoadedRef.current = planLoaded;
  const markEdited = () => { if (planLoadedRef.current) userEdited.current = true; };
  const latest = useRef({ plan, repeatWeekly });
  latest.current = { plan, repeatWeekly };

  // True when repeat is on and this week has been changed away from the saved
  // template — the only case where the "update my repeating plan" offer makes sense.
  const savedTemplate = weeklyPlan?.template ? normalizePlan(weeklyPlan.template) : null;
  const divergesFromTemplate = repeatWeekly && !!savedTemplate && !plansEqual(plan, savedTemplate);

  // Push this week's plan into the recurring template. Bumping planRevision (rather
  // than touching `plan`) gives the debounced save effect a dep change to react to,
  // so promoting re-persists without faking an edit to the plan itself.
  const [planRevision, setPlanRevision] = useState(0);
  const promoteThisWeek = () => {
    triggerHaptic(ImpactStyle.Light);
    markEdited();
    promoteToTemplate.current = true;
    setPlanRevision(n => n + 1);
  };

  // Editing the plan changes THIS WEEK only. The recurring template is rewritten
  // solely when the user says so — by switching repeat on (that plan is what they're
  // choosing to repeat) or by tapping "Update repeating plan". Previously every edit
  // rewrote the template, so clearing a day for one travel week silently deleted it
  // from every future week.
  const promoteToTemplate = useRef(false);

  // persist is stored in a ref and refreshed every render so the debounce
  // effect can depend ONLY on [plan, repeatWeekly] — never on onSave/weeklyPlan
  // identity. Depending on those created a save↔re-render feedback loop that
  // wrote to Firestore every 700ms and thrashed the whole app.
  const persistRef = useRef(null);
  persistRef.current = () => {
    pendingSave.current = false;
    if (!onSave) return;
    const { plan: p, repeatWeekly: r } = latest.current;
    const promote = promoteToTemplate.current;
    promoteToTemplate.current = false;
    const normalized = normalizePlan(p);
    onSave({
      repeatWeekly: r,
      template: promote ? normalized : (weeklyPlan?.template || null),
      weeks: { [weekKey]: { ...normalized, confirmedAt: new Date().toISOString() } },
    });
  };

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    // Never write before the saved plan has resolved — see planLoaded above.
    if (!planLoaded) return;
    pendingSave.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persistRef.current?.(), 700);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [plan, repeatWeekly, planLoaded, planRevision]);

  // The plan state initializes once, but on a fresh launch the saved plan can
  // arrive as a prop AFTER this mounts (the Home loading gate is a fixed timer,
  // not tied to the profile load). Adopt it when it appears — but only until the
  // user starts editing *a loaded plan*, so we never clobber an in-progress edit
  // while still recovering from taps made against the pre-load blank state.
  // firstRender is re-armed so the adoption itself doesn't trigger a redundant save.
  // Also handles the week rolling over underneath us: the previous week's adoption
  // and edit latch are cleared so the new week re-derives from its own saved entry,
  // falling back to the repeating template. Without the reset, `adopted` would still
  // be true and last week's plan would sit there — and then get written into the new
  // week's key on the next edit.
  const prevWeekKey = useRef(weekKey);
  useEffect(() => {
    const rolled = prevWeekKey.current !== weekKey;
    if (rolled) {
      prevWeekKey.current = weekKey;
      adopted.current = false;
      userEdited.current = false;
    }
    if (userEdited.current || adopted.current) return;
    const wp = weeklyPlan || {};
    const source = (wp.weeks && wp.weeks[weekKey]) ? wp.weeks[weekKey]
      : (wp.repeatWeekly && wp.template) ? wp.template : null;
    if (!source) {
      // Nothing saved for the new week and no repeating template — start clean
      // rather than carrying the finished week's plan forward.
      if (rolled) { firstRender.current = true; setPlan(emptyPlan()); }
      return;
    }
    adopted.current = true;
    firstRender.current = true;
    setPlan(normalizePlan(source));
    setRepeatWeekly(!!wp.repeatWeekly);
  }, [weeklyPlan, weekKey, planLoaded]);

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

  // Placed counts + one tray entry per category with its remaining count.
  const placedByCat = { strength: 0, cardio: 0, recovery: 0 };
  DAYS.forEach(d => plan[d.key].forEach(p => { placedByCat[p.cat]++; }));
  const trayByCat = CAT_ORDER
    .map(cat => ({ cat, count: Math.max(0, goalCount[cat] - placedByCat[cat]) }))
    .filter(x => x.count > 0);

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
  const [expanded, setExpanded] = useState(false); // collapsible dropdown

  const registerZone = (key) => (el) => {
    if (el) zonesRef.current[key] = el;
    else delete zonesRef.current[key];
  };

  // Move a pill between the tray and days. Day→day preserves the exact pill
  // (and its type); tray→day always creates a fresh generic pill.
  const movePill = useCallback((pill, from, fromIndex, to) => {
    if (from === to) return;
    markEdited();
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
    markEdited();
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

  // Tray chip: one per category, showing the remaining count as a badge. Drag
  // or tap-select it to place a generic session; the count ticks down.
  const TrayBadge = ({ cat, count }) => {
    const c = CATS[cat];
    const sel = selected && selected.cat === cat;
    const pill = { cat, type: null };
    return (
      <button
        onPointerDown={(e) => onPillPointerDown(e, pill, 'tray', -1)}
        onClick={(e) => { e.stopPropagation(); onPillClick(pill, 'tray', -1); }}
        className="inline-flex items-center gap-1.5 rounded-full pl-2.5 pr-1.5 py-1 text-[12px] font-semibold transition-transform active:scale-95 select-none"
        style={{
          touchAction: 'none',
          color: c.color,
          backgroundColor: c.bg,
          border: `1px solid ${sel ? c.color : 'transparent'}`,
          boxShadow: sel ? `0 0 0 2px ${c.bg}` : 'none',
        }}
      >
        <span style={{ fontSize: 11 }}>{c.emoji}</span>
        {c.label}
        <span
          className="inline-flex items-center justify-center"
          style={{ minWidth: 17, height: 17, borderRadius: 999, backgroundColor: c.color, color: '#0A0A0A', fontSize: 11 }}
        >
          {count}
        </span>
      </button>
    );
  };

  const pickerType = picker ? (plan[picker.day]?.[picker.index]?.type ?? null) : null;
  const placedTotal = placedByCat.strength + placedByCat.cardio + placedByCat.recovery;

  return (
    <div className="px-4 mb-4" ref={cardRef}>
      {/* Header — tap to expand/collapse the planner */}
      <button
        onClick={() => { triggerHaptic(ImpactStyle.Light); setExpanded(v => !v); }}
        className="w-full flex items-center justify-between mb-2 text-left"
      >
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg">🗓️</span>
            <span className="text-[20px] font-semibold text-white" style={{ letterSpacing: '-0.3px' }}>This Week's Plan</span>
          </div>
          <p className="text-[13px] -mt-1 pl-[30px]" style={{ color: '#777' }}>
            {placedTotal}/{totalGoal} sessions placed · tap to {expanded ? 'collapse' : 'plan'}
          </p>
        </div>
        <span className="text-[13px] pr-1" style={{ color: '#777' }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {/* Collapsed: at-a-glance week strip (dots colored by category, dimmed = not yet done) */}
      {!expanded && (
        <button
          onClick={() => { triggerHaptic(ImpactStyle.Light); setExpanded(true); }}
          className="w-full flex gap-1 justify-between px-1 py-3 rounded-xl"
          style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}
        >
          {DAYS.map(d => {
            const pills = plan[d.key];
            const logged = loggedByDay[d.key];
            const isToday = d.key === todayKey;
            const usedDone = { strength: 0, cardio: 0, recovery: 0 };
            return (
              <div key={d.key} className="flex-1 flex flex-col items-center gap-1.5">
                <span className="text-[10px] font-semibold" style={{ color: isToday ? '#fff' : '#666' }}>{d.label[0]}</span>
                <div className="flex flex-col gap-0.5 items-center" style={{ minHeight: 6 }}>
                  {pills.length === 0
                    ? <span style={{ width: 4, height: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)' }} />
                    : pills.map((p, i) => {
                        const done = usedDone[p.cat] < logged[p.cat];
                        if (done) usedDone[p.cat]++;
                        return <span key={i} style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: CATS[p.cat].color, opacity: done ? 1 : 0.45 }} />;
                      })}
                </div>
              </div>
            );
          })}
        </button>
      )}

      {/* Expanded: the full drag/tap planner */}
      {expanded && (
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
          {trayByCat.length === 0 ? (
            <div className="flex items-center gap-1.5 text-[12px]" style={{ color: '#30D158' }}>
              <span>✓</span> All {totalGoal} sessions placed
            </div>
          ) : (
            <>
              <span className="w-full text-[11px] mb-0.5" style={{ color: '#777' }}>
                Drag onto a day{selected ? ' · or tap a day' : ''}
              </span>
              {trayByCat.map(({ cat, count }) => (
                <TrayBadge key={cat} cat={cat} count={count} />
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

        {/* This week has drifted from the repeating plan — offer to make it the new
            default. Edits are week-scoped now, so without this there's no way to
            update the template short of toggling repeat off and on. */}
        {divergesFromTemplate && (
          <div
            className="flex items-center justify-between gap-2 mt-3 px-2.5 py-2 rounded-xl"
            style={{ backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <span className="text-[11px] leading-snug" style={{ color: '#999' }}>
              This week differs from your repeating plan.
            </span>
            <button
              onClick={promoteThisWeek}
              className="shrink-0 px-2.5 py-1 rounded-full transition-all active:scale-95"
              style={{ backgroundColor: 'rgba(48,209,88,0.12)', border: '1px solid rgba(48,209,88,0.4)' }}
            >
              <span className="text-[11px] font-semibold" style={{ color: '#30D158' }}>Update repeating plan</span>
            </button>
          </div>
        )}

        {/* Footer: repeat toggle + type hint share one row (keeps the top tight) */}
        <div className="flex items-center justify-between gap-2 mt-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <button
            onClick={() => {
              triggerHaptic(ImpactStyle.Light);
              markEdited();
              // Switching repeat ON snapshots the current plan as the template —
              // this plan is precisely what the user is choosing to repeat.
              // Switching OFF leaves the stored template alone so it survives.
              if (!repeatWeekly) promoteToTemplate.current = true;
              setRepeatWeekly(v => !v);
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full transition-all active:scale-95 shrink-0"
            style={{
              backgroundColor: repeatWeekly ? 'rgba(48,209,88,0.12)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${repeatWeekly ? 'rgba(48,209,88,0.4)' : 'rgba(255,255,255,0.1)'}`,
            }}
          >
            <span className="text-[11px] font-semibold" style={{ color: repeatWeekly ? '#30D158' : '#999' }}>
              {repeatWeekly ? '✓ Repeats weekly' : 'Repeat weekly'}
            </span>
          </button>
          <span className="text-[11px] text-right" style={{ color: '#666' }}>
            Tap a session to set its type · drag to move
          </span>
        </div>
      </div>
      )}

      {/* Drag ghost — portalled to body so a transformed ancestor (e.g. the
          onboarding slide wrapper) can't offset its fixed positioning. */}
      {ghost && createPortal((() => {
        const c = CATS[ghost.pill.cat];
        return (
          <div
            className="fixed z-[9998] pointer-events-none inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold"
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
      })(), document.body)}

      {/* Type picker sheet — portalled to body so it overlays the full viewport
          above any fixed footer (a transform ancestor otherwise traps it). */}
      {picker && createPortal((() => {
        const c = CATS[picker.cat];
        const opts = [null, ...TYPE_OPTIONS[picker.cat]];
        const dayIdx = DAYS.findIndex((d) => d.key === picker.day);
        const todayIdx = DAYS.findIndex((d) => d.key === todayKey);
        // Only today or earlier this week can be logged — you can't log a future workout.
        const canLog = !!onLogActivity && dayIdx <= todayIdx;
        const dayLabel = DAYS[dayIdx]?.label;
        return (
          <div
            className="fixed inset-0 z-[9999] flex items-end"
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
                <span className="text-white font-semibold text-[15px]">{c.label}{dayLabel ? ` · ${dayLabel}` : ''}</span>
              </div>
              {canLog && (
                <button
                  onClick={() => {
                    const pill = plan[picker.day]?.[picker.index] || { cat: picker.cat, type: null };
                    const date = dayDates[dayIdx];
                    setPicker(null);
                    onLogActivity(pillToActivity(pill, date));
                  }}
                  className="w-full flex items-center justify-center gap-2 rounded-xl py-3 mb-4 text-[14px] font-semibold transition-transform active:scale-95"
                  style={{ backgroundColor: c.color, color: '#0A0A0A' }}
                >
                  <span style={{ fontSize: 13 }}>✓</span> Log this {c.label.toLowerCase()} workout
                </button>
              )}
              <div className="text-[11px] mb-2" style={{ color: '#777' }}>Set the type</div>
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
      })(), document.body)}
    </div>
  );
}
