import React, { useState, useEffect, useMemo, useRef, createContext, useContext, useCallback } from 'react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import ActivityIcon from './components/ActivityIcon';
import RouteMapView from './components/RouteMapView';
import MuscleBodyMap from './components/MuscleBodyMap';
import { fetchWorkoutRoute } from './services/healthService';
import { getReactions, getComments, addReaction, removeReaction, addComment } from './services/friendService';
import { isChallengeable } from './services/challengeService';
import { triggerHaptic } from './utils/haptics';
import { toLocalDateStr, getTodayDate, getCurrentYear, parseLocalDate, formatFriendlyDate } from './utils/dateHelpers';
import { FOCUS_AREA_GROUPS, ALL_FOCUS_AREAS, FOCUS_AREA_MIGRATION, normalizeFocusAreas } from './utils/focusAreas';
import { initialUserData } from './utils/initialUserData';
import SectionIcon from './components/SectionIcon';
import LongPressMenu from './components/LongPressMenu';
import { SwipeableProvider, SwipeableActivityItem, SwipeableContext, globalIsPulling } from './components/SwipeableActivityItem';
import WeekStatsModal from './components/WeekStatsModal';
import MonthStatsModal from './components/MonthStatsModal';
import ActivityDetailModal from './components/ActivityDetailModal';
import TrendsView from './components/TrendsView';
import OwnProfileModal from './components/OwnProfileModal';



// === ProfilePage wrapper (replaces HistoryTab) ===

export default function ProfilePage(props) {
  const { user, userProfile, onOpenSettings } = props;
  const initial = (userProfile?.displayName?.[0] || userProfile?.username?.[0] || '?').toUpperCase();

  // Pull HistoryTab props out of props so we can rename/pass them through.
  const {
    onShare, activities = [], calendarData = {}, healthHistory = [], healthKitData = {}, userData,
    onAddActivity, onDeleteActivity, onEditActivity, initialView = 'calendar', initialStatsSubView = 'overview',
    activeStreaksRef, calendarRef, statsRef, progressPhotosRef, isPro, onPresentPaywall, onShareStamp,
    friends = [], onChallengeActivity, historyLatestActivityRef,
    onUseStreakShield, onToggleVacationMode
  } = props;

  const [showSelfProfile, setShowSelfProfile] = useState(false);
  const [quickActionModal, setQuickActionModal] = useState(null); // 'shield' | 'vacation' | null
  const [quickActionAnimating, setQuickActionAnimating] = useState(false);

  // Drive open/close animation for the quick-action modal — matches the
  // FriendProfileModal / OwnProfileModal timing so transitions feel consistent.
  useEffect(() => {
    if (quickActionModal) {
      const t = setTimeout(() => setQuickActionAnimating(true), 10);
      return () => clearTimeout(t);
    }
    setQuickActionAnimating(false);
  }, [quickActionModal]);

  const closeQuickAction = () => {
    setQuickActionAnimating(false);
    setTimeout(() => setQuickActionModal(null), 250);
  };

  // === Begin verbatim HistoryTab body (state / effects / helpers / JSX) ===
  const [view, setView] = useState(initialView);
  const [statsSubView, setStatsSubView] = useState(initialStatsSubView); // 'overview' or 'records'

  // Free users: limit activity history to last 7 days
  const historyCutoffDate = useMemo(() => {
    if (isPro) return null;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    return cutoff.toISOString().split('T')[0];
  }, [isPro]);

  const visibleActivities = useMemo(() => {
    if (isPro || !historyCutoffDate) return activities;
    return activities.filter(a => a.date >= historyCutoffDate);
  }, [activities, isPro, historyCutoffDate]);
  const [calendarView, setCalendarView] = useState('heatmap');
  const [selectedDate, setSelectedDate] = useState(getTodayDate());
  const [selectedDayActivity, setSelectedDayActivity] = useState(null); // For activity detail modal
  const [historyLatestExpanded, setHistoryLatestExpanded] = useState(false); // expand/collapse for Latest Activity list on history tab

  // Helper function to parse time string to minutes for sorting
  const parseTimeToMinutes = (timeStr) => {
    if (!timeStr) return 0;
    const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)?/i);
    if (!match) return 0;
    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const period = match[3]?.toUpperCase();
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    return hours * 60 + minutes;
  };

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

  // Update view when initialView prop changes
  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  // Update statsSubView when initialStatsSubView prop changes
  useEffect(() => {
    setStatsSubView(initialStatsSubView);
  }, [initialStatsSubView]);
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [showWeekStats, setShowWeekStats] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(null); // { month: 0-11, year: YYYY }
  const [showMonthStats, setShowMonthStats] = useState(false);

  // Progress photos hints state - shows first-visit tips
  const [showPhotosHints, setShowPhotosHints] = useState(() => {
    return !localStorage.getItem('hasSeenPhotosHints');
  });

  // Dismiss progress photos hints
  const dismissPhotosHints = () => {
    setShowPhotosHints(false);
    localStorage.setItem('hasSeenPhotosHints', 'true');
  };

  const [showDayModal, setShowDayModal] = useState(false);
  const [dayModalAnimating, setDayModalAnimating] = useState(false);
  const [dayModalClosing, setDayModalClosing] = useState(false);
  const [compareWeek, setCompareWeek] = useState('average');
  const [totalsView, setTotalsView] = useState('this-week');
  // Progress photo comparison state
  const [selectedPhotos, setSelectedPhotos] = useState([]);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [photoFilter, setPhotoFilter] = useState('all');
  const [expandedMonths, setExpandedMonths] = useState({}); // { monthKey: true/false }
  const [selectedPhotoYear, setSelectedPhotoYear] = useState('all'); // 'all' or year like '2026'
  const [selectedPhotoMonth, setSelectedPhotoMonth] = useState('all'); // 'all' or month number like '01'
  const [isShareGenerating, setIsShareGenerating] = useState(false);
  const records = userData?.personalRecords || initialUserData.personalRecords;
  const streaks = userData?.streaks || initialUserData.streaks;
  const goals = userData?.goals || initialUserData.goals;

  // Helper to safely get record value (handles both old number format and new object format)
  // Returns null if no record exists (0 or null values)
  const getRecordValue = (record) => {
    if (record === null || record === undefined) return null;
    if (typeof record === 'object') {
      return record.value && record.value !== 0 ? record.value : null;
    }
    return record && record !== 0 ? record : null;
  };
  
  // Helper to get record activity type
  const getRecordType = (record) => {
    if (record && typeof record === 'object') return record.activityType || null;
    return null;
  };

  // Day modal open/close handlers
  const openDayModal = () => {
    setShowDayModal(true);
    setDayModalClosing(false);
    setTimeout(() => setDayModalAnimating(true), 10);
  };

  const closeDayModal = () => {
    setDayModalAnimating(false);
    setDayModalClosing(true);
    setTimeout(() => {
      setShowDayModal(false);
      setDayModalClosing(false);
    }, 150);
  };

  // Get current date info
  const today = new Date();
  const todayDay = today.getDate();
  const todayMonth = today.getMonth(); // 0-indexed
  const todayYear = today.getFullYear();

  // State for displayed month (for navigation)
  const [displayedMonth, setDisplayedMonth] = useState(todayMonth);
  const [displayedYear, setDisplayedYear] = useState(todayYear);

  // Navigation functions
  const goToPreviousMonth = () => {
    if (displayedMonth === 0) {
      setDisplayedMonth(11);
      setDisplayedYear(displayedYear - 1);
    } else {
      setDisplayedMonth(displayedMonth - 1);
    }
  };

  const goToNextMonth = () => {
    if (displayedMonth === 11) {
      setDisplayedMonth(0);
      setDisplayedYear(displayedYear + 1);
    } else {
      setDisplayedMonth(displayedMonth + 1);
    }
  };

  const goToToday = () => {
    setDisplayedMonth(todayMonth);
    setDisplayedYear(todayYear);
  };

  // Check if we're viewing the current month
  const isCurrentMonth = displayedMonth === todayMonth && displayedYear === todayYear;

  // Limit navigation (12 months back, 2 months forward)
  const minDate = new Date(todayYear, todayMonth - 12, 1);
  const maxDate = new Date(todayYear, todayMonth + 2, 1);
  const canGoBack = new Date(displayedYear, displayedMonth - 1, 1) >= minDate;
  const canGoForward = new Date(displayedYear, displayedMonth + 1, 1) <= maxDate;
  
  // Generate weeks dynamically based on displayed month (includes overflow days from adjacent months)
  const generateMonthWeeks = () => {
    const weeks = [];
    const daysInMonth = new Date(displayedYear, displayedMonth + 1, 0).getDate();
    const firstDayOfMonth = new Date(displayedYear, displayedMonth, 1).getDay(); // 0 = Sunday
    const lastDayOfMonth = new Date(displayedYear, displayedMonth, daysInMonth).getDay(); // 0 = Sunday

    // Previous month info for overflow days
    const prevMonthDays = new Date(displayedYear, displayedMonth, 0).getDate();

    let weekNum = 0;
    let currentDayInMonth = 1;

    // First week (may include days from previous month)
    if (firstDayOfMonth > 0 || currentDayInMonth === 1) {
      const weekDays = [];
      // Add overflow days from previous month
      for (let i = firstDayOfMonth - 1; i >= 0; i--) {
        const prevDay = prevMonthDays - i;
        const prevMonth = displayedMonth === 0 ? 11 : displayedMonth - 1;
        const prevYear = displayedMonth === 0 ? displayedYear - 1 : displayedYear;
        const dateStr = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(prevDay).padStart(2, '0')}`;
        weekDays.push({
          day: prevDay,
          date: dateStr,
          isOverflow: true,
          overflowMonth: 'prev'
        });
      }
      // Add days from current month until end of week
      const daysToAdd = 7 - firstDayOfMonth;
      for (let i = 0; i < daysToAdd; i++) {
        const dateStr = `${displayedYear}-${String(displayedMonth + 1).padStart(2, '0')}-${String(currentDayInMonth).padStart(2, '0')}`;
        weekDays.push({
          day: currentDayInMonth,
          date: dateStr,
          isOverflow: false
        });
        currentDayInMonth++;
      }

      // Calculate week date range for stats
      const weekStartDate = new Date(weekDays[0].date + 'T12:00:00');
      const weekEndDate = new Date(weekDays[6].date + 'T12:00:00');

      weeks.push({
        id: `week-${weekNum}`,
        days: weekDays,
        startDate: weekStartDate,
        endDate: weekEndDate,
        label: `${weekStartDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEndDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      });
      weekNum++;
    }

    // Middle full weeks
    while (currentDayInMonth + 6 <= daysInMonth) {
      const weekDays = [];
      for (let i = 0; i < 7; i++) {
        const dateStr = `${displayedYear}-${String(displayedMonth + 1).padStart(2, '0')}-${String(currentDayInMonth).padStart(2, '0')}`;
        weekDays.push({
          day: currentDayInMonth,
          date: dateStr,
          isOverflow: false
        });
        currentDayInMonth++;
      }

      const weekStartDate = new Date(weekDays[0].date + 'T12:00:00');
      const weekEndDate = new Date(weekDays[6].date + 'T12:00:00');

      weeks.push({
        id: `week-${weekNum}`,
        days: weekDays,
        startDate: weekStartDate,
        endDate: weekEndDate,
        label: `${weekStartDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEndDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      });
      weekNum++;
    }

    // Last week (may include days from next month)
    if (currentDayInMonth <= daysInMonth) {
      const weekDays = [];
      // Add remaining days from current month
      while (currentDayInMonth <= daysInMonth) {
        const dateStr = `${displayedYear}-${String(displayedMonth + 1).padStart(2, '0')}-${String(currentDayInMonth).padStart(2, '0')}`;
        weekDays.push({
          day: currentDayInMonth,
          date: dateStr,
          isOverflow: false
        });
        currentDayInMonth++;
      }
      // Add overflow days from next month
      const nextMonth = displayedMonth === 11 ? 0 : displayedMonth + 1;
      const nextYear = displayedMonth === 11 ? displayedYear + 1 : displayedYear;
      let nextDay = 1;
      while (weekDays.length < 7) {
        const dateStr = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(nextDay).padStart(2, '0')}`;
        weekDays.push({
          day: nextDay,
          date: dateStr,
          isOverflow: true,
          overflowMonth: 'next'
        });
        nextDay++;
      }

      const weekStartDate = new Date(weekDays[0].date + 'T12:00:00');
      const weekEndDate = new Date(weekDays[6].date + 'T12:00:00');

      weeks.push({
        id: `week-${weekNum}`,
        days: weekDays,
        startDate: weekStartDate,
        endDate: weekEndDate,
        label: `${weekStartDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEndDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      });
    }

    return weeks;
  };

  const weeks = generateMonthWeeks();

  // Pre-compute which weeks have all goals met
  const weekGoalsMet = (() => {
    const goals = userData.goals;
    const todayStr = getTodayDate();
    const result = {};
    weeks.forEach(week => {
      const startStr = week.days[0].date;
      const endStr = week.days[6].date;
      // Only check weeks that have fully passed or are the current week
      if (startStr > todayStr) {
        result[week.id] = false;
        return;
      }
      const weekActivities = activities.filter(a => a.date >= startStr && a.date <= endStr);
      const lifts = weekActivities.filter(a => { const c = getActivityCategory(a); return c === 'lifting' || c === 'lifting+cardio'; }).length;
      const cardio = weekActivities.filter(a => { const c = getActivityCategory(a); return c === 'cardio' || c === 'lifting+cardio'; }).length;
      const recovery = weekActivities.filter(a => getActivityCategory(a) === 'recovery').length;
      result[week.id] = lifts >= goals.liftsPerWeek && cardio >= goals.cardioPerWeek && recovery >= goals.recoveryPerWeek;
    });
    return result;
  })();

  // Calculate weekly stats for comparison (last week and average)
  const calculateWeeklyStats = () => {
    // Calculate last week's stats
    const lastWeekStart = new Date(today);
    lastWeekStart.setDate(today.getDate() - today.getDay() - 7); // Start of last week (Sunday)
    lastWeekStart.setHours(0, 0, 0, 0);
    
    const lastWeekEnd = new Date(lastWeekStart);
    lastWeekEnd.setDate(lastWeekStart.getDate() + 6); // End of last week (Saturday)
    lastWeekEnd.setHours(23, 59, 59, 999);
    
    const lastWeekActivities = visibleActivities.filter(a => {
      const actDate = parseLocalDate(a.date);
      return actDate >= lastWeekStart && actDate <= lastWeekEnd;
    });
    
    const lastWeekLifts = lastWeekActivities.filter(a => getActivityCategory(a) === 'lifting').length;
    const lastWeekCardio = lastWeekActivities.filter(a => getActivityCategory(a) === 'cardio').length;
    const lastWeekRecovery = lastWeekActivities.filter(a => getActivityCategory(a) === 'recovery').length;
    const lastWeekMiles = lastWeekActivities.reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);

    // Calculate last week calories from healthDataByDate
    let lastWeekCalories = 0;
    for (let d = 0; d < 7; d++) {
      const date = new Date(lastWeekStart);
      date.setDate(lastWeekStart.getDate() + d);
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const healthData = healthDataByDate[dateStr];
      const dayActivities = activities.filter(a => a.date === dateStr);
      // Use HealthKit calories directly — wearables already track all active energy
      lastWeekCalories += healthData?.calories || 0;
    }

    // Calculate average from first activity to now
    let avgLifts = 0, avgCardio = 0, avgRecovery = 0, avgMiles = 0, avgCalories = 0;
    
    if (activities.length > 0) {
      // Find the earliest activity date
      const sortedDates = activities.map(a => parseLocalDate(a.date)).sort((a, b) => a - b);
      const firstActivityDate = sortedDates[0];
      
      // Calculate number of complete weeks from first activity to now
      const firstWeekStart = new Date(firstActivityDate);
      firstWeekStart.setDate(firstActivityDate.getDate() - firstActivityDate.getDay()); // Start of that week
      firstWeekStart.setHours(0, 0, 0, 0);
      
      const currentWeekStart = new Date(today);
      currentWeekStart.setDate(today.getDate() - today.getDay());
      currentWeekStart.setHours(0, 0, 0, 0);
      
      // Calculate weeks between (not including current incomplete week)
      const msPerWeek = 7 * 24 * 60 * 60 * 1000;
      const weeksBetween = Math.floor((currentWeekStart - firstWeekStart) / msPerWeek);
      
      if (weeksBetween > 0) {
        // Get all activities before current week
        const pastActivities = activities.filter(a => {
          const actDate = parseLocalDate(a.date);
          return actDate < currentWeekStart;
        });
        
        const totalLifts = pastActivities.filter(a => getActivityCategory(a) === 'lifting').length;
        const totalCardio = pastActivities.filter(a => getActivityCategory(a) === 'cardio').length;
        const totalRecovery = pastActivities.filter(a => getActivityCategory(a) === 'recovery').length;
        const totalMiles = pastActivities.reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);

        // Calculate total calories from healthDataByDate for all past weeks
        let totalCalories = 0;
        for (let d = 0; d < weeksBetween * 7; d++) {
          const date = new Date(firstWeekStart);
          date.setDate(firstWeekStart.getDate() + d);
          if (date >= currentWeekStart) break;
          const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          const healthData = healthDataByDate[dateStr];
          const dayActivities = activities.filter(a => a.date === dateStr);
          // Use HealthKit calories directly — wearables already track all active energy
          totalCalories += healthData?.calories || 0;
        }

        avgLifts = Math.round((totalLifts / weeksBetween) * 10) / 10;
        avgCardio = Math.round((totalCardio / weeksBetween) * 10) / 10;
        avgRecovery = Math.round((totalRecovery / weeksBetween) * 10) / 10;
        avgMiles = Math.round((totalMiles / weeksBetween) * 10) / 10;
        avgCalories = Math.round(totalCalories / weeksBetween);
      }
    }
    
    return {
      'week-2': {
        lifts: lastWeekLifts,
        cardio: lastWeekCardio,
        recovery: lastWeekRecovery,
        miles: lastWeekMiles,
        calories: lastWeekCalories
      },
      'average': {
        lifts: avgLifts,
        cardio: avgCardio,
        recovery: avgRecovery,
        miles: avgMiles,
        calories: avgCalories
      }
    };
  };
  
  const weeklyStats = calculateWeeklyStats();

  const generateCalendarDays = () => {
    const days = [];
    const daysInMonth = new Date(displayedYear, displayedMonth + 1, 0).getDate();

    for (let i = 1; i <= daysInMonth; i++) {
      const dateStr = `${displayedYear}-${String(displayedMonth + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      const isToday = isCurrentMonth && i === todayDay;
      const isFuture = displayedYear > todayYear ||
                       (displayedYear === todayYear && displayedMonth > todayMonth) ||
                       (isCurrentMonth && i > todayDay);
      days.push({
        day: i,
        date: dateStr,
        activities: calendarData[dateStr] || [],
        isToday,
        isFuture
      });
    }
    return days;
  };

  const calendarDays = generateCalendarDays();
  
  // Calculate current week stats from activities
  const calculateCurrentWeekStats = () => {
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const weekActivities = activities.filter(a => {
      const actDate = parseLocalDate(a.date);
      return actDate >= startOfWeek && actDate <= today;
    });

    const lifts = weekActivities.filter(a => getActivityCategory(a) === 'lifting').length;
    const cardio = weekActivities.filter(a => getActivityCategory(a) === 'cardio').length;
    const recovery = weekActivities.filter(a => getActivityCategory(a) === 'recovery').length;
    const miles = weekActivities.reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);

    // Calculate calories and steps for the week from healthDataByDate
    let weekCalories = 0;
    let weekSteps = 0;
    for (let d = 0; d <= today.getDay(); d++) {
      const date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + d);
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const healthData = healthDataByDate[dateStr];
      // Use activities array (source of truth) instead of calendarData
      const dayActivities = activities.filter(a => a.date === dateStr);

      // Use HealthKit calories directly — wearables already track all active energy
      weekCalories += healthData?.calories || 0;

      // Add HealthKit steps
      weekSteps += healthData?.steps || 0;
    }

    return {
      workouts: lifts + cardio,
      lifts,
      cardio,
      recovery,
      calories: weekCalories,
      steps: weekSteps,
      miles,
      goalsMet: lifts >= goals.liftsPerWeek && cardio >= goals.cardioPerWeek && recovery >= goals.recoveryPerWeek
    };
  };
  
  const currentWeekStats = calculateCurrentWeekStats();

  // Generate list of months for the dropdown (last 12 months)
  const getMonthOptions = () => {
    const options = [];
    const today = new Date();
    for (let i = 0; i < 12; i++) {
      const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const label = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      options.push({ value, label });
    }
    return options;
  };
  
  const monthOptions = getMonthOptions();

  // Calculate totals from actual activities
  const getTotalsData = () => {
    const currentYearStr = String(getCurrentYear());
    const today = new Date();
    const thisMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastMonthStr = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
    
    let filteredActivities;

    if (totalsView === 'this-week') {
      // This week (Sunday - Saturday)
      const dayOfWeek = today.getDay();
      const sunday = new Date(today);
      sunday.setDate(today.getDate() - dayOfWeek);
      sunday.setHours(0, 0, 0, 0);
      const saturday = new Date(sunday);
      saturday.setDate(sunday.getDate() + 6);
      saturday.setHours(23, 59, 59, 999);
      filteredActivities = visibleActivities.filter(a => {
        if (!a.date) return false;
        const d = new Date(a.date + 'T12:00:00');
        return d >= sunday && d <= saturday;
      });
    } else if (totalsView === 'last-7-days') {
      // Last 7 days
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 7);
      filteredActivities = activities.filter(a => {
        if (!a.date) return false;
        const d = new Date(a.date + 'T12:00:00');
        return d >= cutoff;
      });
    } else if (totalsView === 'last-30-days') {
      // Last 30 days (full 30 days, not limited by free tier cutoff)
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      filteredActivities = activities.filter(a => {
        if (!a.date) return false;
        const d = new Date(a.date + 'T12:00:00');
        return d >= cutoff;
      });
    } else if (totalsView === 'this-month') {
      // This month
      filteredActivities = visibleActivities.filter(a => a.date && a.date.startsWith(thisMonthStr));
    } else if (totalsView === 'last-month') {
      // Last month
      filteredActivities = visibleActivities.filter(a => a.date && a.date.startsWith(lastMonthStr));
    } else if (totalsView.match(/^\d{4}-\d{2}$/)) {
      // Specific month (e.g., "2026-01")
      filteredActivities = visibleActivities.filter(a => a.date && a.date.startsWith(totalsView));
    } else if (totalsView === currentYearStr) {
      // Current year
      filteredActivities = visibleActivities.filter(a => a.date && a.date.startsWith(currentYearStr));
    } else {
      // All-time
      filteredActivities = visibleActivities;
    }
    
    const lifts = filteredActivities.filter(a => getActivityCategory(a) === 'lifting');
    const cardioActs = filteredActivities.filter(a => getActivityCategory(a) === 'cardio');
    const recoveryActs = filteredActivities.filter(a => getActivityCategory(a) === 'recovery');
    
    // Calculate breakdowns
    const calcBreakdown = (acts) => {
      const breakdown = {};
      acts.forEach(a => {
        const key = a.subtype || a.type;
        breakdown[key] = (breakdown[key] || 0) + 1;
      });
      return breakdown;
    };

    // Muscle group breakdown for strength — count each focus area individually
    const calcMuscleGroupBreakdown = (acts) => {
      const breakdown = {};
      acts.forEach(a => {
        const areas = normalizeFocusAreas(a.focusAreas || (a.focusArea ? [a.focusArea] : []));
        areas.forEach(area => {
          breakdown[area] = (breakdown[area] || 0) + 1;
        });
      });
      return breakdown;
    };

    // Distance breakdowns
    const milesRan = filteredActivities.filter(a => a.type === 'Running').reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);
    const milesBiked = filteredActivities.filter(a => a.type === 'Cycle').reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);
    const milesWalked = filteredActivities.filter(a => a.type === 'Walking' || a.type === 'Hiking').reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);
    const totalMiles = milesRan + milesBiked + milesWalked;

    return {
      workouts: lifts.length + cardioActs.length,
      recovery: recoveryActs.length,
      liftingCount: lifts.length,
      miles: totalMiles,
      milesRan,
      milesBiked,
      milesWalked,
      lifting: calcMuscleGroupBreakdown(lifts),
      cardio: calcBreakdown(cardioActs),
      recoveryBreakdown: calcBreakdown(recoveryActs)
    };
  };

  const totalsData = getTotalsData();

  // Group calendar days by week for the new layout
  const getWeekForDay = (day) => {
    return weeks.find(w => day >= w.startDay && day <= w.endDay);
  };

  return (
    <>
      {/* Profile card */}
      <div className="px-4 pt-2 pb-4">
        <div
          className="rounded-2xl p-4 flex items-center gap-4"
          style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <button
            onClick={() => { triggerHaptic(ImpactStyle.Light); setShowSelfProfile(true); }}
            aria-label="Open your profile"
            className="w-16 h-16 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0 active:scale-95 transition-transform"
            style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
          >
            {userProfile?.photoURL ? (
              <img src={userProfile.photoURL} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-white text-xl font-semibold">{initial}</span>
            )}
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-white text-base font-semibold truncate">
                {userProfile?.displayName || userProfile?.username || 'You'}
              </p>
              {(userData?.streaks?.master || 0) > 0 && (
                <span className="text-sm flex-shrink-0" style={{ color: '#FFD60A' }}>
                  {userData.streaks.master}🔥
                </span>
              )}
            </div>
            <p className="text-xs truncate" style={{ color: 'rgba(255,255,255,0.5)' }}>
              {userProfile?.username && <>@{userProfile.username} · </>}
              <span style={{ color: isPro ? '#FFD60A' : 'rgba(255,255,255,0.5)', fontWeight: isPro ? 600 : 400 }}>
                {isPro ? 'Pro' : 'Free'}
              </span>
            </p>
            {/* Compact shield + vacation status — tap each to open the action modal */}
            {(() => {
              const SHIELD_COOLDOWN_WEEKS = 6;
              const _today = new Date();
              const _sunday = new Date(_today);
              _sunday.setDate(_today.getDate() - _today.getDay());
              const currentWeek = `${_sunday.getFullYear()}-${String(_sunday.getMonth() + 1).padStart(2, '0')}-${String(_sunday.getDate()).padStart(2, '0')}`;
              const isShielded = (userData?.streakShield?.shieldedWeeks || []).includes(currentWeek);
              const lastUsedWeek = userData?.streakShield?.lastUsedWeek;
              let shieldText = '';
              if (!isPro) {
                shieldText = 'Pro only';
              } else if (isShielded) {
                shieldText = 'Active';
              } else if (lastUsedWeek) {
                const lastUsedDate = new Date(lastUsedWeek);
                const weeksSince = Math.floor((_sunday - lastUsedDate) / (7 * 24 * 60 * 60 * 1000));
                if (weeksSince < SHIELD_COOLDOWN_WEEKS) {
                  shieldText = `${SHIELD_COOLDOWN_WEEKS - weeksSince}w`;
                } else {
                  shieldText = 'Available';
                }
              } else {
                shieldText = 'Available';
              }
              const vacationActive = !!userData?.vacationMode?.isActive;
              const vmCurrentYear = new Date().getFullYear();
              const vmUsed = userData?.vacationMode?.activationYear === vmCurrentYear ? (userData?.vacationMode?.activationsThisYear || 0) : 0;
              const vacationsLeft = Math.max(0, 3 - vmUsed);
              let vacationText;
              let vacationColor;
              if (!isPro) {
                vacationText = 'Pro only';
                vacationColor = 'rgba(255,255,255,0.45)';
              } else if (vacationActive) {
                vacationText = 'Active';
                vacationColor = '#FF9500';
              } else if (vacationsLeft > 0) {
                vacationText = 'Available';
                vacationColor = 'rgba(255,255,255,0.45)';
              } else {
                vacationText = 'Used up';
                vacationColor = 'rgba(255,255,255,0.45)';
              }
              return (
                <div className="flex items-center gap-3 mt-1 text-[11px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  <button
                    onClick={() => setQuickActionModal('shield')}
                    className="flex items-center gap-1 active:opacity-60"
                  >
                    <span>🛡️</span>
                    <span>{shieldText}</span>
                  </button>
                  <button
                    onClick={() => setQuickActionModal('vacation')}
                    className="flex items-center gap-1 active:opacity-60"
                  >
                    <span>🌴</span>
                    <span style={{ color: vacationColor }}>{vacationText}</span>
                  </button>
                </div>
              );
            })()}
          </div>
          <button
            onClick={onOpenSettings}
            aria-label="Settings"
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 active:scale-95 transition-transform"
            style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>

        {/* Streak risk warning — shows in the last few days of the week if any goal
            is still incomplete and a streak is on the line. Free users get a paywall
            CTA, Pro users get a one-tap shield. */}
        {(() => {
          if (userData?.vacationMode?.isActive) return null;

          const today = new Date();
          const dayOfWeek = today.getDay();
          const daysLeft = 7 - dayOfWeek; // Sun=7, Sat=1

          const cwStart = new Date(today);
          cwStart.setDate(today.getDate() - dayOfWeek);
          cwStart.setHours(0, 0, 0, 0);
          const cwStartStr = `${cwStart.getFullYear()}-${String(cwStart.getMonth() + 1).padStart(2, '0')}-${String(cwStart.getDate()).padStart(2, '0')}`;

          const cwActs = activities.filter(a => a.date >= cwStartStr);
          const liftsCount = cwActs.filter(a => { const c = getActivityCategory(a); return c === 'lifting' || c === 'lifting+cardio'; }).length;
          const cardioCount = cwActs.filter(a => { const c = getActivityCategory(a); return c === 'cardio' || c === 'lifting+cardio'; }).length;
          const recoveryCount = cwActs.filter(a => getActivityCategory(a) === 'recovery').length;

          const liftsRemaining = Math.max(0, goals.liftsPerWeek - liftsCount);
          const cardioRemaining = Math.max(0, goals.cardioPerWeek - cardioCount);
          const recoveryRemaining = Math.max(0, goals.recoveryPerWeek - recoveryCount);
          const anyRemaining = liftsRemaining > 0 || cardioRemaining > 0 || recoveryRemaining > 0;

          const hasActiveStreak = (userData?.streaks?.master || 0) > 0
            || (userData?.streaks?.lifts || 0) > 0
            || (userData?.streaks?.cardio || 0) > 0
            || (userData?.streaks?.recovery || 0) > 0;

          if (!(daysLeft <= 3 && anyRemaining && hasActiveStreak)) return null;

          // Compute shield availability for the CTA
          const SHIELD_COOLDOWN_WEEKS = 6;
          const currentWeek = cwStartStr;
          const isShielded = (userData?.streakShield?.shieldedWeeks || []).includes(currentWeek);
          const lastUsedWeek = userData?.streakShield?.lastUsedWeek;
          let shieldOnCooldown = false;
          if (lastUsedWeek) {
            const lastUsedDate = new Date(lastUsedWeek);
            const weeksSince = Math.floor((cwStart - lastUsedDate) / (7 * 24 * 60 * 60 * 1000));
            if (weeksSince < SHIELD_COOLDOWN_WEEKS) shieldOnCooldown = true;
          }
          const shieldAvailable = isPro && !isShielded && !shieldOnCooldown;

          const remainingText = [
            liftsRemaining > 0 ? `${liftsRemaining} strength` : null,
            cardioRemaining > 0 ? `${cardioRemaining} cardio` : null,
            recoveryRemaining > 0 ? `${recoveryRemaining} recovery` : null,
          ].filter(Boolean).join(', ');

          return (
            <div className="mt-3">
              <p className="text-[12px] leading-snug" style={{ color: '#FF453A' }}>
                <span className="font-semibold">
                  {daysLeft === 1 ? 'Last day to keep your streak' : `${daysLeft} days left to keep your streak`}
                </span>
                <span style={{ color: 'rgba(255,69,58,0.75)' }}> — {remainingText} remaining</span>
                {!isPro ? (
                  <>
                    {' · '}
                    <button
                      onClick={() => onPresentPaywall?.()}
                      className="font-semibold"
                      style={{ color: '#FFD60A' }}
                    >
                      Upgrade for Shield →
                    </button>
                  </>
                ) : shieldAvailable ? (
                  <>
                    {' · '}
                    <button
                      onClick={() => setQuickActionModal('shield')}
                      className="font-semibold"
                      style={{ color: '#00D1FF' }}
                    >
                      🛡️ Use Shield →
                    </button>
                  </>
                ) : null}
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
                At risk of breaking your streak? Tap 🛡️ or 🌴 to save it
              </p>
            </div>
          );
        })()}
      </div>

      {/* === original HistoryTab body starts here === */}
      <div className="pb-32">
      {/* Active Streaks Section */}
      <div ref={activeStreaksRef} className="mx-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 uppercase tracking-wider">Active Streaks</span>
            <span>🔥</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3.5 h-3.5 rounded-full flex items-center justify-center bg-gray-600">
              <span className="text-[8px] text-black font-bold leading-none">✓</span>
            </div>
            <span className="text-[9px] text-gray-600">= this week's goal hit</span>
          </div>
        </div>

        {/* Hybrid Streak - Hero */}
        <div className="p-4 rounded-2xl mb-3" style={{ background: 'linear-gradient(135deg, rgba(255,215,0,0.15) 0%, rgba(255,149,0,0.1) 100%)', border: '1px solid rgba(255,215,0,0.3)' }}>
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">🏆</span>
            <div>
              <div className="text-3xl font-black" style={{ color: '#FFD700' }}>{streaks.master} Weeks</div>
              <div className="text-sm text-gray-300">Hybrid Streak</div>
            </div>
          </div>
          <div className="text-xs text-gray-500 mt-2 pt-2 border-t border-white/10">
            Your longest: {records.longestMasterStreak} weeks
          </div>
        </div>

        {/* Sub Streaks - 3 columns */}
        {(() => {
          // Compute current week goal completion for checkmark badges
          const todayDate = new Date();
          const cwStart = new Date(todayDate);
          cwStart.setDate(todayDate.getDate() - todayDate.getDay());
          cwStart.setHours(0, 0, 0, 0);
          const cwStartStr = `${cwStart.getFullYear()}-${String(cwStart.getMonth() + 1).padStart(2, '0')}-${String(cwStart.getDate()).padStart(2, '0')}`;
          const cwEnd = new Date(cwStart);
          cwEnd.setDate(cwEnd.getDate() + 6);
          const cwEndStr = `${cwEnd.getFullYear()}-${String(cwEnd.getMonth() + 1).padStart(2, '0')}-${String(cwEnd.getDate()).padStart(2, '0')}`;
          const cwActs = activities.filter(a => a.date >= cwStartStr && a.date <= cwEndStr);
          const cwLiftsOk = cwActs.filter(a => { const c = getActivityCategory(a); return c === 'lifting' || c === 'lifting+cardio'; }).length >= goals.liftsPerWeek;
          const cwCardioOk = cwActs.filter(a => { const c = getActivityCategory(a); return c === 'cardio' || c === 'lifting+cardio'; }).length >= goals.cardioPerWeek;
          const cwRecoveryOk = cwActs.filter(a => getActivityCategory(a) === 'recovery').length >= goals.recoveryPerWeek;

          const CheckBadge = ({ met, color }) => met ? (
            <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full flex items-center justify-center" style={{ backgroundColor: color }}>
              <span className="text-[9px] text-black font-bold leading-none">✓</span>
            </div>
          ) : null;

          return (
            <div className="grid grid-cols-3 gap-2">
              {/* Strength Streak */}
              <div className="px-2.5 py-2 rounded-xl bg-zinc-800/60 relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl" style={{ backgroundColor: '#00FF94' }}></div>
                <CheckBadge met={cwLiftsOk} color="#00FF94" />
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">💪</span>
                  <span className="text-lg font-bold leading-tight" style={{ color: '#00FF94' }}>{streaks.lifts}</span>
                </div>
                <span className="text-[11px] text-gray-400">Strength</span>
                <span className="text-[10px] text-gray-500 block">{goals.liftsPerWeek}+/week</span>
              </div>

              {/* Cardio Streak */}
              <div className="px-2.5 py-2 rounded-xl bg-zinc-800/60 relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl" style={{ backgroundColor: '#FF9500' }}></div>
                <CheckBadge met={cwCardioOk} color="#FF9500" />
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">❤️‍🔥</span>
                  <span className="text-lg font-bold leading-tight" style={{ color: '#FF9500' }}>{streaks.cardio}</span>
                </div>
                <span className="text-[11px] text-gray-400">Cardio</span>
                <span className="text-[10px] text-gray-500 block">{goals.cardioPerWeek}+/week</span>
              </div>

              {/* Recovery Streak */}
              <div className="px-2.5 py-2 rounded-xl bg-zinc-800/60 relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl" style={{ backgroundColor: '#00D1FF' }}></div>
                <CheckBadge met={cwRecoveryOk} color="#00D1FF" />
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">🧊</span>
                  <span className="text-lg font-bold leading-tight" style={{ color: '#00D1FF' }}>{streaks.recovery}</span>
                </div>
                <span className="text-[11px] text-gray-400">Recovery</span>
                <span className="text-[10px] text-gray-500 block">{goals.recoveryPerWeek}+/week</span>
              </div>
            </div>
          );
        })()}
      </div>

      {/* View Toggles + Content Wrapper for Tour */}
      <div>
        {/* View Toggles */}
        <div className="mx-4 mb-4 relative flex gap-2 p-1 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
          {/* Sliding pill indicator */}
          <div
            className="absolute top-1 bottom-1 rounded-lg transition-all duration-300 ease-out"
            style={{
              backgroundColor: 'rgba(255,255,255,0.1)',
              width: 'calc((100% - 8px) / 3)',
              left: view === 'calendar'
                ? '4px'
                : view === 'stats'
                  ? 'calc(4px + (100% - 8px) / 3)'
                  : 'calc(4px + 2 * (100% - 8px) / 3)'
            }}
          />
          <button
            onClick={() => setView('calendar')}
            className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors duration-200 relative z-10"
            style={{
              color: view === 'calendar' ? 'white' : 'rgba(255,255,255,0.5)'
            }}
          >
            Calendar
          </button>
          <button
            onClick={() => setView('stats')}
            className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors duration-200 relative z-10"
            style={{
              color: view === 'stats' ? 'white' : 'rgba(255,255,255,0.5)'
            }}
          >
            Stats
          </button>
          <button
            onClick={() => {
              setView('progress');
            }}
            className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors duration-200 relative z-10"
            style={{
              color: view === 'progress' ? 'white' : 'rgba(255,255,255,0.5)'
            }}
          >
            Compare
          </button>
        </div>

        {/* Free user upgrade banner */}
        {!isPro && (
          <button
            onClick={onPresentPaywall}
            className="mx-4 mb-4 p-3 rounded-xl flex items-center gap-2 transition-all duration-150"
            style={{ backgroundColor: 'rgba(255,149,0,0.08)', border: '1px solid rgba(255,149,0,0.15)' }}
            onTouchStart={(e) => e.currentTarget.style.opacity = '0.7'}
            onTouchEnd={(e) => e.currentTarget.style.opacity = '1'}
          >
            <span className="text-sm">⚡</span>
            <span className="text-xs text-gray-300 flex-1 text-left">Viewing last 7 days. <span style={{ color: '#FF9500' }}>Upgrade to Pro</span> for full history.</span>
            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        )}

        {/* Calendar View */}
        {view === 'calendar' && (
          <div ref={calendarRef} className="mx-4 mt-2">
          <div className="mb-4">
            <div className="flex items-center gap-2">
              <SectionIcon type="calendar" />
              <span className="text-[20px] font-semibold text-white" style={{ letterSpacing: '-0.3px' }}>Activity Calendar</span>
            </div>
            <p className="text-[13px] -mt-1 pl-[30px]" style={{ color: '#777' }}>Tap any day, week or month to see stats for that specific time period</p>
          </div>

          {/* Month navigation */}
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={goToPreviousMonth}
              disabled={!canGoBack}
              className="p-2 rounded-lg transition-all duration-150"
              style={{
                backgroundColor: canGoBack ? 'rgba(255,255,255,0.05)' : 'transparent',
                opacity: canGoBack ? 1 : 0.3
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <button
              onClick={() => {
                // Free users: block all month stats (7-day window is too small for meaningful monthly stats)
                if (historyCutoffDate) {
                  onPresentPaywall?.();
                  return;
                }
                setSelectedMonth({ month: displayedMonth, year: displayedYear });
                setShowMonthStats(true);
              }}
              className="text-lg font-bold transition-all duration-150 flex items-center gap-1.5"
              style={{ color: isCurrentMonth ? 'white' : '#00FF94' }}
            >
              {new Date(displayedYear, displayedMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              <span className="opacity-60"><SectionIcon type="chart" size={14} /></span>
            </button>
            <button
              onClick={goToNextMonth}
              disabled={!canGoForward}
              className="p-2 rounded-lg transition-all duration-150"
              style={{
                backgroundColor: canGoForward ? 'rgba(255,255,255,0.05)' : 'transparent',
                opacity: canGoForward ? 1 : 0.3
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>
          
          {/* Week days header with week button column */}
          <div className="flex gap-0.5 mb-1">
            <div className="w-8" />
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <div key={i} className="flex-1 text-center text-[10px] text-gray-500 py-1">{d}</div>
            ))}
          </div>
          
          {/* Calendar with week buttons */}
          <div className="space-y-0.5">
            {weeks.map((week) => (
              <div key={week.id} className="flex gap-0.5">
                {/* Week stats button - shows checkmark if all goals met */}
                {(() => {
                  const goalsHit = weekGoalsMet[week.id];
                  const weekEndDate = week.days[6]?.date || week.days[week.days.length - 1]?.date;
                  const isWeekLocked = !!(historyCutoffDate && weekEndDate < historyCutoffDate);
                  const bgDefault = goalsHit ? 'rgba(0,255,148,0.15)' : 'rgba(255,255,255,0.05)';
                  const bgPressed = goalsHit ? 'rgba(0,255,148,0.25)' : 'rgba(255,255,255,0.1)';
                  return (
                    <button
                      onClick={() => {
                        if (isWeekLocked) {
                          onPresentPaywall?.();
                          return;
                        }
                        setSelectedWeek(week);
                        setShowWeekStats(true);
                      }}
                      className="w-8 h-8 rounded-md flex items-center justify-center text-[10px] transition-all duration-150"
                      style={{ backgroundColor: bgDefault, opacity: isWeekLocked ? 0.4 : 1 }}
                      onTouchStart={(e) => {
                        e.currentTarget.style.transform = 'scale(0.85)';
                        e.currentTarget.style.backgroundColor = bgPressed;
                      }}
                      onTouchEnd={(e) => {
                        e.currentTarget.style.transform = 'scale(1)';
                        e.currentTarget.style.backgroundColor = bgDefault;
                      }}
                      onMouseDown={(e) => {
                        e.currentTarget.style.transform = 'scale(0.85)';
                        e.currentTarget.style.backgroundColor = bgPressed;
                      }}
                      onMouseUp={(e) => {
                        e.currentTarget.style.transform = 'scale(1)';
                        e.currentTarget.style.backgroundColor = bgDefault;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'scale(1)';
                        e.currentTarget.style.backgroundColor = bgDefault;
                      }}
                    >
                      {goalsHit ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00FF94" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <SectionIcon type="chart" size={12} />
                      )}
                    </button>
                  );
                })()}
                {/* Day cells (includes overflow days from adjacent months) */}
                {week.days.map((day) => {
                  const dayActivities = calendarData[day.date] || [];
                  const todayStr = getTodayDate();
                  const isToday = day.date === todayStr;
                  const isFuture = day.date > todayStr; // Simple string comparison works for YYYY-MM-DD format
                  const isLocked = !!(historyCutoffDate && day.date < historyCutoffDate);

                  return (
                    <button
                      key={day.date}
                      onClick={() => {
                        setSelectedDate(day.date);
                        // Free users: block viewing day details beyond 30 days
                        if (historyCutoffDate && day.date < historyCutoffDate) {
                          onPresentPaywall?.();
                          return;
                        }
                        if (dayActivities.length > 0) {
                          openDayModal();
                        } else if (!isFuture) {
                          onAddActivity && onAddActivity(day.date);
                        }
                      }}
                      className="flex-1 aspect-square rounded-md flex flex-col items-center justify-center relative transition-all duration-150"
                      style={{
                        backgroundColor: selectedDate === day.date ? 'rgba(0,255,148,0.2)' :
                                         dayActivities.length > 0 ? 'rgba(255,255,255,0.05)' : 'transparent',
                        border: isToday ? '2px solid #00FF94' : 'none',
                        opacity: day.isOverflow ? 0.35 : (isFuture ? 0.3 : (isLocked ? 0.4 : 1))
                      }}
                      onTouchStart={(e) => {
                        if (!isFuture) e.currentTarget.style.transform = 'scale(0.92)';
                      }}
                      onTouchEnd={(e) => e.currentTarget.style.transform = 'scale(1)'}
                      onMouseDown={(e) => {
                        if (!isFuture) e.currentTarget.style.transform = 'scale(0.92)';
                      }}
                      onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
                      onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                    >
                      <span className={`text-[11px] ${dayActivities.length > 0 && !day.isOverflow ? 'font-bold' : 'text-gray-500'}`}>
                        {day.day}
                      </span>
                      {dayActivities.length > 0 && (
                        <div className="flex gap-0.5 mt-0.5">
                          {dayActivities.slice(0, 2).map((a, i) => (
                            <div key={i} className="w-1 h-1 rounded-full"
                              style={{ backgroundColor: a.type === 'Strength Training' ? '#00FF94' : a.type === 'Running' ? '#FF9500' : '#00D1FF' }}
                            />
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* How This Week Compares Section */}
          <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 uppercase tracking-wider">How This Week Compares</span>
                <SectionIcon type="compare" size={14} />
              </div>
            </div>
            
            {/* Slider Toggle */}
            <div className="relative flex p-1 rounded-lg mb-4" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
              {/* Sliding pill indicator */}
              <div 
                className="absolute top-1 bottom-1 rounded-md transition-all duration-300 ease-out"
                style={{ 
                  backgroundColor: 'rgba(255,255,255,0.1)',
                  width: 'calc((100% - 8px) / 2)',
                  left: compareWeek === 'average' ? '4px' : 'calc(4px + (100% - 8px) / 2)'
                }}
              />
              <button
                onClick={() => setCompareWeek('average')}
                className="flex-1 py-2 rounded-md text-xs font-medium transition-colors duration-200 relative z-10"
                style={{ 
                  color: compareWeek === 'average' ? 'white' : 'rgba(255,255,255,0.5)'
                }}
              >
                vs Average
              </button>
              <button
                onClick={() => setCompareWeek('week-2')}
                className="flex-1 py-2 rounded-md text-xs font-medium transition-colors duration-200 relative z-10"
                style={{ 
                  color: compareWeek === 'week-2' ? 'white' : 'rgba(255,255,255,0.5)'
                }}
              >
                vs Last Week
              </button>
            </div>
            
            {/* This Week Stats - With comparison arrows */}
            <div className="p-4 rounded-2xl mb-2" style={{ backgroundColor: 'rgba(0,255,148,0.1)', border: '1px solid rgba(0,255,148,0.2)' }}>
              <div className="text-xs text-gray-400 mb-3">This Week</div>
              <div className="grid grid-cols-5 gap-2 text-center">
                <div>
                  <div className="text-lg font-black text-white">{currentWeekStats.lifts}</div>
                  <div className="text-[10px] text-gray-400 whitespace-nowrap">💪 Strength</div>
                  {(() => {
                    const compare = compareWeek === 'average' ? weeklyStats['average']?.lifts || 0 : weeklyStats['week-2']?.lifts || 0;
                    if (currentWeekStats.lifts > compare) return <div className="text-[10px] mt-1" style={{ color: '#00FF94' }}>↑</div>;
                    if (currentWeekStats.lifts < compare) return <div className="text-[10px] mt-1" style={{ color: '#FF453A' }}>↓</div>;
                    return <div className="text-[10px] mt-1 opacity-0">-</div>;
                  })()}
                </div>
                <div>
                  <div className="text-lg font-black text-white">{currentWeekStats.cardio}</div>
                  <div className="text-[10px] text-gray-400 whitespace-nowrap">❤️‍🔥 Cardio</div>
                  {(() => {
                    const compare = compareWeek === 'average' ? weeklyStats['average']?.cardio || 0 : weeklyStats['week-2']?.cardio || 0;
                    if (currentWeekStats.cardio > compare) return <div className="text-[10px] mt-1" style={{ color: '#00FF94' }}>↑</div>;
                    if (currentWeekStats.cardio < compare) return <div className="text-[10px] mt-1" style={{ color: '#FF453A' }}>↓</div>;
                    return <div className="text-[10px] mt-1 opacity-0">-</div>;
                  })()}
                </div>
                <div>
                  <div className="text-lg font-black text-white">{currentWeekStats.recovery}</div>
                  <div className="text-[10px] text-gray-400 whitespace-nowrap">🧊 Recov</div>
                  {(() => {
                    const compare = compareWeek === 'average' ? weeklyStats['average']?.recovery || 0 : weeklyStats['week-2']?.recovery || 0;
                    if (currentWeekStats.recovery > compare) return <div className="text-[10px] mt-1" style={{ color: '#00FF94' }}>↑</div>;
                    if (currentWeekStats.recovery < compare) return <div className="text-[10px] mt-1" style={{ color: '#FF453A' }}>↓</div>;
                    return <div className="text-[10px] mt-1 opacity-0">-</div>;
                  })()}
                </div>
                <div>
                  <div className="text-lg font-black text-white">{(currentWeekStats.calories/1000).toFixed(1)}k</div>
                  <div className="text-[10px] text-gray-400 whitespace-nowrap">🔥 Cals</div>
                  {(() => {
                    const compare = compareWeek === 'average' ? weeklyStats['average']?.calories || 0 : weeklyStats['week-2']?.calories || 0;
                    if (currentWeekStats.calories > compare) return <div className="text-[10px] mt-1" style={{ color: '#00FF94' }}>↑</div>;
                    if (currentWeekStats.calories < compare) return <div className="text-[10px] mt-1" style={{ color: '#FF453A' }}>↓</div>;
                    return <div className="text-[10px] mt-1 opacity-0">-</div>;
                  })()}
                </div>
                <div>
                  <div className="text-lg font-black text-white">{currentWeekStats.miles.toFixed(1)}</div>
                  <div className="text-[10px] text-gray-400 whitespace-nowrap">📍 Miles</div>
                  {(() => {
                    const compare = compareWeek === 'average' ? weeklyStats['average']?.miles || 0 : weeklyStats['week-2']?.miles || 0;
                    if (currentWeekStats.miles > compare) return <div className="text-[10px] mt-1" style={{ color: '#00FF94' }}>↑</div>;
                    if (currentWeekStats.miles < compare) return <div className="text-[10px] mt-1" style={{ color: '#FF453A' }}>↓</div>;
                    return <div className="text-[10px] mt-1 opacity-0">-</div>;
                  })()}
                </div>
              </div>
            </div>

            {/* Comparison Stats - With placeholder for uniform height */}
            <div className="p-4 rounded-2xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
              <div className="text-xs text-gray-400 mb-3">
                {compareWeek === 'average' ? 'Your Average Week' : 'Last Week'}
              </div>
              <div className="grid grid-cols-5 gap-2 text-center">
                <div>
                  <div className="text-lg font-black">{compareWeek === 'average' ? weeklyStats['average']?.lifts || 0 : weeklyStats['week-2']?.lifts || 0}</div>
                  <div className="text-[10px] text-gray-400 whitespace-nowrap">💪 Strength</div>
                  <div className="text-[10px] mt-1 opacity-0">-</div>
                </div>
                <div>
                  <div className="text-lg font-black">{compareWeek === 'average' ? weeklyStats['average']?.cardio || 0 : weeklyStats['week-2']?.cardio || 0}</div>
                  <div className="text-[10px] text-gray-400 whitespace-nowrap">❤️‍🔥 Cardio</div>
                  <div className="text-[10px] mt-1 opacity-0">-</div>
                </div>
                <div>
                  <div className="text-lg font-black">{compareWeek === 'average' ? weeklyStats['average']?.recovery || 0 : weeklyStats['week-2']?.recovery || 0}</div>
                  <div className="text-[10px] text-gray-400 whitespace-nowrap">🧊 Recov</div>
                  <div className="text-[10px] mt-1 opacity-0">-</div>
                </div>
                <div>
                  <div className="text-lg font-black">{compareWeek === 'average' ? ((weeklyStats['average']?.calories || 0)/1000).toFixed(1) + 'k' : ((weeklyStats['week-2']?.calories || 0)/1000).toFixed(1) + 'k'}</div>
                  <div className="text-[10px] text-gray-400 whitespace-nowrap">🔥 Cals</div>
                  <div className="text-[10px] mt-1 opacity-0">-</div>
                </div>
                <div>
                  <div className="text-lg font-black">{(compareWeek === 'average' ? weeklyStats['average']?.miles || 0 : weeklyStats['week-2']?.miles || 0).toFixed(1)}</div>
                  <div className="text-[10px] text-gray-400 whitespace-nowrap">📍 Miles</div>
                  <div className="text-[10px] mt-1 opacity-0">-</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Latest Activity — collapsible list. Only shown on the Calendar view; Stats and Compare hide it. */}
      {view === 'calendar' && visibleActivities.length > 0 && (() => {
        const sortedActivities = [...visibleActivities]
          .sort((a, b) => {
            const dateCompare = (b.date || '').localeCompare(a.date || '');
            if (dateCompare !== 0) return dateCompare;
            if (a.time && b.time) {
              return parseTimeToMinutes(b.time) - parseTimeToMinutes(a.time);
            }
            return 0;
          })
          .slice(0, 10);
        const visibleCount = historyLatestExpanded ? sortedActivities.length : Math.min(3, sortedActivities.length);
        const toShow = sortedActivities.slice(0, visibleCount);
        const hasMore = sortedActivities.length > 3;

        return (
          <div ref={historyLatestActivityRef} className="mx-4 mt-6 mb-6" style={{ scrollMarginTop: 80 }}>
            <div className="mb-3">
              <div className="flex items-center gap-2">
                <SectionIcon type="clock" />
                <span className="text-[20px] font-semibold text-white" style={{ letterSpacing: '-0.3px' }}>Latest Activity</span>
              </div>
              <p className="text-[13px] -mt-1 pl-[30px]" style={{ color: '#777' }}>Your recent workout and recovery sessions</p>
            </div>

            <div className="space-y-2">
              {toShow.map((activity) => (
                <button
                  key={activity.id}
                  onClick={() => { triggerHaptic(ImpactStyle.Light); setSelectedDayActivity(activity); }}
                  className="w-full p-3 flex items-center gap-3 text-left rounded-xl transition-opacity active:opacity-70"
                  style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                >
                  <ActivityIcon type={activity.type} subtype={activity.subtype} size={20} sportEmoji={activity.sportEmoji} customEmoji={activity.customEmoji} customIcon={activity.customIcon} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{
                      activity.type === 'Other' ? (activity.subtype || 'Other')
                      : activity.type === 'Strength Training' ? (() => {
                        const st = activity.strengthType || 'Strength Training';
                        const areas = normalizeFocusAreas(activity.focusAreas || (activity.focusArea ? [activity.focusArea] : []));
                        if (areas.length > 0) return `${st} - ${areas.join(', ')}`;
                        return activity.subtype || st;
                      })()
                      : (activity.subtype ? `${activity.type} • ${activity.subtype}` : activity.type)
                    }</div>
                    <div className="text-[11px] text-gray-500 flex items-center gap-2">
                      <span>{formatFriendlyDate(activity.date)}{activity.time ? ` at ${activity.time}` : ''}{activity.duration ? ` (${activity.duration} min)` : ''}</span>
                      {(activity.healthKitUUID || activity.linkedHealthKitUUID || activity.source === 'healthkit' || activity.fromAppleHealth) && (
                        <span className="flex items-center gap-1 text-cyan-400">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                          </svg>
                          <span className="text-[10px]">{activity.sourceDevice || 'Apple Health'}</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-gray-600 text-xs">›</span>
                </button>
              ))}

              {hasMore && (
                <button
                  onClick={() => { triggerHaptic(ImpactStyle.Light); setHistoryLatestExpanded(v => !v); }}
                  className="w-full py-2 text-center text-xs font-medium transition-all duration-150 rounded-xl"
                  style={{ color: 'rgba(255,255,255,0.5)' }}
                >
                  {historyLatestExpanded ? 'See less' : `See ${sortedActivities.length - 3} more`}
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* Day Stats Modal - Full screen like week review */}
      {(showDayModal || dayModalClosing) && calendarData[selectedDate] && (() => {
        // Get full activity data from activities array (has IDs and all stats)
        const fullDayActivities = visibleActivities.filter(a => a.date === selectedDate);
        const lifts = fullDayActivities.filter(a => getActivityCategory(a) === 'lifting');
        const cardioActivities = fullDayActivities.filter(a => getActivityCategory(a) === 'cardio');
        const recoveryActivities = fullDayActivities.filter(a => getActivityCategory(a) === 'recovery');
        const nonCardioWalks = fullDayActivities.filter(a =>
          a.type === 'Walking' && !a.countToward
        );

        // Format date nicely
        const dateObj = new Date(selectedDate + 'T12:00:00');
        const formattedDate = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

        // Calculate daily totals from actual data
        // Get HealthKit data for this day
        const dayHealthData = healthDataByDate[selectedDate];
        // Use HealthKit calories directly — wearables already track all active energy
        const dayCalories = dayHealthData?.calories || 0;
        const daySteps = dayHealthData?.steps || 0;
        const dayMiles = fullDayActivities.reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);
        const totalSessions = fullDayActivities.length;
        
        return (
          <div 
            className="fixed inset-0 z-50 flex flex-col transition-opacity duration-150"
            style={{ 
              backgroundColor: 'rgba(0,0,0,0.95)',
              opacity: dayModalAnimating ? 1 : 0
            }}
          >
            <div className="flex items-center justify-between p-4 border-b border-white/10" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
              <button 
                onClick={() => closeDayModal()} 
                className="text-gray-400 transition-all duration-150 px-2 py-1 rounded-lg"
                onTouchStart={(e) => {
                  e.currentTarget.style.transform = 'scale(0.9)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                }}
                onTouchEnd={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = 'scale(0.9)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                ← Back
              </button>
              <h2 className="font-bold">{formattedDate}</h2>
              <button 
                onClick={() => {
                  closeDayModal();
                  onAddActivity && onAddActivity(selectedDate);
                }}
                className="text-sm font-medium transition-all duration-150 px-2 py-1 rounded-lg"
                style={{ color: '#00FF94' }}
                onTouchStart={(e) => {
                  e.currentTarget.style.transform = 'scale(0.9)';
                  e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.2)';
                }}
                onTouchEnd={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = 'scale(0.9)';
                  e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.2)';
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                + Add
              </button>
            </div>
            
            <div className="flex-1 overflow-auto p-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(0,255,148,0.1)' }}>
                  <div className="text-2xl font-black" style={{ color: '#00FF94' }}>{lifts.length}</div>
                  <div className="text-[10px] text-gray-400">💪 Strength</div>
                </div>
                <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(255,149,0,0.1)' }}>
                  <div className="text-2xl font-black" style={{ color: '#FF9500' }}>{cardioActivities.length}</div>
                  <div className="text-[10px] text-gray-400">❤️‍🔥 Cardio</div>
                </div>
                <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(0,209,255,0.1)' }}>
                  <div className="text-2xl font-black" style={{ color: '#00D1FF' }}>{recoveryActivities.length}</div>
                  <div className="text-[10px] text-gray-400">🧊 Recovery</div>
                </div>
              </div>

              {/* Daily Totals */}
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <SectionIcon type="chart" />
                  <span className="text-[20px] font-semibold text-white" style={{ letterSpacing: '-0.3px' }}>Daily Totals</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,149,0,0.1)' }}>
                    <div className="text-lg font-black" style={{ color: '#FF9500' }}>{dayCalories.toLocaleString()}</div>
                    <div className="text-[10px] text-gray-400">Calories Burned</div>
                  </div>
                  <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,107,157,0.1)' }}>
                    <div className="text-lg font-black" style={{ color: '#FF6B9D' }}>{daySteps.toLocaleString()}</div>
                    <div className="text-[10px] text-gray-400">Steps</div>
                  </div>
                  <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    <div className="text-lg font-black">{dayMiles ? parseFloat(dayMiles).toFixed(1) : 0} mi</div>
                    <div className="text-[10px] text-gray-400">Distance Traveled</div>
                  </div>
                  <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    <div className="text-lg font-black">{fullDayActivities.reduce((sum, a) => sum + (a.duration || 0), 0)} min</div>
                    <div className="text-[10px] text-gray-400">Total Duration</div>
                  </div>
                </div>
              </div>

              {/* Activities Completed Header */}
              <div className="mb-4">
                <div className="flex items-center gap-2">
                  <SectionIcon type="activity" />
                  <span className="text-[20px] font-semibold text-white" style={{ letterSpacing: '-0.3px' }}>Activities Completed</span>
                </div>
                <p className="text-[13px] -mt-1 pl-[30px]" style={{ color: '#777' }}>Swipe left to delete, tap for details</p>
              </div>

              <SwipeableProvider>
              {/* Strength Section */}
              {lifts.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-medium text-gray-300">💪 Strength</span>
                  </div>
                  <div className="space-y-2">
                    {lifts.map((activity, i) => (
                      <SwipeableActivityItem
                        key={activity.id || i}
                        activity={activity}
                        onDelete={(act) => onDeleteActivity && onDeleteActivity(act.id)}
                      >
                        <div
                          onClick={() => setSelectedDayActivity(activity)}
                          className="w-full p-3 text-left cursor-pointer"
                          style={{ backgroundColor: 'rgba(0,255,148,0.05)' }}
                        >
                          <div className="flex justify-between items-start mb-2">
                            <div className="font-medium text-sm flex items-center gap-1">
                              {activity.type === 'Other' && (activity.customIcon || activity.customEmoji) && <ActivityIcon type="Other" customIcon={activity.customIcon} customEmoji={activity.customEmoji} size={14} />}
                              {activity.type === 'Strength Training'
                                ? (() => { const areas = normalizeFocusAreas(activity.focusAreas || (activity.focusArea ? [activity.focusArea] : [])); return activity.subtype ? `${activity.subtype}${areas.length > 0 ? ` • ${areas.join(', ')}` : ''}` : (areas.length > 0 ? `Strength Training • ${areas.join(', ')}` : 'Strength Training'); })()
                                : (activity.type === 'Other' ? (activity.subtype || 'Other') : (activity.subtype ? `${activity.type} • ${activity.subtype}` : activity.type))}
                            </div>
                            <span className="text-gray-500 text-xs">›</span>
                          </div>
                          <div className="flex gap-4 text-xs text-gray-400">
                            {activity.duration && <span>{activity.duration} min</span>}
                            {activity.calories && <span>{activity.calories} cal</span>}
                            {activity.avgHr && <span>♥ {activity.avgHr}</span>}
                            {(activity.healthKitUUID || activity.linkedHealthKitUUID || activity.source === 'healthkit' || activity.fromAppleHealth) && (
                              <span className="flex items-center gap-1 text-cyan-400">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                                </svg>
                                {activity.sourceDevice || 'Apple Health'}
                              </span>
                            )}
                          </div>
                        </div>
                      </SwipeableActivityItem>
                    ))}
                  </div>
                </div>
              )}

              {/* Cardio Section */}
              {cardioActivities.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-medium text-gray-300">❤️‍🔥 Cardio</span>
                  </div>
                  <div className="space-y-2">
                    {cardioActivities.map((activity, i) => (
                      <SwipeableActivityItem
                        key={activity.id || i}
                        activity={activity}
                        onDelete={(act) => onDeleteActivity && onDeleteActivity(act.id)}
                      >
                        <div
                          onClick={() => setSelectedDayActivity(activity)}
                          className="w-full p-3 text-left cursor-pointer"
                          style={{ backgroundColor: 'rgba(255,149,0,0.05)' }}
                        >
                          <div className="flex justify-between items-start mb-2">
                            <div className="font-medium text-sm flex items-center gap-1">
                              {activity.type === 'Other' && (activity.customIcon || activity.customEmoji) && <ActivityIcon type="Other" customIcon={activity.customIcon} customEmoji={activity.customEmoji} size={14} />}
                              {activity.type === 'Other' ? (activity.subtype || activity.type) : (activity.subtype ? `${activity.type} • ${activity.subtype}` : activity.type)}
                            </div>
                            <span className="text-gray-500 text-xs">›</span>
                          </div>
                          <div className="flex gap-4 text-xs text-gray-400">
                            {activity.distance && <span>{parseFloat(activity.distance).toFixed(2)} mi</span>}
                            {activity.duration && <span>{activity.duration} min</span>}
                            {activity.calories && <span>{activity.calories} cal</span>}
                            {(activity.healthKitUUID || activity.linkedHealthKitUUID || activity.source === 'healthkit' || activity.fromAppleHealth) && (
                              <span className="flex items-center gap-1 text-cyan-400">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                                </svg>
                                {activity.sourceDevice || 'Apple Health'}
                              </span>
                            )}
                          </div>
                        </div>
                      </SwipeableActivityItem>
                    ))}
                  </div>
                </div>
              )}

              {/* Recovery Section */}
              {recoveryActivities.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-medium text-gray-300">🧊 Recovery</span>
                  </div>
                  <div className="space-y-2">
                    {recoveryActivities.map((activity, i) => (
                      <SwipeableActivityItem
                        key={activity.id || i}
                        activity={activity}
                        onDelete={(act) => onDeleteActivity && onDeleteActivity(act.id)}
                      >
                        <div
                          onClick={() => setSelectedDayActivity(activity)}
                          className="w-full p-3 text-left cursor-pointer"
                          style={{ backgroundColor: 'rgba(0,209,255,0.05)' }}
                        >
                          <div className="flex justify-between items-start mb-2">
                            <div className="font-medium text-sm flex items-center gap-1">
                              {activity.type === 'Other' && (activity.customIcon || activity.customEmoji) && <ActivityIcon type="Other" customIcon={activity.customIcon} customEmoji={activity.customEmoji} size={14} />}
                              {activity.type === 'Other' ? (activity.subtype || activity.type) : (activity.subtype ? `${activity.type} • ${activity.subtype}` : activity.type)}
                            </div>
                            <span className="text-gray-500 text-xs">›</span>
                          </div>
                          <div className="flex gap-4 text-xs text-gray-400">
                            {activity.duration && <span>{activity.duration} min</span>}
                            {activity.calories && <span>{activity.calories} cal</span>}
                            {(activity.healthKitUUID || activity.linkedHealthKitUUID || activity.source === 'healthkit' || activity.fromAppleHealth) && (
                              <span className="flex items-center gap-1 text-cyan-400">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                                </svg>
                                {activity.sourceDevice || 'Apple Health'}
                              </span>
                            )}
                          </div>
                        </div>
                      </SwipeableActivityItem>
                    ))}
                  </div>
                </div>
              )}

              {/* Non-Cardio Walks Section */}
              {nonCardioWalks.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-medium text-gray-400">🚶 Walks</span>
                    <span className="text-[10px] text-gray-500">(non-cardio)</span>
                  </div>
                  <div className="space-y-2">
                    {nonCardioWalks.map((activity, i) => (
                      <SwipeableActivityItem
                        key={activity.id || i}
                        activity={activity}
                        onDelete={(act) => onDeleteActivity && onDeleteActivity(act.id)}
                      >
                        <div
                          onClick={() => setSelectedDayActivity(activity)}
                          className="w-full p-3 text-left cursor-pointer"
                          style={{ backgroundColor: 'rgba(128,128,128,0.05)' }}
                        >
                          <div className="flex justify-between items-start mb-2">
                            <div className="font-medium text-sm flex items-center gap-1">
                              {activity.subtype ? `Walking • ${activity.subtype}` : 'Walking'}
                            </div>
                            <span className="text-gray-500 text-xs">›</span>
                          </div>
                          <div className="flex gap-4 text-xs text-gray-400">
                            {activity.distance && <span>{parseFloat(activity.distance).toFixed(2)} mi</span>}
                            {activity.duration && <span>{activity.duration} min</span>}
                            {activity.calories && <span>{activity.calories} cal</span>}
                            {(activity.healthKitUUID || activity.linkedHealthKitUUID || activity.source === 'healthkit' || activity.fromAppleHealth) && (
                              <span className="flex items-center gap-1 text-cyan-400">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                                </svg>
                                {activity.sourceDevice || 'Apple Health'}
                              </span>
                            )}
                          </div>
                        </div>
                      </SwipeableActivityItem>
                    ))}
                  </div>
                </div>
              )}
              </SwipeableProvider>
            </div>
          </div>
        );
      })()}

      {/* Records View */}
      {/* Stats View (with mini-toggle for Overview/Records) */}
      {view === 'stats' && (
        <div ref={statsRef} className="mx-4 mt-2">
          {/* Stats Headline */}
          <div className="mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SectionIcon type="chart" />
                <span className="text-[20px] font-semibold text-white" style={{ letterSpacing: '-0.3px' }}>Your Stats</span>
              </div>
              <button
                onClick={onShare}
                className="p-1.5 transition-colors duration-150 hover:text-white"
                style={{ color: 'rgba(255,255,255,0.4)' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" y1="2" x2="12" y2="15" />
                </svg>
              </button>
            </div>
            <p className="text-[13px] -mt-1 pl-[30px]" style={{ color: '#777' }}>Your totals over time</p>
          </div>

          {/* Toggle and Dropdown Row */}
          <div className="flex items-center justify-between mb-4 gap-3">
            {/* Mini Toggle - left aligned */}
            <div className="relative flex p-1 rounded-lg flex-1" style={{ backgroundColor: 'rgba(255,255,255,0.05)', maxWidth: '240px' }}>
              {/* Sliding pill indicator */}
              <div
                className="absolute top-1 bottom-1 rounded-md transition-all duration-300 ease-out"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.1)',
                  width: 'calc((100% - 8px) / 3)',
                  left: statsSubView === 'overview'
                    ? '4px'
                    : statsSubView === 'records'
                      ? 'calc(4px + (100% - 8px) / 3)'
                      : 'calc(4px + 2 * (100% - 8px) / 3)'
                }}
              />
              <button
                onClick={() => setStatsSubView('overview')}
                className="flex-1 py-1 rounded-md text-xs font-medium transition-colors duration-200 relative z-10"
                style={{
                  color: statsSubView === 'overview' ? 'white' : 'rgba(255,255,255,0.5)'
                }}
              >
                Overview
              </button>
              <button
                onClick={() => setStatsSubView('records')}
                className="flex-1 py-1 rounded-md text-xs font-medium transition-colors duration-200 relative z-10"
                style={{
                  color: statsSubView === 'records' ? 'white' : 'rgba(255,255,255,0.5)'
                }}
              >
                Records
              </button>
              <button
                onClick={() => setStatsSubView('trends')}
                className="flex-1 py-1 rounded-md text-xs font-medium transition-colors duration-200 relative z-10"
                style={{
                  color: statsSubView === 'trends' ? 'white' : 'rgba(255,255,255,0.5)'
                }}
              >
                Trends
              </button>
            </div>

            {/* Time Period Dropdown - right aligned, only show for overview */}
            {statsSubView === 'overview' && (
              isPro ? (
                <select
                  value={totalsView}
                  onChange={(e) => setTotalsView(e.target.value)}
                  className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs flex-shrink-0"
                >
                  <option value="this-week" className="bg-black">This Week</option>
                  <option value="this-month" className="bg-black">This Month</option>
                  <option value="last-month" className="bg-black">Last Month</option>
                  <option value={String(getCurrentYear())} className="bg-black">{getCurrentYear()}</option>
                  <option value="all-time" className="bg-black">All-Time</option>
                  <optgroup label="Past Months" className="bg-black">
                    {monthOptions.slice(2).map(opt => (
                      <option key={opt.value} value={opt.value} className="bg-black">{opt.label}</option>
                    ))}
                  </optgroup>
                </select>
              ) : (
                <select
                  value={totalsView}
                  onChange={(e) => {
                    if (e.target.value === 'pro-locked') {
                      onPresentPaywall?.();
                      e.target.value = totalsView;
                      return;
                    }
                    setTotalsView(e.target.value);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs flex-shrink-0"
                >
                  <option value="this-week" className="bg-black">This Week</option>
                  <option value="last-7-days" className="bg-black">Last 7 Days</option>
                  <option value="pro-locked" className="bg-black">🔒 Last 30 Days</option>
                  <option value="pro-locked" className="bg-black">🔒 This Month</option>
                  <option value="pro-locked" className="bg-black">🔒 {getCurrentYear()}</option>
                  <option value="pro-locked" className="bg-black">🔒 All-Time</option>
                </select>
              )
            )}
          </div>

          {/* Overview Sub-View */}
          {statsSubView === 'overview' && (
            <>

              {/* Main Stats Row - Strength / Cardio / Recovery */}
              <div className="grid grid-cols-3 gap-2.5 mb-3">
                <div className="p-3.5 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(0, 255, 148, 0.06) 0%, rgba(39, 39, 42, 0.5) 100%)' }}>
                  <div className="text-3xl font-black" style={{ color: '#00FF94' }}>{totalsData.liftingCount || 0}</div>
                  <div className="text-xs text-gray-400 flex items-center gap-1 mt-1">
                    <span>💪</span>
                    <span>Strength</span>
                  </div>
                </div>
                <div className="p-3.5 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(255, 149, 0, 0.06) 0%, rgba(39, 39, 42, 0.5) 100%)' }}>
                  <div className="text-3xl font-black" style={{ color: '#FF9500' }}>{Object.values(totalsData.cardio || {}).reduce((a, b) => a + b, 0)}</div>
                  <div className="text-xs text-gray-400 flex items-center gap-1 mt-1">
                    <span>❤️‍🔥</span>
                    <span>Cardio</span>
                  </div>
                </div>
                <div className="p-3.5 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(0, 209, 255, 0.06) 0%, rgba(39, 39, 42, 0.5) 100%)' }}>
                  <div className="text-3xl font-black" style={{ color: '#00D1FF' }}>{totalsData.recovery}</div>
                  <div className="text-xs text-gray-400 flex items-center gap-1 mt-1">
                    <span>🧊</span>
                    <span>Recovery</span>
                  </div>
                </div>
              </div>

              {/* Distance & Steps Row */}
              <div className="grid grid-cols-2 gap-2.5 mb-4">
                {/* Total Distance with breakdown */}
                <div className="p-3.5 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(255, 87, 87, 0.06) 0%, rgba(39, 39, 42, 0.5) 100%)' }}>
                  <div className="text-2xl font-black" style={{ color: '#FF5757' }}>{totalsData.miles.toFixed(1)}</div>
                  <div className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                    <span>📍</span>
                    <span>Total Miles</span>
                  </div>
                  {totalsData.miles > 0 && (
                    <div className="mt-2 pt-2 space-y-1" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                      {totalsData.milesRan > 0 && (
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="text-gray-500">🏃 Ran</span>
                          <span className="text-gray-400 font-medium">{totalsData.milesRan.toFixed(1)} mi</span>
                        </div>
                      )}
                      {totalsData.milesBiked > 0 && (
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="text-gray-500">🚴 Biked</span>
                          <span className="text-gray-400 font-medium">{totalsData.milesBiked.toFixed(1)} mi</span>
                        </div>
                      )}
                      {totalsData.milesWalked > 0 && (
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="text-gray-500">🚶 Walked</span>
                          <span className="text-gray-400 font-medium">{totalsData.milesWalked.toFixed(1)} mi</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {/* Steps */}
                <div className="p-3.5 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(168, 130, 255, 0.06) 0%, rgba(39, 39, 42, 0.5) 100%)' }}>
                  {(() => {
                    // Sum steps from healthHistory for the selected period
                    const today = new Date();
                    const thisMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
                    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                    const lastMonthStr = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
                    const currentYearStr = String(getCurrentYear());

                    let filteredHistory = healthHistory || [];
                    if (totalsView === 'this-week') {
                      const dayOfWeek = today.getDay();
                      const sunday = new Date(today);
                      sunday.setDate(today.getDate() - dayOfWeek);
                      const sundayStr = `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`;
                      const saturday = new Date(sunday);
                      saturday.setDate(sunday.getDate() + 6);
                      const saturdayStr = `${saturday.getFullYear()}-${String(saturday.getMonth() + 1).padStart(2, '0')}-${String(saturday.getDate()).padStart(2, '0')}`;
                      filteredHistory = filteredHistory.filter(h => h.date >= sundayStr && h.date <= saturdayStr);
                    } else if (totalsView === 'last-7-days') {
                      const cutoff = new Date();
                      cutoff.setDate(cutoff.getDate() - 7);
                      const cutoffStr = cutoff.toISOString().split('T')[0];
                      filteredHistory = filteredHistory.filter(h => h.date >= cutoffStr);
                    } else if (totalsView === 'last-30-days') {
                      const cutoff = new Date();
                      cutoff.setDate(cutoff.getDate() - 30);
                      const cutoffStr = cutoff.toISOString().split('T')[0];
                      filteredHistory = filteredHistory.filter(h => h.date >= cutoffStr);
                    } else if (totalsView === 'this-month') {
                      filteredHistory = filteredHistory.filter(h => h.date?.startsWith(thisMonthStr));
                    } else if (totalsView === 'last-month') {
                      filteredHistory = filteredHistory.filter(h => h.date?.startsWith(lastMonthStr));
                    } else if (totalsView.match(/^\d{4}-\d{2}$/)) {
                      filteredHistory = filteredHistory.filter(h => h.date?.startsWith(totalsView));
                    } else if (totalsView === currentYearStr) {
                      filteredHistory = filteredHistory.filter(h => h.date?.startsWith(currentYearStr));
                    }

                    const totalSteps = filteredHistory.reduce((sum, h) => sum + (h.steps || 0), 0);
                    const stepsDisplay = totalSteps >= 1000000 ? `${(totalSteps / 1000000).toFixed(1)}M` : totalSteps >= 1000 ? `${(totalSteps / 1000).toFixed(1)}K` : totalSteps.toLocaleString();
                    const estMiles = totalSteps / 2100;

                    return (
                      <>
                        <div className="text-2xl font-black" style={{ color: '#A882FF' }}>{stepsDisplay}</div>
                        <div className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                          <span>👟</span>
                          <span>Steps</span>
                        </div>
                        {estMiles >= 0.1 && (
                          <div className="mt-2 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                            <div className="flex items-center justify-between text-[10px]">
                              <span className="text-gray-500">📍 Est. distance</span>
                              <span className="text-gray-400 font-medium">{estMiles.toFixed(1)} mi</span>
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Strength Breakdown */}
              <div className="mb-6">
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">💪 Muscle groups trained {(() => {
                  const labels = { 'this-week': '(this week)', 'this-month': '(this month)', 'last-month': '(last month)', 'last-30-days': '(last 30 days)', 'all-time': '(all time)' };
                  if (labels[totalsView]) return labels[totalsView];
                  if (/^\d{4}$/.test(totalsView)) return `(${totalsView})`;
                  const monthMatch = monthOptions.find(m => m.value === totalsView);
                  return monthMatch ? `(${monthMatch.label})` : '';
                })()}</div>
                <div className="p-4 rounded-2xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  {Object.keys(totalsData.lifting || {}).length > 0 ? (
                    <div>
                      <div className="mb-4">
                        <MuscleBodyMap muscleData={totalsData.lifting} />
                      </div>
                      <div className="space-y-2">
                        {Object.entries(totalsData.lifting).map(([type, count]) => (
                          <div key={type} className="flex items-center justify-between">
                            <span className="text-gray-400">{type}</span>
                            <span className="font-bold">{count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-gray-500 text-sm text-center">No strength training logged yet</p>
                  )}
                </div>
              </div>

              {/* Cardio Breakdown */}
              <div className="mb-6">
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">❤️‍🔥 Cardio Breakdown</div>
                <div className="p-4 rounded-2xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  {Object.keys(totalsData.cardio || {}).length > 0 ? (
                    <div className="space-y-2">
                      {Object.entries(totalsData.cardio).map(([type, count]) => (
                        <div key={type} className="flex items-center justify-between">
                          <span className="text-gray-400">{type}</span>
                          <span className="font-bold">{count}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 text-sm text-center">No runs logged yet</p>
                  )}
                </div>
              </div>

              {/* Recovery Breakdown */}
              <div className="mb-6">
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">🧊 Recovery Breakdown</div>
                {Object.keys(totalsData.recoveryBreakdown || {}).length > 0 ? (
                  <div className="space-y-2">
                    {Object.entries(totalsData.recoveryBreakdown).map(([type, count]) => (
                      <div key={type} className="p-3 rounded-xl flex items-center justify-between" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                        <div className="flex items-center gap-3">
                          <ActivityIcon type={type} size={20} />
                          <span>{type}</span>
                        </div>
                        <span className="font-bold">{count}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 rounded-2xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    <p className="text-gray-500 text-sm text-center">No recovery sessions logged yet</p>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Records Sub-View */}
          {statsSubView === 'records' && (
            <div className="space-y-6">
              {/* Hall of Fame Header */}
              <div className="mb-4">
                <div className="flex items-center gap-2">
                  <SectionIcon type="trophy" />
                  <span className="text-[20px] font-semibold text-white" style={{ letterSpacing: '-0.3px' }}>Hall of Fame</span>
                </div>
                <p className="text-[13px] -mt-1 pl-[30px]" style={{ color: '#777' }}>Your personal bests</p>
              </div>

              {/* Streaks Section */}
              <div>
                <div className="text-xs text-gray-600 uppercase tracking-wider mb-3">Streak Records</div>
                <div className="p-4 rounded-2xl bg-zinc-900/50 space-y-4">
                  {/* Master Streak - Featured */}
                  <div className="flex items-center justify-between pb-3 border-b border-white/5">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">🏆</span>
                      <div>
                        <div className="text-xs text-gray-500">Longest Hybrid Streak</div>
                        <div className="text-2xl font-black text-white">
                          {records.longestMasterStreak ? `${records.longestMasterStreak} weeks` : '—'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Other Streaks */}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <div className="text-[10px] text-gray-600 mb-1">💪 Strength</div>
                      <div className="text-lg font-bold text-white">
                        {records.longestStrengthStreak ? `${records.longestStrengthStreak}w` : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-gray-600 mb-1">❤️‍🔥 Cardio</div>
                      <div className="text-lg font-bold text-white">
                        {records.longestCardioStreak ? `${records.longestCardioStreak}w` : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-gray-600 mb-1">🧊 Recovery</div>
                      <div className="text-lg font-bold text-white">
                        {records.longestRecoveryStreak ? `${records.longestRecoveryStreak}w` : '—'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Single Workout Records */}
              <div>
                <div className="text-xs text-gray-600 uppercase tracking-wider mb-3">Single Workout Records</div>
                <div className="p-4 rounded-2xl bg-zinc-900/50 space-y-3">
                  {/* Highest Calorie Workout */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm">🔥</span>
                      <div className="text-xs text-gray-500">Highest Calorie Workout</div>
                    </div>
                    <div className="text-right">
                      <div className="text-base font-bold text-white">
                        {getRecordValue(records.highestCalories) ? `${getRecordValue(records.highestCalories)} cal` : '—'}
                      </div>
                      {getRecordType(records.highestCalories) && (
                        <div className="text-[9px] text-gray-600">{getRecordType(records.highestCalories)}</div>
                      )}
                    </div>
                  </div>

                  <div className="border-t border-white/5" />

                  {/* Longest Strength */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm">💪</span>
                      <div className="text-xs text-gray-500">Longest Strength Session</div>
                    </div>
                    <div className="text-base font-bold text-white">
                      {getRecordValue(records.longestStrength) ? (() => {
                        const duration = getRecordValue(records.longestStrength);
                        const hours = Math.floor(duration / 60);
                        const mins = duration % 60;
                        return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
                      })() : '—'}
                    </div>
                  </div>

                  <div className="border-t border-white/5" />

                  {/* Longest Cardio */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm">❤️‍🔥</span>
                      <div className="text-xs text-gray-500">Longest Cardio Session</div>
                    </div>
                    <div className="text-right">
                      <div className="text-base font-bold text-white">
                        {getRecordValue(records.longestCardio) ? (() => {
                          const duration = getRecordValue(records.longestCardio);
                          const hours = Math.floor(duration / 60);
                          const mins = duration % 60;
                          return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
                        })() : '—'}
                      </div>
                      {getRecordType(records.longestCardio) && (
                        <div className="text-[9px] text-gray-600">{getRecordType(records.longestCardio)}</div>
                      )}
                    </div>
                  </div>

                  <div className="border-t border-white/5" />

                  {/* Furthest Run */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm">❤️‍🔥</span>
                      <div className="text-xs text-gray-500">Furthest Run</div>
                    </div>
                    <div className="text-base font-bold text-white">
                      {getRecordValue(records.longestRun) ? `${parseFloat(getRecordValue(records.longestRun)).toFixed(1)} mi` : '—'}
                    </div>
                  </div>

                  <div className="border-t border-white/5" />

                  {/* Furthest Cycle */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm">🚴</span>
                      <div className="text-xs text-gray-500">Furthest Cycle</div>
                    </div>
                    <div className="text-base font-bold text-white">
                      {getRecordValue(records.longestCycle) ? `${parseFloat(getRecordValue(records.longestCycle)).toFixed(1)} mi` : '—'}
                    </div>
                  </div>

                  <div className="border-t border-white/5" />

                  {/* Furthest Walk */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm">🚶</span>
                      <div className="text-xs text-gray-500">Furthest Walk</div>
                    </div>
                    <div className="text-base font-bold text-white">
                      {getRecordValue(records.longestWalk) ? `${parseFloat(getRecordValue(records.longestWalk)).toFixed(1)} mi` : '—'}
                    </div>
                  </div>

                  <div className="border-t border-white/5" />

                  {/* Fastest Running Pace */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm">⚡</span>
                      <div className="text-xs text-gray-500">Fastest Run Pace</div>
                    </div>
                    <div className="text-right">
                      <div className="text-base font-bold text-white">
                        {getRecordValue(records.fastestPace) ? (() => {
                          const pace = getRecordValue(records.fastestPace);
                          const paceMin = Math.floor(pace);
                          const paceSec = Math.round((pace - paceMin) * 60);
                          return `${paceMin}:${paceSec.toString().padStart(2, '0')}/mi`;
                        })() : '—'}
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-white/5" />

                  {/* Fastest Cycling Pace */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm">🚴</span>
                      <div className="text-xs text-gray-500">Fastest Cycle Pace</div>
                    </div>
                    <div className="text-base font-bold text-white">
                      {getRecordValue(records.fastestCyclingPace) ? (() => {
                        const pace = getRecordValue(records.fastestCyclingPace);
                        const paceMin = Math.floor(pace);
                        const paceSec = Math.round((pace - paceMin) * 60);
                        return `${paceMin}:${paceSec.toString().padStart(2, '0')}/mi`;
                      })() : '—'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Weekly Records */}
              <div>
                <div className="text-xs text-gray-600 uppercase tracking-wider mb-3">Weekly Records</div>
                <div className="p-4 rounded-2xl bg-zinc-900/50 space-y-3">
                  {/* Most Workouts */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm">🎯</span>
                      <div className="text-xs text-gray-500">Most Workouts</div>
                    </div>
                    <div className="text-base font-bold text-white">
                      {records.mostWorkoutsWeek || '—'}
                    </div>
                  </div>

                  <div className="border-t border-white/5" />

                  {/* Most Calories */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm">🔥</span>
                      <div className="text-xs text-gray-500">Most Calories</div>
                    </div>
                    <div className="text-base font-bold text-white">
                      {records.mostCaloriesWeek ? `${records.mostCaloriesWeek.toLocaleString()} cal` : '—'}
                    </div>
                  </div>

                  <div className="border-t border-white/5" />

                  {/* Most Miles */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm">📍</span>
                      <div className="text-xs text-gray-500">Most Miles</div>
                    </div>
                    <div className="text-base font-bold text-white">
                      {records.mostMilesWeek ? `${parseFloat(records.mostMilesWeek).toFixed(1)} mi` : '—'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Trends Sub-View */}
          {statsSubView === 'trends' && (
            <TrendsView activities={visibleActivities} calendarData={calendarData} healthHistory={healthHistory} healthKitData={healthKitData} isPro={isPro} onPresentPaywall={onPresentPaywall} />
          )}
        </div>
      )}

      {/* Progress View - Photo Comparison */}
      {view === 'progress' && (() => {
        // Filter activities that have photos
        const activitiesWithPhotos = activities.filter(a => a.photoURL);

        // Apply category filter
        const filteredActivities = photoFilter === 'all'
          ? activitiesWithPhotos
          : activitiesWithPhotos.filter(a => {
              const category = getActivityCategory(a);
              if (photoFilter === 'strength') return category === 'lifting';
              return category === photoFilter;
            });

        // Sort by date (newest first)
        const sortedActivities = [...filteredActivities].sort((a, b) =>
          b.date.localeCompare(a.date)
        );

        const handlePhotoSelect = (activityId) => {
          // Free users: block selecting photos older than 7 days
          if (!isPro) {
            const activity = activities.find(a => a.id === activityId);
            if (activity) {
              const activityDate = new Date(activity.date + 'T12:00:00');
              const cutoff = new Date();
              cutoff.setDate(cutoff.getDate() - 7);
              if (activityDate < cutoff) {
                onPresentPaywall?.();
                return;
              }
            }
          }
          setSelectedPhotos(prev => {
            if (prev.includes(activityId)) {
              return prev.filter(id => id !== activityId);
            }
            if (prev.length >= 2) {
              return [prev[1], activityId];
            }
            return [...prev, activityId];
          });
        };

        const formatDate = (dateStr) => {
          const date = new Date(dateStr + 'T12:00:00');
          return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        };

        const getActivityIcon = (activity, size = 12) => {
          return <ActivityIcon type={activity.type} subtype={activity.subtype} size={size} sportEmoji={activity.sportEmoji} customEmoji={activity.customEmoji} customIcon={activity.customIcon} />;
        };

        // Get selected activities sorted by date for comparison
        const getCompareActivities = () => {
          const selected = selectedPhotos.map(id => activities.find(a => a.id === id)).filter(Boolean);
          return selected.sort((a, b) => a.date.localeCompare(b.date));
        };

        const calculateDaysBetween = (date1, date2) => {
          const d1 = new Date(date1 + 'T12:00:00');
          const d2 = new Date(date2 + 'T12:00:00');
          const diffTime = Math.abs(d2 - d1);
          return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        };

        // Group activities by month
        const groupByMonth = (activities) => {
          const groups = {};
          activities.forEach(activity => {
            const date = new Date(activity.date + 'T12:00:00');
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            const monthLabel = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            if (!groups[monthKey]) {
              groups[monthKey] = { label: monthLabel, activities: [] };
            }
            groups[monthKey].activities.push(activity);
          });
          // Sort by month key descending (newest first)
          return Object.entries(groups)
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([key, value]) => ({ key, ...value }));
        };

        const monthGroups = groupByMonth(sortedActivities);

        // Get available years from photos
        const availableYears = [...new Set(sortedActivities.map(a => {
          const date = new Date(a.date + 'T12:00:00');
          return date.getFullYear().toString();
        }))].sort((a, b) => b.localeCompare(a)); // Newest first

        // Get available months for the selected year
        const availableMonthsForYear = selectedPhotoYear === 'all'
          ? []
          : [...new Set(sortedActivities
              .filter(a => {
                const date = new Date(a.date + 'T12:00:00');
                return date.getFullYear().toString() === selectedPhotoYear;
              })
              .map(a => {
                const date = new Date(a.date + 'T12:00:00');
                return String(date.getMonth() + 1).padStart(2, '0');
              })
            )].sort((a, b) => b.localeCompare(a)); // Newest first

        // Month names for display
        const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

        // Filter photos by selected year and month
        const displayedPhotos = sortedActivities.filter(a => {
          const date = new Date(a.date + 'T12:00:00');
          const year = date.getFullYear().toString();
          const month = String(date.getMonth() + 1).padStart(2, '0');

          if (selectedPhotoYear !== 'all' && year !== selectedPhotoYear) return false;
          if (selectedPhotoMonth !== 'all' && month !== selectedPhotoMonth) return false;
          return true;
        });

        const clearSelection = () => {
          setSelectedPhotos([]);
        };

        return (
          <div ref={progressPhotosRef} className="px-4 pb-32">
            {/* Header */}
            <div className="mb-4">
              <h2 className="text-lg font-bold text-white">Compare</h2>
              <p className="text-xs text-gray-500">Compare your fitness journey over time</p>
            </div>

            {/* First-visit progress photos hints */}
            {showPhotosHints && (
              <div
                className="mb-4 p-3 rounded-xl relative"
                style={{
                  backgroundColor: 'rgba(0,209,255,0.1)',
                  border: '1px solid rgba(0,209,255,0.3)'
                }}
              >
                <button
                  onClick={dismissPhotosHints}
                  className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full"
                  style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
                >
                  <span className="text-gray-400 text-sm">×</span>
                </button>
                <div className="flex items-start gap-2 pr-6">
                  <span className="text-base">💡</span>
                  <div>
                    <p className="text-xs text-white font-medium mb-1">Pro tip</p>
                    <p className="text-[11px] text-gray-300 leading-relaxed">
                      Tap any two photos to compare them side-by-side and see your transformation over time.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Filter pills */}
            <div className="flex gap-2 mb-3 overflow-x-auto pb-2 -mx-4 px-4 no-scrollbar">
              {[
                { key: 'all', label: 'All Photos' },
                { key: 'strength', label: '💪 Strength' },
                { key: 'cardio', label: '❤️‍🔥 Cardio' },
                { key: 'recovery', label: '🧘 Recovery' }
              ].map(filter => (
                <button
                  key={filter.key}
                  onClick={() => {
                    setPhotoFilter(filter.key);
                    setSelectedPhotos([]);
                  }}
                  className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-200"
                  style={{
                    backgroundColor: photoFilter === filter.key ? '#00FF94' : 'rgba(255,255,255,0.05)',
                    color: photoFilter === filter.key ? 'black' : 'rgba(255,255,255,0.5)'
                  }}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            {/* Year and Month Dropdowns */}
            {availableYears.length > 0 && (
              <div className="flex gap-2 mb-4">
                {/* Year Dropdown */}
                <select
                  value={selectedPhotoYear}
                  onChange={(e) => {
                    setSelectedPhotoYear(e.target.value);
                    setSelectedPhotoMonth('all'); // Reset month when year changes
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-zinc-800/50 border border-white/10 text-white text-xs appearance-none cursor-pointer"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23999'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 6px center',
                    backgroundSize: '12px',
                    paddingRight: '24px'
                  }}
                >
                  <option value="all" className="bg-zinc-900">All Years</option>
                  {availableYears.map(year => (
                    <option key={year} value={year} className="bg-zinc-900">{year}</option>
                  ))}
                </select>

                {/* Month Dropdown - only show when a specific year is selected */}
                {selectedPhotoYear !== 'all' && (
                  <select
                    value={selectedPhotoMonth}
                    onChange={(e) => setSelectedPhotoMonth(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg bg-zinc-800/50 border border-white/10 text-white text-xs appearance-none cursor-pointer"
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23999'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                      backgroundRepeat: 'no-repeat',
                      backgroundPosition: 'right 6px center',
                      backgroundSize: '12px',
                      paddingRight: '24px'
                    }}
                  >
                    <option value="all" className="bg-zinc-900">All Months</option>
                    {availableMonthsForYear.map(month => (
                      <option key={month} value={month} className="bg-zinc-900">
                        {monthNames[parseInt(month)]}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Photo Grid or Empty State */}
            {displayedPhotos.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-5xl mb-4">📸</div>
                <p className="text-white font-medium mb-2">
                  {activitiesWithPhotos.length === 0
                    ? 'No progress photos yet'
                    : 'No photos in this selection'}
                </p>
                <p className="text-gray-500 text-sm">
                  {activitiesWithPhotos.length === 0
                    ? 'Add photos to your workouts to track your progress'
                    : 'Try selecting a different month or filter'}
                </p>
              </div>
            ) : (
              <>
                {/* Selected Photos Preview */}
                {selectedPhotos.length > 0 && (
                  <div className="mb-4 p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-gray-400">
                        {selectedPhotos.length === 1 ? 'Selected photo - choose another to compare' : 'Ready to compare'}
                      </span>
                      <button
                        onClick={clearSelection}
                        className="text-xs text-gray-500 hover:text-white transition-colors"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="flex gap-3">
                      {/* First selected photo */}
                      {selectedPhotos[0] && (() => {
                        const activity = activities.find(a => a.id === selectedPhotos[0]);
                        if (!activity) return null;
                        return (
                          <div className="flex-1">
                            <div className="relative aspect-square rounded-xl overflow-hidden" style={{ boxShadow: '0 0 0 2px #00FF94' }}>
                              <img src={activity.photoURL} alt={activity.type} className="w-full h-full object-cover" />
                              <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-900/80 text-white">
                                {selectedPhotos.length === 2 ? 'BEFORE' : '1'}
                              </div>
                            </div>
                            <p className="text-[10px] text-gray-400 mt-1 text-center">{formatDate(activity.date)}</p>
                          </div>
                        );
                      })()}

                      {/* Arrow or placeholder */}
                      <div className="flex items-center justify-center">
                        {selectedPhotos.length === 2 ? (
                          <svg className="w-6 h-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                          </svg>
                        ) : (
                          <div className="w-16 h-16 rounded-xl border-2 border-dashed border-gray-600 flex items-center justify-center">
                            <span className="text-gray-500 text-xs">+</span>
                          </div>
                        )}
                      </div>

                      {/* Second selected photo or placeholder */}
                      {selectedPhotos[1] ? (() => {
                        const activity = activities.find(a => a.id === selectedPhotos[1]);
                        if (!activity) return null;
                        return (
                          <div className="flex-1">
                            <div className="relative aspect-square rounded-xl overflow-hidden" style={{ boxShadow: '0 0 0 2px #00FF94' }}>
                              <img src={activity.photoURL} alt={activity.type} className="w-full h-full object-cover" />
                              <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-500 text-black">
                                AFTER
                              </div>
                            </div>
                            <p className="text-[10px] text-gray-400 mt-1 text-center">{formatDate(activity.date)}</p>
                          </div>
                        );
                      })() : (
                        <div className="flex-1">
                          <div className="aspect-square rounded-xl border-2 border-dashed border-gray-600 flex items-center justify-center">
                            <span className="text-gray-500 text-xs">Select 2nd</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Compare Button - inside preview section */}
                    {selectedPhotos.length === 2 && (
                      <button
                        onClick={() => setShowCompareModal(true)}
                        className="w-full mt-3 py-2.5 rounded-xl font-semibold text-center transition-all duration-150 active:scale-98"
                        style={{ backgroundColor: '#00FF94', color: 'black' }}
                      >
                        Compare Photos
                      </button>
                    )}
                  </div>
                )}

                {/* Selection status */}
                <p className="text-xs text-gray-500 mb-3">
                  {selectedPhotos.length === 0
                    ? 'Select a photo to start comparing'
                    : selectedPhotos.length === 1
                      ? 'Now select another photo from below'
                      : 'Tap "Compare" to see your progress'}
                </p>

                {/* Photo Grid - Simple grid when year/month selected, grouped when All Years */}
                {selectedPhotoYear !== 'all' ? (
                  /* Simple grid for selected year/month */
                  <div className="grid grid-cols-3 gap-2">
                    {displayedPhotos.map(activity => {
                      const isSelected = selectedPhotos.includes(activity.id);
                      const selectionIndex = selectedPhotos.indexOf(activity.id);
                      const isLocked = !isPro && (() => {
                        const actDate = new Date(activity.date + 'T12:00:00');
                        const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);
                        return actDate < cutoff;
                      })();

                      return (
                        <button
                          key={activity.id}
                          onClick={() => handlePhotoSelect(activity.id)}
                          className="relative aspect-square rounded-xl overflow-hidden transition-all duration-150"
                          style={{
                            boxShadow: isSelected ? '0 0 0 2px #00FF94' : 'none'
                          }}
                        >
                          <img
                            src={activity.photoURL}
                            alt={activity.type}
                            className="w-full h-full object-cover"
                            style={isLocked ? { filter: 'blur(8px)', transform: 'scale(1.1)' } : undefined}
                          />
                          {/* Lock overlay for free users on old photos */}
                          {isLocked && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40">
                              <span className="text-lg">🔒</span>
                              <span className="text-[9px] text-white/80 font-medium mt-0.5">Pro</span>
                            </div>
                          )}
                          {/* Overlay with date */}
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                            <div className="flex items-center gap-1">
                              <span className="text-xs">{getActivityIcon(activity)}</span>
                              <span className="text-[10px] text-white truncate">{formatDate(activity.date)}</span>
                            </div>
                          </div>
                          {/* Selection indicator */}
                          {isSelected && (
                            <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                              <span className="text-black text-xs font-bold">{selectionIndex + 1}</span>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  /* Month-grouped photos (collapsible) for All Time view */
                  monthGroups.map((group, groupIndex) => {
                    // First month is expanded by default, others are collapsed
                    const isExpanded = expandedMonths[group.key] !== undefined
                      ? expandedMonths[group.key]
                      : groupIndex === 0;

                    const toggleMonth = () => {
                      setExpandedMonths(prev => ({
                        ...prev,
                        [group.key]: !isExpanded
                      }));
                    };

                    // Check if any photos in this month are selected
                    const selectedInMonth = group.activities.filter(a => selectedPhotos.includes(a.id)).length;

                    return (
                      <div key={group.key} className="mb-3">
                        {/* Month header - clickable */}
                        <button
                          onClick={toggleMonth}
                          className="w-full flex items-center justify-between p-3 rounded-xl transition-all duration-150 active:scale-98"
                          style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                        >
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold text-white">{group.label}</h3>
                            <span className="text-xs text-gray-500">
                              {group.activities.length} photo{group.activities.length !== 1 ? 's' : ''}
                            </span>
                            {selectedInMonth > 0 && (
                              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-green-500 text-black">
                                {selectedInMonth} selected
                              </span>
                            )}
                          </div>
                          <svg
                            className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>

                        {/* Photo grid for this month - collapsible */}
                        {isExpanded && (
                          <div className="grid grid-cols-3 gap-2 mt-3">
                            {group.activities.map(activity => {
                              const isSelected = selectedPhotos.includes(activity.id);
                              const selectionIndex = selectedPhotos.indexOf(activity.id);
                              const isLocked = !isPro && (() => {
                                const actDate = new Date(activity.date + 'T12:00:00');
                                const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);
                                return actDate < cutoff;
                              })();

                              return (
                                <button
                                  key={activity.id}
                                  onClick={() => handlePhotoSelect(activity.id)}
                                  className="relative aspect-square rounded-xl overflow-hidden transition-all duration-150"
                                  style={{
                                    boxShadow: isSelected ? '0 0 0 2px #00FF94' : 'none'
                                  }}
                                >
                                  <img
                                    src={activity.photoURL}
                                    alt={activity.type}
                                    className="w-full h-full object-cover"
                                    style={isLocked ? { filter: 'blur(8px)', transform: 'scale(1.1)' } : undefined}
                                  />
                                  {/* Lock overlay for free users on old photos */}
                                  {isLocked && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40">
                                      <span className="text-lg">🔒</span>
                                      <span className="text-[9px] text-white/80 font-medium mt-0.5">Pro</span>
                                    </div>
                                  )}
                                  {/* Overlay with date */}
                                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                                    <div className="flex items-center gap-1">
                                      <span className="text-xs">{getActivityIcon(activity)}</span>
                                      <span className="text-[10px] text-white truncate">{formatDate(activity.date)}</span>
                                    </div>
                                  </div>
                                  {/* Selection indicator */}
                                  {isSelected && (
                                    <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                                      <span className="text-black text-xs font-bold">{selectionIndex + 1}</span>
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </>
            )}

            {/* Comparison Modal */}
            {showCompareModal && (() => {
              const [before, after] = getCompareActivities();
              if (!before || !after) return null;

              const daysBetween = calculateDaysBetween(before.date, after.date);

              // Calculate aggregate stats between the two dates
              const activitiesBetween = activities.filter(a => {
                return a.date >= before.date && a.date <= after.date;
              });

              const totalCalories = activitiesBetween.reduce((sum, a) => sum + (parseInt(a.calories) || 0), 0);
              const strengthSessions = activitiesBetween.filter(a => getActivityCategory(a) === 'lifting').length;
              const cardioSessions = activitiesBetween.filter(a => getActivityCategory(a) === 'cardio').length;
              const recoverySessions = activitiesBetween.filter(a => getActivityCategory(a) === 'recovery').length;

              return (
                <div
                  className="fixed inset-0 z-50 bg-black/90 flex flex-col"
                  onClick={() => setShowCompareModal(false)}
                >
                  <div
                    className="flex-1 flex flex-col max-h-full overflow-y-auto"
                    onClick={e => e.stopPropagation()}
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 border-b border-zinc-800" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
                      <h3 className="text-white font-semibold text-lg">Progress Comparison</h3>
                      <button
                        onClick={() => setShowCompareModal(false)}
                        className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center"
                      >
                        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    {/* Side by side photos */}
                    <div id="progress-share-content" className="flex-1 p-4" style={{ backgroundColor: '#000000' }}>
                      <div className="flex gap-3">
                        {/* Before */}
                        <div className="flex-1">
                          <div className="text-center mb-2">
                            <span className="text-xs font-medium px-2 py-1 rounded-full bg-zinc-800 text-gray-300">BEFORE</span>
                          </div>
                          <div className="aspect-[3/4] rounded-xl overflow-hidden bg-zinc-900" id="before-photo-container">
                            <img
                              id="before-photo"
                              src={before.photoURL}
                              alt="Before"
                              className="w-full h-full object-cover"
                              crossOrigin="anonymous"
                            />
                          </div>
                          <p className="text-gray-400 text-xs mt-2 text-center">{formatDate(before.date)}</p>
                        </div>

                        {/* After */}
                        <div className="flex-1">
                          <div className="text-center mb-2">
                            <span className="text-xs font-medium px-2 py-1 rounded-full bg-green-500/20 text-green-400">AFTER</span>
                          </div>
                          <div className="aspect-[3/4] rounded-xl overflow-hidden bg-zinc-900" id="after-photo-container">
                            <img
                              id="after-photo"
                              src={after.photoURL}
                              alt="After"
                              className="w-full h-full object-cover"
                              crossOrigin="anonymous"
                            />
                          </div>
                          <p className="text-gray-400 text-xs mt-2 text-center">{formatDate(after.date)}</p>
                        </div>
                      </div>

                      {/* Journey Stats */}
                      <div className="mt-6 p-4 rounded-xl bg-zinc-900">
                        <div className="text-center mb-4">
                          <span className="text-2xl font-bold text-white">{daysBetween}</span>
                          <span className="text-gray-400 text-sm ml-1">days apart</span>
                        </div>

                        {/* Aggregate stats grid */}
                        <div className="grid grid-cols-2 gap-3">
                          {/* Calories */}
                          <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(255,149,0,0.1)' }}>
                            <p className="text-xl">🔥</p>
                            <p className="text-2xl font-bold" style={{ color: '#FF9500' }}>{totalCalories.toLocaleString()}</p>
                            <p className="text-xs text-gray-400 mt-1">calories burned</p>
                          </div>

                          {/* Strength */}
                          <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(0,255,148,0.1)' }}>
                            <p className="text-xl">💪</p>
                            <p className="text-2xl font-bold" style={{ color: '#00FF94' }}>{strengthSessions}</p>
                            <p className="text-xs text-gray-400 mt-1">strength sessions</p>
                          </div>

                          {/* Cardio */}
                          <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(0,209,255,0.1)' }}>
                            <p className="text-xl">❤️‍🔥</p>
                            <p className="text-2xl font-bold" style={{ color: '#00D1FF' }}>{cardioSessions}</p>
                            <p className="text-xs text-gray-400 mt-1">cardio sessions</p>
                          </div>

                          {/* Recovery */}
                          <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(191,90,242,0.1)' }}>
                            <p className="text-xl">🧘</p>
                            <p className="text-2xl font-bold" style={{ color: '#BF5AF2' }}>{recoverySessions}</p>
                            <p className="text-xs text-gray-400 mt-1">recovery sessions</p>
                          </div>
                        </div>
                      </div>

                      {/* Branding for share image */}
                      <div className="text-center mt-4 text-gray-600 text-sm">
                        Tracked with dayseven
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="p-4 border-t border-zinc-800 flex gap-3">
                      <button
                        disabled={isShareGenerating}
                        onClick={async () => {
                          setIsShareGenerating(true);

                          try {
                            // Helper function for rounded rectangles (iOS compatibility)
                            const roundRect = (ctx, x, y, w, h, r) => {
                              ctx.beginPath();
                              ctx.moveTo(x + r, y);
                              ctx.lineTo(x + w - r, y);
                              ctx.quadraticCurveTo(x + w, y, x + w, y + r);
                              ctx.lineTo(x + w, y + h - r);
                              ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
                              ctx.lineTo(x + r, y + h);
                              ctx.quadraticCurveTo(x, y + h, x, y + h - r);
                              ctx.lineTo(x, y + r);
                              ctx.quadraticCurveTo(x, y, x + r, y);
                              ctx.closePath();
                            };

                            // Create canvas
                            const canvas = document.createElement('canvas');
                            const ctx = canvas.getContext('2d');
                            const scale = 3;
                            const width = 390;
                            const height = 620;
                            canvas.width = width * scale;
                            canvas.height = height * scale;
                            ctx.scale(scale, scale);

                            // Background
                            ctx.fillStyle = '#000000';
                            ctx.fillRect(0, 0, width, height);

                            // Title
                            ctx.fillStyle = '#ffffff';
                            ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, sans-serif';
                            ctx.textAlign = 'center';
                            ctx.fillText('My Progress', width / 2, 40);

                            // Subtitle
                            ctx.fillStyle = '#00FF94';
                            ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, sans-serif';
                            ctx.fillText(`${daysBetween} days apart`, width / 2, 65);

                            // Before/After labels
                            ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, sans-serif';
                            ctx.fillStyle = '#888888';
                            ctx.fillText('BEFORE', width * 0.25, 95);
                            ctx.fillStyle = '#00FF94';
                            ctx.fillText('AFTER', width * 0.75, 95);

                            // Photo dimensions
                            const photoWidth = 170;
                            const photoHeight = 220;
                            const photoY = 105;

                            // Get the img elements
                            const beforeImg = document.getElementById('before-photo');
                            const afterImg = document.getElementById('after-photo');

                            // Helper to draw image with fallback
                            const drawPhoto = (img, x, y, w, h) => {
                              ctx.save();
                              roundRect(ctx, x, y, w, h, 12);
                              ctx.clip();
                              try {
                                if (img && img.complete && img.naturalWidth > 0) {
                                  // Calculate cover-fit dimensions
                                  const imgRatio = img.naturalWidth / img.naturalHeight;
                                  const boxRatio = w / h;
                                  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;

                                  if (imgRatio > boxRatio) {
                                    // Image is wider - crop sides
                                    sw = img.naturalHeight * boxRatio;
                                    sx = (img.naturalWidth - sw) / 2;
                                  } else {
                                    // Image is taller - crop top/bottom
                                    sh = img.naturalWidth / boxRatio;
                                    sy = (img.naturalHeight - sh) / 2;
                                  }

                                  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
                                } else {
                                  throw new Error('Image not loaded');
                                }
                              } catch (e) {
                                // Fallback to placeholder
                                ctx.fillStyle = '#1f1f1f';
                                ctx.fillRect(x, y, w, h);
                                ctx.fillStyle = '#444444';
                                ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
                                ctx.textAlign = 'center';
                                ctx.fillText('Photo', x + w / 2, y + h / 2);
                              }
                              ctx.restore();
                            };

                            // Draw before photo
                            drawPhoto(beforeImg, 15, photoY, photoWidth, photoHeight);

                            // Draw after photo
                            drawPhoto(afterImg, width - 15 - photoWidth, photoY, photoWidth, photoHeight);

                            // Dates
                            ctx.fillStyle = '#888888';
                            ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
                            ctx.fillText(formatDate(before.date), 15 + photoWidth / 2, photoY + photoHeight + 18);
                            ctx.fillText(formatDate(after.date), width - 15 - photoWidth / 2, photoY + photoHeight + 18);

                            // Stats section
                            const statsY = photoY + photoHeight + 35;
                            ctx.fillStyle = '#18181b';
                            roundRect(ctx, 15, statsY, width - 30, 200, 12);
                            ctx.fill();

                            // Stats grid
                            const statItems = [
                              { emoji: '🔥', value: totalCalories.toLocaleString(), label: 'calories burned', color: '#FF9500', bg: 'rgba(255,149,0,0.15)' },
                              { emoji: '💪', value: strengthSessions.toString(), label: 'strength sessions', color: '#00FF94', bg: 'rgba(0,255,148,0.15)' },
                              { emoji: '❤️‍🔥', value: cardioSessions.toString(), label: 'cardio sessions', color: '#00D1FF', bg: 'rgba(0,209,255,0.15)' },
                              { emoji: '🧘', value: recoverySessions.toString(), label: 'recovery sessions', color: '#BF5AF2', bg: 'rgba(191,90,242,0.15)' }
                            ];

                            const cellWidth = (width - 60) / 2;
                            const cellHeight = 85;
                            const gridStartY = statsY + 12;

                            statItems.forEach((stat, i) => {
                              const col = i % 2;
                              const row = Math.floor(i / 2);
                              const x = 25 + col * (cellWidth + 10);
                              const y = gridStartY + row * (cellHeight + 8);

                              ctx.fillStyle = stat.bg;
                              roundRect(ctx, x, y, cellWidth, cellHeight, 10);
                              ctx.fill();

                              ctx.textAlign = 'center';
                              ctx.font = '20px -apple-system, BlinkMacSystemFont, sans-serif';
                              ctx.fillStyle = '#ffffff';
                              ctx.fillText(stat.emoji, x + cellWidth / 2, y + 25);

                              ctx.font = 'bold 22px -apple-system, BlinkMacSystemFont, sans-serif';
                              ctx.fillStyle = stat.color;
                              ctx.fillText(stat.value, x + cellWidth / 2, y + 52);

                              ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
                              ctx.fillStyle = '#888888';
                              ctx.fillText(stat.label, x + cellWidth / 2, y + 72);
                            });

                            // Branding
                            ctx.fillStyle = '#444444';
                            ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
                            ctx.textAlign = 'center';
                            ctx.fillText('Tracked with dayseven', width / 2, height - 23);

                            // Create blob and share
                            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png', 1.0));
                            const file = new File([blob], `dayseven-progress-${Date.now()}.png`, { type: 'image/png' });

                            // Try native share API (mobile)
                            if (navigator.share) {
                              try {
                                // Check if we can share files
                                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                                  await navigator.share({ files: [file] });
                                  return;
                                }
                                // Fallback: share without file but still download the image
                                await navigator.share({
                                  title: 'Day Seven',
                                  text: 'Check out my fitness progress!'
                                });
                                // Still download the image since we couldn't share the file
                                const link = document.createElement('a');
                                link.download = `dayseven-progress-${Date.now()}.png`;
                                link.href = canvas.toDataURL('image/png', 1.0);
                                link.click();
                                return;
                              } catch (e) {
                                // User cancelled or share failed - if AbortError, user cancelled so don't download
                                if (e.name === 'AbortError') {
                                  return;
                                }
                              }
                            }

                            // Fallback: download the image
                            const link = document.createElement('a');
                            link.download = `dayseven-progress-${Date.now()}.png`;
                            link.href = canvas.toDataURL('image/png', 1.0);
                            link.click();
                          } catch (err) {
                            alert('Failed to generate share image. Please try again.');
                          } finally {
                            setIsShareGenerating(false);
                          }
                        }}
                        className="flex-1 py-3 rounded-xl font-medium text-center flex items-center justify-center gap-2 transition-opacity"
                        style={{
                          backgroundColor: '#00FF94',
                          color: 'black',
                          opacity: isShareGenerating ? 0.7 : 1
                        }}
                      >
                        {isShareGenerating ? (
                          <>
                            <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            Generating...
                          </>
                        ) : (
                          <>
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                            </svg>
                            Share Progress
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => {
                          setShowCompareModal(false);
                          setSelectedPhotos([]);
                        }}
                        className="py-3 px-6 rounded-xl font-medium text-center bg-zinc-800 text-white"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })()}
      </div>
      {/* End of View Toggles + Content Wrapper */}

      {/* Week Stats Modal */}
      <WeekStatsModal
        isOpen={showWeekStats}
        onClose={() => setShowWeekStats(false)}
        onShare={() => {
          setShowWeekStats(false);
          onShare && onShare({ startDate: selectedWeek?.startDate, endDate: selectedWeek?.endDate });
        }}
        weekData={selectedWeek ? (() => {
          // Calculate week data from activities (source of truth)
          let currentDate = new Date(selectedWeek.startDate);
          const endDate = new Date(selectedWeek.endDate);
          const weekDates = [];

          while (currentDate <= endDate) {
            const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
            weekDates.push(dateStr);
            currentDate.setDate(currentDate.getDate() + 1);
          }

          // Filter activities for this week
          const weekActivities = activities.filter(a => weekDates.includes(a.date));

          // Sort by date and time (most recent first)
          weekActivities.sort((a, b) => {
            const dateCompare = b.date.localeCompare(a.date);
            if (dateCompare !== 0) return dateCompare;
            if (a.time && b.time) {
              const aMinutes = parseTimeToMinutes(a.time);
              const bMinutes = parseTimeToMinutes(b.time);
              return bMinutes - aMinutes;
            }
            return 0;
          });

          const lifts = weekActivities.filter(a => getActivityCategory(a) === 'lifting');
          const cardioArr = weekActivities.filter(a => getActivityCategory(a) === 'cardio');
          const recoveryArr = weekActivities.filter(a => getActivityCategory(a) === 'recovery');
          const miles = weekActivities.filter(a => a.type === 'Running' || a.type === 'Cycle' || a.type === 'Walking').reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);

          // Calculate calories: HealthKit active calories + manually logged (not from/linked to HealthKit)
          let weekCalories = 0;
          let weekSteps = 0;
          weekDates.forEach(dateStr => {
            const healthData = healthDataByDate[dateStr];
            // Use HealthKit calories directly — wearables already track all active energy
            weekCalories += healthData?.calories || 0;
            weekSteps += healthData?.steps || 0;
          });

          return {
            lifts: lifts.length,
            cardio: cardioArr.length,
            recovery: recoveryArr.length,
            calories: weekCalories,
            steps: weekSteps,
            miles: miles,
            activities: weekActivities,
            goalsMet: lifts.length >= goals.liftsPerWeek && cardioArr.length >= goals.cardioPerWeek && recoveryArr.length >= goals.recoveryPerWeek
          };
        })() : null}
        weekLabel={selectedWeek?.label || ''}
        onDeleteActivity={onDeleteActivity}
        onSelectActivity={(activity) => setSelectedDayActivity(activity)}
        userData={userData}
      />

      {/* Month Stats Modal */}
      <MonthStatsModal
        isOpen={showMonthStats}
        onClose={() => setShowMonthStats(false)}
        onShare={() => {
          setShowMonthStats(false);
          // Pass month range to parent for sharing
          if (selectedMonth) {
            const startDate = new Date(selectedMonth.year, selectedMonth.month, 1);
            const endDate = new Date(selectedMonth.year, selectedMonth.month + 1, 0); // Last day of month
            onShare && onShare({ startDate, endDate, isMonthShare: true });
          }
        }}
        monthData={selectedMonth ? (() => {
          // Calculate all dates in the month
          const daysInMonth = new Date(selectedMonth.year, selectedMonth.month + 1, 0).getDate();
          const monthDates = [];
          for (let d = 1; d <= daysInMonth; d++) {
            monthDates.push(`${selectedMonth.year}-${String(selectedMonth.month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
          }

          // Filter activities for this month
          const monthActivities = activities.filter(a => monthDates.includes(a.date));

          // Calculate calories and steps from health history
          let monthCalories = 0;
          let monthSteps = 0;
          monthDates.forEach(dateStr => {
            const healthData = healthDataByDate[dateStr];
            // Use HealthKit calories directly — wearables already track all active energy
            monthCalories += healthData?.calories || 0;
            monthSteps += healthData?.steps || 0;
          });

          return {
            activities: monthActivities,
            dates: monthDates,
            calories: monthCalories,
            steps: monthSteps
          };
        })() : null}
        monthLabel={selectedMonth ? new Date(selectedMonth.year, selectedMonth.month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : ''}
        userData={userData}
        activities={activities}
        healthHistory={healthHistory}
      />

      {/* Activity Detail Modal for calendar day view */}
      <ActivityDetailModal
        isOpen={!!selectedDayActivity}
        onClose={() => setSelectedDayActivity(null)}
        activity={selectedDayActivity}
        onDelete={(id) => {
          onDeleteActivity && onDeleteActivity(id);
          setSelectedDayActivity(null);
        }}
        onEdit={(activity) => {
          onEditActivity && onEditActivity(activity);
          setSelectedDayActivity(null);
        }}
        user={user}
        userProfile={userProfile}
        onShareStamp={onShareStamp}
        isPro={isPro}
        onPresentPaywall={onPresentPaywall}
        onChallenge={(activity) => { onChallengeActivity && onChallengeActivity(activity); setSelectedDayActivity(null); }}
        friends={friends}
      />
    </div>

    {showSelfProfile && (
      <OwnProfileModal
        user={user}
        userProfile={userProfile}
        userData={userData}
        activities={activities}
        onClose={() => setShowSelfProfile(false)}
      />
    )}

    {quickActionModal && (() => {
      const SHIELD_COOLDOWN_WEEKS = 6;
      const _today = new Date();
      const _sunday = new Date(_today);
      _sunday.setDate(_today.getDate() - _today.getDay());
      const currentWeek = `${_sunday.getFullYear()}-${String(_sunday.getMonth() + 1).padStart(2, '0')}-${String(_sunday.getDate()).padStart(2, '0')}`;

      const isShielded = (userData?.streakShield?.shieldedWeeks || []).includes(currentWeek);
      const lastUsedWeek = userData?.streakShield?.lastUsedWeek;
      let onCooldown = false;
      let weeksUntilAvailable = 0;
      if (lastUsedWeek) {
        const lastUsedDate = new Date(lastUsedWeek);
        const currentWeekDate = new Date(currentWeek);
        const weeksSinceUsed = Math.floor((currentWeekDate - lastUsedDate) / (7 * 24 * 60 * 60 * 1000));
        if (weeksSinceUsed < SHIELD_COOLDOWN_WEEKS) {
          onCooldown = true;
          weeksUntilAvailable = SHIELD_COOLDOWN_WEEKS - weeksSinceUsed;
        }
      }
      const vacationActive = !!userData?.vacationMode?.isActive;
      const vacationStart = userData?.vacationMode?.startDate;
      const vacationDaysRemaining = vacationActive && vacationStart ? (() => {
        const start = new Date(vacationStart + 'T12:00:00');
        const daysUsed = Math.floor((new Date() - start) / (24 * 60 * 60 * 1000));
        return Math.max(0, 14 - daysUsed);
      })() : null;
      const vacationsLeft = (() => {
        const vm = userData?.vacationMode || {};
        const currentYear = new Date().getFullYear();
        const used = vm.activationYear === currentYear ? (vm.activationsThisYear || 0) : 0;
        return Math.max(0, 3 - used);
      })();

      const isShield = quickActionModal === 'shield';
      const title = isShield ? 'Streak Shield' : 'Vacation Mode';
      const emoji = isShield ? '🛡️' : '🌴';
      const subtitle = !isPro ? 'Pro Feature' : null;

      // Build a status line + 3 bullet rows. Mirrors the Streak Shield info sheet on
      // Home and the vacation mode section in Settings so wording stays consistent.
      let statusLabel = null;
      let statusColor = '#00FF94';
      let details = [];
      let actionLabel = null;
      let actionColor = '#FFD60A';
      let onAction = null;

      if (isShield) {
        if (!isPro) {
          statusLabel = 'Pro only';
          statusColor = '#FF9500';
        } else if (isShielded) {
          statusLabel = 'Active this week';
          statusColor = '#00FF94';
        } else if (onCooldown) {
          statusLabel = `On cooldown · ${weeksUntilAvailable}w`;
          statusColor = '#FF9500';
        } else {
          statusLabel = 'Available';
          statusColor = '#00FF94';
        }

        details = [
          { color: '#00FF94', title: 'Protects your streaks', body: "If you can't complete your weekly goals, activate the shield to keep all your streaks from resetting." },
          { color: '#00D1FF', title: 'Available once every 6 weeks', body: "After using a shield, there's a 6-week cooldown before you can use another one. Use it wisely!" },
          { color: '#FF9500', title: 'Appears when you need it', body: "The shield shows up in the last days of the week when your goals are incomplete, or on Sunday/Monday to retroactively save last week's streak." },
        ];

        if (!isPro) {
          actionLabel = 'Upgrade to Pro';
          actionColor = '#FFD60A';
          onAction = () => { triggerHaptic(ImpactStyle.Medium); onPresentPaywall?.(); closeQuickAction(); };
        } else if (!isShielded && !onCooldown) {
          actionLabel = 'Use Shield';
          actionColor = '#00D1FF';
          onAction = () => { triggerHaptic(ImpactStyle.Medium); onUseStreakShield?.(currentWeek); closeQuickAction(); };
        }
      } else {
        if (!isPro) {
          statusLabel = 'Pro only';
          statusColor = '#FF9500';
        } else if (vacationActive) {
          statusLabel = vacationDaysRemaining !== null ? `Active · ${vacationDaysRemaining} day${vacationDaysRemaining === 1 ? '' : 's'} left` : 'Active';
          statusColor = '#00D1FF';
        } else {
          statusLabel = 'Off';
          statusColor = 'rgba(255,255,255,0.5)';
        }

        details = [
          { color: '#00D1FF', title: 'Streaks stay frozen', body: 'No progress lost while vacation mode is on.' },
          { color: '#00D1FF', title: 'Max 2 weeks per activation', body: 'Automatically deactivates after 14 days.' },
          { color: '#FF9500', title: `${vacationsLeft} of 3 activations left`, body: 'Your yearly quota resets each January.' },
        ];

        if (!isPro) {
          actionLabel = 'Upgrade to Pro';
          actionColor = '#FFD60A';
          onAction = () => { triggerHaptic(ImpactStyle.Medium); onPresentPaywall?.(); closeQuickAction(); };
        } else if (vacationActive) {
          actionLabel = 'Deactivate';
          actionColor = '#FF9500';
          onAction = () => { triggerHaptic(ImpactStyle.Medium); onToggleVacationMode?.(); closeQuickAction(); };
        } else if (vacationsLeft > 0) {
          actionLabel = 'Activate';
          actionColor = '#FF9500';
          onAction = () => { triggerHaptic(ImpactStyle.Medium); onToggleVacationMode?.(); closeQuickAction(); };
        }
      }

      return (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-300"
          style={{ backgroundColor: quickActionAnimating ? 'rgba(0,0,0,0.8)' : 'rgba(0,0,0,0)' }}
          onClick={closeQuickAction}
        >
          <div
            className="w-full max-w-sm bg-zinc-900 rounded-2xl p-6 transition-all duration-300 ease-out"
            style={{
              transform: quickActionAnimating ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(20px)',
              opacity: quickActionAnimating ? 1 : 0,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: isShield ? 'rgba(0,209,255,0.1)' : 'rgba(255,149,0,0.1)' }}
              >
                <span className="text-xl">{emoji}</span>
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-white text-base font-semibold">{title}</h2>
                {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
              </div>
              {statusLabel && (
                <span className="text-xs font-semibold flex-shrink-0" style={{ color: statusColor }}>{statusLabel}</span>
              )}
            </div>

            {/* Details */}
            <div className="space-y-3 mb-5">
              {details.map((d, i) => (
                <div key={i} className="flex gap-3">
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ backgroundColor: `${d.color}20` }}
                  >
                    <svg className="w-3 h-3" fill="none" stroke={d.color} viewBox="0 0 24 24" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium">{d.title}</p>
                    <p className="text-gray-400 text-xs mt-0.5">{d.body}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={closeQuickAction}
                onTouchStart={(e) => { e.currentTarget.style.transform = 'scale(0.96)'; }}
                onTouchEnd={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                className="flex-1 py-3 rounded-full bg-zinc-800 text-white text-sm font-medium transition-transform"
              >
                {actionLabel ? 'Cancel' : 'Close'}
              </button>
              {actionLabel && onAction && (
                <button
                  onClick={onAction}
                  onTouchStart={(e) => { e.currentTarget.style.transform = 'scale(0.96)'; }}
                  onTouchEnd={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                  className="flex-1 py-3 rounded-full text-sm font-semibold transition-transform"
                  style={{ backgroundColor: actionColor, color: 'black' }}
                >
                  {actionLabel}
                </button>
              )}
            </div>
          </div>
        </div>
      );
    })()}
    </>
  );
}
