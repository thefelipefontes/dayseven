import React, { useState, useEffect, useMemo, useRef, createContext, useContext, useCallback } from 'react';
import * as Sentry from '@sentry/react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth, EmailAuthProvider, reauthenticateWithCredential, updatePassword, sendPasswordResetEmail } from './firebase';
import Login from './Login';
import UsernameSetup from './UsernameSetup';
import Friends from './Friends';
import ActivityFeed from './ActivityFeed';
import { createUserProfile, getUserProfile, updateUserProfile, saveUserActivities, getUserActivities, saveCustomActivities, getCustomActivities, uploadProfilePhoto, uploadActivityPhoto, saveUserGoals, getUserGoals, setOnboardingComplete, setTourComplete, savePersonalRecords, getPersonalRecords, saveDailyHealthData, getDailyHealthData } from './services/userService';
import { getFriends, getReactions, getFriendRequests, getComments, addReply, getReplies, deleteReply, addReaction, removeReaction, addComment } from './services/friendService';
import html2canvas from 'html2canvas';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { syncHealthKitData, fetchTodaySteps, fetchTodayCalories, saveWorkoutToHealthKit, fetchWorkoutMetricsForTimeRange, startLiveWorkout, endLiveWorkout, cancelLiveWorkout, getLiveWorkoutMetrics, addMetricsUpdateListener, getHealthKitActivityType } from './services/healthService';

// Helper function for haptic feedback that works on iOS
const triggerHaptic = async (style = ImpactStyle.Medium) => {
  try {
    await Haptics.impact({ style });
  } catch (e) {
    // Fallback to vibrate API for web/Android
    if (navigator.vibrate) navigator.vibrate(10);
  }
};

// DAY SEVEN Logo component - uses wordmark image
const DaySevenLogo = ({ size = 'base', opacity = 0.7 }) => {
  const sizeMap = {
    'sm': 'h-4',
    'base': 'h-5',
  };
  const heightClass = sizeMap[size] || sizeMap['base'];

  return (
    <img
      src="/wordmark.png"
      alt="Day Seven"
      className={`${heightClass} inline-block`}
      style={{ opacity }}
    />
  );
};

// Status bar blur overlay for non-home tabs
// Creates a blurred backdrop that extends just below the Dynamic Island with soft edges
const StatusBarBlur = () => (
  <div
    className="fixed top-0 left-0 right-0 z-30 pointer-events-none"
    style={{
      height: 'calc(env(safe-area-inset-top, 0px) + 30px)',
      background: 'linear-gradient(to bottom, rgba(10, 10, 10, 1) 0%, rgba(10, 10, 10, 1) 50%, rgba(10, 10, 10, 0.9) 70%, rgba(10, 10, 10, 0.6) 85%, transparent 100%)',
      maskImage: 'linear-gradient(to bottom, black 0%, black 50%, rgba(0,0,0,0.7) 70%, rgba(0,0,0,0.3) 85%, transparent 100%)',
      WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 50%, rgba(0,0,0,0.7) 70%, rgba(0,0,0,0.3) 85%, transparent 100%)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
    }}
  />
);

// Get today's date in YYYY-MM-DD format (local timezone)
const getTodayDate = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Get current year
const getCurrentYear = () => new Date().getFullYear();

// Parse date string (YYYY-MM-DD) to Date object at noon local time
// This avoids timezone issues where "2026-01-24" would be interpreted as UTC midnight
const parseLocalDate = (dateStr) => {
  if (!dateStr) return new Date();
  return new Date(dateStr + 'T12:00:00');
};

// Format date as "Today", "Yesterday", or "Mon, Jan 20"
const formatFriendlyDate = (dateStr) => {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const todayStr = today.toISOString().split('T')[0];
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  
  if (dateStr === todayStr) return 'Today';
  if (dateStr === yesterdayStr) return 'Yesterday';
  
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

// Initial user data - zeroed out
const initialUserData = {
  name: '',
  goals: {
    liftsPerWeek: 4,
    cardioPerWeek: 3,
    recoveryPerWeek: 2,
    stepsPerDay: 10000,
    caloriesPerDay: 500
  },
  streaks: {
    master: 0,
    lifts: 0,
    cardio: 0,
    recovery: 0,
    stepsGoal: 0
  },
  customActivities: [], // User-saved custom activity types
  personalRecords: {
    // Single workout records (with activity type that achieved it)
    highestCalories: { value: 0, activityType: null },
    longestStrength: { value: 0, activityType: null }, // Strength training specifically
    longestCardio: { value: 0, activityType: null }, // Any cardio
    longestDistance: { value: 0, activityType: null },
    fastestPace: { value: null, activityType: null }, // minutes per mile (running)
    fastestCyclingPace: { value: null, activityType: null }, // minutes per mile (cycling)
    // Weekly records
    mostWorkoutsWeek: 0,
    mostCaloriesWeek: 0,
    mostMilesWeek: 0,
    // Streak records (these get updated automatically)
    longestMasterStreak: 0,
    longestStrengthStreak: 0,
    longestCardioStreak: 0,
    longestRecoveryStreak: 0
  }
};

// Initial weekly progress - zeroed out
const initialWeeklyProgress = {
  lifts: { completed: 0, goal: 4, sessions: [] },
  cardio: { completed: 0, goal: 3, sessions: [], breakdown: { running: 0, cycling: 0, sports: 0 } },
  recovery: { completed: 0, goal: 2, sessions: [], breakdown: { coldPlunge: 0, sauna: 0, yoga: 0 } },
  calories: { burned: 0, goal: 500 },
  steps: { today: 0, goal: 10000 }
};

const initialPersonalRecords = {
  mostStepsWeek: 0,
  mostStepsDay: 0,
  mostCaloriesWeek: 0,
  mostCaloriesDay: 0,
  longestMasterStreak: 0,
  longestWorkoutStreak: 0,
  longestRecoveryStreak: 0,
  mostLiftsWeek: 0,
  longestLiftStreak: 0,
  highestLiftCalories: 0,
  fastestMile: '--:--',
  longestRun: 0,
  mostMilesWeek: 0,
  mostRunsWeek: 0,
  mostRecoveryWeek: 0,
  longestColdPlunge: 0,
  coldestPlunge: 0,
  mostSaunaMinutes: 0,
  totalWorkouts2026: 0,
  totalRecovery2026: 0,
  totalMiles2026: 0,
  totalWorkoutsAllTime: 0,
  totalRecoveryAllTime: 0,
  totalMilesAllTime: 0
};

// Initial activities - empty
const initialActivities = [];

// Initial weekly stats - empty
const initialWeeklyStats = {};

// Initial calendar data - empty (will be populated by activities)
const initialCalendarData = {};


// No pending syncs initially
const initialPendingSync = [];

const initialLiftingBreakdown = {
  '2026': {},
  'all-time': {}
};

const initialRunningBreakdown = {
  '2026': {},
  'all-time': {}
};

const initialRecoveryBreakdown = {
  '2026': {},
  'all-time': {}
};

// App Tour Component - Guides new users through the app
const AppTour = ({ step, onNext, onBack, onSkip, targetRef, onSwitchTab, homeTabRef }) => {
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, height: 0 });
  const [homePosition, setHomePosition] = useState({ top: 0, left: 0, width: 0, height: 0 });
  const [isReady, setIsReady] = useState(false);

  const tourSteps = [
    {
      title: 'Log Activity',
      description: 'Tap here to log workouts, runs, recovery sessions, and more.',
      position: 'above',
      tab: 'home',
      features: null
    },
    {
      title: 'Weekly Goals',
      description: 'Track your weekly progress here. Hit all three goals to earn your streak! Your latest sessions appear below.',
      position: 'below',
      tab: 'home',
      features: null
    },
    {
      title: 'History',
      description: 'Your complete fitness journey lives here.',
      position: 'above',
      tab: 'history',
      features: [
        { emoji: '🔥', text: 'Active streaks' },
        { emoji: '📅', text: 'Activity calendar' },
        { emoji: '📊', text: 'Stats, personal records & trends' },
        { emoji: '📸', text: 'Photo comparison tool' }
      ]
    },
    {
      title: 'Friends',
      description: 'Stay motivated together with friends.',
      position: 'above',
      tab: 'feed',
      features: [
        { emoji: '👥', text: 'See friend activity' },
        { emoji: '🎉', text: 'React & comment' },
        { emoji: '🏅', text: 'Leaderboard (streaks and activities)' },
        { emoji: '➕', text: 'Add new friends' }
      ]
    },
    {
      title: 'Profile',
      description: 'Customize your experience.',
      position: 'above',
      tab: 'profile',
      features: [
        { emoji: '🎯', text: 'Set weekly goals' },
        { emoji: '👤', text: 'Update profile details' },
        { emoji: '↗️', text: 'Share your stats' }
      ]
    }
  ];

  const currentStep = tourSteps[step] || tourSteps[0];

  // Track previous tab for detecting tab changes
  const prevTabRef = useRef(currentStep.tab);

  // Switch to the appropriate tab when step changes
  useEffect(() => {
    if (currentStep.tab && onSwitchTab) {
      onSwitchTab(currentStep.tab);
    }
    // Scroll to top when entering a new step
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [step, currentStep.tab, onSwitchTab]);

  useEffect(() => {
    const isTabChange = prevTabRef.current !== currentStep.tab;
    prevTabRef.current = currentStep.tab;

    // Only show loading state for tab changes
    if (isTabChange) {
      setIsReady(false);
    }

    const capturePosition = () => {
      if (targetRef?.current) {
        // Use requestAnimationFrame to ensure we get the correct position after paint
        requestAnimationFrame(() => {
          if (targetRef?.current) {
            const rect = targetRef.current.getBoundingClientRect();
            setPosition({
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height
            });
            // Also capture Home button position for steps 0-1
            if (homeTabRef?.current) {
              const homeRect = homeTabRef.current.getBoundingClientRect();
              setHomePosition({
                top: homeRect.top,
                left: homeRect.left,
                width: homeRect.width,
                height: homeRect.height
              });
            }
            setIsReady(true);
          } else {
            // Fallback - try again after a short delay
            setTimeout(capturePosition, 50);
          }
        });
      } else {
        // Ref not ready yet, try again
        setTimeout(capturePosition, 50);
      }
    };

    const updatePosition = () => {
      // Fixed elements are the bottom nav tabs: History (2), Friends (3), Profile (4)
      const isFixedElement = step >= 2 && step <= 4;

      if (!isFixedElement) {
        // Scroll to top first to reset position
        window.scrollTo({ top: 0, behavior: 'instant' });

        // Wait a frame, then scroll element into view
        requestAnimationFrame(() => {
          if (targetRef?.current) {
            const rect = targetRef.current.getBoundingClientRect();
            const scrollTarget = window.scrollY + rect.top - 100; // 100px padding from top
            window.scrollTo({ top: Math.max(0, scrollTarget), behavior: 'instant' });
          }
          // Capture position immediately
          capturePosition();
        });
      } else {
        // For fixed elements, capture position after tab switch
        setTimeout(capturePosition, isTabChange ? 50 : 0);
      }
    };

    // Shorter delay - only need time for tab switch if changing tabs
    const timer = setTimeout(updatePosition, isTabChange ? 50 : 0);
    return () => clearTimeout(timer);
  }, [targetRef, step, currentStep.tab]);

  // Disable scrolling while tour is active
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  // Don't render until position is calculated
  if (!isReady || position.width === 0) {
    return (
      <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center">
        <div className="animate-pulse text-white">Loading...</div>
      </div>
    );
  }

  // Calculate tooltip position based on target element
  const getTooltipStyle = () => {
    const padding = 16;
    const tooltipWidth = 280;

    // Center tooltip horizontally over the target element
    const isNavBarStep = step >= 2 && step <= 4;
    const centerOnElement = position.left + position.width / 2 - tooltipWidth / 2;
    const clampedLeft = Math.max(16, Math.min(centerOnElement, window.innerWidth - tooltipWidth - 16));

    if (isNavBarStep) {
      // For nav bar items (History, Friends, Profile), use fixed position from bottom
      // Center tooltip over the actual tab button
      return {
        bottom: 124, // Fixed distance from bottom of screen
        left: clampedLeft
      };
    } else if (currentStep.position === 'above') {
      // For other 'above' positioned items (not nav bar)
      const tooltipHeight = 160;
      return {
        top: position.top - tooltipHeight - 16,
        left: clampedLeft
      };
    } else {
      // Position tooltip below the target element
      return {
        top: position.top + position.height + padding,
        left: clampedLeft
      };
    }
  };

  // Calculate arrow position
  const getArrowStyle = () => {
    const tooltipStyle = getTooltipStyle();
    const tooltipLeft = typeof tooltipStyle.left === 'number' ? tooltipStyle.left : 16;
    const arrowLeft = position.left + position.width / 2 - tooltipLeft - 8; // 8 = half arrow width

    if (currentStep.position === 'above') {
      return {
        bottom: '-8px',
        left: Math.max(16, Math.min(arrowLeft, 280 - 32)) // Keep arrow within tooltip bounds
      };
    } else {
      return {
        top: '-8px',
        left: Math.max(16, Math.min(arrowLeft, 280 - 32))
      };
    }
  };

  // Small padding around highlight box (just for the green border)
  const highlightPadding = 4;

  // Calculate the cutout rectangle
  const cutout = {
    top: position.top - highlightPadding,
    left: position.left - highlightPadding,
    width: position.width + highlightPadding * 2,
    height: position.height + highlightPadding * 2,
  };

  // Calculate Home button cutout for step 1
  const homeCutout = step === 1 && homePosition.width > 0 ? {
    top: homePosition.top - highlightPadding,
    left: homePosition.left - highlightPadding,
    width: homePosition.width + highlightPadding * 2,
    height: homePosition.height + highlightPadding * 2,
  } : null;

  return (
    <div className="fixed inset-0 z-[100]" style={{ pointerEvents: 'none' }}>
      {/* Dark overlay with SVG mask for multiple cutouts */}
      <svg
        className="fixed inset-0 w-full h-full transition-all duration-300"
        style={{ pointerEvents: 'auto', cursor: 'pointer' }}
        onClick={() => {
          triggerHaptic(ImpactStyle.Light);
          onSkip();
        }}
      >
        <defs>
          <mask id="tour-mask">
            {/* White = visible (dark overlay), Black = hidden (cutout) */}
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {/* Main target cutout */}
            <rect
              x={cutout.left}
              y={cutout.top}
              width={cutout.width}
              height={cutout.height}
              rx="12"
              fill="black"
            />
            {/* Home button cutout for step 1 */}
            {homeCutout && (
              <rect
                x={homeCutout.left}
                y={homeCutout.top}
                width={homeCutout.width}
                height={homeCutout.height}
                rx="12"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.65)"
          mask="url(#tour-mask)"
        />
      </svg>

      {/* Highlight ring around target element */}
      <div
        className="fixed rounded-xl transition-all duration-300"
        style={{
          top: cutout.top,
          left: cutout.left,
          width: cutout.width,
          height: cutout.height,
          border: '2px solid #00FF94',
          boxShadow: '0 0 20px rgba(0, 255, 148, 0.4)',
          pointerEvents: 'none'
        }}
      />

      {/* Highlight ring around Home button for step 1 (Weekly Goals) */}
      {homeCutout && (
        <div
          className="fixed rounded-xl transition-all duration-300"
          style={{
            top: homeCutout.top,
            left: homeCutout.left,
            width: homeCutout.width,
            height: homeCutout.height,
            border: '2px solid rgba(255, 255, 255, 0.6)',
            boxShadow: '0 0 12px rgba(255, 255, 255, 0.3)',
            pointerEvents: 'none'
          }}
        />
      )}

      {/* Tooltip */}
      <div
        className="fixed p-4 rounded-2xl transition-all duration-300"
        style={{
          ...getTooltipStyle(),
          width: 280,
          backgroundColor: '#1a1a1a',
          border: '1px solid rgba(255,255,255,0.1)',
          pointerEvents: 'auto'
        }}
      >
        {/* Arrow */}
        <div
          className="absolute w-4 h-4 rotate-45"
          style={{
            ...getArrowStyle(),
            backgroundColor: '#1a1a1a',
            borderLeft: currentStep.position === 'below' ? '1px solid rgba(255,255,255,0.1)' : 'none',
            borderTop: currentStep.position === 'below' ? '1px solid rgba(255,255,255,0.1)' : 'none',
            borderRight: currentStep.position === 'above' ? '1px solid rgba(255,255,255,0.1)' : 'none',
            borderBottom: currentStep.position === 'above' ? '1px solid rgba(255,255,255,0.1)' : 'none'
          }}
        />

        {/* Step indicator */}
        <div className="flex gap-1 mb-3">
          {tourSteps.map((_, i) => (
            <div
              key={i}
              className="h-1 rounded-full transition-all duration-200"
              style={{
                width: i === step ? 24 : 8,
                backgroundColor: i === step ? '#00FF94' : 'rgba(255,255,255,0.2)'
              }}
            />
          ))}
        </div>

        {/* Content */}
        <h3 className="text-white font-semibold text-base mb-1">{currentStep.title}</h3>
        <p className="text-gray-400 text-sm mb-2">{currentStep.description}</p>

        {/* Features list */}
        {currentStep.features && (
          <div className="mb-3 py-2 px-2.5 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
            {currentStep.features.map((feature, index) => (
              <div key={index} className="flex items-center gap-2 py-1">
                <span className="text-sm">{feature.emoji}</span>
                <span className="text-xs text-gray-400">{feature.text}</span>
              </div>
            ))}
          </div>
        )}

        {!currentStep.features && <div className="mb-2" />}

        {/* Actions */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => {
              triggerHaptic(ImpactStyle.Light);
              onSkip();
            }}
            className="text-gray-500 text-sm px-3 py-2"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={() => {
                  triggerHaptic(ImpactStyle.Light);
                  onBack();
                }}
                className="px-3 py-2 rounded-full text-sm font-medium transition-all duration-150"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.1)',
                  color: 'rgba(255,255,255,0.7)'
                }}
                onTouchStart={(e) => e.currentTarget.style.transform = 'scale(0.95)'}
                onTouchEnd={(e) => e.currentTarget.style.transform = 'scale(1)'}
              >
                Back
              </button>
            )}
            <button
              onClick={() => {
                triggerHaptic(ImpactStyle.Light);
                onNext();
              }}
              className="px-4 py-2 rounded-full text-sm font-medium transition-all duration-150"
              style={{
                backgroundColor: '#00FF94',
                color: '#000'
              }}
              onTouchStart={(e) => e.currentTarget.style.transform = 'scale(0.95)'}
              onTouchEnd={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              {step === tourSteps.length - 1 ? "Let's go!" : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Utility Components
const ProgressRing = ({ progress, size = 60, strokeWidth = 4, color = '#00FF94', animate = true }) => {
  const [mounted, setMounted] = useState(false);
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const targetOffset = circumference - (Math.min(progress, 100) / 100) * circumference;
  
  useEffect(() => {
    // Trigger animation after mount
    const timer = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(timer);
  }, []);
  
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.1)"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={animate && mounted ? targetOffset : circumference}
        strokeLinecap="round"
        style={{ 
          transition: 'stroke-dashoffset 1s ease-out'
        }}
      />
    </svg>
  );
};

const ProgressBar = ({ progress, color = '#00FF94', height = 4 }) => (
  <div className="w-full rounded-full overflow-hidden" style={{ height, backgroundColor: 'rgba(255,255,255,0.1)' }}>
    <div 
      className="h-full rounded-full transition-all duration-500"
      style={{ width: `${Math.min(progress, 100)}%`, backgroundColor: color }}
    />
  </div>
);

const ActivityIcon = ({ type, size = 20, sportEmoji, customEmoji }) => {
  const icons = {
    'Strength Training': '🏋️',
    'Running': '🏃',
    'Cold Plunge': '🧊',
    'Sauna': '🔥',
    'Yoga': '🧘',
    'Pilates': '🤸',
    'Cycle': '🚴',
    'Sports': '🏀',
    'Other': '🏊'
  };

  // Use custom emoji for Sports or Other if provided
  let icon = icons[type] || '🏊';
  if (type === 'Sports' && sportEmoji) {
    icon = sportEmoji;
  } else if (type === 'Other' && customEmoji) {
    icon = customEmoji;
  }

  return <span style={{ fontSize: size }}>{icon}</span>;
};

// Heat Map Calendar Component
const HeatMapCalendar = ({ data, onSelectDate, selectedDate, onSelectWeek }) => {
  const [viewMonths, setViewMonths] = useState(3); // Show last 3 months
  
  // Generate last N months of dates
  const generateHeatMapData = () => {
    const days = [];
    const today = new Date(2026, 0, 21); // January 21, 2026
    const startDate = new Date(today);
    startDate.setMonth(startDate.getMonth() - viewMonths + 1);
    startDate.setDate(1);
    
    // Adjust to start from Sunday
    const dayOfWeek = startDate.getDay();
    startDate.setDate(startDate.getDate() - dayOfWeek);
    
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + (6 - today.getDay())); // End of current week
    
    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const activities = data[dateStr] || [];
      days.push({
        date: dateStr,
        day: currentDate.getDate(),
        month: currentDate.getMonth(),
        year: currentDate.getFullYear(),
        activities,
        activityCount: activities.length,
        isToday: dateStr === '2026-01-21',
        isFuture: currentDate > today,
        dayOfWeek: currentDate.getDay()
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }
    return days;
  };

  const heatMapDays = generateHeatMapData();
  
  // Group by weeks for display
  const weeks = [];
  for (let i = 0; i < heatMapDays.length; i += 7) {
    weeks.push(heatMapDays.slice(i, i + 7));
  }

  // Get intensity color based on activity count
  const getIntensityColor = (count, isFuture) => {
    if (isFuture) return 'rgba(255,255,255,0.02)';
    if (count === 0) return 'rgba(255,255,255,0.05)';
    if (count === 1) return 'rgba(0,255,148,0.3)';
    if (count === 2) return 'rgba(0,255,148,0.5)';
    return 'rgba(0,255,148,0.8)';
  };

  // Get month labels
  const getMonthLabels = () => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const labels = [];
    let lastMonth = -1;
    
    weeks.forEach((week, weekIndex) => {
      const firstDayOfWeek = week[0];
      if (firstDayOfWeek && firstDayOfWeek.month !== lastMonth) {
        labels.push({ month: months[firstDayOfWeek.month], weekIndex });
        lastMonth = firstDayOfWeek.month;
      }
    });
    return labels;
  };

  const monthLabels = getMonthLabels();

  return (
    <div className="mb-4">
      {/* Month labels */}
      <div className="flex mb-2 ml-8 text-[10px] text-gray-500">
        {monthLabels.map((label, i) => (
          <div 
            key={i} 
            className="absolute"
            style={{ marginLeft: `${label.weekIndex * 14 + 32}px` }}
          >
            {label.month}
          </div>
        ))}
      </div>
      
      <div className="flex gap-1 mt-6">
        {/* Day labels */}
        <div className="flex flex-col gap-1 text-[10px] text-gray-500 mr-1">
          <span className="h-3"></span>
          <span className="h-3">M</span>
          <span className="h-3"></span>
          <span className="h-3">W</span>
          <span className="h-3"></span>
          <span className="h-3">F</span>
          <span className="h-3"></span>
        </div>
        
        {/* Heat map grid */}
        <div className="flex gap-[3px] overflow-x-auto pb-2">
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} className="flex flex-col gap-[3px]">
              {week.map((day, dayIndex) => (
                <button
                  key={day.date}
                  onClick={() => !day.isFuture && onSelectDate(day.date)}
                  className="w-3 h-3 rounded-sm transition-all duration-200 hover:scale-125"
                  style={{
                    backgroundColor: getIntensityColor(day.activityCount, day.isFuture),
                    border: selectedDate === day.date ? '1px solid #00FF94' : day.isToday ? '1px solid rgba(255,255,255,0.5)' : 'none',
                    cursor: day.isFuture ? 'default' : 'pointer'
                  }}
                  title={`${day.date}: ${day.activityCount} activities`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      
      {/* Legend */}
      <div className="flex items-center justify-end gap-2 mt-3 text-[10px] text-gray-500">
        <span>Less</span>
        <div className="flex gap-1">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }} />
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(0,255,148,0.3)' }} />
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(0,255,148,0.5)' }} />
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(0,255,148,0.8)' }} />
        </div>
        <span>More</span>
      </div>
    </div>
  );
};

// Skeleton Loading Components
const SkeletonPulse = ({ className = "", style = {} }) => (
  <div 
    className={`animate-pulse rounded-lg ${className}`}
    style={{ backgroundColor: 'rgba(255,255,255,0.05)', ...style }}
  />
);

const SkeletonCard = () => (
  <div className="p-4 rounded-2xl" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
    <div className="flex items-center gap-3 mb-4">
      <SkeletonPulse className="w-10 h-10 rounded-full" />
      <div className="flex-1">
        <SkeletonPulse className="h-4 w-24 mb-2" />
        <SkeletonPulse className="h-3 w-16" />
      </div>
    </div>
    <SkeletonPulse className="h-20 w-full" />
  </div>
);

const SkeletonActivityRow = () => (
  <div className="p-3 rounded-xl flex items-center gap-3" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
    <SkeletonPulse className="w-8 h-8 rounded-lg" />
    <div className="flex-1">
      <SkeletonPulse className="h-4 w-32 mb-2" />
      <SkeletonPulse className="h-3 w-20" />
    </div>
    <SkeletonPulse className="h-4 w-12" />
  </div>
);

const SkeletonGoalRings = () => (
  <div className="p-5 rounded-2xl" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
    <div className="flex items-center justify-around">
      {[1, 2, 3].map(i => (
        <div key={i} className="flex flex-col items-center">
          <SkeletonPulse className="w-[72px] h-[72px] rounded-full" />
          <SkeletonPulse className="h-3 w-16 mt-2" />
        </div>
      ))}
    </div>
  </div>
);

const HomeTabSkeleton = () => (
  <div className="pb-32 animate-pulse">
    {/* Daily Stats Skeleton */}
    <div className="px-4 mb-4">
      <SkeletonPulse className="h-4 w-32 mb-3" />
      <div className="p-4 rounded-2xl" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <SkeletonPulse className="w-6 h-6 rounded" />
            <div className="flex-1">
              <SkeletonPulse className="h-2 w-full rounded-full" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <SkeletonPulse className="w-6 h-6 rounded" />
            <div className="flex-1">
              <SkeletonPulse className="h-2 w-full rounded-full" />
            </div>
          </div>
        </div>
      </div>
    </div>
    
    {/* Goals Skeleton */}
    <div className="mx-4 mb-4">
      <SkeletonPulse className="h-4 w-40 mb-3" />
      <SkeletonGoalRings />
    </div>
    
    {/* Activities Skeleton */}
    <div className="mx-4 mb-4">
      <SkeletonPulse className="h-4 w-28 mb-3" />
      <div className="space-y-2">
        <SkeletonActivityRow />
        <SkeletonActivityRow />
      </div>
    </div>
  </div>
);

// Animated Counter Component - smoothly animates number changes
const AnimatedCounter = ({ value, duration = 500, className = "" }) => {
  const [displayValue, setDisplayValue] = useState(value);
  const previousValue = useRef(value);
  const animationRef = useRef(null);

  useEffect(() => {
    if (previousValue.current === value) return;

    const startValue = previousValue.current;
    const endValue = value;
    const startTime = performance.now();

    const animate = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease out cubic for smooth deceleration
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const current = startValue + (endValue - startValue) * easeOut;

      setDisplayValue(Math.round(current));

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        previousValue.current = value;
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [value, duration]);

  return <span className={className}>{displayValue}</span>;
};

// Offline Indicator Component
const OfflineIndicator = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Show "back online" briefly then hide
      setShowBanner(true);
      setTimeout(() => setShowBanner(false), 2000);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setShowBanner(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Show banner initially if offline
    if (!navigator.onLine) {
      setShowBanner(true);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (!showBanner) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-center transition-all duration-300"
      style={{
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)',
        transform: showBanner ? 'translateY(0)' : 'translateY(-100%)',
        opacity: showBanner ? 1 : 0,
      }}
    >
      <div
        className="px-4 py-2 rounded-full flex items-center gap-2 text-sm font-medium shadow-lg"
        style={{
          backgroundColor: isOnline ? 'rgba(34, 197, 94, 0.9)' : 'rgba(239, 68, 68, 0.9)',
          backdropFilter: 'blur(10px)',
        }}
      >
        {isOnline ? (
          <>
            <svg className="w-4 h-4" fill="none" stroke="white" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-white">Back online</span>
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" stroke="white" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414" />
            </svg>
            <span className="text-white">No connection</span>
          </>
        )}
      </div>
    </div>
  );
};

// Active Workout Indicator Component - Shows when a workout is in progress
const ActiveWorkoutIndicator = ({ workout, onFinish, onCancel, activeTab, isFinishing }) => {
  const [elapsed, setElapsed] = useState(0);
  const [frozenElapsed, setFrozenElapsed] = useState(null); // Stores elapsed time when finishing
  const [isExpanded, setIsExpanded] = useState(false);
  const [liveMetrics, setLiveMetrics] = useState({ lastHr: 0, calories: 0 });

  // Collapse and freeze timer when finishing
  useEffect(() => {
    if (isFinishing) {
      setFrozenElapsed(elapsed); // Freeze the current time
      setIsExpanded(false); // Collapse to pill
    } else {
      setFrozenElapsed(null); // Unfreeze when modal closes
    }
  }, [isFinishing]);

  // Update elapsed time every second (only when not finishing)
  useEffect(() => {
    if (!workout?.startTime || isFinishing) return;

    const updateElapsed = () => {
      const start = new Date(workout.startTime).getTime();
      const now = Date.now();
      setElapsed(Math.floor((now - start) / 1000));
    };

    updateElapsed(); // Initial update
    const interval = setInterval(updateElapsed, 1000);

    return () => clearInterval(interval);
  }, [workout?.startTime, isFinishing]);

  // Listen for real-time HealthKit metric updates
  useEffect(() => {
    if (!workout?.startTime) return;

    const removeListener = addMetricsUpdateListener((data) => {
      setLiveMetrics(prev => ({
        ...prev,
        ...(data.type === 'heartRate' && { lastHr: data.lastHr }),
        ...(data.type === 'calories' && { calories: data.calories }),
      }));
    });

    // Also poll for initial metrics in case some were already recorded
    getLiveWorkoutMetrics().then(result => {
      if (result.success && result.isActive) {
        setLiveMetrics({
          lastHr: result.lastHr || 0,
          calories: result.calories || 0,
        });
      }
    });

    return () => removeListener();
  }, [workout?.startTime]);

  if (!workout) return null;

  // Format elapsed time as HH:MM:SS or MM:SS
  const formatElapsed = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Get display info
  const icon = workout.customEmoji || workout.sportEmoji || workout.icon || '💪';
  const typeName = workout.type === 'Strength Training'
    ? (workout.strengthType || 'Strength')
    : workout.type;
  const subtypeName = workout.type === 'Strength Training'
    ? workout.focusArea
    : (workout.subtype || '');

  // Position based on active tab:
  // - Home, History, Profile: top right
  // - Friends: top center
  const useTopRight = activeTab === 'home' || activeTab === 'history' || activeTab === 'profile';

  // Use frozen time when finishing, otherwise use live elapsed time
  const displayElapsed = frozenElapsed !== null ? frozenElapsed : elapsed;

  // Compact pill view (default, or forced when finishing)
  if (!isExpanded || isFinishing) {
    return (
      <div
        className={`fixed z-[100] flex items-center gap-2 shadow-2xl ${isFinishing ? '' : 'cursor-pointer'}`}
        style={{
          top: 'calc(12px + env(safe-area-inset-top, 0px))',
          ...(useTopRight
            ? { right: '16px' }
            : { left: '50%', transform: 'translateX(-50%)' }
          ),
          backgroundColor: 'rgba(0,0,0,0.95)',
          border: isFinishing ? '1px solid rgba(255,180,0,0.6)' : '1px solid rgba(0,255,148,0.4)',
          backdropFilter: 'blur(20px)',
          borderRadius: '20px',
          padding: '6px 12px',
        }}
        onClick={() => !isFinishing && setIsExpanded(true)}
      >
        {/* Status indicator dot - orange when finishing, green when recording */}
        <span
          className={`w-2 h-2 rounded-full ${isFinishing ? '' : 'animate-pulse'}`}
          style={{ backgroundColor: isFinishing ? '#FFB400' : '#00FF94' }}
        />

        {/* Activity icon */}
        <span className="text-base">{icon}</span>

        {/* Timer - frozen when finishing */}
        <span className="font-mono font-semibold text-sm" style={{ color: isFinishing ? '#FFB400' : '#00FF94' }}>
          {formatElapsed(displayElapsed)}
        </span>

        {/* Expand hint - only show when not finishing */}
        {!isFinishing && (
          <svg className="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </div>
    );
  }

  // Expanded view - appears below the header
  return (
    <div
      className="fixed left-4 right-4 z-[100] rounded-2xl shadow-2xl overflow-hidden"
      style={{
        top: 'calc(70px + env(safe-area-inset-top, 0px))',
        backgroundColor: 'rgba(0,0,0,0.95)',
        border: '1px solid rgba(0,255,148,0.3)',
        backdropFilter: 'blur(20px)',
      }}
    >
      <div className="p-3">
        {/* Header with collapse */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ backgroundColor: '#00FF94' }}
            />
            <span className="text-xs text-gray-400 uppercase tracking-wider">Recording</span>
          </div>
          <button
            onClick={() => setIsExpanded(false)}
            className="p-1 rounded-lg"
            style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
          >
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-3">
          {/* Activity icon */}
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
            style={{ backgroundColor: 'rgba(0,255,148,0.15)' }}
          >
            {icon}
          </div>

          {/* Workout info */}
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm text-white truncate">
              {typeName}
              {subtypeName && <span className="text-gray-400 font-normal"> • {subtypeName}</span>}
            </div>
            <div className="text-xl font-mono font-bold" style={{ color: '#00FF94' }}>
              {formatElapsed(elapsed)}
            </div>
          </div>

          {/* Cancel button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            className="p-2 rounded-lg transition-all"
            style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
          >
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Live metrics from Apple Watch/Whoop */}
        {(liveMetrics.lastHr > 0 || liveMetrics.calories > 0) && (
          <div className="flex items-center gap-4 mt-2 py-2 px-3 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
            {liveMetrics.lastHr > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-red-400">❤️</span>
                <span className="text-sm font-medium text-white">{liveMetrics.lastHr}</span>
                <span className="text-xs text-gray-500">bpm</span>
              </div>
            )}
            {liveMetrics.calories > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-orange-400">🔥</span>
                <span className="text-sm font-medium text-white">{liveMetrics.calories}</span>
                <span className="text-xs text-gray-500">cal</span>
              </div>
            )}
          </div>
        )}

        {/* Finish button */}
        <button
          onClick={onFinish}
          className="w-full mt-3 py-2.5 rounded-xl font-semibold text-sm text-black transition-all active:scale-[0.98]"
          style={{ backgroundColor: '#00FF94' }}
        >
          Finish Workout
        </button>
      </div>
    </div>
  );
};

// Finish Workout Modal - Shown when user taps "Finish Workout"
const FinishWorkoutModal = ({ isOpen, workout, onClose, onSave }) => {
  const [notes, setNotes] = useState('');
  const [calories, setCalories] = useState('');
  const [avgHr, setAvgHr] = useState('');
  const [maxHr, setMaxHr] = useState('');
  const [distance, setDistance] = useState('');
  const [activityPhoto, setActivityPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [isPhotoPrivate, setIsPhotoPrivate] = useState(false);
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false);
  const [healthKitDataFetched, setHealthKitDataFetched] = useState(false);

  const fileInputRef = useRef(null);

  // Check if this is a distance-based activity
  const isDistanceActivity = workout?.type === 'Running' || workout?.type === 'Cycle';

  // Check if we have metrics (either from HealthKit auto-fetch or manual entry)
  const hasMetrics = calories || avgHr || maxHr;

  // Calculate duration
  const getDuration = () => {
    if (!workout?.startTime) return 0;
    const start = new Date(workout.startTime).getTime();
    const now = Date.now();
    return Math.floor((now - start) / 60000); // Duration in minutes
  };

  const duration = getDuration();

  // Format duration for display
  const formatDuration = (minutes) => {
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hrs > 0) {
      return `${hrs}h ${mins}m`;
    }
    return `${mins} min`;
  };

  // Reset state and fetch HealthKit metrics when modal opens
  useEffect(() => {
    if (isOpen && workout?.startTime) {
      // Reset all state
      setNotes('');
      setCalories('');
      setAvgHr('');
      setMaxHr('');
      setDistance('');
      setActivityPhoto(null);
      setPhotoPreview(null);
      setIsPhotoPrivate(false);
      setHealthKitDataFetched(false);

      // Get current metrics from the live workout session (don't end it yet)
      const fetchMetrics = async () => {
        setIsLoadingMetrics(true);
        try {
          // Get metrics from the live workout without ending it
          const liveResult = await getLiveWorkoutMetrics();
          console.log('Live workout metrics:', liveResult);

          let hasData = false;

          if (liveResult.success && liveResult.isActive) {
            // Use live workout metrics if we have them
            if (liveResult.calories > 0) {
              setCalories(liveResult.calories.toString());
              hasData = true;
            }
            if (liveResult.avgHr > 0) {
              setAvgHr(liveResult.avgHr.toString());
              hasData = true;
            }
            if (liveResult.maxHr > 0) {
              setMaxHr(liveResult.maxHr.toString());
              hasData = true;
            }
          }

          // If live workout didn't get data, fallback to querying HealthKit directly
          if (!hasData) {
            const endTime = new Date().toISOString();
            const result = await fetchWorkoutMetricsForTimeRange(workout.startTime, endTime);
            console.log('Fallback HealthKit query:', result);

            if (result.success && result.hasData) {
              if (result.metrics.calories) {
                setCalories(result.metrics.calories.toString());
              }
              if (result.metrics.avgHr) {
                setAvgHr(result.metrics.avgHr.toString());
              }
              if (result.metrics.maxHr) {
                setMaxHr(result.metrics.maxHr.toString());
              }
            }
          }

          setHealthKitDataFetched(true);
        } catch (error) {
          console.error('Error fetching HealthKit metrics:', error);
          setHealthKitDataFetched(true);
        } finally {
          setIsLoadingMetrics(false);
        }
      };

      fetchMetrics();
    } else if (isOpen) {
      // Modal opened without workout data - just reset state
      setNotes('');
      setCalories('');
      setAvgHr('');
      setMaxHr('');
      setDistance('');
      setActivityPhoto(null);
      setPhotoPreview(null);
      setIsPhotoPrivate(false);
      setHealthKitDataFetched(false);
      setIsLoadingMetrics(false);
    }
  }, [isOpen, workout?.startTime]);

  // Handle photo from library using Capacitor Camera
  const handleChooseFromLibrary = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        const image = await Camera.getPhoto({
          quality: 90,
          allowEditing: false,
          resultType: CameraResultType.DataUrl,
          source: CameraSource.Photos
        });

        if (image.dataUrl) {
          const response = await fetch(image.dataUrl);
          const blob = await response.blob();
          const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
          setActivityPhoto(file);
          setPhotoPreview(image.dataUrl);
        }
      } catch (error) {
        if (error.message !== 'User cancelled photos app') {
          console.error('Error picking photo:', error);
        }
      }
    } else {
      fileInputRef.current?.click();
    }
  };

  // Handle photo from camera using Capacitor Camera
  const handleTakePhoto = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        const image = await Camera.getPhoto({
          quality: 90,
          allowEditing: false,
          resultType: CameraResultType.DataUrl,
          source: CameraSource.Camera
        });

        if (image.dataUrl) {
          const response = await fetch(image.dataUrl);
          const blob = await response.blob();
          const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
          setActivityPhoto(file);
          setPhotoPreview(image.dataUrl);
        }
      } catch (error) {
        if (error.message !== 'User cancelled photos app') {
          console.error('Error taking photo:', error);
        }
      }
    }
  };

  // Handle file input for web fallback
  const handleFileInput = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('Image must be less than 10MB');
      return;
    }
    setActivityPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
    e.target.value = '';
  };

  // Clear photo
  const clearPhoto = () => {
    if (photoPreview && activityPhoto && !photoPreview.startsWith('data:')) {
      URL.revokeObjectURL(photoPreview);
    }
    setActivityPhoto(null);
    setPhotoPreview(null);
  };

  if (!isOpen || !workout) return null;

  const icon = workout.customEmoji || workout.sportEmoji || workout.icon || '💪';
  const typeName = workout.type === 'Strength Training'
    ? (workout.strengthType || 'Strength')
    : workout.type;
  const subtypeName = workout.type === 'Strength Training'
    ? workout.focusArea
    : (workout.subtype || '');

  const handleSave = () => {
    const endTime = new Date().toISOString();
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    onSave({
      ...workout,
      date: dateStr,
      duration,
      notes: notes || undefined,
      calories: calories ? parseInt(calories) : undefined,
      avgHr: avgHr ? parseInt(avgHr) : undefined,
      maxHr: maxHr ? parseInt(maxHr) : undefined,
      distance: distance ? parseFloat(distance) : undefined,
      // Store exact timestamps for HealthKit
      startTime: workout.startTime,
      endTime,
      // Photo data
      photoFile: activityPhoto || undefined,
      isPhotoPrivate: activityPhoto ? isPhotoPrivate : undefined,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-t-3xl overflow-hidden"
        style={{ backgroundColor: '#1A1A1A', maxHeight: '85vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <button
            onClick={onClose}
            className="text-gray-400 font-medium px-2 py-1"
          >
            Cancel
          </button>
          <h2 className="font-bold text-white">Finish Workout</h2>
          <button
            onClick={handleSave}
            className="font-bold px-2 py-1"
            style={{ color: '#00FF94' }}
          >
            Save
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto" style={{ maxHeight: 'calc(85vh - 60px)' }}>
          {/* Workout summary */}
          <div
            className="p-4 rounded-2xl mb-6"
            style={{ backgroundColor: 'rgba(0,255,148,0.1)', border: '1px solid rgba(0,255,148,0.2)' }}
          >
            <div className="flex items-center gap-4">
              <div
                className="w-16 h-16 rounded-xl flex items-center justify-center text-3xl"
                style={{ backgroundColor: 'rgba(0,255,148,0.15)' }}
              >
                {icon}
              </div>
              <div>
                <div className="font-semibold text-lg text-white">
                  {typeName}
                  {subtypeName && <span className="text-gray-400 font-normal"> • {subtypeName}</span>}
                </div>
                <div className="text-3xl font-bold mt-1" style={{ color: '#00FF94' }}>
                  {formatDuration(duration)}
                </div>
              </div>
            </div>
          </div>

          {/* Optional metrics */}
          <div className="space-y-4">
            <div className="text-sm text-gray-400 mb-2">Optional Details</div>

            {/* Notes */}
            <div>
              <label className="text-xs text-gray-500 block mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="How did it feel?"
                className="w-full p-3 rounded-xl text-white placeholder-gray-600 resize-none"
                style={{ backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                rows={2}
              />
            </div>

            {/* Distance field for Running/Cycle */}
            {isDistanceActivity && (
              <div>
                <label className="text-xs text-gray-500 block mb-1">Distance (miles)</label>
                <input
                  type="number"
                  step="0.1"
                  value={distance}
                  onChange={(e) => setDistance(e.target.value)}
                  placeholder="0.0"
                  className="w-full p-3 rounded-xl text-white placeholder-gray-600"
                  style={{ backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                />
              </div>
            )}

            {/* Metrics row */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Calories</label>
                <input
                  type="number"
                  value={calories}
                  onChange={(e) => setCalories(e.target.value)}
                  placeholder="—"
                  className="w-full p-3 rounded-xl text-white text-center placeholder-gray-600"
                  style={{ backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Avg HR</label>
                <input
                  type="number"
                  value={avgHr}
                  onChange={(e) => setAvgHr(e.target.value)}
                  placeholder="—"
                  className="w-full p-3 rounded-xl text-white text-center placeholder-gray-600"
                  style={{ backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Max HR</label>
                <input
                  type="number"
                  value={maxHr}
                  onChange={(e) => setMaxHr(e.target.value)}
                  placeholder="—"
                  className="w-full p-3 rounded-xl text-white text-center placeholder-gray-600"
                  style={{ backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                />
              </div>
            </div>

            {/* Photo Upload Section */}
            <div className="mt-4">
              <label className="text-xs text-gray-500 block mb-2">Photo (optional)</label>

              {/* Hidden file input for web fallback */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileInput}
                accept="image/*"
                className="hidden"
              />

              {photoPreview ? (
                <div className="space-y-3">
                  {/* Photo Preview */}
                  <div className="relative rounded-xl overflow-hidden">
                    <img
                      src={photoPreview}
                      alt="Activity preview"
                      className="w-full h-48 object-cover"
                    />
                    <button
                      onClick={clearPhoto}
                      className="absolute top-2 right-2 w-8 h-8 bg-black/60 rounded-full flex items-center justify-center"
                    >
                      <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {/* Privacy Toggle */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-white/5">
                    <span className="text-sm text-gray-300">Who can see this?</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setIsPhotoPrivate(false)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${!isPhotoPrivate ? 'bg-[#00FF94] text-black' : 'bg-white/10 text-gray-400'}`}
                      >
                        Friends
                      </button>
                      <button
                        onClick={() => setIsPhotoPrivate(true)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${isPhotoPrivate ? 'bg-[#00FF94] text-black' : 'bg-white/10 text-gray-400'}`}
                      >
                        Only Me
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={handleTakePhoto}
                    className="flex-1 flex items-center justify-center gap-2 p-3 rounded-xl bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span className="text-sm">Camera</span>
                  </button>
                  <button
                    onClick={handleChooseFromLibrary}
                    className="flex-1 flex items-center justify-center gap-2 p-3 rounded-xl bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-sm">Library</span>
                  </button>
                </div>
              )}
            </div>

            {/* HealthKit Info/Warning */}
            {isLoadingMetrics ? (
              <div className="mt-4 p-3 rounded-xl" style={{ backgroundColor: 'rgba(0,255,148,0.05)', border: '1px solid rgba(0,255,148,0.1)' }}>
                <div className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-[#00FF94] border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-xs text-gray-400">
                    Fetching stats from Apple Health...
                  </p>
                </div>
              </div>
            ) : !hasMetrics && healthKitDataFetched ? (
              <div className="mt-4 p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,193,7,0.1)', border: '1px solid rgba(255,193,7,0.3)' }}>
                <div className="flex items-start gap-2">
                  <span className="text-yellow-500 text-lg">⚠️</span>
                  <div>
                    <p className="text-xs text-yellow-500/90">
                      No workout stats detected from Apple Health. Heart rate and calorie data from your Apple Watch or Whoop may take a few minutes to sync. You can add metrics manually above or save now and they'll link automatically later.
                    </p>
                  </div>
                </div>
              </div>
            ) : hasMetrics ? (
              <div className="mt-4 p-3 rounded-xl" style={{ backgroundColor: 'rgba(0,255,148,0.05)', border: '1px solid rgba(0,255,148,0.1)' }}>
                <div className="flex items-start gap-2">
                  <span className="text-[#00FF94] text-lg">✓</span>
                  <p className="text-xs text-gray-400">
                    Stats synced from Apple Health. Any additional data will be automatically linked to this workout.
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

// Long Press Context Menu Component
const LongPressMenu = ({ show, position, onClose, onEdit, onDelete, onShare }) => {
  if (!show) return null;

  // Position menu above the touch point with arrow pointing down
  const menuWidth = 200;
  const menuHeight = 130;
  const arrowSize = 12;
  const offsetAbove = 20; // Gap between arrow and touch point
  const screenWidth = window.innerWidth;

  // Calculate position - prefer above the finger
  let menuTop = position.y - menuHeight - arrowSize - offsetAbove;
  let menuLeft = position.x - menuWidth / 2;
  let showAbove = true;

  // If menu would go above screen, show below finger instead
  if (menuTop < 60) {
    menuTop = position.y + offsetAbove + arrowSize;
    showAbove = false;
  }

  // Keep menu within horizontal bounds
  menuLeft = Math.max(16, Math.min(menuLeft, screenWidth - menuWidth - 16));

  // Calculate arrow position relative to menu (pointing at touch x position)
  const arrowLeft = Math.max(20, Math.min(position.x - menuLeft, menuWidth - 20));

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[60] bg-black/40"
        onClick={onClose}
        onTouchEnd={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      {/* Menu with arrow */}
      <div
        className="fixed z-[61]"
        style={{
          top: menuTop,
          left: menuLeft,
          width: `${menuWidth}px`,
          animation: 'scaleIn 150ms ease-out',
        }}
      >
        {/* Arrow pointing up (when menu is below) */}
        {!showAbove && (
          <div
            style={{
              position: 'absolute',
              top: -arrowSize + 1,
              left: arrowLeft - arrowSize,
              width: 0,
              height: 0,
              borderLeft: `${arrowSize}px solid transparent`,
              borderRight: `${arrowSize}px solid transparent`,
              borderBottom: `${arrowSize}px solid rgba(38, 38, 38, 0.98)`,
            }}
          />
        )}
        {/* Menu content */}
        <div
          className="rounded-2xl overflow-hidden shadow-2xl"
          style={{
            backgroundColor: 'rgba(38, 38, 38, 0.98)',
            backdropFilter: 'blur(20px)',
          }}
        >
          <button
            className="w-full px-5 py-4 flex items-center gap-4 text-white text-base font-medium active:bg-white/10"
            onClick={() => { onEdit(); onClose(); }}
            onTouchEnd={(e) => { e.stopPropagation(); triggerHaptic(ImpactStyle.Light); onEdit(); onClose(); }}
          >
            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
            </svg>
            Edit Activity
          </button>
          <div className="h-px bg-white/10 mx-4" />
          <button
            className="w-full px-5 py-4 flex items-center gap-4 text-red-400 text-base font-medium active:bg-white/10"
            onClick={() => { onDelete(); onClose(); }}
            onTouchEnd={(e) => { e.stopPropagation(); triggerHaptic(ImpactStyle.Medium); onDelete(); onClose(); }}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
            </svg>
            Delete Activity
          </button>
        </div>
        {/* Arrow pointing down (when menu is above) */}
        {showAbove && (
          <div
            style={{
              position: 'absolute',
              bottom: -arrowSize + 1,
              left: arrowLeft - arrowSize,
              width: 0,
              height: 0,
              borderLeft: `${arrowSize}px solid transparent`,
              borderRight: `${arrowSize}px solid transparent`,
              borderTop: `${arrowSize}px solid rgba(38, 38, 38, 0.98)`,
            }}
          />
        )}
      </div>
      <style>{`
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.9); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </>
  );
};

// Global ref to track if user is currently pulling to refresh (for blocking taps during pull)
const globalIsPulling = { current: false };

// Pull-to-Refresh Hook with Haptic Feedback - uses native event listeners on #root
const usePullToRefresh = (onRefresh, { threshold = 80, resistance = 2.5, enabled = true } = {}) => {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Use refs to avoid stale closures in event handlers
  const touchStartY = useRef(0);
  const initialScrollTop = useRef(0);
  const isPulling = useRef(false);
  const hasTriggeredHaptic = useRef(false);
  const pullDistanceRef = useRef(0);
  const isRefreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  const lastTouchTime = useRef(0);
  const activeTouchId = useRef(null); // Track the touch identifier we're following
  const hadDownwardMovement = useRef(false); // Track if any downward movement occurred
  const maxPullDistance = useRef(0); // Track maximum pull distance reached
  const thresholdRef = useRef(threshold); // Track threshold to avoid stale closures

  // Keep refs in sync
  useEffect(() => {
    isRefreshingRef.current = isRefreshing;
  }, [isRefreshing]);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    thresholdRef.current = threshold;
  }, [threshold]);

  useEffect(() => {
    if (!enabled) return;

    const root = document.getElementById('root');
    if (!root) return;

    const getScrollTop = () => {
      // Try multiple sources for scroll position for maximum compatibility
      return root.scrollTop || window.pageYOffset || document.documentElement.scrollTop || 0;
    };

    const handleTouchStart = (e) => {
      if (isRefreshingRef.current) return;
      if (!e.touches || e.touches.length === 0) return;

      const touch = e.touches[0];
      const now = Date.now();
      const timeSinceLastTouch = now - lastTouchTime.current;

      // If we're "pulling" but it's been more than 150ms since last touch, reset - the gesture ended
      if (isPulling.current && timeSinceLastTouch > 150) {
        isPulling.current = false;
        globalIsPulling.current = false;
        pullDistanceRef.current = 0;
        setPullDistance(0);
        activeTouchId.current = null;
      }

      // If we have an active touch and this is a different touch, ignore it
      if (activeTouchId.current !== null && touch.identifier !== activeTouchId.current) {
        return;
      }

      // Don't reset if we're actively pulling (rapid touchstart events from iOS)
      if (isPulling.current) {
        lastTouchTime.current = now;
        return;
      }

      // Start tracking this touch
      activeTouchId.current = touch.identifier;
      touchStartY.current = touch.clientY;
      initialScrollTop.current = getScrollTop();
      hasTriggeredHaptic.current = false;
      lastTouchTime.current = now;
      hadDownwardMovement.current = false;
      maxPullDistance.current = 0;
    };

    const handleTouchMove = (e) => {
      if (isRefreshingRef.current) return;
      if (!e.touches || e.touches.length === 0) return;

      // Find our tracked touch
      let touch = null;
      for (let i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === activeTouchId.current) {
          touch = e.touches[i];
          break;
        }
      }
      // If our touch isn't found, use the first touch
      if (!touch) touch = e.touches[0];

      // Update last touch time
      lastTouchTime.current = Date.now();

      const currentScrollTop = getScrollTop();
      const touchY = touch.clientY;
      const diff = touchY - touchStartY.current;

      // Track any downward movement at top of page (for very low threshold refresh)
      if (currentScrollTop <= 5 && initialScrollTop.current <= 5 && diff > 0) {
        hadDownwardMovement.current = true;
        maxPullDistance.current = Math.max(maxPullDistance.current, diff / resistance);
      }

      // If already pulling, continue tracking regardless of scroll position
      if (isPulling.current) {
        // Calculate new distance - use the max of new value and slightly decayed previous value
        const newDistance = diff / resistance;
        // Keep the higher of: new distance, or previous distance minus small decay
        const distance = Math.max(0, Math.min(newDistance, thresholdRef.current * 1.5), pullDistanceRef.current - 1);
        pullDistanceRef.current = distance;
        setPullDistance(distance);

        // Trigger refresh IMMEDIATELY when crossing threshold (don't wait for touchend)
        if (distance >= thresholdRef.current && !hasTriggeredHaptic.current) {
          hasTriggeredHaptic.current = true;
          triggerHaptic(ImpactStyle.Medium);
          // Trigger refresh now
          isPulling.current = false;
          globalIsPulling.current = false;
          setIsRefreshing(true);
          isRefreshingRef.current = true;
          triggerHaptic(ImpactStyle.Heavy);
          if (onRefreshRef.current) {
            Promise.resolve(onRefreshRef.current()).finally(() => {
              setTimeout(() => {
                setIsRefreshing(false);
                isRefreshingRef.current = false;
                setPullDistance(0);
                pullDistanceRef.current = 0;
              }, 600);
            });
          }
        }
        return;
      }

      // Only activate when started at top, still at top, and pulling down
      // Use lower activation threshold for low refresh thresholds (min 2px)
      const activationThreshold = Math.max(2, Math.min(10, thresholdRef.current * resistance));
      if (currentScrollTop <= 5 && initialScrollTop.current <= 5 && diff > activationThreshold) {
        isPulling.current = true;
        globalIsPulling.current = true;
        const distance = Math.min(diff / resistance, thresholdRef.current * 1.5);
        pullDistanceRef.current = distance;
        setPullDistance(distance);
        // Trigger refresh IMMEDIATELY when crossing threshold
        if (distance >= thresholdRef.current && !hasTriggeredHaptic.current) {
          hasTriggeredHaptic.current = true;
          triggerHaptic(ImpactStyle.Medium);
          // Trigger refresh now
          isPulling.current = false;
          globalIsPulling.current = false;
          activeTouchId.current = null;
          setIsRefreshing(true);
          isRefreshingRef.current = true;
          triggerHaptic(ImpactStyle.Heavy);
          if (onRefreshRef.current) {
            Promise.resolve(onRefreshRef.current()).finally(() => {
              setTimeout(() => {
                setIsRefreshing(false);
                isRefreshingRef.current = false;
                setPullDistance(0);
                pullDistanceRef.current = 0;
              }, 600);
            });
          }
        }
      } else {
        pullDistanceRef.current = 0;
        setPullDistance(0);
      }
    };

    const handleTouchEnd = async (e) => {

      // Reset active touch ID
      activeTouchId.current = null;

      const currentScrollTop = getScrollTop();

      // Check if touch ended lower than it started (finger moved down)
      let touchEndY = 0;
      if (e.changedTouches && e.changedTouches.length > 0) {
        touchEndY = e.changedTouches[0].clientY;
      }
      const fingerMovedDown = touchEndY > touchStartY.current;

      // For very low thresholds (<=5), trigger refresh if:
      // 1. We had ANY downward movement at top, OR
      // 2. Touch started at top AND finger moved downward (even if iOS blocked move events)
      const startedAtTop = initialScrollTop.current <= 5;
      const endedAtTop = currentScrollTop <= 5;
      const hadAnyPullIntent = hadDownwardMovement.current || (startedAtTop && endedAtTop && fingerMovedDown);

      if (!isRefreshingRef.current && thresholdRef.current <= 5 && hadAnyPullIntent && onRefreshRef.current) {
        hadDownwardMovement.current = false;
        maxPullDistance.current = 0;
        isPulling.current = false;
        globalIsPulling.current = false;

        setIsRefreshing(true);
        isRefreshingRef.current = true;
        triggerHaptic(ImpactStyle.Heavy);
        try {
          const startTime = Date.now();
          await onRefreshRef.current();
          const elapsed = Date.now() - startTime;
          if (elapsed < 600) {
            await new Promise(resolve => setTimeout(resolve, 600 - elapsed));
          }
        } finally {
          setIsRefreshing(false);
          isRefreshingRef.current = false;
          setPullDistance(0);
          pullDistanceRef.current = 0;
        }
        return;
      }

      hadDownwardMovement.current = false;
      maxPullDistance.current = 0;

      if (isRefreshingRef.current || !isPulling.current) return;

      const distance = pullDistanceRef.current;
      isPulling.current = false;
      globalIsPulling.current = false; // Reset global ref

      if (distance >= thresholdRef.current && onRefreshRef.current) {
        setIsRefreshing(true);
        isRefreshingRef.current = true;
        triggerHaptic(ImpactStyle.Heavy);
        try {
          // Ensure minimum refresh time of 600ms so animation doesn't flash away
          const startTime = Date.now();
          await onRefreshRef.current();
          const elapsed = Date.now() - startTime;
          if (elapsed < 600) {
            await new Promise(resolve => setTimeout(resolve, 600 - elapsed));
          }
        } finally {
          setIsRefreshing(false);
          isRefreshingRef.current = false;
          setPullDistance(0);
          pullDistanceRef.current = 0;
        }
      } else {
        setPullDistance(0);
        pullDistanceRef.current = 0;
      }
    };

    const handleTouchCancel = async () => {
      // For very low thresholds, trigger refresh even on cancel if we had downward movement
      if (!isRefreshingRef.current && thresholdRef.current <= 5 && hadDownwardMovement.current && onRefreshRef.current) {
        hadDownwardMovement.current = false;
        maxPullDistance.current = 0;
        isPulling.current = false;
        globalIsPulling.current = false;
        activeTouchId.current = null;

        setIsRefreshing(true);
        isRefreshingRef.current = true;
        triggerHaptic(ImpactStyle.Heavy);
        try {
          const startTime = Date.now();
          await onRefreshRef.current();
          const elapsed = Date.now() - startTime;
          if (elapsed < 600) {
            await new Promise(resolve => setTimeout(resolve, 600 - elapsed));
          }
        } finally {
          setIsRefreshing(false);
          isRefreshingRef.current = false;
          setPullDistance(0);
          pullDistanceRef.current = 0;
        }
        return;
      }

      isPulling.current = false;
      globalIsPulling.current = false;
      activeTouchId.current = null;
      hadDownwardMovement.current = false;
      maxPullDistance.current = 0;
      setPullDistance(0);
      pullDistanceRef.current = 0;
    };

    // Periodic check to reset stuck pull states (iOS doesn't always fire touchend/touchcancel)
    // For very low thresholds, trigger refresh if we had downward movement
    const stuckCheckInterval = setInterval(async () => {
      if (!isRefreshingRef.current) {
        const timeSinceLastTouch = Date.now() - lastTouchTime.current;

        // If we had downward movement and touch stopped for 100ms, trigger refresh for low thresholds
        if (timeSinceLastTouch > 100 && thresholdRef.current <= 5 && hadDownwardMovement.current && onRefreshRef.current) {
          hadDownwardMovement.current = false;
          maxPullDistance.current = 0;
          isPulling.current = false;
          globalIsPulling.current = false;
          activeTouchId.current = null;

          setIsRefreshing(true);
          isRefreshingRef.current = true;
          triggerHaptic(ImpactStyle.Heavy);
          try {
            const startTime = Date.now();
            await onRefreshRef.current();
            const elapsed = Date.now() - startTime;
            if (elapsed < 600) {
              await new Promise(resolve => setTimeout(resolve, 600 - elapsed));
            }
          } finally {
            setIsRefreshing(false);
            isRefreshingRef.current = false;
            setPullDistance(0);
            pullDistanceRef.current = 0;
          }
          return;
        }

        // Regular stuck state reset
        if (isPulling.current && timeSinceLastTouch > 100) {
          isPulling.current = false;
          globalIsPulling.current = false;
          activeTouchId.current = null;
          hadDownwardMovement.current = false;
          maxPullDistance.current = 0;
          setPullDistance(0);
          pullDistanceRef.current = 0;
        }
      }
    }, 50);

    // Use window with capture phase to receive touch events FIRST, before any child can stop propagation
    // Window-level listeners receive events before document-level listeners
    window.addEventListener('touchstart', handleTouchStart, { passive: true, capture: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true, capture: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true, capture: true });
    window.addEventListener('touchcancel', handleTouchCancel, { passive: true, capture: true });

    return () => {
      clearInterval(stuckCheckInterval);
      window.removeEventListener('touchstart', handleTouchStart, { capture: true });
      window.removeEventListener('touchmove', handleTouchMove, { capture: true });
      window.removeEventListener('touchend', handleTouchEnd, { capture: true });
      window.removeEventListener('touchcancel', handleTouchCancel, { capture: true });
    };
  }, [enabled, threshold, resistance]);

  return { pullDistance, isRefreshing };
};

// Pull-to-Refresh Indicator Component
const PullToRefreshIndicator = ({ pullDistance, isRefreshing, threshold = 80 }) => {
  const progress = Math.min(pullDistance / threshold, 1);
  const rotation = progress * 180;

  if (pullDistance === 0 && !isRefreshing) return null;

  // Position below the header
  return (
    <div
      className="fixed left-0 right-0 flex items-center justify-center z-50 pointer-events-none"
      style={{
        top: 'calc(env(safe-area-inset-top, 0px) + 85px)',
        opacity: isRefreshing ? 1 : progress,
        transition: isRefreshing ? 'none' : 'opacity 0.1s',
      }}
    >
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center shadow-lg"
        style={{
          backgroundColor: 'rgba(0, 255, 148, 0.15)',
          backdropFilter: 'blur(10px)',
          transform: `rotate(${isRefreshing ? 0 : rotation}deg)`,
        }}
      >
        {isRefreshing ? (
          <div
            className="w-4 h-4 border-2 border-[#00FF94] border-t-transparent rounded-full"
            style={{
              animation: 'dynamicSpin 0.8s cubic-bezier(0.4, 0, 0.2, 1) infinite',
            }}
          />
        ) : (
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="#00FF94"
            viewBox="0 0 24 24"
            strokeWidth={2.5}
            style={{
              opacity: progress,
              transform: progress >= 1 ? 'scale(1.1)' : 'scale(1)',
              transition: 'transform 0.15s',
            }}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5 12 21m0 0-7.5-7.5M12 21V3" />
          </svg>
        )}
      </div>
      <style>{`
        @keyframes dynamicSpin {
          0% { transform: rotate(0deg); }
          25% { transform: rotate(120deg); }
          50% { transform: rotate(180deg); }
          75% { transform: rotate(300deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

// Toast Notification Component
const Toast = ({ show, message, onDismiss, onTap, type = 'record' }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [swipeY, setSwipeY] = useState(0);
  const touchStartRef = useRef({ y: null, time: 0 });
  const swipeYRef = useRef(0);
  const toastRef = useRef(null);

  // Keep swipeY ref in sync
  useEffect(() => {
    swipeYRef.current = swipeY;
  }, [swipeY]);

  useEffect(() => {
    if (show) {
      setIsVisible(true);
      setIsLeaving(false);
      setSwipeY(0);

      // Auto dismiss after 4 seconds
      const timer = setTimeout(() => {
        setIsLeaving(true);
        setTimeout(() => {
          setIsVisible(false);
          onDismiss && onDismiss();
        }, 300);
      }, 4000);

      return () => clearTimeout(timer);
    }
  }, [show, onDismiss]);

  // Use native event listeners to ensure swipe works
  useEffect(() => {
    const element = toastRef.current;
    if (!element || !isVisible) return;

    const handleTouchStart = (e) => {
      touchStartRef.current = { y: e.touches[0].clientY, time: Date.now() };
    };

    const handleTouchMove = (e) => {
      if (touchStartRef.current.y === null) return;
      const diff = e.touches[0].clientY - touchStartRef.current.y;
      // Only allow swiping down (positive diff)
      if (diff > 5) {
        e.preventDefault(); // Prevent scroll
        setSwipeY(Math.min(diff, 150));
      }
    };

    const handleTouchEnd = (e) => {
      const currentSwipeY = swipeYRef.current;
      const touchDuration = Date.now() - touchStartRef.current.time;
      const wasTap = currentSwipeY < 15 && touchDuration < 300;

      if (currentSwipeY > 40) {
        // Swipe threshold reached - dismiss with slide down animation
        triggerHaptic(ImpactStyle.Light);
        setIsLeaving(true);
        setTimeout(() => {
          setIsVisible(false);
          setSwipeY(0);
          onDismiss && onDismiss();
        }, 300);
      } else if (wasTap) {
        // This was a tap - trigger onTap
        setIsLeaving(true);
        setTimeout(() => {
          setIsVisible(false);
          onDismiss && onDismiss();
          onTap && onTap();
        }, 300);
      } else {
        // Snap back
        setSwipeY(0);
      }
      touchStartRef.current = { y: null, time: 0 };
    };

    element.addEventListener('touchstart', handleTouchStart, { passive: true });
    element.addEventListener('touchmove', handleTouchMove, { passive: false });
    element.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isVisible, onDismiss, onTap]);

  if (!isVisible) return null;

  const bgColor = type === 'record'
    ? 'linear-gradient(135deg, rgba(255,215,0,0.15) 0%, rgba(255,149,0,0.1) 100%)'
    : 'rgba(0,255,148,0.1)';
  const borderColor = type === 'record' ? 'rgba(255,215,0,0.3)' : 'rgba(0,255,148,0.3)';
  const icon = type === 'record' ? '🏆' : '✓';

  return (
    <div
      ref={toastRef}
      className="fixed bottom-6 left-4 right-4 z-50"
      style={{
        transform: isLeaving ? 'translateY(150px)' : `translateY(${swipeY}px)`,
        opacity: isLeaving ? 0 : Math.max(0, 1 - swipeY / 150),
        transition: swipeY === 0 || isLeaving ? 'transform 0.3s ease-out, opacity 0.3s ease-out' : 'none'
      }}
    >
      <div
        className="w-full p-4 rounded-2xl flex items-start gap-3 shadow-lg text-left"
        style={{
          background: bgColor,
          border: `1px solid ${borderColor}`,
          backdropFilter: 'blur(20px)'
        }}
      >
        <span className="text-2xl">{icon}</span>
        <div className="flex-1">
          <div className="text-sm font-bold text-white" style={{ whiteSpace: 'pre-line' }}>{message}</div>
          {type === 'record' && <div className="text-xs text-gray-400 mt-1">Tap to view Hall of Fame →</div>}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            triggerHaptic(ImpactStyle.Light);
            setIsLeaving(true);
            setTimeout(() => {
              setIsVisible(false);
              onDismiss && onDismiss();
            }, 300);
          }}
          className="text-gray-400 hover:text-white transition-colors p-1"
        >
          ✕
        </button>
      </div>
    </div>
  );
};

// Celebration Animation Component
const CelebrationOverlay = ({ show, onComplete, message = "Goal Complete!" }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);

  useEffect(() => {
    if (show) {
      setIsVisible(true);
      setIsFadingOut(false);

      // Start fade out after 1.2s (shortened from 2.5s)
      const fadeTimer = setTimeout(() => {
        setIsFadingOut(true);
      }, 1200);

      // Complete after fade out (1.2s + 0.5s fade)
      const completeTimer = setTimeout(() => {
        setIsVisible(false);
        onComplete();
      }, 1700);

      return () => {
        clearTimeout(fadeTimer);
        clearTimeout(completeTimer);
      };
    }
  }, [show, onComplete]);

  if (!isVisible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
      style={{
        opacity: isFadingOut ? 0 : 1,
        transform: isFadingOut ? 'scale(1.1)' : 'scale(1)',
        transition: 'opacity 0.5s ease-out, transform 0.5s ease-out'
      }}
    >
      {/* Background pulse */}
      <div 
        className="absolute inset-0 animate-pulse-bg"
        style={{ 
          background: 'radial-gradient(circle at center, rgba(0,255,148,0.15) 0%, transparent 70%)'
        }}
      />
      
      {/* Main content */}
      <div className="text-center animate-bounce-in relative z-10">
        {/* Pulsing ring behind emoji */}
        <div className="relative inline-block mb-4">
          <div className="absolute inset-0 rounded-full animate-ping-slow" style={{ backgroundColor: 'rgba(0,255,148,0.3)', transform: 'scale(1.5)' }} />
          <div className="absolute inset-0 rounded-full animate-ping-slower" style={{ backgroundColor: 'rgba(0,255,148,0.2)', transform: 'scale(2)' }} />
          <div className="text-6xl relative z-10 animate-wiggle">🎉</div>
        </div>
        <div className="text-2xl font-black animate-text-glow text-center" style={{ color: '#00FF94', whiteSpace: 'pre-line' }}>{message}</div>
        <div className="text-gray-400 mt-2 animate-fade-in-delayed">Keep pushing!</div>
      </div>
      
      {/* Confetti particles */}
      <div className="absolute inset-0 overflow-hidden">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute animate-confetti"
            style={{
              width: `${6 + Math.random() * 8}px`,
              height: `${6 + Math.random() * 8}px`,
              borderRadius: Math.random() > 0.5 ? '50%' : '2px',
              backgroundColor: ['#00FF94', '#00D1FF', '#FF9500', '#BF5AF2', '#FFD700', '#FF453A'][i % 6],
              left: `${Math.random() * 100}%`,
              top: '-20px',
              animationDelay: `${Math.random() * 0.3}s`,
              animationDuration: `${1 + Math.random() * 0.8}s`
            }}
          />
        ))}
      </div>
      
      {/* Sparkles */}
      <div className="absolute inset-0 overflow-hidden">
        {[...Array(8)].map((_, i) => (
          <div
            key={`sparkle-${i}`}
            className="absolute text-xl animate-sparkle"
            style={{
              left: `${10 + Math.random() * 80}%`,
              top: `${10 + Math.random() * 80}%`,
              animationDelay: `${Math.random() * 0.5}s`
            }}
          >
            ✨
          </div>
        ))}
      </div>
      
      <style>{`
        @keyframes bounceIn {
          0% { transform: scale(0) rotate(-10deg); opacity: 0; }
          50% { transform: scale(1.2) rotate(5deg); }
          70% { transform: scale(0.9) rotate(-3deg); }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes confetti {
          0% { transform: translateY(0) rotate(0deg) scale(1); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg) scale(0.5); opacity: 0; }
        }
        @keyframes pingSlow {
          0% { transform: scale(1.5); opacity: 0.4; }
          100% { transform: scale(2.5); opacity: 0; }
        }
        @keyframes pingSlower {
          0% { transform: scale(2); opacity: 0.3; }
          100% { transform: scale(3); opacity: 0; }
        }
        @keyframes wiggle {
          0%, 100% { transform: rotate(0deg); }
          25% { transform: rotate(-10deg); }
          75% { transform: rotate(10deg); }
        }
        @keyframes textGlow {
          0%, 100% { text-shadow: 0 0 10px rgba(0,255,148,0.5); }
          50% { text-shadow: 0 0 20px rgba(0,255,148,0.8), 0 0 30px rgba(0,255,148,0.4); }
        }
        @keyframes sparkle {
          0%, 100% { opacity: 0; transform: scale(0) rotate(0deg); }
          50% { opacity: 1; transform: scale(1) rotate(180deg); }
        }
        @keyframes fadeInDelayed {
          0%, 20% { opacity: 0; transform: translateY(10px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulseBg {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        .animate-bounce-in {
          animation: bounceIn 0.5s ease-out forwards;
        }
        .animate-confetti {
          animation: confetti 1.5s ease-out forwards;
        }
        .animate-ping-slow {
          animation: pingSlow 0.8s ease-out infinite;
        }
        .animate-ping-slower {
          animation: pingSlower 1.2s ease-out infinite;
        }
        .animate-wiggle {
          animation: wiggle 0.4s ease-in-out 0.2s;
        }
        .animate-text-glow {
          animation: textGlow 0.8s ease-in-out infinite;
        }
        .animate-sparkle {
          animation: sparkle 1s ease-in-out infinite;
        }
        .animate-fade-in-delayed {
          animation: fadeInDelayed 0.5s ease-out forwards;
        }
        .animate-pulse-bg {
          animation: pulseBg 0.8s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
};

// Week Streak Celebration Modal - shown when user completes all goals for the week
const WeekStreakCelebration = ({ show, onClose, onShare }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (show) {
      setIsVisible(true);
    }
  }, [show]);

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(onClose, 300);
  };

  const handleShare = () => {
    setIsVisible(false);
    setTimeout(onShare, 300);
  };

  if (!show && !isVisible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 transition-opacity duration-300"
      style={{
        backgroundColor: 'rgba(0,0,0,0.9)',
        opacity: isVisible ? 1 : 0
      }}
    >
      {/* Radial glow background */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(circle at center, rgba(255,215,0,0.15) 0%, rgba(0,255,148,0.1) 30%, transparent 70%)',
          animation: 'pulseBg 2s ease-in-out infinite'
        }}
      />

      {/* Confetti particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(30)].map((_, i) => (
          <div
            key={i}
            className="absolute"
            style={{
              width: `${8 + Math.random() * 10}px`,
              height: `${8 + Math.random() * 10}px`,
              borderRadius: Math.random() > 0.5 ? '50%' : '2px',
              backgroundColor: ['#00FF94', '#00D1FF', '#FF9500', '#FFD700', '#FF453A', '#BF5AF2'][i % 6],
              left: `${Math.random() * 100}%`,
              top: '-20px',
              animation: `confetti ${2 + Math.random()}s ease-out forwards`,
              animationDelay: `${Math.random() * 0.5}s`
            }}
          />
        ))}
      </div>

      {/* Sparkles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(12)].map((_, i) => (
          <div
            key={`sparkle-${i}`}
            className="absolute text-2xl"
            style={{
              left: `${10 + Math.random() * 80}%`,
              top: `${10 + Math.random() * 80}%`,
              animation: 'sparkle 1.5s ease-in-out infinite',
              animationDelay: `${Math.random() * 1}s`
            }}
          >
            ✨
          </div>
        ))}
      </div>

      {/* Main content */}
      <div
        className="relative z-10 text-center transition-all duration-500"
        style={{
          transform: isVisible ? 'scale(1) translateY(0)' : 'scale(0.8) translateY(20px)',
          opacity: isVisible ? 1 : 0
        }}
      >
        {/* Fire emoji with glow rings */}
        <div className="relative inline-block mb-6">
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: 'radial-gradient(circle, rgba(255,215,0,0.4) 0%, transparent 70%)',
              transform: 'scale(3)',
              animation: 'pingSlow 1.5s ease-out infinite'
            }}
          />
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: 'radial-gradient(circle, rgba(0,255,148,0.3) 0%, transparent 70%)',
              transform: 'scale(4)',
              animation: 'pingSlower 2s ease-out infinite'
            }}
          />
          <div className="text-7xl relative z-10" style={{ animation: 'wiggle 0.5s ease-in-out' }}>🔥</div>
        </div>

        {/* Title with gradient */}
        <div
          className="text-3xl font-black mb-2"
          style={{
            background: 'linear-gradient(135deg, #FFD700 0%, #00FF94 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            animation: 'textGlow 1s ease-in-out infinite'
          }}
        >
          You Streaked the Week!
        </div>
        <div className="text-gray-400 mb-8">All goals crushed. 💪</div>

        {/* Buttons */}
        <div className="flex flex-col gap-3 w-64 mx-auto">
          <button
            onClick={handleShare}
            className="w-full py-3 px-6 rounded-xl font-bold text-black transition-all active:scale-95"
            style={{
              background: 'linear-gradient(135deg, #FFD700 0%, #00FF94 100%)',
              boxShadow: '0 4px 20px rgba(255, 215, 0, 0.4)'
            }}
          >
            Share My Week
          </button>
          <button
            onClick={handleClose}
            className="w-full py-3 px-6 rounded-xl font-medium text-gray-400 transition-all active:scale-95"
            style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

// Share Modal
const ShareModal = ({ isOpen, onClose, stats }) => {
  const [isAnimating, setIsAnimating] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [cardType, setCardType] = useState('weekly');
  const [weeklySlide, setWeeklySlide] = useState(0); // 0 = progress, 1 = highlights
  const [touchStart, setTouchStart] = useState(null);
  const [cardFormat, setCardFormat] = useState('story'); // 'story' (9:16) or 'post' (4:5)
  const [isSaving, setIsSaving] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const cardRef = useRef(null);

  // Detect mobile for responsive sizing
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  // Generate image from card
  const generateImage = async () => {
    if (!cardRef.current) return null;

    try {
      const isStory = cardFormat === 'story';
      const actualWidth = isStory ? 270 : 320;
      const actualHeight = isStory ? 480 : 400;

      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: null,
        scale: 3,
        useCORS: true,
        allowTaint: true,
        logging: false,
        width: actualWidth,
        height: actualHeight,
        onclone: (clonedDoc, clonedElement) => {
          clonedElement.style.transform = 'none';
          clonedElement.style.width = `${actualWidth}px`;
          clonedElement.style.height = `${actualHeight}px`;
          clonedElement.style.borderRadius = '0';
          clonedElement.style.overflow = 'hidden';
          clonedElement.style.background = 'linear-gradient(180deg, #0a0a0a 0%, #0d0d0d 50%, #000000 100%)';

          // Fix all elements
          const allElements = clonedElement.querySelectorAll('*');
          allElements.forEach(el => {
            // Pause animations
            el.style.animation = 'none';
            el.style.transition = 'none';

            // Fix gradient text - html2canvas doesn't support background-clip: text
            // So we replace gradient text with solid color
            const computedStyle = window.getComputedStyle(el);
            if (computedStyle.webkitBackgroundClip === 'text' ||
                computedStyle.backgroundClip === 'text' ||
                el.style.webkitBackgroundClip === 'text' ||
                el.style.WebkitBackgroundClip === 'text') {
              el.style.background = 'none';
              el.style.webkitBackgroundClip = 'unset';
              el.style.WebkitBackgroundClip = 'unset';
              el.style.backgroundClip = 'unset';
              el.style.webkitTextFillColor = 'unset';
              el.style.WebkitTextFillColor = 'unset';
              // Set a visible color based on the text content
              el.style.color = 'rgba(255, 255, 255, 0.7)';
            }

            // Fix vertical text alignment for html2canvas export
            // Text renders slightly lower in html2canvas, so we push it up
            const tagName = el.tagName.toLowerCase();
            if (tagName === 'span' || tagName === 'div') {
              const text = el.textContent?.trim();
              // Apply to text elements (not containers with many children)
              if (text && el.children.length === 0) {
                const currentTransform = el.style.transform || '';
                const isPostFormat = actualWidth / actualHeight > 0.7;

                // Slide 1 specific: Move streak category numbers to the right (colored numbers: #00FF94, #FF9500, #00D1FF)
                const elColor = el.style.color?.toLowerCase();
                const isStreakColor = elColor === '#00ff94' || elColor === '#ff9500' || elColor === '#00d1ff' ||
                  elColor === 'rgb(0, 255, 148)' || elColor === 'rgb(255, 149, 0)' || elColor === 'rgb(0, 209, 255)';
                // Streak category numbers are single/double digit numbers with streak colors and lineHeight 1.2
                const isStreakCategoryNumber = /^\d+$/.test(text) && isStreakColor && el.style.lineHeight === '1.2' &&
                  tagName === 'div' && el.classList.contains('font-bold');

                if (isStreakCategoryNumber) {
                  el.style.transform = currentTransform + ' translateX(5.5px) translateY(-6px)';
                } else if (!currentTransform.includes('translateY')) {
                  // Slide 1: Move "weeks hitting all goals" up (in the main streak row, not slide 3)
                  if (text === 'weeks hitting all goals' && el.style.lineHeight === '1.2') {
                    el.style.transform = currentTransform + ' translateY(-4px)';
                  // Move "Master Streak" and "weeks hitting all goals" on slide 3 - different for post vs story
                  } else if (text === 'Master Streak') {
                    el.style.transform = currentTransform + ` translateY(${isPostFormat ? '2px' : '6px'})`;
                  // Move big hero numbers up higher (large font size numbers)
                  } else if (/^\d+$/.test(text) && el.style.fontSize && (el.style.fontSize.includes('3rem') || el.style.fontSize.includes('4rem'))) {
                    el.style.transform = currentTransform + ' translateY(-12px)';
                  } else {
                    el.style.transform = currentTransform + ' translateY(-6px)';
                  }
                }
              }
            }
          });
        }
      });

      // Apply rounded corners by drawing on a new canvas
      const roundedCanvas = document.createElement('canvas');
      roundedCanvas.width = canvas.width;
      roundedCanvas.height = canvas.height;
      const ctx = roundedCanvas.getContext('2d');

      // Draw rounded rectangle clip path
      const radius = 16 * 3; // 16px border-radius * scale
      ctx.beginPath();
      ctx.moveTo(radius, 0);
      ctx.lineTo(canvas.width - radius, 0);
      ctx.quadraticCurveTo(canvas.width, 0, canvas.width, radius);
      ctx.lineTo(canvas.width, canvas.height - radius);
      ctx.quadraticCurveTo(canvas.width, canvas.height, canvas.width - radius, canvas.height);
      ctx.lineTo(radius, canvas.height);
      ctx.quadraticCurveTo(0, canvas.height, 0, canvas.height - radius);
      ctx.lineTo(0, radius);
      ctx.quadraticCurveTo(0, 0, radius, 0);
      ctx.closePath();
      ctx.clip();

      // Draw the original canvas onto the rounded one
      ctx.drawImage(canvas, 0, 0);

      return roundedCanvas;
      return canvas;
    } catch (error) {
      // console.error('Error generating image:', error);
      return null;
    }
  };

  // Save image directly to photos
  const handleSaveImage = async () => {
    setIsSaving(true);
    try {
      const canvas = await generateImage();
      if (!canvas) {
        alert('Failed to generate image. Please try again.');
        return;
      }

      // Get base64 data
      const dataUrl = canvas.toDataURL('image/png', 1.0);

      // On native iOS/Android, save directly to photo library
      if (Capacitor.isNativePlatform()) {
        try {
          const { Media } = await import('@capacitor-community/media');
          await Media.savePhoto({
            path: dataUrl,
            albumIdentifier: undefined // Saves to default camera roll
          });
          // Show brief success feedback
          triggerHaptic(ImpactStyle.Medium);
          return;
        } catch (e) {
          // console.log('Native save error:', e);
          // Fall through to web method
        }
      }

      // Fallback for web: trigger download
      const link = document.createElement('a');
      link.download = `dayseven-${cardType}-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
    } finally {
      setIsSaving(false);
    }
  };

  // Share image
  const executeShare = async () => {
    setIsSharing(true);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    try {
      const canvas = await generateImage();
      if (!canvas) {
        alert('Failed to generate image. Please try again.');
        setIsSharing(false);
        return;
      }

      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png', 1.0));
      const file = new File([blob], `dayseven-${cardFormat}.png`, { type: 'image/png' });

      // Try native share API (mobile)
      if (navigator.share) {
        try {
          // Check if we can share files
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file] });
            setIsSharing(false);
            return;
          }
          // Fallback: share without file (just URL/text if available)
          await navigator.share({
            title: 'Day Seven',
            text: 'Check out my Day Seven stats!'
          });
          // Still download the image since we couldn't share the file
          const link = document.createElement('a');
          link.download = `dayseven-${cardType}-${Date.now()}.png`;
          link.href = canvas.toDataURL('image/png', 1.0);
          link.click();
          setIsSharing(false);
          return;
        } catch (e) {
          // User cancelled or share failed - if AbortError, user cancelled so don't download
          if (e.name === 'AbortError') {
            setIsSharing(false);
            return;
          }
          // console.log('Share failed, falling back to download:', e);
        }
      }

      // Fallback: download the image
      const link = document.createElement('a');
      link.download = `dayseven-${cardType}-${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png', 1.0);
      link.click();
    } catch (error) {
      // console.error('Error in executeShare:', error);
      alert('Failed to generate image. Please try again.');
    } finally {
      setIsSharing(false);
    }
  };

  // Swipe handlers for weekly slides
  const handleTouchStart = (e) => {
    setTouchStart(e.touches[0].clientX);
  };

  const handleTouchEnd = (e) => {
    if (!touchStart) return;
    const touchEnd = e.changedTouches[0].clientX;
    const diff = touchStart - touchEnd;

    if (Math.abs(diff) > 50) { // Minimum swipe distance
      if (diff > 0 && weeklySlide < 2) {
        setWeeklySlide(weeklySlide + 1); // Swipe left = next slide
        triggerHaptic(ImpactStyle.Light);
      } else if (diff < 0 && weeklySlide > 0) {
        setWeeklySlide(weeklySlide - 1); // Swipe right = prev slide
        triggerHaptic(ImpactStyle.Light);
      }
    }
    setTouchStart(null);
  };

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

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().toLocaleDateString('en-US', { month: 'long' });

  // Get current week date range
  const getWeekDateRange = () => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const formatDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${formatDate(monday)} - ${formatDate(sunday)}`;
  };

  // Streak milestone badges
  const getStreakMilestones = (streak) => {
    const milestones = [];
    if (streak >= 4) milestones.push({ weeks: 4, label: '1 Month', emoji: '🥉' });
    if (streak >= 12) milestones.push({ weeks: 12, label: '3 Months', emoji: '🥈' });
    if (streak >= 26) milestones.push({ weeks: 26, label: '6 Months', emoji: '🥇' });
    if (streak >= 52) milestones.push({ weeks: 52, label: '1 Year', emoji: '💎' });
    return milestones;
  };

  // Next milestone
  const getNextMilestone = (streak) => {
    const milestones = [4, 12, 26, 52, 104];
    for (const m of milestones) {
      if (streak < m) return { target: m, weeksLeft: m - streak };
    }
    return null;
  };

  // Dynamic motivational taglines
  const getMotivationalTagline = (streak, allGoalsMet) => {
    if (allGoalsMet) return "All goals complete ✓";
    if (streak >= 52) return "Legend status achieved!";
    if (streak >= 26) return "Half-year warrior!";
    if (streak >= 12) return "Consistency is key!";
    if (streak >= 4) return "Building the habit!";
    if (streak >= 2) return "Momentum building!";
    return "Earn your streaks.";
  };

  // Analyze weekly activities
  const analyzeWeeklyActivities = (activities) => {
    if (!activities || activities.length === 0) return null;

    // Define workout vs recovery types
    const workoutTypes = ['Strength Training', 'Running', 'Cycle', 'Sports', 'Other'];
    const recoveryTypes = ['Cold Plunge', 'Sauna', 'Yoga', 'Pilates'];

    // Count workouts (strength + cardio)
    const workoutCounts = {};
    const recoveryCounts = {};
    activities.forEach(a => {
      if (workoutTypes.includes(a.type)) {
        workoutCounts[a.type] = (workoutCounts[a.type] || 0) + 1;
      } else if (recoveryTypes.includes(a.type)) {
        recoveryCounts[a.type] = (recoveryCounts[a.type] || 0) + 1;
      }
    });

    const mostCommonWorkout = Object.entries(workoutCounts).sort((a, b) => b[1] - a[1])[0];
    const mostCommonRecovery = Object.entries(recoveryCounts).sort((a, b) => b[1] - a[1])[0];

    // Best single workout (highest calories)
    const bestCalorieWorkout = activities.reduce((best, a) =>
      (parseInt(a.calories) || 0) > (parseInt(best?.calories) || 0) ? a : best
    , null);

    // Longest workout
    const longestWorkout = activities.reduce((longest, a) =>
      (parseInt(a.duration) || 0) > (parseInt(longest?.duration) || 0) ? a : longest
    , null);

    // Longest distance
    const longestDistance = activities.reduce((longest, a) =>
      (parseFloat(a.distance) || 0) > (parseFloat(longest?.distance) || 0) ? a : longest
    , null);

    // Days worked out
    const uniqueDays = new Set(activities.map(a => a.date)).size;

    // Total duration
    const totalMinutes = activities.reduce((sum, a) => sum + (parseInt(a.duration) || 0), 0);

    // Total calories
    const totalCalories = activities.reduce((sum, a) => sum + (parseInt(a.calories) || 0), 0);

    // Total distance
    const totalDistance = activities.reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);

    return {
      mostCommonWorkout: mostCommonWorkout ? { type: mostCommonWorkout[0], count: mostCommonWorkout[1] } : null,
      mostCommonRecovery: mostCommonRecovery ? { type: mostCommonRecovery[0], count: mostCommonRecovery[1] } : null,
      bestCalorieWorkout,
      longestWorkout,
      longestDistance: longestDistance?.distance ? longestDistance : null,
      uniqueDays,
      totalMinutes,
      totalCalories,
      totalDistance,
      totalWorkouts: activities.length
    };
  };

  // Get activity emoji
  const getActivityEmoji = (type) => {
    const emojis = {
      'Strength Training': '🏋️',
      'Running': '🏃',
      'Cycle': '🚴',
      'Sports': '🏀',
      'Cold Plunge': '🧊',
      'Sauna': '🔥',
      'Yoga': '🧘',
      'Pilates': '🤸',
      'Other': '🏊'
    };
    return emojis[type] || '🏊';
  };

  // Card type configurations
  const cardTypes = [
    { id: 'weekly', label: '📅', name: 'My Week' },
    { id: 'records', label: '🏆', name: 'My Records' },
    { id: 'monthly', label: '📊', name: 'My Month' }
  ];

  // Color schemes for each card type
  const colorSchemes = {
    streak: {
      primary: '#00FF94',
      secondary: '#FF9500',
      glow: 'rgba(0, 255, 148, 0.15)',
      shadow: 'rgba(0, 255, 148, 0.25)'
    },
    records: {
      primary: '#FFD700',
      secondary: '#FFA500',
      glow: 'rgba(255, 215, 0, 0.15)',
      shadow: 'rgba(255, 215, 0, 0.25)'
    },
    weekly: {
      primary: '#00FF94',
      secondary: '#00D1FF',
      glow: 'rgba(0, 255, 148, 0.15)',
      shadow: 'rgba(0, 255, 148, 0.25)'
    },
    monthly: {
      primary: '#8B5CF6',
      secondary: '#06B6D4',
      glow: 'rgba(139, 92, 246, 0.15)',
      shadow: 'rgba(139, 92, 246, 0.25)'
    }
  };

  const colors = colorSchemes[cardType];

  // Helper to format pace
  const formatPace = (pace) => {
    if (!pace) return '--:--';
    const mins = Math.floor(pace);
    const secs = Math.round((pace - mins) * 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Helper to get record value
  const getRecordVal = (record) => {
    if (!record) return 0;
    if (typeof record === 'object') return record.value || 0;
    return record;
  };

  // Calculate progress for streak ring
  const streakCount = stats?.streak || 0;
  const progressPercent = Math.min((streakCount / 52) * 100, 100);
  const circumference = 2 * Math.PI * 70;
  const strokeDashoffset = circumference - (progressPercent / 100) * circumference;

  // Render the appropriate card content
  const renderCardContent = () => {
    const isPostFormat = cardFormat === 'post';

    switch (cardType) {
      case 'records':
        const records = stats?.records || {};
        const longestDist = getRecordVal(records.longestDistance);
        return (
          <div className={`relative h-full flex flex-col ${isPostFormat ? 'py-3 px-3' : 'py-4 px-4'}`}>
            {/* Header */}
            <div className="text-center">
              <div className={isPostFormat ? 'text-xl' : 'text-2xl'} style={{ animation: 'pulse-glow 2s ease-in-out infinite' }}>🏆</div>
              <div className={`${isPostFormat ? 'text-[9px]' : 'text-[10px]'} text-gray-500 uppercase tracking-wider mt-0.5`}>Personal Records</div>
              <div className={`font-black ${isPostFormat ? 'text-base' : 'text-lg'}`} style={{ color: colors.primary, textShadow: `0 0 30px ${colors.glow}` }}>Hall of Fame</div>
            </div>

            {/* Content */}
            <div className={`flex-1 flex flex-col justify-center ${isPostFormat ? 'py-1' : 'py-2'}`}>
              {/* Streaks Section */}
              <div className={`w-full ${isPostFormat ? 'py-1.5 px-2' : 'py-2 px-3'} rounded-xl ${isPostFormat ? 'mb-1.5' : 'mb-2'}`} style={{ backgroundColor: 'rgba(255,215,0,0.05)' }}>
                <div className={`${isPostFormat ? 'text-[9px]' : 'text-[10px]'} text-gray-500 uppercase tracking-wider text-center ${isPostFormat ? 'mb-1' : 'mb-1.5'}`}>🔥 Streak Records</div>
                <div className="flex justify-around">
                  <div className="text-center">
                    <div className={`${isPostFormat ? 'text-base' : 'text-lg'} font-black`} style={{ color: colors.primary }}>{records.longestMasterStreak || 0}</div>
                    <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500`}>Master</div>
                  </div>
                  <div className="text-center">
                    <div className={`${isPostFormat ? 'text-base' : 'text-lg'} font-black`} style={{ color: '#00FF94' }}>{records.longestStrengthStreak || 0}</div>
                    <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500`}>Strength</div>
                  </div>
                  <div className="text-center">
                    <div className={`${isPostFormat ? 'text-base' : 'text-lg'} font-black`} style={{ color: '#FF9500' }}>{records.longestCardioStreak || 0}</div>
                    <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500`}>Cardio</div>
                  </div>
                  <div className="text-center">
                    <div className={`${isPostFormat ? 'text-base' : 'text-lg'} font-black`} style={{ color: '#00D1FF' }}>{records.longestRecoveryStreak || 0}</div>
                    <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500`}>Recovery</div>
                  </div>
                </div>
              </div>

              {/* Totals Section */}
              <div className={`w-full ${isPostFormat ? 'py-1.5 px-2' : 'py-3 px-3'} rounded-xl`} style={{ backgroundColor: 'rgba(255,215,0,0.05)' }}>
                <div className={`${isPostFormat ? 'text-[9px]' : 'text-[10px]'} text-gray-500 uppercase tracking-wider text-center ${isPostFormat ? 'mb-1' : 'mb-2'}`}>📊 All-Time Bests</div>
                <div className={`${isPostFormat ? 'space-y-1' : 'space-y-1.5'}`}>
                  <div className="flex justify-between items-center">
                    <span className={`${isPostFormat ? 'text-[11px]' : 'text-[11px]'} text-gray-400`}>🏃 Longest Distance</span>
                    <span className={`font-bold ${isPostFormat ? 'text-[11px]' : 'text-[11px]'}`} style={{ color: colors.primary }}>{longestDist ? `${longestDist.toFixed(2)} mi` : '--'}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className={`${isPostFormat ? 'text-[11px]' : 'text-[11px]'} text-gray-400`}>🏃 Most Runs/Week</span>
                    <span className={`font-bold ${isPostFormat ? 'text-[11px]' : 'text-[11px]'}`} style={{ color: colors.primary }}>{records.mostRunsWeek || 0}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className={`${isPostFormat ? 'text-[11px]' : 'text-[11px]'} text-gray-400`}>🏋️ Most Lifts/Week</span>
                    <span className={`font-bold ${isPostFormat ? 'text-[11px]' : 'text-[11px]'}`} style={{ color: colors.primary }}>{records.mostLiftsWeek || 0}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className={`${isPostFormat ? 'text-[11px]' : 'text-[11px]'} text-gray-400`}>💪 Most Workouts/Week</span>
                    <span className={`font-bold ${isPostFormat ? 'text-[11px]' : 'text-[11px]'}`} style={{ color: colors.primary }}>{records.mostWorkoutsWeek || 0}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className={`${isPostFormat ? 'text-[11px]' : 'text-[11px]'} text-gray-400`}>🧊 Most Recovery/Week</span>
                    <span className={`font-bold ${isPostFormat ? 'text-[11px]' : 'text-[11px]'}`} style={{ color: colors.primary }}>{records.mostRecoveryWeek || 0}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className={`${isPostFormat ? 'text-[11px]' : 'text-[11px]'} text-gray-400`}>🔥 Most Calories/Day</span>
                    <span className={`font-bold ${isPostFormat ? 'text-[11px]' : 'text-[11px]'}`} style={{ color: colors.primary }}>{records.mostCaloriesDay ? records.mostCaloriesDay.toLocaleString() : (getRecordVal(records.highestCalories) || '--')}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className={`${isPostFormat ? 'text-[11px]' : 'text-[11px]'} text-gray-400`}>📍 Most Miles/Week</span>
                    <span className={`font-bold ${isPostFormat ? 'text-[11px]' : 'text-[11px]'}`} style={{ color: colors.primary }}>{records.mostMilesWeek ? `${records.mostMilesWeek.toFixed(1)} mi` : '--'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="text-center mt-1">
              <DaySevenLogo gradient={['#FFD700', '#FFA500']} size="sm" />
              <div className={`${isPostFormat ? 'text-[8px]' : 'text-[8px]'} text-gray-600 tracking-widest uppercase`}>Personal Bests</div>
            </div>
          </div>
        );

      case 'weekly':
        const weeklyLifts = stats?.weeklyLifts || 0;
        const weeklyCardio = stats?.weeklyCardio || 0;
        const weeklyRecovery = stats?.weeklyRecovery || 0;
        const liftsGoal = stats?.liftsGoal || 4;
        const cardioGoal = stats?.cardioGoal || 3;
        const recoveryGoal = stats?.recoveryGoal || 2;
        const liftsGoalMet = weeklyLifts >= liftsGoal;
        const cardioGoalMet = weeklyCardio >= cardioGoal;
        const recoveryGoalMet = weeklyRecovery >= recoveryGoal;
        const allGoalsMet = liftsGoalMet && cardioGoalMet && recoveryGoalMet;

        // Calculate percentages for rings (cap at 100%)
        const liftsPercent = liftsGoal > 0 ? Math.min((weeklyLifts / liftsGoal) * 100, 100) : 0;
        const cardioPercent = cardioGoal > 0 ? Math.min((weeklyCardio / cardioGoal) * 100, 100) : 0;
        const recoveryPercent = recoveryGoal > 0 ? Math.min((weeklyRecovery / recoveryGoal) * 100, 100) : 0;

        // Calculate overall progress (same as home page - cap each at goal)
        const totalGoals = liftsGoal + cardioGoal + recoveryGoal;
        const totalCompleted = Math.min(weeklyLifts, liftsGoal) + Math.min(weeklyCardio, cardioGoal) + Math.min(weeklyRecovery, recoveryGoal);
        const overallPercent = totalGoals > 0 ? Math.round((totalCompleted / totalGoals) * 100) : 0;

        // Ring dimensions for share card
        const ringSize = isPostFormat ? 56 : 64;
        const ringStroke = isPostFormat ? 5 : 5;
        const ringRadius = (ringSize - ringStroke) / 2;
        const ringCircumference = ringRadius * 2 * Math.PI;

        // Analyze weekly activities
        const weeklyAnalysis = analyzeWeeklyActivities(stats?.weeklyActivities);

        // Build achievements list
        const achievements = [];
        if (allGoalsMet) achievements.push({ emoji: '🏆', text: 'All goals completed!' });
        if (weeklyAnalysis?.uniqueDays >= 5) achievements.push({ emoji: '📅', text: `Worked out ${weeklyAnalysis.uniqueDays} days` });
        if (stats?.streak >= 2) achievements.push({ emoji: '🔥', text: `${stats.streak} week streak!` });
        // Show total distance if > 0
        if (weeklyAnalysis?.totalDistance > 0) {
          achievements.push({ emoji: '🏃', text: `${parseFloat(weeklyAnalysis.totalDistance).toFixed(1)}mi run` });
        }
        // Show total calories if > 0
        if (weeklyAnalysis?.totalCalories > 0) {
          achievements.push({ emoji: '🔥', text: `${weeklyAnalysis.totalCalories.toLocaleString()} cal` });
        }
        // Show total hours if >= 1 hour
        if (weeklyAnalysis?.totalMinutes >= 60) {
          achievements.push({ emoji: '⏱️', text: `${Math.round(weeklyAnalysis.totalMinutes / 60)}hrs total` });
        }

        // Slide 1: Progress
        if (weeklySlide === 0) {
          return (
            <div
              className={`relative h-full flex flex-col ${isPostFormat ? 'pt-4 pb-6 px-4' : 'py-5 px-5'}`}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              {/* Main content wrapper */}
              <div className={isPostFormat ? 'flex-1' : ''}>
              {/* Header */}
              <div className={`text-center ${isPostFormat ? '' : 'mt-6'}`}>
                <div className={isPostFormat ? 'text-2xl' : 'text-3xl'} style={{ animation: 'pulse-glow 2s ease-in-out infinite' }}>📅</div>
                <div className={`${isPostFormat ? 'text-xs' : 'text-xs'} text-gray-500 uppercase tracking-wider mt-1.5`}>{getWeekDateRange()}</div>
                <div className={`font-black ${isPostFormat ? 'text-2xl' : 'text-2xl'}`} style={{ color: allGoalsMet ? colors.primary : 'white' }}>
                  {allGoalsMet ? 'Week Streaked!' : `${overallPercent}% Complete`}
                </div>
                <div className={`${isPostFormat ? 'text-xs' : 'text-xs'} text-gray-400 mt-0.5`}>{getMotivationalTagline(stats?.streak || 0, allGoalsMet)}</div>
              </div>

              {/* Content */}
              <div className={`${isPostFormat ? 'flex-none py-2' : 'flex-1 pt-3 pb-4'} flex flex-col justify-center`}>
                {/* Progress bar */}
                <div className={`w-full ${isPostFormat ? 'mb-4' : 'mb-5'}`}>
                  <div className={`${isPostFormat ? 'h-2' : 'h-2'} rounded-full overflow-hidden flex`} style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    {weeklyLifts > 0 && (
                      <div className="h-full transition-all duration-500" style={{ width: `${(Math.min(weeklyLifts, liftsGoal) / totalGoals) * 100}%`, backgroundColor: '#00FF94' }} />
                    )}
                    {weeklyCardio > 0 && (
                      <div className="h-full transition-all duration-500" style={{ width: `${(Math.min(weeklyCardio, cardioGoal) / totalGoals) * 100}%`, backgroundColor: '#FF9500' }} />
                    )}
                    {weeklyRecovery > 0 && (
                      <div className="h-full transition-all duration-500" style={{ width: `${(Math.min(weeklyRecovery, recoveryGoal) / totalGoals) * 100}%`, backgroundColor: '#00D1FF' }} />
                    )}
                  </div>
                </div>

                {/* Goal Rings */}
                <div className={`w-full flex items-center ${isPostFormat ? 'justify-center gap-6' : 'justify-around'} ${isPostFormat ? 'mb-4' : 'mb-5'}`}>
                  <div className="flex flex-col items-center text-center">
                    <div className="relative">
                      <svg width={ringSize} height={ringSize} className="transform -rotate-90 block">
                        <circle cx={ringSize/2} cy={ringSize/2} r={ringRadius} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={ringStroke} />
                        <circle cx={ringSize/2} cy={ringSize/2} r={ringRadius} fill="none" stroke="#00FF94" strokeWidth={ringStroke} strokeLinecap="round"
                          strokeDasharray={ringCircumference} strokeDashoffset={ringCircumference - (liftsPercent / 100) * ringCircumference} />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span className={`${isPostFormat ? 'text-sm' : 'text-sm'} font-black`} style={{ lineHeight: 1 }}>{weeklyLifts}/{liftsGoal}</span>
                      </div>
                    </div>
                    <div className={`${isPostFormat ? 'text-xs' : 'text-xs'} text-gray-400 mt-1`} style={{ lineHeight: '1.2', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px' }}><span style={{ fontSize: '0.9em' }}>🏋️</span><span>Strength</span></div>
                  </div>
                  <div className="flex flex-col items-center text-center">
                    <div className="relative">
                      <svg width={ringSize} height={ringSize} className="transform -rotate-90 block">
                        <circle cx={ringSize/2} cy={ringSize/2} r={ringRadius} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={ringStroke} />
                        <circle cx={ringSize/2} cy={ringSize/2} r={ringRadius} fill="none" stroke="#FF9500" strokeWidth={ringStroke} strokeLinecap="round"
                          strokeDasharray={ringCircumference} strokeDashoffset={ringCircumference - (cardioPercent / 100) * ringCircumference} />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span className={`${isPostFormat ? 'text-sm' : 'text-sm'} font-black`} style={{ lineHeight: 1 }}>{weeklyCardio}/{cardioGoal}</span>
                      </div>
                    </div>
                    <div className={`${isPostFormat ? 'text-xs' : 'text-xs'} text-gray-400 mt-1`} style={{ lineHeight: '1.2', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px' }}><span style={{ fontSize: '0.9em' }}>🏃</span><span>Cardio</span></div>
                  </div>
                  <div className="flex flex-col items-center text-center">
                    <div className="relative">
                      <svg width={ringSize} height={ringSize} className="transform -rotate-90 block">
                        <circle cx={ringSize/2} cy={ringSize/2} r={ringRadius} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={ringStroke} />
                        <circle cx={ringSize/2} cy={ringSize/2} r={ringRadius} fill="none" stroke="#00D1FF" strokeWidth={ringStroke} strokeLinecap="round"
                          strokeDasharray={ringCircumference} strokeDashoffset={ringCircumference - (recoveryPercent / 100) * ringCircumference} />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span className={`${isPostFormat ? 'text-sm' : 'text-sm'} font-black`} style={{ lineHeight: 1 }}>{weeklyRecovery}/{recoveryGoal}</span>
                      </div>
                    </div>
                    <div className={`${isPostFormat ? 'text-xs' : 'text-xs'} text-gray-400 mt-1`} style={{ lineHeight: '1.2', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px' }}><span style={{ fontSize: '0.9em' }}>🧊</span><span>Recovery</span></div>
                  </div>
                </div>

                {/* Streaks */}
                <div className={`w-full ${isPostFormat ? 'py-2 px-3' : 'py-3 px-4'} rounded-2xl`} style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                  <div className="w-full" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    <span className={isPostFormat ? 'text-lg' : 'text-xl'} style={{ lineHeight: '1.2' }}>🔥</span>
                    <span className={`${isPostFormat ? 'text-xl' : 'text-2xl'} font-black`} style={{ color: '#00FF94', lineHeight: '1.2' }}>{stats?.streak || 0}</span>
                    <span className={`${isPostFormat ? 'text-[11px]' : 'text-xs'} text-gray-400`} style={{ lineHeight: '1.2' }}>weeks hitting all goals</span>
                  </div>
                  <div className={`w-full h-px ${isPostFormat ? 'my-1.5' : 'my-3'}`} style={{ backgroundColor: 'rgba(255,255,255,0.05)' }} />
                  <div className="w-full" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div className={`${isPostFormat ? 'text-[15px]' : 'text-base'} font-bold`} style={{ color: '#00FF94', lineHeight: '1.2' }}>{stats?.strengthStreak || 0}</div>
                      <div className={`${isPostFormat ? 'text-[10px]' : 'text-xs'} text-gray-500 mt-0.5`} style={{ lineHeight: '1.2', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px' }}><span style={{ fontSize: '0.9em' }}>🏋️</span><span>weeks</span></div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div className={`${isPostFormat ? 'text-[15px]' : 'text-base'} font-bold`} style={{ color: '#FF9500', lineHeight: '1.2' }}>{stats?.cardioStreak || 0}</div>
                      <div className={`${isPostFormat ? 'text-[10px]' : 'text-xs'} text-gray-500 mt-0.5`} style={{ lineHeight: '1.2', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px' }}><span style={{ fontSize: '0.9em' }}>🏃</span><span>weeks</span></div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div className={`${isPostFormat ? 'text-[15px]' : 'text-base'} font-bold`} style={{ color: '#00D1FF', lineHeight: '1.2' }}>{stats?.recoveryStreak || 0}</div>
                      <div className={`${isPostFormat ? 'text-[10px]' : 'text-xs'} text-gray-500 mt-0.5`} style={{ lineHeight: '1.2', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px' }}><span style={{ fontSize: '0.9em' }}>🧊</span><span>weeks</span></div>
                    </div>
                  </div>
                </div>
              </div>
              </div>

              {/* Footer */}
              <div className={`text-center ${isPostFormat ? 'mt-0' : 'mt-1'}`}>
                <DaySevenLogo gradient={['#00FF94', '#00D1FF']} size={isPostFormat ? 'base' : 'base'} />
                <div className={`${isPostFormat ? 'text-[10px] -mt-0.5' : 'text-[10px]'} text-gray-600 tracking-widest uppercase`}>Weekly Recap</div>
              </div>
            </div>
          );
        }

        // Slide 2: Highlights & Achievements
        if (weeklySlide === 1) {
        return (
          <div
            className={`relative h-full flex flex-col items-center justify-between ${isPostFormat ? 'py-4 px-4' : 'py-6 px-5'}`}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <div className={isPostFormat ? 'text-2xl' : 'text-3xl'} style={{ animation: 'pulse-glow 2s ease-in-out infinite' }}>⭐</div>
            <div className="flex-1 flex flex-col items-center justify-center w-full overflow-hidden">
              <div className={`text-center ${isPostFormat ? 'mb-2' : 'mb-3'}`}>
                <div className={`${isPostFormat ? 'text-[10px]' : 'text-xs'} text-gray-500 uppercase tracking-wider mb-0.5`}>{getWeekDateRange()}</div>
                <div className={`font-black ${isPostFormat ? 'text-lg' : 'text-xl'}`} style={{ color: colors.primary }}>Week Highlights</div>
              </div>

              {/* Achievements as simple list */}
              {achievements.length > 0 && (
                <div className={`w-full ${isPostFormat ? 'mb-2' : 'mb-3'} text-center`}>
                  <div className={`flex flex-wrap justify-center ${isPostFormat ? 'gap-x-1.5 gap-y-0.5' : 'gap-x-2 gap-y-1'}`}>
                    {achievements.slice(0, 4).map((a, i) => (
                      <span key={i} className={`${isPostFormat ? 'text-[10px]' : 'text-xs'} text-gray-300`}>
                        {a.emoji} {a.text}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Best workout & longest distance in compact grid */}
              <div className={`w-full grid grid-cols-2 ${isPostFormat ? 'gap-1.5 mb-2' : 'gap-2 mb-3'}`}>
                {/* Best workout */}
                {weeklyAnalysis?.bestCalorieWorkout && (
                  <div className={`${isPostFormat ? 'p-2' : 'p-2.5'} rounded-xl text-center`} style={{ backgroundColor: 'rgba(255,149,0,0.08)' }}>
                    <div className={`${isPostFormat ? 'text-[9px]' : 'text-[10px]'} text-gray-500 uppercase mb-0.5`}>Best Burn</div>
                    <div className={isPostFormat ? 'text-base' : 'text-lg'}>{getActivityEmoji(weeklyAnalysis.bestCalorieWorkout.type)}</div>
                    <div className={`${isPostFormat ? 'text-sm' : 'text-base'} font-black`} style={{ color: '#FF9500' }}>{parseInt(weeklyAnalysis.bestCalorieWorkout.calories).toLocaleString()}</div>
                    <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500`}>calories</div>
                  </div>
                )}
                {/* Longest distance or longest workout */}
                {weeklyAnalysis?.longestDistance && parseFloat(weeklyAnalysis.longestDistance.distance) > 0 ? (
                  <div className={`${isPostFormat ? 'p-2' : 'p-2.5'} rounded-xl text-center`} style={{ backgroundColor: 'rgba(0,209,255,0.08)' }}>
                    <div className={`${isPostFormat ? 'text-[9px]' : 'text-[10px]'} text-gray-500 uppercase mb-0.5`}>Longest Run</div>
                    <div className={isPostFormat ? 'text-base' : 'text-lg'}>{getActivityEmoji(weeklyAnalysis.longestDistance.type)}</div>
                    <div className={`${isPostFormat ? 'text-sm' : 'text-base'} font-black`} style={{ color: '#00D1FF' }}>{parseFloat(weeklyAnalysis.longestDistance.distance).toFixed(2)}</div>
                    <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500`}>miles</div>
                  </div>
                ) : weeklyAnalysis?.longestWorkout && (
                  <div className={`${isPostFormat ? 'p-2' : 'p-2.5'} rounded-xl text-center`} style={{ backgroundColor: 'rgba(0,255,148,0.08)' }}>
                    <div className={`${isPostFormat ? 'text-[9px]' : 'text-[10px]'} text-gray-500 uppercase mb-0.5`}>Longest Session</div>
                    <div className={isPostFormat ? 'text-base' : 'text-lg'}>{getActivityEmoji(weeklyAnalysis.longestWorkout.type)}</div>
                    <div className={`${isPostFormat ? 'text-sm' : 'text-base'} font-black`} style={{ color: '#00FF94' }}>{weeklyAnalysis.longestWorkout.duration}</div>
                    <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500`}>minutes</div>
                  </div>
                )}
              </div>

              {/* Week summary stats */}
              <div className={`w-full grid grid-cols-3 ${isPostFormat ? 'gap-1.5 mb-2' : 'gap-2 mb-3'}`}>
                <div className={`text-center ${isPostFormat ? 'p-1.5' : 'p-2'} rounded-xl`} style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                  <div className={`${isPostFormat ? 'text-sm' : 'text-base'} font-bold text-white`}>{weeklyAnalysis?.totalWorkouts || 0}</div>
                  <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500`}>Workouts</div>
                </div>
                <div className={`text-center ${isPostFormat ? 'p-1.5' : 'p-2'} rounded-xl`} style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                  <div className={`${isPostFormat ? 'text-sm' : 'text-base'} font-bold text-white`}>{weeklyAnalysis?.uniqueDays || 0}</div>
                  <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500`}>Days Active</div>
                </div>
                <div className={`text-center ${isPostFormat ? 'p-1.5' : 'p-2'} rounded-xl`} style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                  <div className={`${isPostFormat ? 'text-sm' : 'text-base'} font-bold text-white`}>{weeklyAnalysis?.totalMinutes ? Math.round(weeklyAnalysis.totalMinutes / 60) : 0}h</div>
                  <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500`}>Total Time</div>
                </div>
              </div>

              {/* Records broken this week - capped at 3, prioritized by impressiveness */}
              {(() => {
                const records = stats?.records || {};
                const weeklyPRs = [];

                // Check if weekly bests match all-time records (meaning PR was set this week)
                // Priority: higher = more impressive (calories and distance are most shareable)
                if (weeklyAnalysis?.bestCalorieWorkout &&
                    parseInt(weeklyAnalysis.bestCalorieWorkout.calories) === getRecordVal(records.highestCalories)) {
                  weeklyPRs.push({ label: 'Highest Calories', value: parseInt(weeklyAnalysis.bestCalorieWorkout.calories).toLocaleString(), priority: 5 });
                }
                if (weeklyAnalysis?.longestDistance &&
                    parseFloat(weeklyAnalysis.longestDistance.distance) === getRecordVal(records.longestDistance)) {
                  weeklyPRs.push({ label: 'Longest Distance', value: `${parseFloat(weeklyAnalysis.longestDistance.distance).toFixed(2)}mi`, priority: 4 });
                }
                if ((stats?.weeklyMiles || 0) === getRecordVal(records.mostMilesWeek) && (stats?.weeklyMiles || 0) > 0) {
                  weeklyPRs.push({ label: 'Most Miles/Week', value: `${(stats?.weeklyMiles || 0).toFixed(1)}mi`, priority: 3 });
                }
                if ((weeklyAnalysis?.totalWorkouts || 0) === getRecordVal(records.mostWorkoutsWeek) && (weeklyAnalysis?.totalWorkouts || 0) > 0) {
                  weeklyPRs.push({ label: 'Most Workouts/Week', value: weeklyAnalysis.totalWorkouts, priority: 2 });
                }
                if (weeklyAnalysis?.longestWorkout &&
                    parseInt(weeklyAnalysis.longestWorkout.duration) === getRecordVal(records.longestStrength)) {
                  weeklyPRs.push({ label: 'Longest Strength', value: `${weeklyAnalysis.longestWorkout.duration}min`, priority: 1 });
                }

                if (weeklyPRs.length === 0) return null;

                // Sort by priority (highest first) and take top 3
                const topPRs = weeklyPRs.sort((a, b) => b.priority - a.priority).slice(0, 3);

                return (
                  <div className="w-full">
                    <div className={`${isPostFormat ? 'text-[9px]' : 'text-[10px]'} text-gray-500 uppercase text-center mb-1`}>Records Set This Week</div>
                    <div className={`flex flex-wrap justify-center ${isPostFormat ? 'gap-1' : 'gap-1.5'}`}>
                      {topPRs.map((pr, i) => (
                        <div key={i} className={`${isPostFormat ? 'px-1.5 py-0.5' : 'px-2 py-0.5'} rounded-full ${isPostFormat ? 'text-[8px]' : 'text-[9px]'}`} style={{ backgroundColor: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.3)' }}>
                          <span style={{ color: '#FFD700' }}>🏆 {pr.label}: {pr.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="text-center mt-auto w-full">
              <DaySevenLogo gradient={['#00FF94', '#00D1FF']} size={isPostFormat ? 'sm' : 'base'} />
              <div className={`${isPostFormat ? 'text-[9px]' : 'text-[10px]'} text-gray-600 tracking-widest uppercase -mt-0.5`}>Week Highlights</div>
            </div>
          </div>
        );
        }

        // Slide 3: Streaks
        return (
          <div
            className={`relative h-full flex flex-col items-center justify-between ${isPostFormat ? 'py-4 px-4' : 'py-5 px-5'}`}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <div className="flex-1 flex flex-col items-center justify-center w-full">
              {/* Main master streak number */}
              <div className="text-center">
                <div className="font-black leading-none" style={{ fontSize: isPostFormat ? '3rem' : '4rem', color: colors.primary, textShadow: `0 0 40px ${colors.glow}, 0 0 80px ${colors.glow}`, animation: 'ring-pulse 3s ease-in-out infinite' }}>
                  {stats?.streak || 0}
                </div>
                <div className={`${isPostFormat ? 'text-[10px]' : 'text-xs'} font-semibold tracking-widest text-gray-400 uppercase mt-1`}>🔥 Master Streak</div>
                <div className={`${isPostFormat ? 'text-[9px]' : 'text-[10px]'} text-gray-500`}>weeks hitting all goals</div>
              </div>

              {/* Active Streaks */}
              <div className={`w-full ${isPostFormat ? 'p-2' : 'p-2.5'} rounded-xl ${isPostFormat ? 'mt-3' : 'mt-4'}`} style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                <div className="flex items-center justify-center mb-1">
                  <span className={`${isPostFormat ? 'text-[9px]' : 'text-[10px]'} text-gray-400 uppercase tracking-wider`}>Active Streaks</span>
                </div>
                <div className={`w-full h-px ${isPostFormat ? 'mb-1.5' : 'mb-2'}`} style={{ backgroundColor: 'rgba(255,255,255,0.05)' }} />
                <div className="flex justify-around">
                  <div className="text-center">
                    <div className={`${isPostFormat ? 'text-sm' : 'text-base'} font-bold`} style={{ color: '#00FF94' }}>{stats?.strengthStreak || 0}</div>
                    <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500`}>🏋️ weeks</div>
                  </div>
                  <div className="text-center">
                    <div className={`${isPostFormat ? 'text-sm' : 'text-base'} font-bold`} style={{ color: '#FF9500' }}>{stats?.cardioStreak || 0}</div>
                    <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500`}>🏃 weeks</div>
                  </div>
                  <div className="text-center">
                    <div className={`${isPostFormat ? 'text-sm' : 'text-base'} font-bold`} style={{ color: '#00D1FF' }}>{stats?.recoveryStreak || 0}</div>
                    <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500`}>🧊 weeks</div>
                  </div>
                </div>
              </div>

              {/* Streak Records */}
              <div className={`w-full ${isPostFormat ? 'p-2' : 'p-2.5'} rounded-xl ${isPostFormat ? 'mt-2' : 'mt-2.5'}`} style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                <div className="flex items-center justify-center mb-1">
                  <span className={`${isPostFormat ? 'text-[9px]' : 'text-[10px]'} text-gray-400 uppercase tracking-wider`}>Streak Records</span>
                </div>
                <div className={`w-full h-px ${isPostFormat ? 'mb-1.5' : 'mb-2'}`} style={{ backgroundColor: 'rgba(255,255,255,0.05)' }} />
                <div className="flex justify-around">
                  <div className="text-center">
                    <div className={`${isPostFormat ? 'text-sm' : 'text-base'} font-bold`} style={{ color: '#00FF94' }}>{stats?.longestStrengthStreak || 0}</div>
                    <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500`}>🏋️ weeks</div>
                  </div>
                  <div className="text-center">
                    <div className={`${isPostFormat ? 'text-sm' : 'text-base'} font-bold`} style={{ color: '#FF9500' }}>{stats?.longestCardioStreak || 0}</div>
                    <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500`}>🏃 weeks</div>
                  </div>
                  <div className="text-center">
                    <div className={`${isPostFormat ? 'text-sm' : 'text-base'} font-bold`} style={{ color: '#00D1FF' }}>{stats?.longestRecoveryStreak || 0}</div>
                    <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500`}>🧊 weeks</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom stats */}
            <div className={`w-full ${isPostFormat ? 'mt-2' : 'mt-2.5'}`}>
              <div className={`grid grid-cols-2 ${isPostFormat ? 'gap-1.5 p-2' : 'gap-2 p-2.5'} rounded-xl ${isPostFormat ? 'mb-1.5' : 'mb-2'}`} style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                <div className="text-center">
                  <div className={`${isPostFormat ? 'text-base' : 'text-xl'} font-black text-white`}>{stats?.longestStreak || stats?.streak || 0}</div>
                  <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500 uppercase`}>Streak Record</div>
                </div>
                <div className="text-center">
                  <div className={`${isPostFormat ? 'text-base' : 'text-xl'} font-black text-white`}>{stats?.weeksWon || 0}</div>
                  <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500 uppercase`}>Weeks Won</div>
                </div>
              </div>
              <div className={`text-center ${isPostFormat ? '-mt-0.5' : 'mt-0.5'}`}>
                <DaySevenLogo gradient={['#ffffff', '#888888']} size={isPostFormat ? 'sm' : 'base'} />
                <div className={`${isPostFormat ? 'text-[9px]' : 'text-[10px]'} text-gray-600 tracking-widest uppercase -mt-0.5`}>Streak Stats</div>
              </div>
            </div>
          </div>
        );

      case 'monthly':
        const monthlyWorkouts = stats?.monthlyWorkouts || 0;
        const avgPerWeek = monthlyWorkouts > 0 ? (monthlyWorkouts / 4).toFixed(1) : 0;
        const daysIntoMonth = new Date().getDate();
        const workoutsPerDay = monthlyWorkouts > 0 ? (monthlyWorkouts / daysIntoMonth).toFixed(2) : 0;
        return (
          <div className={`relative h-full flex flex-col items-center justify-between ${isPostFormat ? 'py-4 px-4' : 'py-6 px-5'}`}>
            <div className={isPostFormat ? 'text-2xl' : 'text-3xl'} style={{ animation: 'pulse-glow 2s ease-in-out infinite' }}>📊</div>
            <div className="flex-1 flex flex-col items-center justify-center w-full">
              <div className={`text-center ${isPostFormat ? 'mb-2' : 'mb-3'}`}>
                <div className={`${isPostFormat ? 'text-[10px]' : 'text-xs'} text-gray-500 uppercase tracking-wider mb-1`}>{currentMonth} {currentYear}</div>
                <div className={`font-black ${isPostFormat ? 'text-xl' : 'text-2xl'}`} style={{ color: colors.primary, textShadow: `0 0 30px ${colors.glow}` }}>Monthly Recap</div>
              </div>
              <div className={`w-full ${isPostFormat ? 'space-y-2' : 'space-y-3'}`}>
                <div className={`text-center ${isPostFormat ? 'p-2.5' : 'p-4'} rounded-2xl`} style={{ backgroundColor: 'rgba(139,92,246,0.1)' }}>
                  <div className={`${isPostFormat ? 'text-2xl' : 'text-4xl'} font-black`} style={{ color: colors.primary }}>{monthlyWorkouts}</div>
                  <div className={`${isPostFormat ? 'text-[10px]' : 'text-xs'} text-gray-400 uppercase tracking-wider mt-0.5`}>Workouts Completed</div>
                  <div className={`${isPostFormat ? 'text-[9px]' : 'text-[10px]'} text-gray-500 mt-0.5`}>~{avgPerWeek} per week</div>
                </div>
                <div className={`grid grid-cols-2 ${isPostFormat ? 'gap-1.5' : 'gap-2'}`}>
                  <div className={`text-center ${isPostFormat ? 'p-2' : 'p-3'} rounded-xl`} style={{ backgroundColor: 'rgba(139,92,246,0.05)' }}>
                    <div className={`${isPostFormat ? 'text-lg' : 'text-2xl'} font-bold`} style={{ color: colors.secondary }}>{(stats?.monthlyCalories || 0).toLocaleString()}</div>
                    <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500`}>🔥 Calories</div>
                  </div>
                  <div className={`text-center ${isPostFormat ? 'p-2' : 'p-3'} rounded-xl`} style={{ backgroundColor: 'rgba(139,92,246,0.05)' }}>
                    <div className={`${isPostFormat ? 'text-lg' : 'text-2xl'} font-bold`} style={{ color: colors.secondary }}>{(stats?.monthlyMiles || 0).toFixed(1)}</div>
                    <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500`}>🏃 Miles</div>
                  </div>
                </div>
                <div className={`grid grid-cols-2 ${isPostFormat ? 'gap-1.5' : 'gap-2'}`}>
                  <div className={`text-center ${isPostFormat ? 'p-2' : 'p-3'} rounded-xl`} style={{ backgroundColor: 'rgba(139,92,246,0.05)' }}>
                    <div className={`${isPostFormat ? 'text-base' : 'text-xl'} font-bold text-white`}>{stats?.streak || 0}</div>
                    <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500`}>🔥 Week Streak</div>
                  </div>
                  <div className={`text-center ${isPostFormat ? 'p-2' : 'p-3'} rounded-xl`} style={{ backgroundColor: 'rgba(139,92,246,0.05)' }}>
                    <div className={`${isPostFormat ? 'text-base' : 'text-xl'} font-bold text-white`}>{daysIntoMonth}</div>
                    <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500`}>📅 Days In</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="text-center mt-auto w-full mt-1">
              <DaySevenLogo gradient={['#8B5CF6', '#06B6D4']} size={isPostFormat ? 'sm' : 'base'} />
              <div className={`${isPostFormat ? 'text-[9px]' : 'text-[10px]'} text-gray-600 tracking-widest uppercase -mt-0.5`}>Monthly Stats</div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center transition-all duration-300 p-4"
      style={{ backgroundColor: isAnimating ? 'rgba(0,0,0,0.95)' : 'rgba(0,0,0,0)' }}
      onClick={(e) => e.target === e.currentTarget && handleClose()}
    >
      <div
        className="w-full max-w-md transition-all duration-500 ease-out"
        style={{
          transform: isAnimating ? 'scale(1) translateY(0)' : 'scale(0.8) translateY(50px)',
          opacity: isAnimating ? 1 : 0
        }}
      >
        {/* Card Type Tabs */}
        <div className={`flex gap-1.5 p-1.5 rounded-2xl ${isMobile ? 'mb-3' : 'mb-5'}`} style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
          {cardTypes.map((type) => (
            <button
              key={type.id}
              onClick={() => setCardType(type.id)}
              className={`flex-1 ${isMobile ? 'py-2 px-1.5' : 'py-3 px-2'} rounded-xl text-center transition-all duration-200`}
              style={{
                backgroundColor: cardType === type.id ? colorSchemes[type.id].primary + '20' : 'transparent',
                color: cardType === type.id ? colorSchemes[type.id].primary : 'rgba(255,255,255,0.5)'
              }}
            >
              <div className={isMobile ? 'text-base' : 'text-xl'}>{type.label}</div>
              <div className={`${isMobile ? 'text-[8px]' : 'text-[10px]'} font-medium`}>{type.name}</div>
            </button>
          ))}
        </div>

        {/* Card Preview Container */}
        <div
          className="relative mb-4 flex justify-center"
          style={{
            height: cardFormat === 'story'
              ? (isMobile ? '460px' : '520px')
              : (isMobile ? '390px' : '440px'),
            transition: 'height 0.3s ease'
          }}
        >
          {/* Actual card that gets captured */}
          <div
            ref={cardRef}
            className="absolute rounded-2xl overflow-hidden transition-all duration-300"
            style={{
              width: cardFormat === 'story' ? '270px' : '320px',
              height: cardFormat === 'story' ? '480px' : '400px',
              transform: cardFormat === 'story'
                ? (isMobile ? 'scale(0.93)' : 'scale(1.08)')
                : (isMobile ? 'scale(0.95)' : 'scale(1.1)'),
              transformOrigin: 'top center',
              background: 'linear-gradient(180deg, #0a0a0a 0%, #0d0d0d 50%, #000000 100%)',
              boxShadow: `0 25px 50px -12px ${colors.shadow}, 0 0 100px ${colors.glow}`
            }}
          >
            {/* Aurora/Glow Effect */}
            <div
              className="absolute top-0 left-0 right-0 h-1/2"
              style={{
                background: `radial-gradient(ellipse 80% 50% at 50% 0%, ${colors.glow} 0%, ${colors.glow.replace('0.15', '0.05')} 40%, transparent 70%)`,
                pointerEvents: 'none'
              }}
            />

          {/* Shimmer Effect */}
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.03) 45%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.03) 55%, transparent 60%)',
              animation: 'shimmer 3s infinite',
              pointerEvents: 'none'
            }}
          />
          <style>{`
            @keyframes shimmer {
              0% { transform: translateX(-100%); }
              100% { transform: translateX(100%); }
            }
            @keyframes pulse-glow {
              0%, 100% { opacity: 0.5; }
              50% { opacity: 1; }
            }
            @keyframes ring-pulse {
              0%, 100% { transform: scale(1); opacity: 1; }
              50% { transform: scale(1.02); opacity: 0.8; }
            }
          `}</style>

            {/* Card Content */}
            {renderCardContent()}
          </div>
        </div>

        {/* Weekly Slide Navigation */}
        {cardType === 'weekly' && (
          <div className="flex justify-center gap-2 mb-4">
            <button onClick={() => setWeeklySlide(0)} className="w-2.5 h-2.5 rounded-full transition-all" style={{ backgroundColor: weeklySlide === 0 ? '#00FF94' : 'rgba(255,255,255,0.2)' }} />
            <button onClick={() => setWeeklySlide(1)} className="w-2.5 h-2.5 rounded-full transition-all" style={{ backgroundColor: weeklySlide === 1 ? '#00FF94' : 'rgba(255,255,255,0.2)' }} />
            <button onClick={() => setWeeklySlide(2)} className="w-2.5 h-2.5 rounded-full transition-all" style={{ backgroundColor: weeklySlide === 2 ? '#00FF94' : 'rgba(255,255,255,0.2)' }} />
          </div>
        )}

        {/* Format Selection */}
        <div className="flex justify-center gap-4 mb-4">
          <button
            className="flex items-center gap-2.5 px-5 py-2.5 rounded-full transition-all duration-200"
            style={{
              backgroundColor: cardFormat === 'story' ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)',
              border: cardFormat === 'story' ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(255,255,255,0.1)'
            }}
            onClick={() => { setCardFormat('story'); triggerHaptic(ImpactStyle.Light); }}
          >
            <svg width="14" height="21" viewBox="0 0 16 24" fill="none">
              <defs>
                <linearGradient id="igGradientStory" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#F58529" />
                  <stop offset="50%" stopColor="#DD2A7B" />
                  <stop offset="100%" stopColor="#515BD4" />
                </linearGradient>
              </defs>
              <rect x="1" y="1" width="14" height="22" rx="3" stroke={cardFormat === 'story' ? 'url(#igGradientStory)' : 'rgba(255,255,255,0.5)'} strokeWidth="1.5"/>
            </svg>
            <span className={`text-sm font-medium ${cardFormat === 'story' ? 'text-white' : 'text-gray-500'}`}>Story</span>
          </button>
          <button
            className="flex items-center gap-2.5 px-5 py-2.5 rounded-full transition-all duration-200"
            style={{
              backgroundColor: cardFormat === 'post' ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)',
              border: cardFormat === 'post' ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(255,255,255,0.1)'
            }}
            onClick={() => { setCardFormat('post'); triggerHaptic(ImpactStyle.Light); }}
          >
            <svg width="16" height="19" viewBox="0 0 20 24" fill="none">
              <defs>
                <linearGradient id="igGradientPost" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#F58529" />
                  <stop offset="50%" stopColor="#DD2A7B" />
                  <stop offset="100%" stopColor="#515BD4" />
                </linearGradient>
              </defs>
              <rect x="1" y="2" width="18" height="20" rx="3" stroke={cardFormat === 'post' ? 'url(#igGradientPost)' : 'rgba(255,255,255,0.5)'} strokeWidth="1.5"/>
            </svg>
            <span className={`text-sm font-medium ${cardFormat === 'post' ? 'text-white' : 'text-gray-500'}`}>Post</span>
          </button>
        </div>

        {/* Share and Save Buttons */}
        <div className="flex justify-center gap-3 mb-3">
          <button
            className="flex items-center justify-center gap-2.5 px-8 py-3.5 rounded-xl font-semibold active:scale-[0.98]"
            style={{
              background: 'linear-gradient(135deg, #E1306C 0%, #833AB4 50%, #405DE6 100%)',
              opacity: (isSharing || isSaving) ? 0.7 : 1,
              pointerEvents: (isSharing || isSaving) ? 'none' : 'auto',
              minWidth: '160px'
            }}
            onClick={executeShare}
            disabled={isSharing || isSaving}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3"/>
              <circle cx="6" cy="12" r="3"/>
              <circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
            <span className="text-white text-base">Share {cardFormat === 'story' ? 'Story' : 'Post'}</span>
          </button>
          <button
            className="flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl font-medium"
            style={{
              backgroundColor: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.1)',
              opacity: (isSharing || isSaving) ? 0.5 : 1,
              pointerEvents: (isSharing || isSaving) ? 'none' : 'auto',
              minWidth: '100px'
            }}
            onClick={handleSaveImage}
            disabled={isSharing || isSaving}
          >
            {isSaving ? (
              <div className="w-[18px] h-[18px] border-2 border-white/30 border-t-white rounded-full animate-spin flex-shrink-0" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            )}
            <span className="text-gray-300 text-base whitespace-nowrap">{isSaving ? 'Saving...' : 'Save'}</span>
          </button>
        </div>

        {/* Close Button */}
        <button
          onClick={handleClose}
          className="w-full py-3 font-medium text-gray-500 text-base"
        >
          Close
        </button>
      </div>
    </div>
  );
};

// Change Password Modal
const ChangePasswordModal = ({ isOpen, onClose, user }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsClosing(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setError('');
      setSuccess(false);
      setTimeout(() => setIsAnimating(true), 10);
    } else {
      setIsAnimating(false);
    }
  }, [isOpen]);

  const handleClose = () => {
    setIsClosing(true);
    setIsAnimating(false);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 300);
  };

  const handleChangePassword = async () => {
    setError('');

    // Validation
    if (!currentPassword) {
      setError('Please enter your current password');
      return;
    }
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    setIsLoading(true);
    try {
      if (Capacitor.isNativePlatform()) {
        // Use Capacitor Firebase plugin for native platforms
        const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');

        // Re-authenticate by signing in again with current password
        await FirebaseAuthentication.signInWithEmailAndPassword({
          email: user.email,
          password: currentPassword
        });

        // Update password using native plugin
        await FirebaseAuthentication.updatePassword({
          newPassword: newPassword
        });
      } else {
        // Use web SDK for browser
        const credential = EmailAuthProvider.credential(user.email, currentPassword);
        await reauthenticateWithCredential(auth.currentUser, credential);
        await updatePassword(auth.currentUser, newPassword);
      }

      setSuccess(true);
      triggerHaptic(ImpactStyle.Medium);

      // Close modal after showing success
      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch (err) {
      console.error('Password change error:', err);
      const errorCode = err.code || err.message || '';
      if (errorCode.includes('wrong-password') || errorCode.includes('invalid-credential') || errorCode.includes('INVALID_LOGIN_CREDENTIALS')) {
        setError('Current password is incorrect');
      } else if (errorCode.includes('weak-password')) {
        setError('New password is too weak. Please use a stronger password.');
      } else if (errorCode.includes('requires-recent-login')) {
        setError('Please sign out and sign back in, then try again.');
      } else {
        setError('Failed to change password. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen && !isClosing) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end justify-center transition-all duration-300 ${
        isAnimating && !isClosing ? 'bg-black/60' : 'bg-black/0'
      }`}
      onClick={handleClose}
    >
      <div
        className={`w-full max-w-lg rounded-t-3xl transition-all duration-300 ${
          isAnimating && !isClosing ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{
          backgroundColor: '#1a1a1a',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-gray-600" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pb-4">
          <h2 className="text-xl font-bold text-white">Change Password</h2>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
          >
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 pb-6">
          {success ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-white font-medium">Password changed successfully!</p>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Current Password</label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-black/30 border border-zinc-700 text-white placeholder-gray-500 focus:outline-none focus:border-[#00FF94]"
                    placeholder="Enter current password"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-2">New Password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-black/30 border border-zinc-700 text-white placeholder-gray-500 focus:outline-none focus:border-[#00FF94]"
                    placeholder="Enter new password (min 6 characters)"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-2">Confirm New Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-black/30 border border-zinc-700 text-white placeholder-gray-500 focus:outline-none focus:border-[#00FF94]"
                    placeholder="Confirm new password"
                  />
                </div>
              </div>

              <button
                onClick={handleChangePassword}
                disabled={isLoading}
                className="w-full mt-6 py-4 rounded-xl font-semibold text-black transition-all duration-200"
                style={{
                  backgroundColor: isLoading ? 'rgba(0, 255, 148, 0.5)' : '#00FF94'
                }}
              >
                {isLoading ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                    <span>Changing Password...</span>
                  </div>
                ) : (
                  'Change Password'
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// Delete Account Modal
const DeleteAccountModal = ({ isOpen, onClose, user, userProfile, onDeleteComplete }) => {
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState(1); // 1 = warning, 2 = confirm
  const [isAnimating, setIsAnimating] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const isEmailPasswordUser = user?.providerData?.some(p => p.providerId === 'password');

  useEffect(() => {
    if (isOpen) {
      setIsClosing(false);
      setPassword('');
      setConfirmText('');
      setError('');
      setStep(1);
      setTimeout(() => setIsAnimating(true), 10);
    } else {
      setIsAnimating(false);
    }
  }, [isOpen]);

  const handleClose = () => {
    setIsClosing(true);
    setIsAnimating(false);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 300);
  };

  const handleDeleteAccount = async () => {
    setError('');

    if (confirmText !== 'DELETE') {
      setError('Please type DELETE to confirm');
      return;
    }

    setIsLoading(true);
    try {
      const { deleteUserAccount } = await import('./services/userService');

      // For email/password users, re-authenticate first
      if (isEmailPasswordUser && password) {
        if (Capacitor.isNativePlatform()) {
          const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
          await FirebaseAuthentication.signInWithEmailAndPassword({
            email: user.email,
            password: password
          });
        } else {
          const credential = EmailAuthProvider.credential(user.email, password);
          await reauthenticateWithCredential(auth.currentUser, credential);
        }
      }

      // Delete user data from Firestore
      await deleteUserAccount(user.uid, userProfile?.username);

      // Delete Firebase Auth account
      if (Capacitor.isNativePlatform()) {
        const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
        await FirebaseAuthentication.deleteUser();
      } else {
        await auth.currentUser.delete();
      }

      triggerHaptic(ImpactStyle.Heavy);
      onDeleteComplete();
    } catch (err) {
      console.error('Delete account error:', err);
      const errorCode = err.code || err.message || '';
      if (errorCode.includes('wrong-password') || errorCode.includes('invalid-credential') || errorCode.includes('INVALID_LOGIN_CREDENTIALS')) {
        setError('Incorrect password. Please try again.');
      } else if (errorCode.includes('requires-recent-login')) {
        setError('Please sign out, sign back in, and try again.');
      } else {
        setError('Failed to delete account. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen && !isClosing) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end justify-center transition-all duration-300 ${
        isAnimating && !isClosing ? 'bg-black/60' : 'bg-black/0'
      }`}
      onClick={handleClose}
    >
      <div
        className={`w-full max-w-lg rounded-t-3xl transition-all duration-300 ${
          isAnimating && !isClosing ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{
          backgroundColor: '#1a1a1a',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-gray-600" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pb-4">
          <h2 className="text-xl font-bold text-red-500">Delete Account</h2>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
          >
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 pb-6">
          {step === 1 ? (
            <>
              {/* Warning */}
              <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-red-400 font-medium mb-2">This action cannot be undone</p>
                    <p className="text-gray-400 text-sm">
                      Deleting your account will permanently remove:
                    </p>
                    <ul className="text-gray-400 text-sm mt-2 space-y-1">
                      <li>• All your workout history and streaks</li>
                      <li>• Your progress photos</li>
                      <li>• Your friends and social connections</li>
                      <li>• Your profile and settings</li>
                    </ul>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setStep(2)}
                className="w-full py-4 rounded-xl font-semibold text-white bg-red-500/20 border border-red-500/50 transition-all duration-200"
              >
                I understand, continue
              </button>

              <button
                onClick={handleClose}
                className="w-full mt-3 py-4 rounded-xl font-semibold text-gray-400 bg-white/5 transition-all duration-200"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              {error && (
                <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}

              <div className="space-y-4">
                {isEmailPasswordUser && (
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Enter your password</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl bg-black/30 border border-zinc-700 text-white placeholder-gray-500 focus:outline-none focus:border-red-500"
                      placeholder="Your password"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-sm text-gray-400 mb-2">
                    Type <span className="text-red-400 font-mono">DELETE</span> to confirm
                  </label>
                  <input
                    type="text"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                    className="w-full px-4 py-3 rounded-xl bg-black/30 border border-zinc-700 text-white placeholder-gray-500 focus:outline-none focus:border-red-500 font-mono"
                    placeholder="DELETE"
                  />
                </div>
              </div>

              <button
                onClick={handleDeleteAccount}
                disabled={isLoading || confirmText !== 'DELETE' || (isEmailPasswordUser && !password)}
                className="w-full mt-6 py-4 rounded-xl font-semibold text-white transition-all duration-200 disabled:opacity-50"
                style={{
                  backgroundColor: confirmText === 'DELETE' ? '#ef4444' : 'rgba(239, 68, 68, 0.3)'
                }}
              >
                {isLoading ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Deleting Account...</span>
                  </div>
                ) : (
                  'Permanently Delete Account'
                )}
              </button>

              <button
                onClick={() => setStep(1)}
                disabled={isLoading}
                className="w-full mt-3 py-4 rounded-xl font-semibold text-gray-400 bg-white/5 transition-all duration-200"
              >
                Go Back
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// Week Stats Modal
const WeekStatsModal = ({ isOpen, onClose, weekData, weekLabel, onDeleteActivity, onSelectActivity }) => {
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
  
  const lifts = weekData?.activities?.filter(a =>
    a.type === 'Strength Training' ||
    (a.type === 'Other' && (a.customActivityCategory === 'strength' || a.countToward === 'strength'))
  ) || [];
  const cardioActivities = weekData?.activities?.filter(a =>
    a.type === 'Running' || a.type === 'Cycle' || a.type === 'Sports' ||
    (a.type === 'Other' && (a.customActivityCategory === 'cardio' || a.countToward === 'cardio'))
  ) || [];
  const recoveryActivities = weekData?.activities?.filter(a =>
    a.type === 'Cold Plunge' || a.type === 'Sauna' || a.type === 'Yoga' ||
    (a.type === 'Other' && (a.customActivityCategory === 'recovery' || a.countToward === 'recovery'))
  ) || [];

  const goals = initialUserData.goals;
  const liftsGoalMet = (weekData?.lifts || 0) >= goals.liftsPerWeek;
  const cardioGoalMet = (weekData?.cardio || 0) >= goals.cardioPerWeek;
  const recoveryGoalMet = (weekData?.recovery || 0) >= goals.recoveryPerWeek;
  
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
          <h2 className="font-bold">{weekLabel}</h2>
          <button 
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
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'scale(0.9)';
              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.2)';
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
            }}
          >
            <span>📤</span>
            <span>Share</span>
          </button>
        </div>
        
        <div className="flex-1 overflow-auto p-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(0,255,148,0.1)' }}>
            <div className="text-2xl font-black" style={{ color: '#00FF94' }}>{weekData?.lifts || 0}</div>
            <div className="text-[10px] text-gray-400">🏋️ Strength</div>
          </div>
          <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(255,149,0,0.1)' }}>
            <div className="text-2xl font-black" style={{ color: '#FF9500' }}>{weekData?.cardio || 0}</div>
            <div className="text-[10px] text-gray-400">🏃 Cardio</div>
          </div>
          <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(0,209,255,0.1)' }}>
            <div className="text-2xl font-black" style={{ color: '#00D1FF' }}>{weekData?.recovery || 0}</div>
            <div className="text-[10px] text-gray-400">🧊 Recovery</div>
          </div>
        </div>

        {/* Goals Status */}
        <div className="p-3 rounded-xl mb-4 flex items-center justify-between" style={{ 
          backgroundColor: weekData?.goalsMet ? 'rgba(0,255,148,0.1)' : 'rgba(255,69,58,0.1)',
          border: `1px solid ${weekData?.goalsMet ? 'rgba(0,255,148,0.3)' : 'rgba(255,69,58,0.3)'}`
        }}>
          <span className="text-sm">Week Goals</span>
          <span className="font-bold" style={{ color: weekData?.goalsMet ? '#00FF94' : '#FF453A' }}>
            {weekData?.goalsMet ? '✓ Completed' : '✗ Incomplete'}
          </span>
        </div>

        {/* Week Totals */}
        <div className="mb-4">
          <div className="text-sm font-semibold text-white mb-3">📊 Week Totals</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
              <div className="text-lg font-black">{weekData?.calories?.toLocaleString() || 0}</div>
              <div className="text-[10px] text-gray-400">Calories Burned</div>
              <div className="text-[10px] text-gray-500 mt-1">~{Math.round((weekData?.calories || 0) / 7).toLocaleString()}/day avg</div>
            </div>
            <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
              <div className="text-lg font-black">{weekData?.miles || 0} mi</div>
              <div className="text-[10px] text-gray-400">Miles Run</div>
            </div>
            <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
              <div className="text-lg font-black">{weekData?.steps?.toLocaleString() || 0}</div>
              <div className="text-[10px] text-gray-400">Total Steps</div>
              <div className="text-[10px] text-gray-500 mt-1">~{Math.round((weekData?.steps || 0) / 7).toLocaleString()}/day avg</div>
            </div>
            <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
              <div className="text-lg font-black">{(weekData?.activities?.length || 0)}</div>
              <div className="text-[10px] text-gray-400">Total Sessions</div>
            </div>
          </div>
        </div>

        {/* Streaks Maintained */}
        <div className="mb-6">
          <div className="text-sm font-semibold text-white mb-3">🔥 Streaks Maintained</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="p-3 rounded-xl flex items-center justify-between" style={{ 
              backgroundColor: liftsGoalMet ? 'rgba(0,255,148,0.1)' : 'rgba(255,255,255,0.05)',
              border: liftsGoalMet ? '1px solid rgba(0,255,148,0.2)' : 'none'
            }}>
              <div>
                <span className="text-xs">🏋️ Strength</span>
                <div className="text-[10px] text-gray-500">{goals.liftsPerWeek}+ per week</div>
              </div>
              <span className="text-xs font-bold" style={{ color: liftsGoalMet ? '#00FF94' : '#FF453A' }}>
                {liftsGoalMet ? '✓' : '✗'}
              </span>
            </div>
            <div className="p-3 rounded-xl flex items-center justify-between" style={{ 
              backgroundColor: cardioGoalMet ? 'rgba(255,149,0,0.1)' : 'rgba(255,255,255,0.05)',
              border: cardioGoalMet ? '1px solid rgba(255,149,0,0.2)' : 'none'
            }}>
              <div>
                <span className="text-xs">🏃 Cardio</span>
                <div className="text-[10px] text-gray-500">{goals.cardioPerWeek}+ per week</div>
              </div>
              <span className="text-xs font-bold" style={{ color: cardioGoalMet ? '#FF9500' : '#FF453A' }}>
                {cardioGoalMet ? '✓' : '✗'}
              </span>
            </div>
            <div className="p-3 rounded-xl flex items-center justify-between" style={{ 
              backgroundColor: recoveryGoalMet ? 'rgba(0,209,255,0.1)' : 'rgba(255,255,255,0.05)',
              border: recoveryGoalMet ? '1px solid rgba(0,209,255,0.2)' : 'none'
            }}>
              <div>
                <span className="text-xs">🧊 Recovery</span>
                <div className="text-[10px] text-gray-500">{goals.recoveryPerWeek}+ per week</div>
              </div>
              <span className="text-xs font-bold" style={{ color: recoveryGoalMet ? '#00D1FF' : '#FF453A' }}>
                {recoveryGoalMet ? '✓' : '✗'}
              </span>
            </div>
            <div className="p-3 rounded-xl flex items-center justify-between" style={{ 
              backgroundColor: weekData?.goalsMet ? 'rgba(255,215,0,0.1)' : 'rgba(255,255,255,0.05)',
              border: weekData?.goalsMet ? '1px solid rgba(255,215,0,0.2)' : 'none'
            }}>
              <div>
                <span className="text-xs">🏆 Master</span>
                <div className="text-[10px] text-gray-500">All goals hit</div>
              </div>
              <span className="text-xs font-bold" style={{ color: weekData?.goalsMet ? '#FFD700' : '#FF453A' }}>
                {weekData?.goalsMet ? '✓' : '✗'}
              </span>
            </div>
          </div>
        </div>

        {/* Activities Completed Header */}
        <div className="mb-4">
          <div className="text-sm font-semibold text-white">💪 Activities Completed</div>
          <p className="text-[11px] text-gray-500 mt-0.5">All sessions from this week</p>
        </div>

        <SwipeableProvider>
        {/* Strength Section */}
        {lifts.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-300">🏋️ Strength</span>
              </div>
              {weekData?.liftBreakdown && (
                <div className="flex gap-1">
                  {Object.entries(weekData.liftBreakdown).map(([type, count]) => (
                    <span key={type} className="px-2 py-0.5 rounded-full text-[10px]" style={{ backgroundColor: 'rgba(0,255,148,0.1)', color: '#00FF94' }}>
                      {count} {type}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              {lifts.map((activity, i) => (
                <SwipeableActivityItem
                  key={activity.id || i}
                  activity={activity}
                  onDelete={(act) => onDeleteActivity?.(act.id)}
                >
                  <div
                    onClick={() => onSelectActivity?.(activity)}
                    className="p-3 rounded-xl cursor-pointer"
                    style={{ backgroundColor: 'rgba(0,255,148,0.05)' }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-medium text-sm flex items-center gap-1">
                        {activity.type === 'Other' && activity.customEmoji && <span>{activity.customEmoji}</span>}
                        {activity.subtype || activity.type}
                      </div>
                      <div className="text-xs text-gray-500">{activity.date}</div>
                    </div>
                    <div className="flex gap-4 text-xs text-gray-400">
                      <span>{activity.duration} min</span>
                      <span>{activity.calories} cal</span>
                      {activity.avgHr && <span>♥ {activity.avgHr} avg</span>}
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
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-300">🏃 Cardio</span>
              </div>
              {weekData?.cardioBreakdown && (
                <div className="flex gap-1">
                  {Object.entries(weekData.cardioBreakdown).map(([type, count]) => (
                    <span key={type} className="px-2 py-0.5 rounded-full text-[10px]" style={{ backgroundColor: 'rgba(255,149,0,0.1)', color: '#FF9500' }}>
                      {count} {type}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              {cardioActivities.map((activity, i) => (
                <SwipeableActivityItem
                  key={activity.id || i}
                  activity={activity}
                  onDelete={(act) => onDeleteActivity?.(act.id)}
                >
                  <div
                    onClick={() => onSelectActivity?.(activity)}
                    className="p-3 rounded-xl cursor-pointer"
                    style={{ backgroundColor: 'rgba(255,149,0,0.05)' }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-medium text-sm flex items-center gap-1">
                        {activity.type === 'Other' && activity.customEmoji && <span>{activity.customEmoji}</span>}
                        {activity.subtype || activity.type}
                      </div>
                      <div className="text-xs text-gray-500">{activity.date}</div>
                    </div>
                    <div className="flex gap-4 text-xs text-gray-400">
                      {activity.distance && <span>{activity.distance} mi</span>}
                      <span>{activity.duration} min</span>
                      <span>{activity.calories} cal</span>
                    </div>
                  </div>
                </SwipeableActivityItem>
              ))}
            </div>
          </div>
        )}

        {/* Recovery Section */}
        {recoveryActivities.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-300">🧊 Recovery</span>
              </div>
              {weekData?.recoveryBreakdown && (
                <div className="flex gap-1 flex-wrap justify-end">
                  {Object.entries(weekData.recoveryBreakdown).map(([type, count]) => (
                    <span key={type} className="px-2 py-0.5 rounded-full text-[10px]" style={{ backgroundColor: 'rgba(0,209,255,0.1)', color: '#00D1FF' }}>
                      {count} {type}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              {recoveryActivities.map((activity, i) => (
                <SwipeableActivityItem
                  key={activity.id || i}
                  activity={activity}
                  onDelete={(act) => onDeleteActivity?.(act.id)}
                >
                  <div
                    onClick={() => onSelectActivity?.(activity)}
                    className="p-3 rounded-xl cursor-pointer"
                    style={{ backgroundColor: 'rgba(0,209,255,0.05)' }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-medium text-sm flex items-center gap-1">
                        {activity.type === 'Other' && activity.customEmoji && <span>{activity.customEmoji}</span>}
                        {activity.type === 'Other' ? (activity.subtype || activity.type) : activity.type}
                      </div>
                      <div className="text-xs text-gray-500">{activity.date}</div>
                    </div>
                    <div className="flex gap-4 text-xs text-gray-400">
                      <span>{activity.duration} min</span>
                      {activity.temp && <span>{activity.temp}°F</span>}
                      {activity.calories && <span>{activity.calories} cal</span>}
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
    </div>
  );
};

// Activity Detail Modal
const ActivityDetailModal = ({ isOpen, onClose, activity, onDelete, onEdit, user, userProfile }) => {
  const [isAnimating, setIsAnimating] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showFullscreenPhoto, setShowFullscreenPhoto] = useState(false);

  // Reactions & Comments state
  const [reactions, setReactions] = useState([]);
  const [comments, setComments] = useState([]);
  const [showComments, setShowComments] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [loadingInteractions, setLoadingInteractions] = useState(false);

  const reactionEmojis = ['🔥', '💪', '👏', '❤️', '🎉'];

  // Determine the activity owner - use activity.userId if set, otherwise current user owns this activity
  const activityOwnerId = activity?.userId || user?.uid;

  // Fetch reactions and comments when modal opens
  useEffect(() => {
    if (isOpen && activity?.id && activityOwnerId) {
      fetchInteractions();
    } else if (!isOpen) {
      // Reset state when modal closes
      setReactions([]);
      setComments([]);
      setShowComments(false);
      setNewComment('');
    }
  }, [isOpen, activity?.id, activityOwnerId]);

  const fetchInteractions = async () => {
    if (!activity?.id || !activityOwnerId) return;
    setLoadingInteractions(true);
    try {
      const [rxns, cmts] = await Promise.all([
        getReactions(activityOwnerId, activity.id),
        getComments(activityOwnerId, activity.id)
      ]);
      setReactions(rxns || []);
      setComments(cmts || []);
    } catch (err) {
      // console.error('Error fetching interactions:', err);
    }
    setLoadingInteractions(false);
  };

  const handleReaction = async (emoji) => {
    if (!user || !activity?.id || !activityOwnerId) return;

    const existingReaction = reactions.find(r => r.reactorUid === user.uid);

    try {
      if (existingReaction?.reactionType === emoji) {
        // Remove reaction
        await removeReaction(activityOwnerId, activity.id, user.uid);
        setReactions(prev => prev.filter(r => r.reactorUid !== user.uid));
      } else {
        // Add or change reaction
        if (existingReaction) {
          await removeReaction(activityOwnerId, activity.id, user.uid);
        }
        await addReaction(activityOwnerId, activity.id, user.uid, emoji, userProfile?.displayName, userProfile?.photoURL);
        setReactions(prev => {
          const filtered = prev.filter(r => r.reactorUid !== user.uid);
          return [...filtered, { reactorUid: user.uid, reactionType: emoji, reactorName: userProfile?.displayName, reactorPhoto: userProfile?.photoURL }];
        });
      }
      triggerHaptic(ImpactStyle.Light);
    } catch (err) {
      // console.error('Error handling reaction:', err);
    }
  };

  const handleAddComment = async () => {
    if (!user || !activity?.id || !activityOwnerId || !newComment.trim()) return;

    try {
      await addComment(activityOwnerId, activity.id, user.uid, newComment.trim(), userProfile?.displayName, userProfile?.photoURL);
      setComments(prev => [...prev, {
        id: Date.now().toString(),
        commenterUid: user.uid,
        commenterName: userProfile?.displayName,
        commenterPhoto: userProfile?.photoURL,
        text: newComment.trim(),
        createdAt: new Date().toISOString()
      }]);
      setNewComment('');
      triggerHaptic(ImpactStyle.Light);
    } catch (err) {
      // console.error('Error adding comment:', err);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setIsClosing(false);
      setShowDeleteConfirm(false);
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

  const handleDelete = () => {
    onDelete(activity.id);
    handleClose();
  };

  if (!isOpen && !isClosing) return null;
  if (!activity) return null;

  const getActivityColor = (type) => {
    if (type === 'Strength Training') return '#00FF94';
    if (type === 'Running' || type === 'Cycle' || type === 'Sports') return '#FF9500';
    return '#00D1FF';
  };

  const color = getActivityColor(activity.type);
  
  return (
    <div 
      className="fixed inset-0 z-50 flex items-end justify-center transition-all duration-300"
      style={{ backgroundColor: isAnimating ? 'rgba(0,0,0,0.9)' : 'rgba(0,0,0,0)' }}
      onClick={(e) => e.target === e.currentTarget && handleClose()}
    >
      <div
        className="w-full max-w-lg rounded-t-3xl transition-all duration-300 ease-out overflow-hidden flex flex-col"
        style={{
          backgroundColor: '#0A0A0A',
          transform: isAnimating ? 'translateY(0)' : 'translateY(100%)',
          maxHeight: '85vh'
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10 flex-shrink-0">
          <button 
            onClick={handleClose}
            className="text-gray-400 text-sm transition-all duration-150 px-2 py-1 rounded-lg"
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
            Close
          </button>
          <h2 className="font-bold">Activity Details</h2>
          <div className="w-12" />
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto flex-1">
          {/* Activity Type Header */}
          <div className="flex items-center gap-4 mb-6">
            <div 
              className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ backgroundColor: `${color}20` }}
            >
              <ActivityIcon type={activity.type} size={28} sportEmoji={activity.sportEmoji} customEmoji={activity.customEmoji} />
            </div>
            <div className="flex-1">
              <div className="text-xl font-bold">{activity.type}</div>
              {activity.strengthType && activity.focusArea ? (
                <div className="text-sm text-gray-400">{activity.strengthType} • {activity.focusArea}</div>
              ) : activity.subtype && (
                <div className="text-sm text-gray-400">{activity.subtype}</div>
              )}
            </div>
          </div>

          {/* Date & Time */}
          <div className="p-4 rounded-xl mb-4" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
            <div className="flex items-center gap-3">
              <span className="text-lg">📅</span>
              <div>
                <div className="text-sm font-medium">{formatFriendlyDate(activity.date)}</div>
                <div className="text-xs text-gray-500">{activity.time}</div>
              </div>
            </div>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            {activity.duration && (
              <div className="p-4 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                <div className="text-xs text-gray-500 mb-1">Duration</div>
                <div className="text-lg font-bold">
                  {activity.duration >= 60 
                    ? `${Math.floor(activity.duration / 60)}h ${activity.duration % 60}m` 
                    : `${activity.duration} min`}
                </div>
              </div>
            )}
            {activity.distance && (
              <div className="p-4 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                <div className="text-xs text-gray-500 mb-1">Distance</div>
                <div className="text-lg font-bold">{activity.distance} mi</div>
              </div>
            )}
            {activity.calories && (
              <div className="p-4 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                <div className="text-xs text-gray-500 mb-1">Calories</div>
                <div className="text-lg font-bold">{activity.calories} cal</div>
              </div>
            )}
            {activity.avgHr && (
              <div className="p-4 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                <div className="text-xs text-gray-500 mb-1">Avg Heart Rate</div>
                <div className="text-lg font-bold">{activity.avgHr} bpm</div>
              </div>
            )}
            {activity.maxHr && (
              <div className="p-4 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                <div className="text-xs text-gray-500 mb-1">Max Heart Rate</div>
                <div className="text-lg font-bold">{activity.maxHr} bpm</div>
              </div>
            )}
            {parseFloat(activity.distance) > 0 && activity.duration && (
              <div className="p-4 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                <div className="text-xs text-gray-500 mb-1">Pace</div>
                <div className="text-lg font-bold">
                  {(() => {
                    const pace = activity.duration / parseFloat(activity.distance);
                    const paceMin = Math.floor(pace);
                    const paceSec = Math.round((pace - paceMin) * 60);
                    return `${paceMin}:${paceSec.toString().padStart(2, '0')}/mi`;
                  })()}
                </div>
              </div>
            )}
          </div>

          {/* Reactions & Comments Section - show if user is logged in */}
          {user && (
            <div className="mb-4 pt-3 border-t border-white/10">
              {/* Reactions Row */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1">
                  {reactionEmojis.map((emoji) => {
                    const count = reactions.filter(r => r.reactionType === emoji).length;
                    const isSelected = reactions.find(r => r.reactorUid === user?.uid)?.reactionType === emoji;
                    const canReact = activity?.id && activityOwnerId;
                    return (
                      <button
                        key={emoji}
                        onClick={() => canReact && handleReaction(emoji)}
                        disabled={!canReact}
                        className={`flex items-center gap-1 px-2 py-1 rounded-full transition-all duration-150 ${!canReact ? 'opacity-50' : ''} ${isSelected ? 'bg-zinc-700 ring-1 ring-white/20' : 'bg-zinc-800 hover:bg-zinc-700'}`}
                      >
                        <span className="text-sm">{emoji}</span>
                        {count > 0 && <span className={`text-xs ${isSelected ? 'text-white' : 'text-gray-400'}`}>{count}</span>}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => setShowComments(!showComments)}
                    onTouchStart={() => triggerHaptic(ImpactStyle.Light)}
                    className={`flex items-center gap-1 px-2 py-1 rounded-full transition-all duration-150 ${showComments ? 'bg-zinc-700 ring-1 ring-white/20' : 'bg-zinc-800 hover:bg-zinc-700'}`}
                  >
                    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    {comments.length > 0 && <span className="text-xs text-gray-400">{comments.length}</span>}
                  </button>
                </div>

                {/* Reactor photos */}
                {reactions.filter(r => r.reactorPhoto).length > 0 && (
                  <div className="flex items-center -space-x-2">
                    {reactions.filter(r => r.reactorPhoto).slice(0, 3).map((reactor, idx) => (
                      <div key={reactor.reactorUid || idx} className="w-6 h-6 rounded-full border-2 border-zinc-900 overflow-hidden">
                        <img src={reactor.reactorPhoto} alt={reactor.reactorName} className="w-full h-full object-cover" />
                      </div>
                    ))}
                    {reactions.length > 3 && <span className="text-gray-500 text-xs ml-2">+{reactions.length - 3}</span>}
                  </div>
                )}
              </div>

              {/* Comments Section (expandable) */}
              {showComments && (
                <div className="space-y-3">
                  {comments.length > 0 && (
                    <div className="space-y-2">
                      {comments.map((comment) => (
                        <div key={comment.id} className="flex gap-2 items-start">
                          <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center overflow-hidden flex-shrink-0">
                            {comment.commenterPhoto ? (
                              <img src={comment.commenterPhoto} alt={comment.commenterName} className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-white text-[10px]">{comment.commenterName?.[0]?.toUpperCase() || '?'}</span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="bg-zinc-800 rounded-2xl px-3 py-2">
                              <span className="text-white text-xs font-medium">{comment.commenterName}</span>
                              <p className="text-gray-300 text-sm break-words">{comment.text}</p>
                            </div>
                            <span className="text-gray-500 text-[10px] ml-2">
                              {comment.createdAt ? new Date(comment.createdAt).toLocaleDateString() : ''}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Comment Input */}
                  <div className="flex gap-2 items-center">
                    <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center overflow-hidden flex-shrink-0">
                      {userProfile?.photoURL ? (
                        <img src={userProfile.photoURL} alt="You" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-white text-[10px]">{userProfile?.displayName?.[0]?.toUpperCase() || '?'}</span>
                      )}
                    </div>
                    <div className="flex-1 flex gap-2">
                      <input
                        type="text"
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        placeholder="Add a comment..."
                        className="flex-1 bg-zinc-800 rounded-full px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-white/20"
                        onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
                      />
                      <button
                        onClick={handleAddComment}
                        disabled={!newComment.trim()}
                        className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center disabled:opacity-50 transition-all"
                      >
                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          {activity.notes && (
            <div className="p-4 rounded-xl mb-4" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
              <div className="text-xs text-gray-500 mb-2">Notes</div>
              <div className="text-sm">{activity.notes}</div>
            </div>
          )}

          {/* Activity Photo */}
          {activity.photoURL && (
            <div className="mb-4 rounded-xl overflow-hidden">
              <button
                onClick={() => setShowFullscreenPhoto(true)}
                className="w-full relative group"
              >
                <img
                  src={activity.photoURL}
                  alt="Activity"
                  className="w-full h-auto max-h-64 object-cover"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                  <svg className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                  </svg>
                </div>
              </button>
              {activity.isPhotoPrivate && (
                <div className="flex items-center gap-1 p-2 bg-black/50 text-xs text-gray-400">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <span>Only visible to you</span>
                </div>
              )}
            </div>
          )}

          {/* Fullscreen Photo Modal */}
          {showFullscreenPhoto && activity.photoURL && (
            <div
              className="fixed inset-0 z-[100] bg-black flex items-center justify-center"
              onClick={() => setShowFullscreenPhoto(false)}
            >
              <button
                onClick={() => setShowFullscreenPhoto(false)}
                className="absolute top-4 right-4 w-10 h-10 bg-white/10 rounded-full flex items-center justify-center z-10"
              >
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <img
                src={activity.photoURL}
                alt="Activity fullscreen"
                className="max-w-full max-h-full object-contain"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}

          {/* Source indicator */}
          {activity.fromAppleHealth && (
            <div className="flex items-center gap-2 text-xs text-gray-500 mb-4">
              <span>📱</span>
              <span>Synced from Apple Health</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-2 pb-4">
            {/* Edit Button */}
            <button
              onClick={() => {
                onEdit && onEdit(activity);
                handleClose();
              }}
              className="w-full py-3 rounded-xl font-medium transition-all duration-150"
              style={{ backgroundColor: 'rgba(0,255,148,0.1)', color: '#00FF94' }}
              onTouchStart={(e) => {
                e.currentTarget.style.transform = 'scale(0.98)';
                e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.2)';
              }}
              onTouchEnd={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.1)';
              }}
              onMouseDown={(e) => {
                e.currentTarget.style.transform = 'scale(0.98)';
                e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.2)';
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.1)';
              }}
            >
              Edit Activity
            </button>
            
            {!showDeleteConfirm ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full py-3 rounded-xl font-medium text-red-400 transition-all duration-150"
                style={{ backgroundColor: 'rgba(255,69,58,0.1)' }}
                onTouchStart={(e) => {
                  e.currentTarget.style.transform = 'scale(0.98)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,69,58,0.2)';
                }}
                onTouchEnd={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,69,58,0.1)';
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = 'scale(0.98)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,69,58,0.2)';
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,69,58,0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,69,58,0.1)';
                }}
              >
                Delete Activity
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-center text-sm text-gray-400 mb-3">Are you sure you want to delete this activity?</p>
                <button
                  onClick={handleDelete}
                  className="w-full py-3 rounded-xl font-medium text-white transition-all duration-150"
                  style={{ backgroundColor: '#FF453A' }}
                  onTouchStart={(e) => {
                    e.currentTarget.style.transform = 'scale(0.98)';
                    e.currentTarget.style.backgroundColor = '#E63E35';
                  }}
                  onTouchEnd={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.backgroundColor = '#FF453A';
                  }}
                  onMouseDown={(e) => {
                    e.currentTarget.style.transform = 'scale(0.98)';
                    e.currentTarget.style.backgroundColor = '#E63E35';
                  }}
                  onMouseUp={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.backgroundColor = '#FF453A';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.backgroundColor = '#FF453A';
                  }}
                >
                  Yes, Delete
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="w-full py-3 rounded-xl font-medium text-gray-400 transition-all duration-150"
                  style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                  onTouchStart={(e) => {
                    e.currentTarget.style.transform = 'scale(0.98)';
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                  }}
                  onTouchEnd={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                  }}
                  onMouseDown={(e) => {
                    e.currentTarget.style.transform = 'scale(0.98)';
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                  }}
                  onMouseUp={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Onboarding Survey
const OnboardingSurvey = ({ onComplete, onCancel = null, currentGoals = null, currentPrivacy = null }) => {
  const [goals, setGoals] = useState({
    liftsPerWeek: currentGoals?.liftsPerWeek ?? 3,
    cardioPerWeek: currentGoals?.cardioPerWeek ?? 2,
    recoveryPerWeek: currentGoals?.recoveryPerWeek ?? 2,
    stepsPerDay: currentGoals?.stepsPerDay ?? 10000,
    caloriesPerDay: currentGoals?.caloriesPerDay ?? 500
  });

  const [privacy, setPrivacy] = useState({
    showInActivityFeed: currentPrivacy?.showInActivityFeed ?? true,
    showOnLeaderboard: currentPrivacy?.showOnLeaderboard ?? true
  });

  const isEditing = currentGoals !== null;

  const questions = [
    { title: "Strength training sessions per week", key: 'liftsPerWeek', options: [2, 3, 4, 5, 6], subtitle: "Weightlifting, calisthenics, or any resistance training. Recommended: 2+ per week." },
    { title: "Cardio sessions per week", key: 'cardioPerWeek', options: [1, 2, 3, 4, 5], subtitle: "Running, cycling, sports, etc. Recommended: 1+ per week." },
    { title: "Recovery sessions per week", key: 'recoveryPerWeek', options: [1, 2, 3, 4], subtitle: "Cold plunge, sauna, yoga, pilates, etc. Recommended: 1+ per week." },
    { title: "Daily step goal", key: 'stepsPerDay', options: [6000, 8000, 10000, 12000, 15000], isSteps: true, subtitle: "Recommended: 10k+ per day for fat loss and general heart health." },
    { title: "Daily active calories goal", key: 'caloriesPerDay', options: [300, 400, 500, 600, 750, 1000, 1250, 1500, 1750, 2000], isCalories: true, isScrollable: true, subtitle: "Calories burned from exercise only (not resting metabolism). Recommended: 400-600 per day." }
  ];

  return (
    <div className="fixed inset-0 bg-black text-white flex flex-col overflow-hidden">
      <div className="flex-shrink-0 p-6 pt-12">
        {isEditing && onCancel && (
          <button
            onClick={onCancel}
            className="text-gray-400 text-sm mb-4 flex items-center gap-1 transition-all duration-150 px-2 py-1 rounded-lg -ml-2"
            onTouchStart={(e) => {
              e.currentTarget.style.transform = 'scale(0.92)';
              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
            }}
            onTouchEnd={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'scale(0.92)';
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
        )}
        <img src="/wordmark.png" alt="Day Seven" className="h-8 mb-2" />
        <p className="text-sm mb-4" style={{ color: '#00FF94' }}>Win the week.</p>
        <h2 className="text-xl font-bold mb-2">{isEditing ? 'Edit Your Goals' : 'Set Your Goals'}</h2>
        <p className="text-gray-500 text-sm">Set your standards. Earn your streaks.</p>
      </div>

      <div
        className="flex-1 px-6 py-4 space-y-6 pb-32 overflow-y-auto"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {questions.map((q) => (
          <div key={q.key}>
            <label className="text-sm font-semibold mb-1 block">{q.title}</label>
            {q.subtitle && <p className="text-xs text-gray-500 mb-2">{q.subtitle}</p>}
            <div
              className={`flex gap-2 ${!q.subtitle ? 'mt-3' : ''} ${q.isScrollable ? 'overflow-x-auto pb-2 -mx-6 px-6' : ''}`}
              style={q.isScrollable ? { WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', msOverflowStyle: 'none' } : {}}
            >
              {q.options.map((option) => (
                <button
                  key={option}
                  onClick={() => setGoals({ ...goals, [q.key]: option })}
                  className={`py-3 rounded-xl text-center transition-all duration-200 border-2 ${q.isScrollable ? 'flex-shrink-0 px-4 min-w-[70px]' : 'flex-1'}`}
                  style={{
                    backgroundColor: goals[q.key] === option ? 'rgba(0,255,148,0.15)' : 'rgba(255,255,255,0.05)',
                    borderColor: goals[q.key] === option ? '#00FF94' : 'transparent',
                    transform: 'scale(1)'
                  }}
                  onTouchStart={(e) => {
                    e.currentTarget.style.transform = 'scale(0.92)';
                  }}
                  onTouchEnd={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                  }}
                  onMouseDown={(e) => {
                    e.currentTarget.style.transform = 'scale(0.92)';
                  }}
                  onMouseUp={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                  }}
                >
                  <span className="font-bold" style={{ color: goals[q.key] === option ? '#00FF94' : 'white' }}>
                    {q.isSteps ? `${option/1000}k` : q.isCalories ? `${option}` : option}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}

        {/* Privacy Section - only show during initial onboarding */}
        {!isEditing && (
          <div className="mt-8 pt-6 border-t border-zinc-800">
            <h3 className="text-sm font-semibold text-gray-400 mb-4">PRIVACY SETTINGS</h3>
            <p className="text-xs text-gray-500 mb-4">Choose how you appear to friends. You can change these anytime in Settings.</p>

            {/* Activity Feed Toggle */}
            <div className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(0,209,255,0.1)' }}>
                  <span className="text-lg">📲</span>
                </div>
                <div>
                  <span className="text-sm text-white font-medium">Show in Activity Feed</span>
                  <p className="text-[11px] text-gray-500">Friends can see your workouts</p>
                </div>
              </div>
              <button
                onClick={() => setPrivacy({ ...privacy, showInActivityFeed: !privacy.showInActivityFeed })}
                className="w-12 h-7 rounded-full transition-all duration-200 relative"
                style={{
                  backgroundColor: privacy.showInActivityFeed ? '#00FF94' : 'rgba(255,255,255,0.2)'
                }}
              >
                <div
                  className="absolute top-1 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-200"
                  style={{
                    left: privacy.showInActivityFeed ? '26px' : '4px'
                  }}
                />
              </button>
            </div>

            {/* Leaderboard Toggle */}
            <div className="flex items-center justify-between py-3 mt-2">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(255,149,0,0.1)' }}>
                  <span className="text-lg">🏅</span>
                </div>
                <div>
                  <span className="text-sm text-white font-medium">Appear on Leaderboards</span>
                  <p className="text-[11px] text-gray-500">Compete with friends</p>
                </div>
              </div>
              <button
                onClick={() => setPrivacy({ ...privacy, showOnLeaderboard: !privacy.showOnLeaderboard })}
                className="w-12 h-7 rounded-full transition-all duration-200 relative"
                style={{
                  backgroundColor: privacy.showOnLeaderboard ? '#00FF94' : 'rgba(255,255,255,0.2)'
                }}
              >
                <div
                  className="absolute top-1 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-200"
                  style={{
                    left: privacy.showOnLeaderboard ? '26px' : '4px'
                  }}
                />
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-6 pb-12" style={{ background: 'linear-gradient(to top, #000 80%, transparent)' }}>
        <button
          onClick={() => onComplete(goals, isEditing ? undefined : privacy)}
          className="w-full py-4 rounded-xl font-bold text-black text-lg transition-all duration-150"
          style={{ backgroundColor: '#00FF94' }}
          onTouchStart={(e) => {
            e.currentTarget.style.transform = 'scale(0.97)';
            e.currentTarget.style.backgroundColor = '#00CC77';
          }}
          onTouchEnd={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.backgroundColor = '#00FF94';
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = 'scale(0.97)';
            e.currentTarget.style.backgroundColor = '#00CC77';
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.backgroundColor = '#00FF94';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.backgroundColor = '#00FF94';
          }}
        >
          {isEditing ? 'Save Goals' : 'Start Day Seven'}
        </button>
      </div>
    </div>
  );
};

// Duration Picker Component
const DurationPicker = ({ hours, minutes, onChange, disabled = false }) => {
  const hourOptions = Array.from({ length: 6 }, (_, i) => i); // 0-5 hours
  const minuteOptions = Array.from({ length: 60 }, (_, i) => i); // 0-59 minutes

  const hoursRef = useRef(null);
  const minutesRef = useRef(null);

  const itemHeight = 32;
  const visibleItems = 3;

  useEffect(() => {
    // Scroll to initial values
    if (hoursRef.current) {
      hoursRef.current.scrollTop = hours * itemHeight;
    }
    if (minutesRef.current) {
      minutesRef.current.scrollTop = minutes * itemHeight;
    }
  }, []);

  const handleScroll = (ref, options, type) => {
    if (!ref.current) return;
    const scrollTop = ref.current.scrollTop;
    const index = Math.round(scrollTop / itemHeight);
    const clampedIndex = Math.max(0, Math.min(options.length - 1, index));

    if (type === 'hours' && clampedIndex !== hours) {
      onChange(clampedIndex, minutes);
    } else if (type === 'minutes' && clampedIndex !== minutes) {
      onChange(hours, clampedIndex);
    }
  };

  const scrollToValue = (ref, value) => {
    if (ref.current) {
      ref.current.scrollTo({
        top: value * itemHeight,
        behavior: 'smooth'
      });
    }
  };

  return (
    <div className="flex items-center justify-start gap-1" style={{ opacity: disabled ? 0.5 : 1 }}>
      {/* Hours wheel */}
      <div className="relative" style={{ height: itemHeight * visibleItems, width: '60px' }}>
        {/* Fade overlays */}
        <div
          className="absolute top-0 left-0 right-0 z-10 pointer-events-none"
          style={{
            height: itemHeight,
            background: 'linear-gradient(to bottom, rgba(10,10,10,1) 0%, rgba(10,10,10,0) 100%)'
          }}
        />
        <div
          className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none"
          style={{
            height: itemHeight,
            background: 'linear-gradient(to top, rgba(10,10,10,1) 0%, rgba(10,10,10,0) 100%)'
          }}
        />
        {/* Selection highlight */}
        <div
          className="absolute left-0 right-0 z-5 pointer-events-none rounded-lg"
          style={{
            top: itemHeight,
            height: itemHeight,
            backgroundColor: 'rgba(0,255,148,0.1)',
            border: '1px solid rgba(0,255,148,0.3)'
          }}
        />
        {/* Scrollable list */}
        <div
          ref={hoursRef}
          className="h-full overflow-y-scroll scrollbar-hide"
          style={{ scrollSnapType: 'y mandatory' }}
          onScroll={() => handleScroll(hoursRef, hourOptions, 'hours')}
        >
          <div style={{ height: itemHeight }} /> {/* Top padding */}
          {hourOptions.map((h) => (
            <div
              key={h}
              onClick={() => scrollToValue(hoursRef, h)}
              className="flex items-center justify-center cursor-pointer transition-all duration-150"
              style={{
                height: itemHeight,
                scrollSnapAlign: 'center',
                color: hours === h ? '#00FF94' : 'rgba(255,255,255,0.5)',
                fontWeight: hours === h ? 'bold' : 'normal',
                fontSize: hours === h ? '18px' : '14px'
              }}
            >
              {h}
            </div>
          ))}
          <div style={{ height: itemHeight }} /> {/* Bottom padding */}
        </div>
      </div>

      {/* Hours label */}
      <div className="text-xs text-gray-400">hr</div>

      {/* Separator */}
      <div className="text-xl font-bold text-gray-500">:</div>

      {/* Minutes wheel */}
      <div className="relative" style={{ height: itemHeight * visibleItems, width: '60px' }}>
        {/* Fade overlays */}
        <div
          className="absolute top-0 left-0 right-0 z-10 pointer-events-none"
          style={{
            height: itemHeight,
            background: 'linear-gradient(to bottom, rgba(10,10,10,1) 0%, rgba(10,10,10,0) 100%)'
          }}
        />
        <div
          className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none"
          style={{
            height: itemHeight,
            background: 'linear-gradient(to top, rgba(10,10,10,1) 0%, rgba(10,10,10,0) 100%)'
          }}
        />
        {/* Selection highlight */}
        <div
          className="absolute left-0 right-0 z-5 pointer-events-none rounded-lg"
          style={{
            top: itemHeight,
            height: itemHeight,
            backgroundColor: 'rgba(0,255,148,0.1)',
            border: '1px solid rgba(0,255,148,0.3)'
          }}
        />
        {/* Scrollable list */}
        <div
          ref={minutesRef}
          className="h-full overflow-y-scroll scrollbar-hide"
          style={{ scrollSnapType: 'y mandatory' }}
          onScroll={() => handleScroll(minutesRef, minuteOptions, 'minutes')}
        >
          <div style={{ height: itemHeight }} /> {/* Top padding */}
          {minuteOptions.map((m) => (
            <div
              key={m}
              onClick={() => scrollToValue(minutesRef, m)}
              className="flex items-center justify-center cursor-pointer transition-all duration-150"
              style={{
                height: itemHeight,
                scrollSnapAlign: 'center',
                color: minutes === m ? '#00FF94' : 'rgba(255,255,255,0.5)',
                fontWeight: minutes === m ? 'bold' : 'normal',
                fontSize: minutes === m ? '18px' : '14px'
              }}
            >
              {String(m).padStart(2, '0')}
            </div>
          ))}
          <div style={{ height: itemHeight }} /> {/* Bottom padding */}
        </div>
      </div>

      {/* Minutes label */}
      <div className="text-xs text-gray-400">min</div>
    </div>
  );
};

// Context to track which swipeable item is currently open
const SwipeableContext = createContext({ openId: null, setOpenId: () => {}, closeAll: () => {} });

// Provider component to wrap lists of swipeable items
const SwipeableProvider = ({ children }) => {
  const [openId, setOpenId] = useState(null);
  const closeAll = useCallback(() => {
    setOpenId(null);
  }, []);
  return (
    <SwipeableContext.Provider value={{ openId, setOpenId, closeAll }}>
      {/* Invisible overlay to catch taps outside swiped item */}
      {openId !== null && (
        <div
          className="fixed inset-0"
          style={{ zIndex: 9998 }}
          onClick={closeAll}
          onTouchEnd={(e) => {
            e.preventDefault();
            closeAll();
          }}
        />
      )}
      {children}
    </SwipeableContext.Provider>
  );
};

// Swipeable Activity Item Component for swipe-to-delete with long-press menu
const SwipeableActivityItem = ({ children, onDelete, activity, onTap, onEdit }) => {
  const { openId, setOpenId } = useContext(SwipeableContext);
  const [swipeX, setSwipeX] = useState(0);
  const [isBouncing, setIsBouncing] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [longPressMenu, setLongPressMenu] = useState({ show: false, x: 0, y: 0 });
  const longPressTimer = useRef(null);

  // Use refs for touch tracking to avoid stale closure issues
  const swipeRef = useRef(null);
  const swipeXRef = useRef(0); // Track current swipeX value
  const touchState = useRef({
    startX: null,
    startY: null,
    startSwipeX: 0,
    hasMoved: false,
    startTime: 0
  });

  // Keep swipeXRef in sync with swipeX state
  useEffect(() => {
    swipeXRef.current = swipeX;
  }, [swipeX]);

  // Keep longPressMenu ref in sync to avoid stale closure
  const longPressMenuRef = useRef(longPressMenu);
  useEffect(() => {
    longPressMenuRef.current = longPressMenu;
  }, [longPressMenu]);

  const deleteButtonWidth = 100;
  const snapThreshold = 40;
  const moveThreshold = 10; // Increased threshold for iOS
  const itemId = activity.id;

  // Close this item if another one becomes the open one, or if closeAll is triggered (openId becomes null)
  useEffect(() => {
    if (openId !== itemId && swipeX !== 0) {
      setSwipeX(0);
      setIsBouncing(false);
    }
  }, [openId, itemId, swipeX]);

  // Attach touch event listeners with { passive: false } for iOS
  useEffect(() => {
    const element = swipeRef.current;
    if (!element) return;

    const handleTouchStart = (e) => {
      const touch = e.touches[0];
      touchState.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        startSwipeX: swipeXRef.current,
        hasMoved: false,
        startTime: Date.now()
      };
      setIsBouncing(false);
      // Only show press effect if card is closed
      if (swipeXRef.current === 0) {
        setIsPressed(true);
      }

      // Start long-press timer (500ms)
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      longPressTimer.current = setTimeout(() => {
        if (!touchState.current.hasMoved && swipeXRef.current === 0) {
          triggerHaptic(ImpactStyle.Heavy);
          setLongPressMenu({ show: true, x: touch.clientX, y: touch.clientY });
          setIsPressed(false);
        }
      }, 500);
    };

    const handleTouchMove = (e) => {
      const { startX, startY, startSwipeX, hasMoved } = touchState.current;
      if (startX === null) return;

      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      const diffX = currentX - startX;
      const diffY = currentY - startY;

      // Cancel long-press if user moves significantly (15px to allow for finger micro-movements)
      if (Math.abs(diffX) > 15 || Math.abs(diffY) > 15) {
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
      }

      // Once we've started swiping, continue updating position
      if (hasMoved) {
        e.preventDefault(); // Prevent scrolling while swiping
        const newSwipeX = Math.max(-deleteButtonWidth - 30, Math.min(0, startSwipeX + diffX));
        setSwipeX(newSwipeX);
        return;
      }

      // Detect if this is a vertical scroll (should cancel tap)
      if (Math.abs(diffY) > moveThreshold) {
        touchState.current.hasMoved = true; // Mark as moved to prevent tap
        setIsPressed(false);
        return; // Let scroll happen naturally
      }

      // Detect if this is a horizontal swipe (not vertical scroll)
      if (Math.abs(diffX) > moveThreshold && Math.abs(diffX) > Math.abs(diffY)) {
        touchState.current.hasMoved = true;
        setIsPressed(false);
        e.preventDefault(); // Prevent scrolling when swiping horizontally
        // Notify context that this item is being swiped (close others)
        if (diffX < 0) {
          setOpenId(itemId);
        }
        const newSwipeX = Math.max(-deleteButtonWidth - 30, Math.min(0, startSwipeX + diffX));
        setSwipeX(newSwipeX);
      }
    };

    const handleTouchEnd = (e) => {
      // Clear long-press timer
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }

      const { hasMoved, startTime } = touchState.current;
      const touchDuration = Date.now() - startTime;
      const currentSwipeX = swipeXRef.current; // Use ref for current value
      const wasTap = !hasMoved && touchDuration < 300 && currentSwipeX === 0;

      setIsPressed(false);

      // If long-press menu is showing, don't do anything else
      if (longPressMenuRef.current.show) {
        touchState.current = { startX: null, startY: null, startSwipeX: 0, hasMoved: false, startTime: 0 };
        return;
      }

      if (wasTap && !globalIsPulling.current) {
        // This was a tap, not a swipe, and we're not pulling to refresh - trigger click on target
        const target = e.target;
        if (target) {
          setTimeout(() => target.click(), 10);
        }
        touchState.current = { startX: null, startY: null, startSwipeX: 0, hasMoved: false, startTime: 0 };
        return;
      }

      // Check swipe position and snap accordingly
      if (currentSwipeX < -snapThreshold) {
        setIsBouncing(true);
        setSwipeX(-deleteButtonWidth);
        setOpenId(itemId);
        setTimeout(() => setIsBouncing(false), 500);
      } else {
        setSwipeX(0);
        setOpenId(null);
      }

      touchState.current = { startX: null, startY: null, startSwipeX: 0, hasMoved: false, startTime: 0 };
    };

    // Add event listeners with passive: false to allow preventDefault
    element.addEventListener('touchstart', handleTouchStart, { passive: true });
    element.addEventListener('touchmove', handleTouchMove, { passive: false });
    element.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }, [itemId, setOpenId]); // Only re-attach if itemId or setOpenId changes

  const handleDeleteClick = (e) => {
    e.stopPropagation();
    triggerHaptic(ImpactStyle.Medium);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    setShowDeleteConfirm(false);
    setSwipeX(0);
    setOpenId(null);
    onDelete(activity);
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirm(false);
    setSwipeX(0);
    setOpenId(null);
  };

  const resetSwipe = () => {
    setSwipeX(0);
    setOpenId(null);
  };

  // Get transition style based on state
  const getTransition = () => {
    if (touchState.current.hasMoved) return 'none'; // No transition while actively swiping
    if (isBouncing) return 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)'; // Stronger bounce easing
    return 'transform 0.3s ease-out';
  };

  // Only show delete button when actually swiped left
  const showDeleteButton = swipeX < 0;

  return (
    <>
      <div
        className="relative overflow-hidden rounded-xl"
        style={{
          backgroundColor: showDeleteButton ? '#FF453A' : 'transparent',
          zIndex: showDeleteButton ? 9999 : 'auto',
          position: showDeleteButton ? 'relative' : 'static'
        }}
      >
        {/* Delete button - positioned on right, only visible when swiping */}
        {showDeleteButton && (
          <div
            className="absolute right-0 top-0 bottom-0 flex items-center justify-center"
            style={{ width: deleteButtonWidth }}
          >
          <button
            onClick={handleDeleteClick}
            className="h-full w-full flex items-center justify-center gap-2 text-white font-medium transition-transform duration-150"
            onTouchStart={(e) => {
              e.currentTarget.style.transform = 'scale(0.9)';
            }}
            onTouchEnd={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'scale(0.9)';
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
        )}

        {/* Main content with swipe */}
        <div
          ref={swipeRef}
          className="relative bg-zinc-900 swipeable-item"
          style={{
            transform: `translateX(${swipeX}px)${isPressed ? ' scale(0.98)' : ''}`,
            transition: getTransition()
          }}
        >
          {children}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.8)' }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              handleCancelDelete();
            }
          }}
          onTouchStart={(e) => {
            if (e.target === e.currentTarget) {
              e.preventDefault();
              handleCancelDelete();
            }
          }}
        >
          <div
            className="w-full max-w-xs bg-zinc-900 rounded-2xl overflow-hidden"
            onMouseDown={e => e.stopPropagation()}
            onTouchStart={e => e.stopPropagation()}
          >
            <div className="p-6 text-center">
              <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <h3 className="text-white font-bold text-lg mb-2">Delete Activity?</h3>
              <p className="text-gray-400 text-sm mb-1">
                {activity.type}{activity.subtype ? ` • ${activity.subtype}` : ''}
              </p>
              <p className="text-gray-500 text-xs">
                This action cannot be undone.
              </p>
            </div>
            <div className="flex border-t border-zinc-800">
              <button
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.currentTarget.style.transform = 'scale(0.95)';
                  e.currentTarget.style.backgroundColor = 'rgba(39, 39, 42, 1)';
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = '';
                  handleCancelDelete();
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = '';
                }}
                onTouchStart={(e) => {
                  e.stopPropagation();
                  e.currentTarget.style.transform = 'scale(0.95)';
                  e.currentTarget.style.backgroundColor = 'rgba(39, 39, 42, 1)';
                }}
                onTouchEnd={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = '';
                  handleCancelDelete();
                }}
                className="flex-1 py-4 text-white font-medium border-r border-zinc-800 transition-all duration-150"
              >
                Cancel
              </button>
              <button
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.currentTarget.style.transform = 'scale(0.95)';
                  e.currentTarget.style.backgroundColor = 'rgba(39, 39, 42, 1)';
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = '';
                  triggerHaptic(ImpactStyle.Heavy);
                  handleConfirmDelete();
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = '';
                }}
                onTouchStart={(e) => {
                  e.stopPropagation();
                  e.currentTarget.style.transform = 'scale(0.95)';
                  e.currentTarget.style.backgroundColor = 'rgba(39, 39, 42, 1)';
                }}
                onTouchEnd={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = '';
                  triggerHaptic(ImpactStyle.Heavy);
                  handleConfirmDelete();
                }}
                className="flex-1 py-4 text-red-500 font-medium transition-all duration-150"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Long Press Context Menu */}
      <LongPressMenu
        show={longPressMenu.show}
        position={{ x: longPressMenu.x, y: longPressMenu.y }}
        onClose={() => setLongPressMenu({ show: false, x: 0, y: 0 })}
        onEdit={() => {
          if (onEdit) onEdit(activity);
        }}
        onDelete={() => {
          setShowDeleteConfirm(true);
        }}
      />
    </>
  );
};

// Add Activity Modal
const AddActivityModal = ({ isOpen, onClose, onSave, pendingActivity = null, defaultDate = null, userData = null, onSaveCustomActivity = null, onStartWorkout = null, hasActiveWorkout = false }) => {
  // Mode: null = initial choice, 'start' = start new workout, 'completed' = log completed (existing flow)
  const [mode, setMode] = useState(null);
  const [activityType, setActivityType] = useState(null);
  const [subtype, setSubtype] = useState('');
  const [strengthType, setStrengthType] = useState(''); // Lifting, Bodyweight
  const [focusArea, setFocusArea] = useState(''); // Full Body, Upper, Lower, etc.
  const [customSport, setCustomSport] = useState('');
  const [customSportEmoji, setCustomSportEmoji] = useState('⚽');
  const [showSportEmojiPicker, setShowSportEmojiPicker] = useState(false);
  const [saveCustomSport, setSaveCustomSport] = useState(false);
  // Custom "Other" activity state
  const [customActivityName, setCustomActivityName] = useState('');
  const [customActivityEmoji, setCustomActivityEmoji] = useState('🏊');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [saveCustomActivity, setSaveCustomActivity] = useState(false);
  const [customActivityCategory, setCustomActivityCategory] = useState(''); // 'strength', 'cardio', or 'recovery'

  // Common activity emojis for picker
  const activityEmojis = ['💪', '🏃', '🚴', '🏊', '⛷️', '🧗', '🥊', '🎾', '⚽', '🏀', '🏈', '⚾', '🎯', '🏋️', '🤸', '🧘', '🥋', '🏇', '🚣', '🛹', '⛸️', '🎿', '🏌️', '🤾', '🏸', '🥏', '🎳', '🧊', '🔥', '⭐', '🌟', '✨', '💫', '🎉', '🏆', '🥇', '❤️', '💚', '💙', '🧠', '🦵', '💨', '⚡'];

  // Sports-specific emojis for picker
  const sportsEmojis = ['⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸️', '🥌', '🎿', '⛷️', '🏂', '🪂', '🏋️', '🤼', '🤸', '⛹️', '🤺', '🏇', '🧘', '🏄', '🚣', '🧗', '🚵', '🚴', '🤾', '🤽', '🏊', '🏌️'];
  const [date, setDate] = useState(defaultDate || getTodayDate());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [notes, setNotes] = useState('');
  const [distance, setDistance] = useState('');
  const [durationHours, setDurationHours] = useState(1);
  const [durationMinutes, setDurationMinutes] = useState(0);
  // Optional metrics (auto-filled from Apple Health or manual)
  const [calories, setCalories] = useState('');
  const [avgHr, setAvgHr] = useState('');
  const [maxHr, setMaxHr] = useState('');
  // Photo upload state
  const [activityPhoto, setActivityPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [isPhotoPrivate, setIsPhotoPrivate] = useState(false);
  const [showPhotoOptions, setShowPhotoOptions] = useState(false);
  const photoInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      // If there's a pending activity (from HealthKit or editing), go directly to completed flow
      // Otherwise show initial choice screen
      setMode(pendingActivity ? 'completed' : null);
      setActivityType(pendingActivity?.type || null);
      setSubtype(pendingActivity?.subtype || '');
      setStrengthType(pendingActivity?.strengthType || '');
      setFocusArea(pendingActivity?.focusArea || '');
      setCustomSport('');
      setCustomSportEmoji('⚽');
      setShowSportEmojiPicker(false);
      setSaveCustomSport(false);
      // For "Other" activities, load the saved custom name and emoji
      setCustomActivityName(pendingActivity?.type === 'Other' ? (pendingActivity?.subtype || '') : '');
      setCustomActivityEmoji(pendingActivity?.type === 'Other' ? (pendingActivity?.customEmoji || '🏊') : '🏊');
      setShowEmojiPicker(false);
      setSaveCustomActivity(false);
      setCustomActivityCategory(pendingActivity?.type === 'Other' ? (pendingActivity?.customActivityCategory || '') : '');
      setDate(defaultDate || pendingActivity?.date || getTodayDate());
      setShowDatePicker(false);
      setNotes(pendingActivity?.notes || '');
      setDistance(pendingActivity?.distance || '');
      // Default to 1 hour for manual input, use synced duration if from Apple Health
      setDurationHours(pendingActivity?.durationHours ?? 1);
      setDurationMinutes(pendingActivity?.durationMinutes ?? 0);
      setCalories(pendingActivity?.calories || '');
      setAvgHr(pendingActivity?.avgHr || '');
      setMaxHr(pendingActivity?.maxHr || '');
      // Reset photo state
      setActivityPhoto(null);
      setPhotoPreview(pendingActivity?.photoURL || null);
      setIsPhotoPrivate(pendingActivity?.isPhotoPrivate || false);
      setShowPhotoOptions(false);
    }
  }, [isOpen, pendingActivity, defaultDate]);

  // Generate calendar days for date picker
  const getCalendarDays = () => {
    const selectedDateObj = new Date(date + 'T12:00:00');
    const year = selectedDateObj.getFullYear();
    const month = selectedDateObj.getMonth();
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDay = firstDay.getDay();
    
    const days = [];
    // Add empty cells for days before first of month
    for (let i = 0; i < startingDay; i++) {
      days.push(null);
    }
    // Add days of month
    for (let i = 1; i <= daysInMonth; i++) {
      const dayDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      days.push(dayDate);
    }
    return { days, year, month };
  };

  const changeMonth = (delta) => {
    const currentDate = new Date(date + 'T12:00:00');
    currentDate.setMonth(currentDate.getMonth() + delta);
    const newDate = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-01`;
    setDate(newDate);
  };

  const activityTypes = [
    { name: 'Strength Training', icon: '🏋️', subtypes: [] }, // Handled separately
    { name: 'Running', icon: '🏃', subtypes: ['Easy', 'Tempo', 'Long', 'Sprints', 'Recovery'] },
    { name: 'Cycle', icon: '🚴', subtypes: ['Road', 'Spin', 'Mountain'] },
    { name: 'Sports', icon: '🏀', subtypes: [
      { name: 'Basketball', icon: '🏀' },
      { name: 'Soccer', icon: '⚽' },
      { name: 'Football', icon: '🏈' },
      { name: 'Tennis', icon: '🎾' },
      { name: 'Golf', icon: '⛳' },
      { name: 'Other', icon: '🏆' }
    ]},
    { name: 'Yoga', icon: '🧘', subtypes: ['Vinyasa', 'Power', 'Hot', 'Yin', 'Restorative'] },
    { name: 'Pilates', icon: '🤸', subtypes: ['Mat', 'Reformer', 'Tower', 'Chair'] },
    { name: 'Cold Plunge', icon: '🧊', subtypes: [] },
    { name: 'Sauna', icon: '🔥', subtypes: [] },
    { name: 'Other', icon: '🏊', subtypes: [] }
  ];

  // Strength training configuration
  const strengthTypes = [
    { name: 'Lifting', icon: '🏋️', hasFocusArea: true },
    { name: 'Bodyweight', icon: '💪', hasFocusArea: true }
  ];

  const focusAreas = ['Full Body', 'Upper', 'Lower', 'Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Abs'];

  // Determine default "count toward" based on activity and subtype
  const getDefaultCountToward = (type, sub) => {
    if (type === 'Yoga') {
      if (['Power', 'Hot', 'Vinyasa'].includes(sub)) return 'cardio';
      return 'recovery'; // Yin, Restorative
    }
    if (type === 'Pilates') {
      return 'recovery'; // Default to recovery, user can change
    }
    return null;
  };

  const [countToward, setCountToward] = useState(null);

  // Update countToward when subtype changes for Yoga/Pilates
  useEffect(() => {
    if (activityType === 'Yoga' || activityType === 'Pilates') {
      setCountToward(getDefaultCountToward(activityType, subtype));
    } else {
      setCountToward(null);
    }
  }, [activityType, subtype]);

  const selectedType = activityTypes.find(t => t.name === activityType);
  const showCustomSportInput = activityType === 'Sports' && subtype === 'Other';
  const showCustomActivityInput = activityType === 'Other';
  const showCountToward = activityType === 'Yoga' || activityType === 'Pilates';
  const isFromAppleHealth = !!pendingActivity?.fromAppleHealth;

  // Photo handling with Capacitor Camera
  const handleChooseFromLibrary = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        const image = await Camera.getPhoto({
          quality: 90,
          allowEditing: false,
          resultType: CameraResultType.DataUrl,
          source: CameraSource.Photos
        });

        if (image.dataUrl) {
          const response = await fetch(image.dataUrl);
          const blob = await response.blob();
          const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
          setActivityPhoto(file);
          setPhotoPreview(image.dataUrl);
        }
      } catch (error) {
        if (error.message !== 'User cancelled photos app') {
          console.error('Error picking photo:', error);
        }
      }
    } else {
      photoInputRef.current?.click();
    }
  };

  const handleTakePhoto = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        const image = await Camera.getPhoto({
          quality: 90,
          allowEditing: false,
          resultType: CameraResultType.DataUrl,
          source: CameraSource.Camera
        });

        if (image.dataUrl) {
          const response = await fetch(image.dataUrl);
          const blob = await response.blob();
          const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
          setActivityPhoto(file);
          setPhotoPreview(image.dataUrl);
        }
      } catch (error) {
        if (error.message !== 'User cancelled photos app') {
          console.error('Error taking photo:', error);
        }
      }
    } else {
      cameraInputRef.current?.click();
    }
  };

  const handleFileInput = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('Image must be less than 10MB');
      return;
    }
    setActivityPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
    e.target.value = '';
  };

  const clearPhoto = () => {
    if (photoPreview && activityPhoto && !photoPreview.startsWith('data:')) {
      URL.revokeObjectURL(photoPreview);
    }
    setActivityPhoto(null);
    setPhotoPreview(null);
  };

  // Get user's custom activities
  const customActivities = userData?.customActivities || [];

  const [isAnimating, setIsAnimating] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef(0);
  const modalRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setIsClosing(false);
      setDragY(0);
      // Trigger animation after mount
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
      setDragY(0);
      onClose();
    }, 300);
  };

  // Swipe-to-dismiss handlers
  const handleDragStart = (e) => {
    // Only allow drag from the header area (first 60px)
    const touch = e.touches[0];
    const modalTop = modalRef.current?.getBoundingClientRect().top || 0;
    if (touch.clientY - modalTop < 60) {
      setIsDragging(true);
      dragStartY.current = touch.clientY;
    }
  };

  const handleDragMove = (e) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    const diff = touch.clientY - dragStartY.current;
    // Only allow dragging down
    if (diff > 0) {
      setDragY(diff);
    }
  };

  const handleDragEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);
    // If dragged more than 100px, close the modal
    if (dragY > 100) {
      triggerHaptic(ImpactStyle.Light);
      handleClose();
    } else {
      // Snap back
      setDragY(0);
    }
  };

  if (!isOpen && !isClosing) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col transition-all duration-300"
      style={{
        backgroundColor: isClosing ? 'rgba(0,0,0,0)' : (isAnimating && dragY === 0 ? 'rgba(0,0,0,0.95)' : `rgba(0,0,0,${Math.max(0, 0.95 - dragY / 300)})`)
      }}
      onClick={(e) => e.target === e.currentTarget && handleClose()}
    >
      <div
        ref={modalRef}
        className={`flex-1 flex flex-col mt-12 rounded-t-3xl overflow-hidden ${isDragging ? '' : 'transition-all duration-300 ease-out'}`}
        style={{
          backgroundColor: '#0A0A0A',
          transform: isAnimating ? `translateY(${dragY}px)` : 'translateY(100%)'
        }}
        onTouchStart={handleDragStart}
        onTouchMove={handleDragMove}
        onTouchEnd={handleDragEnd}
      >
        {/* Drag handle indicator */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-600" />
        </div>
        <div className="flex items-center justify-between px-4 pb-4 border-b border-white/10">
          <button 
            onClick={handleClose} 
            className="text-gray-400 text-sm transition-all duration-150 px-2 py-1 rounded-lg"
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
            Cancel
          </button>
          <h2 className="font-bold">{pendingActivity?.id ? 'Edit Activity' : mode === 'start' ? 'Start Workout' : 'Log Activity'}</h2>
          <button
          onClick={() => {
            // Build subtype for strength training
            let finalSubtype = subtype;
            let finalType = activityType;
            if (activityType === 'Strength Training') {
              finalSubtype = focusArea ? `${strengthType} - ${focusArea}` : strengthType;
            } else if (showCustomSportInput) {
              finalSubtype = customSport;
            } else if (showCustomActivityInput && customActivityName) {
              // For "Other" activity, store the custom name as subtype
              finalSubtype = customActivityName;
            }

            // Save custom activity to user profile if requested
            if (showCustomActivityInput && saveCustomActivity && customActivityName && onSaveCustomActivity) {
              onSaveCustomActivity({ name: customActivityName, emoji: customActivityEmoji, category: customActivityCategory });
            }

            // Get the sport emoji (either custom or from predefined sport)
            let sportEmoji = undefined;
            if (activityType === 'Sports') {
              if (showCustomSportInput) {
                sportEmoji = customSportEmoji;
              } else if (subtype) {
                const sportSubtype = selectedType?.subtypes?.find(st => typeof st === 'object' && st.name === subtype);
                sportEmoji = sportSubtype?.icon;
              }
            }

            // Get the icon for this activity type
            const selectedTypeData = activityTypes.find(t => t.name === finalType);
            const icon = showCustomActivityInput ? customActivityEmoji : (sportEmoji || selectedTypeData?.icon || '💪');

            // START WORKOUT MODE: Create active workout instead of saving
            if (mode === 'start' && onStartWorkout) {
              onStartWorkout({
                type: finalType,
                subtype: finalSubtype,
                strengthType: activityType === 'Strength Training' ? strengthType : undefined,
                focusArea: activityType === 'Strength Training' ? focusArea : undefined,
                sportEmoji,
                customEmoji: showCustomActivityInput ? customActivityEmoji : undefined,
                countToward: showCustomActivityInput ? customActivityCategory : (countToward || undefined),
                customActivityCategory: showCustomActivityInput ? customActivityCategory : undefined,
                icon,
                startTime: new Date().toISOString()
              });
              handleClose();
              return;
            }

            // COMPLETED MODE: Normal save flow
            onSave({
              id: pendingActivity?.id, // Preserve ID if editing
              time: pendingActivity?.time, // Preserve time if editing
              type: finalType,
              subtype: finalSubtype,
              strengthType: activityType === 'Strength Training' ? strengthType : undefined,
              focusArea: activityType === 'Strength Training' ? focusArea : undefined,
              date,
              notes,
              distance: distance ? parseFloat(distance) : undefined,
              duration: durationHours * 60 + durationMinutes,
              calories: calories ? parseInt(calories) : undefined,
              avgHr: avgHr ? parseInt(avgHr) : undefined,
              maxHr: maxHr ? parseInt(maxHr) : undefined,
              saveCustomSport,
              sportEmoji,
              customEmoji: showCustomActivityInput ? customActivityEmoji : undefined, // Store emoji for "Other" activities
              fromAppleHealth: isFromAppleHealth,
              countToward: showCustomActivityInput ? customActivityCategory : (countToward || undefined),
              customActivityCategory: showCustomActivityInput ? customActivityCategory : undefined,
              // Photo data
              photoFile: activityPhoto,
              photoURL: !activityPhoto ? (pendingActivity?.photoURL || null) : undefined, // Preserve existing photo if not changing
              isPhotoPrivate: isPhotoPrivate
            });
            handleClose();
          }}
          className="font-bold transition-all duration-150 px-2 py-1 rounded-lg"
          style={{ color: !activityType || (showCustomSportInput && !customSport) || (showCustomActivityInput && (!customActivityName || !customActivityCategory)) || (activityType === 'Strength Training' && (!strengthType || !focusArea)) ? 'rgba(0,255,148,0.3)' : '#00FF94' }}
          disabled={!activityType || (showCustomSportInput && !customSport) || (showCustomActivityInput && (!customActivityName || !customActivityCategory)) || (activityType === 'Strength Training' && (!strengthType || !focusArea))}
          onTouchStart={(e) => {
            if (!e.currentTarget.disabled) {
              e.currentTarget.style.transform = 'scale(0.9)';
              e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.2)';
            }
          }}
          onTouchEnd={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
          onMouseDown={(e) => {
            if (!e.currentTarget.disabled) {
              e.currentTarget.style.transform = 'scale(0.9)';
              e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.2)';
            }
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
          {mode === 'start' ? 'Start' : 'Save'}
        </button>
      </div>

      {pendingActivity?.fromAppleHealth && (
        <div className="mx-4 mt-4 p-3 rounded-xl" style={{ backgroundColor: 'rgba(0,255,148,0.1)', border: '1px solid rgba(0,255,148,0.3)' }}>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-lg">📱</span>
            <span style={{ color: '#00FF94' }}>Synced from Apple Health</span>
          </div>
          <div className="flex gap-4 mt-2 text-xs text-gray-400">
            {pendingActivity.calories && <span>{pendingActivity.calories} cal</span>}
            {pendingActivity.duration && <span>{pendingActivity.duration} min</span>}
            {pendingActivity.avgHr && <span>Avg HR: {pendingActivity.avgHr}</span>}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 pb-32" style={{ overscrollBehavior: 'contain' }}>
        {/* Initial choice: Start Workout vs Log Completed */}
        {mode === null ? (
          <div className="flex flex-col gap-4 pt-4">
            {/* Start Workout option */}
            <button
              onClick={() => {
                if (hasActiveWorkout) {
                  // Warn user there's already an active workout
                  alert('You already have an active workout in progress. Finish it first before starting a new one.');
                  return;
                }
                setMode('start');
                triggerHaptic(ImpactStyle.Medium);
              }}
              className="p-5 rounded-2xl text-left transition-all duration-150 flex items-center gap-4"
              style={{
                backgroundColor: 'rgba(0,255,148,0.1)',
                border: '1px solid rgba(0,255,148,0.3)'
              }}
              onTouchStart={(e) => {
                e.currentTarget.style.transform = 'scale(0.98)';
                e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.15)';
              }}
              onTouchEnd={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.1)';
              }}
              onMouseDown={(e) => {
                e.currentTarget.style.transform = 'scale(0.98)';
                e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.15)';
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.1)';
              }}
            >
              <div className="w-14 h-14 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(0,255,148,0.2)' }}>
                <svg className="w-7 h-7 ml-1" fill="#00FF94" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              </div>
              <div className="flex-1">
                <div className="font-semibold text-lg" style={{ color: '#00FF94' }}>Start Workout</div>
                <div className="text-sm text-gray-400 mt-0.5">Begin tracking a new workout now</div>
              </div>
              <div className="text-gray-500">→</div>
            </button>

            {/* Log Completed option */}
            <button
              onClick={() => {
                setMode('completed');
                triggerHaptic(ImpactStyle.Light);
              }}
              className="p-5 rounded-2xl text-left transition-all duration-150 flex items-center gap-4"
              style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
              onTouchStart={(e) => {
                e.currentTarget.style.transform = 'scale(0.98)';
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)';
              }}
              onTouchEnd={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
              }}
              onMouseDown={(e) => {
                e.currentTarget.style.transform = 'scale(0.98)';
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)';
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
              }}
            >
              <div className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>
                ✓
              </div>
              <div className="flex-1">
                <div className="font-semibold text-lg">Log Completed</div>
                <div className="text-sm text-gray-400 mt-0.5">Record a workout you already finished</div>
              </div>
              <div className="text-gray-500">→</div>
            </button>
          </div>
        ) : !activityType ? (
          <div className="grid grid-cols-2 gap-3">
            {/* Back to mode selection */}
            {!pendingActivity && (
              <button
                onClick={() => {
                  setMode(null);
                  triggerHaptic(ImpactStyle.Light);
                }}
                className="col-span-2 mb-2 flex items-center gap-2 text-gray-400 text-sm"
              >
                <span>←</span>
                <span>Back</span>
              </button>
            )}
            {/* Standard activity types (excluding "Other" which will be shown last) */}
            {activityTypes.filter(t => t.name !== 'Other').map((type) => (
              <button
                key={type.name}
                onClick={() => setActivityType(type.name)}
                className="p-4 rounded-xl text-left transition-all duration-150"
                style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                onTouchStart={(e) => {
                  e.currentTarget.style.transform = 'scale(0.95)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                  triggerHaptic(ImpactStyle.Light);
                }}
                onTouchEnd={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = 'scale(0.95)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                }}
              >
                <span className="text-2xl">{type.icon}</span>
                <div className="mt-2 font-semibold">{type.name}</div>
              </button>
            ))}
            {/* User's saved custom activities */}
            {customActivities.map((customItem) => {
              // Support both old string format and new object format { name, emoji }
              const activityName = typeof customItem === 'string' ? customItem : customItem.name;
              const activityEmoji = typeof customItem === 'string' ? '⭐' : (customItem.emoji || '⭐');
              return (
                <button
                  key={`custom-${activityName}`}
                  onClick={() => {
                    setActivityType('Other');
                    setCustomActivityName(activityName);
                    setCustomActivityEmoji(activityEmoji);
                  }}
                  className="p-4 rounded-xl text-left transition-all duration-150"
                  style={{ backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(0,255,148,0.2)' }}
                  onTouchStart={(e) => {
                    e.currentTarget.style.transform = 'scale(0.95)';
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                    triggerHaptic(ImpactStyle.Light);
                  }}
                  onTouchEnd={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                  }}
                  onMouseDown={(e) => {
                    e.currentTarget.style.transform = 'scale(0.95)';
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                  }}
                  onMouseUp={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                  }}
                >
                  <span className="text-2xl">{activityEmoji}</span>
                  <div className="mt-2 font-semibold">{activityName}</div>
                </button>
              );
            })}
            {/* "Other" option always shown last */}
            <button
              key="Other"
              onClick={() => setActivityType('Other')}
              className="p-4 rounded-xl text-left transition-all duration-150"
              style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
              onTouchStart={(e) => {
                e.currentTarget.style.transform = 'scale(0.95)';
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                triggerHaptic(ImpactStyle.Light);
              }}
              onTouchEnd={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
              }}
              onMouseDown={(e) => {
                e.currentTarget.style.transform = 'scale(0.95)';
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
              }}
            >
              <span className="text-2xl">🏊</span>
              <div className="mt-2 font-semibold">Other</div>
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Back button */}
            <button
              onClick={() => {
                setActivityType(null);
                setSubtype('');
                setStrengthType('');
                setFocusArea('');
                setCustomSport('');
                setCustomActivityName('');
                setCustomActivityEmoji('🏊');
                setShowEmojiPicker(false);
                setCountToward(null);
              }}
              className="flex items-center gap-2 text-gray-400 text-sm transition-all duration-150 px-2 py-1 rounded-lg"
              onTouchStart={(e) => {
                e.currentTarget.style.transform = 'scale(0.95)';
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                triggerHaptic(ImpactStyle.Light);
              }}
              onTouchEnd={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
              onMouseDown={(e) => {
                e.currentTarget.style.transform = 'scale(0.95)';
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
              <span>←</span>
              <span>Back to activities</span>
            </button>

            {/* Selected activity display with Change option */}
            <button
              onClick={() => {
                setActivityType(null);
                setSubtype('');
                setStrengthType('');
                setFocusArea('');
                setCustomSport('');
                setCustomActivityName('');
                setCustomActivityEmoji('🏊');
                setShowEmojiPicker(false);
                setCountToward(null);
              }}
              className="flex items-center gap-3 p-3 rounded-xl w-full transition-all duration-150"
              style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
              onTouchStart={(e) => {
                e.currentTarget.style.transform = 'scale(0.98)';
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                triggerHaptic(ImpactStyle.Light);
              }}
              onTouchEnd={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
              }}
              onMouseDown={(e) => {
                e.currentTarget.style.transform = 'scale(0.98)';
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
              }}
            >
              <span className="text-2xl">{
                activityType === 'Other' ? customActivityEmoji :
                activityType === 'Sports' && subtype ? (
                  subtype === 'Other' ? customSportEmoji :
                  (selectedType?.subtypes?.find(st => typeof st === 'object' && st.name === subtype)?.icon || selectedType?.icon)
                ) :
                selectedType?.icon || '🏊'
              }</span>
              <span className="font-semibold">{activityType === 'Other' && customActivityName ? customActivityName : activityType}</span>
              <span className="ml-auto text-gray-500 text-sm">Change</span>
            </button>

            {/* Strength Training Selection */}
            {activityType === 'Strength Training' && (
              <>
                {/* Training Type Selection */}
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">Training Type</label>
                  <div className="flex flex-wrap gap-2">
                    {strengthTypes.map((st) => (
                      <button
                        key={st.name}
                        onClick={() => {
                          setStrengthType(st.name);
                          setFocusArea(''); // Reset focus area when changing type
                        }}
                        className="px-4 py-2 rounded-full text-sm transition-all duration-200 flex items-center gap-2"
                        style={{
                          backgroundColor: strengthType === st.name ? 'rgba(0,255,148,0.2)' : 'rgba(255,255,255,0.05)',
                          border: strengthType === st.name ? '1px solid #00FF94' : '1px solid transparent',
                          color: strengthType === st.name ? '#00FF94' : 'white'
                        }}
                      >
                        <span>{st.icon}</span>
                        {st.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Focus Area Selection (for Lifting and Bodyweight) */}
                {strengthType && strengthTypes.find(s => s.name === strengthType)?.hasFocusArea && (
                  <div>
                    <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">Focus Area</label>
                    <div className="flex flex-wrap gap-2">
                      {focusAreas.map((area) => (
                        <button
                          key={area}
                          onClick={() => setFocusArea(area)}
                          className="px-4 py-2 rounded-full text-sm transition-all duration-200"
                          style={{
                            backgroundColor: focusArea === area ? 'rgba(0,255,148,0.2)' : 'rgba(255,255,255,0.05)',
                            border: focusArea === area ? '1px solid #00FF94' : '1px solid transparent',
                            color: focusArea === area ? '#00FF94' : 'white'
                          }}
                        >
                          {area}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Regular subtypes for non-strength activities */}
            {activityType !== 'Strength Training' && selectedType?.subtypes.length > 0 && (
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">Type</label>
                <div className="flex flex-wrap gap-2">
                  {selectedType.subtypes.map((st) => {
                    // Handle both string and object subtypes
                    const stName = typeof st === 'object' ? st.name : st;
                    const stIcon = typeof st === 'object' ? st.icon : null;
                    return (
                      <button
                        key={stName}
                        onClick={() => setSubtype(stName)}
                        className="px-4 py-2 rounded-full text-sm transition-all duration-200 flex items-center gap-1.5"
                        style={{
                          backgroundColor: subtype === stName ? 'rgba(0,255,148,0.2)' : 'rgba(255,255,255,0.05)',
                          border: subtype === stName ? '1px solid #00FF94' : '1px solid transparent',
                          color: subtype === stName ? '#00FF94' : 'white'
                        }}
                      >
                        {stIcon && <span>{stIcon}</span>}
                        {stName}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Count Toward selector for Yoga/Pilates */}
            {showCountToward && (
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">Count Toward Goal</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setCountToward('lifting')}
                    className="flex-1 p-3 rounded-xl text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2"
                    style={{
                      backgroundColor: countToward === 'lifting' ? 'rgba(0,255,148,0.2)' : 'rgba(255,255,255,0.05)',
                      border: countToward === 'lifting' ? '1px solid #00FF94' : '1px solid transparent',
                      color: countToward === 'lifting' ? '#00FF94' : 'white'
                    }}
                  >
                    <span>🏋️</span> Strength
                  </button>
                  <button
                    onClick={() => setCountToward('cardio')}
                    className="flex-1 p-3 rounded-xl text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2"
                    style={{
                      backgroundColor: countToward === 'cardio' ? 'rgba(255,149,0,0.2)' : 'rgba(255,255,255,0.05)',
                      border: countToward === 'cardio' ? '1px solid #FF9500' : '1px solid transparent',
                      color: countToward === 'cardio' ? '#FF9500' : 'white'
                    }}
                  >
                    <span>🏃</span> Cardio
                  </button>
                  <button
                    onClick={() => setCountToward('recovery')}
                    className="flex-1 p-3 rounded-xl text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2"
                    style={{
                      backgroundColor: countToward === 'recovery' ? 'rgba(0,209,255,0.2)' : 'rgba(255,255,255,0.05)',
                      border: countToward === 'recovery' ? '1px solid #00D1FF' : '1px solid transparent',
                      color: countToward === 'recovery' ? '#00D1FF' : 'white'
                    }}
                  >
                    <span>🧊</span> Recovery
                  </button>
                </div>
                <p className="text-[11px] text-gray-500 mt-2">
                  💡 {activityType} can count toward different goals depending on intensity. Power and hot styles often count as cardio or lifting, while restorative sessions count as recovery.
                </p>
              </div>
            )}

            {showCustomSportInput && (
              <div className="p-4 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">Sport Name</label>
                <div className="flex gap-2 mb-3">
                  {/* Sport Emoji Picker Button */}
                  <button
                    type="button"
                    onClick={() => setShowSportEmojiPicker(!showSportEmojiPicker)}
                    onTouchStart={() => triggerHaptic(ImpactStyle.Light)}
                    className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl transition-all"
                    style={{
                      backgroundColor: showSportEmojiPicker ? 'rgba(255,149,0,0.2)' : 'rgba(255,255,255,0.05)',
                      border: showSportEmojiPicker ? '1px solid #FF9500' : '1px solid rgba(255,255,255,0.1)'
                    }}
                  >
                    {customSportEmoji}
                  </button>
                  <input
                    type="text"
                    value={customSport}
                    onChange={(e) => setCustomSport(e.target.value)}
                    className="flex-1 p-3 rounded-xl bg-white/5 border border-white/10 text-white"
                    placeholder="Enter sport name..."
                  />
                </div>

                {/* Sport Emoji Picker Grid */}
                {showSportEmojiPicker && (
                  <div className="mb-3 p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    <div className="flex flex-wrap gap-2">
                      {sportsEmojis.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => {
                            setCustomSportEmoji(emoji);
                            setShowSportEmojiPicker(false);
                            triggerHaptic(ImpactStyle.Light);
                          }}
                          className="w-10 h-10 rounded-lg flex items-center justify-center text-xl transition-all hover:bg-white/10"
                          style={{
                            backgroundColor: customSportEmoji === emoji ? 'rgba(255,149,0,0.2)' : 'transparent',
                            border: customSportEmoji === emoji ? '1px solid #FF9500' : '1px solid transparent'
                          }}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <label className="flex items-center gap-3 cursor-pointer">
                  <div
                    className="w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all"
                    style={{
                      borderColor: saveCustomSport ? '#00FF94' : 'rgba(255,255,255,0.3)',
                      backgroundColor: saveCustomSport ? 'rgba(0,255,148,0.2)' : 'transparent'
                    }}
                    onClick={() => { setSaveCustomSport(!saveCustomSport); triggerHaptic(ImpactStyle.Light); }}
                  >
                    {saveCustomSport && <span style={{ color: '#00FF94' }}>✓</span>}
                  </div>
                  <span className="text-sm text-gray-400">Save as option for future</span>
                </label>
              </div>
            )}

            {/* Custom "Other" Activity Input */}
            {showCustomActivityInput && (
              <div className="p-4 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">Activity Name</label>
                <div className="flex gap-2 mb-3">
                  {/* Emoji Picker Button */}
                  <button
                    type="button"
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    onTouchStart={() => triggerHaptic(ImpactStyle.Light)}
                    className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl transition-all"
                    style={{
                      backgroundColor: showEmojiPicker ? 'rgba(0,255,148,0.2)' : 'rgba(255,255,255,0.05)',
                      border: showEmojiPicker ? '1px solid #00FF94' : '1px solid rgba(255,255,255,0.1)'
                    }}
                  >
                    {customActivityEmoji}
                  </button>
                  <input
                    type="text"
                    value={customActivityName}
                    onChange={(e) => setCustomActivityName(e.target.value)}
                    className="flex-1 p-3 rounded-xl bg-white/5 border border-white/10 text-white"
                    placeholder="Enter activity name..."
                  />
                </div>

                {/* Emoji Picker Grid */}
                {showEmojiPicker && (
                  <div className="mb-3 p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    <div className="flex flex-wrap gap-2">
                      {activityEmojis.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => {
                            setCustomActivityEmoji(emoji);
                            setShowEmojiPicker(false);
                            triggerHaptic(ImpactStyle.Light);
                          }}
                          className="w-10 h-10 rounded-lg flex items-center justify-center text-xl transition-all hover:bg-white/10"
                          style={{
                            backgroundColor: customActivityEmoji === emoji ? 'rgba(0,255,148,0.2)' : 'transparent',
                            border: customActivityEmoji === emoji ? '1px solid #00FF94' : '1px solid transparent'
                          }}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Category Selection */}
                <div className="mt-4">
                  <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">Count Toward</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => { setCustomActivityCategory('strength'); triggerHaptic(ImpactStyle.Light); }}
                      className="p-3 rounded-xl text-center transition-all"
                      style={{
                        backgroundColor: customActivityCategory === 'strength' ? 'rgba(0,255,148,0.15)' : 'rgba(255,255,255,0.05)',
                        border: customActivityCategory === 'strength' ? '1px solid #00FF94' : '1px solid transparent'
                      }}
                    >
                      <span className="text-lg">🏋️</span>
                      <div className="text-xs mt-1" style={{ color: customActivityCategory === 'strength' ? '#00FF94' : 'rgba(255,255,255,0.6)' }}>Strength</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCustomActivityCategory('cardio'); triggerHaptic(ImpactStyle.Light); }}
                      className="p-3 rounded-xl text-center transition-all"
                      style={{
                        backgroundColor: customActivityCategory === 'cardio' ? 'rgba(255,149,0,0.15)' : 'rgba(255,255,255,0.05)',
                        border: customActivityCategory === 'cardio' ? '1px solid #FF9500' : '1px solid transparent'
                      }}
                    >
                      <span className="text-lg">🏃</span>
                      <div className="text-xs mt-1" style={{ color: customActivityCategory === 'cardio' ? '#FF9500' : 'rgba(255,255,255,0.6)' }}>Cardio</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCustomActivityCategory('recovery'); triggerHaptic(ImpactStyle.Light); }}
                      className="p-3 rounded-xl text-center transition-all"
                      style={{
                        backgroundColor: customActivityCategory === 'recovery' ? 'rgba(0,209,255,0.15)' : 'rgba(255,255,255,0.05)',
                        border: customActivityCategory === 'recovery' ? '1px solid #00D1FF' : '1px solid transparent'
                      }}
                    >
                      <span className="text-lg">🧊</span>
                      <div className="text-xs mt-1" style={{ color: customActivityCategory === 'recovery' ? '#00D1FF' : 'rgba(255,255,255,0.6)' }}>Recovery</div>
                    </button>
                  </div>
                </div>

                <label className="flex items-center gap-3 cursor-pointer mt-4">
                  <div
                    className="w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all"
                    style={{
                      borderColor: saveCustomActivity ? '#00FF94' : 'rgba(255,255,255,0.3)',
                      backgroundColor: saveCustomActivity ? 'rgba(0,255,148,0.2)' : 'transparent'
                    }}
                    onClick={() => { setSaveCustomActivity(!saveCustomActivity); triggerHaptic(ImpactStyle.Light); }}
                  >
                    {saveCustomActivity && <span style={{ color: '#00FF94' }}>✓</span>}
                  </div>
                  <span className="text-sm text-gray-400">Save as option for future</span>
                </label>
              </div>
            )}

            {(activityType === 'Running' || activityType === 'Cycle') && (
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">Distance (mi)</label>
                <input
                  type="number"
                  value={distance}
                  onChange={(e) => setDistance(e.target.value)}
                  className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-white"
                  placeholder="0.0"
                  step="0.1"
                />
              </div>
            )}

            {/* Hide duration, date, metrics, notes, photo for "Start Workout" mode - these are entered when finishing */}
            {mode !== 'start' && (
              <>
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">
                Duration {isFromAppleHealth && <span style={{ color: '#00FF94' }}>(from Apple Health)</span>}
              </label>
              <DurationPicker
                hours={durationHours}
                minutes={durationMinutes}
                onChange={(h, m) => {
                  setDurationHours(h);
                  setDurationMinutes(m);
                }}
              />
            </div>

            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">Date</label>
              <button
                onClick={() => setShowDatePicker(!showDatePicker)}
                className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-white text-left flex items-center justify-between transition-all duration-150"
                onTouchStart={(e) => {
                  e.currentTarget.style.transform = 'scale(0.98)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                  triggerHaptic(ImpactStyle.Light);
                }}
                onTouchEnd={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = 'scale(0.98)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                }}
              >
                <span>
                  {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
                <span className="text-gray-400">{showDatePicker ? '▲' : '▼'}</span>
              </button>
              
              {/* Calendar Dropdown */}
              {showDatePicker && (() => {
                const { days, year, month } = getCalendarDays();
                const monthName = new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                const today = getTodayDate();
                
                return (
                  <div className="mt-2 p-3 rounded-xl bg-white/5 border border-white/10">
                    {/* Month Navigation */}
                    <div className="flex items-center justify-between mb-3">
                      <button 
                        onClick={() => changeMonth(-1)}
                        className="p-2 text-gray-400 hover:text-white rounded-lg transition-all duration-150"
                        onTouchStart={(e) => {
                          e.currentTarget.style.transform = 'scale(0.85)';
                          e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                        }}
                        onTouchEnd={(e) => {
                          e.currentTarget.style.transform = 'scale(1)';
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                        onMouseDown={(e) => {
                          e.currentTarget.style.transform = 'scale(0.85)';
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
                        ←
                      </button>
                      <span className="font-medium">{monthName}</span>
                      <button 
                        onClick={() => changeMonth(1)}
                        className="p-2 text-gray-400 hover:text-white rounded-lg transition-all duration-150"
                        onTouchStart={(e) => {
                          e.currentTarget.style.transform = 'scale(0.85)';
                          e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                        }}
                        onTouchEnd={(e) => {
                          e.currentTarget.style.transform = 'scale(1)';
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                        onMouseDown={(e) => {
                          e.currentTarget.style.transform = 'scale(0.85)';
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
                        →
                      </button>
                    </div>
                    
                    {/* Day Headers */}
                    <div className="grid grid-cols-7 gap-1 mb-2">
                      {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                        <div key={i} className="text-center text-[10px] text-gray-500">{d}</div>
                      ))}
                    </div>
                    
                    {/* Calendar Days */}
                    <div className="grid grid-cols-7 gap-1">
                      {days.map((dayDate, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            if (dayDate) {
                              setDate(dayDate);
                              setShowDatePicker(false);
                            }
                          }}
                          disabled={!dayDate}
                          className={`aspect-square rounded-lg text-sm flex items-center justify-center transition-all ${
                            !dayDate ? 'invisible' : 
                            dayDate === date ? 'font-bold' : 
                            dayDate === today ? 'border border-white/30' : 
                            'hover:bg-white/10'
                          }`}
                          style={{
                            backgroundColor: dayDate === date ? '#00FF94' : 'transparent',
                            color: dayDate === date ? 'black' : 'white'
                          }}
                        >
                          {dayDate ? parseInt(dayDate.split('-')[2]) : ''}
                        </button>
                      ))}
                    </div>
                    
                    {/* Quick Select */}
                    <div className="mt-3 pt-3 border-t border-white/10 flex gap-2">
                      <button
                        onClick={() => {
                          setDate(today);
                          setShowDatePicker(false);
                        }}
                        className="flex-1 py-2 rounded-lg text-xs font-medium transition-all duration-150"
                        style={{ backgroundColor: 'rgba(0,255,148,0.1)', color: '#00FF94' }}
                        onTouchStart={(e) => {
                          e.currentTarget.style.transform = 'scale(0.95)';
                          e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.2)';
                        }}
                        onTouchEnd={(e) => {
                          e.currentTarget.style.transform = 'scale(1)';
                          e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.1)';
                        }}
                        onMouseDown={(e) => {
                          e.currentTarget.style.transform = 'scale(0.95)';
                          e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.2)';
                        }}
                        onMouseUp={(e) => {
                          e.currentTarget.style.transform = 'scale(1)';
                          e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.1)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'scale(1)';
                          e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.1)';
                        }}
                      >
                        Today
                      </button>
                      <button
                        onClick={() => {
                          const yesterday = new Date();
                          yesterday.setDate(yesterday.getDate() - 1);
                          const yDate = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
                          setDate(yDate);
                          setShowDatePicker(false);
                        }}
                        className="flex-1 py-2 rounded-lg text-xs font-medium bg-white/5 transition-all duration-150"
                        onTouchStart={(e) => {
                          e.currentTarget.style.transform = 'scale(0.95)';
                          e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                        }}
                        onTouchEnd={(e) => {
                          e.currentTarget.style.transform = 'scale(1)';
                          e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                        }}
                        onMouseDown={(e) => {
                          e.currentTarget.style.transform = 'scale(0.95)';
                          e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                        }}
                        onMouseUp={(e) => {
                          e.currentTarget.style.transform = 'scale(1)';
                          e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'scale(1)';
                          e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                        }}
                      >
                        Yesterday
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Optional Metrics Section */}
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">
                Workout Metrics {isFromAppleHealth ? <span style={{ color: '#00FF94' }}>(from Apple Health)</span> : <span className="text-gray-600">(optional)</span>}
              </label>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <input
                    type="number"
                    value={calories}
                    onChange={(e) => setCalories(e.target.value)}
                    className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-white text-center"
                    placeholder="—"
                  />
                  <div className="text-[10px] text-gray-500 text-center mt-1">Calories</div>
                </div>
                <div>
                  <input
                    type="number"
                    value={avgHr}
                    onChange={(e) => setAvgHr(e.target.value)}
                    className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-white text-center"
                    placeholder="—"
                  />
                  <div className="text-[10px] text-gray-500 text-center mt-1">Avg HR</div>
                </div>
                <div>
                  <input
                    type="number"
                    value={maxHr}
                    onChange={(e) => setMaxHr(e.target.value)}
                    className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-white text-center"
                    placeholder="—"
                  />
                  <div className="text-[10px] text-gray-500 text-center mt-1">Max HR</div>
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-white resize-none"
                rows={3}
                placeholder="How did it feel?"
              />
            </div>

            {/* Photo Upload Section */}
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">Photo (optional)</label>

              {/* Hidden file input for web fallback */}
              <input
                type="file"
                ref={photoInputRef}
                onChange={handleFileInput}
                accept="image/*"
                className="hidden"
              />

              {photoPreview ? (
                <div className="space-y-3">
                  {/* Photo Preview */}
                  <div className="relative rounded-xl overflow-hidden">
                    <img
                      src={photoPreview}
                      alt="Activity preview"
                      className="w-full h-48 object-cover"
                    />
                    <button
                      onClick={clearPhoto}
                      className="absolute top-2 right-2 w-8 h-8 bg-black/60 rounded-full flex items-center justify-center"
                    >
                      <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {/* Privacy Toggle */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-white/5">
                    <span className="text-sm text-gray-300">Who can see this?</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setIsPhotoPrivate(false)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${!isPhotoPrivate ? 'bg-[#00FF94] text-black' : 'bg-white/10 text-gray-400'}`}
                      >
                        Friends
                      </button>
                      <button
                        onClick={() => setIsPhotoPrivate(true)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${isPhotoPrivate ? 'bg-[#00FF94] text-black' : 'bg-white/10 text-gray-400'}`}
                      >
                        Only Me
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={handleTakePhoto}
                    className="flex-1 flex items-center justify-center gap-2 p-3 rounded-xl bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span className="text-sm">Camera</span>
                  </button>
                  <button
                    onClick={handleChooseFromLibrary}
                    className="flex-1 flex items-center justify-center gap-2 p-3 rounded-xl bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-sm">Library</span>
                  </button>
                </div>
              )}
            </div>
              </>
            )}
          </div>
        )}
      </div>
      </div>
    </div>
  );
};

// Home Tab - Simplified
const HomeTab = ({ onAddActivity, pendingSync, activities = [], weeklyProgress: propWeeklyProgress, userData, userProfile, onDeleteActivity, onEditActivity, user, weeklyGoalsRef, latestActivityRef, healthKitData = {} }) => {
  const [showWorkoutNotification, setShowWorkoutNotification] = useState(true);
  const [activityReactions, setActivityReactions] = useState({});
  const [activityComments, setActivityComments] = useState({});
  const [reactionDetailModal, setReactionDetailModal] = useState(null); // { activityId, reactions, selectedEmoji }
  const [commentDetailModal, setCommentDetailModal] = useState(null); // { activityId, comments }

  // Calculate weekly progress directly from activities to ensure it's always in sync
  const weekProgress = useMemo(() => {
    const goals = userData?.goals || { liftsPerWeek: 4, cardioPerWeek: 3, recoveryPerWeek: 2, caloriesPerDay: 500, stepsPerDay: 10000 };

    const today = new Date();
    today.setHours(23, 59, 59, 999); // End of today
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay()); // Sunday
    startOfWeek.setHours(0, 0, 0, 0);

    const weekActivities = activities.filter(a => {
      if (!a.date) return false;
      const actDate = new Date(a.date + 'T12:00:00');
      return actDate >= startOfWeek && actDate <= today;
    });

    // Categorize activities
    const getCategory = (activity) => {
      if (activity.countToward) return activity.countToward;
      if (activity.type === 'Strength Training') return 'lifting';
      if (['Running', 'Cycle', 'Sports'].includes(activity.type)) return 'cardio';
      if (['Cold Plunge', 'Sauna', 'Yoga', 'Pilates'].includes(activity.type)) return 'recovery';
      return 'other';
    };

    const lifts = weekActivities.filter(a => getCategory(a) === 'lifting');
    const cardio = weekActivities.filter(a => getCategory(a) === 'cardio');
    const recovery = weekActivities.filter(a => getCategory(a) === 'recovery');

    // Cardio breakdown
    const running = weekActivities.filter(a => a.type === 'Running');
    const cycling = weekActivities.filter(a => a.type === 'Cycle');
    const sports = weekActivities.filter(a => a.type === 'Sports');
    const otherCardio = weekActivities.filter(a => a.type === 'Other' && (a.customActivityCategory === 'cardio' || a.countToward === 'cardio'));

    // Strength breakdown - check strengthType field or if subtype starts with the type name
    const lifting = lifts.filter(a => a.strengthType === 'Lifting' || a.subtype?.startsWith('Lifting') || (!a.subtype && !a.strengthType));
    const bodyweight = lifts.filter(a => a.strengthType === 'Bodyweight' || a.subtype?.startsWith('Bodyweight'));

    // Recovery breakdown
    const coldPlunge = weekActivities.filter(a => a.type === 'Cold Plunge');
    const sauna = weekActivities.filter(a => a.type === 'Sauna');
    const yoga = weekActivities.filter(a => a.type === 'Yoga');
    const pilates = weekActivities.filter(a => a.type === 'Pilates');
    const otherRecovery = weekActivities.filter(a => a.type === 'Other' && (a.customActivityCategory === 'recovery' || a.countToward === 'recovery'));

    // Strength "Other" activities
    const otherStrength = weekActivities.filter(a => a.type === 'Other' && (a.customActivityCategory === 'strength' || a.countToward === 'strength'));

    const totalMiles = running.reduce((sum, r) => sum + (parseFloat(r.distance) || 0), 0);
    const totalCalories = weekActivities.reduce((sum, a) => sum + (parseInt(a.calories) || 0), 0);

    return {
      lifts: { completed: lifts.length, goal: goals.liftsPerWeek, sessions: lifts.map(l => l.subtype || l.type), breakdown: { lifting: lifting.length, bodyweight: bodyweight.length }, otherActivities: otherStrength },
      cardio: { completed: cardio.length, goal: goals.cardioPerWeek, miles: totalMiles, sessions: cardio.map(c => c.type), breakdown: { running: running.length, cycling: cycling.length, sports: sports.length, other: otherCardio.length }, otherActivities: otherCardio },
      recovery: { completed: recovery.length, goal: goals.recoveryPerWeek, sessions: recovery.map(r => r.type), breakdown: { coldPlunge: coldPlunge.length, sauna: sauna.length, yoga: yoga.length, pilates: pilates.length }, otherActivities: otherRecovery },
      // Use HealthKit calories if available, otherwise fall back to activity sum
      calories: { burned: healthKitData.todayCalories || totalCalories, goal: goals.caloriesPerDay },
      // Use HealthKit steps
      steps: { today: healthKitData.todaySteps || 0, goal: goals.stepsPerDay }
    };
  }, [activities, userData?.goals, healthKitData.todaySteps, healthKitData.todayCalories]);

  const stepsPercent = weekProgress.steps?.goal > 0 ? Math.min((weekProgress.steps.today / weekProgress.steps.goal) * 100, 100) : 0;
  const caloriesPercent = weekProgress.calories.goal > 0 ? Math.min((weekProgress.calories.burned / weekProgress.calories.goal) * 100, 100) : 0;
  const liftsPercent = weekProgress.lifts.goal > 0 ? Math.min((weekProgress.lifts.completed / weekProgress.lifts.goal) * 100, 100) : 0;
  const cardioPercent = weekProgress.cardio?.goal > 0 ? Math.min((weekProgress.cardio.completed / weekProgress.cardio.goal) * 100, 100) : 0;
  const recoveryPercent = weekProgress.recovery?.goal > 0 ? Math.min((weekProgress.recovery.completed / weekProgress.recovery.goal) * 100, 100) : 0;

  // Calculate days left in the week (until Saturday)
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sunday, 6 = Saturday
  const daysLeft = 6 - dayOfWeek; // Days until Saturday
  
  const liftsRemaining = Math.max(0, weekProgress.lifts.goal - weekProgress.lifts.completed);
  const cardioRemaining = Math.max(0, (weekProgress.cardio?.goal || 0) - (weekProgress.cardio?.completed || 0));
  const recoveryRemaining = Math.max(0, (weekProgress.recovery?.goal || 0) - (weekProgress.recovery?.completed || 0));

  // Calculate overall weekly progress (cap each category at its goal - extra doesn't count toward Week Progress)
  const totalGoals = weekProgress.lifts.goal + (weekProgress.cardio?.goal || 0) + (weekProgress.recovery?.goal || 0);
  const totalCompleted = Math.min(weekProgress.lifts.completed, weekProgress.lifts.goal) + 
    Math.min(weekProgress.cardio?.completed || 0, weekProgress.cardio?.goal || 0) + 
    Math.min(weekProgress.recovery?.completed || 0, weekProgress.recovery?.goal || 0);
  const overallPercent = totalGoals > 0 ? Math.round((totalCompleted / totalGoals) * 100) : 0;

  // State for expanding breakdowns
  const [showStrengthBreakdown, setShowStrengthBreakdown] = useState(false);
  const [showCardioBreakdown, setShowCardioBreakdown] = useState(false);
  const [showRecoveryBreakdown, setShowRecoveryBreakdown] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState(null);

  // Helper to convert time string (e.g., "1:55 PM") to minutes since midnight for proper sorting
  const parseTimeToMinutes = (timeStr) => {
    if (!timeStr) return 0;
    const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!match) return 0;
    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const period = match[3]?.toUpperCase();
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    return hours * 60 + minutes;
  };

  // Get latest activities for display (sorted by date/time, most recent first)
  const allLatestActivities = [...activities]
    .sort((a, b) => {
      // Sort by date first (most recent first)
      const dateCompare = b.date.localeCompare(a.date);
      if (dateCompare !== 0) return dateCompare;
      // If same date, sort by time (most recent first)
      if (a.time && b.time) {
        const aMinutes = parseTimeToMinutes(a.time);
        const bMinutes = parseTimeToMinutes(b.time);
        return bMinutes - aMinutes; // Higher minutes = later time = should come first
      }
      return 0;
    })
    .slice(0, 10); // Cap at 10 total
  const latestActivities = activityExpanded ? allLatestActivities : allLatestActivities.slice(0, 2);

  // Fetch reactions and comments for user's activities
  useEffect(() => {
    const fetchReactionsAndComments = async () => {
      if (!user?.uid || activities.length === 0) return;

      const reactionsMap = {};
      const commentsMap = {};
      await Promise.all(
        allLatestActivities.map(async (activity) => {
          if (activity.id) {
            try {
              const [reactions, comments] = await Promise.all([
                getReactions(user.uid, activity.id),
                getComments(user.uid, activity.id)
              ]);
              if (reactions.length > 0) {
                reactionsMap[activity.id] = reactions;
              }
              if (comments.length > 0) {
                commentsMap[activity.id] = comments;
              }
            } catch (error) {
              // console.error('Error fetching reactions/comments for activity:', activity.id, error);
            }
          }
        })
      );
      setActivityReactions(reactionsMap);
      setActivityComments(commentsMap);
    };

    fetchReactionsAndComments();
  }, [user?.uid, activities]);

  // Helper to get reaction summary for an activity
  const getReactionSummary = (activityId) => {
    const reactions = activityReactions[activityId] || [];
    if (reactions.length === 0) return null;

    // Count by emoji type
    const counts = {};
    reactions.forEach(r => {
      counts[r.reactionType] = (counts[r.reactionType] || 0) + 1;
    });

    return { counts, total: reactions.length, reactions };
  };

  // Helper to get comment count for an activity
  const getCommentCount = (activityId) => {
    const comments = activityComments[activityId] || [];
    return comments.length;
  };

  // Reactions Detail Modal
  const ReactionsDetailModal = ({ data, onClose }) => {
    if (!data) return null;

    const { reactions, selectedEmoji } = data;

    // Filter reactions by selected emoji
    const filteredReactions = reactions.filter(r => r.reactionType === selectedEmoji);

    return (
      <div
        className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
        onClick={onClose}
        onTouchEnd={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            onClose();
          }
        }}
      >
        <div
          className="w-full max-w-sm bg-zinc-900 rounded-2xl p-5 max-h-[60vh] overflow-y-auto"
          onClick={e => e.stopPropagation()}
          onTouchEnd={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{selectedEmoji}</span>
              <span className="text-gray-400 text-sm">{filteredReactions.length} {filteredReactions.length === 1 ? 'reaction' : 'reactions'}</span>
            </div>
            <button onClick={onClose} className="text-gray-400 p-1">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Reactors list */}
          <div className="space-y-2">
            {filteredReactions.map((reactor, idx) => (
              <div key={reactor.reactorUid || idx} className="flex items-center gap-3 p-3 rounded-xl bg-zinc-800">
                <div className="w-10 h-10 rounded-full bg-zinc-700 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {reactor.reactorPhoto ? (
                    <img src={reactor.reactorPhoto} alt={reactor.reactorName} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-white text-sm">{reactor.reactorName?.[0]?.toUpperCase() || '?'}</span>
                  )}
                </div>
                <span className="text-white text-sm font-medium">{reactor.reactorName}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // Comments Detail Modal
  const CommentsDetailModal = ({ data, onClose, user, userProfile, onRepliesUpdated }) => {
    const [replyingTo, setReplyingTo] = useState(null);
    const [commentReplies, setCommentReplies] = useState({});
    const [expandedReplies, setExpandedReplies] = useState({});
    const replyInputRef = useRef(null);

    // Load replies when modal opens
    useEffect(() => {
      if (data?.activityId && data?.comments) {
        const loadReplies = async () => {
          const repliesMap = {};
          await Promise.all(
            data.comments.map(async (comment) => {
              try {
                const replies = await getReplies(user.uid, data.activityId, comment.id);
                if (replies.length > 0) {
                  repliesMap[comment.id] = replies;
                }
              } catch (error) {
                // console.error('Error loading replies:', error);
              }
            })
          );
          setCommentReplies(repliesMap);
        };
        loadReplies();
      }
    }, [data, user?.uid]);

    // Focus reply input when replying
    useEffect(() => {
      if (replyingTo && replyInputRef.current) {
        replyInputRef.current.focus();
      }
    }, [replyingTo]);

    if (!data) return null;

    const { activityId, comments } = data;

    const formatCommentTime = (createdAt) => {
      if (!createdAt) return '';
      const date = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m`;
      if (diffHours < 24) return `${diffHours}h`;
      if (diffDays === 1) return '1d';
      if (diffDays < 7) return `${diffDays}d`;
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    const handleSubmitReply = async (commentId, text) => {
      if (!text.trim() || !user) return;
      try {
        const replierName = userProfile?.displayName || user?.displayName || userProfile?.username || user?.email?.split('@')[0] || 'User';
        const replierPhoto = userProfile?.photoURL || user?.photoURL || null;

        const replyId = await addReply(
          user.uid,
          activityId,
          commentId,
          user.uid,
          replierName,
          replierPhoto,
          text.trim()
        );

        const newReply = {
          id: replyId,
          replierUid: user.uid,
          replierName: replierName,
          replierPhoto: replierPhoto,
          text: text.trim(),
          createdAt: { toDate: () => new Date() }
        };

        setCommentReplies(prev => ({
          ...prev,
          [commentId]: [...(prev[commentId] || []), newReply]
        }));
        setExpandedReplies(prev => ({ ...prev, [commentId]: true }));
      } catch (error) {
        // console.error('Error adding reply:', error);
      }
    };

    const handleDeleteReply = async (commentId, replyId) => {
      try {
        await deleteReply(user.uid, activityId, commentId, replyId);
        setCommentReplies(prev => ({
          ...prev,
          [commentId]: (prev[commentId] || []).filter(r => r.id !== replyId)
        }));
      } catch (error) {
        // console.error('Error deleting reply:', error);
      }
    };

    return (
      <div
        className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
        onClick={onClose}
        onTouchEnd={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            onClose();
          }
        }}
      >
        <div
          className="w-full max-w-sm bg-zinc-900 rounded-2xl p-5 max-h-[70vh] overflow-y-auto"
          onClick={e => e.stopPropagation()}
          onTouchEnd={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <span className="text-gray-400 text-sm">{comments.length} {comments.length === 1 ? 'comment' : 'comments'}</span>
            </div>
            <button onClick={onClose} className="text-gray-400 p-1">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Comments list */}
          <div className="space-y-4">
            {comments.map((comment, idx) => {
              const replies = commentReplies[comment.id] || [];
              const isExpanded = expandedReplies[comment.id];
              return (
                <div key={comment.id || idx}>
                  <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center overflow-hidden flex-shrink-0">
                      {comment.commenterPhoto ? (
                        <img src={comment.commenterPhoto} alt={comment.commenterName} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-white text-xs">{comment.commenterName?.[0]?.toUpperCase() || '?'}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="bg-zinc-800 rounded-2xl px-3 py-2">
                        <span className="text-white text-xs font-medium">{comment.commenterName}</span>
                        <p className="text-gray-300 text-sm break-words">{comment.text}</p>
                      </div>
                      <div className="flex items-center gap-3 mt-1 ml-1">
                        <span className="text-gray-500 text-[10px]">{formatCommentTime(comment.createdAt)}</span>
                        <button
                          onClick={() => setReplyingTo({ commentId: comment.id, commenterName: comment.commenterName })}
                          className="text-gray-400 text-[10px] font-medium hover:text-white"
                        >
                          Reply
                        </button>
                        {replies.length > 0 && !isExpanded && (
                          <button
                            onClick={() => setExpandedReplies(prev => ({ ...prev, [comment.id]: true }))}
                            className="text-blue-400 text-[10px] font-medium"
                          >
                            View {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Replies thread */}
                  {isExpanded && replies.length > 0 && (
                    <div className="ml-11 mt-2 space-y-2 border-l-2 border-zinc-700 pl-3">
                      {replies.map((reply) => (
                        <div key={reply.id}>
                          <div className="flex gap-2 items-start">
                            <div className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center overflow-hidden flex-shrink-0">
                              {reply.replierPhoto ? (
                                <img src={reply.replierPhoto} alt={reply.replierName} className="w-full h-full object-cover" />
                              ) : (
                                <span className="text-white text-[9px]">{reply.replierName?.[0]?.toUpperCase() || '?'}</span>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="bg-zinc-800/70 rounded-2xl px-3 py-1.5">
                                <span className="text-white text-[11px] font-medium">{reply.replierName}</span>
                                <p className="text-gray-300 text-xs break-words">{reply.text}</p>
                              </div>
                              <div className="flex items-center gap-2 mt-0.5 ml-1">
                                <span className="text-gray-500 text-[9px]">{formatCommentTime(reply.createdAt)}</span>
                                {reply.replierUid === user?.uid && (
                                  <button
                                    onClick={() => handleDeleteReply(comment.id, reply.id)}
                                    className="text-red-400 text-[9px] font-medium"
                                  >
                                    Delete
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                      <button
                        onClick={() => setExpandedReplies(prev => ({ ...prev, [comment.id]: false }))}
                        className="text-gray-500 text-[10px] ml-2"
                      >
                        Hide replies
                      </button>
                    </div>
                  )}

                  {/* Reply input */}
                  {replyingTo?.commentId === comment.id && (
                    <div className="ml-11 mt-2 flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center overflow-hidden flex-shrink-0">
                        {userData?.photoURL ? (
                          <img src={userData.photoURL} alt="You" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-white text-[9px]">{userData?.displayName?.[0]?.toUpperCase() || '?'}</span>
                        )}
                      </div>
                      <div className="flex-1 flex items-center gap-2 bg-zinc-800 rounded-full px-3 py-1">
                        <input
                          ref={replyInputRef}
                          type="text"
                          defaultValue=""
                          onKeyDown={async (e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              const text = replyInputRef.current?.value;
                              if (text?.trim()) {
                                await handleSubmitReply(comment.id, text);
                                replyInputRef.current.value = '';
                                setReplyingTo(null);
                              }
                            } else if (e.key === 'Escape') {
                              setReplyingTo(null);
                            }
                          }}
                          placeholder={`Reply to ${comment.commenterName}...`}
                          className="flex-1 bg-transparent text-white text-xs focus:outline-none"
                          style={{ fontSize: '14px' }}
                        />
                        <button
                          onClick={async () => {
                            const text = replyInputRef.current?.value;
                            if (text?.trim()) {
                              await handleSubmitReply(comment.id, text);
                              replyInputRef.current.value = '';
                              setReplyingTo(null);
                            }
                          }}
                          className="text-xs font-medium text-green-500"
                        >
                          Post
                        </button>
                        <button
                          onClick={() => setReplyingTo(null)}
                          className="text-xs text-gray-500"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="pb-32">
      {/* Daily Stats - Single Card */}
      <div className="px-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">Today's Activity</span>
              <span>📊</span>
            </div>
            <p className="text-[11px] text-gray-500 mt-0.5">Synced from Apple Health</p>
          </div>
        </div>
        
        <div className="p-4 rounded-2xl space-y-3" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
          {/* Steps */}
          <div className="flex items-center gap-3">
            <span className="text-lg">👟</span>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-400">Steps</span>
                <span className="text-xs font-bold">{(weekProgress.steps?.today || 0).toLocaleString()} / {((weekProgress.steps?.goal || 10000)/1000).toFixed(0)}k</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>
                <div
                  className="h-full rounded-full transition-all duration-1000"
                  style={{
                    width: `${Math.min(stepsPercent, 100)}%`,
                    backgroundColor: '#BF5AF2'
                  }}
                />
              </div>
            </div>
          </div>

          {/* Calories */}
          <div className="flex items-center gap-3">
            <span className="text-lg">🔥</span>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-400">Active Calories</span>
                <span className="text-xs font-bold">{weekProgress.calories.burned.toLocaleString()} / {(weekProgress.calories.goal || 500).toLocaleString()}</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>
                <div 
                  className="h-full rounded-full transition-all duration-1000"
                  style={{ 
                    width: `${Math.min(caloriesPercent, 100)}%`,
                    backgroundColor: '#FF9500'
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pending Workout Banner - Only shows when there's a detected workout */}
      {pendingSync.length > 0 && showWorkoutNotification && (
        <div className="mx-4 mb-4">
          <button 
            onClick={() => onAddActivity(pendingSync[0])}
            className="w-full p-3 rounded-xl flex items-center gap-3 transition-all duration-150"
            style={{ backgroundColor: 'rgba(0,255,148,0.1)', border: '1px solid rgba(0,255,148,0.3)' }}
            onTouchStart={(e) => {
              e.currentTarget.style.transform = 'scale(0.98)';
              e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.15)';
            }}
            onTouchEnd={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.1)';
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'scale(0.98)';
              e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.15)';
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.1)';
            }}
          >
            <span className="text-lg">📱</span>
            <div className="flex-1 text-left">
              <div className="text-xs font-semibold" style={{ color: '#00FF94' }}>New workout detected</div>
              <div className="text-[10px] text-gray-400">{pendingSync[0].type} • {pendingSync[0].duration} min • from Apple Health</div>
            </div>
            <span className="px-3 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: 'rgba(0,255,148,0.2)', color: '#00FF94' }}>
              Add
            </span>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setShowWorkoutNotification(false);
              }}
              className="w-6 h-6 rounded-full flex items-center justify-center transition-all duration-150"
              style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
              onTouchStart={(e) => {
                e.stopPropagation();
                e.currentTarget.style.transform = 'scale(0.85)';
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.2)';
              }}
              onTouchEnd={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.currentTarget.style.transform = 'scale(0.85)';
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.2)';
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
              }}
            >
              <span className="text-gray-400 text-xs">✕</span>
            </button>
          </button>
        </div>
      )}

      {/* Weekly Goals - Hero Section */}
      <div className="mx-4 mb-4">
        {/* Streak at Risk Warning */}
        {daysLeft <= 2 && (liftsRemaining > 0 || cardioRemaining > 0 || recoveryRemaining > 0) && (
          <div 
            className="p-3 rounded-xl mb-3 flex items-center gap-3"
            style={{ 
              backgroundColor: 'rgba(255,69,58,0.15)', 
              border: '1px solid rgba(255,69,58,0.3)' 
            }}
          >
            <span className="text-xl">⚠️</span>
            <div className="flex-1">
              <div className="text-xs font-semibold" style={{ color: '#FF453A' }}>
                {daysLeft === 0 ? 'Last day to hit your goals!' : `Only ${daysLeft} day${daysLeft === 1 ? '' : 's'} left!`}
              </div>
              <div className="text-[10px] text-gray-400 mt-0.5">
                {[
                  liftsRemaining > 0 ? `${liftsRemaining} strength` : null,
                  cardioRemaining > 0 ? `${cardioRemaining} cardio` : null,
                  recoveryRemaining > 0 ? `${recoveryRemaining} recovery` : null
                ].filter(Boolean).join(', ')} remaining to keep your streak
              </div>
            </div>
          </div>
        )}
        
        {/* Weekly Goals - tour highlight wraps header + card */}
        <div ref={weeklyGoalsRef}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white">This Week's Goals</span>
                <span>🎯</span>
              </div>
              <p className="text-[11px] text-gray-500 mt-0.5">Hit these to keep your streaks alive</p>
            </div>
            <span className="text-xs text-gray-500">{daysLeft} days left</span>
          </div>

          {/* Individual Goals - The Main Event */}
          <div className="p-5 rounded-2xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
          <div className="flex items-center justify-around">
            {/* Strength */}
            <button
              className="text-center transition-all duration-150"
              onClick={() => setShowStrengthBreakdown(!showStrengthBreakdown)}
              onTouchStart={(e) => { e.currentTarget.style.transform = 'scale(0.93)'; triggerHaptic(ImpactStyle.Light); }}
              onTouchEnd={(e) => e.currentTarget.style.transform = 'scale(1)'}
              onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.93)'}
              onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              <div className="relative inline-block">
                <ProgressRing progress={liftsPercent} size={72} strokeWidth={6} color="#00FF94" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xl font-black"><AnimatedCounter value={weekProgress.lifts.completed} />/{weekProgress.lifts.goal}</span>
                </div>
              </div>
              <div className="text-sm font-medium mt-2">🏋️ Strength</div>
              <div className="text-[10px] text-gray-500">{showStrengthBreakdown ? '▲' : '▼'}</div>
            </button>
            
            {/* Cardio */}
            <button
              className="text-center transition-all duration-150"
              onClick={() => setShowCardioBreakdown(!showCardioBreakdown)}
              onTouchStart={(e) => { e.currentTarget.style.transform = 'scale(0.93)'; triggerHaptic(ImpactStyle.Light); }}
              onTouchEnd={(e) => e.currentTarget.style.transform = 'scale(1)'}
              onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.93)'}
              onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              <div className="relative inline-block">
                <ProgressRing progress={cardioPercent} size={72} strokeWidth={6} color="#FF9500" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xl font-black"><AnimatedCounter value={weekProgress.cardio?.completed || 0} />/{weekProgress.cardio?.goal || 0}</span>
                </div>
              </div>
              <div className="text-sm font-medium mt-2">🏃 Cardio</div>
              <div className="text-[10px] text-gray-500">{showCardioBreakdown ? '▲' : '▼'}</div>
            </button>
            
            {/* Recovery */}
            <button
              className="text-center transition-all duration-150"
              onClick={() => setShowRecoveryBreakdown(!showRecoveryBreakdown)}
              onTouchStart={(e) => { e.currentTarget.style.transform = 'scale(0.93)'; triggerHaptic(ImpactStyle.Light); }}
              onTouchEnd={(e) => e.currentTarget.style.transform = 'scale(1)'}
              onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.93)'}
              onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              <div className="relative inline-block">
                <ProgressRing progress={recoveryPercent} size={72} strokeWidth={6} color="#00D1FF" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xl font-black"><AnimatedCounter value={weekProgress.recovery?.completed || 0} />/{weekProgress.recovery?.goal || 0}</span>
                </div>
              </div>
              <div className="text-sm font-medium mt-2">🧊 Recovery</div>
              <div className="text-[10px] text-gray-500">{showRecoveryBreakdown ? '▲' : '▼'}</div>
            </button>
          </div>
          
          {/* Strength Breakdown - Expandable */}
          {showStrengthBreakdown && (
            <div className="mt-4 pt-4 border-t border-white/10">
              <div className="text-xs text-gray-400 mb-2">Strength Breakdown</div>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  <div className="text-lg font-bold">{weekProgress.lifts?.breakdown?.lifting || 0}</div>
                  <div className="text-[10px] text-gray-400">🏋️ Lifting</div>
                </div>
                <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  <div className="text-lg font-bold">{weekProgress.lifts?.breakdown?.bodyweight || 0}</div>
                  <div className="text-[10px] text-gray-400">💪 Bodyweight</div>
                </div>
              </div>
            </div>
          )}
          
          {/* Cardio Breakdown - Expandable */}
          {showCardioBreakdown && (
            <div className="mt-4 pt-4 border-t border-white/10">
              <div className="text-xs text-gray-400 mb-2">Cardio Breakdown</div>
              <div className={`grid gap-2 text-center`} style={{ gridTemplateColumns: `repeat(${3 + (weekProgress.cardio?.otherActivities?.length || 0)}, minmax(0, 1fr))` }}>
                <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  <div className="text-lg font-bold">{weekProgress.cardio?.breakdown?.running || 0}</div>
                  <div className="text-[10px] text-gray-400">🏃 Running</div>
                </div>
                <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  <div className="text-lg font-bold">{weekProgress.cardio?.breakdown?.cycling || 0}</div>
                  <div className="text-[10px] text-gray-400">🚴 Cycling</div>
                </div>
                <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  <div className="text-lg font-bold">{weekProgress.cardio?.breakdown?.sports || 0}</div>
                  <div className="text-[10px] text-gray-400">🏀 Sports</div>
                </div>
                {/* Show each "Other" cardio activity */}
                {weekProgress.cardio?.otherActivities?.map((activity, i) => (
                  <div key={activity.id || i} className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    <div className="text-lg font-bold">1</div>
                    <div className="text-[10px] text-gray-400">{activity.customEmoji || '⭐'} {activity.subtype || 'Other'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Recovery Breakdown - Expandable */}
          {showRecoveryBreakdown && (
            <div className="mt-4 pt-4 border-t border-white/10">
              <div className="text-xs text-gray-400 mb-2">Recovery Breakdown</div>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  <div className="text-lg font-bold">{weekProgress.recovery?.breakdown?.coldPlunge || 0}</div>
                  <div className="text-[10px] text-gray-400">🧊 Cold Plunge</div>
                </div>
                <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  <div className="text-lg font-bold">{weekProgress.recovery?.breakdown?.sauna || 0}</div>
                  <div className="text-[10px] text-gray-400">🔥 Sauna</div>
                </div>
                <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  <div className="text-lg font-bold">{weekProgress.recovery?.breakdown?.yoga || 0}</div>
                  <div className="text-[10px] text-gray-400">🧘 Yoga</div>
                </div>
                <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  <div className="text-lg font-bold">{weekProgress.recovery?.breakdown?.pilates || 0}</div>
                  <div className="text-[10px] text-gray-400">🤸 Pilates</div>
                </div>
                {/* Show each "Other" recovery activity */}
                {weekProgress.recovery?.otherActivities?.map((activity, i) => (
                  <div key={activity.id || i} className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    <div className="text-lg font-bold">1</div>
                    <div className="text-[10px] text-gray-400">{activity.customEmoji || '⭐'} {activity.subtype || 'Other'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Overall Progress Bar */}
          <div className="mt-4 pt-4 border-t border-white/10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400">Week Progress</span>
              <span className="text-xs font-bold" style={{ color: overallPercent >= 100 ? '#00FF94' : 'white' }}><AnimatedCounter value={overallPercent} />%</span>
            </div>
            <ProgressBar progress={overallPercent} height={4} color={overallPercent >= 100 ? '#00FF94' : '#00FF94'} />
          </div>
        </div>
        </div>
        {/* End of weeklyGoalsRef wrapper */}

        {/* What's Left This Week */}
        {(liftsRemaining > 0 || cardioRemaining > 0 || recoveryRemaining > 0) && (
          <div className="mt-3 p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
            <div className="text-xs text-gray-500 mb-2">Remaining:</div>
            <div className="flex gap-2 flex-wrap">
              {liftsRemaining > 0 && (
                <span className="px-2 py-1 rounded-full text-xs" style={{ backgroundColor: 'rgba(0,255,148,0.1)', color: '#00FF94' }}>
                  {liftsRemaining} strength
                </span>
              )}
              {cardioRemaining > 0 && (
                <span className="px-2 py-1 rounded-full text-xs" style={{ backgroundColor: 'rgba(255,149,0,0.1)', color: '#FF9500' }}>
                  {cardioRemaining} cardio
                </span>
              )}
              {recoveryRemaining > 0 && (
                <span className="px-2 py-1 rounded-full text-xs" style={{ backgroundColor: 'rgba(0,209,255,0.1)', color: '#00D1FF' }}>
                  {recoveryRemaining} recovery
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Latest Activity */}
      <div className="mx-4 mb-4">
        <SwipeableProvider>
          {/* Tour highlight wrapper - includes header + first activity */}
          <div ref={latestActivityRef}>
            <div className="mb-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white">Latest Activity</span>
                <span>📋</span>
              </div>
              <p className="text-[11px] text-gray-500 mt-0.5">Your recent workout and recovery sessions</p>
            </div>
            {/* Show first activity inside the tour highlight, or empty state */}
            {latestActivities.length > 0 ? (
              <SwipeableActivityItem
                key={latestActivities[0].id}
                activity={latestActivities[0]}
                onDelete={(act) => onDeleteActivity && onDeleteActivity(act.id)}
                onEdit={onEditActivity}
              >
                <div
                  onClick={() => {
                    triggerHaptic(ImpactStyle.Light);
                    setSelectedActivity(latestActivities[0]);
                  }}
                  className="w-full p-3 flex items-center gap-3 text-left cursor-pointer active:opacity-70 transition-opacity"
                  style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                >
                  <ActivityIcon type={latestActivities[0].type} size={20} sportEmoji={latestActivities[0].sportEmoji} customEmoji={latestActivities[0].customEmoji} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{latestActivities[0].type}{latestActivities[0].subtype ? ` • ${latestActivities[0].subtype}` : ''}</div>
                    <div className="text-xs text-gray-400">{formatFriendlyDate(latestActivities[0].date)}{latestActivities[0].time ? ` at ${latestActivities[0].time}` : ''}{latestActivities[0].duration ? ` (${latestActivities[0].duration} min)` : ''}</div>
                  </div>
                  <span className="text-gray-600 text-xs">›</span>
                </div>
              </SwipeableActivityItem>
            ) : (
              <div className="p-6 rounded-xl text-center" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                <div className="text-4xl mb-3">🏋️</div>
                <p className="text-white font-medium text-sm">Your first workout is waiting!</p>
                <p className="text-gray-500 text-xs mt-1">Tap the + button to log an activity</p>
              </div>
            )}
          </div>
          {/* End of latestActivityRef wrapper */}

          {/* Remaining activities (starting from index 1) */}
          <div
            className="space-y-2 transition-all duration-300 ease-out overflow-hidden mt-2"
          >
            {latestActivities.length > 1 ? (
              <>
                {latestActivities.slice(1).map((activity) => (
                  <SwipeableActivityItem
                    key={activity.id}
                    activity={activity}
                    onDelete={(act) => onDeleteActivity && onDeleteActivity(act.id)}
                    onEdit={onEditActivity}
                  >
                    <div
                      onClick={() => {
                        triggerHaptic(ImpactStyle.Light);
                        setSelectedActivity(activity);
                      }}
                      className="w-full p-3 flex items-center gap-3 text-left cursor-pointer active:opacity-70 transition-opacity"
                      style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                    >
                      <ActivityIcon type={activity.type} size={20} sportEmoji={activity.sportEmoji} customEmoji={activity.customEmoji} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold truncate">{activity.type}{activity.subtype ? ` • ${activity.subtype}` : ''}</span>
                          {(() => {
                            const summary = getReactionSummary(activity.id);
                            const commentCount = getCommentCount(activity.id);
                            if (!summary && commentCount === 0) return null;
                            return (
                              <span
                                className="flex items-center gap-0.5 rounded-full flex-shrink-0"
                              >
                                {summary && Object.entries(summary.counts).slice(0, 4).map(([emoji, count]) => (
                                  <button
                                    key={emoji}
                                    className="flex items-center text-xs px-1.5 py-0.5 rounded-full transition-all duration-150 active:scale-95"
                                    style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      // Trigger haptic feedback
                                      if (navigator.vibrate) {
                                        navigator.vibrate(10);
                                      }
                                      setReactionDetailModal({
                                        activityId: activity.id,
                                        reactions: summary.reactions,
                                        selectedEmoji: emoji
                                      });
                                    }}
                                    onTouchStart={(e) => {
                                      e.stopPropagation();
                                      e.currentTarget.style.transform = 'scale(0.9)';
                                      e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.2)';
                                    }}
                                    onTouchEnd={(e) => {
                                      e.currentTarget.style.transform = '';
                                      e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                                    }}
                                  >
                                    <span>{emoji}</span>
                                    {count > 1 && <span className="text-gray-300 text-[10px] ml-0.5">{count}</span>}
                                  </button>
                                ))}
                                {commentCount > 0 && (
                                  <button
                                    className="flex items-center text-xs px-1.5 py-0.5 rounded-full transition-all duration-150 active:scale-95"
                                    style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (navigator.vibrate) {
                                        navigator.vibrate(10);
                                      }
                                      setCommentDetailModal({
                                        activityId: activity.id,
                                        comments: activityComments[activity.id] || []
                                      });
                                    }}
                                    onTouchStart={(e) => {
                                      e.stopPropagation();
                                      e.currentTarget.style.transform = 'scale(0.9)';
                                      e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.2)';
                                    }}
                                    onTouchEnd={(e) => {
                                      e.currentTarget.style.transform = '';
                                      e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                                    }}
                                  >
                                    <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                    </svg>
                                    <span className="text-gray-300 text-[10px] ml-0.5">{commentCount}</span>
                                  </button>
                                )}
                              </span>
                            );
                          })()}
                        </div>
                        <div className="text-[10px] text-gray-500">{formatFriendlyDate(activity.date)} at {activity.time}{activity.duration ? ` (${activity.duration} min)` : ''}</div>
                      </div>
                      <span className="text-gray-600 text-xs">›</span>
                    </div>
                  </SwipeableActivityItem>
                ))}
              {allLatestActivities.length > 2 && (
                <button
                  onClick={() => {
                    triggerHaptic(ImpactStyle.Light);
                    setActivityExpanded(!activityExpanded);
                  }}
                  className="w-full py-2 text-center text-xs font-medium transition-all duration-150 rounded-xl"
                  style={{ color: 'rgba(255,255,255,0.5)' }}
                  onTouchStart={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                  }}
                  onTouchEnd={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                  onMouseDown={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                  }}
                  onMouseUp={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  {activityExpanded ? 'See less' : `See ${allLatestActivities.length - 2} more`}
                </button>
              )}
            </>
          ) : null}
          </div>
        </SwipeableProvider>
      </div>

      {/* Activity Detail Modal */}
      <ActivityDetailModal
        isOpen={!!selectedActivity}
        onClose={() => setSelectedActivity(null)}
        activity={selectedActivity}
        onDelete={onDeleteActivity}
        onEdit={onEditActivity}
        user={user}
        userProfile={userProfile}
      />

      {/* Reactions Detail Modal */}
      <ReactionsDetailModal
        data={reactionDetailModal}
        onClose={() => setReactionDetailModal(null)}
      />

      {/* Comments Detail Modal */}
      <CommentsDetailModal
        data={commentDetailModal}
        onClose={() => setCommentDetailModal(null)}
        user={user}
        userProfile={userProfile}
      />
    </div>
  );
};

// Trends View Component
const TrendsView = ({ activities = [], calendarData = {} }) => {
  const [metric, setMetric] = useState('calories');
  const [timeRange, setTimeRange] = useState('1M');
  const [selectedBar, setSelectedBar] = useState(null); // For detail view on click
  const [hoveredBar, setHoveredBar] = useState(null); // For hover highlighting

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
        const dayActivities = calendarData[dateStr] || [];
        
        let value = 0;
        if (metric === 'calories') {
          value = dayActivities.reduce((sum, a) => sum + (parseInt(a.calories) || 0), 0);
        } else if (metric === 'steps') {
          // Steps would come from health data integration - currently not tracked
          value = 0;
        } else if (metric === 'miles') {
          value = dayActivities
            .filter(a => a.type === 'Running' || a.type === 'Cycle')
            .reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);
        }
        
        data.push({
          label: date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
          shortLabel: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          value,
          date: dateStr
        });
      }
    } else if (groupBy === 'week') {
      const weeks = Math.ceil(daysToShow / 7);
      for (let w = weeks - 1; w >= 0; w--) {
        const weekEnd = new Date(today);
        weekEnd.setDate(weekEnd.getDate() - (w * 7));
        const weekStart = new Date(weekEnd);
        weekStart.setDate(weekStart.getDate() - 6);
        
        let value = 0;
        for (let d = 0; d < 7; d++) {
          const date = new Date(weekStart);
          date.setDate(date.getDate() + d);
          const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          const dayActivities = calendarData[dateStr] || [];
          
          if (metric === 'calories') {
            value += dayActivities.reduce((sum, a) => sum + (parseInt(a.calories) || 0), 0);
          } else if (metric === 'steps') {
            // Steps would come from health data integration - currently not tracked
            value += 0;
          } else if (metric === 'miles') {
            value += dayActivities
              .filter(a => a.type === 'Running' || a.type === 'Cycle')
              .reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);
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
        
        data.push({
          label: `${startLabel} - ${endLabel}`,
          shortLabel: weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          value,
          date: weekStart.toISOString().split('T')[0]
        });
      }
    } else if (groupBy === 'month') {
      const months = Math.ceil(daysToShow / 30);
      for (let m = months - 1; m >= 0; m--) {
        const monthDate = new Date(today.getFullYear(), today.getMonth() - m, 1);
        const monthEnd = new Date(today.getFullYear(), today.getMonth() - m + 1, 0);
        
        let value = 0;
        for (let d = 1; d <= monthEnd.getDate(); d++) {
          const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), d);
          if (date > today) break;
          const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          const dayActivities = calendarData[dateStr] || [];
          
          if (metric === 'calories') {
            value += dayActivities.reduce((sum, a) => sum + (parseInt(a.calories) || 0), 0);
          } else if (metric === 'steps') {
            // Steps would come from health data integration - currently not tracked
            value += 0;
          } else if (metric === 'miles') {
            value += dayActivities
              .filter(a => a.type === 'Running' || a.type === 'Cycle')
              .reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);
          }
        }

        if (metric === 'steps') value = Math.round(value);

        data.push({
          label: monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
          shortLabel: monthDate.toLocaleDateString('en-US', { month: 'short' }),
          value,
          date: monthDate.toISOString().split('T')[0]
        });
      }
    }
    
    return data;
  };

  const trendData = generateTrendData();
  const maxValue = Math.max(...trendData.map(d => d.value), 1);
  const total = trendData.reduce((sum, d) => sum + d.value, 0);

  // Calculate average based on days since first activity
  let avg = 0;
  if (activities.length > 0) {
    const dates = activities.map(a => parseLocalDate(a.date)).sort((a, b) => a - b);
    const earliestDate = new Date(dates[0]);
    earliestDate.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysSinceFirst = Math.round((today - earliestDate) / (1000 * 60 * 60 * 24)) + 1;
    avg = total / daysSinceFirst;
  }

  const metricConfig = {
    calories: { label: 'Calories', icon: '🔥', unit: 'cal', color: '#FF9500' },
    steps: { label: 'Steps', icon: '👟', unit: 'steps', color: '#00D1FF' },
    miles: { label: 'Miles', icon: '📍', unit: 'mi', color: '#00FF94' }
  };

  const config = metricConfig[metric];

  return (
    <div className="mx-4">
      {/* Header */}
      <div className="mb-4">
        <div className="text-sm font-semibold text-white">Trends</div>
        <p className="text-[11px] text-gray-500 mt-0.5">Track your progress over time</p>
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
        {['1W', '1M', '3M', '6M', '1Y'].map((range) => (
          <button
            key={range}
            onClick={() => {
              setTimeRange(range);
              setSelectedBar(null);
            }}
            className="flex-1 py-1.5 rounded-md text-[10px] font-medium transition-colors duration-200 relative z-10"
            style={{
              color: timeRange === range ? 'white' : 'rgba(255,255,255,0.5)'
            }}
          >
            {range}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="p-4 rounded-2xl mb-4" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
        {/* Tooltip - fixed height container to prevent layout shift */}
        <div style={{ minHeight: '72px' }}>
          {(hoveredBar !== null || selectedBar !== null) && trendData[hoveredBar !== null ? hoveredBar : selectedBar] ? (
            <div
              className="p-3 rounded-xl text-center transition-all duration-200"
              style={{
                backgroundColor: `${config.color}15`,
                border: `1px solid ${config.color}40`
              }}
            >
              <div className="text-sm font-bold" style={{ color: config.color }}>
                {trendData[hoveredBar !== null ? hoveredBar : selectedBar].label}
              </div>
              <div className="text-xl font-black text-white mt-1">
                {metric === 'miles'
                  ? trendData[hoveredBar !== null ? hoveredBar : selectedBar].value.toFixed(1)
                  : trendData[hoveredBar !== null ? hoveredBar : selectedBar].value.toLocaleString()
                } {config.unit}
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
              <div className="text-sm text-gray-500">Tap a bar to see details</div>
              <div className="text-xl font-black text-gray-600 mt-1">—</div>
            </div>
          )}
        </div>
        
        {/* Chart Area */}
        <div
          className="h-40 flex items-end gap-0.5 mb-2"
          style={{ minHeight: '160px' }}
          onMouseLeave={() => setHoveredBar(null)}
        >
          {trendData.length > 0 ? trendData.map((point, i) => {
            const heightPercent = maxValue > 0 ? (point.value / maxValue) * 100 : 0;
            const isHighlighted = selectedBar === i || hoveredBar === i;

            return (
              <button
                key={i}
                className="flex-1 flex flex-col justify-end h-full cursor-pointer bg-transparent border-none p-0"
                onMouseEnter={() => setHoveredBar(i)}
                onClick={() => setSelectedBar(selectedBar === i ? null : i)}
                type="button"
              >
                {/* Visible bar */}
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
              const isHighlighted = selectedBar === i || hoveredBar === i;

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
        const lifts = fullDayActivities.filter(a =>
          a.type === 'Strength Training' ||
          (a.type === 'Other' && (a.customActivityCategory === 'strength' || a.countToward === 'strength'))
        );
        const cardioActivities = fullDayActivities.filter(a =>
          a.type === 'Running' || a.type === 'Cycle' || a.type === 'Sports' ||
          (a.type === 'Other' && (a.customActivityCategory === 'cardio' || a.countToward === 'cardio'))
        );
        const recoveryActivities = fullDayActivities.filter(a =>
          a.type === 'Cold Plunge' || a.type === 'Sauna' || a.type === 'Yoga' || a.type === 'Pilates' ||
          (a.type === 'Other' && (a.customActivityCategory === 'recovery' || a.countToward === 'recovery'))
        );

        const dayCalories = fullDayActivities.reduce((sum, a) => sum + (parseInt(a.calories) || 0), 0);
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
                    <div className="text-[9px] text-gray-400">🏋️ Strength</div>
                  </div>
                  <div className="p-2 rounded-lg text-center" style={{ backgroundColor: 'rgba(255,149,0,0.1)' }}>
                    <div className="text-lg font-black" style={{ color: '#FF9500' }}>{cardioActivities.length}</div>
                    <div className="text-[9px] text-gray-400">🏃 Cardio</div>
                  </div>
                  <div className="p-2 rounded-lg text-center" style={{ backgroundColor: 'rgba(0,209,255,0.1)' }}>
                    <div className="text-lg font-black" style={{ color: '#00D1FF' }}>{recoveryActivities.length}</div>
                    <div className="text-[9px] text-gray-400">🧊 Recovery</div>
                  </div>
                </div>

                {/* Daily Totals */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 rounded-lg text-center" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    <div className="text-sm font-bold text-white">{dayCalories}</div>
                    <div className="text-[9px] text-gray-400">Calories</div>
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
                          <span className="text-sm">{
                            activity.type === 'Running' ? '🏃' :
                            activity.type === 'Cycle' ? '🚴' :
                            activity.type === 'Strength Training' ? '🏋️' :
                            activity.type === 'Yoga' ? '🧘' :
                            activity.type === 'Pilates' ? '🤸' :
                            activity.type === 'Cold Plunge' ? '🧊' :
                            activity.type === 'Sauna' ? '🔥' :
                            activity.type === 'Sports' ? '⚽' : '💪'
                          }</span>
                          <span className="text-sm text-white font-medium">
                            {activity.subtype || activity.type}
                          </span>
                        </div>
                        <div className="flex gap-3 mt-1 text-[10px] text-gray-400">
                          {activity.duration && <span>{activity.duration} min</span>}
                          {activity.distance && <span>{activity.distance} mi</span>}
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

// History Tab
const HistoryTab = ({ onShare, activities = [], calendarData = {}, userData, onAddActivity, onDeleteActivity, onEditActivity, initialView = 'calendar', initialStatsSubView = 'overview', activeStreaksRef, calendarRef, statsRef, progressPhotosRef, user, userProfile }) => {
  const [view, setView] = useState(initialView);
  const [statsSubView, setStatsSubView] = useState(initialStatsSubView); // 'overview' or 'records'
  const [calendarView, setCalendarView] = useState('heatmap');
  const [selectedDate, setSelectedDate] = useState(getTodayDate());
  const [selectedDayActivity, setSelectedDayActivity] = useState(null); // For activity detail modal

  // Calendar hints state - shows first-visit tips
  const [showCalendarHints, setShowCalendarHints] = useState(() => {
    return !localStorage.getItem('hasSeenCalendarHints');
  });

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

  // Dismiss calendar hints
  const dismissCalendarHints = () => {
    setShowCalendarHints(false);
    localStorage.setItem('hasSeenCalendarHints', 'true');
  };

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
  const [totalsView, setTotalsView] = useState('this-month');
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
    if (['Running', 'Cycle', 'Sports'].includes(activity.type)) return 'cardio';
    if (['Cold Plunge', 'Sauna', 'Yoga', 'Pilates'].includes(activity.type)) return 'recovery';
    return 'other';
  };
  
  // Calculate weekly stats for comparison (last week and average)
  const calculateWeeklyStats = () => {
    // Calculate last week's stats
    const lastWeekStart = new Date(today);
    lastWeekStart.setDate(today.getDate() - today.getDay() - 7); // Start of last week (Sunday)
    lastWeekStart.setHours(0, 0, 0, 0);
    
    const lastWeekEnd = new Date(lastWeekStart);
    lastWeekEnd.setDate(lastWeekStart.getDate() + 6); // End of last week (Saturday)
    lastWeekEnd.setHours(23, 59, 59, 999);
    
    const lastWeekActivities = activities.filter(a => {
      const actDate = parseLocalDate(a.date);
      return actDate >= lastWeekStart && actDate <= lastWeekEnd;
    });
    
    const lastWeekLifts = lastWeekActivities.filter(a => getActivityCategory(a) === 'lifting').length;
    const lastWeekCardio = lastWeekActivities.filter(a => getActivityCategory(a) === 'cardio').length;
    const lastWeekRecovery = lastWeekActivities.filter(a => getActivityCategory(a) === 'recovery').length;
    const lastWeekMiles = lastWeekActivities.filter(a => a.type === 'Running' || a.type === 'Cycle').reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);
    
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
        const totalMiles = pastActivities.filter(a => a.type === 'Running' || a.type === 'Cycle').reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);
        
        avgLifts = Math.round((totalLifts / weeksBetween) * 10) / 10;
        avgCardio = Math.round((totalCardio / weeksBetween) * 10) / 10;
        avgRecovery = Math.round((totalRecovery / weeksBetween) * 10) / 10;
        avgMiles = Math.round((totalMiles / weeksBetween) * 10) / 10;
      }
    }
    
    return {
      'week-2': {
        lifts: lastWeekLifts,
        cardio: lastWeekCardio,
        recovery: lastWeekRecovery,
        miles: lastWeekMiles,
        calories: 0
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
    const miles = weekActivities.filter(a => a.type === 'Running' || a.type === 'Cycle').reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);

    return {
      workouts: lifts + cardio, 
      lifts,
      cardio,
      recovery, 
      calories: 0, 
      steps: 0, 
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
    
    if (totalsView === 'this-month') {
      // This month
      filteredActivities = activities.filter(a => a.date && a.date.startsWith(thisMonthStr));
    } else if (totalsView === 'last-month') {
      // Last month
      filteredActivities = activities.filter(a => a.date && a.date.startsWith(lastMonthStr));
    } else if (totalsView.match(/^\d{4}-\d{2}$/)) {
      // Specific month (e.g., "2026-01")
      filteredActivities = activities.filter(a => a.date && a.date.startsWith(totalsView));
    } else if (totalsView === currentYearStr) {
      // Current year
      filteredActivities = activities.filter(a => a.date && a.date.startsWith(currentYearStr));
    } else {
      // All-time
      filteredActivities = activities;
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
    
    return {
      workouts: lifts.length + cardioActs.length,
      recovery: recoveryActs.length,
      miles: cardioActs.filter(a => a.type === 'Running' || a.type === 'Cycle').reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0),
      lifting: calcBreakdown(lifts),
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
    <div className="pb-32">
      {/* Header */}
      <div className="px-4 pt-2 pb-4">
        <h1 className="text-xl font-bold text-white">History</h1>
        <p className="text-sm text-gray-500">Track your progress over time.</p>
      </div>

      {/* Active Streaks Section */}
      <div ref={activeStreaksRef} className="mx-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 uppercase tracking-wider">Active Streaks</span>
            <span>🔥</span>
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
        
        {/* Master Streak - Hero */}
        <div className="p-4 rounded-2xl mb-3" style={{ background: 'linear-gradient(135deg, rgba(255,215,0,0.15) 0%, rgba(255,149,0,0.1) 100%)', border: '1px solid rgba(255,215,0,0.3)' }}>
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">🏆</span>
            <div>
              <div className="text-3xl font-black" style={{ color: '#FFD700' }}>{streaks.master} Weeks</div>
              <div className="text-sm text-gray-300">All goals hit</div>
            </div>
          </div>
          <div className="text-xs text-gray-500 mt-2 pt-2 border-t border-white/10">
            Your longest: {records.longestMasterStreak} weeks
          </div>
        </div>
        
        {/* Sub Streaks - 2x2 Grid */}
        <div className="grid grid-cols-2 gap-2">
          {/* Strength Streak */}
          <div className="px-3 py-2.5 rounded-xl bg-zinc-800/60 relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl" style={{ backgroundColor: '#00FF94' }}></div>
            <div className="flex items-center gap-2">
              <span className="text-base">🏋️</span>
              <span className="text-xl font-bold" style={{ color: '#00FF94' }}>{streaks.lifts} Weeks</span>
            </div>
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-xs text-gray-400">Strength</span>
              <span className="text-[10px] text-gray-500">{goals.liftsPerWeek}+ per week</span>
            </div>
          </div>

          {/* Cardio Streak */}
          <div className="px-3 py-2.5 rounded-xl bg-zinc-800/60 relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl" style={{ backgroundColor: '#FF9500' }}></div>
            <div className="flex items-center gap-2">
              <span className="text-base">🏃</span>
              <span className="text-xl font-bold" style={{ color: '#FF9500' }}>{streaks.cardio} Weeks</span>
            </div>
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-xs text-gray-400">Cardio</span>
              <span className="text-[10px] text-gray-500">{goals.cardioPerWeek}+ per week</span>
            </div>
          </div>

          {/* Recovery Streak */}
          <div className="px-3 py-2.5 rounded-xl bg-zinc-800/60 relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl" style={{ backgroundColor: '#00D1FF' }}></div>
            <div className="flex items-center gap-2">
              <span className="text-base">🧊</span>
              <span className="text-xl font-bold" style={{ color: '#00D1FF' }}>{streaks.recovery} Weeks</span>
            </div>
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-xs text-gray-400 whitespace-nowrap">Recov</span>
              <span className="text-[10px] text-gray-500">{goals.recoveryPerWeek}+ per week</span>
            </div>
          </div>

          {/* Steps Streak */}
          <div className="px-3 py-2.5 rounded-xl bg-zinc-800/60 relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl" style={{ backgroundColor: '#BF5AF2' }}></div>
            <div className="flex items-center gap-2">
              <span className="text-base">👟</span>
              <span className="text-xl font-bold" style={{ color: '#BF5AF2' }}>{streaks.stepsGoal} Weeks</span>
            </div>
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-xs text-gray-400">Steps</span>
              <span className="text-[10px] text-gray-500">{(goals.stepsPerDay/1000).toFixed(0)}k+ daily avg</span>
            </div>
          </div>
        </div>
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
            onClick={() => setView('progress')}
            className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors duration-200 relative z-10"
            style={{
              color: view === 'progress' ? 'white' : 'rgba(255,255,255,0.5)'
            }}
          >
            Compare
          </button>
        </div>

        {/* Calendar View */}
        {view === 'calendar' && (
          <div ref={calendarRef} className="mx-4 mt-2">
          <div className="mb-4">
            <div className="text-sm font-semibold text-white">Activity Calendar</div>
            <p className="text-[11px] text-gray-500 mt-0.5">Tap any day or week to see details</p>
          </div>

          {/* First-visit calendar hints */}
          {showCalendarHints && (
            <div
              className="mb-4 p-3 rounded-xl relative"
              style={{
                backgroundColor: 'rgba(0,209,255,0.1)',
                border: '1px solid rgba(0,209,255,0.3)'
              }}
            >
              <button
                onClick={dismissCalendarHints}
                className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full"
                style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
              >
                <span className="text-gray-400 text-sm">×</span>
              </button>
              <div className="flex items-start gap-2 pr-6">
                <span className="text-base">💡</span>
                <div>
                  <p className="text-xs text-white font-medium mb-1">Pro tips</p>
                  <p className="text-[11px] text-gray-300 leading-relaxed">
                    Tap the <span className="inline-flex items-center justify-center w-4 h-4 rounded text-[8px]" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>📊</span> buttons on the left for weekly breakdowns. Scroll down below the calendar to compare this week vs your average or last week.
                  </p>
                </div>
              </div>
            </div>
          )}
          
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
              onClick={goToToday}
              className="text-lg font-bold transition-all duration-150"
              style={{ color: isCurrentMonth ? 'white' : '#00FF94' }}
            >
              {new Date(displayedYear, displayedMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
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
                {/* Week stats button */}
                <button
                  onClick={() => {
                    setSelectedWeek(week);
                    setShowWeekStats(true);
                  }}
                  className="w-8 h-8 rounded-md flex items-center justify-center text-[10px] transition-all duration-150"
                  style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                  onTouchStart={(e) => {
                    e.currentTarget.style.transform = 'scale(0.85)';
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                  }}
                  onTouchEnd={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                  }}
                  onMouseDown={(e) => {
                    e.currentTarget.style.transform = 'scale(0.85)';
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                  }}
                  onMouseUp={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                  }}
                >
                  📊
                </button>
                {/* Day cells (includes overflow days from adjacent months) */}
                {week.days.map((day) => {
                  const dayActivities = calendarData[day.date] || [];
                  const todayStr = getTodayDate();
                  const isToday = day.date === todayStr;
                  const isFuture = day.date > todayStr; // Simple string comparison works for YYYY-MM-DD format

                  return (
                    <button
                      key={day.date}
                      onClick={() => {
                        setSelectedDate(day.date);
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
                        opacity: day.isOverflow ? 0.35 : (isFuture ? 0.3 : 1)
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
                <span>📊</span>
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
                  <div className="text-[10px] text-gray-400 whitespace-nowrap">🏋️ Strength</div>
                  {(() => {
                    const compare = compareWeek === 'average' ? weeklyStats['average']?.lifts || 0 : weeklyStats['week-2']?.lifts || 0;
                    if (currentWeekStats.lifts > compare) return <div className="text-[10px] mt-1" style={{ color: '#00FF94' }}>↑</div>;
                    if (currentWeekStats.lifts < compare) return <div className="text-[10px] mt-1" style={{ color: '#FF453A' }}>↓</div>;
                    return <div className="text-[10px] mt-1 opacity-0">-</div>;
                  })()}
                </div>
                <div>
                  <div className="text-lg font-black text-white">{currentWeekStats.cardio}</div>
                  <div className="text-[10px] text-gray-400 whitespace-nowrap">🏃 Cardio</div>
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
                  <div className="text-[10px] text-gray-400 whitespace-nowrap">🏋️ Strength</div>
                  <div className="text-[10px] mt-1 opacity-0">-</div>
                </div>
                <div>
                  <div className="text-lg font-black">{compareWeek === 'average' ? weeklyStats['average']?.cardio || 0 : weeklyStats['week-2']?.cardio || 0}</div>
                  <div className="text-[10px] text-gray-400 whitespace-nowrap">🏃 Cardio</div>
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
                  <div className="text-lg font-black">{compareWeek === 'average' ? weeklyStats['average']?.miles || 0 : weeklyStats['week-2']?.miles || 0}</div>
                  <div className="text-[10px] text-gray-400 whitespace-nowrap">📍 Miles</div>
                  <div className="text-[10px] mt-1 opacity-0">-</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Day Stats Modal - Full screen like week review */}
      {(showDayModal || dayModalClosing) && calendarData[selectedDate] && (() => {
        // Get full activity data from activities array (has IDs and all stats)
        const fullDayActivities = activities.filter(a => a.date === selectedDate);
        const lifts = fullDayActivities.filter(a =>
          a.type === 'Strength Training' ||
          (a.type === 'Other' && (a.customActivityCategory === 'strength' || a.countToward === 'strength'))
        );
        const cardioActivities = fullDayActivities.filter(a =>
          a.type === 'Running' || a.type === 'Cycle' || a.type === 'Sports' ||
          (a.type === 'Other' && (a.customActivityCategory === 'cardio' || a.countToward === 'cardio'))
        );
        const recoveryActivities = fullDayActivities.filter(a =>
          a.type === 'Cold Plunge' || a.type === 'Sauna' || a.type === 'Yoga' || a.type === 'Pilates' ||
          (a.type === 'Other' && (a.customActivityCategory === 'recovery' || a.countToward === 'recovery'))
        );
        
        // Format date nicely
        const dateObj = new Date(selectedDate + 'T12:00:00');
        const formattedDate = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        
        // Calculate daily totals from actual data
        const dayCalories = fullDayActivities.reduce((sum, a) => sum + (parseInt(a.calories) || 0), 0);
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
                  <div className="text-[10px] text-gray-400">🏋️ Strength</div>
                </div>
                <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(255,149,0,0.1)' }}>
                  <div className="text-2xl font-black" style={{ color: '#FF9500' }}>{cardioActivities.length}</div>
                  <div className="text-[10px] text-gray-400">🏃 Cardio</div>
                </div>
                <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(0,209,255,0.1)' }}>
                  <div className="text-2xl font-black" style={{ color: '#00D1FF' }}>{recoveryActivities.length}</div>
                  <div className="text-[10px] text-gray-400">🧊 Recovery</div>
                </div>
              </div>

              {/* Daily Totals */}
              <div className="mb-6">
                <div className="text-sm font-semibold text-white mb-3">📊 Daily Totals</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    <div className="text-lg font-black">{dayCalories.toLocaleString()}</div>
                    <div className="text-[10px] text-gray-400">Calories Burned</div>
                  </div>
                  <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    <div className="text-lg font-black">{dayMiles ? parseFloat(dayMiles).toFixed(1) : 0} mi</div>
                    <div className="text-[10px] text-gray-400">Miles Run</div>
                  </div>
                  <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    <div className="text-lg font-black">{totalSessions}</div>
                    <div className="text-[10px] text-gray-400">Total Sessions</div>
                  </div>
                  <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    <div className="text-lg font-black">{fullDayActivities.reduce((sum, a) => sum + (a.duration || 0), 0)} min</div>
                    <div className="text-[10px] text-gray-400">Total Duration</div>
                  </div>
                </div>
              </div>

              {/* Activities Completed Header */}
              <div className="mb-4">
                <div className="text-sm font-semibold text-white">💪 Activities Completed</div>
                <p className="text-[11px] text-gray-500 mt-0.5">Swipe left to delete, tap for details</p>
              </div>

              <SwipeableProvider>
              {/* Strength Section */}
              {lifts.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-medium text-gray-300">🏋️ Strength</span>
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
                              {activity.type === 'Other' && activity.customEmoji && <span>{activity.customEmoji}</span>}
                              {activity.type === 'Other' ? (activity.subtype || activity.type) : (activity.strengthType && activity.focusArea ? `${activity.strengthType} • ${activity.focusArea}` : activity.subtype || 'Strength Training')}
                            </div>
                            <span className="text-gray-500 text-xs">›</span>
                          </div>
                          <div className="flex gap-4 text-xs text-gray-400">
                            {activity.duration && <span>{activity.duration} min</span>}
                            {activity.calories && <span>{activity.calories} cal</span>}
                            {activity.avgHr && <span>♥ {activity.avgHr}</span>}
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
                    <span className="text-xs font-medium text-gray-300">🏃 Cardio</span>
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
                              {activity.type === 'Other' && activity.customEmoji && <span>{activity.customEmoji}</span>}
                              {activity.subtype || activity.type}
                            </div>
                            <span className="text-gray-500 text-xs">›</span>
                          </div>
                          <div className="flex gap-4 text-xs text-gray-400">
                            {activity.distance && <span>{activity.distance} mi</span>}
                            {activity.duration && <span>{activity.duration} min</span>}
                            {activity.calories && <span>{activity.calories} cal</span>}
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
                              {activity.type === 'Other' && activity.customEmoji && <span>{activity.customEmoji}</span>}
                              {activity.type === 'Other' ? (activity.subtype || activity.type) : (activity.subtype ? `${activity.type} • ${activity.subtype}` : activity.type)}
                            </div>
                            <span className="text-gray-500 text-xs">›</span>
                          </div>
                          <div className="flex gap-4 text-xs text-gray-400">
                            {activity.duration && <span>{activity.duration} min</span>}
                            {activity.calories && <span>{activity.calories} cal</span>}
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
            <div className="text-sm font-semibold text-white">Your Stats</div>
            <p className="text-[11px] text-gray-500 mt-0.5">Your totals over time</p>
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
              <select
                value={totalsView}
                onChange={(e) => setTotalsView(e.target.value)}
                className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs flex-shrink-0"
              >
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
            )}
          </div>

          {/* Overview Sub-View */}
          {statsSubView === 'overview' && (
            <>

              {/* Main Stats Grid */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="p-4 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(0, 255, 148, 0.06) 0%, rgba(39, 39, 42, 0.5) 100%)' }}>
                  <div className="text-4xl font-black" style={{ color: '#00FF94' }}>{Object.values(totalsData.lifting || {}).reduce((a, b) => a + b, 0)}</div>
                  <div className="text-sm text-gray-400 flex items-center gap-1.5 mt-1">
                    <span>🏋️</span>
                    <span>Strength</span>
                  </div>
                </div>
                <div className="p-4 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(255, 149, 0, 0.06) 0%, rgba(39, 39, 42, 0.5) 100%)' }}>
                  <div className="text-4xl font-black" style={{ color: '#FF9500' }}>{Object.values(totalsData.cardio || {}).reduce((a, b) => a + b, 0)}</div>
                  <div className="text-sm text-gray-400 flex items-center gap-1.5 mt-1">
                    <span>🏃</span>
                    <span>Cardio</span>
                  </div>
                </div>
                <div className="p-4 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(0, 209, 255, 0.06) 0%, rgba(39, 39, 42, 0.5) 100%)' }}>
                  <div className="text-4xl font-black" style={{ color: '#00D1FF' }}>{totalsData.recovery}</div>
                  <div className="text-sm text-gray-400 flex items-center gap-1.5 mt-1">
                    <span>🧊</span>
                    <span>Recovery</span>
                  </div>
                </div>
                <div className="p-4 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(255, 87, 87, 0.06) 0%, rgba(39, 39, 42, 0.5) 100%)' }}>
                  <div className="text-4xl font-black" style={{ color: '#FF5757' }}>{totalsData.miles.toFixed(1)}</div>
                  <div className="text-sm text-gray-400 flex items-center gap-1.5 mt-1">
                    <span>📍</span>
                    <span>Miles Run</span>
                  </div>
                </div>
              </div>

              {/* Strength Breakdown */}
              <div className="mb-6">
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">🏋️ Strength Breakdown</div>
                <div className="p-4 rounded-2xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  {Object.keys(totalsData.lifting || {}).length > 0 ? (
                    <div className="space-y-2">
                      {Object.entries(totalsData.lifting).map(([type, count]) => (
                        <div key={type} className="flex items-center justify-between">
                          <span className="text-gray-400">{type}</span>
                          <span className="font-bold">{count}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 text-sm text-center">No strength training logged yet</p>
                  )}
                </div>
              </div>

              {/* Cardio Breakdown */}
              <div className="mb-6">
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">🏃 Cardio Breakdown</div>
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
                          <span className="text-xl">{type === 'Cold Plunge' ? '🧊' : type === 'Sauna' ? '🔥' : type === 'Pilates' ? '🤸' : '🧘'}</span>
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
                <div className="text-sm font-semibold text-white">Hall of Fame</div>
                <p className="text-[11px] text-gray-500 mt-0.5">Your personal bests</p>
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
                        <div className="text-xs text-gray-500">Longest Master Streak</div>
                        <div className="text-2xl font-black text-white">
                          {records.longestMasterStreak ? `${records.longestMasterStreak} weeks` : '—'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Other Streaks */}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <div className="text-[10px] text-gray-600 mb-1">🏋️ Strength</div>
                      <div className="text-lg font-bold text-white">
                        {records.longestStrengthStreak ? `${records.longestStrengthStreak}w` : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-gray-600 mb-1">🏃 Cardio</div>
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
                  {/* Highest Calories */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm">🔥</span>
                      <div className="text-xs text-gray-500">Highest Calories</div>
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
                      <span className="text-sm">🏋️</span>
                      <div className="text-xs text-gray-500">Longest Strength</div>
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
                      <span className="text-sm">🏃</span>
                      <div className="text-xs text-gray-500">Longest Cardio</div>
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

                  {/* Longest Distance */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm">📍</span>
                      <div className="text-xs text-gray-500">Longest Distance</div>
                    </div>
                    <div className="text-right">
                      <div className="text-base font-bold text-white">
                        {getRecordValue(records.longestDistance) ? `${parseFloat(getRecordValue(records.longestDistance)).toFixed(1)} mi` : '—'}
                      </div>
                      {getRecordType(records.longestDistance) && (
                        <div className="text-[9px] text-gray-600">{getRecordType(records.longestDistance)}</div>
                      )}
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
            <TrendsView activities={activities} calendarData={calendarData} />
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

        const getActivityIcon = (activity) => {
          const icons = {
            'Strength Training': '💪',
            'Running': '🏃',
            'Cycle': '🚴',
            'Sports': '🏀',
            'Cold Plunge': '🧊',
            'Sauna': '🔥',
            'Yoga': '🧘',
            'Pilates': '🤸',
            'Other': '⭐'
          };
          // Use custom emoji for "Other" activities
          if (activity.type === 'Other' && activity.customEmoji) {
            return activity.customEmoji;
          }
          // Use sport emoji for Sports activities
          if (activity.type === 'Sports' && activity.sportEmoji) {
            return activity.sportEmoji;
          }
          return icons[activity.type] || '💪';
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
                { key: 'cardio', label: '🏃 Cardio' },
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
                          />
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
                                  />
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
                            <p className="text-xl">🏃</p>
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
                              { emoji: '🏃', value: cardioSessions.toString(), label: 'cardio sessions', color: '#00D1FF', bg: 'rgba(0,209,255,0.15)' },
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
                                // console.log('Share failed, falling back to download:', e);
                              }
                            }

                            // Fallback: download the image
                            const link = document.createElement('a');
                            link.download = `dayseven-progress-${Date.now()}.png`;
                            link.href = canvas.toDataURL('image/png', 1.0);
                            link.click();
                          } catch (err) {
                            // console.error('Failed to generate share image:', err);
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
        weekData={selectedWeek ? (() => {
          // Calculate week data from calendarData
          const weekActivities = [];
          let currentDate = new Date(selectedWeek.startDate);
          const endDate = new Date(selectedWeek.endDate);
          
          while (currentDate <= endDate) {
            const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
            const dayActivities = calendarData[dateStr] || [];
            dayActivities.forEach(a => {
              weekActivities.push({ ...a, date: dateStr });
            });
            currentDate.setDate(currentDate.getDate() + 1);
          }
          
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

          const lifts = weekActivities.filter(a => a.type === 'Strength Training');
          const cardioArr = weekActivities.filter(a => ['Running', 'Cycle', 'Sports'].includes(a.type));
          const recoveryArr = weekActivities.filter(a => ['Cold Plunge', 'Sauna', 'Yoga'].includes(a.type));
          const miles = cardioArr.filter(a => a.type === 'Running' || a.type === 'Cycle').reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);

          return {
            lifts: lifts.length,
            cardio: cardioArr.length,
            recovery: recoveryArr.length,
            calories: 0,
            steps: 0,
            miles: miles,
            activities: weekActivities,
            goalsMet: lifts.length >= goals.liftsPerWeek && cardioArr.length >= goals.cardioPerWeek && recoveryArr.length >= goals.recoveryPerWeek
          };
        })() : null}
        weekLabel={selectedWeek?.label || ''}
        onDeleteActivity={onDeleteActivity}
        onSelectActivity={(activity) => setSelectedDayActivity(activity)}
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
      />
    </div>
  );
};

// Profile Tab Component
const ProfileTab = ({ user, userProfile, userData, onSignOut, onEditGoals, onUpdatePhoto, onShare, onStartTour, onUpdatePrivacy, onChangePassword, onResetPassword, onDeleteAccount }) => {
  const [isEmailPasswordUser, setIsEmailPasswordUser] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

  // Check if user signed in with email/password (not social login)
  useEffect(() => {
    const checkAuthProvider = async () => {
      // First try web Firebase auth
      if (auth.currentUser?.providerData?.some(p => p.providerId === 'password')) {
        setIsEmailPasswordUser(true);
        return;
      }
      // Then try prop
      if (user?.providerData?.some(p => p.providerId === 'password')) {
        setIsEmailPasswordUser(true);
        return;
      }
      // For native, use Capacitor plugin
      if (Capacitor.isNativePlatform()) {
        try {
          const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
          const result = await FirebaseAuthentication.getCurrentUser();
          if (result.user?.providerData?.some(p => p.providerId === 'password')) {
            setIsEmailPasswordUser(true);
          }
        } catch (e) {
          // Ignore errors
        }
      }
    };
    checkAuthProvider();
  }, [user]);
  const [showPhotoOptions, setShowPhotoOptions] = useState(false);
  const [showPhotoPreview, setShowPhotoPreview] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [capturedFile, setCapturedFile] = useState(null);
  const [imagePosition, setImagePosition] = useState({ x: 0, y: 0 });
  const [imageScale, setImageScale] = useState(1);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const cropContainerRef = useRef(null);

  // Privacy settings (default to true if not set)
  const showInActivityFeed = userProfile?.privacySettings?.showInActivityFeed !== false;
  const showOnLeaderboard = userProfile?.privacySettings?.showOnLeaderboard !== false;

  const handlePrivacyToggle = (setting, value) => {
    if (onUpdatePrivacy) {
      onUpdatePrivacy({
        ...userProfile?.privacySettings,
        [setting]: value
      });
    }
  };

  const goalLabels = {
    liftsPerWeek: { label: 'Strength', icon: '🏋️', suffix: '/week' },
    cardioPerWeek: { label: 'Cardio', icon: '🏃', suffix: '/week' },
    recoveryPerWeek: { label: 'Recovery', icon: '🧊', suffix: '/week' },
    stepsPerDay: { label: 'Steps', icon: '👟', suffix: '/day', format: (v) => `${(v/1000).toFixed(0)}k` }
  };

  // Check if today is Monday (0 = Sunday, 1 = Monday)
  const isMonday = new Date().getDay() === 1;
  const canEditGoals = isMonday;

  // Detect if user is on mobile device
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  const handlePhotoClick = () => {
    setShowPhotoOptions(true);
  };

  const handleChooseFromLibrary = async () => {
    setShowPhotoOptions(false);

    if (Capacitor.isNativePlatform()) {
      try {
        const image = await Camera.getPhoto({
          quality: 90,
          allowEditing: false,
          resultType: CameraResultType.DataUrl,
          source: CameraSource.Photos
        });

        if (image.dataUrl) {
          // Convert data URL to blob/file
          const response = await fetch(image.dataUrl);
          const blob = await response.blob();
          const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });

          setPreviewImage(image.dataUrl);
          setCapturedFile(file);
          setShowPhotoPreview(true);
        }
      } catch (error) {
        if (error.message !== 'User cancelled photos app') {
          // console.error('Error picking photo:', error);
        }
      }
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleTakePhoto = async () => {
    setShowPhotoOptions(false);

    if (Capacitor.isNativePlatform()) {
      try {
        const image = await Camera.getPhoto({
          quality: 90,
          allowEditing: false,
          resultType: CameraResultType.DataUrl,
          source: CameraSource.Camera
        });

        if (image.dataUrl) {
          // Convert data URL to blob/file
          const response = await fetch(image.dataUrl);
          const blob = await response.blob();
          const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });

          setPreviewImage(image.dataUrl);
          setCapturedFile(file);
          setShowPhotoPreview(true);
        }
      } catch (error) {
        if (error.message !== 'User cancelled photos app') {
          // console.error('Error taking photo:', error);
        }
      }
    } else {
      cameraInputRef.current?.click();
    }
  };

  const handleCameraCapture = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('Image must be less than 5MB');
      return;
    }

    // Create preview URL
    const imageUrl = URL.createObjectURL(file);
    setPreviewImage(imageUrl);
    setCapturedFile(file);
    setShowPhotoPreview(true);

    // Reset input for potential retake
    e.target.value = '';
  };

  const handleRetakePhoto = () => {
    // Clean up preview URL
    if (previewImage) {
      URL.revokeObjectURL(previewImage);
    }
    setPreviewImage(null);
    setCapturedFile(null);
    setShowPhotoPreview(false);
    setImagePosition({ x: 0, y: 0 });
    setImageScale(1);
    // Trigger camera again
    setTimeout(() => {
      cameraInputRef.current?.click();
    }, 100);
  };

  const handleChooseAnother = async () => {
    // Clean up preview URL
    if (previewImage) {
      URL.revokeObjectURL(previewImage);
    }
    setPreviewImage(null);
    setCapturedFile(null);
    setShowPhotoPreview(false);
    setImagePosition({ x: 0, y: 0 });
    setImageScale(1);
    // Open photo library
    setTimeout(() => {
      handleChooseFromLibrary();
    }, 100);
  };

  const handleSavePhoto = async () => {
    if (!capturedFile) return;

    setIsUploadingPhoto(true);
    try {
      // Crop the image based on user's position/zoom
      const croppedFile = await cropImage();
      await onUpdatePhoto(croppedFile);
      // Clean up
      if (previewImage) {
        URL.revokeObjectURL(previewImage);
      }
      setPreviewImage(null);
      setCapturedFile(null);
      setShowPhotoPreview(false);
      setImagePosition({ x: 0, y: 0 });
      setImageScale(1);
    } catch (error) {
      // console.error('Error uploading photo:', error);
      alert('Failed to upload photo. Please try again.');
    }
    setIsUploadingPhoto(false);
  };

  const handleCancelPreview = () => {
    // Clean up preview URL
    if (previewImage) {
      URL.revokeObjectURL(previewImage);
    }
    setPreviewImage(null);
    setCapturedFile(null);
    setShowPhotoPreview(false);
    setImagePosition({ x: 0, y: 0 });
    setImageScale(1);
  };

  // Refs for gesture tracking (more responsive than state)
  const gestureRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    initialDistance: 0,
    initialScale: 1
  });

  // Calculate the display size of the image to cover the container
  const getImageDisplaySize = () => {
    const containerSize = 256; // w-64 h-64 = 256px

    if (imageDimensions.width === 0 || imageDimensions.height === 0) {
      return { width: containerSize, height: containerSize };
    }

    const imgAspect = imageDimensions.width / imageDimensions.height;

    // To "cover" the container, we scale so the smaller dimension fits exactly
    if (imgAspect > 1) {
      // Landscape: height fits, width overflows
      return {
        width: containerSize * imgAspect,
        height: containerSize
      };
    } else {
      // Portrait/square: width fits, height overflows
      return {
        width: containerSize,
        height: containerSize / imgAspect
      };
    }
  };

  // Calculate max drag bounds based on image dimensions and scale
  const getMaxOffset = (scale) => {
    const containerSize = 256;
    const { width, height } = getImageDisplaySize();

    // Apply scale
    const scaledWidth = width * scale;
    const scaledHeight = height * scale;

    // Max offset is how much the scaled image extends beyond the container on each side
    const maxX = Math.max(0, (scaledWidth - containerSize) / 2);
    const maxY = Math.max(0, (scaledHeight - containerSize) / 2);

    return { maxX, maxY };
  };

  // Touch handlers for drag and pinch-to-zoom
  const handleTouchStart = (e) => {
    e.preventDefault();
    const gesture = gestureRef.current;

    if (e.touches.length === 1) {
      gesture.isDragging = true;
      gesture.startX = e.touches[0].clientX - imagePosition.x;
      gesture.startY = e.touches[0].clientY - imagePosition.y;
    } else if (e.touches.length === 2) {
      gesture.isDragging = false;
      gesture.initialDistance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      gesture.initialScale = imageScale;
    }
  };

  const handleTouchMove = (e) => {
    e.preventDefault();
    const gesture = gestureRef.current;

    if (e.touches.length === 1 && gesture.isDragging) {
      const newX = e.touches[0].clientX - gesture.startX;
      const newY = e.touches[0].clientY - gesture.startY;

      // Limit drag bounds based on image dimensions and scale
      const { maxX, maxY } = getMaxOffset(imageScale);
      const boundedX = Math.max(-maxX, Math.min(maxX, newX));
      const boundedY = Math.max(-maxY, Math.min(maxY, newY));

      setImagePosition({ x: boundedX, y: boundedY });
    } else if (e.touches.length === 2 && gesture.initialDistance > 0) {
      const currentDistance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const newScale = Math.min(Math.max((currentDistance / gesture.initialDistance) * gesture.initialScale, 1), 4);
      setImageScale(newScale);

      // Adjust position when zooming out to keep image in bounds
      const { maxX, maxY } = getMaxOffset(newScale);
      setImagePosition(prev => ({
        x: Math.max(-maxX, Math.min(maxX, prev.x)),
        y: Math.max(-maxY, Math.min(maxY, prev.y))
      }));
    }
  };

  const handleTouchEnd = (e) => {
    e.preventDefault();
    const gesture = gestureRef.current;
    gesture.isDragging = false;
    gesture.initialDistance = 0;
  };

  // Load image dimensions when preview image changes
  useEffect(() => {
    if (previewImage) {
      const img = new Image();
      img.onload = () => {
        setImageDimensions({ width: img.width, height: img.height });
      };
      img.src = previewImage;
    } else {
      setImageDimensions({ width: 0, height: 0 });
    }
  }, [previewImage]);

  // Crop the image based on position and scale before upload
  const cropImage = () => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Output size (square for profile picture)
        const outputSize = 512;
        canvas.width = outputSize;
        canvas.height = outputSize;

        // Container size in CSS pixels (matches w-64 h-64 = 256px)
        const containerSize = 256;

        // The image fills the container with object-fit: cover
        // So we need to figure out how it's being displayed
        const imgAspect = img.width / img.height;
        let coverWidth, coverHeight;

        if (imgAspect > 1) {
          // Landscape: height fits, width overflows
          coverHeight = containerSize;
          coverWidth = containerSize * imgAspect;
        } else {
          // Portrait/square: width fits, height overflows
          coverWidth = containerSize;
          coverHeight = containerSize / imgAspect;
        }

        // Apply scale
        const scaledWidth = coverWidth * imageScale;
        const scaledHeight = coverHeight * imageScale;

        // Calculate how position translates to source coordinates
        // Position offset in pixels -> offset in image coordinates
        const pixelToImageX = img.width / scaledWidth;
        const pixelToImageY = img.height / scaledHeight;

        // Center of visible area in image coordinates
        // (accounting for the translate offset and scale transform origin at center)
        const centerX = img.width / 2 - imagePosition.x * pixelToImageX;
        const centerY = img.height / 2 - imagePosition.y * pixelToImageY;

        // Size of visible square in image coordinates
        const visibleSizeInImage = (containerSize / scaledWidth) * img.width;

        // Source rectangle
        const sourceX = centerX - visibleSizeInImage / 2;
        const sourceY = centerY - visibleSizeInImage / 2;

        // Clamp to image bounds
        const clampedX = Math.max(0, Math.min(img.width - visibleSizeInImage, sourceX));
        const clampedY = Math.max(0, Math.min(img.height - visibleSizeInImage, sourceY));

        // Draw the cropped region
        ctx.drawImage(
          img,
          clampedX, clampedY, visibleSizeInImage, visibleSizeInImage,
          0, 0, outputSize, outputSize
        );

        canvas.toBlob((blob) => {
          const croppedFile = new File([blob], 'profile.jpg', { type: 'image/jpeg' });
          resolve(croppedFile);
        }, 'image/jpeg', 0.9);
      };
      img.src = previewImage;
    });
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('Image must be less than 5MB');
      return;
    }

    setIsUploadingPhoto(true);
    try {
      await onUpdatePhoto(file);
    } catch (error) {
      // console.error('Error uploading photo:', error);
      alert('Failed to upload photo. Please try again.');
    }
    setIsUploadingPhoto(false);

    // Reset input
    e.target.value = '';
  };

  return (
    <div className="pb-32">
      {/* Header */}
      <div className="px-4 pt-2 pb-4">
        <h1 className="text-xl font-bold text-white">Profile</h1>
        <p className="text-sm text-gray-500">Set your standards. Earn your streaks.</p>
      </div>

      <div className="px-4">
        {/* Profile Section */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">PROFILE</h3>
          <div className="rounded-2xl p-4" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
            {/* Hidden file inputs */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/*"
              className="hidden"
            />
            <input
              type="file"
              ref={cameraInputRef}
              onChange={handleCameraCapture}
              accept="image/*;capture=camera"
              capture
              className="hidden"
            />

            {/* Profile Photo & Name */}
            <div className="flex items-center gap-4 mb-4">
              <button
                onClick={handlePhotoClick}
                disabled={isUploadingPhoto}
                className="relative w-16 h-16 rounded-full bg-zinc-700 flex items-center justify-center overflow-hidden group transition-all duration-150 active:scale-95"
              >
                {userProfile?.photoURL ? (
                  <img src={userProfile.photoURL} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-2xl text-white">
                    {userProfile?.displayName?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?'}
                  </span>
                )}
                {/* Camera overlay */}
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  {isUploadingPhoto ? (
                    <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                  )}
                </div>
              </button>
              <div className="flex-1">
                <div className="text-lg font-semibold text-white">
                  {userProfile?.displayName || 'User'}
                </div>
                {userProfile?.username && (
                  <div className="text-sm text-gray-400">@{userProfile.username}</div>
                )}
              </div>
            </div>

            {/* Profile Details */}
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 border-t border-zinc-700/50">
                <span className="text-sm text-gray-400">Email</span>
                <span className="text-sm text-white">{user?.email || 'Not set'}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-t border-zinc-700/50">
                <span className="text-sm text-gray-400">Username</span>
                <span className="text-sm text-white">@{userProfile?.username || 'Not set'}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-t border-zinc-700/50">
                <span className="text-sm text-gray-400">Member since</span>
                <span className="text-sm text-white">
                  {(() => {
                    const creationDate = user?.metadata?.creationTime || userProfile?.createdAt;
                    if (creationDate) {
                      return new Date(creationDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                    }
                    return 'Unknown';
                  })()}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Share Your Wins Section */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">CELEBRATE</h3>
          <button
            onClick={onShare}
            className="w-full rounded-2xl p-4 transition-all duration-150"
            style={{
              background: 'linear-gradient(135deg, rgba(0,255,148,0.1) 0%, rgba(0,209,255,0.1) 100%)',
              border: '1px solid rgba(0,255,148,0.2)',
              transform: 'scale(1)'
            }}
            onTouchStart={(e) => {
              e.currentTarget.style.transform = 'scale(0.98)';
              e.currentTarget.style.borderColor = 'rgba(0,255,148,0.4)';
            }}
            onTouchEnd={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.borderColor = 'rgba(0,255,148,0.2)';
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'scale(0.98)';
              e.currentTarget.style.borderColor = 'rgba(0,255,148,0.4)';
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.borderColor = 'rgba(0,255,148,0.2)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.borderColor = 'rgba(0,255,148,0.2)';
            }}
          >
            <div className="flex items-center gap-4">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: 'rgba(0,255,148,0.15)' }}
              >
                <span className="text-2xl">🏆</span>
              </div>
              <div className="flex-1 text-left">
                <div className="text-white font-semibold mb-0.5">Share Your Wins</div>
                <div className="text-gray-400 text-sm">Create a card to show off your streaks</div>
              </div>
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#00FF94"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
            </div>
          </button>
        </div>

        {/* Goals Section */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-gray-400">WEEKLY GOALS</h3>
            {canEditGoals ? (
              <button
                onClick={onEditGoals}
                className="text-sm font-medium px-3 py-1 rounded-full transition-all duration-150"
                style={{ color: '#00FF94', backgroundColor: 'rgba(0,255,148,0.1)', transform: 'scale(1)' }}
                onTouchStart={(e) => {
                  e.currentTarget.style.transform = 'scale(0.92)';
                  e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.2)';
                }}
                onTouchEnd={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.1)';
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = 'scale(0.92)';
                  e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.2)';
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.1)';
                }}
              >
                Edit
              </button>
            ) : (
              <span
                className="text-xs font-medium px-3 py-1 rounded-full flex items-center gap-1"
                style={{ color: 'rgba(255,255,255,0.4)', backgroundColor: 'rgba(255,255,255,0.05)' }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Mondays only
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-500 mb-3">Goals can only be edited on Mondays to keep your streaks honest</p>
          <div className="rounded-2xl p-4" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(goalLabels).map(([key, { label, icon, suffix, format }]) => (
                <div key={key} className="bg-zinc-700/30 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span>{icon}</span>
                    <span className="text-xs text-gray-400">{label}</span>
                  </div>
                  <div className="text-lg font-bold text-white">
                    {format ? format(userData?.goals?.[key] || 0) : userData?.goals?.[key] || 0}
                    <span className="text-xs text-gray-500 font-normal ml-1">{suffix}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Privacy Section */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">PRIVACY</h3>
          <div className="rounded-2xl p-4" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
            {/* Activity Feed Toggle */}
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(0,209,255,0.1)' }}>
                  <svg className="w-4 h-4" fill="none" stroke="#00D1FF" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
                  </svg>
                </div>
                <div>
                  <span className="text-sm text-white">Show in Activity Feed</span>
                  <p className="text-[11px] text-gray-500">Friends can see your workouts</p>
                </div>
              </div>
              <button
                onClick={() => {
                  triggerHaptic(ImpactStyle.Light);
                  handlePrivacyToggle('showInActivityFeed', !showInActivityFeed);
                }}
                className="w-12 h-7 rounded-full transition-all duration-200 relative"
                style={{
                  backgroundColor: showInActivityFeed ? '#00FF94' : 'rgba(255,255,255,0.2)'
                }}
              >
                <div
                  className="absolute top-1 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-200"
                  style={{
                    left: showInActivityFeed ? '26px' : '4px'
                  }}
                />
              </button>
            </div>

            {/* Leaderboard Toggle */}
            <div className="flex items-center justify-between py-2 border-t border-zinc-700/50 mt-2 pt-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(255,149,0,0.1)' }}>
                  <svg className="w-4 h-4" fill="none" stroke="#FF9500" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 0 1-.982-3.172M9.497 14.25a7.454 7.454 0 0 0 .981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 0 0 7.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 0 0 2.748 1.35m8.272-6.842V4.5c0 2.108-.966 3.99-2.48 5.228m2.48-5.492a46.32 46.32 0 0 1 2.916.52 6.003 6.003 0 0 1-5.395 4.972m0 0a6.726 6.726 0 0 1-2.749 1.35m0 0a6.772 6.772 0 0 1-2.992 0" />
                  </svg>
                </div>
                <div>
                  <span className="text-sm text-white">Appear on Leaderboards</span>
                  <p className="text-[11px] text-gray-500">Compete with friends</p>
                </div>
              </div>
              <button
                onClick={() => {
                  triggerHaptic(ImpactStyle.Light);
                  handlePrivacyToggle('showOnLeaderboard', !showOnLeaderboard);
                }}
                className="w-12 h-7 rounded-full transition-all duration-200 relative"
                style={{
                  backgroundColor: showOnLeaderboard ? '#00FF94' : 'rgba(255,255,255,0.2)'
                }}
              >
                <div
                  className="absolute top-1 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-200"
                  style={{
                    left: showOnLeaderboard ? '26px' : '4px'
                  }}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Password & Security Section - Only shown for email/password users */}
        {isEmailPasswordUser && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-400 mb-3">SECURITY</h3>
            <div className="rounded-2xl p-4" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
              {/* Change Password */}
              <button
                onClick={onChangePassword}
                className="w-full flex items-center justify-between py-2 transition-all duration-150"
                style={{ transform: 'scale(1)' }}
                onTouchStart={(e) => e.currentTarget.style.opacity = '0.7'}
                onTouchEnd={(e) => e.currentTarget.style.opacity = '1'}
                onMouseDown={(e) => e.currentTarget.style.opacity = '0.7'}
                onMouseUp={(e) => e.currentTarget.style.opacity = '1'}
                onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(0,255,148,0.1)' }}>
                    <svg className="w-4 h-4" fill="none" stroke="#00FF94" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <span className="text-sm text-white block">Change Password</span>
                    <p className="text-[11px] text-gray-500">Update your account password</p>
                  </div>
                </div>
                <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>

              {/* Reset Password */}
              <button
                onClick={onResetPassword}
                className="w-full flex items-center justify-between py-2 border-t border-zinc-700/50 mt-2 pt-4 transition-all duration-150"
                style={{ transform: 'scale(1)' }}
                onTouchStart={(e) => e.currentTarget.style.opacity = '0.7'}
                onTouchEnd={(e) => e.currentTarget.style.opacity = '1'}
                onMouseDown={(e) => e.currentTarget.style.opacity = '0.7'}
                onMouseUp={(e) => e.currentTarget.style.opacity = '1'}
                onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(255,149,0,0.1)' }}>
                    <svg className="w-4 h-4" fill="none" stroke="#FF9500" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <span className="text-sm text-white block">Reset Password via Email</span>
                    <p className="text-[11px] text-gray-500">Send a password reset link</p>
                  </div>
                </div>
                <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* App Info Section */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">APP</h3>
          <div className="rounded-2xl p-4" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
            <button
              onClick={onStartTour}
              className="w-full flex items-center justify-between py-2 transition-all duration-150"
              style={{ transform: 'scale(1)' }}
              onTouchStart={(e) => e.currentTarget.style.opacity = '0.7'}
              onTouchEnd={(e) => e.currentTarget.style.opacity = '1'}
              onMouseDown={(e) => e.currentTarget.style.opacity = '0.7'}
              onMouseUp={(e) => e.currentTarget.style.opacity = '1'}
              onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(0,255,148,0.1)' }}>
                  <span className="text-base">🎯</span>
                </div>
                <span className="text-sm text-white">Take the Tour</span>
              </div>
              <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
            <div className="flex items-center justify-between py-2 border-t border-zinc-700/50 mt-2">
              <span className="text-sm text-gray-400">Version</span>
              <span className="text-sm text-white">1.0.0</span>
            </div>
          </div>
        </div>

        {/* Sign Out Button */}
        <button
          className="w-full py-4 rounded-xl font-semibold text-red-500 transition-all duration-150"
          style={{ backgroundColor: 'rgba(255,69,58,0.1)', transform: 'scale(1)' }}
          onTouchStart={(e) => {
            e.currentTarget.style.transform = 'scale(0.98)';
            e.currentTarget.style.backgroundColor = 'rgba(255,69,58,0.2)';
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.backgroundColor = 'rgba(255,69,58,0.1)';
            triggerHaptic(ImpactStyle.Medium);
            onSignOut();
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = 'scale(0.98)';
            e.currentTarget.style.backgroundColor = 'rgba(255,69,58,0.2)';
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.backgroundColor = 'rgba(255,69,58,0.1)';
            onSignOut();
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.backgroundColor = 'rgba(255,69,58,0.1)';
          }}
        >
          Sign Out
        </button>

        {/* Delete Account Button */}
        <button
          className="w-full py-4 rounded-xl font-semibold text-gray-500 transition-all duration-150 mt-3 mb-8"
          style={{ backgroundColor: 'transparent', transform: 'scale(1)' }}
          onTouchStart={(e) => {
            e.currentTarget.style.transform = 'scale(0.98)';
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            e.currentTarget.style.transform = 'scale(1)';
            triggerHaptic(ImpactStyle.Light);
            onDeleteAccount();
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = 'scale(0.98)';
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            onDeleteAccount();
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          Delete Account
        </button>
      </div>

      {/* Photo Options Popup */}
      {showPhotoOptions && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => setShowPhotoOptions(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />

          {/* Modal */}
          <div
            className="relative w-full max-w-sm mx-6 rounded-3xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: '#1C1C1E',
              border: '1px solid rgba(255,255,255,0.1)'
            }}
          >
            {/* Header */}
            <div className="px-6 pt-6 pb-4 text-center border-b border-zinc-800">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(0,255,148,0.15)' }}>
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="#00FF94" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white">Change Profile Picture</h3>
              <p className="text-sm text-gray-500 mt-1">
                {isMobile ? 'Choose how to update your photo' : 'Select a photo from your files, or use the mobile app to take one'}
              </p>
            </div>

            {/* Options */}
            <div className="p-4 space-y-2">
              {isMobile && (
                <button
                  className="w-full py-3.5 px-4 rounded-xl flex items-center gap-3 transition-all duration-150"
                  style={{ backgroundColor: 'rgba(255,255,255,0.05)', transform: 'scale(1)' }}
                  onTouchStart={(e) => {
                    e.currentTarget.style.transform = 'scale(0.98)';
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                  }}
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                    triggerHaptic(ImpactStyle.Light);
                    handleTakePhoto();
                  }}
                  onMouseDown={(e) => {
                    e.currentTarget.style.transform = 'scale(0.98)';
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                  }}
                  onMouseUp={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                    handleTakePhoto();
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                  }}
                >
                  <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(0,255,148,0.1)' }}>
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="#00FF94" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-white font-medium">Take Photo</div>
                    <div className="text-xs text-gray-500">Use your camera</div>
                  </div>
                  <svg className="w-5 h-5 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              )}

              <button
                className="w-full py-3.5 px-4 rounded-xl flex items-center gap-3 transition-all duration-150"
                style={{ backgroundColor: 'rgba(255,255,255,0.05)', transform: 'scale(1)' }}
                onTouchStart={(e) => {
                  e.currentTarget.style.transform = 'scale(0.98)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                  triggerHaptic(ImpactStyle.Light);
                  handleChooseFromLibrary();
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = 'scale(0.98)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                  handleChooseFromLibrary();
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                }}
              >
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(255,149,0,0.1)' }}>
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="#FF9500" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                </div>
                <div className="flex-1 text-left">
                  <div className="text-white font-medium">Choose from Library</div>
                  <div className="text-xs text-gray-500">Select an existing photo</div>
                </div>
                <svg className="w-5 h-5 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>

            {/* Cancel */}
            <div className="px-4 pb-4">
              <button
                className="w-full py-3 rounded-xl text-gray-400 font-medium transition-all duration-150"
                style={{ backgroundColor: 'rgba(255,255,255,0.03)', transform: 'scale(1)' }}
                onTouchStart={(e) => {
                  e.currentTarget.style.transform = 'scale(0.98)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)';
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)';
                  setShowPhotoOptions(false);
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = 'scale(0.98)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)';
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)';
                  setShowPhotoOptions(false);
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)';
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Photo Preview Modal */}
      {showPhotoPreview && previewImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
          {/* Preview Image */}
          <div className="relative w-full h-full flex flex-col">
            {/* Header - pushed down to avoid Dynamic Island */}
            <div className="absolute top-0 left-0 right-0 z-10 px-4 flex items-center justify-between" style={{ paddingTop: 'calc(env(safe-area-inset-top, 20px) + 10px)', background: 'linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, transparent 100%)', paddingBottom: '20px' }}>
              <button
                onClick={handleCancelPreview}
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
              >
                <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
              <span className="text-white font-semibold text-lg">Preview</span>
              <div className="w-10" />
            </div>

            {/* Image Container with touch handlers */}
            <div className="flex-1 flex items-center justify-center p-4">
              <div
                ref={cropContainerRef}
                className="relative w-64 h-64 rounded-full overflow-hidden border-4 border-white/20"
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                style={{ touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}
              >
                {imageDimensions.width > 0 && imageDimensions.height > 0 ? (() => {
                  const aspect = imageDimensions.width / imageDimensions.height;
                  const isLandscape = aspect > 1;
                  const imgWidth = isLandscape ? Math.round(256 * aspect) : 256;
                  const imgHeight = isLandscape ? 256 : Math.round(256 / aspect);
                  return (
                    <img
                      src={previewImage}
                      alt="Preview"
                      draggable={false}
                      style={{
                        position: 'absolute',
                        width: `${imgWidth}px`,
                        height: `${imgHeight}px`,
                        maxWidth: 'none',
                        maxHeight: 'none',
                        objectFit: 'fill',
                        left: '50%',
                        top: '50%',
                        transform: `translate(calc(-50% + ${imagePosition.x}px), calc(-50% + ${imagePosition.y}px)) scale(${imageScale})`,
                        transformOrigin: 'center center',
                        pointerEvents: 'none',
                        userSelect: 'none'
                      }}
                    />
                  );
                })() : (
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  </div>
                )}
              </div>
            </div>

            {/* Hint text */}
            <div className="absolute left-0 right-0 z-10 text-center" style={{ top: 'calc(50% + 160px)' }}>
              <p className="text-gray-500 text-xs">Drag to reposition • Pinch to zoom</p>
            </div>

            {/* Action Buttons */}
            <div className="absolute bottom-0 left-0 right-0 z-10 px-6 pb-10 pt-6" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 100%)' }}>
              <p className="text-center text-gray-400 text-sm mb-4">This is how your profile picture will look</p>

              <div className="flex gap-3">
                <button
                  onClick={handleChooseAnother}
                  disabled={isUploadingPhoto}
                  className="flex-1 py-3.5 rounded-xl font-semibold transition-all duration-150 active:scale-98"
                  style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: 'white' }}
                >
                  Choose Another
                </button>
                <button
                  onClick={handleSavePhoto}
                  disabled={isUploadingPhoto}
                  className="flex-1 py-3.5 rounded-xl font-semibold transition-all duration-150 active:scale-98 flex items-center justify-center gap-2"
                  style={{ backgroundColor: '#00FF94', color: 'black' }}
                >
                  {isUploadingPhoto ? (
                    <>
                      <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Use Photo'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Main App
export default function DaySevenApp() {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isOnboarded, setIsOnboarded] = useState(null); // null = loading, true = onboarded, false = needs onboarding
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('home');
  const [prevTab, setPrevTab] = useState('home');
  const [tabDirection, setTabDirection] = useState(0); // -1 = left, 0 = none, 1 = right
  const [showAddActivity, setShowAddActivity] = useState(false);
  const [pendingActivity, setPendingActivity] = useState(null);
  const [defaultActivityDate, setDefaultActivityDate] = useState(null);
  const [showShare, setShowShare] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  const [friends, setFriends] = useState([]);
  const [showCelebration, setShowCelebration] = useState(false);
  const [celebrationMessage, setCelebrationMessage] = useState('');
  const [showWeekStreakCelebration, setShowWeekStreakCelebration] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState('record'); // 'record' or 'success'
  const [pendingToast, setPendingToast] = useState(null); // Queue toast to show after celebration
  const [historyView, setHistoryView] = useState('calendar');
  const [historyStatsSubView, setHistoryStatsSubView] = useState('overview');
  const [showEditGoals, setShowEditGoals] = useState(false);
  const [pendingFriendRequests, setPendingFriendRequests] = useState(0);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [feedActiveView, setFeedActiveView] = useState('feed'); // 'feed' or 'leaderboard'

  // HealthKit data state
  const [healthKitData, setHealthKitData] = useState({
    todaySteps: 0,
    todayCalories: 0,
    pendingWorkouts: [], // Workouts from HealthKit not yet added to activities
    lastSynced: null
  });

  // Active workout tracking (for "Start Workout" flow)
  // Shape: { type, subtype, strengthType, focusArea, startTime: ISO string, icon, ... }
  const [activeWorkout, setActiveWorkout] = useState(null);
  const [showFinishWorkout, setShowFinishWorkout] = useState(false);

  // Ref to track last synced health data to Firestore (to avoid excessive writes)
  const lastSyncedHealthRef = useRef({ steps: null, calories: null, timestamp: 0 });

  // Sync HealthKit data to Firestore for desktop access
  useEffect(() => {
    if (!user?.uid) return;

    const syncToFirestore = async () => {
      // Only sync on native platforms (where HealthKit data is available)
      if (!Capacitor.isNativePlatform()) return;

      const now = Date.now();
      const lastSync = lastSyncedHealthRef.current;
      const minSyncInterval = 5 * 60 * 1000; // 5 minutes minimum between syncs

      // Check if we need to sync:
      // 1. Steps changed by more than 100 OR
      // 2. Calories changed by more than 50 OR
      // 3. It's been more than 5 minutes since last sync
      const stepsChanged = Math.abs((healthKitData.todaySteps || 0) - (lastSync.steps || 0)) > 100;
      const caloriesChanged = Math.abs((healthKitData.todayCalories || 0) - (lastSync.calories || 0)) > 50;
      const timeElapsed = now - lastSync.timestamp > minSyncInterval;

      if ((stepsChanged || caloriesChanged || timeElapsed) && (healthKitData.todaySteps > 0 || healthKitData.todayCalories > 0)) {
        // Get today's date in YYYY-MM-DD format
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        try {
          await saveDailyHealthData(user.uid, dateStr, healthKitData.todaySteps, healthKitData.todayCalories);
          lastSyncedHealthRef.current = {
            steps: healthKitData.todaySteps,
            calories: healthKitData.todayCalories,
            timestamp: now
          };
        } catch (e) {
          // Silently fail - will retry on next update
        }
      }
    };

    syncToFirestore();
  }, [user?.uid, healthKitData.todaySteps, healthKitData.todayCalories]);

  // Load health data from Firestore on non-native platforms (desktop/web)
  useEffect(() => {
    if (!user?.uid || Capacitor.isNativePlatform()) return;

    const loadHealthDataFromFirestore = async () => {
      // Get today's date in YYYY-MM-DD format
      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      try {
        const healthData = await getDailyHealthData(user.uid, dateStr);
        if (healthData) {
          setHealthKitData(prev => ({
            ...prev,
            todaySteps: healthData.steps || 0,
            todayCalories: healthData.calories || 0,
            lastSynced: healthData.lastUpdated
          }));
        }
      } catch (e) {
        // Silently fail
      }
    };

    loadHealthDataFromFirestore();

    // Refresh from Firestore every 5 minutes on desktop
    const refreshInterval = setInterval(loadHealthDataFromFirestore, 5 * 60 * 1000);

    return () => clearInterval(refreshInterval);
  }, [user?.uid]);

  // Update app icon badge when pending requests change
  useEffect(() => {
    const updateBadge = async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          const { Badge } = await import('@capawesome/capacitor-badge');
          if (pendingFriendRequests > 0) {
            await Badge.set({ count: pendingFriendRequests });
          } else {
            await Badge.clear();
          }
        } catch (e) {
          // console.log('Badge update error:', e);
        }
      }
    };
    updateBadge();
  }, [pendingFriendRequests]);

  // Load active workout from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('activeWorkout');
      if (saved) {
        setActiveWorkout(JSON.parse(saved));
      }
    } catch (e) {
      // Invalid data, ignore
      localStorage.removeItem('activeWorkout');
    }
  }, []);

  // Persist active workout to localStorage
  useEffect(() => {
    if (activeWorkout) {
      localStorage.setItem('activeWorkout', JSON.stringify(activeWorkout));
    } else {
      localStorage.removeItem('activeWorkout');
    }
  }, [activeWorkout]);

  // Tab order for direction detection
  const tabOrder = ['home', 'history', 'feed', 'profile'];

  // Custom tab switcher with direction tracking
  const switchTab = useCallback((newTab) => {
    if (newTab === activeTab) return;
    const currentIndex = tabOrder.indexOf(activeTab);
    const newIndex = tabOrder.indexOf(newTab);
    setTabDirection(newIndex > currentIndex ? 1 : -1);
    setPrevTab(activeTab);
    setActiveTab(newTab);
  }, [activeTab]);

  // Edge swipe gesture for tab navigation (iOS-style) - uses native event listeners
  const activeTabRef = useRef(activeTab);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;

    const edgeZone = 40; // pixels from edge to trigger
    let swipeStartX = 0;
    let swipeStartY = 0;
    let isEdgeSwiping = false;
    let swipeEdge = null; // 'left' or 'right'

    const handleTouchStart = (e) => {
      const touch = e.touches[0];
      const screenWidth = window.innerWidth;

      // Check if touch started from left or right edge
      if (touch.clientX <= edgeZone) {
        swipeEdge = 'left';
        isEdgeSwiping = true;
      } else if (touch.clientX >= screenWidth - edgeZone) {
        swipeEdge = 'right';
        isEdgeSwiping = true;
      } else {
        isEdgeSwiping = false;
        swipeEdge = null;
        return;
      }

      swipeStartX = touch.clientX;
      swipeStartY = touch.clientY;
    };

    const handleTouchEnd = (e) => {
      if (!isEdgeSwiping) return;

      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - swipeStartX;
      const deltaY = touch.clientY - swipeStartY;

      // Reset state
      const edge = swipeEdge;
      isEdgeSwiping = false;
      swipeEdge = null;

      // Only trigger if horizontal swipe is dominant and exceeds threshold
      if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 2) {
        const currentTab = activeTabRef.current;
        const currentIndex = tabOrder.indexOf(currentTab);

        if (edge === 'left' && deltaX > 0 && currentIndex > 0) {
          // Swipe from left edge going right - go to previous tab
          triggerHaptic(ImpactStyle.Light);
          const newTab = tabOrder[currentIndex - 1];
          setTabDirection(-1);
          setPrevTab(currentTab);
          setActiveTab(newTab);
        } else if (edge === 'right' && deltaX < 0 && currentIndex < tabOrder.length - 1) {
          // Swipe from right edge going left - go to next tab
          triggerHaptic(ImpactStyle.Light);
          const newTab = tabOrder[currentIndex + 1];
          setTabDirection(1);
          setPrevTab(currentTab);
          setActiveTab(newTab);
        }
      }
    };

    root.addEventListener('touchstart', handleTouchStart, { passive: true });
    root.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      root.removeEventListener('touchstart', handleTouchStart);
      root.removeEventListener('touchend', handleTouchEnd);
    };
  }, []); // Empty deps - use refs for current values

  // Tour state
  const [showTour, setShowTour] = useState(false);
  const [tourStep, setTourStep] = useState(0);

  // Tour element refs
  const logActivityRef = useRef(null);
  const weeklyGoalsRef = useRef(null);
  const latestActivityRef = useRef(null);
  const homeTabRef = useRef(null);
  const historyTabRef = useRef(null);
  const activeStreaksRef = useRef(null);
  const calendarRef = useRef(null);
  const statsRef = useRef(null);
  const progressPhotosRef = useRef(null);
  const friendsTabRef = useRef(null);
  const profileTabRef = useRef(null);

  // Triple-tap logo refs
  const logoTapCountRef = useRef(0);
  const logoTapTimerRef = useRef(null);

  // Triple-tap logo to trigger tour
  const handleLogoTap = () => {
    logoTapCountRef.current += 1;

    if (logoTapTimerRef.current) {
      clearTimeout(logoTapTimerRef.current);
    }

    if (logoTapCountRef.current >= 3) {
      logoTapCountRef.current = 0;
      // Trigger tour restart
      setTourStep(0);
      setActiveTab('home');
      setShowTour(true);
    } else {
      logoTapTimerRef.current = setTimeout(() => {
        logoTapCountRef.current = 0;
      }, 500);
    }
  };

  // Get current tour target ref based on step (5-step tour)
  const getTourTargetRef = () => {
    const refs = [
      logActivityRef,      // 0: Log Activity
      weeklyGoalsRef,      // 1: Weekly Goals
      historyTabRef,       // 2: History Tab
      friendsTabRef,       // 3: Friends Tab
      profileTabRef        // 4: Profile Tab
    ];
    return refs[tourStep] || logActivityRef;
  };


  // Handle tour navigation (5-step tour: 0-4)
  const handleTourNext = async () => {
    if (tourStep < 4) {
      setTourStep(tourStep + 1);
    } else {
      // Tour complete
      setShowTour(false);
      setTourStep(0);
      if (user?.uid) {
        await setTourComplete(user.uid);
        setUserProfile(prev => ({ ...prev, hasCompletedTour: true }));
      }
    }
  };

  const handleTourBack = () => {
    if (tourStep > 0) {
      setTourStep(tourStep - 1);
    }
  };

  const handleTourSkip = async () => {
    setShowTour(false);
    setTourStep(0);
    if (user?.uid) {
      await setTourComplete(user.uid);
      setUserProfile(prev => ({ ...prev, hasCompletedTour: true }));
    }
  };

  // Navigate to Hall of Fame
  const navigateToHallOfFame = () => {
    setActiveTab('history');
    setHistoryView('stats');
    setHistoryStatsSubView('records');
  };

  // Handle sign out
  const handleSignOut = async () => {
    // Immediately clear user state to show login screen
    setUser(null);
    setUserProfile(null);
    setUserData(initialUserData); // Reset to initial, not null (prevents spread errors on re-login)
    setIsOnboarded(null); // null = loading state, prevents onboarding flash on re-login
    setActivities(initialActivities);
    setCalendarData(initialCalendarData);
    setFriends([]);
    setPendingFriendRequests(0);

    // Then attempt actual sign out in background (don't block UI)
    (async () => {
      // Try native plugin sign out (ignore errors)
      if (Capacitor.isNativePlatform()) {
        try {
          const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
          await FirebaseAuthentication.signOut();
        } catch (e) {
          // Ignore native sign out errors
        }
      }
      // Try web SDK signOut
      try {
        await signOut(auth);
      } catch (e) {
        // Ignore web sign out errors
      }
    })();
  };

  // Handle profile photo update
  const handleUpdatePhoto = async (file) => {
    if (!user) return;
    const newPhotoURL = await uploadProfilePhoto(user.uid, file);
    setUserProfile(prev => ({ ...prev, photoURL: newPhotoURL }));
  };

  const handleUpdatePrivacy = async (privacySettings) => {
    if (!user) return;
    try {
      await updateUserProfile(user.uid, { privacySettings });
      setUserProfile(prev => ({ ...prev, privacySettings }));
    } catch (error) {
      // console.error('Error updating privacy settings:', error);
    }
  };

  // Handle password reset via email
  const handleResetPassword = async () => {
    if (!user?.email) return;
    try {
      await sendPasswordResetEmail(auth, user.email);
      triggerHaptic(ImpactStyle.Medium);
      setToastMessage('Password reset email sent!');
      setToastType('success');
      setShowToast(true);
    } catch (error) {
      console.error('Error sending password reset email:', error);
      setToastMessage('Failed to send reset email. Please try again.');
      setToastType('success');
      setShowToast(true);
    }
  };

  // Handle user authentication (shared by onAuthStateChanged and native login)
  const handleUserAuth = useCallback(async (user) => {
    if (user) {
      // Get profile first (needed to show app)
      let profile = null;
      try {
        profile = await getUserProfile(user.uid);
        if (!profile) {
          await createUserProfile(user);
          profile = await getUserProfile(user.uid);
        }
      } catch (error) {
        // console.error('Error loading profile:', error);
      }

      // Check onboarding status
      const hasCompletedOnboarding = profile?.hasCompletedOnboarding === true;

      // Set user and profile together to avoid intermediate render states
      setUser(user);
      setUserProfile(profile);
      setIsOnboarded(hasCompletedOnboarding);
      setActiveTab('home'); // Always go to home screen after login
      setAuthLoading(false);

      // Load remaining data in background (don't await)
      (async () => {
        try {
          // Load user's goals from Firestore (if they exist)
          const userGoals = await getUserGoals(user.uid);
          if (userGoals) {
            setUserData(prev => ({
              ...prev,
              goals: userGoals
            }));
          }

          // Load user's activities from Firestore
          const userActivities = await getUserActivities(user.uid);
          if (userActivities.length > 0) {
            setActivities(userActivities);
            // Build calendar data from loaded activities
            const calendarMap = {};
            userActivities.forEach(activity => {
              if (activity.date) {
                if (!calendarMap[activity.date]) {
                  calendarMap[activity.date] = [];
                }
                calendarMap[activity.date].push({
                  type: activity.type,
                  subtype: activity.subtype,
                  duration: activity.duration,
                  distance: activity.distance,
                  calories: activity.calories,
                  avgHr: activity.avgHr,
                  maxHr: activity.maxHr
                });
              }
            });
            setCalendarData(calendarMap);
          }

          // Load friends list
          const friendsList = await getFriends(user.uid);
          setFriends(friendsList);

          // Load pending friend requests count
          const requests = await getFriendRequests(user.uid);
          setPendingFriendRequests(requests.length);

          // Load user's custom activities
          const userCustomActivities = await getCustomActivities(user.uid);
          if (userCustomActivities.length > 0) {
            setUserData(prev => ({
              ...prev,
              customActivities: userCustomActivities
            }));
          }

          // Load user's personal records
          const userRecords = await getPersonalRecords(user.uid);
          if (userRecords) {
            setUserData(prev => ({
              ...prev,
              personalRecords: { ...prev.personalRecords, ...userRecords }
            }));
          }
        } catch (error) {
          // console.error('Error loading user data:', error);
        }
      })();
    } else {
      setUserProfile(null);
      setFriends([]);
      setPendingFriendRequests(0);
      setIsOnboarded(null);
      setAuthLoading(false);
    }
  }, []);

  // Refresh data function for pull-to-refresh
  const refreshData = useCallback(async () => {
    if (!user?.uid) return;

    try {
      // Reload activities
      const userActivities = await getUserActivities(user.uid);
      if (userActivities.length > 0) {
        setActivities(userActivities);
        // Rebuild calendar data
        const calendarMap = {};
        userActivities.forEach(activity => {
          if (activity.date) {
            if (!calendarMap[activity.date]) {
              calendarMap[activity.date] = [];
            }
            calendarMap[activity.date].push({
              type: activity.type,
              subtype: activity.subtype,
              duration: activity.duration,
              distance: activity.distance,
              calories: activity.calories,
              avgHr: activity.avgHr,
              maxHr: activity.maxHr
            });
          }
        });
        setCalendarData(calendarMap);
      }

      // Reload friends and pending requests
      const [friendsList, requests] = await Promise.all([
        getFriends(user.uid),
        getFriendRequests(user.uid)
      ]);
      setFriends(friendsList);
      setPendingFriendRequests(requests.length);

      // Refresh HealthKit data on pull-to-refresh
      if (Capacitor.isNativePlatform()) {
        try {
          const [steps, calories] = await Promise.all([
            fetchTodaySteps(),
            fetchTodayCalories()
          ]);
          setHealthKitData(prev => ({
            ...prev,
            todaySteps: steps || prev.todaySteps,
            todayCalories: calories || prev.todayCalories
          }));
        } catch (e) {
          // Silently fail HealthKit refresh
        }
      }
    } catch (error) {
      // console.error('Error refreshing data:', error);
    }
  }, [user?.uid]);

  // Sync HealthKit data function
  const syncHealthKit = useCallback(async (existingActivities = []) => {
    if (!Capacitor.isNativePlatform()) return;

    try {
      const result = await syncHealthKitData();
      if (result.success) {
        // Find workouts that aren't already in activities (by healthKitUUID)
        const existingUUIDs = new Set(
          existingActivities
            .filter(a => a.healthKitUUID)
            .map(a => a.healthKitUUID)
        );

        const newWorkouts = result.workouts.filter(
          w => w.healthKitUUID && !existingUUIDs.has(w.healthKitUUID)
        );

        setHealthKitData({
          todaySteps: result.todaySteps || 0,
          todayCalories: result.todayCalories || 0,
          pendingWorkouts: newWorkouts,
          lastSynced: new Date().toISOString()
        });
      }
    } catch (error) {
      console.log('HealthKit sync error:', error);
    }
  }, []);

  // Sync HealthKit when user logs in and periodically refresh steps/calories
  useEffect(() => {
    if (!user?.uid || !Capacitor.isNativePlatform()) return;

    // Initial sync
    syncHealthKit(activities);

    // Refresh steps and calories every 5 minutes (these update frequently)
    const refreshInterval = setInterval(async () => {
      try {
        const [steps, calories] = await Promise.all([
          fetchTodaySteps(),
          fetchTodayCalories()
        ]);
        setHealthKitData(prev => ({
          ...prev,
          todaySteps: steps || prev.todaySteps,
          todayCalories: calories || prev.todayCalories
        }));
      } catch (e) {
        // Silently fail
      }
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(refreshInterval);
  }, [user?.uid, syncHealthKit]);

  // Pull-to-refresh hook (enabled on home tab and feed tab, but not on leaderboard view)
  // Threshold of 80 matches native iOS UIRefreshControl feel
  const { pullDistance, isRefreshing } = usePullToRefresh(refreshData, {
    threshold: 80,
    resistance: 0.5,
    enabled: activeTab === 'home' || (activeTab === 'feed' && feedActiveView === 'feed')
  });

  // Listen to auth state
  useEffect(() => {
    const checkAuth = async () => {
      // Check if running in native app
      const isNative = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform();

      if (isNative) {
        // On native, check native Firebase auth state
        try {
          const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
          const result = await FirebaseAuthentication.getCurrentUser();

          if (result.user) {
            // console.log('Native user found:', result.user.uid);
            // Convert native user to our user format
            const user = {
              uid: result.user.uid,
              email: result.user.email,
              displayName: result.user.displayName,
              photoURL: result.user.photoUrl,
            };
            await handleUserAuth(user);
          } else {
            // No native user - show login immediately
            // console.log('No native user - showing login');
            setAuthLoading(false);
          }
          return; // Don't set up web listener on native
        } catch (error) {
          // console.log('Native auth check failed:', error);
          setAuthLoading(false);
          return;
        }
      }

      // Web auth listener (only for web, not native)
      const authTimeout = setTimeout(() => {
        // console.log('Auth timeout - showing login');
        setAuthLoading(false);
      }, 3000);

      const unsubscribe = onAuthStateChanged(auth, async (user) => {
        clearTimeout(authTimeout);
        await handleUserAuth(user);
      });

      return () => {
        clearTimeout(authTimeout);
        unsubscribe();
      };
    };

    checkAuth();
  }, [handleUserAuth]);

  // Simulate initial load
  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 800);
    return () => clearTimeout(timer);
  }, []);

  // Check if tour should be shown for returning users who haven't seen it yet
  const tourShownRef = useRef(false);
  useEffect(() => {
    if (!isLoading && isOnboarded && userProfile && userProfile.hasCompletedTour !== true && !tourShownRef.current) {
      tourShownRef.current = true;
      // Small delay to ensure UI is ready
      const timer = setTimeout(() => {
        setActiveTab('home');
        setShowTour(true);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isLoading, isOnboarded, userProfile?.hasCompletedTour]);

  // Real state management
  const [activities, setActivities] = useState(initialActivities);
  const [calendarData, setCalendarData] = useState(initialCalendarData);
  const [weeklyProgress, setWeeklyProgress] = useState(initialWeeklyProgress);
  const [userData, setUserData] = useState(initialUserData);

  // Ref to always have access to latest userData (avoids stale closure issues)
  const userDataRef = useRef(userData);
  useEffect(() => {
    userDataRef.current = userData;
  }, [userData]);

  // DEV: Add dummy data function (call window.__addDummyData() from console)
  useEffect(() => {
    window.__addDummyData = () => {
      const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
      const randomFloat = (min, max) => (Math.random() * (max - min) + min).toFixed(1);
      const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
      const formatDate = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      const generateTime = () => {
        const hours = randomInt(6, 20);
        const minutes = randomInt(0, 59);
        const hour12 = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
        const ampm = hours >= 12 ? 'PM' : 'AM';
        return `${hour12}:${String(minutes).padStart(2, '0')} ${ampm}`;
      };
      // Real fitness photos from Unsplash (free to use)
      const photoUrls = [
        'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&h=400&fit=crop', // gym weights
        'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=400&h=400&fit=crop', // person lifting
        'https://images.unsplash.com/photo-1581009146145-b5ef050c149a?w=400&h=400&fit=crop', // gym workout
        'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=400&h=400&fit=crop', // weights training
        'https://images.unsplash.com/photo-1583454110551-21f2fa2afe61?w=400&h=400&fit=crop', // fitness training
        'https://images.unsplash.com/photo-1549060279-7e168fcee0c2?w=400&h=400&fit=crop', // running outdoors
        'https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?w=400&h=400&fit=crop', // running person
        'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=400&h=400&fit=crop', // gym person
        'https://images.unsplash.com/photo-1574680096145-d05b474e2155?w=400&h=400&fit=crop', // deadlift
        'https://images.unsplash.com/photo-1526506118085-60ce8714f8c5?w=400&h=400&fit=crop', // crossfit
      ];
      const muscleGroups = ['Full Body', 'Upper Body', 'Lower Body', 'Push', 'Pull', 'Legs', 'Back', 'Chest', 'Shoulders', 'Arms', 'Core'];
      const newActivities = [];
      const newCalendarData = {};
      const today = new Date();
      let photoCounter = 0;
      for (let i = 0; i < 90; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = formatDate(date);
        const dayOfWeek = date.getDay();
        const isRestDay = (dayOfWeek === 0 && Math.random() > 0.3) || (Math.random() < 0.15);
        if (isRestDay && i > 0 && i < 85) continue;
        if (!newCalendarData[dateStr]) newCalendarData[dateStr] = [];
        if (dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5 || (dayOfWeek === 6 && Math.random() > 0.5)) {
          const muscleGroup = muscleGroups[randomInt(0, muscleGroups.length - 1)];
          const shouldAddPhoto = Math.random() > 0.6; // 40% chance of having a photo
          const activity = {
            id: generateId(),
            type: 'Strength Training',
            subtype: `Lifting - ${muscleGroup}`,
            strengthType: 'Lifting',
            date: dateStr,
            time: generateTime(),
            duration: randomInt(45, 75),
            calories: randomInt(250, 450),
            ...(shouldAddPhoto && { photoURL: photoUrls[photoCounter++ % photoUrls.length] })
          };
          newActivities.push(activity);
          newCalendarData[dateStr].push({ type: activity.type, subtype: activity.subtype, duration: activity.duration, calories: activity.calories });
        }
        if (dayOfWeek === 2 || dayOfWeek === 4 || (dayOfWeek === 6 && Math.random() > 0.6)) {
          if (Math.random() > 0.3) {
            const distance = parseFloat(randomFloat(2.5, 5.0));
            const duration = randomInt(20, 45);
            const shouldAddPhoto = Math.random() > 0.7; // 30% chance of having a photo
            const activity = {
              id: generateId(),
              type: 'Running',
              date: dateStr,
              time: generateTime(),
              duration,
              distance,
              pace: (duration / distance).toFixed(2),
              calories: randomInt(200, 400),
              avgHr: randomInt(140, 165),
              maxHr: randomInt(170, 185),
              ...(shouldAddPhoto && { photoURL: photoUrls[photoCounter++ % photoUrls.length] })
            };
            newActivities.push(activity);
            newCalendarData[dateStr].push({ type: activity.type, duration: activity.duration, distance: activity.distance, calories: activity.calories, avgHr: activity.avgHr, maxHr: activity.maxHr });
          } else {
            const activity = { id: generateId(), type: 'Cycle', date: dateStr, time: generateTime(), duration: randomInt(30, 60), distance: parseFloat(randomFloat(8, 15)), calories: randomInt(250, 450), avgHr: randomInt(130, 155), maxHr: randomInt(160, 175) };
            newActivities.push(activity);
            newCalendarData[dateStr].push({ type: activity.type, duration: activity.duration, distance: activity.distance, calories: activity.calories, avgHr: activity.avgHr, maxHr: activity.maxHr });
          }
        }
        if ((dayOfWeek === 0 || dayOfWeek === 3 || dayOfWeek === 6) && Math.random() > 0.5) {
          const recoveryTypes = ['Cold Plunge', 'Sauna', 'Yoga'];
          const recoveryType = recoveryTypes[randomInt(0, 2)];
          const activity = { id: generateId(), type: recoveryType, date: dateStr, time: generateTime(), duration: recoveryType === 'Cold Plunge' ? randomInt(3, 10) : recoveryType === 'Sauna' ? randomInt(15, 25) : randomInt(30, 60) };
          newActivities.push(activity);
          newCalendarData[dateStr].push({ type: activity.type, duration: activity.duration });
        }
      }

      // Calculate personal records from generated activities
      const records = {
        highestCalories: { value: 0, activityType: null },
        longestStrength: { value: 0, activityType: null },
        longestCardio: { value: 0, activityType: null },
        longestDistance: { value: 0, activityType: null },
        fastestPace: { value: null, activityType: null },
        fastestCyclingPace: { value: null, activityType: null },
        mostWorkoutsWeek: 0,
        mostCaloriesWeek: 0,
        mostMilesWeek: 0,
        longestMasterStreak: 12,
        longestStrengthStreak: 8,
        longestCardioStreak: 6,
        longestRecoveryStreak: 5
      };

      newActivities.forEach(a => {
        // Highest calories
        if (a.calories && a.calories > records.highestCalories.value) {
          records.highestCalories = { value: a.calories, activityType: a.type };
        }
        // Longest strength
        if (a.type === 'Strength Training' && a.duration > records.longestStrength.value) {
          records.longestStrength = { value: a.duration, activityType: a.subtype || a.type };
        }
        // Longest cardio
        if (['Running', 'Cycle'].includes(a.type) && a.duration > records.longestCardio.value) {
          records.longestCardio = { value: a.duration, activityType: a.type };
        }
        // Longest distance
        if (a.distance && a.distance > records.longestDistance.value) {
          records.longestDistance = { value: a.distance, activityType: a.type };
        }
        // Fastest running pace (lower is better)
        if (a.type === 'Running' && a.pace) {
          const paceValue = parseFloat(a.pace);
          if (!records.fastestPace.value || paceValue < records.fastestPace.value) {
            records.fastestPace = { value: paceValue, activityType: 'Running' };
          }
        }
        // Fastest cycling pace
        if (a.type === 'Cycle' && a.distance && a.duration) {
          const cyclingPace = a.duration / a.distance;
          if (!records.fastestCyclingPace.value || cyclingPace < records.fastestCyclingPace.value) {
            records.fastestCyclingPace = { value: parseFloat(cyclingPace.toFixed(2)), activityType: 'Cycle' };
          }
        }
      });

      // Calculate weekly records
      const weeklyData = {};
      newActivities.forEach(a => {
        const actDate = new Date(a.date);
        const weekStart = new Date(actDate);
        weekStart.setDate(actDate.getDate() - actDate.getDay());
        const weekKey = formatDate(weekStart);
        if (!weeklyData[weekKey]) {
          weeklyData[weekKey] = { workouts: 0, calories: 0, miles: 0 };
        }
        weeklyData[weekKey].workouts++;
        weeklyData[weekKey].calories += (a.calories || 0);
        weeklyData[weekKey].miles += (a.distance || 0);
      });

      Object.values(weeklyData).forEach(week => {
        if (week.workouts > records.mostWorkoutsWeek) records.mostWorkoutsWeek = week.workouts;
        if (week.calories > records.mostCaloriesWeek) records.mostCaloriesWeek = week.calories;
        if (week.miles > records.mostMilesWeek) records.mostMilesWeek = parseFloat(week.miles.toFixed(1));
      });

      const activitiesWithPhotos = newActivities.filter(a => a.photoURL).length;
      console.log(`Generated ${newActivities.length} activities (${activitiesWithPhotos} with photos), saving...`);
      setActivities(newActivities);
      setCalendarData(newCalendarData);
      setUserData(prev => ({
        ...prev,
        personalRecords: records
      }));
      // Also save records to Firestore if user is logged in
      if (user?.uid) {
        savePersonalRecords(user.uid, records).then(() => {
          console.log('Records persisted to Firestore');
        }).catch(err => {
          console.error('Error saving records:', err);
        });
      }
      console.log('Done! Activities, calendar data, and records saved.');
      console.log('Records:', records);
      return newActivities.length;
    };
    return () => { delete window.__addDummyData; };
  }, [user]);

  // Track if initial load is complete to avoid saving on mount
  const hasLoadedActivities = useRef(false);

  // Save activities to Firestore when they change
  useEffect(() => {
    // console.log('Activities effect triggered:', { user: !!user, activitiesCount: activities.length, hasLoaded: hasLoadedActivities.current });

    if (!user) {
      // console.log('No user, skipping save');
      return;
    }

    // Skip the initial load - only save after user makes changes
    if (!hasLoadedActivities.current) {
      // console.log('Initial load, marking as loaded');
      hasLoadedActivities.current = true;
      return;
    }

    // Debounce the save to avoid too many writes
    const timeoutId = setTimeout(() => {
      // console.log('Saving activities:', activities);
      saveUserActivities(user.uid, activities);
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [activities, user]);

  // Save custom activities to Firestore when they change
  const hasLoadedCustomActivities = useRef(false);
  useEffect(() => {
    if (!user || !userData) return;

    // Skip the initial load
    if (!hasLoadedCustomActivities.current) {
      hasLoadedCustomActivities.current = true;
      return;
    }

    // Only save if customActivities exists and has items
    if (userData.customActivities && userData.customActivities.length > 0) {
      const timeoutId = setTimeout(() => {
        saveCustomActivities(user.uid, userData.customActivities);
      }, 500);

      return () => clearTimeout(timeoutId);
    }
  }, [userData?.customActivities, user]);

  // Helper to determine effective category of an activity
  const getActivityCategory = (activity) => {
    // If countToward is set (for Yoga/Pilates or custom activities), use that
    if (activity.countToward) {
      // Map 'strength' to 'lifting' for consistency
      if (activity.countToward === 'strength') return 'lifting';
      return activity.countToward;
    }
    // Check customActivityCategory for "Other" activities
    if (activity.customActivityCategory) {
      if (activity.customActivityCategory === 'strength') return 'lifting';
      return activity.customActivityCategory;
    }
    // Default categorization
    if (activity.type === 'Strength Training') return 'lifting';
    if (['Running', 'Cycle', 'Sports'].includes(activity.type)) return 'cardio';
    if (['Cold Plunge', 'Sauna', 'Yoga', 'Pilates'].includes(activity.type)) return 'recovery';
    return 'other';
  };

  // Calculate weekly progress from activities
  const calculateWeeklyProgress = (allActivities) => {
    const today = new Date();
    today.setHours(23, 59, 59, 999); // End of today to include activities from today
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay()); // Sunday
    startOfWeek.setHours(0, 0, 0, 0);

    const weekActivities = allActivities.filter(a => {
      const actDate = parseLocalDate(a.date);
      return actDate >= startOfWeek && actDate <= today;
    });

    // Categorize using the helper (respects countToward)
    const lifts = weekActivities.filter(a => getActivityCategory(a) === 'lifting');
    const cardio = weekActivities.filter(a => getActivityCategory(a) === 'cardio');
    const recovery = weekActivities.filter(a => getActivityCategory(a) === 'recovery');
    
    // For breakdown, use actual activity types
    const running = weekActivities.filter(a => a.type === 'Running');
    const cycling = weekActivities.filter(a => a.type === 'Cycle');
    const sports = weekActivities.filter(a => a.type === 'Sports');
    const coldPlunge = weekActivities.filter(a => a.type === 'Cold Plunge');
    const sauna = weekActivities.filter(a => a.type === 'Sauna');
    const yoga = weekActivities.filter(a => a.type === 'Yoga');
    const pilates = weekActivities.filter(a => a.type === 'Pilates');
    
    const totalMiles = running.reduce((sum, r) => sum + (parseFloat(r.distance) || 0), 0);
    const totalCalories = weekActivities.reduce((sum, a) => sum + (parseInt(a.calories) || 0), 0);

    return {
      lifts: {
        completed: lifts.length,
        goal: userData.goals.liftsPerWeek,
        sessions: lifts.map(l => l.subtype || l.type)
      },
      cardio: {
        completed: cardio.length,
        goal: userData.goals.cardioPerWeek,
        miles: totalMiles,
        sessions: cardio.map(c => c.type),
        breakdown: {
          running: running.length,
          cycling: cycling.length,
          sports: sports.length
        }
      },
      recovery: {
        completed: recovery.length,
        goal: userData.goals.recoveryPerWeek,
        sessions: recovery.map(r => r.type),
        breakdown: {
          coldPlunge: coldPlunge.length,
          sauna: sauna.length,
          yoga: yoga.length,
          pilates: pilates.length
        }
      },
      calories: { burned: totalCalories, goal: userData.goals.caloriesPerDay },
      steps: { today: 0, goal: userData.goals.stepsPerDay }
    };
  };

  const handleAddActivity = (pendingOrDate = null) => {
    // If it's a string (date), set the default date
    if (typeof pendingOrDate === 'string') {
      setDefaultActivityDate(pendingOrDate);
      setPendingActivity(null);
    } else {
      // It's a pending activity object or null
      setPendingActivity(pendingOrDate);
      setDefaultActivityDate(null);
    }
    setShowAddActivity(true);
  };

  const handleActivitySaved = async (activity) => {
    // Haptic feedback when saving activity
    triggerHaptic(ImpactStyle.Medium);

    // Check if this is an edit (activity has existing ID) or new activity
    const isEdit = activity.id && activities.some(a => a.id === activity.id);

    // Generate activity ID upfront for new activities (so photo upload uses same ID)
    const activityId = activity.id || Date.now();

    // Handle photo upload if there's a new photo file
    let photoURL = activity.photoURL;
    if (activity.photoFile && user) {
      try {
        photoURL = await uploadActivityPhoto(user.uid, activityId, activity.photoFile);
      } catch (error) {
        // console.error('Error uploading activity photo:', error);
        // Continue saving the activity without the photo
      }
    }

    // Remove photoFile from activity object (don't save file object to Firestore)
    const { photoFile, ...activityData } = activity;

    let newActivity;
    let updatedActivities;

    if (isEdit) {
      // Update existing activity
      newActivity = {
        ...activityData,
        photoURL,
        time: activityData.time || new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      };
      updatedActivities = activities.map(a => a.id === activityData.id ? newActivity : a);
      
      // Also update calendar data - remove old entry and add updated one
      const updatedCalendar = { ...calendarData };
      // Remove from old date if date changed
      Object.keys(updatedCalendar).forEach(dateKey => {
        updatedCalendar[dateKey] = updatedCalendar[dateKey].filter(a => 
          !(a.type === activity.type && a.subtype === activity.subtype)
        );
        if (updatedCalendar[dateKey].length === 0) {
          delete updatedCalendar[dateKey];
        }
      });
      // Add to new/current date
      if (!updatedCalendar[activity.date]) {
        updatedCalendar[activity.date] = [];
      }
      updatedCalendar[activity.date].push({
        type: activity.type,
        subtype: activity.subtype,
        duration: activity.duration,
        distance: activity.distance,
        calories: activity.calories,
        avgHr: activity.avgHr,
        maxHr: activity.maxHr
      });
      setCalendarData(updatedCalendar);
    } else {
      // Create new activity with ID and timestamp
      newActivity = {
        ...activityData,
        photoURL,
        id: activityId,
        time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      };

      // Add to activities list
      updatedActivities = [newActivity, ...activities];

      // Update calendar data
      const dateKey = activityData.date;
      const updatedCalendar = { ...calendarData };
      if (!updatedCalendar[dateKey]) {
        updatedCalendar[dateKey] = [];
      }
      updatedCalendar[dateKey] = [...updatedCalendar[dateKey], {
        type: activity.type,
        subtype: activity.subtype,
        duration: activity.duration,
        distance: activity.distance,
        calories: activity.calories,
        avgHr: activity.avgHr,
        maxHr: activity.maxHr
      }];
      setCalendarData(updatedCalendar);
    }
    
    setActivities(updatedActivities);

    // If this was a HealthKit workout, remove it from pending list
    if (activityData.healthKitUUID) {
      setHealthKitData(prev => ({
        ...prev,
        pendingWorkouts: prev.pendingWorkouts.filter(w => w.healthKitUUID !== activityData.healthKitUUID)
      }));
    }

    // Recalculate weekly progress
    const newProgress = calculateWeeklyProgress(updatedActivities);
    setWeeklyProgress(newProgress);

    // console.log('Saved activity:', newActivity, 'Cardio count:', newProgress.cardio?.completed);

    // Write to HealthKit (fire-and-forget, don't block the save flow)
    // Skip if: editing existing activity, came from Apple Health, is HealthKit-sourced, or already saved (live workout)
    if (!isEdit && !activityData.fromAppleHealth && activityData.source !== 'healthkit' && !activityData.healthKitSaved) {
      saveWorkoutToHealthKit(newActivity)
        .then(result => {
          if (result.success) {
            console.log('Workout saved to HealthKit:', result.workoutUUID);
          } else {
            console.log('HealthKit write skipped:', result.reason);
          }
        })
        .catch(err => console.error('HealthKit write error:', err));
    } else if (activityData.healthKitSaved) {
      console.log('Workout already saved to HealthKit via live session:', activityData.healthKitUUID);
    }

    // Skip celebration for edits
    if (isEdit) return;

    // Trigger celebration for completing a goal
    const goals = userData.goals;
    const prevProgress = weeklyProgress;
    // Use ref to get latest records (avoids stale closure issues)
    const records = userDataRef.current.personalRecords;
    
    // Get the effective category of this activity (respects countToward)
    const activityCategory = getActivityCategory(newActivity);
    
    // Check for personal records and return all broken records
    const checkAndUpdateRecords = () => {
      // Only track records that are actually updated (don't spread all records to avoid overwriting other concurrent updates)
      const updatedRecords = {};
      const recordsBroken = []; // Collect all broken records

      // Recovery activities don't count as "workouts" for records
      const recoveryTypes = ['Cold Plunge', 'Sauna'];
      const yogaPilatesAsRecovery = ['Yoga', 'Pilates'].includes(activity.type) && (!activity.countToward || activity.countToward === 'recovery');
      const isRecovery = recoveryTypes.includes(activity.type) || yogaPilatesAsRecovery;
      const isStrength = activity.type === 'Strength Training' || activity.countToward === 'strength';
      const isCardio = ['Running', 'Cycle', 'Sports'].includes(activity.type) || activity.countToward === 'cardio';

      // Helper to get current record value (handles both old number format and new object format)
      // Check updatedRecords first in case we updated it earlier in this function
      const getRecordValue = (recordKey) => {
        const record = updatedRecords[recordKey] !== undefined ? updatedRecords[recordKey] : records[recordKey];
        if (record === null || record === undefined) return 0;
        if (typeof record === 'object') return record.value || 0;
        return record;
      };
      
      // Single activity: Highest calories (counts all activities including recovery)
      if (activity.calories && activity.calories > getRecordValue('highestCalories')) {
        updatedRecords.highestCalories = { value: activity.calories, activityType: activity.type };
        recordsBroken.push(`${activity.calories} cals (${activity.type}) 🔥`);
      }
      
      // Single workout records (only for non-recovery activities)
      if (!isRecovery) {
        // Longest strength session
        if (isStrength && activity.duration && activity.duration > getRecordValue('longestStrength')) {
          updatedRecords.longestStrength = { value: activity.duration, activityType: activity.type };
          const hours = Math.floor(activity.duration / 60);
          const mins = activity.duration % 60;
          const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins} min`;
          recordsBroken.push(`${durationStr} strength 🏋️`);
        }

        // Longest cardio session
        if (isCardio && activity.duration && activity.duration > getRecordValue('longestCardio')) {
          updatedRecords.longestCardio = { value: activity.duration, activityType: activity.type };
          const hours = Math.floor(activity.duration / 60);
          const mins = activity.duration % 60;
          const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins} min`;
          recordsBroken.push(`${durationStr} cardio (${activity.type}) 🏃`);
        }

        // Longest distance
        if (activity.distance && activity.distance > getRecordValue('longestDistance')) {
          updatedRecords.longestDistance = { value: activity.distance, activityType: activity.type };
          recordsBroken.push(`${activity.distance} mi (${activity.type}) 🏃`);
        }
        
        // Fastest pace (for runs with distance and duration)
        // Only count if distance is at least 0.1 miles and pace is reasonable (3-30 min/mile)
        const runDistance = parseFloat(activity.distance);
        if (activity.type === 'Running' && runDistance >= 0.1 && activity.duration) {
          const pace = activity.duration / runDistance; // min per mile
          if (pace >= 3 && pace <= 30) { // Reasonable running pace range
            // Get current fastest from updatedRecords first, then fall back to records
            const currentRecord = updatedRecords.fastestPace || records.fastestPace;
            const currentFastest = currentRecord?.value ?? null;
            if (currentFastest === null || pace < currentFastest) {
              updatedRecords.fastestPace = { value: pace, activityType: 'Running' };
              const paceMin = Math.floor(pace);
              const paceSec = Math.round((pace - paceMin) * 60);
              recordsBroken.push(`${paceMin}:${paceSec.toString().padStart(2, '0')}/mi run pace ⚡`);
            }
          }
        }

        // Fastest cycling pace (for cycles with distance and duration)
        const cycleDistance = parseFloat(activity.distance);
        if (activity.type === 'Cycle' && cycleDistance >= 0.1 && activity.duration) {
          const pace = activity.duration / cycleDistance; // min per mile
          if (pace > 0 && pace <= 30) { // Allow any positive pace up to 30 min/mile
            // Get current fastest from updatedRecords first, then fall back to records
            const currentRecord = updatedRecords.fastestCyclingPace || records.fastestCyclingPace;
            const currentFastest = currentRecord?.value ?? null;
            if (currentFastest === null || pace < currentFastest) {
              updatedRecords.fastestCyclingPace = { value: pace, activityType: 'Cycle' };
              const paceMin = Math.floor(pace);
              const paceSec = Math.round((pace - paceMin) * 60);
              recordsBroken.push(`${paceMin}:${paceSec.toString().padStart(2, '0')}/mi cycle pace 🚴`);
            }
          }
        }
      }

      // Weekly records: Check total workouts this week (strength + cardio only, not recovery)
      const totalWorkoutsThisWeek = newProgress.lifts.completed + newProgress.cardio.completed;
      const currentMostWorkouts = getRecordValue('mostWorkoutsWeek');
      if (totalWorkoutsThisWeek > currentMostWorkouts) {
        updatedRecords.mostWorkoutsWeek = totalWorkoutsThisWeek;
        // Only celebrate if it's a significant milestone (5, 10, 15, etc)
        if (totalWorkoutsThisWeek >= 5 && totalWorkoutsThisWeek % 5 === 0) {
          recordsBroken.push(`${totalWorkoutsThisWeek} workouts this week 🎯`);
        }
      }
      
      // Calculate weekly calories from activities this week (workouts only, not recovery)
      // Use today's date consistently
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Reset to midnight to avoid timezone issues
      const weekStart = new Date(today);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday of current week
      const weekStartStr = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
      
      const weeklyCalories = updatedActivities
        .filter(a => a.date >= weekStartStr && !recoveryTypes.includes(a.type))
        .reduce((sum, a) => sum + (parseInt(a.calories) || 0), 0);
      
      const currentMostCalories = getRecordValue('mostCaloriesWeek');
      if (weeklyCalories > currentMostCalories) {
        updatedRecords.mostCaloriesWeek = weeklyCalories;
      }
      
      // Calculate weekly miles
      const weeklyMiles = updatedActivities
        .filter(a => a.date >= weekStartStr && a.distance)
        .reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0);

      // Always update mostMilesWeek to the current week's total if it's higher
      const currentMostMiles = getRecordValue('mostMilesWeek');

      if (weeklyMiles > currentMostMiles) {
        updatedRecords.mostMilesWeek = weeklyMiles;
        // Celebrate milestone miles (10, 20, 30, etc)
        if (weeklyMiles >= 10 && Math.floor(weeklyMiles / 10) > Math.floor(currentMostMiles / 10)) {
          recordsBroken.push(`${Math.floor(weeklyMiles)} mi this week 🏆`);
        }
      }

      // Update records in state if any changed
      // Use functional update to merge with current state (avoids race conditions with streak updates)
      if (Object.keys(updatedRecords).length > 0) {
        setUserData(prev => ({
          ...prev,
          personalRecords: {
            ...prev.personalRecords,
            ...updatedRecords
          }
        }));
      }
      
      // Return combined message if any records broken
      if (recordsBroken.length === 0) return null;
      if (recordsBroken.length === 1) return { message: `New Record!\n${recordsBroken[0]}` };
      
      const countWords = ['', '', 'Two', 'Three', 'Four', 'Five'];
      const countWord = countWords[recordsBroken.length] || recordsBroken.length;
      return { message: `${countWord} New Records!\n${recordsBroken.join('\n')}` };
    };

    // Check if this activity just completed a goal (wasn't complete before, is now)
    const justCompletedLifts = activityCategory === 'lifting' && 
      prevProgress.lifts.completed < goals.liftsPerWeek && 
      newProgress.lifts.completed >= goals.liftsPerWeek;
    
    const justCompletedCardio = activityCategory === 'cardio' && 
      prevProgress.cardio.completed < goals.cardioPerWeek && 
      newProgress.cardio.completed >= goals.cardioPerWeek;
    
    const justCompletedRecovery = activityCategory === 'recovery' && 
      prevProgress.recovery.completed < goals.recoveryPerWeek && 
      newProgress.recovery.completed >= goals.recoveryPerWeek;
    
    // Check for streak milestones (every 5 weeks)
    const checkStreakMilestone = (currentStreak) => {
      return currentStreak > 0 && currentStreak % 5 === 0;
    };
    
    // Check if streak is a new record (without updating state)
    const isStreakRecord = (streakType, newStreak) => {
      const recordKey = `longest${streakType.charAt(0).toUpperCase() + streakType.slice(1)}Streak`;
      return newStreak > (records[recordKey] || 0);
    };

    // Check if all goals will be met after this activity (for week streak priority)
    const willCompleteAllGoals = newProgress.lifts.completed >= goals.liftsPerWeek &&
        newProgress.cardio.completed >= goals.cardioPerWeek &&
        newProgress.recovery.completed >= goals.recoveryPerWeek;

    const wasAllGoalsMet = prevProgress.lifts.completed >= goals.liftsPerWeek &&
        prevProgress.cardio.completed >= goals.cardioPerWeek &&
        prevProgress.recovery.completed >= goals.recoveryPerWeek;

    const willStreakWeek = willCompleteAllGoals && !wasAllGoalsMet;

    // Update streaks when goals are met - combined into single setUserData call to avoid race conditions
    // If week will be streaked, skip individual celebration (week streak takes priority)
    if (justCompletedLifts) {
      const newStreak = userData.streaks.lifts + 1;
      const isNewRecord = isStreakRecord('strength', newStreak);
      setUserData(prev => ({
        ...prev,
        streaks: { ...prev.streaks, lifts: newStreak },
        personalRecords: isNewRecord
          ? { ...prev.personalRecords, longestStrengthStreak: newStreak }
          : prev.personalRecords
      }));
      // Only show individual celebration if NOT about to streak the week
      if (!willStreakWeek) {
        if (isNewRecord) {
          setCelebrationMessage(`New Record: ${newStreak} Week Strength Streak! 🏆`);
        } else if (checkStreakMilestone(newStreak)) {
          setCelebrationMessage(`${newStreak} Week Strength Streak! 💪`);
        } else {
          setCelebrationMessage('Strength goal complete! 🏋️');
        }
        triggerHaptic(ImpactStyle.Heavy);
        setShowCelebration(true);
      }
    } else if (justCompletedCardio) {
      const newStreak = userData.streaks.cardio + 1;
      const isNewRecord = isStreakRecord('cardio', newStreak);
      setUserData(prev => ({
        ...prev,
        streaks: { ...prev.streaks, cardio: newStreak },
        personalRecords: isNewRecord
          ? { ...prev.personalRecords, longestCardioStreak: newStreak }
          : prev.personalRecords
      }));
      // Only show individual celebration if NOT about to streak the week
      if (!willStreakWeek) {
        if (isNewRecord) {
          setCelebrationMessage(`New Record: ${newStreak} Week Cardio Streak! 🏆`);
        } else if (checkStreakMilestone(newStreak)) {
          setCelebrationMessage(`${newStreak} Week Cardio Streak! 🔥`);
        } else {
          setCelebrationMessage('Cardio goal complete! 🏃');
        }
        triggerHaptic(ImpactStyle.Heavy);
        setShowCelebration(true);
      }
    } else if (justCompletedRecovery) {
      const newStreak = userData.streaks.recovery + 1;
      const isNewRecord = isStreakRecord('recovery', newStreak);
      setUserData(prev => ({
        ...prev,
        streaks: { ...prev.streaks, recovery: newStreak },
        personalRecords: isNewRecord
          ? { ...prev.personalRecords, longestRecoveryStreak: newStreak }
          : prev.personalRecords
      }));
      // Only show individual celebration if NOT about to streak the week
      if (!willStreakWeek) {
        if (isNewRecord) {
          setCelebrationMessage(`New Record: ${newStreak} Week Recovery Streak! 🏆`);
        } else if (checkStreakMilestone(newStreak)) {
          setCelebrationMessage(`${newStreak} Week Recovery Streak! ❄️`);
        } else {
          setCelebrationMessage('Recovery goal complete! 🧊');
        }
        triggerHaptic(ImpactStyle.Heavy);
        setShowCelebration(true);
      }
    } else {
      // No goal completed, check for personal records (use toast instead of full celebration)
      const record = checkAndUpdateRecords();
      if (record) {
        setToastMessage(record.message);
        setToastType('record');
        setShowToast(true);
      }
    }

    // Always check and update records (mostMilesWeek, etc.) even when a goal was completed
    // The if/else above handles celebrations, but we still need to update distance/calorie records
    if (justCompletedLifts || justCompletedCardio || justCompletedRecovery) {
      const record = checkAndUpdateRecords();
      // If there's a record and week is being streaked, queue the toast for after celebration
      if (record && willStreakWeek) {
        setPendingToast(record.message);
      } else if (record && !willStreakWeek) {
        // Show record toast after the individual celebration completes
        setPendingToast(record.message);
      }
    }

    // Check if all goals met (master streak) - week streak celebration takes priority
    if (willStreakWeek) {
      // Just completed all goals - increment master streak
      const newMasterStreak = userData.streaks.master + 1;
      const isNewMasterRecord = newMasterStreak > (records.longestMasterStreak || 0);

      setUserData(prev => ({
        ...prev,
        streaks: { ...prev.streaks, master: newMasterStreak },
        personalRecords: isNewMasterRecord
          ? { ...prev.personalRecords, longestMasterStreak: newMasterStreak }
          : prev.personalRecords
      }));

      // Show the week streak celebration modal immediately (no delay needed since we skipped individual celebration)
      setTimeout(() => {
        triggerHaptic(ImpactStyle.Heavy); // Strong haptic for celebration!
        setShowWeekStreakCelebration(true);
      }, 500);
    }
  };

  const handleDeleteActivity = (activityId) => {
    // Find the activity to delete
    const activityToDelete = activities.find(a => a.id === activityId);
    if (!activityToDelete) return;

    // Haptic feedback for delete action
    triggerHaptic(ImpactStyle.Medium);

    // Remove from activities
    const updatedActivities = activities.filter(a => a.id !== activityId);
    setActivities(updatedActivities);

    // Update calendar data
    const dateKey = activityToDelete.date;
    if (calendarData[dateKey]) {
      const updatedCalendar = { ...calendarData };
      updatedCalendar[dateKey] = updatedCalendar[dateKey].filter((calActivity) => {
        // Remove the matching activity (simple approach - removes first match)
        if (!calActivity) return true; // Keep if null/undefined (shouldn't happen)
        return calActivity.type !== activityToDelete.type ||
               (calActivity.subtype || '') !== (activityToDelete.subtype || '');
      });
      if (updatedCalendar[dateKey].length === 0) {
        delete updatedCalendar[dateKey];
      }
      setCalendarData(updatedCalendar);
    }

    // Recalculate weekly progress
    const newProgress = calculateWeeklyProgress(updatedActivities);
    setWeeklyProgress(newProgress);

    // Recalculate single-activity personal records from remaining activities
    const recalculateRecords = () => {
      const currentRecords = userDataRef.current.personalRecords || {};
      const newRecords = {
        highestCalories: { value: 0, activityType: null },
        longestStrength: { value: 0, activityType: null },
        longestCardio: { value: 0, activityType: null },
        longestDistance: { value: 0, activityType: null },
        fastestPace: { value: null, activityType: null },
        fastestCyclingPace: { value: null, activityType: null },
      };

      // Recovery activity types
      const recoveryTypes = ['Cold Plunge', 'Sauna'];

      updatedActivities.forEach(activity => {
        const yogaPilatesAsRecovery = ['Yoga', 'Pilates'].includes(activity.type) &&
          (!activity.countToward || activity.countToward === 'recovery');
        const isRecovery = recoveryTypes.includes(activity.type) || yogaPilatesAsRecovery;
        const isStrength = activity.type === 'Strength Training' || activity.countToward === 'strength';
        const isCardio = ['Running', 'Cycle', 'Sports'].includes(activity.type) || activity.countToward === 'cardio';

        // Highest calories (all activities)
        if (activity.calories && activity.calories > (newRecords.highestCalories.value || 0)) {
          newRecords.highestCalories = { value: activity.calories, activityType: activity.type };
        }

        // Non-recovery records
        if (!isRecovery) {
          // Longest strength
          if (isStrength && activity.duration && activity.duration > (newRecords.longestStrength.value || 0)) {
            newRecords.longestStrength = { value: activity.duration, activityType: activity.type };
          }

          // Longest cardio
          if (isCardio && activity.duration && activity.duration > (newRecords.longestCardio.value || 0)) {
            newRecords.longestCardio = { value: activity.duration, activityType: activity.type };
          }

          // Longest distance
          if (activity.distance && activity.distance > (newRecords.longestDistance.value || 0)) {
            newRecords.longestDistance = { value: activity.distance, activityType: activity.type };
          }

          // Fastest pace (running) - lower is better
          if (activity.type === 'Running' && activity.distance && activity.duration) {
            const pace = activity.duration / activity.distance;
            if (newRecords.fastestPace.value === null || pace < newRecords.fastestPace.value) {
              newRecords.fastestPace = { value: pace, activityType: activity.type };
            }
          }

          // Fastest cycling pace - lower is better
          if (activity.type === 'Cycle' && activity.distance && activity.duration) {
            const pace = activity.duration / activity.distance;
            if (newRecords.fastestCyclingPace.value === null || pace < newRecords.fastestCyclingPace.value) {
              newRecords.fastestCyclingPace = { value: pace, activityType: activity.type };
            }
          }
        }
      });

      // Merge with existing records (keep streak records, update activity records)
      return {
        ...currentRecords,
        ...newRecords
      };
    };

    const updatedRecords = recalculateRecords();

    // Update userData with new records
    setUserData(prev => ({
      ...prev,
      personalRecords: updatedRecords
    }));

    // console.log('Deleted activity:', activityId, 'Records recalculated');
  };

  // Show loading spinner while checking auth
  if (authLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="relative w-[60px] h-[60px]">
          {/* Spinning circle */}
          <svg className="absolute top-0 left-0 w-[60px] h-[60px] animate-spin" viewBox="0 0 60 60" style={{ animationDuration: '1.5s' }}>
            <circle cx="30" cy="30" r="26" fill="none" stroke="#333" strokeWidth="5"/>
            <circle cx="30" cy="30" r="26" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeDasharray="130 360"/>
          </svg>
          {/* Number 7 */}
          <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-2xl font-bold text-white">7</span>
        </div>
      </div>
    );
  }

  // Show login if no user or no userData (signed out)
  if (!user || !userData || !userProfile) {
    return <Login onLogin={handleUserAuth} />;
  }

  // Show username setup if user doesn't have a username
  if (!userProfile.username) {
    return (
      <UsernameSetup
        user={user}
        onComplete={(username) => setUserProfile(prev => ({ ...prev, username }))}
      />
    );
  }

  if (isOnboarded === false) {
    return <OnboardingSurvey
      currentGoals={userData.goals}
      onCancel={null}
      onComplete={async (goals, privacySettings) => {
        const goalsToSave = {
          liftsPerWeek: goals.liftsPerWeek,
          cardioPerWeek: goals.cardioPerWeek,
          recoveryPerWeek: goals.recoveryPerWeek,
          stepsPerDay: goals.stepsPerDay,
          caloriesPerDay: goals.caloriesPerDay
        };

        // Save goals to Firestore
        await saveUserGoals(user.uid, goalsToSave);

        // Save privacy settings to Firestore
        if (privacySettings) {
          await updateUserProfile(user.uid, { privacySettings });
          setUserProfile(prev => ({ ...prev, privacySettings }));
        }

        // Mark onboarding as complete
        await setOnboardingComplete(user.uid);

        // Update userData with user's chosen goals
        setUserData(prev => ({
          ...prev,
          goals: goalsToSave
        }));
        // Recalculate weekly progress with new goals
        setWeeklyProgress(prev => ({
          ...prev,
          lifts: { ...prev.lifts, goal: goals.liftsPerWeek },
          cardio: { ...prev.cardio, goal: goals.cardioPerWeek },
          recovery: { ...prev.recovery, goal: goals.recoveryPerWeek },
          steps: { ...prev.steps, goal: goals.stepsPerDay },
          calories: { ...prev.calories, goal: goals.caloriesPerDay }
        }));
        setIsOnboarded(true);

        // Start tour for new users after a short delay to let the UI render
        setTimeout(() => {
          setActiveTab('home');
          setShowTour(true);
        }, 500);
      }}
    />;
  }

  // Custom refresh indicator component
  return (
    <div
      className="min-h-screen text-white"
      style={{
        backgroundColor: '#0A0A0A',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif'
      }}
    >
      {/* Pull-to-Refresh Indicator (Home tab only) */}
      {activeTab === 'home' && (
        <PullToRefreshIndicator
          pullDistance={pullDistance}
          isRefreshing={isRefreshing}
          threshold={80}
        />
      )}

      {/* Offline Indicator */}
      <OfflineIndicator />

      {/* Active Workout Indicator */}
      <ActiveWorkoutIndicator
        workout={activeWorkout}
        activeTab={activeTab}
        isFinishing={showFinishWorkout}
        onFinish={() => setShowFinishWorkout(true)}
        onCancel={async () => {
          if (window.confirm('Cancel this workout? Your progress will be lost.')) {
            // Cancel the live HealthKit workout (discards without saving)
            await cancelLiveWorkout();
            setActiveWorkout(null);
            triggerHaptic(ImpactStyle.Medium);
          }
        }}
      />

      {/* Finish Workout Modal */}
      <FinishWorkoutModal
        isOpen={showFinishWorkout}
        workout={activeWorkout}
        onClose={() => setShowFinishWorkout(false)}
        onSave={async (finishedWorkout) => {
          // End the live workout in HealthKit (this saves it automatically)
          const liveResult = await endLiveWorkout({
            calories: finishedWorkout.calories,
            distance: finishedWorkout.distance
          });
          console.log('Ended live workout:', liveResult);

          // Mark that this was a live workout (already saved to HealthKit)
          const workoutData = {
            ...finishedWorkout,
            healthKitSaved: liveResult.success,
            healthKitUUID: liveResult.workoutUUID,
          };

          // Save the finished workout to Firestore using the existing handler
          handleActivitySaved(workoutData);

          // Clear active workout state
          setActiveWorkout(null);
          setShowFinishWorkout(false);
          triggerHaptic(ImpactStyle.Heavy);
        }}
      />

      {/* Fixed Header for Home tab */}
      {activeTab === 'home' && (
        <div
          className="fixed top-0 left-0 right-0 z-40 px-4 pb-4"
          style={{
            backgroundColor: '#0A0A0A',
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)'
          }}
        >
          <div>
            <img
              src="/wordmark.png"
              alt="Day Seven"
              className="h-6 cursor-pointer"
              onClick={handleLogoTap}
            />
            <p className="text-xs" style={{ color: '#00FF94' }}>Win the week.</p>
          </div>
        </div>
      )}

      {/* Status bar blur overlay for non-home tabs */}
      {activeTab !== 'home' && <StatusBarBlur />}

      {/* Spacer for fixed header */}
      <div
        style={{
          height: activeTab === 'home'
            ? 'calc(env(safe-area-inset-top, 0px) + 70px)'
            : 'calc(env(safe-area-inset-top, 0px) + 16px)'
        }}
      />

      <div
        className="overflow-hidden"
        style={{
          transform: activeTab === 'home' && pullDistance > 0 ? `translateY(${Math.min(pullDistance * 0.5, 60)}px)` : 'none',
          transition: pullDistance === 0 ? 'transform 0.3s ease-out' : 'none',
        }}
      >
        <div
          key={activeTab}
          style={{
            animation: `${tabDirection === 0 ? 'fadeIn' : tabDirection === 1 ? 'slideInRight' : 'slideInLeft'} 200ms ease-out`
          }}
        >
          {isLoading ? (
            <HomeTabSkeleton />
          ) : (
            <>
              {activeTab === 'home' && (
                <HomeTab
                  onAddActivity={handleAddActivity}
                  pendingSync={healthKitData.pendingWorkouts || []}
                  activities={activities}
                  weeklyProgress={weeklyProgress}
                  userData={userData}
                  userProfile={userProfile}
                  onDeleteActivity={handleDeleteActivity}
                  onEditActivity={(activity) => {
                    setPendingActivity({
                      ...activity,
                      durationHours: Math.floor((activity.duration || 0) / 60),
                      durationMinutes: (activity.duration || 0) % 60
                    });
                    setShowAddActivity(true);
                  }}
                  user={user}
                  weeklyGoalsRef={weeklyGoalsRef}
                  latestActivityRef={latestActivityRef}
                  healthKitData={healthKitData}
                />
              )}
              {activeTab === 'history' && (
                <HistoryTab
                  onShare={() => setShowShare(true)}
                  activities={activities}
                  calendarData={calendarData}
                  userData={userData}
                  onAddActivity={handleAddActivity}
                  onDeleteActivity={handleDeleteActivity}
                  onEditActivity={(activity) => {
                    // Open add activity modal with existing activity data for editing
                    setPendingActivity({
                      ...activity,
                      durationHours: Math.floor((activity.duration || 0) / 60),
                      durationMinutes: (activity.duration || 0) % 60
                    });
                    setShowAddActivity(true);
                  }}
                  initialView={historyView}
                  initialStatsSubView={historyStatsSubView}
                  activeStreaksRef={activeStreaksRef}
                  calendarRef={calendarRef}
                  statsRef={statsRef}
                  progressPhotosRef={progressPhotosRef}
                  user={user}
                  userProfile={userProfile}
                />
              )}
              {activeTab === 'feed' && (
                <ActivityFeed
                  user={user}
                  userProfile={userProfile}
                  friends={friends}
                  onOpenFriends={() => setShowFriends(true)}
                  pendingRequestsCount={pendingFriendRequests}
                  isRefreshing={isRefreshing}
                  pullDistance={pullDistance}
                  onActiveViewChange={setFeedActiveView}
                />
              )}
              {activeTab === 'profile' && (
                <ProfileTab
                  user={user}
                  userProfile={userProfile}
                  userData={userData}
                  onSignOut={handleSignOut}
                  onEditGoals={() => setShowEditGoals(true)}
                  onUpdatePhoto={handleUpdatePhoto}
                  onShare={() => setShowShare(true)}
                  onStartTour={() => {
                    setTourStep(0);
                    setActiveTab('home');
                    setShowTour(true);
                  }}
                  onUpdatePrivacy={handleUpdatePrivacy}
                  onChangePassword={() => setShowChangePassword(true)}
                  onResetPassword={handleResetPassword}
                  onDeleteAccount={() => setShowDeleteAccount(true)}
                />
              )}
            </>
          )}
        </div>
        <style>{`
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes hapticPulse {
            0% { transform: scale(1); opacity: 1; }
            100% { transform: scale(1.5); opacity: 0; }
          }
        `}</style>
      </div>

      <div className="fixed bottom-0 left-0 right-0 px-4 pb-6 pt-2 z-40" style={{ background: 'linear-gradient(to top, #0A0A0A 0%, #0A0A0A 70%, transparent 100%)' }}>
        {/* Floating + button - centered, overlapping nav */}
        <button
          ref={logActivityRef}
          onClick={() => handleAddActivity()}
          className="absolute left-1/2 -translate-x-1/2 w-20 h-20 rounded-full flex items-center justify-center shadow-xl transition-all duration-150 z-50"
          style={{
            bottom: 'calc(100% - 60px)',
            backgroundColor: '#00FF94',
            transform: 'translateX(-50%) scale(1)'
          }}
          onTouchStart={(e) => {
            e.currentTarget.style.transform = 'translateX(-50%) scale(0.9)';
            triggerHaptic(ImpactStyle.Medium);
            const ring = document.createElement('div');
            ring.style.cssText = `
              position: absolute;
              inset: -8px;
              border-radius: 50%;
              border: 3px solid rgba(0, 255, 148, 0.6);
              animation: hapticPulse 0.3s ease-out forwards;
              pointer-events: none;
            `;
            e.currentTarget.appendChild(ring);
            setTimeout(() => ring.remove(), 300);
          }}
          onTouchEnd={(e) => {
            e.currentTarget.style.transform = 'translateX(-50%) scale(1)';
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = 'translateX(-50%) scale(0.9)';
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = 'translateX(-50%) scale(1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateX(-50%) scale(1)';
          }}
        >
          <span className="text-4xl text-black font-bold leading-none" style={{ marginTop: '-2px' }}>+</span>
        </button>

        <div className="flex items-center justify-around p-2 rounded-2xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(20px)' }}>
          {/* Home */}
          <button
            ref={homeTabRef}
            onClick={() => switchTab('home')}
            className="flex-1 py-3 flex flex-col items-center gap-1 transition-all duration-150"
            style={{ transform: 'scale(1)' }}
            onTouchStart={(e) => { e.currentTarget.style.transform = 'scale(0.92)'; triggerHaptic(ImpactStyle.Light); }}
            onTouchEnd={(e) => e.currentTarget.style.transform = 'scale(1)'}
            onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.92)'}
            onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
            onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
          >
            <svg className="w-6 h-6" fill="none" stroke={activeTab === 'home' ? 'white' : '#6b7280'} viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
            </svg>
            <span className={`text-xs ${activeTab === 'home' ? 'text-white' : 'text-gray-500'}`}>Home</span>
          </button>

          {/* History */}
          <button
            ref={historyTabRef}
            onClick={() => switchTab('history')}
            className="flex-1 py-3 flex flex-col items-center gap-1 transition-all duration-150"
            style={{ transform: 'scale(1)' }}
            onTouchStart={(e) => { e.currentTarget.style.transform = 'scale(0.92)'; triggerHaptic(ImpactStyle.Light); }}
            onTouchEnd={(e) => e.currentTarget.style.transform = 'scale(1)'}
            onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.92)'}
            onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
            onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
          >
            <svg className="w-6 h-6" fill="none" stroke={activeTab === 'history' ? 'white' : '#6b7280'} viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
            </svg>
            <span className={`text-xs ${activeTab === 'history' ? 'text-white' : 'text-gray-500'}`}>History</span>
          </button>

          {/* Center spacer for the floating button */}
          <div className="w-16" />

          {/* Friends */}
          <button
            ref={friendsTabRef}
            onClick={() => switchTab('feed')}
            className="flex-1 py-3 flex flex-col items-center gap-1 transition-all duration-150 relative"
            style={{ transform: 'scale(1)' }}
            onTouchStart={(e) => { e.currentTarget.style.transform = 'scale(0.92)'; triggerHaptic(ImpactStyle.Light); }}
            onTouchEnd={(e) => e.currentTarget.style.transform = 'scale(1)'}
            onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.92)'}
            onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
            onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
          >
            <svg className="w-6 h-6" fill="none" stroke={activeTab === 'feed' ? 'white' : '#6b7280'} viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
            </svg>
            <span className={`text-xs ${activeTab === 'feed' ? 'text-white' : 'text-gray-500'}`}>Friends</span>
            {pendingFriendRequests > 0 && (
              <span
                className="absolute top-1 right-1/4 w-2 h-2 rounded-full"
                style={{ backgroundColor: '#FF453A' }}
              />
            )}
          </button>

          {/* Profile */}
          <button
            ref={profileTabRef}
            onClick={() => switchTab('profile')}
            className="flex-1 py-3 flex flex-col items-center gap-1 transition-all duration-150"
            style={{ transform: 'scale(1)' }}
            onTouchStart={(e) => { e.currentTarget.style.transform = 'scale(0.92)'; triggerHaptic(ImpactStyle.Light); }}
            onTouchEnd={(e) => e.currentTarget.style.transform = 'scale(1)'}
            onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.92)'}
            onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
            onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
          >
            <svg className="w-6 h-6" fill="none" stroke={activeTab === 'profile' ? 'white' : '#6b7280'} viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
            </svg>
            <span className={`text-xs ${activeTab === 'profile' ? 'text-white' : 'text-gray-500'}`}>Profile</span>
          </button>
        </div>
      </div>

      {/* App Tour */}
      {showTour && (
        <AppTour
          step={tourStep}
          onNext={handleTourNext}
          onBack={handleTourBack}
          onSkip={handleTourSkip}
          targetRef={getTourTargetRef()}
          onSwitchTab={setActiveTab}
          homeTabRef={homeTabRef}
        />
      )}

      <AddActivityModal
        isOpen={showAddActivity}
        onClose={() => {
          setShowAddActivity(false);
          setPendingActivity(null);
          setDefaultActivityDate(null);
        }}
        onSave={handleActivitySaved}
        pendingActivity={pendingActivity}
        defaultDate={defaultActivityDate}
        userData={userData}
        hasActiveWorkout={!!activeWorkout}
        onStartWorkout={async (workoutData) => {
          // Start a new active workout
          setActiveWorkout(workoutData);
          triggerHaptic(ImpactStyle.Heavy);

          // Start a live HealthKit workout session
          // This creates an actual workout in HealthKit and starts collecting metrics
          const activityType = getHealthKitActivityType(workoutData);
          const result = await startLiveWorkout(activityType);
          console.log('Started live workout:', result);
        }}
        onSaveCustomActivity={(customActivity) => {
          // Add custom activity to user's saved list (if not already saved)
          // customActivity is now an object: { name: string, emoji: string }
          const currentCustomActivities = userData.customActivities || [];
          const alreadyExists = currentCustomActivities.some(
            a => (typeof a === 'string' ? a : a.name) === customActivity.name
          );
          if (!alreadyExists) {
            setUserData(prev => ({
              ...prev,
              customActivities: [...(prev.customActivities || []), customActivity]
            }));
          }
        }}
      />

      <ChangePasswordModal
        isOpen={showChangePassword}
        onClose={() => setShowChangePassword(false)}
        user={user}
      />

      <DeleteAccountModal
        isOpen={showDeleteAccount}
        onClose={() => setShowDeleteAccount(false)}
        user={user}
        userProfile={userProfile}
        onDeleteComplete={() => {
          setShowDeleteAccount(false);
          // User will be automatically signed out when auth account is deleted
        }}
      />

      <ShareModal
        isOpen={showShare}
        onClose={() => setShowShare(false)}
        stats={{
          // Streak stats
          streak: userData.streaks.master,
          longestStreak: userData.personalRecords.longestMasterStreak || userData.streaks.master,
          strengthStreak: userData.streaks.lifts,
          cardioStreak: userData.streaks.cardio,
          recoveryStreak: userData.streaks.recovery,
          longestStrengthStreak: userData.personalRecords.longestStrengthStreak || 0,
          longestCardioStreak: userData.personalRecords.longestCardioStreak || 0,
          longestRecoveryStreak: userData.personalRecords.longestRecoveryStreak || 0,
          // Last 4 weeks history (true = won, false = missed)
          last4Weeks: (() => {
            const weeks = [];
            const goals = userData.goals;
            for (let i = 0; i < 4; i++) {
              const weekStart = new Date();
              weekStart.setDate(weekStart.getDate() - weekStart.getDay() - (i * 7));
              const weekEnd = new Date(weekStart);
              weekEnd.setDate(weekStart.getDate() + 6);
              const weekStartStr = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
              const weekEndStr = `${weekEnd.getFullYear()}-${String(weekEnd.getMonth() + 1).padStart(2, '0')}-${String(weekEnd.getDate()).padStart(2, '0')}`;

              const weekActivities = activities.filter(a => a.date >= weekStartStr && a.date <= weekEndStr);
              const lifts = weekActivities.filter(a => a.type === 'Strength Training').length;
              const cardio = weekActivities.filter(a => ['Running', 'Cycle', 'Sports'].includes(a.type)).length;
              const recovery = weekActivities.filter(a => ['Cold Plunge', 'Sauna', 'Yoga', 'Pilates'].includes(a.type)).length;

              const won = lifts >= goals.liftsPerWeek && cardio >= goals.cardioPerWeek && recovery >= goals.recoveryPerWeek;
              weeks.push(won);
            }
            return weeks.reverse(); // oldest to newest
          })(),
          // Total weeks won (all time)
          weeksWon: (() => {
            const goals = userData.goals;
            const weekMap = {};

            // Group activities by week
            activities.forEach(a => {
              const date = new Date(a.date + 'T12:00:00');
              const weekStart = new Date(date);
              weekStart.setDate(date.getDate() - date.getDay());
              const weekKey = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;

              if (!weekMap[weekKey]) {
                weekMap[weekKey] = { lifts: 0, cardio: 0, recovery: 0 };
              }

              if (a.type === 'Strength Training') weekMap[weekKey].lifts++;
              else if (['Running', 'Cycle', 'Sports'].includes(a.type)) weekMap[weekKey].cardio++;
              else if (['Cold Plunge', 'Sauna', 'Yoga', 'Pilates'].includes(a.type)) weekMap[weekKey].recovery++;
            });

            // Count weeks where all goals were met
            return Object.values(weekMap).filter(w =>
              w.lifts >= goals.liftsPerWeek &&
              w.cardio >= goals.cardioPerWeek &&
              w.recovery >= goals.recoveryPerWeek
            ).length;
          })(),
          // Weekly stats
          weeklyLifts: weeklyProgress.lifts.completed,
          weeklyCardio: weeklyProgress.cardio.completed,
          weeklyRecovery: weeklyProgress.recovery.completed,
          liftsGoal: userData.goals.liftsPerWeek,
          cardioGoal: userData.goals.cardioPerWeek,
          recoveryGoal: userData.goals.recoveryPerWeek,
          weeklyCalories: activities.filter(a => {
            const today = new Date();
            const weekStart = new Date(today);
            weekStart.setDate(weekStart.getDate() - weekStart.getDay());
            const weekStartStr = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
            return a.date >= weekStartStr;
          }).reduce((sum, a) => sum + (parseInt(a.calories) || 0), 0),
          weeklyMiles: activities.filter(a => {
            const today = new Date();
            const weekStart = new Date(today);
            weekStart.setDate(weekStart.getDate() - weekStart.getDay());
            const weekStartStr = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
            return a.date >= weekStartStr && a.distance;
          }).reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0),
          // Weekly activities for analysis
          weeklyActivities: activities.filter(a => {
            const today = new Date();
            const weekStart = new Date(today);
            weekStart.setDate(weekStart.getDate() - weekStart.getDay());
            const weekStartStr = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
            return a.date >= weekStartStr;
          }),
          // Monthly stats
          monthlyWorkouts: activities.filter(a => {
            const today = new Date();
            const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
            return a.date >= monthStart;
          }).length,
          monthlyCalories: activities.filter(a => {
            const today = new Date();
            const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
            return a.date >= monthStart;
          }).reduce((sum, a) => sum + (parseInt(a.calories) || 0), 0),
          monthlyMiles: activities.filter(a => {
            const today = new Date();
            const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
            return a.date >= monthStart && a.distance;
          }).reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0),
          // Personal records
          records: userData.personalRecords,
          // Totals
          workouts: activities.length
        }}
      />

      <CelebrationOverlay
        show={showCelebration}
        message={celebrationMessage}
        onComplete={() => {
          setShowCelebration(false);
          // Show pending toast after celebration completes
          if (pendingToast) {
            setTimeout(() => {
              setToastMessage(pendingToast);
              setShowToast(true);
              setPendingToast(null);
            }, 300);
          }
        }}
      />

      <WeekStreakCelebration
        show={showWeekStreakCelebration}
        onClose={() => {
          setShowWeekStreakCelebration(false);
          // Show pending toast after week streak celebration closes
          if (pendingToast) {
            setTimeout(() => {
              setToastMessage(pendingToast);
              setShowToast(true);
              setPendingToast(null);
            }, 300);
          }
        }}
        onShare={() => {
          setShowWeekStreakCelebration(false);
          setShowShare(true);
          // Clear pending toast if user shares (don't interrupt share flow)
          setPendingToast(null);
        }}
      />

      <Toast
        show={showToast}
        message={toastMessage}
        onDismiss={() => setShowToast(false)}
        onTap={toastType === 'record' ? navigateToHallOfFame : null}
        type={toastType}
      />

      {showFriends && (
        <Friends
          user={user}
          userProfile={userProfile}
          onClose={async () => {
            setShowFriends(false);
            // Refresh friends and pending requests after modal closes
            if (user) {
              const friendsList = await getFriends(user.uid);
              setFriends(friendsList);
              const requests = await getFriendRequests(user.uid);
              setPendingFriendRequests(requests.length);
            }
          }}
        />
      )}

      {/* Edit Goals Screen */}
      {showEditGoals && (
        <div className="fixed inset-0 z-50 bg-black">
          <OnboardingSurvey
            currentGoals={userData.goals}
            onCancel={() => setShowEditGoals(false)}
            onComplete={async (goals) => {
              const goalsToSave = {
                liftsPerWeek: goals.liftsPerWeek,
                cardioPerWeek: goals.cardioPerWeek,
                recoveryPerWeek: goals.recoveryPerWeek,
                stepsPerDay: goals.stepsPerDay,
                caloriesPerDay: goals.caloriesPerDay
              };

              // Save goals to Firestore
              await saveUserGoals(user.uid, goalsToSave);

              setUserData(prev => ({
                ...prev,
                goals: goalsToSave
              }));
              setWeeklyProgress(prev => ({
                ...prev,
                lifts: { ...prev.lifts, goal: goals.liftsPerWeek },
                cardio: { ...prev.cardio, goal: goals.cardioPerWeek },
                recovery: { ...prev.recovery, goal: goals.recoveryPerWeek },
                steps: { ...prev.steps, goal: goals.stepsPerDay },
                calories: { ...prev.calories, goal: goals.caloriesPerDay }
              }));
              setShowEditGoals(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
