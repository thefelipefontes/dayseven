import React, { useState, useEffect } from 'react';
import SectionIcon from './SectionIcon';
import { normalizeFocusAreas } from '../utils/focusAreas';
import { initialUserData } from '../utils/initialUserData';

const MonthStatsModal = ({ isOpen, onClose, monthData, monthLabel, onShare, userData, activities, healthHistory }) => {
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

  // Helper to determine effective category respecting countToward
  const getMonthActivityCategory = (a) => {
    if (a.countToward) {
      if (a.countToward === 'strength') return 'lifting';
      return a.countToward;
    }
    if (a.customActivityCategory) {
      if (a.customActivityCategory === 'strength') return 'lifting';
      return a.customActivityCategory;
    }
    if (a.type === 'Strength Training') return 'lifting';
    if (['Running', 'Cycle', 'Sports', 'Stair Climbing', 'Elliptical'].includes(a.type)) return 'cardio';
    if (['Cold Plunge', 'Sauna', 'Contrast Therapy', 'Massage', 'Chiropractic', 'Yoga', 'Pilates'].includes(a.type)) return 'recovery';
    return 'other';
  };

  // Session counts
  const liftsCount = monthActivities.filter(a => getMonthActivityCategory(a) === 'lifting').length;
  const cardioCount = monthActivities.filter(a => getMonthActivityCategory(a) === 'cardio').length;
  const recoveryCount = monthActivities.filter(a => getMonthActivityCategory(a) === 'recovery').length;

  // Calculate totals
  const totalCalories = monthData?.calories || 0;
  const totalMiles = monthActivities
    .filter(a => a.distance)
    .reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);
  const totalSteps = monthData?.steps || 0;
  const daysActive = new Set(monthActivities.map(a => a.date)).size;

  // Calculate weeks hitting goals
  const calculateWeeksHittingGoals = () => {
    if (monthDates.length === 0) return { lift: 0, cardio: 0, recovery: 0, all: 0, total: 0 };

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

    let liftWeeks = 0, cardioWeeks = 0, recoveryWeeks = 0, allGoalsWeeks = 0;
    const totalWeeks = Object.keys(weekMap).length;

    Object.values(weekMap).forEach(weekDates => {
      const weekActivities = monthActivities.filter(a => weekDates.includes(a.date));

      const weekLifts = weekActivities.filter(a => getMonthActivityCategory(a) === 'lifting').length;
      const weekCardio = weekActivities.filter(a => getMonthActivityCategory(a) === 'cardio').length;
      const weekRecovery = weekActivities.filter(a => getMonthActivityCategory(a) === 'recovery').length;

      const liftMet = weekLifts >= goals.liftsPerWeek;
      const cardioMet = weekCardio >= goals.cardioPerWeek;
      const recoveryMet = weekRecovery >= goals.recoveryPerWeek;

      if (liftMet) liftWeeks++;
      if (cardioMet) cardioWeeks++;
      if (recoveryMet) recoveryWeeks++;
      if (liftMet && cardioMet && recoveryMet) allGoalsWeeks++;
    });

    return { lift: liftWeeks, cardio: cardioWeeks, recovery: recoveryWeeks, all: allGoalsWeeks, total: totalWeeks };
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

  // Longest session
  const longestSession = monthActivities.reduce((best, a) => {
    const dur = parseInt(a.duration) || 0;
    if (!best || dur > best.duration) {
      return { duration: dur, type: a.type };
    }
    return best;
  }, null);

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
              <div className="text-[10px] text-gray-400">💪 Strength</div>
            </div>
            <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(255,149,0,0.1)' }}>
              <div className="text-2xl font-black" style={{ color: '#FF9500' }}>{cardioCount}</div>
              <div className="text-[10px] text-gray-400">❤️‍🔥 Cardio</div>
            </div>
            <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(0,209,255,0.1)' }}>
              <div className="text-2xl font-black" style={{ color: '#00D1FF' }}>{recoveryCount}</div>
              <div className="text-[10px] text-gray-400">🧊 Recovery</div>
            </div>
          </div>

          {/* Month Totals */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-3">
              <SectionIcon type="chart" />
              <span className="text-[20px] font-semibold text-white" style={{ letterSpacing: '-0.3px' }}>Month Totals</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                <div className="text-lg font-black">{totalCalories.toLocaleString()}</div>
                <div className="text-[10px] text-gray-400">🔥 Calories Burned</div>
              </div>
              <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                <div className="text-lg font-black">{totalMiles.toFixed(1)} mi</div>
                <div className="text-[10px] text-gray-400">❤️‍🔥 Distance</div>
              </div>
              <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                <div className="text-lg font-black">{(totalSteps / 1000).toFixed(0)}k</div>
                <div className="text-[10px] text-gray-400">👟 Steps</div>
              </div>
              <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                <div className="text-lg font-black">{daysActive}</div>
                <div className="text-[10px] text-gray-400">📅 Days Active</div>
              </div>
            </div>
          </div>

          {/* Highlights - always show all 3 cards */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-3">
              <SectionIcon type="trophy" />
              <span className="text-[20px] font-semibold text-white" style={{ letterSpacing: '-0.3px' }}>Highlights</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {/* Best Burn */}
              <div className="p-2.5 rounded-xl text-center" style={{ backgroundColor: 'rgba(255,69,58,0.1)' }}>
                <div className="text-base font-black" style={{ color: bestBurn?.calories > 0 ? '#FF453A' : '#555' }}>
                  {bestBurn?.calories > 0 ? bestBurn.calories.toLocaleString() : 'N/A'}
                </div>
                <div className="text-[9px] text-gray-400">🔥 Best Burn</div>
                <div className="text-[9px] text-gray-500">{bestBurn?.calories > 0 ? bestBurn.type : '—'}</div>
              </div>
              {/* Longest Session */}
              <div className="p-2.5 rounded-xl text-center" style={{ backgroundColor: 'rgba(147,112,219,0.1)' }}>
                <div className="text-base font-black" style={{ color: longestSession?.duration > 0 ? '#9370DB' : '#555' }}>
                  {longestSession?.duration > 0 ? `${longestSession.duration} min` : 'N/A'}
                </div>
                <div className="text-[9px] text-gray-400">⏱️ Longest</div>
                <div className="text-[9px] text-gray-500">{longestSession?.duration > 0 ? longestSession.type : '—'}</div>
              </div>
              {/* Furthest Distance */}
              <div className="p-2.5 rounded-xl text-center" style={{ backgroundColor: 'rgba(50,205,50,0.1)' }}>
                <div className="text-base font-black" style={{ color: furthestDistance?.distance > 0 ? '#32CD32' : '#555' }}>
                  {furthestDistance?.distance > 0 ? `${furthestDistance.distance.toFixed(2)} mi` : 'N/A'}
                </div>
                <div className="text-[9px] text-gray-400">📍 Furthest</div>
                <div className="text-[9px] text-gray-500">{furthestDistance?.distance > 0 ? furthestDistance.type : '—'}</div>
              </div>
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

          {/* Weeks Hitting Goals */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-3">
              <SectionIcon type="streak" />
              <span className="text-[20px] font-semibold text-white" style={{ letterSpacing: '-0.3px' }}>Weeks Hitting Goals</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 rounded-xl flex items-center justify-between" style={{
                backgroundColor: weeksData.lift === weeksData.total && weeksData.total > 0 ? 'rgba(0,255,148,0.1)' : 'rgba(255,255,255,0.05)',
                border: weeksData.lift === weeksData.total && weeksData.total > 0 ? '1px solid rgba(0,255,148,0.2)' : 'none'
              }}>
                <div>
                  <span className="text-xs">💪 Strength</span>
                  <div className="text-[10px] text-gray-500">{goals.liftsPerWeek}+ per week</div>
                </div>
                <span className="text-sm font-bold" style={{ color: '#00FF94' }}>
                  {weeksData.lift}/{weeksData.total}
                </span>
              </div>
              <div className="p-3 rounded-xl flex items-center justify-between" style={{
                backgroundColor: weeksData.cardio === weeksData.total && weeksData.total > 0 ? 'rgba(255,149,0,0.1)' : 'rgba(255,255,255,0.05)',
                border: weeksData.cardio === weeksData.total && weeksData.total > 0 ? '1px solid rgba(255,149,0,0.2)' : 'none'
              }}>
                <div>
                  <span className="text-xs">❤️‍🔥 Cardio</span>
                  <div className="text-[10px] text-gray-500">{goals.cardioPerWeek}+ per week</div>
                </div>
                <span className="text-sm font-bold" style={{ color: '#FF9500' }}>
                  {weeksData.cardio}/{weeksData.total}
                </span>
              </div>
              <div className="p-3 rounded-xl flex items-center justify-between" style={{
                backgroundColor: weeksData.recovery === weeksData.total && weeksData.total > 0 ? 'rgba(0,209,255,0.1)' : 'rgba(255,255,255,0.05)',
                border: weeksData.recovery === weeksData.total && weeksData.total > 0 ? '1px solid rgba(0,209,255,0.2)' : 'none'
              }}>
                <div>
                  <span className="text-xs">🧊 Recovery</span>
                  <div className="text-[10px] text-gray-500">{goals.recoveryPerWeek}+ per week</div>
                </div>
                <span className="text-sm font-bold" style={{ color: '#00D1FF' }}>
                  {weeksData.recovery}/{weeksData.total}
                </span>
              </div>
              <div className="p-3 rounded-xl flex items-center justify-between" style={{
                backgroundColor: weeksData.all === weeksData.total && weeksData.total > 0 ? 'rgba(255,215,0,0.1)' : 'rgba(255,255,255,0.05)',
                border: weeksData.all === weeksData.total && weeksData.total > 0 ? '1px solid rgba(255,215,0,0.2)' : 'none'
              }}>
                <div>
                  <span className="text-xs">🏆 All Goals</span>
                  <div className="text-[10px] text-gray-500">Perfect weeks</div>
                </div>
                <span className="text-sm font-bold" style={{ color: '#FFD700' }}>
                  {weeksData.all}/{weeksData.total}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MonthStatsModal;
