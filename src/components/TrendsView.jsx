import React, { useState, useRef, useMemo } from 'react';
import SectionIcon from './SectionIcon';
import ActivityIcon from './ActivityIcon';
import { triggerHaptic, ImpactStyle } from '../utils/haptics';
import { parseLocalDate, toLocalDateStr } from '../utils/dateHelpers';

const TrendsView = ({ activities = [], calendarData = {}, healthHistory = [], healthKitData = {}, isPro, onPresentPaywall }) => {
  const [metric, setMetric] = useState('calories');
  const [timeRange, setTimeRange] = useState('1M');
  const [selectedBar, setSelectedBar] = useState(null); // For detail view on click
  const [hoveredBar, setHoveredBar] = useState(null); // For hover highlighting
  const chartRef = useRef(null); // Ref for touch drag scrubbing
  const isDragging = useRef(false); // Track drag vs tap

  // Touch drag scrubbing helpers
  const getBarIndexFromTouch = (touchX) => {
    if (!chartRef.current) return null;
    const rect = chartRef.current.getBoundingClientRect();
    const relativeX = touchX - rect.left;
    const barCount = chartRef.current.children.length;
    if (barCount === 0) return null;
    const index = Math.floor((relativeX / rect.width) * barCount);
    return Math.max(0, Math.min(barCount - 1, index));
  };

  const lastDragIndex = useRef(null);
  const touchStartPos = useRef({ x: 0, y: 0 });
  const gestureDecided = useRef(false); // true once we know if it's a scrub or scroll
  const isScrubbing = useRef(false); // true if horizontal scrub gesture

  const prevSelectedBar = useRef(null); // Store selected bar before touch starts
  const touchHandledTap = useRef(false); // Prevent onClick from double-firing after touch tap

  const handleChartTouchStart = (e) => {
    isDragging.current = false;
    lastDragIndex.current = null;
    gestureDecided.current = false;
    isScrubbing.current = false;
    prevSelectedBar.current = selectedBar; // Remember what was selected before
    const touch = e.touches[0];
    touchStartPos.current = { x: touch.clientX, y: touch.clientY };
    // Don't highlight yet — wait for gesture to be decided
    const index = getBarIndexFromTouch(touch.clientX);
    if (index !== null) {
      lastDragIndex.current = index;
    }
  };

  const handleChartTouchMove = (e) => {
    const touch = e.touches[0];

    // Decide gesture direction once after a small movement threshold
    if (!gestureDecided.current) {
      const dx = Math.abs(touch.clientX - touchStartPos.current.x);
      const dy = Math.abs(touch.clientY - touchStartPos.current.y);
      if (dx < 5 && dy < 5) return; // Wait for more movement
      gestureDecided.current = true;
      isScrubbing.current = dx > dy; // Horizontal = scrub, Vertical = scroll
      if (!isScrubbing.current) {
        // It's a vertical scroll — don't touch any state, let scroll happen
        return;
      }
      // It's a horizontal scrub — now highlight the initial bar
      if (lastDragIndex.current !== null) {
        setSelectedBar(lastDragIndex.current);
        setHoveredBar(lastDragIndex.current);
      }
    }

    // If vertical scroll gesture, do nothing (allow native scroll)
    if (!isScrubbing.current) return;

    e.preventDefault(); // Only prevent scroll when horizontally scrubbing
    isDragging.current = true;
    const index = getBarIndexFromTouch(touch.clientX);
    if (index !== null && index !== lastDragIndex.current) {
      lastDragIndex.current = index;
      setSelectedBar(index);
      setHoveredBar(index);
      triggerHaptic(ImpactStyle.Light);
    }
  };

  const handleChartTouchEnd = () => {
    // If gesture was never decided (very short tap) or was a scrub, handle normally
    if (!gestureDecided.current) {
      // It was a tap — select the bar
      if (lastDragIndex.current !== null) {
        const tappedIndex = lastDragIndex.current;
        setSelectedBar(prevSelectedBar.current === tappedIndex ? null : tappedIndex);
        touchHandledTap.current = true; // Prevent onClick from double-firing
      }
    }
    setHoveredBar(null);
    lastDragIndex.current = null;
    gestureDecided.current = false;
    isScrubbing.current = false;
  };

  // Stacked bar colors for miles breakdown
  const milesColors = { ran: '#FF5757', biked: '#00D1FF', walked: '#00FF94' };

  // Get today's date string
  const todayStr = useMemo(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  }, []);

  // Helper to determine effective category of an activity
  const getActivityCategory = (activity) => {
    // If countToward is set (for Yoga/Pilates or custom activities), use that
    if (activity.countToward) {
      if (activity.countToward === 'strength') return 'lifting';
      return activity.countToward;
    }
    // Check customActivityCategory for "Other" activities
    if (activity.customActivityCategory) {
      if (activity.customActivityCategory === 'strength') return 'lifting';
      return activity.customActivityCategory;
    }
    if (activity.type === 'Strength Training') return 'lifting';
    if (['Running', 'Cycle', 'Sports', 'Stair Climbing', 'Elliptical'].includes(activity.type)) return 'cardio';
    if (['Cold Plunge', 'Sauna', 'Contrast Therapy', 'Massage', 'Chiropractic', 'Yoga', 'Pilates'].includes(activity.type)) return 'recovery';
    return 'other';
  };

  // Create a lookup map from healthHistory for quick date access
  // Override today's data with live healthKitData
  const healthDataByDate = useMemo(() => {
    const map = {};
    healthHistory.forEach(entry => {
      if (entry.date) {
        map[entry.date] = entry;
      }
    });
    // Always use live healthKitData for today
    if (healthKitData.todaySteps > 0 || healthKitData.todayCalories > 0) {
      map[todayStr] = {
        date: todayStr,
        steps: healthKitData.todaySteps || 0,
        calories: healthKitData.todayCalories || 0
      };
    }
    return map;
  }, [healthHistory, healthKitData.todaySteps, healthKitData.todayCalories, todayStr]);

  // Generate data points based on time range
  const generateTrendData = () => {
    const today = new Date();
    const data = [];
    
    let daysToShow;
    let groupBy; // 'day', 'week', or 'month'
    
    switch (timeRange) {
      case '1W':
        daysToShow = 7;
        groupBy = 'day';
        break;
      case '1M':
        daysToShow = 30;
        groupBy = 'day';
        break;
      case '3M':
        daysToShow = 90;
        groupBy = 'week';
        break;
      case '6M':
        daysToShow = 180;
        groupBy = 'week';
        break;
      case '1Y':
        daysToShow = 365;
        groupBy = 'month';
        break;
      case 'All':
        // Find earliest activity
        if (activities.length > 0) {
          const dates = activities.map(a => parseLocalDate(a.date)).sort((a, b) => a - b);
          const earliest = dates[0];
          daysToShow = Math.ceil((today - earliest) / (1000 * 60 * 60 * 24)) + 1;
          groupBy = daysToShow > 180 ? 'month' : daysToShow > 60 ? 'week' : 'day';
        } else {
          daysToShow = 30;
          groupBy = 'day';
        }
        break;
      default:
        daysToShow = 30;
        groupBy = 'day';
    }

    // Generate date buckets
    if (groupBy === 'day') {
      for (let i = daysToShow - 1; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        // Use activities array (source of truth) instead of calendarData
        const dayActivities = activities.filter(a => a.date === dateStr);
        const healthData = healthDataByDate[dateStr];

        let value = 0;
        if (metric === 'calories') {
          // Use HealthKit calories directly — wearables already track all active energy
          value = healthData?.calories || 0;
        } else if (metric === 'steps') {
          // Use steps from HealthKit
          value = healthData?.steps || 0;
        } else if (metric === 'miles') {
          // Include all activities with distance (Running, Cycling, Walking, etc.)
          value = dayActivities
            .reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);
        }

        const point = {
          label: date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
          shortLabel: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          value,
          date: dateStr
        };

        if (metric === 'miles') {
          point.milesRan = dayActivities.filter(a => a.type === 'Running').reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);
          point.milesBiked = dayActivities.filter(a => a.type === 'Cycle').reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);
          point.milesWalked = dayActivities.filter(a => a.type === 'Walking' || a.type === 'Hiking').reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);
        }

        data.push(point);
      }
    } else if (groupBy === 'week') {
      const weeks = Math.ceil(daysToShow / 7);
      for (let w = weeks - 1; w >= 0; w--) {
        const weekEnd = new Date(today);
        weekEnd.setDate(weekEnd.getDate() - (w * 7));
        const weekStart = new Date(weekEnd);
        weekStart.setDate(weekStart.getDate() - 6);

        let value = 0;
        let weekRan = 0, weekBiked = 0, weekWalked = 0;
        for (let d = 0; d < 7; d++) {
          const date = new Date(weekStart);
          date.setDate(date.getDate() + d);
          const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          const healthData = healthDataByDate[dateStr];
          // Use activities array (source of truth) instead of calendarData
          const dayActivities = activities.filter(a => a.date === dateStr);

          if (metric === 'calories') {
            // Use HealthKit calories directly — wearables already track all active energy
            value += healthData?.calories || 0;
          } else if (metric === 'steps') {
            // Use steps from HealthKit
            value += healthData?.steps || 0;
          } else if (metric === 'miles') {
            // Include all activities with distance (Running, Cycling, Walking, etc.)
            value += dayActivities
              .reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);
            weekRan += dayActivities.filter(a => a.type === 'Running').reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);
            weekBiked += dayActivities.filter(a => a.type === 'Cycle').reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);
            weekWalked += dayActivities.filter(a => a.type === 'Walking' || a.type === 'Hiking').reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);
          }
        }

        if (metric === 'steps') value = Math.round(value);

        // Create label with date range for weekly view
        const weekEndDate = new Date(weekStart);
        weekEndDate.setDate(weekStart.getDate() + 6);
        const startLabel = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const endLabel = weekStart.getMonth() === weekEndDate.getMonth()
          ? weekEndDate.getDate() // Same month: "Dec 15 - 21"
          : weekEndDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); // Different month: "Dec 29 - Jan 4"

        const weekPoint = {
          label: `${startLabel} - ${endLabel}`,
          shortLabel: weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          value,
          date: toLocalDateStr(weekStart)
        };
        if (metric === 'miles') {
          weekPoint.milesRan = weekRan;
          weekPoint.milesBiked = weekBiked;
          weekPoint.milesWalked = weekWalked;
        }
        data.push(weekPoint);
      }
    } else if (groupBy === 'month') {
      const months = Math.ceil(daysToShow / 30);
      for (let m = months - 1; m >= 0; m--) {
        const monthDate = new Date(today.getFullYear(), today.getMonth() - m, 1);
        const monthEnd = new Date(today.getFullYear(), today.getMonth() - m + 1, 0);

        let value = 0;
        let monthRan = 0, monthBiked = 0, monthWalked = 0;
        for (let d = 1; d <= monthEnd.getDate(); d++) {
          const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), d);
          if (date > today) break;
          const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          const healthData = healthDataByDate[dateStr];
          // Use activities array (source of truth) instead of calendarData
          const dayActivities = activities.filter(a => a.date === dateStr);

          if (metric === 'calories') {
            // Use HealthKit calories directly — wearables already track all active energy
            value += healthData?.calories || 0;
          } else if (metric === 'steps') {
            // Use steps from HealthKit
            value += healthData?.steps || 0;
          } else if (metric === 'miles') {
            // Include all activities with distance (Running, Cycling, Walking, etc.)
            value += dayActivities
              .reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);
            monthRan += dayActivities.filter(a => a.type === 'Running').reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);
            monthBiked += dayActivities.filter(a => a.type === 'Cycle').reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);
            monthWalked += dayActivities.filter(a => a.type === 'Walking' || a.type === 'Hiking').reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);
          }
        }

        if (metric === 'steps') value = Math.round(value);

        const monthPoint = {
          label: monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
          shortLabel: monthDate.toLocaleDateString('en-US', { month: 'short' }),
          value,
          date: toLocalDateStr(monthDate)
        };
        if (metric === 'miles') {
          monthPoint.milesRan = monthRan;
          monthPoint.milesBiked = monthBiked;
          monthPoint.milesWalked = monthWalked;
        }
        data.push(monthPoint);
      }
    }
    
    return data;
  };

  const trendData = useMemo(() => generateTrendData(), [activities, metric, timeRange, healthDataByDate, todayStr]);
  const maxValue = trendData.length > 0 ? trendData.reduce((max, d) => Math.max(max, d.value), 1) : 1;
  const total = trendData.reduce((sum, d) => sum + d.value, 0);

  // Calculate average based on the number of bars shown (matches chart grouping)
  let avg = 0;
  const barsWithData = trendData.filter(d => d.value > 0).length;
  if (barsWithData > 0) {
    avg = total / barsWithData;
  }

  const metricConfig = {
    calories: { label: 'Calories', icon: '🔥', unit: 'cal', color: '#FF9500' },
    steps: { label: 'Steps', icon: '👟', unit: 'steps', color: '#00D1FF' },
    miles: { label: 'Miles', icon: '📍', unit: 'mi', color: '#00FF94' }
  };

  const config = metricConfig[metric] || metricConfig['calories'];

  return (
    <div className="mx-4">
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <SectionIcon type="trending" />
          <span className="text-[20px] font-semibold text-white" style={{ letterSpacing: '-0.3px' }}>Trends</span>
        </div>
        <p className="text-[13px] -mt-1 pl-[30px]" style={{ color: '#777' }}>Track your progress over time</p>
      </div>

      {/* Metric Toggle */}
      <div className="flex gap-2 p-1 rounded-xl mb-4 max-w-md mx-auto" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
        {Object.entries(metricConfig).map(([key, cfg]) => (
          <button
            key={key}
            onClick={() => {
              setMetric(key);
              setSelectedBar(null);
            }}
            className="flex-1 py-2 rounded-lg text-xs font-medium transition-all duration-200 flex items-center justify-center gap-1"
            style={{
              backgroundColor: metric === key ? 'rgba(255,255,255,0.1)' : 'transparent',
              color: metric === key ? cfg.color : 'rgba(255,255,255,0.5)'
            }}
          >
            <span>{cfg.icon}</span>
            {cfg.label}
          </button>
        ))}
      </div>

      {/* Time Range Toggle */}
      <div className="relative flex gap-1 p-1 rounded-xl mb-4 max-w-sm mx-auto" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
        {/* Sliding pill indicator */}
        <div 
          className="absolute top-1 bottom-1 rounded-md transition-all duration-300 ease-out"
          style={{ 
            backgroundColor: 'rgba(255,255,255,0.1)',
            width: 'calc((100% - 8px) / 5)',
            left: (() => {
              const tabs = ['1W', '1M', '3M', '6M', '1Y'];
              const index = tabs.indexOf(timeRange);
              return `calc(4px + ${index} * (100% - 8px) / 5)`;
            })()
          }}
        />
        {['1W', '1M', '3M', '6M', '1Y'].map((range) => {
          const isLocked = !isPro && !['1W', '1M'].includes(range);
          return (
            <button
              key={range}
              onClick={() => {
                if (isLocked) {
                  onPresentPaywall?.();
                  return;
                }
                setTimeRange(range);
                setSelectedBar(null);
              }}
              className="flex-1 py-1.5 rounded-md text-[10px] font-medium transition-colors duration-200 relative z-10"
              style={{
                color: timeRange === range ? 'white' : isLocked ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.5)'
              }}
            >
              {range} {isLocked ? '🔒' : ''}
            </button>
          );
        })}
      </div>

      {/* Chart */}
      <div className="p-4 rounded-2xl mb-4" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
        {/* Tooltip - fixed height container to prevent layout shift */}
        <div style={{ minHeight: metric === 'miles' ? '90px' : '72px' }}>
          {(hoveredBar !== null || selectedBar !== null) && trendData[hoveredBar !== null ? hoveredBar : selectedBar] ? (() => {
            const activePoint = trendData[hoveredBar !== null ? hoveredBar : selectedBar];
            return (
              <div
                className="p-3 rounded-xl text-center transition-all duration-200"
                style={{
                  backgroundColor: `${config.color}15`,
                  border: `1px solid ${config.color}40`
                }}
              >
                <div className="text-sm font-bold" style={{ color: config.color }}>
                  {activePoint.label}
                </div>
                <div className="text-xl font-black text-white mt-1">
                  {metric === 'miles'
                    ? activePoint.value.toFixed(1)
                    : activePoint.value.toLocaleString()
                  } {config.unit}
                </div>
                {metric === 'miles' && activePoint.value > 0 && (
                  <div className="flex items-center justify-center gap-3 mt-1.5 text-[11px]">
                    {(activePoint.milesRan || 0) > 0 && (
                      <span style={{ color: milesColors.ran }}>🏃 {activePoint.milesRan.toFixed(1)}</span>
                    )}
                    {(activePoint.milesBiked || 0) > 0 && (
                      <span style={{ color: milesColors.biked }}>🚴 {activePoint.milesBiked.toFixed(1)}</span>
                    )}
                    {(activePoint.milesWalked || 0) > 0 && (
                      <span style={{ color: milesColors.walked }}>🚶 {activePoint.milesWalked.toFixed(1)}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })() : (
            <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
              <div className="text-sm text-gray-500">Tap a bar to see details</div>
              <div className="text-xl font-black text-gray-600 mt-1">—</div>
            </div>
          )}
        </div>
        
        {/* Chart Area */}
        <div
          ref={chartRef}
          className="h-40 flex items-end gap-0.5 mb-2"
          style={{ minHeight: '160px', touchAction: 'pan-y' }}
          onMouseLeave={() => setHoveredBar(null)}
          onTouchStart={handleChartTouchStart}
          onTouchMove={handleChartTouchMove}
          onTouchEnd={handleChartTouchEnd}
        >
          {trendData.length > 0 ? trendData.map((point, i) => {
            const heightPercent = maxValue > 0 ? (point.value / maxValue) * 100 : 0;
            const isHighlighted = hoveredBar !== null ? hoveredBar === i : selectedBar === i;

            // Stacked bar segments for miles
            const isMiles = metric === 'miles';
            const ranPct = isMiles && maxValue > 0 ? ((point.milesRan || 0) / maxValue) * 100 : 0;
            const bikedPct = isMiles && maxValue > 0 ? ((point.milesBiked || 0) / maxValue) * 100 : 0;
            const walkedPct = isMiles && maxValue > 0 ? ((point.milesWalked || 0) / maxValue) * 100 : 0;
            const totalPct = ranPct + bikedPct + walkedPct;

            return (
              <button
                key={i}
                className="flex-1 flex flex-col justify-end h-full cursor-pointer bg-transparent border-none p-0"
                onMouseEnter={() => setHoveredBar(i)}
                onClick={() => { if (!isDragging.current && !touchHandledTap.current) setSelectedBar(selectedBar === i ? null : i); touchHandledTap.current = false; }}
                type="button"
              >
                {isMiles ? (
                  /* Stacked bar for miles breakdown */
                  <div
                    className="w-full flex flex-col justify-end pointer-events-none transition-all duration-200"
                    style={{
                      height: `${Math.max(heightPercent, 2)}%`,
                      minHeight: point.value > 0 ? '4px' : '2px',
                      opacity: isHighlighted ? 1 : 0.6,
                      transform: isHighlighted ? 'scaleX(1.1)' : 'scaleX(1)',
                    }}
                  >
                    {(point.milesRan || 0) > 0 && (
                      <div className="w-full rounded-t-sm" style={{
                        flex: `0 0 ${totalPct > 0 ? ranPct / totalPct * 100 : 0}%`,
                        backgroundColor: milesColors.ran,
                        minHeight: '1px'
                      }} />
                    )}
                    {(point.milesBiked || 0) > 0 && (
                      <div className="w-full" style={{
                        flex: `0 0 ${totalPct > 0 ? bikedPct / totalPct * 100 : 0}%`,
                        backgroundColor: milesColors.biked,
                        minHeight: '1px',
                        ...((point.milesRan || 0) === 0 ? { borderRadius: '2px 2px 0 0' } : {})
                      }} />
                    )}
                    {(point.milesWalked || 0) > 0 && (
                      <div className="w-full" style={{
                        flex: `0 0 ${totalPct > 0 ? walkedPct / totalPct * 100 : 0}%`,
                        backgroundColor: milesColors.walked,
                        minHeight: '1px',
                        ...((point.milesRan || 0) === 0 && (point.milesBiked || 0) === 0 ? { borderRadius: '2px 2px 0 0' } : {})
                      }} />
                    )}
                  </div>
                ) : (
                  /* Single bar for other metrics */
                  <div
                    className="w-full rounded-t-sm transition-all duration-200 pointer-events-none"
                    style={{
                      height: `${Math.max(heightPercent, 2)}%`,
                      backgroundColor: config.color,
                      opacity: isHighlighted ? 1 : 0.6,
                      minHeight: point.value > 0 ? '4px' : '2px',
                      transform: isHighlighted ? 'scaleX(1.1)' : 'scaleX(1)',
                      boxShadow: isHighlighted ? `0 0 10px ${config.color}50` : 'none'
                    }}
                  />
                )}
              </button>
            );
          }) : (
            <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">
              No data available
            </div>
          )}
        </div>
        
        {/* X-axis labels */}
        {trendData.length > 0 && (
          <div className="flex gap-0.5">
            {trendData.map((point, i) => {
              const showLabel = trendData.length <= 7 ||
                (trendData.length <= 14 && i % 2 === 0) ||
                (trendData.length > 14 && (i === 0 || i === trendData.length - 1 || i % Math.ceil(trendData.length / 5) === 0));
              const isHighlighted = hoveredBar !== null ? hoveredBar === i : selectedBar === i;

              return (
                <div key={i} className="flex-1 text-center">
                  {(showLabel || isHighlighted) && (
                    <span
                      className="text-[8px] transition-all duration-200"
                      style={{
                        color: isHighlighted ? config.color : 'rgba(255,255,255,0.5)',
                        fontWeight: isHighlighted ? 'bold' : 'normal'
                      }}
                    >
                      {point.shortLabel || point.label}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Stacked bar legend for miles */}
        {metric === 'miles' && (
          <div className="flex items-center justify-center gap-4 mt-2 mb-1">
            <span className="flex items-center gap-1.5 text-[10px] text-gray-400">
              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: milesColors.ran }} /> Ran
            </span>
            <span className="flex items-center gap-1.5 text-[10px] text-gray-400">
              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: milesColors.biked }} /> Biked
            </span>
            <span className="flex items-center gap-1.5 text-[10px] text-gray-400">
              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: milesColors.walked }} /> Walked
            </span>
          </div>
        )}
      </div>

      {/* Summary Stats */}
      {(() => {
        const activeBar = hoveredBar !== null ? hoveredBar : selectedBar;
        const activeValue = activeBar !== null && trendData[activeBar] ? trendData[activeBar].value : null;
        const vsAvgPercent = activeValue !== null && avg > 0
          ? Math.round(((activeValue - avg) / avg) * 100)
          : null;

        return (
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
              <div className="text-lg font-black" style={{ color: config.color }}>
                {metric === 'miles' ? total.toFixed(1) : total.toLocaleString()}
              </div>
              <div className="text-[10px] text-gray-400">Total</div>
            </div>
            <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
              <div className="text-lg font-black" style={{ color: config.color }}>
                {metric === 'miles' ? avg.toFixed(1) : Math.round(avg).toLocaleString()}
              </div>
              <div className="text-[10px] text-gray-400">Average</div>
            </div>
            <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
              {vsAvgPercent !== null ? (
                <>
                  <div className="text-lg font-black" style={{ color: vsAvgPercent >= 0 ? '#00FF94' : '#FF453A' }}>
                    {vsAvgPercent >= 0 ? '+' : ''}{vsAvgPercent}%
                  </div>
                  <div className="text-[10px] text-gray-400">vs Avg</div>
                </>
              ) : (
                <>
                  <div className="text-lg font-black text-gray-600">—</div>
                  <div className="text-[10px] text-gray-400">vs Avg</div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* Selected Day Activities - only shows on click */}
      {selectedBar !== null && trendData[selectedBar] && (() => {
        const selectedPoint = trendData[selectedBar];
        const dateStr = selectedPoint.date;
        // Get full activity data from activities array
        const fullDayActivities = activities.filter(a => a.date === dateStr);
        const lifts = fullDayActivities.filter(a => getActivityCategory(a) === 'lifting');
        const cardioActivities = fullDayActivities.filter(a => getActivityCategory(a) === 'cardio');
        const recoveryActivities = fullDayActivities.filter(a => getActivityCategory(a) === 'recovery');
        const nonCardioWalks = fullDayActivities.filter(a =>
          a.type === 'Walking' && !a.countToward
        );

        // Get HealthKit data for this day
        const dayHealthData = healthDataByDate[dateStr];
        // Use HealthKit calories directly — wearables already track all active energy
        const dayCalories = dayHealthData?.calories || 0;
        const daySteps = dayHealthData?.steps || 0;
        const dayMiles = fullDayActivities.reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);
        const totalDuration = fullDayActivities.reduce((sum, a) => sum + (a.duration || 0), 0);

        return (
          <div className="p-4 rounded-xl mb-4" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-semibold text-white">{selectedPoint.label}</div>
              </div>
              <button
                onClick={() => setSelectedBar(null)}
                className="text-gray-400 text-xs hover:text-white"
              >
                Close
              </button>
            </div>

            {fullDayActivities.length > 0 ? (
              <div className="space-y-3">
                {/* Summary Stats */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 rounded-lg text-center" style={{ backgroundColor: 'rgba(0,255,148,0.1)' }}>
                    <div className="text-lg font-black" style={{ color: '#00FF94' }}>{lifts.length}</div>
                    <div className="text-[9px] text-gray-400">💪 Strength</div>
                  </div>
                  <div className="p-2 rounded-lg text-center" style={{ backgroundColor: 'rgba(255,149,0,0.1)' }}>
                    <div className="text-lg font-black" style={{ color: '#FF9500' }}>{cardioActivities.length}</div>
                    <div className="text-[9px] text-gray-400">❤️‍🔥 Cardio</div>
                  </div>
                  <div className="p-2 rounded-lg text-center" style={{ backgroundColor: 'rgba(0,209,255,0.1)' }}>
                    <div className="text-lg font-black" style={{ color: '#00D1FF' }}>{recoveryActivities.length}</div>
                    <div className="text-[9px] text-gray-400">🧊 Recovery</div>
                  </div>
                </div>

                {/* Daily Totals */}
                <div className="grid grid-cols-4 gap-2">
                  <div className="p-2 rounded-lg text-center" style={{ backgroundColor: 'rgba(255,149,0,0.1)' }}>
                    <div className="text-sm font-bold" style={{ color: '#FF9500' }}>{dayCalories.toLocaleString()}</div>
                    <div className="text-[9px] text-gray-400">Calories</div>
                  </div>
                  <div className="p-2 rounded-lg text-center" style={{ backgroundColor: 'rgba(255,107,157,0.1)' }}>
                    <div className="text-sm font-bold" style={{ color: '#FF6B9D' }}>{daySteps.toLocaleString()}</div>
                    <div className="text-[9px] text-gray-400">Steps</div>
                  </div>
                  <div className="p-2 rounded-lg text-center" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    <div className="text-sm font-bold text-white">{dayMiles.toFixed(1)}</div>
                    <div className="text-[9px] text-gray-400">Miles</div>
                  </div>
                  <div className="p-2 rounded-lg text-center" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    <div className="text-sm font-bold text-white">{totalDuration}</div>
                    <div className="text-[9px] text-gray-400">Minutes</div>
                  </div>
                </div>

                {/* Activities List */}
                <div className="pt-2 border-t border-white/10">
                  <div className="text-xs text-gray-400 mb-2">Activities</div>
                  <div className="space-y-2">
                    {fullDayActivities.map((activity, idx) => (
                      <div key={idx} className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                        <div className="flex items-center gap-2">
                          <ActivityIcon type={activity.type} subtype={activity.subtype} size={14} sportEmoji={activity.sportEmoji} customEmoji={activity.customEmoji} customIcon={activity.customIcon} />
                          <span className="text-sm text-white font-medium">
                            {activity.subtype || activity.type}
                          </span>
                        </div>
                        <div className="flex gap-3 mt-1 text-[10px] text-gray-400">
                          {activity.duration && <span>{activity.duration} min</span>}
                          {activity.distance && <span>{parseFloat(activity.distance).toFixed(2)} mi</span>}
                          {activity.calories && <span>{activity.calories} cal</span>}
                          {activity.avgHr && <span>HR: {activity.avgHr}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-4">
                <div className="text-gray-500 text-sm">No activities logged</div>
              </div>
            )}
          </div>
        );
      })()}

      {activities.length === 0 && (
        <div className="p-6 rounded-xl text-center" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
          <div className="text-4xl mb-3">📈</div>
          <p className="text-white font-medium text-sm">Start building your trends!</p>
          <p className="text-gray-500 text-xs mt-1">Log workouts to see your progress over time</p>
        </div>
      )}
    </div>
  );
};

export default TrendsView;
