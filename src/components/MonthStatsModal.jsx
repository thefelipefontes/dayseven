import React, { useState, useEffect } from 'react';
import SectionIcon from './SectionIcon';
import CategoryIcon from './CategoryIcon';
import { normalizeFocusAreas } from '../utils/focusAreas';
import { initialUserData } from '../utils/initialUserData';
import { countsAsLifting, countsAsCardio, countsAsRecovery } from '../utils/activityCategory';
import { judgeWeek, countWeekActivities, weekGoalsResolver, weekContext, stepsByDateFrom, weekStepsTotal, winningCategories, weekKeyFromDateStr } from '../utils/weekGoals';
import { formatDistanceValue, unitLabel } from '../utils/distance';

const RecoveryBonusRow = ({ count, suffix = '' }) => (
  <div className="px-3 py-2 rounded-xl flex items-center justify-between" style={{ backgroundColor: 'rgba(0,209,255,0.06)', border: '1px solid rgba(0,209,255,0.18)' }}>
    <div className="flex items-center gap-1.5 text-xs">
      <CategoryIcon category="recovery" size={12} />
      <span className="text-white">Recovery</span>
      <span className="font-bold" style={{ color: '#00D1FF' }}>{count}</span>
      {suffix && <span className="text-gray-500">{suffix}</span>}
    </div>
    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ color: '#00D1FF', backgroundColor: 'rgba(0,209,255,0.12)', letterSpacing: '0.04em' }}>BONUS</span>
  </div>
);

const MonthStatsModal = ({ isOpen, onClose, monthData, monthLabel, onShare, userData, activities, healthHistory, distanceUnit = 'mi' }) => {
  const [isAnimating, setIsAnimating] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsClosing(false);
      setTimeout(() => setIsAnimating(true), 10);
    } else {
      setIsAnimating(false);
    }
  }, [isOpen]);

  const handleClose = () => {
    setIsAnimating(false);
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 300);
  };

  if (!isOpen && !isClosing) return null;

  const goals = userData?.goals || initialUserData.goals;

  // Activity type definitions
  const cardioTypes = ['Running', 'Cycle', 'Sports', 'Walking', 'Hiking', 'Swimming', 'Rowing', 'Stair Climbing', 'Elliptical', 'HIIT'];
  const recoveryTypes = ['Cold Plunge', 'Sauna', 'Contrast Therapy', 'Massage', 'Chiropractic', 'Yoga', 'Pilates'];

  // Calculate stats from monthData
  const monthActivities = monthData?.activities || [];
  const monthDates = monthData?.dates || [];

  // Session counts ('lifting+cardio' fills both, matching the home rings)
  const liftsCount = monthActivities.filter(countsAsLifting).length;
  const cardioCount = monthActivities.filter(countsAsCardio).length;
  const recoveryCount = monthActivities.filter(countsAsRecovery).length;

  // Calculate totals
  const totalCalories = monthData?.calories || 0;
  const totalMiles = monthActivities
    .filter(a => a.distance)
    .reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);
  const totalSteps = monthData?.steps || 0;
  // The month's steps goal: each day's goal (stepsPerDay in force that week) summed over the
  // month's days — 10k × 30 = 300k — rather than the weekly goal × 4, which a 4.3-week month
  // would clear about 30k early.
  const monthStepsGoal = (() => {
    const goalFor = weekGoalsResolver(goals, userData?.goalHistory || []);
    return monthDates.reduce((sum, d) => sum + (goalFor(weekKeyFromDateStr(d))?.stepsPerDay || 0), 0);
  })();
  const distUnit = unitLabel(distanceUnit);
  const totalMinutes = monthActivities.reduce((sum, a) => sum + (parseInt(a.duration) || 0), 0);
  const daysActive = new Set(monthActivities.map(a => a.date)).size;

  // Calculate weeks hitting goals
  const calculateWeeksHittingGoals = () => {
    if (monthDates.length === 0) return { lift: 0, cardio: 0, recovery: 0, steps: 0, all: 0, total: 0, won: [], stepsTracked: false };

    // Group dates by week (Sunday-Saturday)
    const weekMap = {};
    monthDates.forEach(dateStr => {
      const date = new Date(dateStr + 'T12:00:00');
      const dayOfWeek = date.getDay();
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - dayOfWeek);
      const weekKey = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
      if (!weekMap[weekKey]) weekMap[weekKey] = [];
      weekMap[weekKey].push(dateStr);
    });

    let liftWeeks = 0, cardioWeeks = 0, recoveryWeeks = 0, stepsWeeks = 0, allGoalsWeeks = 0;
    const won = []; // per week, oldest first — drives the little bars on the Weeks Won card
    const totalWeeks = Object.keys(weekMap).length;

    // Shared rule (utils/weekGoals), against the goals in force each week.
    const goalsForWeek = weekGoalsResolver(goals, userData?.goalHistory || []);
    const ctx = weekContext({ goals, goalHistory: userData?.goalHistory || [], winningRuleFrom: userData?.winningRuleFrom || null, stepsByDate: stepsByDateFrom(healthHistory || []) });
    Object.entries(weekMap).sort(([a], [b]) => a.localeCompare(b)).forEach(([weekKey, weekDates]) => {
      const weekActivities = monthActivities.filter(a => weekDates.includes(a.date));
      const judged = judgeWeek(countWeekActivities(weekActivities), goalsForWeek(weekKey), {
        weekSteps: weekStepsTotal(ctx.stepsByDate, weekKey),
        required: winningCategories(weekKey, ctx),
      });
      if (judged.lifts) liftWeeks++;
      if (judged.cardio) cardioWeeks++;
      if (judged.recovery) recoveryWeeks++;
      if (judged.steps) stepsWeeks++;
      if (judged.all) allGoalsWeeks++;
      won.push(!!judged.all);
    });

    return { lift: liftWeeks, cardio: cardioWeeks, recovery: recoveryWeeks, steps: stepsWeeks, all: allGoalsWeeks, total: totalWeeks, won, stepsTracked: ctx.stepsTracked };
  };

  const weeksData = calculateWeeksHittingGoals();

  // Best burn activity
  const bestBurn = monthActivities.reduce((best, a) => {
    const cal = parseInt(a.calories) || 0;
    if (!best || cal > best.calories) {
      return { calories: cal, type: a.type };
    }
    return best;
  }, null);

  // Longest session, split by category so a long lift and a long run each get their card.
  const longestOf = (list) => list.reduce((best, a) => {
    const dur = parseInt(a.duration) || 0;
    if (dur > 0 && (!best || dur > best.duration)) {
      return { duration: dur, type: a.type === 'Strength Training' ? (a.strengthType || 'Strength') : (a.subtype || a.type) };
    }
    return best;
  }, null);
  const longestStrength = longestOf(monthActivities.filter(countsAsLifting));
  const longestCardio = longestOf(monthActivities.filter(countsAsCardio));

  // Furthest distance (any activity with distance - walking, running, cycling, etc.)
  const furthestDistance = monthActivities.reduce((best, a) => {
    const dist = parseFloat(a.distance) || 0;
    if (dist > 0 && (!best || dist > best.distance)) {
      return { distance: dist, type: a.type };
    }
    return best;
  }, null);

  // Most frequent activity types
  const strengthFocusCounts = {};
  monthActivities.filter(a => a.type === 'Strength Training').forEach(a => {
    const areas = normalizeFocusAreas(a.focusAreas || (a.focusArea ? [a.focusArea] : []));
    areas.forEach(area => {
      strengthFocusCounts[area] = (strengthFocusCounts[area] || 0) + 1;
    });
  });
  const mostFrequentStrength = Object.entries(strengthFocusCounts).sort((a, b) => b[1] - a[1])[0];

  const cardioTypeCounts = {};
  monthActivities.filter(a => cardioTypes.includes(a.type)).forEach(a => {
    cardioTypeCounts[a.type] = (cardioTypeCounts[a.type] || 0) + 1;
  });
  const mostFrequentCardio = Object.entries(cardioTypeCounts).sort((a, b) => b[1] - a[1])[0];

  const recoveryTypeCounts = {};
  monthActivities.filter(a => recoveryTypes.includes(a.type)).forEach(a => {
    recoveryTypeCounts[a.type] = (recoveryTypeCounts[a.type] || 0) + 1;
  });
  const mostFrequentRecovery = Object.entries(recoveryTypeCounts).sort((a, b) => b[1] - a[1])[0];

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col transition-all duration-300"
      style={{ backgroundColor: isAnimating ? 'rgba(0,0,0,0.95)' : 'rgba(0,0,0,0)' }}
      onClick={(e) => e.target === e.currentTarget && handleClose()}
    >
      <div
        className="flex-1 flex flex-col transition-all duration-300 ease-out overflow-hidden"
        style={{
          backgroundColor: '#0A0A0A',
          transform: isAnimating ? 'translateY(0)' : 'translateY(100%)'
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
          <button
            onClick={handleClose}
            className="text-gray-400 transition-all duration-150 px-2 py-1 rounded-lg"
            onTouchStart={(e) => {
              e.currentTarget.style.transform = 'scale(0.9)';
              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
            }}
            onTouchEnd={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            ← Back
          </button>
          <h2 className="font-bold">{monthLabel}</h2>
          <button
            onClick={() => onShare && onShare()}
            className="px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1 transition-all duration-150"
            style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
            onTouchStart={(e) => {
              e.currentTarget.style.transform = 'scale(0.9)';
              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.2)';
            }}
            onTouchEnd={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
            }}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
              <polyline points="16 6 12 2 8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
            <span>Share</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(0,255,148,0.1)' }}>
              <div className="text-2xl font-black" style={{ color: '#00FF94' }}>{liftsCount}</div>
              <div className="text-[10px] text-gray-400"><CategoryIcon category="lifts" size={11} className="inline align-[-2px] mr-1" />Strength</div>
            </div>
            <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(255,149,0,0.1)' }}>
              <div className="text-2xl font-black" style={{ color: '#FF9500' }}>{cardioCount}</div>
              <div className="text-[10px] text-gray-400"><CategoryIcon category="cardio" size={11} className="inline align-[-2px] mr-1" />Cardio</div>
            </div>
            <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(191,90,242,0.1)' }}>
              <div className="text-2xl font-black" style={{ color: '#BF5AF2' }}>{(totalSteps / 1000).toFixed(0)}k</div>
              <div className="text-[10px] text-gray-400"><CategoryIcon category="steps" size={11} className="inline align-[-2px] mr-1" />{weeksData.stepsTracked && monthStepsGoal > 0 ? `of ${(monthStepsGoal / 1000).toFixed(0)}k steps` : 'Steps'}</div>
            </div>
          </div>
          <div className="-mt-2 mb-4"><RecoveryBonusRow count={recoveryCount} suffix="sessions" /></div>

          {/* Month Totals */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-3">
              <SectionIcon type="chart" />
              <span className="text-[20px] font-semibold text-white" style={{ letterSpacing: '-0.3px' }}>Month Totals</span>
            </div>
            {/* One quiet row rather than four boxes — these are totals to glance at, not goals. */}
            <div className="flex py-3.5 px-1 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
              {[
                { value: totalCalories.toLocaleString(), icon: <CategoryIcon category="calories" size={11} />, label: 'cal' },
                { value: formatDistanceValue(totalMiles, distanceUnit, 1), icon: <CategoryIcon category="distance" size={11} />, label: distUnit },
                { value: totalMinutes.toLocaleString(), icon: <SectionIcon type="clock" size={11} color="#aaa" />, label: 'min' },
                { value: daysActive, icon: <SectionIcon type="calendar" size={11} color="#aaa" />, label: 'days' },
              ].map((t, i) => (
                <React.Fragment key={t.label}>
                  {i > 0 && <div className="w-px self-stretch" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />}
                  <div className="flex-1 text-center">
                    <div className="text-[17px] font-extrabold">{t.value}</div>
                    <div className="text-[11px] text-gray-400 flex items-center justify-center gap-1 mt-0.5">{t.icon}{t.label}</div>
                  </div>
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Highlights — 2×2 in category colours: longest strength (green), longest cardio and
              furthest (cardio orange), best burn (calorie red). Always all four cards. */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-3">
              <SectionIcon type="trophy" />
              <span className="text-[20px] font-semibold text-white" style={{ letterSpacing: '-0.3px' }}>Highlights</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { has: longestStrength, value: longestStrength && `${longestStrength.duration} min`, sub: longestStrength?.type, cat: 'lifts', label: 'Longest Strength', color: '#00FF94', tint: '0,255,148' },
                { has: longestCardio, value: longestCardio && `${longestCardio.duration} min`, sub: longestCardio?.type, cat: 'cardio', label: 'Longest Cardio', color: '#FF9500', tint: '255,149,0' },
                { has: furthestDistance?.distance > 0, value: furthestDistance?.distance > 0 && `${formatDistanceValue(furthestDistance.distance, distanceUnit, 2)} ${distUnit}`, sub: furthestDistance?.type, cat: 'distance', label: 'Furthest', color: '#FF9500', tint: '255,149,0' },
                { has: bestBurn?.calories > 0, value: bestBurn?.calories > 0 && `${bestBurn.calories.toLocaleString()} cal`, sub: bestBurn?.type, cat: 'calories', label: 'Best Burn', color: '#FF6B6B', tint: '255,107,107' },
              ].map((h) => (
                <div key={h.label} className="p-2.5 rounded-xl text-center" style={{ backgroundColor: `rgba(${h.tint},0.08)` }}>
                  <div className="text-base font-black" style={{ color: h.has ? h.color : '#555' }}>{h.has ? h.value : 'N/A'}</div>
                  <div className="text-[10px] text-gray-400 flex items-center justify-center gap-1"><CategoryIcon category={h.cat} size={10} />{h.label}</div>
                  <div className="text-[10px] text-gray-500 truncate">{h.has ? h.sub : '—'}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Most Frequent - always show all 3 cards */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-3">
              <SectionIcon type="activity" />
              <span className="text-[20px] font-semibold text-white" style={{ letterSpacing: '-0.3px' }}>Most Frequent</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {/* Strength */}
              <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(0,255,148,0.05)' }}>
                <div className="text-sm font-bold" style={{ color: mostFrequentStrength ? '#00FF94' : '#555' }}>
                  {mostFrequentStrength ? mostFrequentStrength[0] : 'N/A'}
                </div>
                <div className="text-[10px] text-gray-500">
                  {mostFrequentStrength ? `${mostFrequentStrength[1]}x` : '—'}
                </div>
                <div className="text-[9px] text-gray-600">Strength</div>
              </div>
              {/* Cardio */}
              <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(255,149,0,0.05)' }}>
                <div className="text-sm font-bold" style={{ color: mostFrequentCardio ? '#FF9500' : '#555' }}>
                  {mostFrequentCardio ? mostFrequentCardio[0] : 'N/A'}
                </div>
                <div className="text-[10px] text-gray-500">
                  {mostFrequentCardio ? `${mostFrequentCardio[1]}x` : '—'}
                </div>
                <div className="text-[9px] text-gray-600">Cardio</div>
              </div>
              {/* Recovery */}
              <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(0,209,255,0.05)' }}>
                <div className="text-sm font-bold" style={{ color: mostFrequentRecovery ? '#00D1FF' : '#555' }}>
                  {mostFrequentRecovery ? mostFrequentRecovery[0] : 'N/A'}
                </div>
                <div className="text-[10px] text-gray-500">
                  {mostFrequentRecovery ? `${mostFrequentRecovery[1]}x` : '—'}
                </div>
                <div className="text-[9px] text-gray-600">Recovery</div>
              </div>
            </div>
          </div>

          {/* Weeks Won — the headline is how many weeks met the Winning Streak rule (utils/weekGoals);
              the three core goals sit under it and Recovery is a bonus line. */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-3">
              <SectionIcon type="streak" />
              <span className="text-[20px] font-semibold text-white" style={{ letterSpacing: '-0.3px' }}>Weeks Won</span>
            </div>
            <div className="p-4 rounded-xl flex items-center justify-between gap-3 mb-2" style={{ backgroundColor: 'rgba(255,215,0,0.08)', border: '1px solid rgba(255,215,0,0.2)' }}>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-white">🏆 {weeksData.all} of {weeksData.total} {weeksData.total === 1 ? 'week' : 'weeks'} won</div>
                <div className="text-[11px] text-gray-500">{weeksData.stepsTracked ? 'Strength + Cardio + Steps in the same week' : 'Strength + Cardio in the same week'}</div>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                {weeksData.won.map((w, i) => (
                  <div key={i} className="w-2.5 h-6 rounded-sm" style={{ backgroundColor: w ? '#FFD700' : 'rgba(255,215,0,0.15)' }} />
                ))}
              </div>
            </div>
            <div className={`grid gap-2 ${weeksData.stepsTracked ? 'grid-cols-3' : 'grid-cols-2'}`}>
              {[
                { key: 'lift', cat: 'lifts', label: 'Strength', color: '#00FF94' },
                { key: 'cardio', cat: 'cardio', label: 'Cardio', color: '#FF9500' },
                ...(weeksData.stepsTracked ? [{ key: 'steps', cat: 'steps', label: 'Steps', color: '#BF5AF2' }] : []),
              ].map(({ key, cat, label, color }) => (
                <div key={key} className="p-2.5 rounded-xl text-center" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  <div className="text-[11px] text-gray-400 flex items-center justify-center gap-1"><CategoryIcon category={cat} size={11} />{label}</div>
                  <div className="text-[15px] font-bold mt-0.5" style={{ color }}>{weeksData[key]}/{weeksData.total}</div>
                </div>
              ))}
            </div>
            {(goals.recoveryPerWeek ?? 2) > 0 && <div className="mt-2"><RecoveryBonusRow count={`${weeksData.recovery}/${weeksData.total}`} suffix="weeks" /></div>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MonthStatsModal;
