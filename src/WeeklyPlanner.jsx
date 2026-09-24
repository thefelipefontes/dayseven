import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import SectionIcon from './components/SectionIcon';
import { createPortal } from 'react-dom';
import CategoryIcon from './components/CategoryIcon';
import { triggerHaptic, ImpactStyle } from './utils/haptics';
import { toLocalDateStr } from './utils/dateHelpers';
import { getActivityCategory } from './utils/activityCategory';
import { hasRecentSteps } from './utils/weekGoals';

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
  strength: { label: 'Strength', color: '#00FF94', bg: 'rgba(0,255,148,0.14)', cat: 'lifts',    goalKey: 'liftsPerWeek' },
  cardio:   { label: 'Cardio',   color: '#FF9500', bg: 'rgba(255,149,0,0.14)', cat: 'cardio',   goalKey: 'cardioPerWeek' },
  recovery: { label: 'Recovery', color: '#00D1FF', bg: 'rgba(0,209,255,0.14)', cat: 'recovery', goalKey: 'recoveryPerWeek' },
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

// Pick k of the candidate day indices, evenly spaced (3 of 7 → Mon/Wed/Fri). More
// sessions than candidates wraps around and doubles up.
const spreadPick = (candidates, k) => {
  const n = candidates.length;
  if (k <= 0 || n === 0) return [];
  return Array.from({ length: k }, (_, i) => candidates[k <= n ? Math.floor((i + 0.5) * n / k) : i % n]);
};

// "Suggest a plan": lay out the week's goal sessions over the given days. Lifts go
// first, evenly spaced so there's rest between them; cardio takes the non-lifting
// days; recovery fills whatever's lightest. Pills are generic — the user taps one to
// give it a type.
const suggestPlan = (counts, dayIdxs) => {
  const load = {};
  dayIdxs.forEach(i => { load[i] = []; });
  const place = (cat, k, preferred) => {
    const pref = preferred.filter(i => load[i] !== undefined);
    const first = spreadPick(pref, Math.min(k, pref.length));
    const rest = k - first.length;
    // Not enough preferred days: the extras go on the least-loaded remaining days.
    const others = dayIdxs.filter(i => !pref.includes(i)).sort((a, b) => load[a].length - load[b].length);
    const extra = rest > 0 ? spreadPick(others.length ? others : dayIdxs, rest) : [];
    [...first, ...extra].forEach(i => load[i].push({ cat, type: null }));
  };
  place('strength', counts.strength, dayIdxs);
  place('cardio', counts.cardio, dayIdxs.filter(i => load[i].length === 0));
  place('recovery', counts.recovery, dayIdxs.filter(i => load[i].length === 0));
  return load;
};

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

// Logged sessions per day of the given week (dayDates = Sun..Sat 'YYYY-MM-DD'), per category.
export const loggedByDayFor = (activities, dayDates) => {
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
};

// Mark each planned pill done or not. The plan is a guide for the WEEK, so a session
// done on a different day than planned still counts: logs first check off pills on
// their own day, then whatever's left over checks off the earliest open pills of the
// same category anywhere in the week. Returns one array of { cat, type, done } per day.
export const reconcilePlan = (plan, loggedByDay) => {
  const spare = { strength: 0, cardio: 0, recovery: 0 };
  const out = DAYS.map(d => {
    const logged = { ...loggedByDay[d.key] };
    const pills = (plan[d.key] || []).map(p => {
      const done = logged[p.cat] > 0;
      if (done) logged[p.cat]--;
      return { ...p, done };
    });
    CAT_ORDER.forEach(c => { spare[c] += logged[c]; });
    return pills;
  });
  out.forEach(pills => pills.forEach(p => {
    if (!p.done && spare[p.cat] > 0) { p.done = true; spare[p.cat]--; }
  }));
  return out;
};

// Today's planned sessions for Home, reconciled the same way as the Plan tab.
export const plannedTodayFromPlan = (weeklyPlan, activities, now = new Date()) => {
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay());
  start.setHours(0, 0, 0, 0);
  const weekKey = toLocalDateStr(start);
  const dayDates = DAYS.map((_, i) => { const dt = new Date(start); dt.setDate(start.getDate() + i); return toLocalDateStr(dt); });
  const wp = weeklyPlan || {};
  const raw = wp.weeks?.[weekKey] || (wp.repeatWeekly ? wp.template : null);
  if (!raw) return [];
  return reconcilePlan(normalizePlan(raw), loggedByDayFor(activities, dayDates))[now.getDay()]
    .map(p => ({ ...p, label: p.type || CATS[p.cat].label }));
};

// `planLoaded` tells us the saved plan has been resolved (loaded, or confirmed absent).
// Defaults to true for callers that hand us a plan synchronously — e.g. Onboarding, which
// passes a seed built on mount. Home passes it explicitly, because there `userData.weeklyPlan`
// is undefined until the profile fetch lands while the planner is already on screen and
// interactive. Saving in that window used to write `repeatWeekly: false` + `template: null`
// and permanently wipe the user's recurring plan.
export default function WeeklyPlanner({ goals, activities = [], weeklyPlan, onSave, onLogActivity, planLoaded = true, initiallyExpanded = false, asPage = false, onEditGoals = null, stepsByDate = null, stepsPerDay = 10000, showSuggest = asPage, suggestWholeWeek = false }) {
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
  const loggedByDay = useMemo(() => loggedByDayFor(activities, dayDates), [activities, dayDates]);
  const pillStatus = useMemo(() => reconcilePlan(plan, loggedByDay), [plan, loggedByDay]);

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
  const [undoPlan, setUndoPlan] = useState(null);  // { plan, top } before "Suggest a plan", for Undo
  // Collapsible when embedded; on the Plan tab (asPage) it's always open.
  const [expandedState, setExpanded] = useState(initiallyExpanded);
  const expanded = asPage || expandedState;

  const registerZone = (key) => (el) => {
    if (el) zonesRef.current[key] = el;
    else delete zonesRef.current[key];
  };

  // Move a pill between the tray and days. Day→day preserves the exact pill
  // (and its type); tray→day always creates a fresh generic pill.
  const movePill = useCallback((pill, from, fromIndex, to) => {
    if (from === to) return;
    markEdited();
    setUndoPlan(null); // a hand edit after "Suggest a plan" keeps the suggestion
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
    setUndoPlan(null);
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
        <span style={{ fontSize: 11 }}>{done ? '✓' : <CategoryIcon category={c.cat} size={11} color="currentColor" />}</span>
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
        <CategoryIcon category={c.cat} size={11} color="currentColor" />
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

  // --- Plan tab: week summary + suggest -----------------------------------
  const todayIdx = DAYS.findIndex(d => d.key === todayKey);
  const doneByCat = { strength: 0, cardio: 0, recovery: 0 };
  pillStatus.flat().forEach(p => { if (p.done) doneByCat[p.cat]++; });
  const doneTotal = doneByCat.strength + doneByCat.cardio + doneByCat.recovery;
  const daysLeft = 7 - todayIdx;
  // Up next: the first day from today on that still has an undone session.
  let upNext = null;
  for (let i = todayIdx; i < 7 && !upNext; i++) {
    const left = pillStatus[i].filter(p => !p.done);
    if (left.length) upNext = { pills: left, when: i === todayIdx ? 'today' : i === todayIdx + 1 ? 'tomorrow' : DAYS[i].label };
  }

  // Steps for the week (Plan tab only). Hidden for users with no step data, whose
  // Winning Streak doesn't include steps (see hasRecentSteps in utils/weekGoals).
  const showSteps = asPage && !!stepsByDate && hasRecentSteps(stepsByDate);
  const daySteps = dayDates.map(d => (stepsByDate?.[d] || 0));
  const weekStepsTotal = daySteps.slice(0, todayIdx + 1).reduce((a, b) => a + b, 0);
  const weekStepsGoal = (stepsPerDay || 10000) * 7;
  // Daily step target from today on: what's still needed at the start of today, split evenly
  // over the days left. If today already beats it, the days after today need less.
  const roundUp100 = (n) => Math.ceil(Math.max(0, n) / 100) * 100;
  const stepsBeforeToday = daySteps.slice(0, todayIdx).reduce((a, b) => a + b, 0);
  const stepsToday = daySteps[todayIdx] || 0;
  const todayStepTarget = roundUp100((weekStepsGoal - stepsBeforeToday) / daysLeft);
  const laterStepTarget = daysLeft > 1
    ? (stepsToday > todayStepTarget ? roundUp100((weekStepsGoal - weekStepsTotal) / (daysLeft - 1)) : todayStepTarget)
    : 0;
  const stepsPerDayToGo = stepsToday > todayStepTarget ? laterStepTarget : todayStepTarget;
  const fmtK = (n) => `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;

  // Suggest from today through Saturday. Days already behind us keep what's on them,
  // and their sessions come off the counts still to place. In onboarding
  // (suggestWholeWeek) it lays out a full Sunday–Saturday week instead — the pattern that
  // repeats — so signing up late in the week doesn't cram every session into a few days.
  const remainingIdxs = suggestWholeWeek ? DAYS.map((_, i) => i) : DAYS.map((_, i) => i).filter(i => i >= todayIdx);
  const toPlace = { ...goalCount };
  if (!suggestWholeWeek) DAYS.forEach((d, i) => { if (i < todayIdx) plan[d.key].forEach(p => { toPlace[p.cat] = Math.max(0, toPlace[p.cat] - 1); }); });
  // Up top while sessions are still unplaced (an empty week is when it helps most),
  // at the bottom once everything's placed. Undo stays where the tap happened.
  const suggestAtTop = undoPlan ? undoPlan.top : trayByCat.length > 0;
  const applySuggestion = () => {
    triggerHaptic(ImpactStyle.Medium);
    markEdited();
    setUndoPlan({ plan, top: suggestAtTop });
    if (suggestWholeWeek) promoteToTemplate.current = true; // the built week is the one that repeats
    const suggested = suggestPlan(toPlace, remainingIdxs);
    setPlan(prev => {
      const next = { ...prev };
      remainingIdxs.forEach(i => { next[DAYS[i].key] = suggested[i]; });
      return next;
    });
  };
  const undoSuggestion = () => {
    triggerHaptic(ImpactStyle.Light);
    markEdited();
    if (suggestWholeWeek) promoteToTemplate.current = true;
    setPlan(undoPlan.plan);
    setUndoPlan(null);
  };

  // Plan tab: fill the rest of the week from the goals in one tap (Undo right after).
  const suggestBlock = (
    undoPlan ? (
      <div className={`${suggestAtTop ? 'mb-3' : 'mt-3'} p-3 rounded-xl flex items-center justify-between gap-3`} style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
        <span className="text-[12.5px]" style={{ color: '#bbb' }}>{suggestWholeWeek ? 'Week built' : 'Plan suggested'} · drag anything to adjust</span>
        <button onClick={undoSuggestion} className="shrink-0 px-3 py-1 rounded-full text-[12px] font-semibold active:scale-95 transition-transform" style={{ backgroundColor: 'rgba(255,255,255,0.08)', color: '#fff' }}>Undo</button>
      </div>
    ) : (
      <button
        onClick={applySuggestion}
        className={`w-full ${suggestAtTop ? 'mb-3' : 'mt-3'} p-3 rounded-xl flex items-center gap-3 text-left active:scale-[0.98] transition-transform`}
        style={{ backgroundColor: 'rgba(0,255,148,0.06)', border: '1px solid rgba(0,255,148,0.2)' }}
      >
        <span className="text-lg">✨</span>
        <div className="flex-1">
          <div className="text-[13px] font-semibold" style={{ color: '#00FF94' }}>{suggestWholeWeek ? 'Build my week for me' : 'Suggest a plan'}</div>
          <div className="text-[11px]" style={{ color: '#999' }}>
            {suggestWholeWeek
              ? 'Spreads your sessions across the week, with rest between lifting days'
              : `Spreads your sessions across ${todayIdx === 0 ? 'the week' : 'the rest of the week'}, with rest between lifting days`}
          </div>
        </div>
        <span className="text-[13px]" style={{ color: '#777' }}>›</span>
      </button>
    )
  );

  const hideTray = asPage && trayByCat.length === 0;
  const pickerType = picker ? (plan[picker.day]?.[picker.index]?.type ?? null) : null;
  const placedTotal = placedByCat.strength + placedByCat.cardio + placedByCat.recovery;

  return (
    <div className="px-4 mb-4" ref={cardRef}>
      {/* Header — tap to expand/collapse the planner (a static page title on the Plan tab) */}
      {asPage ? (
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <SectionIcon type="calendar" />
              <span className="text-[20px] font-semibold text-white" style={{ letterSpacing: '-0.3px' }}>This Week's Plan</span>
            </div>
            <p className="text-[13px] -mt-1 pl-[30px]" style={{ color: '#777' }}>
              {placedTotal}/{totalGoal} sessions placed
            </p>
          </div>
          {onEditGoals && (
            <button
              onClick={() => { triggerHaptic(ImpactStyle.Light); onEditGoals(); }}
              className="shrink-0 mt-0.5 flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[12px] font-semibold active:scale-95 transition-transform"
              style={{ backgroundColor: 'rgba(255,255,255,0.06)', color: '#ccc' }}
            >
              <SectionIcon type="target" size={13} color="#ccc" /> Goals
            </button>
          )}
        </div>
      ) : (
      <button
        onClick={() => { triggerHaptic(ImpactStyle.Light); setExpanded(v => !v); }}
        className="w-full flex items-center justify-between mb-2 text-left"
      >
        <div>
          <div className="flex items-center gap-2">
            <SectionIcon type="calendar" />
            <span className="text-[20px] font-semibold text-white" style={{ letterSpacing: '-0.3px' }}>This Week's Plan</span>
          </div>
          <p className="text-[13px] -mt-1 pl-[30px]" style={{ color: '#777' }}>
            {placedTotal}/{totalGoal} sessions placed · tap to {expanded ? 'collapse' : 'plan'}
          </p>
        </div>
        <span className="text-[13px] pr-1" style={{ color: '#777' }}>{expanded ? '▲' : '▼'}</span>
      </button>
      )}

      {/* Plan tab: how the plan is going — done vs placed per category, days left, what's next */}
      {asPage && (placedTotal > 0 || showSteps) && (
        <div className="mb-3 p-4 rounded-2xl" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
          {placedTotal > 0 && (<>
          <div className="flex items-baseline justify-between">
            <span className="text-[14px] font-semibold text-white">{doneTotal} of {placedTotal} planned sessions done</span>
            <span className="text-[12px]" style={{ color: '#777' }}>{daysLeft === 1 ? 'Last day' : `${daysLeft} days left`}</span>
          </div>
          <div className="flex gap-1 mt-2.5">
            {CAT_ORDER.filter(cat => placedByCat[cat] > 0).map(cat => (
              <div key={cat} className="flex gap-0.5" style={{ flex: placedByCat[cat] }}>
                {Array.from({ length: placedByCat[cat] }).map((_, j) => (
                  <div key={j} className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: j < doneByCat[cat] ? CATS[cat].color : `${CATS[cat].color}33` }} />
                ))}
              </div>
            ))}
          </div>
          </>)}
          {showSteps && (
            <div className={placedTotal > 0 ? 'mt-3' : ''}>
              <div className="flex items-baseline justify-between text-[12px]">
                <span className="flex items-center gap-1.5" style={{ color: '#BF5AF2' }}>
                  <CategoryIcon category="steps" size={12} />
                  <span className="font-semibold">{fmtK(weekStepsTotal)}</span>
                  <span style={{ color: '#777' }}>of {fmtK(weekStepsGoal)} steps</span>
                </span>
                <span style={{ color: weekStepsTotal >= weekStepsGoal ? '#BF5AF2' : '#777' }}>
                  {weekStepsTotal >= weekStepsGoal ? '✓ Goal hit' : `${fmtK(stepsPerDayToGo)}/day to go`}
                </span>
              </div>
              <div className="h-1.5 rounded-full mt-1.5 overflow-hidden" style={{ backgroundColor: 'rgba(191,90,242,0.2)' }}>
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, (weekStepsTotal / weekStepsGoal) * 100)}%`, backgroundColor: '#BF5AF2' }} />
              </div>
            </div>
          )}
          {placedTotal > 0 && <div className="mt-3 pt-3 flex items-center flex-wrap gap-1.5 text-[12px]" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            {upNext ? (
              <>
                <span className="mr-0.5" style={{ color: '#999' }}>Up next</span>
                {upNext.pills.map((p, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: CATS[p.cat].bg, color: CATS[p.cat].color }}>
                    <CategoryIcon category={CATS[p.cat].cat} size={11} color="currentColor" />{chipLabel(p)}
                  </span>
                ))}
                <span style={{ color: '#777' }}>· {upNext.when}</span>
              </>
            ) : (
              <span style={{ color: '#30D158' }}>✓ Everything planned is done</span>
            )}
          </div>}
        </div>
      )}

      {showSuggest && suggestAtTop && suggestBlock}

      {/* Collapsed: at-a-glance week strip (dots colored by category, dimmed = not yet done) */}
      {!expanded && (
        <button
          onClick={() => { triggerHaptic(ImpactStyle.Light); setExpanded(true); }}
          className="w-full flex gap-1 justify-between px-1 py-3 rounded-xl"
          style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}
        >
          {DAYS.map(d => {
            const pills = pillStatus[DAYS.indexOf(d)];
            const isToday = d.key === todayKey;
            return (
              <div key={d.key} className="flex-1 flex flex-col items-center gap-1.5">
                <span className="text-[10px] font-semibold" style={{ color: isToday ? '#fff' : '#666' }}>{d.label[0]}</span>
                <div className="flex flex-col gap-0.5 items-center" style={{ minHeight: 6 }}>
                  {pills.length === 0
                    ? <span style={{ width: 4, height: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)' }} />
                    : pills.map((p, i) => (
                        <span key={i} style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: CATS[p.cat].color, opacity: p.done ? 1 : 0.45 }} />
                      ))}
                </div>
              </div>
            );
          })}
        </button>
      )}

      {/* Plan tab: splits the summary above from the day-by-day planner, and says which week this is */}
      {asPage && (
        <div className="mt-6 mb-2.5 flex items-center justify-between px-1">
          <span className="text-[17px] font-semibold text-white">Your week</span>
          <span className="text-[12px]" style={{ color: '#777' }}>{rangeLabel}</span>
        </div>
      )}
      {asPage && showSteps && laterStepTarget > 0 && weekStepsTotal < weekStepsGoal && (
        <div className="-mt-1 mb-2 px-1 flex justify-end text-[10.5px]" style={{ color: '#777' }}>
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-2.5 rounded-sm" style={{ border: '1px dashed rgba(191,90,242,0.5)' }} /> steps needed each day to hit {fmtK(weekStepsGoal)}</span>
        </div>
      )}
      {expanded && (
      <div className="p-4 rounded-2xl relative" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
        {/* Plan tab, everything placed: the "All placed" line would just repeat the header
            count, so the tray is hidden. It's still where you drag a session to take it off
            the plan, so it comes back as an overlay while a drag is on (an overlay, not an
            inserted row, so the days don't shift under your finger) covering the "Your week"
            header, never a day row. */}
        {hideTray && ghost && (
          <div
            ref={registerZone('tray')}
            className="absolute left-0 right-0 z-10 flex items-center justify-center rounded-xl text-[12px] font-semibold"
            style={{
              height: 44,
              top: -52, // over the "Your week" header, clear of Sunday's row
              color: hoverKey === 'tray' ? '#fff' : '#999',
              backgroundColor: hoverKey === 'tray' ? 'rgba(255,69,58,0.25)' : 'rgba(30,30,30,0.95)',
              border: `1px dashed ${hoverKey === 'tray' ? 'rgba(255,69,58,0.7)' : 'rgba(255,255,255,0.2)'}`,
            }}
          >
            Drop here to remove
          </div>
        )}
        {/* Tray of unplaced pills */}
        {!hideTray && <div
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
        </div>}

        {/* Day rows */}
        <div className="space-y-1.5">
          {DAYS.map(d => {
            const dayPills = plan[d.key];
            const dayStatus = pillStatus[DAYS.indexOf(d)];
            const isToday = d.key === todayKey;
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
                    dayPills.map((pill, i) => (
                      <Pill key={`${d.key}-${i}`} pill={pill} from={d.key} index={i} done={!!dayStatus[i]?.done} />
                    ))
                  )}
                </div>
                {/* Steps: walked (past), walked/target (today), target to aim for (days ahead) */}
                {showSteps && (() => {
                  const i = DAYS.indexOf(d);
                  const goalHit = weekStepsTotal >= weekStepsGoal;
                  const icon = <CategoryIcon category="steps" size={10} color="currentColor" />;
                  if (i < todayIdx) return (
                    <span className="shrink-0 pt-1.5 flex items-center gap-1 text-[11px]" style={{ color: daySteps[i] >= stepsPerDay ? '#BF5AF2' : '#666' }}>{icon}{fmtK(daySteps[i])}</span>
                  );
                  if (i === todayIdx) return (
                    <span className="shrink-0 pt-1.5 flex items-center gap-1 text-[11px]" style={{ color: goalHit || stepsToday >= todayStepTarget ? '#BF5AF2' : '#aaa' }}>
                      {icon}{fmtK(stepsToday)}{!goalHit && <span style={{ color: '#666' }}>/{fmtK(todayStepTarget)}</span>}
                    </span>
                  );
                  if (goalHit || !laterStepTarget) return null;
                  // Days ahead: the target, in a dashed "slot to fill" (key under "Your week")
                  return (
                    <span className="shrink-0 mt-1 flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md" style={{ color: '#9d7bb0', border: '1px dashed rgba(191,90,242,0.35)' }}>{icon}{fmtK(laterStepTarget)}</span>
                  );
                })()}
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

      {showSuggest && !suggestAtTop && suggestBlock}

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
            <CategoryIcon category={c.cat} size={11} color="currentColor" />{chipLabel(ghost.pill)}
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
                <CategoryIcon category={c.cat} size={15} color="currentColor" />
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
