import React, { useState, useRef, useMemo } from 'react';
import SectionIcon from './SectionIcon';
import ActivityIcon from './ActivityIcon';
import CategoryIcon from './CategoryIcon';
import { triggerHaptic, ImpactStyle } from '../utils/haptics';
import { parseLocalDate, toLocalDateStr } from '../utils/dateHelpers';
import { getActivityCategory } from '../utils/activityCategory';
import { manualCaloriesForDate, manualCaloriesInRange } from '../utils/calories';
import { milesToDisplay, unitLabel } from '../utils/distance';

const CAPS = { fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8a8a8a' };
const CARD = {
  borderRadius: 22,
  background: 'linear-gradient(180deg, rgba(255,255,255,0.065), rgba(255,255,255,0.035))',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), inset 0 0 0 1px rgba(255,255,255,0.035)',
};
const ArrowUp = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>);
const ArrowDown = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8a8a8a" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12l7 7 7-7" /></svg>);

const TrendsView = ({ activities = [], calendarData = {}, healthHistory = [], healthKitData = {}, isPro, onPresentPaywall, distanceUnit = 'mi' }) => {
  // Distances are stored in miles; convert only for display (bar heights are ratios).
  const dist = (miles) => milesToDisplay(miles, distanceUnit);
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
  const milesColors = { ran: '#FF9500', biked: 'rgba(255,149,0,0.55)', walked: 'rgba(255,149,0,0.28)' };

  // Get today's date string
  const todayStr = useMemo(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  }, []);

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
          // HealthKit active energy + hand-entered calories it doesn't know about
          value = (healthData?.calories || 0) + manualCaloriesForDate(activities, dateStr);
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
          date: dateStr,
          endDate: dateStr
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
            // HealthKit active energy + hand-entered calories it doesn't know about
            value += (healthData?.calories || 0) + manualCaloriesForDate(activities, dateStr);
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
          date: toLocalDateStr(weekStart),
          endDate: toLocalDateStr(weekEndDate)
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
            // HealthKit active energy + hand-entered calories it doesn't know about
            value += (healthData?.calories || 0) + manualCaloriesForDate(activities, dateStr);
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
          date: toLocalDateStr(monthDate),
          // Clamp to today so the in-progress month doesn't claim future days.
          endDate: toLocalDateStr(monthEnd > today ? today : monthEnd)
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
    calories: { label: 'Calories', cat: 'calories', unit: 'cal', color: '#FF6B6B' },
    steps: { label: 'Steps', cat: 'steps', unit: 'steps', color: '#BF5AF2' },
    miles: { label: 'Distance', unit: unitLabel(distanceUnit), color: '#FF9500' }
  };

  const config = metricConfig[metric] || metricConfig['calories'];

  return (
    // Profile's Stats container already supplies the side margin
    <div>
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
              color: metric === key ? '#fff' : '#888'
            }}
          >
            <span className="flex">{cfg.cat ? <CategoryIcon category={cfg.cat} size={13} /> : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#FF9500" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" /><path d="M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0z" /></svg>
            )}</span>
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

      {/* Chart card (Nov 2026 redesign, mocks/mock-profile-extras.html trendsView('new')):
          the tapped bar's value is the one big number, with its change vs the average beside it. */}
      {(() => {
        const isMiles = metric === 'miles';
        const fmt = (n) => (isMiles ? dist(n).toFixed(1) : Math.round(n).toLocaleString());
        const lastIdx = trendData.length - 1;
        const activeIdx = hoveredBar !== null ? hoveredBar : selectedBar !== null ? selectedBar : lastIdx;
        const activePoint = activeIdx >= 0 ? trendData[activeIdx] : null;
        const first = trendData[0];
        const spanDays = first?.endDate ? Math.round((parseLocalDate(first.endDate) - parseLocalDate(first.date)) / 86400000) + 1 : 1;
        const bucket = spanDays <= 1 ? 'daily' : spanDays <= 7 ? 'weekly' : 'monthly';
        const perUnit = { daily: 'day', weekly: 'wk', monthly: 'mo' }[bucket];
        const vsAvg = activePoint && avg > 0 ? Math.round(((activePoint.value - avg) / avg) * 100) : null;
        const avgPct = maxValue > 0 ? Math.min(100, (avg / maxValue) * 100) : 0;
        return (
          <div className="mb-4" style={{ ...CARD, padding: '18px 18px 16px' }}>
            <div className="flex items-end justify-between" style={{ marginBottom: isMiles ? 12 : 18 }}>
              <div className="min-w-0">
                <div className="flex items-baseline gap-[5px]">
                  <span style={{ fontSize: 46, fontWeight: 800, letterSpacing: '-2.2px', lineHeight: 0.8 }}>{activePoint ? fmt(activePoint.value) : '—'}</span>
                  <span style={{ fontSize: 20, fontWeight: 700, color: '#888' }}>{config.unit}</span>
                </div>
                <div className="truncate" style={{ ...CAPS, fontSize: 11, marginTop: 10 }}>{activePoint ? activePoint.label : ''}</div>
              </div>
              {vsAvg !== null && (
                <div className="text-right flex-shrink-0">
                  <div className="flex items-center justify-end gap-[3px]" style={{ fontSize: 17, fontWeight: 700 }}>
                    {vsAvg >= 0 ? <ArrowUp /> : <ArrowDown />}{vsAvg >= 0 ? '+' : ''}{vsAvg}%
                  </div>
                  <div style={{ ...CAPS, marginTop: 6 }}>vs {bucket} avg</div>
                </div>
              )}
            </div>
            {isMiles && activePoint && activePoint.value > 0 && (
              <div className="flex flex-wrap" style={{ gap: '4px 14px', marginBottom: 14, fontSize: 12.5, color: '#aaa' }}>
                {[['Running', 'Ran', activePoint.milesRan], ['Cycle', 'Biked', activePoint.milesBiked], ['Walking', 'Walked', activePoint.milesWalked]].filter(([, , n]) => (n || 0) > 0).map(([type, l, n]) => (
                  <span key={l} className="flex items-center gap-[5px]"><ActivityIcon type={type} size={13} color="#FF9500" />{l} <b className="text-white">{dist(n).toFixed(1)}</b></span>
                ))}
              </div>
            )}

            {/* Chart Area */}
            <div className="relative">
              <div
                ref={chartRef}
                className="flex items-end gap-0.5"
                style={{ height: 150, touchAction: 'pan-y' }}
                onMouseLeave={() => setHoveredBar(null)}
                onTouchStart={handleChartTouchStart}
                onTouchMove={handleChartTouchMove}
                onTouchEnd={handleChartTouchEnd}
              >
                {trendData.length > 0 ? trendData.map((point, i) => {
                  const heightPercent = maxValue > 0 ? (point.value / maxValue) * 100 : 0;
                  const isHighlighted = i === activeIdx;
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
                        <div
                          className="w-full flex flex-col justify-end pointer-events-none overflow-hidden"
                          style={{ height: `${Math.max(heightPercent, 2)}%`, minHeight: point.value > 0 ? '4px' : '2px', opacity: isHighlighted ? 1 : 0.5, borderRadius: '4px 4px 0 0', backgroundColor: point.value > 0 ? undefined : 'rgba(255,255,255,0.08)' }}
                        >
                          {[['milesRan', ranPct, milesColors.ran], ['milesBiked', bikedPct, milesColors.biked], ['milesWalked', walkedPct, milesColors.walked]].filter(([k]) => (point[k] || 0) > 0).map(([k, pct, c]) => (
                            <div key={k} className="w-full" style={{ flex: `0 0 ${totalPct > 0 ? pct / totalPct * 100 : 0}%`, backgroundColor: c, minHeight: '1px' }} />
                          ))}
                        </div>
                      ) : (
                        <div
                          className="w-full pointer-events-none"
                          style={{ height: `${Math.max(heightPercent, 2)}%`, minHeight: point.value > 0 ? '4px' : '2px', borderRadius: '4px 4px 0 0', backgroundColor: point.value > 0 ? config.color : 'rgba(255,255,255,0.08)', opacity: point.value > 0 ? (isHighlighted ? 1 : 0.45) : 1 }}
                        />
                      )}
                    </button>
                  );
                }) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">No data available</div>
                )}
              </div>
              {/* Dashed average line */}
              {avg > 0 && (
                <div className="absolute left-0 right-0 pointer-events-none" style={{ bottom: `${avgPct}%`, borderTop: '1.5px dashed rgba(255,255,255,0.35)' }}>
                  <span className="absolute right-0" style={{ top: -16, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#aaa' }}>Avg {fmt(avg)}</span>
                </div>
              )}
            </div>

            {/* X-axis labels (caps) */}
            {trendData.length > 0 && (
              <div className="flex gap-0.5" style={{ marginTop: 6 }}>
                {trendData.map((point, i) => {
                  const showLabel = trendData.length <= 7 ||
                    (trendData.length <= 14 && i % 2 === 0) ||
                    (trendData.length > 14 && (i === 0 || i === trendData.length - 1 || i % Math.ceil(trendData.length / 5) === 0));
                  const isHighlighted = i === activeIdx;
                  return (
                    <div key={i} className="flex-1 flex" style={{ minWidth: 0, justifyContent: i === 0 ? 'flex-start' : i === trendData.length - 1 ? 'flex-end' : 'center' }}>
                      {(showLabel || isHighlighted) && (
                        <span className="whitespace-nowrap" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: isHighlighted ? '#fff' : '#777' }}>
                          {point.shortLabel || point.label}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Legend for distance */}
            {isMiles && (
              <div className="flex items-center justify-center gap-4" style={{ marginTop: 10, fontSize: 11, color: '#aaa' }}>
                {[['Ran', milesColors.ran], ['Biked', milesColors.biked], ['Walked', milesColors.walked]].map(([l, c]) => (
                  <span key={l} className="flex items-center gap-1.5"><span className="inline-block" style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: c }} />{l}</span>
                ))}
              </div>
            )}

            {/* Footer: Total and Average */}
            <div className="flex" style={{ gap: 28, marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              {[['Total', fmt(total), config.unit], ['Average', fmt(avg), `${config.unit} / ${perUnit}`]].map(([l, n, u]) => (
                <div key={l}>
                  <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.2px' }}>{n}<span style={{ fontSize: 13, color: '#666', fontWeight: 600, marginLeft: 3 }}>{u}</span></div>
                  <div style={{ ...CAPS, marginTop: 5 }}>{l}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Selected Day Activities - only shows on click */}
      {selectedBar !== null && trendData[selectedBar] && (() => {
        const selectedPoint = trendData[selectedBar];
        // A bar covers a day, a rolling 7-day week or a month depending on the
        // selected range, so the detail panel has to read the bucket's whole
        // span. It used to filter on the bucket's start day alone, which made a
        // weekly bar report a single day's counts under a "Jul 21 - 27" header
        // — a 29-mile week could show 0 cardio sessions.
        const rangeStart = selectedPoint.date;
        const rangeEnd = selectedPoint.endDate || selectedPoint.date;
        const inRange = (d) => d >= rangeStart && d <= rangeEnd; // ISO dates sort lexically
        const rangeActivities = activities.filter(a => inRange(a.date));
        const lifts = rangeActivities.filter(a => getActivityCategory(a) === 'lifting');
        const cardioActivities = rangeActivities.filter(a => getActivityCategory(a) === 'cardio');
        const recoveryActivities = rangeActivities.filter(a => getActivityCategory(a) === 'recovery');
        const nonCardioWalks = rangeActivities.filter(a =>
          a.type === 'Walking' && !a.countToward
        );

        // HealthKit totals summed across the same range, plus any hand-entered
        // calories HealthKit doesn't already account for.
        const rangeHealth = Object.entries(healthDataByDate).filter(([d]) => inRange(d));
        const dayCalories = rangeHealth.reduce((sum, [, v]) => sum + (v?.calories || 0), 0)
          + manualCaloriesInRange(activities, rangeStart, rangeEnd);
        const daySteps = rangeHealth.reduce((sum, [, v]) => sum + (v?.steps || 0), 0);
        const dayMiles = rangeActivities.reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);
        const totalDuration = rangeActivities.reduce((sum, a) => sum + (a.duration || 0), 0);

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

            {rangeActivities.length > 0 ? (
              <div className="space-y-3">
                {/* Summary Stats — the three goals that win the week */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 rounded-lg text-center" style={{ backgroundColor: 'rgba(0,255,148,0.1)' }}>
                    <div className="text-lg font-black" style={{ color: '#00FF94' }}>{lifts.length}</div>
                    <div className="text-[9px] text-gray-400"><CategoryIcon category="lifts" size={10} className="inline align-[-2px] mr-1" />Strength</div>
                  </div>
                  <div className="p-2 rounded-lg text-center" style={{ backgroundColor: 'rgba(255,149,0,0.1)' }}>
                    <div className="text-lg font-black" style={{ color: '#FF9500' }}>{cardioActivities.length}</div>
                    <div className="text-[9px] text-gray-400"><CategoryIcon category="cardio" size={10} className="inline align-[-2px] mr-1" />Cardio</div>
                  </div>
                  <div className="p-2 rounded-lg text-center" style={{ backgroundColor: 'rgba(191,90,242,0.1)' }}>
                    <div className="text-lg font-black" style={{ color: '#BF5AF2' }}>{daySteps >= 10000 ? `${Math.round(daySteps / 1000)}k` : daySteps.toLocaleString()}</div>
                    <div className="text-[9px] text-gray-400"><CategoryIcon category="steps" size={10} className="inline align-[-2px] mr-1" />Steps</div>
                  </div>
                </div>

                {/* Recovery as a bonus, same slim row as Profile and Settings */}
                <div className="px-3 py-2 rounded-lg flex items-center justify-between" style={{ backgroundColor: 'rgba(0,209,255,0.06)', border: '1px solid rgba(0,209,255,0.18)' }}>
                  <div className="flex items-center gap-1.5">
                    <CategoryIcon category="recovery" size={12} />
                    <span className="text-xs text-white">Recovery</span>
                    <span className="text-xs font-bold" style={{ color: '#00D1FF' }}>{recoveryActivities.length}</span>
                  </div>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ color: '#00D1FF', backgroundColor: 'rgba(0,209,255,0.12)', letterSpacing: '0.04em' }}>BONUS</span>
                </div>

                {/* Totals */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 rounded-lg text-center" style={{ backgroundColor: 'rgba(255,107,107,0.1)' }}>
                    <div className="text-sm font-bold" style={{ color: '#FF6B6B' }}>{dayCalories.toLocaleString()}</div>
                    <div className="text-[9px] text-gray-400">Calories</div>
                  </div>
                  <div className="p-2 rounded-lg text-center" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    <div className="text-sm font-bold text-white">{dist(dayMiles).toFixed(1)}</div>
                    <div className="text-[9px] text-gray-400">{distanceUnit === 'km' ? 'KM' : 'Miles'}</div>
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
                    {rangeActivities.map((activity, idx) => (
                      <div key={idx} className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                        <div className="flex items-center gap-2">
                          <ActivityIcon type={activity.type} subtype={activity.subtype} size={14} sportEmoji={activity.sportEmoji} customEmoji={activity.customEmoji} customIcon={activity.customIcon} countToward={activity.countToward} customActivityCategory={activity.customActivityCategory} />
                          <span className="text-sm text-white font-medium">
                            {activity.subtype || activity.type}
                          </span>
                        </div>
                        <div className="flex gap-3 mt-1 text-[10px] text-gray-400">
                          {activity.duration && <span>{activity.duration} min</span>}
                          {activity.distance && <span>{dist(activity.distance).toFixed(2)} {unitLabel(distanceUnit)}</span>}
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
