import React, { useState, useEffect, useMemo, useRef, createContext, useContext, useCallback } from 'react';
import * as Sentry from '@sentry/react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth, EmailAuthProvider, reauthenticateWithCredential, updatePassword, sendPasswordResetEmail } from './firebase';
import Login from './Login';
import UsernameSetup from './UsernameSetup';
import Friends from './Friends';
import ActivityFeed from './ActivityFeed';
import { ChallengeFriendModal, ChallengesSection, ChallengeActivityPickerModal, ChallengeApplyPastActivityModal } from './Challenges';
import ChallengesTab from './ChallengesTab';
import SettingsPage from './Settings';
import ProfilePage from './Profile';
import { isChallengeable, getChallengesForUser, activityMatchesChallengeRule, describeMatchRule, evaluateActivityAgainstChallenge, applyOptimisticChallengeCompletions, applyChallengeIntent } from './services/challengeService';
import ChallengeMatchChooser from './components/ChallengeMatchChooser';
import { createUserProfile, getUserProfile, updateUserProfile, saveUserActivities, getUserActivities, saveCustomActivities, getCustomActivities, uploadProfilePhoto, uploadActivityPhoto, deleteActivityPhoto, saveUserGoals, getUserGoals, setOnboardingComplete, setTourComplete, savePersonalRecords, getPersonalRecords, saveDailyHealthData, getDailyHealthData, getDailyHealthHistory, subscribeToUserChallengeStats } from './services/userService';
import { getFriends, getReactions, getFriendRequests, getComments, addReply, getReplies, deleteReply, addReaction, removeReaction, addComment, cleanupActivitySocialData } from './services/friendService';

import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { syncHealthKitData, fetchTodaySteps, fetchTodayCalories, fetchHealthDataForDate, saveWorkoutToHealthKit, fetchWorkoutMetricsForTimeRange, startLiveWorkout, endLiveWorkout, cancelLiveWorkout, getLiveWorkoutMetrics, addMetricsUpdateListener, getHealthKitActivityType, fetchLinkableWorkouts, queryHeartRateForTimeRange, queryMaxHeartRateFromHealthKit, isWatchReachable, startWatchWorkout, endWatchWorkout, pauseWatchWorkout, resumeWatchWorkout, getWatchWorkoutMetrics, cancelWatchWorkout, addWatchWorkoutStartedListener, addWatchWorkoutEndedListener, addWatchActivitySavedListener, notifyWatchDataChanged, fetchWorkoutRoute, updateWidgetData, updateLiveActivityState, startWatchWorkoutLiveActivity, endAllLiveActivities, checkActiveLiveActivity } from './services/healthService';
import NotificationSettings from './NotificationSettings';
import { initializePushNotifications, handleNotificationNavigation, removeFCMToken, clearBadge, clearAllNotifications, incrementBadge, shouldShowNotification, getNotificationPreferences } from './services/notificationService';
import { initializeRevenueCat, checkProStatus, addCustomerInfoListener, logoutRevenueCat, presentPaywall, presentCustomerCenter, restorePurchases, setDevAuthEmail } from './services/subscriptionService';
import ActivityIcon, { ICON_PICKER_CATEGORIES, CATEGORY_COLORS as ICON_CATEGORY_COLORS } from './components/ActivityIcon';
import RouteMapView, { ll2px, bestFit, makeTiles, RouteOverlay, TileLayer, TILE } from './components/RouteMapView';
import MuscleBodyMap from './components/MuscleBodyMap';
import { isDemoAccount, getDemoActivities, getDemoUserData, getDemoHealthKitData, getDemoCalendarData } from './demoData';
import { Dumbbell } from 'lucide-react';
import { IconRun, IconSnowflake } from '@tabler/icons-react';
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

// Flag to suppress foreground refresh while photo picker is open
// (prevents re-render glitch when returning from iOS photo picker)
let photoPickerActive = false;

// DAY SEVEN Logo component - uses wordmark image
const DaySevenLogo = ({ size = 'base', opacity = 0.7 }) => {
  const sizeMap = {
    'xs': 'h-[14px]',
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

// D7 Icon component - compact logo mark (D with 7 nested inside)
const D7Icon = ({ size = 28, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 1024 1024" fill="none" className={className}>
    {/* D outline with rounded corners */}
    <path
      d="M250 160 L250 864 L500 864 C740 864 820 680 820 512 C820 344 740 160 500 160 L250 160"
      stroke="white"
      strokeWidth="65"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
    {/* 7 nested inside the D */}
    <path
      d="M400 330 L600 330 L460 694"
      stroke="white"
      strokeWidth="50"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </svg>
);

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

// --- Smart Save: Zone calculation helpers (pure functions, no state) ---

// Determine which HR zone an average heart rate falls into (1-5, or null)
const getHRZone = (avgHR, maxHR) => {
  if (!avgHR || !maxHR || maxHR < 100) return null;
  const pct = avgHR / maxHR;
  if (pct < 0.60) return 1;
  if (pct < 0.70) return 2;
  if (pct < 0.80) return 3;
  if (pct < 0.90) return 4;
  return 5;
};

// Check if a walk qualifies for Smart Save (auto-save without notification)
// Rules: Zone 1 (any duration), Zone 2 under 40min, Zone 3 under 15min
const shouldSmartSaveWalk = (workout, maxHR, smartSaveEnabled) => {
  if (!smartSaveEnabled) return false;
  if (!maxHR || maxHR < 100) return false;
  if (workout.type !== 'Walking') return false;
  if (!workout.avgHr) return false;

  const duration = workout.duration || 0;
  const zone = getHRZone(workout.avgHr, maxHR);
  if (!zone) return false;

  if (zone === 1) return true;
  if (zone === 2 && duration < 40) return true;
  if (zone === 3 && duration < 15) return true;

  return false;
};

// Get current week key (Sunday start date as "YYYY-MM-DD") for celebration tracking
const getCurrentWeekKey = () => {
  const today = new Date();
  const day = today.getDay(); // 0 = Sunday
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - day);
  return toLocalDateStr(sunday);
};

const getPreviousWeekKey = () => {
  const today = new Date();
  const day = today.getDay(); // 0 = Sunday
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - day - 7);
  return toLocalDateStr(sunday);
};

// Default empty week celebration state
const emptyWeekCelebrations = { week: '', lifts: false, cardio: false, recovery: false, master: false };

// Check if the phone has already shown the master celebration this week (local-only, not synced to Firestore)
const getPhoneCelebrationShown = () => {
  try {
    const saved = localStorage.getItem('phoneCelebrationShown');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.week === getCurrentWeekKey()) return parsed;
    }
  } catch {}
  return { week: getCurrentWeekKey(), master: false };
};
const markPhoneCelebrationShown = () => {
  const data = { week: getCurrentWeekKey(), master: true };
  localStorage.setItem('phoneCelebrationShown', JSON.stringify(data));
};

// Initial weekly progress - zeroed out
const initialWeeklyProgress = {
  lifts: { completed: 0, goal: 4, sessions: [] },
  cardio: { completed: 0, goal: 3, sessions: [], breakdown: { running: 0, cycling: 0, sports: 0 } },
  recovery: { completed: 0, goal: 2, sessions: [], breakdown: { coldPlunge: 0, sauna: 0, contrastTherapy: 0, coldShower: 0, hotPlunge: 0, yoga: 0 } },
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
      title: 'Challenges',
      description: 'Head-to-head bets with your friends live here.',
      position: 'above',
      tab: 'challenges',
      features: [
        { emoji: '⚡', text: 'Active challenges' },
        { emoji: '⏳', text: 'Pending invites' },
        { emoji: '✅', text: 'Completed history' },
        { emoji: '👥', text: '1v1 or group mode' }
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
      description: 'Your fitness home base.',
      position: 'above',
      tab: 'profile',
      features: [
        { emoji: '📊', text: 'See your stats' },
        { emoji: '📅', text: 'Browse your history' },
        { emoji: '🎯', text: 'Set goals & share wins' }
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
      // Fixed elements are the bottom nav tabs: Challenges (2), Friends (3), Profile (4)
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

// ActivityIcon is imported from ./components/ActivityIcon

// Heat Map Calendar Component
const HeatMapCalendar = ({ data, onSelectDate, selectedDate, onSelectWeek }) => {
  const [viewMonths, setViewMonths] = useState(3); // Show last 3 months
  
  // Generate last N months of dates
  const generateHeatMapData = () => {
    const days = [];
    const today = new Date();
    const startDate = new Date(today);
    startDate.setMonth(startDate.getMonth() - viewMonths + 1);
    startDate.setDate(1);
    
    // Adjust to start from Sunday
    const dayOfWeek = startDate.getDay();
    startDate.setDate(startDate.getDate() - dayOfWeek);
    
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + (6 - today.getDay())); // End of current week
    
    const todayStr = toLocalDateStr(today);

    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dateStr = toLocalDateStr(currentDate);
      const activities = data[dateStr] || [];
      days.push({
        date: dateStr,
        day: currentDate.getDate(),
        month: currentDate.getMonth(),
        year: currentDate.getFullYear(),
        activities,
        activityCount: activities.length,
        isToday: dateStr === todayStr,
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
const ActiveWorkoutIndicator = ({ workout, onFinish, onCancel, activeTab, isFinishing, onResumedFromWatch }) => {
  const [elapsed, setElapsed] = useState(0);
  const [frozenElapsed, setFrozenElapsed] = useState(null); // Stores elapsed time when finishing
  const [isExpanded, setIsExpanded] = useState(false);
  const [liveMetrics, setLiveMetrics] = useState({ lastHr: 0, calories: 0 });
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  // Watch-workout pause sync: source of truth is the watch, but we keep these
  // in local state so the timer tick can compute elapsed without a round-trip.
  const pauseStateRef = useRef({ isPaused: false, accumulatedPauseMs: 0 });

  // Reset timer state when a new workout starts (prevents stale elapsed from previous workout)
  useEffect(() => {
    setElapsed(0);
    setFrozenElapsed(null);
    pauseStateRef.current = { isPaused: false, accumulatedPauseMs: 0 };
  }, [workout?.startTime]);

  // Collapse and freeze timer when finishing
  useEffect(() => {
    if (isFinishing) {
      setFrozenElapsed(elapsed); // Freeze the current time
      setIsExpanded(false); // Collapse to pill
    } else {
      setFrozenElapsed(null); // Unfreeze when modal closes
    }
  }, [isFinishing]);

  // Update elapsed time every second using wall-clock.
  // For watch workouts we subtract the pause time synced from the 1s poll,
  // so the on-screen timer stays smooth (like the Live Activity) instead of
  // lagging behind each WCSession round-trip.
  useEffect(() => {
    if (!workout?.startTime || isFinishing) return;

    const updateElapsed = () => {
      const start = new Date(workout.startTime).getTime();
      const now = Date.now();
      if (workout.source === 'watch') {
        const { isPaused, accumulatedPauseMs } = pauseStateRef.current;
        if (isPaused) return; // freeze — poll will refresh pause time
        setElapsed(Math.max(0, Math.floor((now - start - accumulatedPauseMs) / 1000)));
      } else {
        setElapsed(Math.floor((now - start) / 1000));
      }
    };
    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [workout?.startTime, isFinishing, workout?.source]);

  // Listen for real-time metric updates (watch or phone)
  useEffect(() => {
    if (!workout?.startTime) return;

    if (workout.source === 'watch') {
      // Poll watch metrics every 2 seconds
      let lastPausedState = null;
      const pollWatch = async () => {
        try {
          const metrics = await getWatchWorkoutMetrics();
          if (metrics.isActive) {
            // Detect if watch was resumed while phone is showing end workout modal
            if (isFinishing && !metrics.isPaused && onResumedFromWatch) {
              // Watch was resumed by user on the watch — close the end workout modal on phone
              onResumedFromWatch();
            }

            const currentPaused = metrics.isPaused || false;
            // Sync pause state for the local timer tick — the tick computes
            // elapsed from wall-clock so the phone timer matches the Live
            // Activity's native ticking instead of jumping on poll boundaries.
            const pauseSeconds = typeof metrics.accumulatedPauseSeconds === 'number'
              ? metrics.accumulatedPauseSeconds
              : 0;
            pauseStateRef.current = {
              isPaused: currentPaused,
              accumulatedPauseMs: pauseSeconds * 1000,
            };
            // Update Live Activity when pause state flips. Pass the current
            // accumulatedPauseTime so the native ticking timer offsets by the
            // correct amount after resume — otherwise it defaults to 0 and the
            // Live Activity timer jumps to wall-clock (drifting from the watch).
            if (lastPausedState !== currentPaused) {
              lastPausedState = currentPaused;
              updateLiveActivityState(currentPaused, pauseSeconds);
            }

            setLiveMetrics({
              lastHr: metrics.heartRate || 0,
              avgHr: metrics.avgHeartRate || 0,
              calories: metrics.calories || 0,
              distance: metrics.distance || 0,
              isPaused: currentPaused,
              currentZone: metrics.currentZone || '',
            });
            // While paused, mirror the watch's frozen elapsed so the display
            // reflects the exact pause moment (tick is frozen on this branch).
            if (currentPaused && metrics.elapsedSeconds !== undefined) {
              setElapsed(metrics.elapsedSeconds);
            }
          }
        } catch (e) {
          console.log('[WatchMetrics] Poll error:', e.message);
        }
      };

      pollWatch();
      const interval = setInterval(pollWatch, 1000);
      return () => clearInterval(interval);
    } else {
      // Phone workout: use HealthKit listener
      const removeListener = addMetricsUpdateListener((data) => {
        setLiveMetrics(prev => ({
          ...prev,
          ...(data.type === 'heartRate' && { lastHr: data.lastHr }),
          ...(data.type === 'calories' && { calories: data.calories }),
        }));
      });

      getLiveWorkoutMetrics().then(result => {
        if (result.success && result.isActive) {
          setLiveMetrics({
            lastHr: result.lastHr || 0,
            calories: result.calories || 0,
          });
        }
      });

      return () => removeListener();
    }
  }, [workout?.startTime, workout?.source, isFinishing]);

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

  // Get display info — check for new customIcon first, fall back to old customEmoji
  const customEmoji = workout.customIcon ? null : (workout.customEmoji || workout.sportEmoji || null);
  const typeName = workout.type === 'Strength Training'
    ? (workout.strengthType || 'Strength')
    : workout.type;
  const subtypeName = workout.type === 'Strength Training'
    ? normalizeFocusAreas(workout.focusAreas || (workout.focusArea ? [workout.focusArea] : [])).join(', ')
    : (workout.subtype || '');

  // Position based on active tab:
  // - Home, Profile, Challenges: top right
  // - Friends: top center
  const useTopRight = activeTab === 'home' || activeTab === 'challenges' || activeTab === 'profile';

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
        <span className="text-base flex items-center">{customEmoji || <ActivityIcon type={workout.type} subtype={workout.subtype} strengthType={workout.strengthType} customIcon={workout.customIcon} sportEmoji={workout.sportEmoji} size={16} />}</span>

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

  // Expanded view - appears across the header at the top
  return (
    <div
      className="fixed left-0 right-0 z-[100] shadow-2xl overflow-hidden"
      style={{
        top: '0',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        backgroundColor: 'rgba(0,0,0,0.98)',
        borderBottom: '1px solid rgba(0,255,148,0.3)',
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
            {customEmoji || <ActivityIcon type={workout.type} subtype={workout.subtype} strengthType={workout.strengthType} customIcon={workout.customIcon} sportEmoji={workout.sportEmoji} size={22} />}
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
              setShowCancelConfirm(true);
            }}
            className="p-2 rounded-lg transition-all"
            style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
          >
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Cancel confirmation overlay */}
        {showCancelConfirm ? (
          <div className="mt-3">
            <p className="text-sm text-gray-300 text-center mb-3">Cancel this workout? Your progress will be lost.</p>
            <div className="flex gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowCancelConfirm(false);
                }}
                className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white transition-all active:scale-[0.98]"
                style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}
              >
                Keep Going
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowCancelConfirm(false);
                  onCancel();
                }}
                className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white transition-all active:scale-[0.98]"
                style={{ backgroundColor: '#FF3B30' }}
              >
                Cancel Workout
              </button>
            </div>
          </div>
        ) : (
          <>
        {/* Live metrics from watch or reminder for phone */}
        {workout.source === 'watch' ? (
          <div className="mt-2 grid grid-cols-3 gap-2">
            <div className="py-2 px-2 rounded-lg text-center" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
              <div className="text-lg font-bold text-white">{liveMetrics.lastHr || '--'}</div>
              <div className="text-[10px] text-gray-500 flex items-center justify-center gap-1">
                <span style={{ color: '#FF3B30' }}>♥</span> BPM
              </div>
            </div>
            <div className="py-2 px-2 rounded-lg text-center" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
              <div className="text-lg font-bold" style={{ color: '#FF9500' }}>{liveMetrics.calories || '0'}</div>
              <div className="text-[10px] text-gray-500">CAL</div>
            </div>
            <div className="py-2 px-2 rounded-lg text-center" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
              <div className="text-lg font-bold" style={{ color: '#5AC8FA' }}>
                {liveMetrics.distance > 10 ? (liveMetrics.distance / 1609.34).toFixed(2) : '0.00'}
              </div>
              <div className="text-[10px] text-gray-500">MI</div>
            </div>
          </div>
        ) : (
          <div className="mt-2 py-2 px-3 rounded-lg text-center" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
            <span className="text-xs text-gray-500">Track with your watch for heart rate & calories</span>
          </div>
        )}

        {/* Finish button */}
        <button
          onClick={onFinish}
          className="w-full mt-3 py-2.5 rounded-xl font-semibold text-sm text-black transition-all active:scale-[0.98]"
          style={{ backgroundColor: '#00FF94' }}
        >
          {workout.source === 'watch' ? 'End Workout' : 'Finish Timer'}
        </button>
          </>
        )}
      </div>
    </div>
  );
};

// Shared utility: Determine default "count toward" category based on activity type and subtype.
// NOTE: Strength category is stored as 'lifting' (not 'strength') to match the goal key 'liftsPerWeek'.
// The UI displays "Strength" but the internal value is 'lifting'. Keep this consistent in new code.
// Returns the default countToward for a given activity type.
// NOTE: 'lifting' is the canonical internal value for strength activities (see functions/index.js).
// Flattened strength types (Weightlifting, Bodyweight, Circuit) also map to 'lifting'.
const getDefaultCountToward = (type, sub) => {
  if (type === 'Strength Training') return 'lifting';
  if (type === 'Weightlifting') return 'lifting';
  if (type === 'Bodyweight') return 'lifting';
  if (type === 'Circuit') return 'lifting+cardio';
  if (type === 'Running') return 'cardio';
  if (type === 'Cycle') return 'cardio';
  if (type === 'Sports') return 'cardio';
  if (type === 'Stair Climbing') return 'cardio';
  if (type === 'Elliptical') return 'cardio';
  if (type === 'Rowing') return 'cardio';
  if (type === 'Ski Trainer') return 'cardio';
  // Team / competitive sports
  if (['Basketball', 'Soccer', 'Football', 'Tennis', 'Golf', 'Badminton', 'Boxing', 'Martial Arts',
    'Baseball', 'Volleyball', 'Hockey', 'Lacrosse', 'Rugby', 'Softball', 'Squash', 'Table Tennis',
    'Racquetball', 'Handball', 'Pickleball', 'Cricket', 'Australian Football', 'Wrestling',
    'Fencing', 'Curling', 'Bowling'].includes(type)) return 'cardio';
  // Individual cardio sports
  if (['Track & Field', 'Jump Rope', 'Downhill Skiing', 'Cross Country Skiing', 'Snowboarding',
    'Skating', 'Surfing', 'Water Polo', 'Paddle Sports'].includes(type)) return 'cardio';
  if (type === 'Yoga') {
    if (['Power', 'Hot', 'Vinyasa'].includes(sub)) return 'cardio';
    return 'recovery';
  }
  if (type === 'Pilates') return 'recovery';
  if (type === 'Cold Plunge') return 'recovery';
  if (type === 'Sauna') return 'recovery';
  if (type === 'Massage') return 'recovery';
  if (type === 'Chiropractic') return 'recovery';
  if (type === 'Walking') return null;
  return null;
};

// Finish Workout Modal - Shown when user taps "Finish Timer"
const FinishWorkoutModal = ({ isOpen, workout, onClose, onSave, onDiscard, linkedWorkoutUUIDs = [] }) => {
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
  const [linkedWorkout, setLinkedWorkout] = useState(null);
  const [linkableWorkouts, setLinkableWorkouts] = useState([]);
  const [isLoadingWorkouts, setIsLoadingWorkouts] = useState(false);
  const [finishSubtype, setFinishSubtype] = useState('');
  const [finishCountToward, setFinishCountToward] = useState(null);
  const [finishSportEmoji, setFinishSportEmoji] = useState(null);
  const [finishStrengthType, setFinishStrengthType] = useState('');
  const [finishFocusAreas, setFinishFocusAreas] = useState([]);
  const [contrastColdType, setContrastColdType] = useState('Cold Plunge');
  const [contrastHotType, setContrastHotType] = useState('Sauna');
  const [contrastColdMinutes, setContrastColdMinutes] = useState(5);
  const [contrastHotMinutes, setContrastHotMinutes] = useState(10);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const fileInputRef = useRef(null);
  const scrollContentRef = useRef(null);
  const overlayRef = useRef(null);

  // Subtype and countToward options for FinishWorkoutModal
  const subtypeOptions = {
    'Running': ['Outdoor', 'Indoor'],
    'Walking': ['Outdoor', 'Indoor'],
    'Cycle': ['Outdoor', 'Indoor'],
    'Yoga': ['Vinyasa', 'Power', 'Hot', 'Yin', 'Restorative'],
    'Pilates': ['Mat', 'Reformer', 'Tower', 'Chair'],
    'Stair Climbing': ['StairMaster', 'Stair Stepper', 'Outdoor Stairs'],
    'Sports': [
      { name: 'Basketball', icon: '🏀' },
      { name: 'Soccer', icon: '⚽' },
      { name: 'Football', icon: '🏈' },
      { name: 'Tennis', icon: '🎾' },
      { name: 'Golf', icon: '⛳' },
      { name: 'Other', icon: '🏆' }
    ],
  };
  // All standard activity types show Count Toward selector (not "Other")
  const showFinishCountToward = workout?.type && workout.type !== 'Other';
  const sportEmojiMap = {
    'Basketball': '🏀', 'Soccer': '⚽', 'Football': '🏈',
    'Tennis': '🎾', 'Golf': '⛳', 'Other': '🏆'
  };

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
      setLinkedWorkout(null);
      setFinishSubtype(workout?.subtype || '');
      setFinishCountToward(workout?.countToward ?? getDefaultCountToward(workout?.type, workout?.subtype));
      setFinishSportEmoji(workout?.sportEmoji || null);
      setFinishStrengthType(workout?.strengthType || '');
      setFinishFocusAreas(normalizeFocusAreas(workout?.focusAreas || (workout?.focusArea ? [workout.focusArea] : [])));
      // Load contrast therapy fields if editing
      if (workout?.type === 'Contrast Therapy') {
        setContrastColdType(workout.coldType || 'Cold Plunge');
        setContrastHotType(workout.hotType || 'Sauna');
        setContrastColdMinutes(workout.coldDuration || 5);
        setContrastHotMinutes(workout.hotDuration || 10);
      }
      setShowDiscardConfirm(false);

      // Get current metrics from the live workout session (don't end it yet)
      const fetchMetrics = async () => {
        setIsLoadingMetrics(true);
        try {
          let hasData = false;

          // Try watch metrics first if this is a watch workout
          if (workout.source === 'watch') {
            try {
              const watchMetrics = await getWatchWorkoutMetrics();
              if (watchMetrics.isActive) {
                if (watchMetrics.calories > 0) {
                  setCalories(watchMetrics.calories.toString());
                  hasData = true;
                }
                if (watchMetrics.avgHeartRate > 0) {
                  setAvgHr(watchMetrics.avgHeartRate.toString());
                  hasData = true;
                }
                if (watchMetrics.maxHeartRate > 0) {
                  setMaxHr(watchMetrics.maxHeartRate.toString());
                  hasData = true;
                }
                // Distance comes in meters from watch — convert to miles
                if (watchMetrics.distance > 0) {
                  const distanceMiles = (watchMetrics.distance / 1609.34).toFixed(2);
                  setDistance(distanceMiles);
                  hasData = true;
                }
              }
            } catch (e) {
              console.log('[FinishModal] Watch metrics error:', e.message);
            }
          }

          // For phone workouts, get from live workout
          if (!hasData) {
            const liveResult = await getLiveWorkoutMetrics();
            if (liveResult.success && liveResult.isActive) {
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
              // Distance comes in meters — convert to miles
              if (liveResult.distance > 0) {
                const distanceMiles = (liveResult.distance / 1609.34).toFixed(2);
                setDistance(distanceMiles);
                hasData = true;
              }
            }
          }

          // If live workout didn't get data, fallback to querying HealthKit directly
          if (!hasData) {
            const endTime = new Date().toISOString();
            const result = await fetchWorkoutMetricsForTimeRange(workout.startTime, endTime);
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
      setLinkedWorkout(null);
      setLinkableWorkouts([]);
      setFinishSubtype('');
      setFinishCountToward(null);
      setFinishSportEmoji(null);
      setFinishStrengthType('');
      setFinishFocusArea('');
      setContrastColdType('Cold Plunge');
      setContrastHotType('Sauna');
      setContrastColdMinutes(5);
      setContrastHotMinutes(10);
      setShowDiscardConfirm(false);
    }
  }, [isOpen, workout?.startTime]);

  // Fetch linkable workouts from Apple Health when modal opens (skip for watch workouts)
  useEffect(() => {
    if (isOpen && workout?.startTime && workout?.source !== 'watch') {
      const fetchWorkouts = async () => {
        setIsLoadingWorkouts(true);
        try {
          const today = new Date();
          const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
          const workouts = await fetchLinkableWorkouts(dateStr, []);

          // Filter out already linked workouts
          const filteredWorkouts = workouts.filter(w =>
            !linkedWorkoutUUIDs.includes(w.healthKitUUID)
          );

          setLinkableWorkouts(filteredWorkouts);
        } catch (error) {
          setLinkableWorkouts([]);
        } finally {
          setIsLoadingWorkouts(false);
        }
      };

      fetchWorkouts();
    }
  }, [isOpen, workout?.startTime, linkedWorkoutUUIDs]);

  // Handle photo from library using Capacitor Camera
  const [isLoadingPhoto, setIsLoadingPhoto] = useState(false);

  const handleChooseFromLibrary = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        setIsLoadingPhoto(true);
        photoPickerActive = true;
        const image = await Camera.getPhoto({
          quality: 80,
          allowEditing: false,
          resultType: CameraResultType.Uri,
          source: CameraSource.Photos
        });
        photoPickerActive = false;

        if (image.path) {
          const webPath = Capacitor.convertFileSrc(image.path);
          setPhotoPreview(webPath);

          const response = await fetch(webPath);
          const blob = await response.blob();
          if (blob.size < 100) {
            setPhotoPreview(null);
            setIsLoadingPhoto(false);
            alert('Could not load this photo. If it\'s stored in iCloud, make sure it\'s downloaded to your device first.');
            return;
          }
          const file = new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' });
          setActivityPhoto(file);
        }
      } catch (error) {
        if (error.message !== 'User cancelled photos app') {
          alert('Could not load photo. Please try again or choose a different photo.');
        }
      } finally {
        photoPickerActive = false;
        setIsLoadingPhoto(false);
      }
    } else {
      fileInputRef.current?.click();
    }
  };

  // Handle photo from camera using Capacitor Camera
  const handleTakePhoto = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        setIsLoadingPhoto(true);
        photoPickerActive = true;
        const image = await Camera.getPhoto({
          quality: 80,
          allowEditing: false,
          resultType: CameraResultType.Uri,
          source: CameraSource.Camera
        });
        photoPickerActive = false;

        if (image.path) {
          const webPath = Capacitor.convertFileSrc(image.path);
          setPhotoPreview(webPath);

          const response = await fetch(webPath);
          const blob = await response.blob();
          if (blob.size < 100) {
            setPhotoPreview(null);
            setIsLoadingPhoto(false);
            alert('Could not load this photo. Please try again.');
            return;
          }
          const file = new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' });
          setActivityPhoto(file);
        }
      } catch (error) {
        if (error.message !== 'User cancelled photos app') {
          alert('Could not load photo. Please try again.');
        }
      } finally {
        photoPickerActive = false;
        setIsLoadingPhoto(false);
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

  // Prevent background page scrolling when modal is open.
  // Must use non-passive touchmove listener — React's onTouchMove is passive
  // and cannot call preventDefault() on iOS WKWebView.
  useEffect(() => {
    if (!isOpen) return;

    const handleTouchMove = (e) => {
      const scrollEl = scrollContentRef.current;
      // Allow scrolling inside the modal's scroll content area
      if (scrollEl && scrollEl.contains(e.target)) {
        // But prevent overscroll at top/bottom edges from leaking
        const { scrollTop, scrollHeight, clientHeight } = scrollEl;
        const atTop = scrollTop <= 0;
        const atBottom = scrollTop + clientHeight >= scrollHeight;
        const touchY = e.touches[0].clientY;

        if (!handleTouchMove._lastY) {
          handleTouchMove._lastY = touchY;
          return;
        }

        const delta = touchY - handleTouchMove._lastY;
        handleTouchMove._lastY = touchY;

        // Scrolling up at top or scrolling down at bottom — block
        if ((atTop && delta > 0) || (atBottom && delta < 0)) {
          e.preventDefault();
        }
        return;
      }
      // Block all touch movement outside the scroll area
      e.preventDefault();
    };

    const handleTouchStart = (e) => {
      handleTouchMove._lastY = e.touches[0]?.clientY;
    };

    const handleTouchEnd = () => {
      handleTouchMove._lastY = null;
    };

    const overlay = overlayRef.current;
    if (overlay) {
      overlay.addEventListener('touchmove', handleTouchMove, { passive: false });
      overlay.addEventListener('touchstart', handleTouchStart, { passive: true });
      overlay.addEventListener('touchend', handleTouchEnd, { passive: true });
    }

    return () => {
      if (overlay) {
        overlay.removeEventListener('touchmove', handleTouchMove);
        overlay.removeEventListener('touchstart', handleTouchStart);
        overlay.removeEventListener('touchend', handleTouchEnd);
      }
    };
  }, [isOpen]);

  if (!isOpen || !workout) return null;

  const finishCustomEmoji = finishSportEmoji || workout.customEmoji || workout.sportEmoji || null;
  const typeName = workout.type === 'Strength Training'
    ? (finishStrengthType || workout.strengthType || 'Strength')
    : workout.type;
  const effectiveFocusAreas = finishFocusAreas.length > 0 ? finishFocusAreas : (workout.focusAreas || (workout.focusArea ? [workout.focusArea] : []));
  const subtypeName = workout.type === 'Strength Training'
    ? effectiveFocusAreas.join(', ')
    : (finishSubtype || workout.subtype || '');

  const handleSave = () => {
    const endTime = new Date().toISOString();
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // Use linked workout data if available, otherwise use manual entry
    const finalCalories = linkedWorkout?.calories || (calories ? parseInt(calories) : undefined);
    const finalAvgHr = linkedWorkout?.avgHr || (avgHr ? parseInt(avgHr) : undefined);
    const finalMaxHr = linkedWorkout?.maxHr || (maxHr ? parseInt(maxHr) : undefined);
    const finalDistance = linkedWorkout?.distance || (distance ? parseFloat(distance) : undefined);
    const finalDuration = linkedWorkout?.duration || duration;

    // Use workout start time for the activity card time display
    const startTimeDisplay = workout.startTime
      ? new Date(workout.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      : new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    onSave({
      ...workout,
      date: dateStr,
      time: startTimeDisplay,
      duration: finalDuration,
      notes: notes || undefined,
      calories: finalCalories,
      avgHr: finalAvgHr,
      maxHr: finalMaxHr,
      distance: finalDistance,
      // Store exact timestamps for HealthKit
      startTime: workout.startTime,
      endTime,
      // Photo data
      photoFile: activityPhoto || undefined,
      isPhotoPrivate: activityPhoto ? isPhotoPrivate : undefined,
      // Link to Apple Health workout if selected
      linkedHealthKitUUID: linkedWorkout?.healthKitUUID || undefined,
      linkedHealthKitStartDate: linkedWorkout?.healthKitStartDate || undefined,
      // Updated subtype and countToward from finish modal pickers
      subtype: finishSubtype || workout.subtype,
      countToward: finishCountToward !== undefined ? finishCountToward : workout.countToward,
      // Updated sport emoji if sport was changed
      sportEmoji: finishSportEmoji || workout.sportEmoji,
      // Updated strength training fields
      strengthType: finishStrengthType || workout.strengthType,
      focusAreas: effectiveFocusAreas.length > 0 ? effectiveFocusAreas : undefined,
      focusArea: effectiveFocusAreas[0] || undefined,
    });
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg rounded-t-3xl overflow-hidden"
        style={{ backgroundColor: '#1A1A1A', maxHeight: '85vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800" style={{ touchAction: 'none' }}>
          <button
            onClick={onClose}
            className="text-gray-400 font-medium px-2 py-1"
          >
            Cancel
          </button>
          <h2 className="font-bold text-white">Save Workout</h2>
          <button
            onClick={handleSave}
            className="font-bold px-2 py-1"
            style={{ color: '#00FF94' }}
          >
            Save
          </button>
        </div>

        {/* Content */}
        <div ref={scrollContentRef} className="p-4 overflow-y-auto" style={{ maxHeight: 'calc(85vh - 60px)', overscrollBehavior: 'contain' }}>
          {/* Workout summary — compact inline header */}
          <div className="flex items-center gap-3 mb-4 pb-4 border-b border-white/10">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
              style={{ backgroundColor: 'rgba(0,255,148,0.1)' }}
            >
              {finishCustomEmoji || <ActivityIcon type={workout.type} subtype={workout.subtype} strengthType={finishStrengthType || workout.strengthType} sportEmoji={workout.sportEmoji} size={22} />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white truncate">
                {typeName}
                {subtypeName && <span className="text-gray-400 font-normal"> · {subtypeName}</span>}
              </div>
              <div className="text-lg font-bold" style={{ color: '#00FF94' }}>
                {formatDuration(linkedWorkout?.duration || duration)}
              </div>
            </div>
          </div>

          {/* Strength Training Pickers */}
          {workout?.type === 'Strength Training' && (
            <>
              <div className="mb-4">
                <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">Strength Type</label>
                <div className="flex flex-wrap gap-2">
                  {['Weightlifting', 'Bodyweight', 'Circuit'].map((st) => {
                    const isSelected = finishStrengthType === st;
                    return (
                      <button
                        key={st}
                        onClick={() => { setFinishStrengthType(st); triggerHaptic(ImpactStyle.Light); }}
                        className="px-3 py-1.5 rounded-full text-xs transition-all duration-200 flex items-center gap-1.5"
                        style={{
                          backgroundColor: isSelected ? 'rgba(0,255,148,0.2)' : 'rgba(255,255,255,0.05)',
                          border: isSelected ? '1px solid #00FF94' : '1px solid transparent',
                          color: isSelected ? '#00FF94' : 'white'
                        }}
                      >
                        <ActivityIcon type="Strength Training" strengthType={st} size={16} /> {st}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="mb-4">
                <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">Focus Areas</label>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(FOCUS_AREA_GROUPS).map(([groupName, members]) => {
                    const allSelected = members.every(m => finishFocusAreas.includes(m));
                    const someSelected = members.some(m => finishFocusAreas.includes(m));
                    return (
                      <div key={groupName} className="flex flex-col gap-1.5">
                        <button
                          onClick={() => {
                            const newAreas = allSelected
                              ? finishFocusAreas.filter(a => !members.includes(a))
                              : [...new Set([...finishFocusAreas, ...members])];
                            setFinishFocusAreas(newAreas);
                            triggerHaptic(ImpactStyle.Light);
                          }}
                          className="px-2 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 text-center"
                          style={{
                            backgroundColor: allSelected ? 'rgba(0,255,148,0.25)' : someSelected ? 'rgba(0,255,148,0.1)' : 'rgba(255,255,255,0.08)',
                            border: allSelected ? '1px solid #00FF94' : someSelected ? '1px solid rgba(0,255,148,0.4)' : '1px solid rgba(255,255,255,0.15)',
                            color: allSelected || someSelected ? '#00FF94' : 'rgba(255,255,255,0.7)'
                          }}
                        >
                          {groupName}
                        </button>
                        {members.map((area) => {
                          const isSelected = finishFocusAreas.includes(area);
                          return (
                            <button
                              key={area}
                              onClick={() => { setFinishFocusAreas(prev => prev.includes(area) ? prev.filter(a => a !== area) : [...prev, area]); triggerHaptic(ImpactStyle.Light); }}
                              className="px-2 py-1.5 rounded-lg text-xs transition-all duration-200 text-center"
                              style={{
                                backgroundColor: isSelected ? 'rgba(0,255,148,0.2)' : 'rgba(255,255,255,0.05)',
                                border: isSelected ? '1px solid #00FF94' : '1px solid transparent',
                                color: isSelected ? '#00FF94' : 'white'
                              }}
                            >
                              {area}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* Subtype Picker — for activities that have subtypes */}
          {workout?.type && subtypeOptions[workout.type] && (
            <div className="mb-4">
              <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">
                {workout.type === 'Sports' ? 'Sport' : `${workout.type} Type`}
              </label>
              <div className="flex flex-wrap gap-2">
                {subtypeOptions[workout.type].map((st) => {
                  const stName = typeof st === 'object' ? st.name : st;
                  const stIcon = typeof st === 'object' ? st.icon : null;
                  const isSelected = finishSubtype === stName;
                  return (
                    <button
                      key={stName}
                      onClick={() => {
                        setFinishSubtype(stName);
                        // Update sport emoji when changing sport
                        if (workout.type === 'Sports' && sportEmojiMap[stName]) {
                          setFinishSportEmoji(sportEmojiMap[stName]);
                        }
                        triggerHaptic(ImpactStyle.Light);
                      }}
                      className="px-3 py-1.5 rounded-full text-xs transition-all duration-200 flex items-center gap-1.5"
                      style={{
                        backgroundColor: isSelected ? 'rgba(0,255,148,0.2)' : 'rgba(255,255,255,0.05)',
                        border: isSelected ? '1px solid #00FF94' : '1px solid transparent',
                        color: isSelected ? '#00FF94' : 'white'
                      }}
                    >
                      {workout.type === 'Sports' ? <ActivityIcon type="Sports" subtype={stName} size={14} /> : stIcon ? <span>{stIcon}</span> : null}
                      {stName}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Count Toward — for all standard activity types */}
          {showFinishCountToward && (
            <div className="mb-4">
              <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">Count Toward</label>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    // Circuit: toggle strength in multi-select mode
                    if (finishCountToward === 'lifting+cardio') setFinishCountToward('cardio');
                    else if (finishCountToward === 'cardio') setFinishCountToward('lifting+cardio');
                    else setFinishCountToward('lifting');
                    triggerHaptic(ImpactStyle.Light);
                  }}
                  className="flex-1 p-2.5 rounded-xl text-xs font-medium transition-all duration-200 flex items-center justify-center gap-1.5"
                  style={{
                    backgroundColor: (finishCountToward === 'lifting' || finishCountToward === 'lifting+cardio') ? 'rgba(0,255,148,0.2)' : 'rgba(255,255,255,0.05)',
                    border: (finishCountToward === 'lifting' || finishCountToward === 'lifting+cardio') ? '1px solid #00FF94' : '1px solid transparent',
                    color: (finishCountToward === 'lifting' || finishCountToward === 'lifting+cardio') ? '#00FF94' : 'white'
                  }}
                >
                  <span>💪</span> Strength
                </button>
                <button
                  onClick={() => {
                    // Circuit: toggle cardio in multi-select mode
                    if (finishCountToward === 'lifting+cardio') setFinishCountToward('lifting');
                    else if (finishCountToward === 'lifting') setFinishCountToward('lifting+cardio');
                    else setFinishCountToward('cardio');
                    triggerHaptic(ImpactStyle.Light);
                  }}
                  className="flex-1 p-2.5 rounded-xl text-xs font-medium transition-all duration-200 flex items-center justify-center gap-1.5"
                  style={{
                    backgroundColor: (finishCountToward === 'cardio' || finishCountToward === 'lifting+cardio') ? 'rgba(255,149,0,0.2)' : 'rgba(255,255,255,0.05)',
                    border: (finishCountToward === 'cardio' || finishCountToward === 'lifting+cardio') ? '1px solid #FF9500' : '1px solid transparent',
                    color: (finishCountToward === 'cardio' || finishCountToward === 'lifting+cardio') ? '#FF9500' : 'white'
                  }}
                >
                  <span>❤️‍🔥</span> Cardio
                </button>
                <button
                  onClick={() => { setFinishCountToward('recovery'); triggerHaptic(ImpactStyle.Light); }}
                  className="flex-1 p-2.5 rounded-xl text-xs font-medium transition-all duration-200 flex items-center justify-center gap-1.5"
                  style={{
                    backgroundColor: finishCountToward === 'recovery' ? 'rgba(0,209,255,0.2)' : 'rgba(255,255,255,0.05)',
                    border: finishCountToward === 'recovery' ? '1px solid #00D1FF' : '1px solid transparent',
                    color: finishCountToward === 'recovery' ? '#00D1FF' : 'white'
                  }}
                >
                  <span>🧊</span> Recovery
                </button>
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => { setFinishCountToward('warmup'); triggerHaptic(ImpactStyle.Light); }}
                  className="flex-1 py-1.5 px-3 rounded-xl text-xs font-medium transition-all duration-200 flex items-center justify-center gap-1.5"
                  style={{
                    backgroundColor: finishCountToward === 'warmup' ? 'rgba(255,214,10,0.2)' : 'rgba(255,255,255,0.05)',
                    border: finishCountToward === 'warmup' ? '1px solid #FFD60A' : '1px solid transparent',
                    color: finishCountToward === 'warmup' ? '#FFD60A' : 'white'
                  }}
                >
                  <span>🔥</span> Warm Up
                </button>
                {workout?.type === 'Walking' && (
                  <button
                    onClick={() => { setFinishCountToward(null); triggerHaptic(ImpactStyle.Light); }}
                    className="flex-1 py-1.5 px-3 rounded-xl text-xs font-medium transition-all duration-200 flex items-center justify-center gap-1.5"
                    style={{
                      backgroundColor: finishCountToward === null ? 'rgba(128,128,128,0.2)' : 'rgba(255,255,255,0.05)',
                      border: finishCountToward === null ? '1px solid #808080' : '1px solid transparent',
                      color: finishCountToward === null ? '#B0B0B0' : 'white'
                    }}
                  >
                    <span>➖</span> Don't Count
                  </button>
                )}
              </div>
              {finishCountToward === 'lifting+cardio' && (
                <p className="text-[11px] text-gray-500 mt-2">
                  Circuit training combines resistance exercises with elevated heart rates, so it can count toward both strength and cardio goals.
                </p>
              )}
            </div>
          )}

          {/* Link Apple Health Workout Section (hidden for watch workouts) */}
          {workout?.source !== 'watch' && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="flex items-center text-cyan-400">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
              </span>
              <span className="text-sm font-medium text-white">Link Apple Health Workout</span>
            </div>

            {isLoadingWorkouts ? (
              <div className="p-4 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)', minHeight: '56px' }}>
                <div className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-xs text-gray-400">Looking for workouts...</span>
                </div>
              </div>
            ) : linkableWorkouts.length > 0 ? (
              <div className="space-y-2">
                {linkableWorkouts.slice(0, 5).map((w) => {
                  const isSelected = linkedWorkout?.healthKitUUID === w.healthKitUUID;
                  const workoutTime = w.time || '';
                  const workoutDuration = w.duration ? `${w.duration} min` : '';
                  const workoutCals = w.calories ? `${w.calories} cal` : '';

                  return (
                    <button
                      key={w.healthKitUUID}
                      onClick={() => {
                        if (isSelected) {
                          setLinkedWorkout(null);
                          // Clear metrics when unlinking
                          setCalories('');
                          setAvgHr('');
                          setMaxHr('');
                          setDistance('');
                        } else {
                          setLinkedWorkout(w);
                          // Auto-fill metrics from linked workout
                          if (w.calories) setCalories(w.calories.toString());
                          if (w.avgHr) setAvgHr(w.avgHr.toString());
                          if (w.maxHr) setMaxHr(w.maxHr.toString());
                          if (w.distance) setDistance(w.distance.toString());
                        }
                        triggerHaptic(ImpactStyle.Light);
                      }}
                      className="w-full p-2 rounded-xl text-left"
                      style={{
                        backgroundColor: isSelected ? 'rgba(0,255,148,0.15)' : 'rgba(255,255,255,0.05)',
                        border: isSelected ? '1px solid rgba(0,255,148,0.4)' : '1px solid rgba(255,255,255,0.1)'
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                            <ActivityIcon type={w.type} subtype={w.subtype} size={18} />
                          </div>
                          <div>
                            <div className="text-sm font-medium text-white">{w.type || 'Workout'}</div>
                            <div className="text-xs text-gray-500">
                              {workoutTime}{workoutDuration && ` • ${workoutDuration}`}{workoutCals && ` • ${workoutCals}`}
                            </div>
                          </div>
                        </div>
                        {isSelected && (
                          <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: '#00FF94' }}>
                            <svg className="w-4 h-4 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="p-4 rounded-xl" style={{ backgroundColor: 'rgba(255,193,7,0.1)', border: '1px solid rgba(255,193,7,0.2)' }}>
                <p className="text-xs text-yellow-500/90 text-center">
                  No matching workouts found in Apple Health yet. If you tracked with your watch, it may take a minute to sync.
                </p>
              </div>
            )}

            {linkedWorkout && (
              <div className="mt-2 p-2 rounded-lg" style={{ backgroundColor: 'rgba(0,255,148,0.1)' }}>
                <p className="text-xs text-center" style={{ color: '#00FF94' }}>
                  Stats from your tracker will be used for this workout
                </p>
              </div>
            )}
          </div>
          )}

          {/* Optional metrics */}
          <div className="space-y-4">
            <div className="text-sm text-gray-400 mb-2">{linkedWorkout ? 'Override Stats (optional)' : 'Add Stats Manually'}</div>

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

              {isLoadingPhoto ? (
                <div className="w-full h-48 rounded-xl bg-white/5 flex items-center justify-center">
                  <div className="w-8 h-8 border-2 border-gray-500 border-t-[#00FF94] rounded-full animate-spin" />
                </div>
              ) : photoPreview ? (
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

            {/* Discard Workout */}
            {onDiscard && (
              <div className="mt-6 pt-4 border-t border-white/10">
                {!showDiscardConfirm ? (
                  <button
                    onClick={() => { setShowDiscardConfirm(true); triggerHaptic(ImpactStyle.Light); }}
                    className="w-full py-3 rounded-xl text-sm font-medium text-red-400 transition-all duration-150"
                    style={{ backgroundColor: 'rgba(255,69,58,0.1)' }}
                  >
                    Discard Workout
                  </button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-400 text-center mb-2">This will cancel the workout without saving. Are you sure?</p>
                    <button
                      onClick={() => { onDiscard(); triggerHaptic(ImpactStyle.Heavy); }}
                      className="w-full py-3 rounded-xl text-sm font-bold text-red-400 transition-all duration-150"
                      style={{ backgroundColor: 'rgba(255,69,58,0.15)', border: '1px solid rgba(255,69,58,0.3)' }}
                    >
                      Yes, Discard Workout
                    </button>
                    <button
                      onClick={() => setShowDiscardConfirm(false)}
                      className="w-full py-2 text-sm text-gray-400"
                    >
                      Never mind
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Bottom spacing for comfortable scrolling */}
            <div className="pb-6" />
          </div>
        </div>
      </div>
    </div>
  );
};

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
      // Get scroll position from all possible sources and return the maximum
      // This ensures we don't incorrectly think we're at top when scrolled
      // The main scrolling container is the first child of root (the app div with overflow-y-auto)
      const rootScroll = root.scrollTop || 0;
      const windowScroll = window.pageYOffset || 0;
      const docScroll = document.documentElement.scrollTop || 0;
      const bodyScroll = document.body.scrollTop || 0;
      // Also check the first child of root which is the main app container
      const appContainer = root.firstElementChild;
      const appScroll = appContainer ? appContainer.scrollTop || 0 : 0;
      return Math.max(rootScroll, windowScroll, docScroll, bodyScroll, appScroll);
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

      // If already pulling, continue tracking - but cancel if we've scrolled away from top
      if (isPulling.current) {
        // Cancel pull if we've scrolled away from the top
        if (currentScrollTop > 10) {
          isPulling.current = false;
          globalIsPulling.current = false;
          pullDistanceRef.current = 0;
          setPullDistance(0);
          return;
        }

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
  const dismissBtnRef = useRef(null);

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

      // Check if touch was on the dismiss (X) button — don't trigger onTap
      const tappedDismiss = dismissBtnRef.current && dismissBtnRef.current.contains(e.target);

      if (currentSwipeY > 40) {
        // Swipe threshold reached - dismiss with slide down animation
        triggerHaptic(ImpactStyle.Light);
        setIsLeaving(true);
        setTimeout(() => {
          setIsVisible(false);
          setSwipeY(0);
          onDismiss && onDismiss();
        }, 300);
      } else if (wasTap && !tappedDismiss) {
        // This was a tap on the toast body - trigger onTap
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
          ref={dismissBtnRef}
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
const CelebrationOverlay = ({ show, onComplete, message = "Goal Complete!", type = "weekly" }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);

  // Different styles based on celebration type
  const isDaily = type === 'daily-steps' || type === 'daily-calories';
  const colorConfig = {
    'weekly': {
      primary: '#00FF94',
      bgGradient: 'radial-gradient(circle at center, rgba(0,255,148,0.15) 0%, transparent 70%)',
      ringColor1: 'rgba(0,255,148,0.3)',
      ringColor2: 'rgba(0,255,148,0.2)',
      emoji: '🎉',
      confettiColors: ['#00FF94', '#00D1FF', '#FF9500', '#BF5AF2', '#FFD700', '#FF453A'],
      subtext: 'Keep pushing!'
    },
    'strength': {
      primary: '#00FF94',
      bgGradient: 'radial-gradient(circle at center, rgba(0,255,148,0.45) 0%, rgba(0,255,148,0.15) 50%, transparent 80%)',
      bgOverlay: 'rgba(0,0,0,0.55)',
      ringColor1: 'rgba(0,255,148,0.5)',
      ringColor2: 'rgba(0,255,148,0.3)',
      emoji: '💪',
      confettiColors: ['#00FF94', '#00D1FF', '#FF9500', '#BF5AF2', '#FFD700', '#FF453A'],
      subtext: 'Keep pushing!'
    },
    'cardio': {
      primary: '#FF9500',
      bgGradient: 'radial-gradient(circle at center, rgba(255,149,0,0.45) 0%, rgba(255,149,0,0.15) 50%, transparent 80%)',
      bgOverlay: 'rgba(0,0,0,0.55)',
      ringColor1: 'rgba(255,149,0,0.5)',
      ringColor2: 'rgba(255,149,0,0.3)',
      emoji: '❤️‍🔥',
      confettiColors: ['#FF9500', '#FFD700', '#FF6B00', '#FFAB00', '#FFC107', '#FF453A'],
      subtext: 'Crushing it!'
    },
    'recovery': {
      primary: '#00D1FF',
      bgGradient: 'radial-gradient(circle at center, rgba(0,209,255,0.45) 0%, rgba(0,209,255,0.15) 50%, transparent 80%)',
      bgOverlay: 'rgba(0,0,0,0.55)',
      ringColor1: 'rgba(0,209,255,0.5)',
      ringColor2: 'rgba(0,209,255,0.3)',
      emoji: '🧊',
      confettiColors: ['#00D1FF', '#00FF94', '#87CEEB', '#4FC3F7', '#29B6F6', '#03A9F4'],
      subtext: 'Stay consistent!'
    },
    'daily-steps': {
      primary: '#00D1FF',
      bgGradient: 'radial-gradient(circle at center, rgba(0,209,255,0.2) 0%, transparent 70%)',
      ringColor1: 'rgba(0,209,255,0.3)',
      ringColor2: 'rgba(0,209,255,0.2)',
      emoji: '👟',
      confettiColors: ['#00D1FF', '#00FF94', '#87CEEB', '#4FC3F7', '#29B6F6', '#03A9F4'],
      subtext: 'Way to move!'
    },
    'daily-calories': {
      primary: '#FF9500',
      bgGradient: 'radial-gradient(circle at center, rgba(255,149,0,0.2) 0%, transparent 70%)',
      ringColor1: 'rgba(255,149,0,0.3)',
      ringColor2: 'rgba(255,149,0,0.2)',
      emoji: '🔥',
      confettiColors: ['#FF9500', '#FFD700', '#FF6B00', '#FFAB00', '#FFC107', '#FF453A'],
      subtext: 'Crushing it!'
    }
  };
  const config = colorConfig[type] || colorConfig['weekly'];

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
      {/* Dark overlay for better text contrast on category celebrations */}
      {config.bgOverlay && (
        <div className="absolute inset-0" style={{ backgroundColor: config.bgOverlay }} />
      )}
      {/* Background pulse */}
      <div
        className="absolute inset-0 animate-pulse-bg"
        style={{
          background: config.bgGradient
        }}
      />

      {/* Main content */}
      <div className="text-center animate-bounce-in relative z-10">
        {/* Pulsing ring behind emoji */}
        <div className="relative inline-block mb-4">
          <div className="absolute inset-0 rounded-full animate-ping-slow" style={{ backgroundColor: config.ringColor1, transform: 'scale(1.5)' }} />
          <div className="absolute inset-0 rounded-full animate-ping-slower" style={{ backgroundColor: config.ringColor2, transform: 'scale(2)' }} />
          <div className="text-6xl relative z-10 animate-wiggle">{config.emoji}</div>
        </div>
        <div className="text-2xl font-black animate-text-glow text-center" style={{ color: config.primary, whiteSpace: 'pre-line', '--glow-color': config.primary }}>{message}</div>
        <div className="text-gray-400 mt-2 animate-fade-in-delayed">{config.subtext}</div>
      </div>

      {/* Confetti particles - only for weekly celebrations */}
      {!isDaily && (
        <div className="absolute inset-0 overflow-hidden">
          {[...Array(20)].map((_, i) => (
            <div
              key={i}
              className="absolute animate-confetti"
              style={{
                width: `${6 + Math.random() * 8}px`,
                height: `${6 + Math.random() * 8}px`,
                borderRadius: Math.random() > 0.5 ? '50%' : '2px',
                backgroundColor: config.confettiColors[i % config.confettiColors.length],
                left: `${Math.random() * 100}%`,
                top: '-20px',
                animationDelay: `${Math.random() * 0.3}s`,
                animationDuration: `${1 + Math.random() * 0.8}s`
              }}
            />
          ))}
        </div>
      )}

      {/* Sparkles - only for weekly celebrations */}
      {!isDaily && (
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
      )}
      
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

// Week Streak Celebration Modal - Animated ring convergence celebration
const WeekStreakCelebration = ({ show, onClose, onShare, streakCount = 1, goals = {}, weekCounts = {} }) => {
  const [phase, setPhase] = useState('hidden'); // hidden, fadeIn, converge, burst, content, fadeOut
  const [ringStates, setRingStates] = useState([
    { animate: false, converged: false, hasAnimated: false },
    { animate: false, converged: false, hasAnimated: false },
    { animate: false, converged: false, hasAnimated: false }
  ]); // Strength, Cardio, Recovery
  const [showCheckmark, setShowCheckmark] = useState(false);
  const [showParticles, setShowParticles] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [showContent, setShowContent] = useState(false);
  const [particles, setParticles] = useState([]);
  const [confetti, setConfetti] = useState([]);

  const COLORS = {
    strength: '#00FF94',
    cardio: '#FF9500',
    recovery: '#00D1FF'
  };

  // Ring SVG component with CSS keyframe animation for stroke
  // hasAnimated: ring already animated and should stay filled (no animation)
  // animate: ring should start animating now
  const AnimatedRing = ({ animate, hasAnimated, color, size, strokeWidth, scale = 1 }) => {
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;

    // If already animated, show full ring without animation
    // If animate is true but not yet animated, play the animation
    // Otherwise show empty ring
    const shouldAnimate = animate && !hasAnimated;
    const isFilled = hasAnimated;

    return (
      <svg
        width={size}
        height={size}
        style={{
          overflow: 'visible',
          transform: `scale(${scale})`,
          transition: 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)'
        }}
      >
        <defs>
          <style>{`
            @keyframes fillRing-${color.replace('#', '')} {
              from {
                stroke-dashoffset: ${circumference};
              }
              to {
                stroke-dashoffset: 0;
              }
            }
          `}</style>
        </defs>
        {/* Background ring (dim outline) */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.15)"
          strokeWidth={strokeWidth}
        />
        {/* Animated progress ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={isFilled ? 0 : circumference}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{
            animation: shouldAnimate ? `fillRing-${color.replace('#', '')} 0.7s cubic-bezier(0.4, 0, 0.2, 1) forwards` : 'none',
            filter: `drop-shadow(0 0 8px ${color})`
          }}
        />
      </svg>
    );
  };

  // Generate particle burst (from center)
  const generateParticles = useCallback(() => {
    const newParticles = [];
    const colors = [COLORS.strength, COLORS.cardio, COLORS.recovery, '#FFD700', '#FF453A', '#BF5AF2'];

    for (let i = 0; i < 40; i++) {
      const angle = (i / 40) * Math.PI * 2;
      const velocity = 100 + Math.random() * 80;
      newParticles.push({
        id: i,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        color: colors[i % colors.length],
        size: 4 + Math.random() * 6,
        rotation: Math.random() * 360,
        isCircle: Math.random() > 0.5
      });
    }
    setParticles(newParticles);
  }, []);

  // Generate confetti (falling from top)
  const generateConfetti = useCallback(() => {
    const newConfetti = [];
    const colors = [COLORS.strength, COLORS.cardio, COLORS.recovery, '#FFD700', '#FF453A', '#BF5AF2', '#FFFFFF'];

    for (let i = 0; i < 50; i++) {
      newConfetti.push({
        id: i,
        x: Math.random() * 100, // percentage across screen
        delay: Math.random() * 0.5,
        duration: 2 + Math.random() * 1.5,
        color: colors[i % colors.length],
        size: 6 + Math.random() * 8,
        rotation: Math.random() * 360,
        isCircle: Math.random() > 0.6
      });
    }
    setConfetti(newConfetti);
  }, []);

  // Track timeout IDs so we can cancel them on skip
  const timeoutsRef = useRef([]);

  const addTimeout = useCallback((fn, delay) => {
    const id = setTimeout(fn, delay);
    timeoutsRef.current.push(id);
    return id;
  }, []);

  const clearAllTimeouts = useCallback(() => {
    timeoutsRef.current.forEach(id => clearTimeout(id));
    timeoutsRef.current = [];
  }, []);

  // Skip animation and jump to final content state
  const skipToContent = useCallback(() => {
    clearAllTimeouts();
    setPhase('content');
    setRingStates([
      { animate: false, converged: true, hasAnimated: true },
      { animate: false, converged: true, hasAnimated: true },
      { animate: false, converged: true, hasAnimated: true }
    ]);
    setShowCheckmark(true);
    setShowParticles(false); // Hide particles (they look glitchy when skipped)
    setShowContent(true);
    setShowConfetti(true);
    generateConfetti();
  }, [clearAllTimeouts, generateConfetti]);

  const handleClose = useCallback(() => {
    if (phase === 'fadeOut') return; // Prevent double-close
    clearAllTimeouts();
    setPhase('fadeOut');
    setTimeout(onClose, 300);
  }, [onClose, phase, clearAllTimeouts]);

  const handleShare = useCallback(() => {
    if (phase === 'fadeOut') return;
    clearAllTimeouts();
    setPhase('fadeOut');
    setTimeout(onShare, 300);
  }, [onShare, phase, clearAllTimeouts]);

  // Handle tap on the overlay — skip animation or close
  const handleOverlayTap = useCallback((e) => {
    // Don't intercept button clicks
    if (e.target.closest('button')) return;

    if (phase === 'content') {
      // Already showing content — close
      handleClose();
    } else if (phase !== 'hidden' && phase !== 'fadeOut') {
      // Mid-animation — skip to content
      skipToContent();
    }
  }, [phase, skipToContent, handleClose]);

  // Animation sequence
  useEffect(() => {
    if (show && phase === 'hidden') {
      setPhase('fadeIn');

      // Phase 1: Fade in background, then converge rings one at a time
      // Each ring fills (closes) as it moves to the center
      addTimeout(() => {
        setPhase('converge');

        // First: Recovery ring (rightmost) - fills and moves to center as innermost
        addTimeout(() => {
          setRingStates(prev => [
            prev[0],
            prev[1],
            { animate: true, converged: true, hasAnimated: false }
          ]);
          triggerHaptic(ImpactStyle.Light);
          // Mark as animated after animation completes
          addTimeout(() => {
            setRingStates(prev => [
              prev[0],
              prev[1],
              { ...prev[2], hasAnimated: true }
            ]);
          }, 700);
        }, 100);

        // Second: Cardio ring - fills and moves to center as middle ring
        addTimeout(() => {
          setRingStates(prev => [
            prev[0],
            { animate: true, converged: true, hasAnimated: false },
            prev[2]
          ]);
          triggerHaptic(ImpactStyle.Light);
          // Mark as animated after animation completes
          addTimeout(() => {
            setRingStates(prev => [
              prev[0],
              { ...prev[1], hasAnimated: true },
              prev[2]
            ]);
          }, 700);
        }, 900);

        // Third: Strength ring - fills and moves to center as outermost ring
        addTimeout(() => {
          setRingStates(prev => [
            { animate: true, converged: true, hasAnimated: false },
            prev[1],
            prev[2]
          ]);
          triggerHaptic(ImpactStyle.Heavy);
          // Mark as animated after animation completes
          addTimeout(() => {
            setRingStates(prev => [
              { ...prev[0], hasAnimated: true },
              prev[1],
              prev[2]
            ]);
          }, 700);
        }, 1700);

        // Phase 2: Show particle burst and checkmark
        addTimeout(() => {
          setPhase('burst');
          setShowParticles(true);
          generateParticles();
          setShowCheckmark(true);
          triggerHaptic(ImpactStyle.Medium);
        }, 2500);

        // Phase 3: Show content and confetti
        addTimeout(() => {
          setPhase('content');
          setShowContent(true);
          setShowConfetti(true);
          generateConfetti();
        }, 2900);

      }, 300);
    }
  }, [show, phase, generateParticles, generateConfetti, addTimeout]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => clearAllTimeouts();
  }, [clearAllTimeouts]);

  // Reset state when closed
  useEffect(() => {
    if (!show) {
      setTimeout(() => {
        setPhase('hidden');
        setRingStates([
          { animate: false, converged: false, hasAnimated: false },
          { animate: false, converged: false, hasAnimated: false },
          { animate: false, converged: false, hasAnimated: false }
        ]);
        setShowCheckmark(false);
        setShowParticles(false);
        setShowConfetti(false);
        setShowContent(false);
        setParticles([]);
        setConfetti([]);
      }, 300);
    }
  }, [show]);

  if (!show && phase === 'hidden') return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={handleOverlayTap}
      style={{
        backgroundColor: 'rgba(0,0,0,0.95)',
        opacity: phase === 'hidden' || phase === 'fadeOut' ? 0 : 1,
        transition: 'opacity 0.3s ease-out'
      }}
    >
      {/* Radial glow background */}
      <div
        className="absolute inset-0"
        style={{
          background: showContent
            ? 'radial-gradient(circle at center, rgba(255,215,0,0.15) 0%, rgba(0,255,148,0.08) 40%, transparent 70%)'
            : 'transparent',
          transition: 'background 0.5s ease-out'
        }}
      />

      {/* Particle burst */}
      {showParticles && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {particles.map((particle) => (
            <div
              key={particle.id}
              className="absolute"
              style={{
                left: '50%',
                top: '40%',
                width: particle.size,
                height: particle.size,
                borderRadius: particle.isCircle ? '50%' : '2px',
                backgroundColor: particle.color,
                transform: `translate(-50%, -50%) translate(${particle.vx}px, ${particle.vy}px) rotate(${particle.rotation}deg)`,
                opacity: 0,
                animation: 'particleBurst 1s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards'
              }}
            />
          ))}
        </div>
      )}

      {/* Confetti falling from top */}
      {showConfetti && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {confetti.map((piece) => (
            <div
              key={piece.id}
              className="absolute"
              style={{
                left: `${piece.x}%`,
                top: '-20px',
                width: piece.size,
                height: piece.isCircle ? piece.size : piece.size * 0.6,
                borderRadius: piece.isCircle ? '50%' : '2px',
                backgroundColor: piece.color,
                animation: `confettiFall ${piece.duration}s ease-out ${piece.delay}s forwards`,
                transform: `rotate(${piece.rotation}deg)`
              }}
            />
          ))}
        </div>
      )}

      {/* Rings container */}
      <div className="relative z-10 flex flex-col items-center">
        {/* Ring animation area */}
        <div
          className="relative flex items-center justify-center mb-3"
          style={{
            width: 240,
            height: 120,
            transition: 'all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
            animation: showContent ? 'floatRings 3s ease-in-out infinite' : 'none'
          }}
        >
          {/* Strength Ring (outer when converged) */}
          <div
            className="absolute"
            style={{
              transform: `translateX(${ringStates[0].converged ? 0 : -80}px)`,
              transition: 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
              zIndex: 1
            }}
          >
            <AnimatedRing
              animate={ringStates[0].animate}
              hasAnimated={ringStates[0].hasAnimated}
              color={COLORS.strength}
              size={100}
              strokeWidth={8}
              scale={1}
            />
          </div>

          {/* Cardio Ring (middle when converged) */}
          <div
            className="absolute"
            style={{
              transform: `translateX(0px)`,
              transition: 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
              zIndex: 2
            }}
          >
            <AnimatedRing
              animate={ringStates[1].animate}
              hasAnimated={ringStates[1].hasAnimated}
              color={COLORS.cardio}
              size={100}
              strokeWidth={8}
              scale={ringStates[1].converged ? 0.75 : 1}
            />
          </div>

          {/* Recovery Ring (inner when converged) */}
          <div
            className="absolute"
            style={{
              transform: `translateX(${ringStates[2].converged ? 0 : 80}px)`,
              transition: 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
              zIndex: 3
            }}
          >
            <AnimatedRing
              animate={ringStates[2].animate}
              hasAnimated={ringStates[2].hasAnimated}
              color={COLORS.recovery}
              size={100}
              strokeWidth={8}
              scale={ringStates[2].converged ? 0.5 : 1}
            />
          </div>

          {/* Checkmark */}
          {showCheckmark && (
            <div
              className="absolute z-10 flex items-center justify-center"
              style={{
                animation: 'checkmarkPop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards'
              }}
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                <path
                  d="M5 13l4 4L19 7"
                  stroke="#00FF94"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    strokeDasharray: 24,
                    strokeDashoffset: 24,
                    animation: 'checkmarkDraw 0.4s ease-out 0.1s forwards',
                    filter: 'drop-shadow(0 0 6px #00FF94)'
                  }}
                />
              </svg>
            </div>
          )}
        </div>

        {/* Content */}
        <div
          className="text-center"
          style={{
            opacity: showContent ? 1 : 0,
            transform: showContent ? 'translateY(0)' : 'translateY(20px)',
            transition: 'all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
            animation: showContent ? 'floatContent 3.5s ease-in-out infinite 0.2s' : 'none'
          }}
        >
          {/* Title */}
          <div
            className="text-3xl font-black mb-2"
            style={{
              background: 'linear-gradient(135deg, #FFD700 0%, #00FF94 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}
          >
            Week Complete!
          </div>

          {/* Streak count */}
          <div className="flex items-center justify-center gap-2 mb-4">
            <span className="text-2xl">🔥</span>
            <span className="text-xl font-bold text-white">{streakCount} Week Hybrid Streak</span>
          </div>

          {/* Goals summary */}
          <div className="flex items-center justify-center gap-6 mb-6">
            <div className="flex flex-col items-center">
              <div className="w-3 h-3 rounded-full mb-1" style={{ backgroundColor: COLORS.strength, boxShadow: `0 0 8px ${COLORS.strength}` }} />
              <span className="text-[11px] text-gray-400">Strength</span>
              <span className="text-base font-bold" style={{ color: COLORS.strength }}>
                {weekCounts.strength || 0}/{goals.liftsPerWeek || 3}
              </span>
            </div>
            <div className="flex flex-col items-center">
              <div className="w-3 h-3 rounded-full mb-1" style={{ backgroundColor: COLORS.cardio, boxShadow: `0 0 8px ${COLORS.cardio}` }} />
              <span className="text-[11px] text-gray-400">Cardio</span>
              <span className="text-base font-bold" style={{ color: COLORS.cardio }}>
                {weekCounts.cardio || 0}/{goals.cardioPerWeek || 3}
              </span>
            </div>
            <div className="flex flex-col items-center">
              <div className="w-3 h-3 rounded-full mb-1" style={{ backgroundColor: COLORS.recovery, boxShadow: `0 0 8px ${COLORS.recovery}` }} />
              <span className="text-[11px] text-gray-400">Recovery</span>
              <span className="text-base font-bold" style={{ color: COLORS.recovery }}>
                {weekCounts.recovery || 0}/{goals.recoveryPerWeek || 2}
              </span>
            </div>
          </div>

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

      {/* CSS Animations */}
      <style>{`
        @keyframes particleBurst {
          0% {
            transform: translate(-50%, -50%) translate(0, 0) rotate(0deg) scale(1);
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -50%) translate(var(--vx, 0), var(--vy, 0)) rotate(360deg) scale(0);
            opacity: 0;
          }
        }

        @keyframes confettiFall {
          0% {
            transform: translateY(0) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translateY(100vh) rotate(720deg);
            opacity: 0;
          }
        }

        @keyframes checkmarkPop {
          0% {
            transform: scale(0);
            opacity: 0;
          }
          50% {
            transform: scale(1.2);
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }

        @keyframes checkmarkDraw {
          to {
            stroke-dashoffset: 0;
          }
        }

        @keyframes floatRings {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-4px);
          }
        }

        @keyframes floatContent {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-3px);
          }
        }
      `}</style>
    </div>
  );
};

// Share Modal
const ShareModal = ({ isOpen, onClose, stats, weekRange, monthRange, onWeekChange, onMonthChange, isPro, onPresentPaywall }) => {
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

      const { toCanvas } = await import('html-to-image');
      // Temporarily reset transform and absolute positioning for clean capture
      const el = cardRef.current;
      const saved = {
        transform: el.style.transform,
        transformOrigin: el.style.transformOrigin,
        position: el.style.position || '',
        boxShadow: el.style.boxShadow,
        transition: el.style.transition || '',
        overflow: el.style.overflow || '',
        width: el.style.width,
        height: el.style.height,
      };
      el.style.transition = 'none';
      el.style.transform = 'none';
      el.style.transformOrigin = 'top left';
      el.style.position = 'relative';
      el.style.boxShadow = 'none';
      el.style.overflow = 'hidden';
      el.style.width = `${actualWidth}px`;
      el.style.height = `${actualHeight}px`;
      // Force reflow so browser applies style changes before capture
      el.getBoundingClientRect();

      let canvas;
      try {
        canvas = await toCanvas(el, {
          width: actualWidth,
          height: actualHeight,
          pixelRatio: 3,
          backgroundColor: '#0a0a0a',
          cacheBust: true,
          filter: (node) => {
            if (node.style) {
              node.style.animation = 'none';
              node.style.transition = 'none';
            }
            return true;
          },
        });
      } finally {
        el.style.transform = saved.transform;
        el.style.transformOrigin = saved.transformOrigin;
        el.style.position = saved.position;
        el.style.boxShadow = saved.boxShadow;
        el.style.transition = saved.transition;
        el.style.overflow = saved.overflow;
        el.style.width = saved.width;
        el.style.height = saved.height;
      }

      // Crop to exact card dimensions (remove any overflow from glow/shadow)
      const expectedW = actualWidth * 3;
      const expectedH = actualHeight * 3;
      if (canvas.width > expectedW || canvas.height > expectedH) {
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = expectedW;
        cropCanvas.height = expectedH;
        const cropCtx = cropCanvas.getContext('2d');
        cropCtx.drawImage(canvas, 0, 0, expectedW, expectedH, 0, 0, expectedW, expectedH);
        canvas = cropCanvas;
      }

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
    } catch (error) {
      console.error('[ShareModal] Export failed:', error);
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
        }
      }

      // Fallback: download the image
      const link = document.createElement('a');
      link.download = `dayseven-${cardType}-${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png', 1.0);
      link.click();
    } catch (error) {
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

  // Generate past weeks for the week picker (Sunday–Saturday)
  const weekOptions = useMemo(() => {
    const weeks = [];
    const today = new Date();
    const currentSunday = new Date(today);
    currentSunday.setDate(today.getDate() - today.getDay());
    for (let i = 0; i < 8; i++) {
      const start = new Date(currentSunday);
      start.setDate(currentSunday.getDate() - (i * 7));
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      const formatD = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      weeks.push({
        label: i === 0 ? `This Week (${formatD(start)} - ${formatD(end)})` : i === 1 ? `Last Week (${formatD(start)} - ${formatD(end)})` : `${formatD(start)} - ${formatD(end)}`,
        startDate: start,
        endDate: end,
      });
    }
    return weeks;
  }, []);

  // Generate past months for the month picker
  const monthOptions = useMemo(() => {
    const months = [];
    const today = new Date();
    for (let i = 0; i < 6; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0); // last day of month
      const label = i === 0 ? `This Month (${start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })})` : i === 1 ? `Last Month (${start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })})` : start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      months.push({ label, startDate: start, endDate: end });
    }
    return months;
  }, []);

  const selectedMonthValue = useMemo(() => {
    if (!monthRange?.startDate) return '0'; // default to this month
    const start = monthRange.startDate instanceof Date ? monthRange.startDate : new Date(monthRange.startDate + 'T12:00:00');
    for (let i = 0; i < monthOptions.length; i++) {
      const optStart = monthOptions[i].startDate;
      if (optStart.getFullYear() === start.getFullYear() && optStart.getMonth() === start.getMonth()) {
        return String(i);
      }
    }
    return '0';
  }, [monthRange, monthOptions]);

  // Get the value string for the current week selection (to match select option)
  const selectedWeekValue = useMemo(() => {
    if (!weekRange?.startDate) {
      // No explicit range — figure out which default applies
      const today = new Date();
      const day = today.getDay(); // 0=Sun
      return day <= 3 ? '1' : '0'; // Sun–Wed: last week, Thu–Sat: this week
    }
    const start = weekRange.startDate instanceof Date ? weekRange.startDate : new Date(weekRange.startDate + 'T12:00:00');
    // Find matching week option by comparing dates
    for (let i = 0; i < weekOptions.length; i++) {
      const optStart = weekOptions[i].startDate;
      if (optStart.getFullYear() === start.getFullYear() && optStart.getMonth() === start.getMonth() && optStart.getDate() === start.getDate()) {
        return String(i);
      }
    }
    return '0';
  }, [weekRange, weekOptions]);

  useEffect(() => {
    if (isOpen) {
      setIsClosing(false);
      setTimeout(() => setIsAnimating(true), 10);
      // Smart default: Sun–Wed → last week, Thu–Sat → this week
      if (!weekRange && onWeekChange) {
        const today = new Date();
        const day = today.getDay(); // 0=Sun
        if (day <= 3) {
          // Default to last week
          const lastSunday = new Date(today);
          lastSunday.setDate(today.getDate() - today.getDay() - 7);
          const lastSaturday = new Date(lastSunday);
          lastSaturday.setDate(lastSunday.getDate() + 6);
          onWeekChange({ startDate: lastSunday, endDate: lastSaturday });
        }
      }
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
    const formatDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    // Use provided week range if available
    if (weekRange?.startDate && weekRange?.endDate) {
      // weekRange dates might be Date objects or strings
      const start = weekRange.startDate instanceof Date
        ? weekRange.startDate
        : new Date(weekRange.startDate + 'T12:00:00');
      const end = weekRange.endDate instanceof Date
        ? weekRange.endDate
        : new Date(weekRange.endDate + 'T12:00:00');
      return `${formatDate(start)} - ${formatDate(end)}`;
    }

    // Default to current week (Sunday - Saturday)
    const today = new Date();
    const dayOfWeek = today.getDay();
    const sunday = new Date(today);
    sunday.setDate(today.getDate() - dayOfWeek);
    const saturday = new Date(sunday);
    saturday.setDate(sunday.getDate() + 6);
    return `${formatDate(sunday)} - ${formatDate(saturday)}`;
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

    // Determine effective category respecting countToward
    const getEffectiveCategory = (a) => {
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
      if (a.type === 'Walking') return 'other';
      if (['Cold Plunge', 'Sauna', 'Contrast Therapy', 'Massage', 'Chiropractic', 'Yoga', 'Pilates'].includes(a.type)) return 'recovery';
      return 'other';
    };

    // Count workouts (strength + cardio) vs recovery using effective category
    const workoutCounts = {};
    const recoveryCounts = {};
    const strengthCounts = {};
    const cardioCounts = {};
    const muscleGroupCounts = {};
    const upperBody = new Set(FOCUS_AREA_GROUPS['Upper Body']);
    const lowerBody = new Set(FOCUS_AREA_GROUPS['Lower Body']);
    activities.forEach(a => {
      const cat = getEffectiveCategory(a);
      if (cat === 'lifting') {
        const name = a.strengthType || a.subtype || 'Strength Training';
        strengthCounts[name] = (strengthCounts[name] || 0) + 1;
        workoutCounts[a.type] = (workoutCounts[a.type] || 0) + 1;
        // Count muscle groups for top focus areas
        const areas = normalizeFocusAreas(a.focusAreas || (a.focusArea ? [a.focusArea] : []));
        if (areas) areas.forEach(mg => { muscleGroupCounts[mg] = (muscleGroupCounts[mg] || 0) + 1; });
      } else if (cat === 'cardio') {
        cardioCounts[a.type] = (cardioCounts[a.type] || 0) + 1;
        workoutCounts[a.type] = (workoutCounts[a.type] || 0) + 1;
      } else if (cat === 'recovery') {
        recoveryCounts[a.type] = (recoveryCounts[a.type] || 0) + 1;
      }
    });

    // Top strength focus areas: top upper, top lower, abs can replace either if higher
    const sortedMuscles = Object.entries(muscleGroupCounts).sort((a, b) => b[1] - a[1]);
    const topUpper = sortedMuscles.find(([name]) => upperBody.has(name));
    const topLower = sortedMuscles.find(([name]) => lowerBody.has(name));
    const absEntry = muscleGroupCounts['Abs'] ? ['Abs', muscleGroupCounts['Abs']] : null;
    let topMuscles = [topUpper, topLower].filter(Boolean);
    if (absEntry && topMuscles.length === 2) {
      // Replace whichever has lower count if abs beats it
      const minIdx = topMuscles[0][1] <= topMuscles[1][1] ? 0 : 1;
      if (absEntry[1] > topMuscles[minIdx][1]) topMuscles[minIdx] = absEntry;
    } else if (absEntry && topMuscles.length < 2) {
      topMuscles.push(absEntry);
    }
    topMuscles.sort((a, b) => b[1] - a[1]);

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

    // Days worked out (only count days with strength/cardio activities)
    const workoutActivities = activities.filter(a => { const cat = getEffectiveCategory(a); return cat === 'lifting' || cat === 'cardio'; });
    const uniqueDays = new Set(workoutActivities.map(a => a.date)).size;

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
      totalWorkouts: activities.filter(a => { const cat = getEffectiveCategory(a); return cat === 'lifting' || cat === 'cardio'; }).length,
      topStrength: topMuscles.slice(0, 2),
      topCardio: Object.entries(cardioCounts).sort((a, b) => b[1] - a[1]).slice(0, 2),
      topRecovery: Object.entries(recoveryCounts).sort((a, b) => b[1] - a[1]).slice(0, 2),
    };
  };

  // Get activity emoji
  const getActivityEmoji = (type, size = 18) => {
    return <ActivityIcon type={type} size={size} />;
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
                    <span className={`${isPostFormat ? 'text-[11px]' : 'text-[11px]'} text-gray-400`}>💪 Most Lifts/Week</span>
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
                    <span className={`${isPostFormat ? 'text-[11px]' : 'text-[11px]'} text-gray-400`}>🔥 Most Calories/Workout</span>
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
              <DaySevenLogo gradient={['#FFD700', '#FFA500']} size="xs" />
              <div className="text-[8px] text-gray-600 tracking-widest uppercase -mt-0.5">Personal Bests</div>
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
        if (stats?.streak >= 2) achievements.push({ emoji: '🔥', text: `${stats.streak} week hybrid streak!` });
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
              className={`relative h-full flex flex-col ${isPostFormat ? 'pt-4 pb-6 px-4' : 'py-5 px-5 justify-center'}`}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              {/* Main content wrapper */}
              <div className={isPostFormat ? 'flex-1' : ''}>
              {/* Header */}
              <div className={`text-center ${isPostFormat ? '' : ''}`}>
                <div className={isPostFormat ? 'text-2xl' : 'text-3xl'} style={{ animation: 'pulse-glow 2s ease-in-out infinite' }}>📅</div>
                <div className={`${isPostFormat ? 'text-xs' : 'text-xs'} text-gray-500 uppercase tracking-wider mt-1.5`}>{getWeekDateRange()}</div>
                <div className={`font-black ${isPostFormat ? 'text-2xl' : 'text-2xl'}`} style={{ color: allGoalsMet ? colors.primary : 'white' }}>
                  {allGoalsMet ? 'Week Streaked!' : `${overallPercent}% Complete`}
                </div>
                <div className={`${isPostFormat ? 'text-xs' : 'text-xs'} text-gray-400 mt-0.5`}>{getMotivationalTagline(stats?.streak || 0, allGoalsMet)}</div>
              </div>

              {/* Content */}
              <div className={`${isPostFormat ? 'flex-none py-2' : 'flex-none pt-3 pb-2'} flex flex-col justify-center`}>
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
                      <div className="absolute inset-0 flex items-center justify-center" data-ring-text="true" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span className={`${isPostFormat ? 'text-sm' : 'text-sm'} font-black`} style={{ lineHeight: 1 }}>{weeklyLifts}/{liftsGoal}</span>
                      </div>
                    </div>
                    <div className={`${isPostFormat ? 'text-xs' : 'text-xs'} text-gray-400 mt-1`} style={{ lineHeight: '1.2', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px' }}><span style={{ fontSize: '0.9em' }}>💪</span><span>Strength</span></div>
                  </div>
                  <div className="flex flex-col items-center text-center">
                    <div className="relative">
                      <svg width={ringSize} height={ringSize} className="transform -rotate-90 block">
                        <circle cx={ringSize/2} cy={ringSize/2} r={ringRadius} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={ringStroke} />
                        <circle cx={ringSize/2} cy={ringSize/2} r={ringRadius} fill="none" stroke="#FF9500" strokeWidth={ringStroke} strokeLinecap="round"
                          strokeDasharray={ringCircumference} strokeDashoffset={ringCircumference - (cardioPercent / 100) * ringCircumference} />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center" data-ring-text="true" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span className={`${isPostFormat ? 'text-sm' : 'text-sm'} font-black`} style={{ lineHeight: 1 }}>{weeklyCardio}/{cardioGoal}</span>
                      </div>
                    </div>
                    <div className={`${isPostFormat ? 'text-xs' : 'text-xs'} text-gray-400 mt-1`} style={{ lineHeight: '1.2', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px' }}><span style={{ fontSize: '0.9em' }}>❤️‍🔥</span><span>Cardio</span></div>
                  </div>
                  <div className="flex flex-col items-center text-center">
                    <div className="relative">
                      <svg width={ringSize} height={ringSize} className="transform -rotate-90 block">
                        <circle cx={ringSize/2} cy={ringSize/2} r={ringRadius} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={ringStroke} />
                        <circle cx={ringSize/2} cy={ringSize/2} r={ringRadius} fill="none" stroke="#00D1FF" strokeWidth={ringStroke} strokeLinecap="round"
                          strokeDasharray={ringCircumference} strokeDashoffset={ringCircumference - (recoveryPercent / 100) * ringCircumference} />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center" data-ring-text="true" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span className={`${isPostFormat ? 'text-sm' : 'text-sm'} font-black`} style={{ lineHeight: 1 }}>{weeklyRecovery}/{recoveryGoal}</span>
                      </div>
                    </div>
                    <div className={`${isPostFormat ? 'text-xs' : 'text-xs'} text-gray-400 mt-1`} style={{ lineHeight: '1.2', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px' }}><span style={{ fontSize: '0.9em' }}>🧊</span><span>Recovery</span></div>
                  </div>
                </div>

                {/* Master Streak + Top Activities */}
                <div className={`w-full ${isPostFormat ? 'py-2 px-3' : 'py-3 px-4'} rounded-2xl`} style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                  <div className="w-full" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    <span className={isPostFormat ? 'text-lg' : 'text-xl'} style={{ lineHeight: '1.2' }}>🔥</span>
                    <span className={`${isPostFormat ? 'text-xl' : 'text-2xl'} font-black`} style={{ color: '#00FF94', lineHeight: '1.2' }}>{stats?.streak || 0}</span>
                    <span className={`${isPostFormat ? 'text-[11px]' : 'text-xs'} text-gray-400`} style={{ lineHeight: '1.2' }}>weeks hitting all goals</span>
                  </div>
                  {(() => {
                    const segments = [];
                    const strengthNames = (weeklyAnalysis?.topStrength || []).slice(0, 2).map(([name]) => name);
                    if (strengthNames.length > 0) segments.push({ text: strengthNames.join('/'), color: '#00FF94' });
                    const topCardioName = weeklyAnalysis?.topCardio?.[0]?.[0];
                    if (topCardioName) segments.push({ text: topCardioName, color: '#FF9500' });
                    const topRecoveryName = weeklyAnalysis?.topRecovery?.[0]?.[0];
                    if (topRecoveryName) segments.push({ text: topRecoveryName, color: '#00D1FF' });
                    return segments.length > 0 && (
                      <>
                        <div className={`w-full h-px ${isPostFormat ? 'my-1.5' : 'my-2'}`} style={{ backgroundColor: 'rgba(255,255,255,0.05)' }} />
                        <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500 uppercase tracking-wider text-center mb-1`}>Most Frequent</div>
                        <div className={`${isPostFormat ? 'text-[11px]' : 'text-xs'} text-center`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          {segments.map((seg, i) => (
                            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              {i > 0 && <span style={{ color: 'rgba(255,255,255,0.2)' }}>·</span>}
                              <span style={{ color: seg.color }}>{seg.text}</span>
                            </span>
                          ))}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Footer */}
              <div className="text-center mt-2">
                <DaySevenLogo gradient={['#00FF94', '#00D1FF']} size="xs" />
                <div className="text-[8px] text-gray-600 tracking-widest uppercase -mt-0.5">Weekly Recap</div>
              </div>
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
                  <div className={`${isPostFormat ? 'p-2' : 'p-2.5'} rounded-xl text-center flex flex-col justify-center`} style={{ backgroundColor: 'rgba(255,149,0,0.08)' }}>
                    <div className={`${isPostFormat ? 'text-[9px]' : 'text-[10px]'} text-gray-500 uppercase mb-0.5`}>Best Burn</div>
                    <div className={`${isPostFormat ? 'text-base' : 'text-lg'} flex justify-center`}>{getActivityEmoji(weeklyAnalysis.bestCalorieWorkout.type)}</div>
                    <div className={`${isPostFormat ? 'text-sm' : 'text-base'} font-black`} style={{ color: '#FF9500' }}>{parseInt(weeklyAnalysis.bestCalorieWorkout.calories).toLocaleString()}</div>
                    <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500`}>calories</div>
                  </div>
                )}
                {/* Longest distance or longest workout */}
                {weeklyAnalysis?.longestDistance && parseFloat(weeklyAnalysis.longestDistance.distance) > 0 ? (
                  <div className={`${isPostFormat ? 'p-2' : 'p-2.5'} rounded-xl text-center flex flex-col justify-center`} style={{ backgroundColor: 'rgba(0,209,255,0.08)' }}>
                    <div className={`${isPostFormat ? 'text-[9px]' : 'text-[10px]'} text-gray-500 uppercase mb-0.5`}>Furthest Distance</div>
                    <div className={`${isPostFormat ? 'text-base' : 'text-lg'} flex justify-center`}>{getActivityEmoji(weeklyAnalysis.longestDistance.type)}</div>
                    <div className={`${isPostFormat ? 'text-sm' : 'text-base'} font-black`} style={{ color: '#00D1FF' }}>{parseFloat(weeklyAnalysis.longestDistance.distance).toFixed(2)}</div>
                    <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500`}>miles</div>
                  </div>
                ) : weeklyAnalysis?.longestWorkout && (
                  <div className={`${isPostFormat ? 'p-2' : 'p-2.5'} rounded-xl text-center flex flex-col justify-center`} style={{ backgroundColor: 'rgba(0,255,148,0.08)' }}>
                    <div className={`${isPostFormat ? 'text-[9px]' : 'text-[10px]'} text-gray-500 uppercase mb-0.5`}>Longest Session</div>
                    <div className={`${isPostFormat ? 'text-base' : 'text-lg'} flex justify-center`}>{getActivityEmoji(weeklyAnalysis.longestWorkout.type)}</div>
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
                  weeklyPRs.push({ label: 'Highest Calorie Workout', value: parseInt(weeklyAnalysis.bestCalorieWorkout.calories).toLocaleString(), priority: 5 });
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

                // Sort by priority (highest first) and take top 2 to avoid overflow
                const sortedPRs = weeklyPRs.sort((a, b) => b.priority - a.priority);
                const topPRs = sortedPRs.slice(0, 2);
                const extraCount = sortedPRs.length - topPRs.length;

                return (
                  <div className="w-full">
                    <div className={`${isPostFormat ? 'text-[9px]' : 'text-[10px]'} text-gray-500 uppercase text-center mb-1`}>Records Set This Week</div>
                    <div className={`flex flex-wrap justify-center ${isPostFormat ? 'gap-1' : 'gap-1.5'}`}>
                      {topPRs.map((pr, i) => (
                        <div key={i} className={`${isPostFormat ? 'px-1.5 py-0.5' : 'px-2 py-0.5'} rounded-full ${isPostFormat ? 'text-[8px]' : 'text-[9px]'}`} style={{ backgroundColor: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.3)' }}>
                          <span style={{ color: '#FFD700' }}>🏆 {pr.label}: {pr.value}</span>
                        </div>
                      ))}
                      {extraCount > 0 && (
                        <div className={`${isPostFormat ? 'px-1.5 py-0.5' : 'px-2 py-0.5'} rounded-full ${isPostFormat ? 'text-[8px]' : 'text-[9px]'}`} style={{ backgroundColor: 'rgba(255,215,0,0.05)', border: '1px solid rgba(255,215,0,0.15)' }}>
                          <span style={{ color: 'rgba(255,215,0,0.6)' }}>+{extraCount} more</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="text-center mt-auto w-full">
              <DaySevenLogo gradient={['#00FF94', '#00D1FF']} size="xs" />
              <div className="text-[8px] text-gray-600 tracking-widest uppercase -mt-0.5">Week Highlights</div>
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
                <div className={`${isPostFormat ? 'text-[10px]' : 'text-xs'} font-semibold tracking-widest text-gray-400 uppercase mt-1`}>🔥 Hybrid Streak</div>
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
                    <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500`}>💪 weeks</div>
                  </div>
                  <div className="text-center">
                    <div className={`${isPostFormat ? 'text-sm' : 'text-base'} font-bold`} style={{ color: '#FF9500' }}>{stats?.cardioStreak || 0}</div>
                    <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500`}>❤️‍🔥 weeks</div>
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
                    <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500`}>💪 weeks</div>
                  </div>
                  <div className="text-center">
                    <div className={`${isPostFormat ? 'text-sm' : 'text-base'} font-bold`} style={{ color: '#FF9500' }}>{stats?.longestCardioStreak || 0}</div>
                    <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500`}>❤️‍🔥 weeks</div>
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
                <DaySevenLogo gradient={['#ffffff', '#888888']} size="xs" />
                <div className="text-[8px] text-gray-600 tracking-widest uppercase -mt-0.5">Streak Stats</div>
              </div>
            </div>
          </div>
        );

      case 'monthly':
        return (
          <div className={`relative h-full flex flex-col items-center ${isPostFormat ? 'py-3 px-3' : 'py-4 px-4'}`}>
            {/* Header with stats as subtext */}
            <div className="flex-1 flex flex-col justify-center w-full">
              <div className={`text-center ${isPostFormat ? 'mb-2' : 'mb-2.5'}`}>
                <div className={`${isPostFormat ? 'text-[9px]' : 'text-[10px]'} text-gray-500 uppercase tracking-wider`}>{stats?.shareMonthName || currentMonth} {stats?.shareMonthYear || currentYear}</div>
                <div className={`font-black ${isPostFormat ? 'text-xl' : 'text-2xl'}`} style={{ color: colors.primary, textShadow: `0 0 20px ${colors.glow}` }}>Monthly Recap</div>
                {/* Stats as subtext row */}
                <div className={`flex flex-wrap justify-center items-center ${isPostFormat ? 'gap-x-2 gap-y-0.5 mt-1.5' : 'gap-x-3 gap-y-1 mt-2'}`}>
                  <span className={`${isPostFormat ? 'text-[9px]' : 'text-[10px]'} text-gray-400`}>
                    🔥 {(stats?.monthlyCalories || 0).toLocaleString()} cal
                  </span>
                  <span className={`${isPostFormat ? 'text-[9px]' : 'text-[10px]'} text-gray-400`}>
                    🏃 {(stats?.monthlyMiles || 0).toFixed(1)} mi
                  </span>
                  <span className={`${isPostFormat ? 'text-[9px]' : 'text-[10px]'} text-gray-400`}>
                    👟 {((stats?.monthlySteps || 0) / 1000).toFixed(0)}k steps
                  </span>
                  <span className={`${isPostFormat ? 'text-[9px]' : 'text-[10px]'} text-gray-400`}>
                    📅 {stats?.monthlyDaysActive || 0} days active
                  </span>
                </div>
              </div>

              {/* Main content */}
              <div className={`w-full ${isPostFormat ? 'space-y-2' : 'space-y-2.5'}`}>
                {/* Total Sessions in grey box */}
                <div className={`${isPostFormat ? 'p-2' : 'p-2.5'} rounded-xl`} style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500 uppercase tracking-wider text-center mb-1.5`}>Total Sessions</div>
                  <div className="grid grid-cols-3 w-full">
                    <div className="text-center">
                      <div className={`${isPostFormat ? 'text-lg' : 'text-xl'} font-black`} style={{ color: '#00FF94' }}>{stats?.monthlyLifts || 0}</div>
                      <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500`}>💪 lift</div>
                    </div>
                    <div className="text-center">
                      <div className={`${isPostFormat ? 'text-lg' : 'text-xl'} font-black`} style={{ color: '#FF9500' }}>{stats?.monthlyCardio || 0}</div>
                      <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500`}>❤️‍🔥 cardio</div>
                    </div>
                    <div className="text-center">
                      <div className={`${isPostFormat ? 'text-lg' : 'text-xl'} font-black`} style={{ color: '#00D1FF' }}>{stats?.monthlyRecovery || 0}</div>
                      <div className={`${isPostFormat ? 'text-[8px]' : 'text-[9px]'} text-gray-500`}>❄️ recovery</div>
                    </div>
                  </div>

                  {/* Divider line */}
                  <div className={`border-t border-gray-700 ${isPostFormat ? 'my-1.5' : 'my-2'}`}></div>

                  {/* Most Frequent subsection */}
                  <div className={`${isPostFormat ? 'text-[7px]' : 'text-[8px]'} text-gray-500 uppercase tracking-wider text-center mb-1`}>Most Frequent</div>
                  <div className={`flex justify-center items-center ${isPostFormat ? 'gap-2' : 'gap-3'} text-center`}>
                    <span className={`${isPostFormat ? 'text-[9px]' : 'text-[10px]'}`} style={{ color: '#00FF94' }}>
                      {stats?.monthlyMostFrequentStrength || 'Full Body'}
                    </span>
                    <span style={{ color: 'rgba(255,255,255,0.2)' }}>·</span>
                    <span className={`${isPostFormat ? 'text-[9px]' : 'text-[10px]'}`} style={{ color: '#FF9500' }}>
                      {stats?.monthlyMostFrequentCardio || 'Running'}
                    </span>
                    <span style={{ color: 'rgba(255,255,255,0.2)' }}>·</span>
                    <span className={`${isPostFormat ? 'text-[9px]' : 'text-[10px]'}`} style={{ color: '#00D1FF' }}>
                      {stats?.monthlyMostFrequentRecovery?.type || 'Sauna'}
                    </span>
                  </div>
                </div>

                {/* Highlights Section - Best Burn, Longest Session, Furthest Distance */}
                <div className={`w-full grid grid-cols-3 ${isPostFormat ? 'gap-1' : 'gap-1.5'}`}>
                  {/* Best Burn */}
                  <div className={`${isPostFormat ? 'p-1' : 'p-1.5'} rounded-xl text-center`} style={{ backgroundColor: 'rgba(255,149,0,0.08)' }}>
                    <div className={`${isPostFormat ? 'text-[7px]' : 'text-[8px]'} text-gray-500 uppercase`}>Best Burn</div>
                    <div className={`${isPostFormat ? 'text-xs' : 'text-sm'} flex justify-center`}>{getActivityEmoji(stats?.monthlyHighestCalorieSession?.type, 14)}</div>
                    <div className={`${isPostFormat ? 'text-[10px]' : 'text-xs'} font-black`} style={{ color: '#FF9500' }}>{(stats?.monthlyHighestCalorieSession?.calories || 0).toLocaleString()}</div>
                    <div className={`${isPostFormat ? 'text-[7px]' : 'text-[8px]'} text-gray-500`}>cal</div>
                  </div>
                  {/* Longest Session */}
                  <div className={`${isPostFormat ? 'p-1' : 'p-1.5'} rounded-xl text-center`} style={{ backgroundColor: 'rgba(147,112,219,0.08)' }}>
                    <div className={`${isPostFormat ? 'text-[7px]' : 'text-[8px]'} text-gray-500 uppercase`}>Longest</div>
                    <div className={`${isPostFormat ? 'text-xs' : 'text-sm'} flex justify-center`}>{getActivityEmoji(stats?.monthlyLongestSession?.type, 14)}</div>
                    <div className={`${isPostFormat ? 'text-[10px]' : 'text-xs'} font-black`} style={{ color: '#9370DB' }}>{stats?.monthlyLongestSession?.duration || 0}</div>
                    <div className={`${isPostFormat ? 'text-[7px]' : 'text-[8px]'} text-gray-500`}>min</div>
                  </div>
                  {/* Furthest Distance */}
                  <div className={`${isPostFormat ? 'p-1' : 'p-1.5'} rounded-xl text-center`} style={{ backgroundColor: 'rgba(50,205,50,0.08)' }}>
                    <div className={`${isPostFormat ? 'text-[7px]' : 'text-[8px]'} text-gray-500 uppercase`}>Furthest</div>
                    <div className={`${isPostFormat ? 'text-xs' : 'text-sm'} flex justify-center`}>{getActivityEmoji(stats?.monthlyFurthestDistance?.type, 14)}</div>
                    <div className={`${isPostFormat ? 'text-[10px]' : 'text-xs'} font-black`} style={{ color: '#32CD32' }}>{(stats?.monthlyFurthestDistance?.distance || 0).toFixed(1)}</div>
                    <div className={`${isPostFormat ? 'text-[7px]' : 'text-[8px]'} text-gray-500`}>mi</div>
                  </div>
                </div>

                {/* Weeks Hitting All Goals - gold box */}
                <div className={`${isPostFormat ? 'p-2' : 'p-2.5'} rounded-xl flex items-center justify-center gap-2`} style={{ backgroundColor: 'rgba(255,215,0,0.1)' }}>
                  <span className={isPostFormat ? 'text-sm' : 'text-base'}>🏆</span>
                  <span className={`${isPostFormat ? 'text-xl' : 'text-2xl'} font-black`} style={{ color: '#FFD700' }}>
                    {stats?.monthAllGoalsWeeksHit || 0}/4
                  </span>
                  <span className={`${isPostFormat ? 'text-[9px]' : 'text-[10px]'} text-gray-400`}>weeks hitting all goals</span>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="text-center mt-auto w-full">
              <DaySevenLogo gradient={['#8B5CF6', '#06B6D4']} size="xs" />
              <div className="text-[8px] text-gray-600 tracking-widest uppercase -mt-0.5">Monthly Stats</div>
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
        {/* Week Picker - only show for weekly card type */}
        {cardType === 'weekly' && onWeekChange && (
          <div className="flex justify-center mb-2">
            <select
              value={selectedWeekValue}
              onChange={(e) => {
                const idx = parseInt(e.target.value);
                if (!isPro && idx > 1) {
                  e.target.value = selectedWeekValue; // revert
                  onPresentPaywall?.();
                  return;
                }
                const week = weekOptions[idx];
                onWeekChange({ startDate: week.startDate, endDate: week.endDate });
              }}
              className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs appearance-none cursor-pointer pr-7"
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.5)' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
            >
              {weekOptions.map((week, i) => (
                <option key={i} value={String(i)}>{week.label}{!isPro && i > 1 ? ' 🔒' : ''}</option>
              ))}
            </select>
          </div>
        )}

        {/* Month Picker - only show for monthly card type */}
        {cardType === 'monthly' && onMonthChange && (
          <div className="flex justify-center mb-2">
            <select
              value={selectedMonthValue}
              onChange={(e) => {
                const idx = parseInt(e.target.value);
                if (!isPro && idx > 1) {
                  e.target.value = selectedMonthValue; // revert
                  onPresentPaywall?.();
                  return;
                }
                const month = monthOptions[idx];
                onMonthChange({ startDate: month.startDate, endDate: month.endDate });
              }}
              className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs appearance-none cursor-pointer pr-7"
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.5)' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
            >
              {monthOptions.map((month, i) => (
                <option key={i} value={String(i)}>{month.label}{!isPro && i > 1 ? ' 🔒' : ''}</option>
              ))}
            </select>
          </div>
        )}

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

// ─── Activity Stamp Modal ─────────────────────────────────────────────────────
const ActivityStampModal = ({ isOpen, onClose, activity, weeklyProgress, routeCoords = [], getActivityCategory }) => {
  const cardRef = useRef(null);
  const [stampMode, setStampMode] = useState('dark'); // 'dark' or 'transparent'
  const [isSharing, setIsSharing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsClosing(false);
      requestAnimationFrame(() => setIsAnimating(true));
    } else {
      setIsAnimating(false);
    }
  }, [isOpen]);

  const handleClose = () => {
    setIsClosing(true);
    setIsAnimating(false);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 250);
  };

  if (!isOpen && !isClosing) return null;
  if (!activity) return null;

  const category = getActivityCategory(activity);
  const categoryColor = category === 'lifting' ? '#00FF94' : category === 'cardio' ? '#FF9500' : category === 'recovery' ? '#00D1FF' : '#9CA3AF';
  const isTransparent = stampMode === 'transparent';

  // Format duration
  const duration = activity.duration || 0;
  const durationStr = duration >= 60
    ? `${Math.floor(duration / 60)}h ${duration % 60}m`
    : `${duration}m`;

  // Format distance
  const distance = parseFloat(activity.distance) || 0;
  const hasDistance = distance > 0;
  const distanceStr = distance >= 10 ? distance.toFixed(1) : distance.toFixed(2);

  // Calculate pace (min/mi)
  const pace = hasDistance && duration > 0 ? duration / distance : 0;
  const paceMin = Math.floor(pace);
  const paceSec = Math.round((pace - paceMin) * 60);
  const paceStr = `${paceMin}:${String(paceSec).padStart(2, '0')}`;

  // Activity display name — strip body parts for strength (shown separately via muscle labels)
  const rawActivityName = activity.subtype && activity.subtype !== 'Indoor' && activity.subtype !== 'Outdoor'
    ? activity.subtype
    : activity.type === 'Strength Training'
      ? (activity.strengthType || 'Strength')
      : activity.type;
  // Remove " - Chest, Back, ..." suffix from strength names
  const activityName = rawActivityName.includes(' - ') ? rawActivityName.split(' - ')[0] : rawActivityName;

  // Determine the base type for ActivityIcon (e.g., 'Weightlifting', 'Running')
  const activityIconType = activity.type === 'Strength Training'
    ? (activity.strengthType?.split(' - ')[0] || 'Strength Training')
    : activity.type;

  // Format date
  const formatStampDate = (dateStr) => {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  // Muscle data for strength activities
  const getMuscleData = () => {
    const areas = activity.focusAreas || (activity.focusArea ? [activity.focusArea] : []);
    const data = {};
    areas.forEach(a => { data[a] = 1; });
    return data;
  };

  // Mini activity rings component
  const MiniRings = ({ size = 50 }) => {
    const rings = [
      { progress: weeklyProgress?.lifts ? Math.min(weeklyProgress.lifts.completed / weeklyProgress.lifts.goal, 1) : 0, color: '#00FF94', label: 'S' },
      { progress: weeklyProgress?.cardio ? Math.min(weeklyProgress.cardio.completed / weeklyProgress.cardio.goal, 1) : 0, color: '#FF9500', label: 'C' },
      { progress: weeklyProgress?.recovery ? Math.min(weeklyProgress.recovery.completed / weeklyProgress.recovery.goal, 1) : 0, color: '#00D1FF', label: 'R' },
    ];
    const cx = size / 2, cy = size / 2;
    const strokeWidth = 3.5;
    const gap = 4.5;

    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {rings.map((ring, i) => {
          const r = (size / 2) - strokeWidth / 2 - i * gap;
          const circumference = 2 * Math.PI * r;
          const offset = circumference * (1 - ring.progress);
          return (
            <g key={i}>
              <circle cx={cx} cy={cy} r={r} fill="none"
                stroke={isTransparent ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)'}
                strokeWidth={strokeWidth} />
              <circle cx={cx} cy={cy} r={r} fill="none"
                stroke={ring.color} strokeWidth={strokeWidth}
                strokeDasharray={circumference} strokeDashoffset={offset}
                strokeLinecap="round"
                transform={`rotate(-90 ${cx} ${cy})`}
                style={isTransparent ? { filter: `drop-shadow(0 0 3px ${ring.color})` } : {}} />
            </g>
          );
        })}
      </svg>
    );
  };

  // Static route map for stamp
  const StaticRouteMap = ({ coords, width, height, color, transparent }) => {
    if (!coords || coords.length < 2) return null;
    const fit = bestFit(coords, width, height, 20);
    const { tiles, pts } = makeTiles(coords, width, height, fit.z, fit.cp, true, 0);

    return (
      <div style={{ position: 'relative', width, height, overflow: 'hidden', borderRadius: 8 }}>
        {!transparent && tiles.map(t => (
          <img key={t.key} src={t.url} alt="" crossOrigin="anonymous" draggable={false}
            style={{ position: 'absolute', left: t.left, top: t.top, width: TILE, height: TILE, pointerEvents: 'none' }} />
        ))}
        {pts && pts.length >= 2 && (() => {
          const s = pts[0], e = pts[pts.length - 1];
          const d = pts.map(p => `${p.x},${p.y}`).join(' ');
          return (
            <svg width={width} height={height} style={{ position: 'absolute', top: 0, left: 0 }}>
              <polyline points={d} fill="none" stroke={transparent ? 'rgba(255,255,255,0.2)' : color}
                strokeWidth={transparent ? 4 : 6} strokeOpacity={transparent ? 1 : 0.35}
                strokeLinecap="round" strokeLinejoin="round" />
              <polyline points={d} fill="none" stroke={transparent ? 'rgba(255,255,255,0.8)' : color}
                strokeWidth={transparent ? 2 : 3} strokeLinecap="round" strokeLinejoin="round"
                style={transparent ? { filter: 'drop-shadow(0 0 4px rgba(255,255,255,0.4))' } : {}} />
              <circle cx={s.x} cy={s.y} r={4} fill="#00FF94" stroke="#fff" strokeWidth={1.5} />
              <circle cx={e.x} cy={e.y} r={4} fill={transparent ? '#fff' : color} stroke="#fff" strokeWidth={1.5} />
            </svg>
          );
        })()}
      </div>
    );
  };

  // Image generation using html-to-image (faithful browser rendering via SVG foreignObject)
  const generateStampImage = async () => {
    if (!cardRef.current) return null;
    try {
      const w = 270, h = 480;
      const scale = 3;
      const { toCanvas } = await import('html-to-image');
      const canvas = await toCanvas(cardRef.current, {
        width: w,
        height: h,
        pixelRatio: scale,
        backgroundColor: isTransparent ? null : '#0a0a0a',
        cacheBust: true,
        filter: (node) => {
          // Skip animations
          if (node.style) {
            node.style.animation = 'none';
            node.style.transition = 'none';
          }
          return true;
        },
      });

      // Apply rounded corners for dark mode
      if (!isTransparent) {
        const roundedCanvas = document.createElement('canvas');
        roundedCanvas.width = canvas.width;
        roundedCanvas.height = canvas.height;
        const ctx = roundedCanvas.getContext('2d');
        const radius = 16 * scale;
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
        ctx.drawImage(canvas, 0, 0);
        return roundedCanvas;
      }
      return canvas;
    } catch (error) {
      console.error('[StampExport] Failed:', error);
      return null;
    }
  };

  const handleSaveStamp = async () => {
    setIsSaving(true);
    try {
      const canvas = await generateStampImage();
      if (!canvas) { alert('Failed to generate image. Please try again.'); return; }
      const dataUrl = canvas.toDataURL('image/png', 1.0);
      if (Capacitor.isNativePlatform()) {
        try {
          const { Media } = await import('@capacitor-community/media');
          await Media.savePhoto({ path: dataUrl, albumIdentifier: undefined });
          triggerHaptic(ImpactStyle.Medium);
          return;
        } catch (e) { /* fall through */ }
      }
      const link = document.createElement('a');
      link.download = `dayseven-stamp-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
    } finally {
      setIsSaving(false);
    }
  };

  const handleShareStamp = async () => {
    setIsSharing(true);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    try {
      const canvas = await generateStampImage();
      if (!canvas) { alert('Failed to generate image. Please try again.'); setIsSharing(false); return; }
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png', 1.0));
      const file = new File([blob], `dayseven-stamp.png`, { type: 'image/png' });
      if (navigator.share) {
        try {
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file] });
            setIsSharing(false);
            return;
          }
          await navigator.share({ title: 'Day Seven', text: 'Check out my workout!' });
          const link = document.createElement('a');
          link.download = `dayseven-stamp-${Date.now()}.png`;
          link.href = canvas.toDataURL('image/png', 1.0);
          link.click();
          setIsSharing(false);
          return;
        } catch (e) {
          if (e.name === 'AbortError') { setIsSharing(false); return; }
        }
      }
      const link = document.createElement('a');
      link.download = `dayseven-stamp-${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png', 1.0);
      link.click();
    } catch (error) {
      alert('Failed to generate image. Please try again.');
    } finally {
      setIsSharing(false);
    }
  };

  // Text shadow for transparent mode
  const tShadow = isTransparent ? '0 1px 6px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.5)' : 'none';
  const textColor = '#fff';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        backgroundColor: 'rgba(0,0,0,0.85)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        opacity: isAnimating && !isClosing ? 1 : 0,
        transition: 'opacity 0.25s ease-out',
        padding: '20px 0',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      {/* Mode toggle */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 16, padding: 3,
        borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)',
      }}>
        <button
          onClick={() => setStampMode('dark')}
          style={{
            padding: '6px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            backgroundColor: stampMode === 'dark' ? 'rgba(255,255,255,0.15)' : 'transparent',
            color: stampMode === 'dark' ? '#fff' : 'rgba(255,255,255,0.5)',
            border: 'none', cursor: 'pointer',
          }}
        >
          Dark
        </button>
        <button
          onClick={() => setStampMode('transparent')}
          style={{
            padding: '6px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            backgroundColor: stampMode === 'transparent' ? 'rgba(255,255,255,0.15)' : 'transparent',
            color: stampMode === 'transparent' ? '#fff' : 'rgba(255,255,255,0.5)',
            border: 'none', cursor: 'pointer',
          }}
        >
          Overlay
        </button>
      </div>

      {/* Stamp Card Preview */}
      <div style={{
        width: 270, height: 480, borderRadius: 16, overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        ...(isTransparent ? {
          backgroundImage: `linear-gradient(45deg, #1a1a1a 25%, transparent 25%), linear-gradient(-45deg, #1a1a1a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1a1a1a 75%), linear-gradient(-45deg, transparent 75%, #1a1a1a 75%)`,
          backgroundSize: '16px 16px',
          backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
        } : {}),
      }}>
        {/* Actual stamp content captured by html-to-image */}
        <div
          ref={cardRef}
          style={{
            width: 270, height: 480,
            background: isTransparent ? 'transparent' : 'linear-gradient(180deg, #0a0a0a 0%, #0d0d0d 50%, #000000 100%)',
            display: 'flex', flexDirection: 'column',
            padding: isTransparent ? '0 16px 16px' : '24px 20px 16px',
            position: 'relative',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            justifyContent: isTransparent ? 'flex-end' : 'flex-start',
          }}
        >
          {isTransparent ? (
            /* ─── OVERLAY MODE: Strava-style minimal stats ─── */
            <>
              {/* Activity name with icon */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 5,
                fontSize: 12, fontWeight: 600, color: '#fff',
                textShadow: tShadow, marginBottom: 4, letterSpacing: '0.2px',
              }}>
                <div style={{
                  width: 20, height: 20, borderRadius: 5,
                  backgroundColor: category === 'lifting' ? 'rgba(0,255,148,0.2)' : category === 'cardio' ? 'rgba(255,149,0,0.2)' : 'rgba(0,209,255,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {category === 'lifting' ? <Dumbbell size={11} color="#00FF94" strokeWidth={2.5} /> :
                   category === 'cardio' ? <IconRun size={11} color="#FF9500" strokeWidth={2.5} /> :
                   <IconSnowflake size={11} color="#00D1FF" strokeWidth={2.5} />}
                </div>
                {activityName}
              </div>

              {/* Hero stat */}
              {category === 'cardio' && hasDistance ? (
                <div style={{ marginBottom: 2 }}>
                  <div style={{
                    fontSize: 32, fontWeight: 800, color: '#fff',
                    lineHeight: 1, letterSpacing: '-1.5px', textShadow: tShadow,
                  }}>
                    {distanceStr}
                  </div>
                  <div style={{
                    fontSize: 11, fontWeight: 600, color: '#fff',
                    textShadow: tShadow, letterSpacing: '1.5px', textTransform: 'uppercase', marginTop: 1,
                  }}>
                    miles
                  </div>
                </div>
              ) : category === 'lifting' && activity.calories > 0 ? (
                <div style={{ marginBottom: 2 }}>
                  <div style={{
                    fontSize: 32, fontWeight: 800, color: '#fff',
                    lineHeight: 1, letterSpacing: '-1px', textShadow: tShadow,
                  }}>
                    {activity.calories}
                  </div>
                  <div style={{
                    fontSize: 11, fontWeight: 600, color: '#fff',
                    textShadow: tShadow, letterSpacing: '1.5px', textTransform: 'uppercase', marginTop: 1,
                  }}>
                    calories
                  </div>
                </div>
              ) : (
                <div style={{ marginBottom: 2 }}>
                  <div style={{
                    fontSize: 32, fontWeight: 800, color: '#fff',
                    lineHeight: 1, letterSpacing: '-1px', textShadow: tShadow,
                  }}>
                    {durationStr}
                  </div>
                  <div style={{
                    fontSize: 11, fontWeight: 600, color: '#fff',
                    textShadow: tShadow, letterSpacing: '1.5px', textTransform: 'uppercase', marginTop: 1,
                  }}>
                    {category === 'recovery' && (activity.type === 'Cold Plunge' || activity.type === 'Sauna' || activity.type === 'Contrast Therapy') ? 'session' : 'duration'}
                  </div>
                </div>
              )}

              {/* Divider line */}
              <div style={{
                width: 40, height: 2, backgroundColor: 'rgba(255,255,255,0.6)',
                marginTop: 6, marginBottom: 8, borderRadius: 1,
              }} />

              {/* Secondary stats row */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 0,
                fontSize: 11, fontWeight: 600, color: '#fff',
                textShadow: tShadow, marginBottom: 10, flexWrap: 'wrap',
              }}>
                {category === 'cardio' && hasDistance && pace > 0 && (
                  <>
                    <span>{paceStr} /mi</span>
                    <span style={{ margin: '0 6px', opacity: 0.4 }}>·</span>
                  </>
                )}
                {category === 'cardio' && hasDistance && (
                  <>
                    <span>{durationStr}</span>
                    {activity.calories > 0 && <span style={{ margin: '0 6px', opacity: 0.4 }}>·</span>}
                  </>
                )}
                {/* Lifting: duration + muscle groups as secondary (calories is hero) */}
                {category === 'lifting' ? (
                  <>
                    <span>{durationStr}</span>
                    {(activity.focusAreas?.length > 0 || activity.focusArea) && (
                      <>
                        <span style={{ margin: '0 6px', opacity: 0.5 }}>·</span>
                        <span style={{ color: '#fff' }}>
                          {(activity.focusAreas || [activity.focusArea]).join(' · ')}
                        </span>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    {activity.calories > 0 && (
                      <span>{activity.calories} cal</span>
                    )}
                  </>
                )}
              </div>

              {/* Mini rings + fractions row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <MiniRings size={32} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  {weeklyProgress?.lifts && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <Dumbbell size={10} color="#00FF94" strokeWidth={2.5} />
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', textShadow: tShadow }}>
                        {weeklyProgress.lifts.completed}/{weeklyProgress.lifts.goal}
                      </span>
                    </div>
                  )}
                  {weeklyProgress?.cardio && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <IconRun size={10} color="#FF9500" strokeWidth={2.5} />
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', textShadow: tShadow }}>
                        {weeklyProgress.cardio.completed}/{weeklyProgress.cardio.goal}
                      </span>
                    </div>
                  )}
                  {weeklyProgress?.recovery && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <IconSnowflake size={10} color="#00D1FF" strokeWidth={2.5} />
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', textShadow: tShadow }}>
                        {weeklyProgress.recovery.completed}/{weeklyProgress.recovery.goal}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Brand */}
              <div style={{
                fontSize: 8, fontWeight: 700, color: '#fff',
                letterSpacing: '2px', textTransform: 'uppercase',
                textShadow: tShadow,
              }}>
                DAYSEVEN
              </div>
            </>
          ) : (
            /* ─── DARK CARD MODE ─── */
            <>
          {/* Top branding */}
          <div style={{
            fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.2)',
            letterSpacing: '2.5px', textTransform: 'uppercase', textAlign: 'center',
            marginBottom: 10,
          }}>
            DAYSEVEN
          </div>

          {/* Header: Icon + Activity Name + Date (centered as group) */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
              <div style={{
                width: 30, height: 30, borderRadius: 8,
                backgroundColor: `${categoryColor}15`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <ActivityIcon
                  type={activityIconType}
                  strengthType={activity.strengthType?.split(' - ')[0]}
                  subtype={activity.subtype}
                  customIcon={activity.customIcon}
                  sportEmoji={activity.sportEmoji}
                  customEmoji={activity.customEmoji}
                  size={16}
                  color={categoryColor}
                />
              </div>
              <div style={{
                fontSize: 16, fontWeight: 700, color: textColor, letterSpacing: '-0.3px',
                lineHeight: 1.2,
              }}>
                {activityName}
              </div>
            </div>
            <div style={{
              fontSize: 10, color: 'rgba(255,255,255,0.4)',
              letterSpacing: '0.3px', marginTop: 3, textAlign: 'center',
            }}>
              {formatStampDate(activity.date)}{activity.time ? ` • ${activity.time}` : ''}
            </div>
          </div>

          {/* Middle: Category-specific content */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8 }}>
            {/* Route map for activities with GPS data */}
            {routeCoords.length >= 2 && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>
                <StaticRouteMap
                  coords={routeCoords}
                  width={230}
                  height={140}
                  color={categoryColor}
                  transparent={isTransparent}
                />
              </div>
            )}

            {/* Big stat display for cardio/distance */}
            {category === 'cardio' && hasDistance && (
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  fontSize: 48, fontWeight: 800, color: textColor,
                  lineHeight: 1, letterSpacing: '-2px', textShadow: tShadow,
                }}>
                  {distanceStr}
                </div>
                <div style={{
                  fontSize: 14, fontWeight: 600, color: isTransparent ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.4)',
                  textShadow: tShadow, letterSpacing: '1px', textTransform: 'uppercase',
                }}>
                  miles
                </div>
              </div>
            )}

            {/* Stat row for cardio */}
            {category === 'cardio' && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 24 }}>
                {hasDistance && pace > 0 && (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: textColor, textShadow: tShadow }}>
                      {paceStr}
                    </div>
                    <div style={{
                      fontSize: 10, color: isTransparent ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.35)',
                      textShadow: tShadow, textTransform: 'uppercase', letterSpacing: '0.5px',
                    }}>
                      /mi pace
                    </div>
                  </div>
                )}
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: textColor, textShadow: tShadow }}>
                    {durationStr}
                  </div>
                  <div style={{
                    fontSize: 10, color: isTransparent ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.35)',
                    textShadow: tShadow, textTransform: 'uppercase', letterSpacing: '0.5px',
                  }}>
                    time
                  </div>
                </div>
                {activity.calories > 0 && (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: textColor, textShadow: tShadow }}>
                      {activity.calories}
                    </div>
                    <div style={{
                      fontSize: 10, color: isTransparent ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.35)',
                      textShadow: tShadow, textTransform: 'uppercase', letterSpacing: '0.5px',
                    }}>
                      cal
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Stats + muscle body map for strength */}
            {category === 'lifting' && (
              <>
                {/* Stats row — smaller, right under header */}
                <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginTop: -4 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: textColor, textShadow: tShadow, lineHeight: 1 }}>
                      {durationStr}
                    </div>
                    <div style={{
                      fontSize: 9, color: isTransparent ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.35)',
                      textShadow: tShadow, textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 2,
                    }}>
                      duration
                    </div>
                  </div>
                  {activity.calories > 0 && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 22, fontWeight: 800, color: textColor, textShadow: tShadow, lineHeight: 1 }}>
                        {activity.calories}
                      </div>
                      <div style={{
                        fontSize: 9, color: isTransparent ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.35)',
                        textShadow: tShadow, textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 2,
                      }}>
                        cal
                      </div>
                    </div>
                  )}
                </div>
                {/* Muscle body map (compact) + labels underneath feet */}
                {(activity.focusAreas?.length > 0 || activity.focusArea) && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, flex: 1, justifyContent: 'flex-start' }}>
                    <div style={{
                      opacity: isTransparent ? 0.85 : 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      marginTop: -8, marginBottom: -8,
                    }}>
                      <MuscleBodyMap muscleData={getMuscleData()} scale={0.62} hideLabels />
                    </div>
                    <div style={{
                      display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 4,
                      marginTop: 2,
                    }}>
                      {normalizeFocusAreas(activity.focusAreas || [activity.focusArea]).map(area => (
                        <span key={area} style={{
                          fontSize: 9, fontWeight: 600, color: '#00FF94',
                          padding: '2px 8px', borderRadius: 8,
                          backgroundColor: isTransparent ? 'rgba(0,255,148,0.15)' : 'rgba(0,255,148,0.1)',
                          textShadow: isTransparent ? '0 1px 3px rgba(0,0,0,0.5)' : 'none',
                        }}>
                          {area}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Recovery: Large duration + calming display */}
            {category === 'recovery' && (
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  fontSize: 48, fontWeight: 800, color: textColor,
                  lineHeight: 1, letterSpacing: '-2px', textShadow: tShadow,
                }}>
                  {durationStr}
                </div>
                <div style={{
                  fontSize: 14, fontWeight: 600, color: isTransparent ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.4)',
                  textShadow: tShadow, letterSpacing: '1px', textTransform: 'uppercase', marginTop: 4,
                }}>
                  {activity.type === 'Cold Plunge' || activity.type === 'Sauna' || activity.type === 'Contrast Therapy' ? 'session' : 'duration'}
                </div>
                {activity.calories > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: textColor, textShadow: tShadow }}>
                      {activity.calories}
                    </div>
                    <div style={{
                      fontSize: 10, color: isTransparent ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.35)',
                      textShadow: tShadow, textTransform: 'uppercase', letterSpacing: '0.5px',
                    }}>
                      calories
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Other category: Duration + calories */}
            {category !== 'cardio' && category !== 'lifting' && category !== 'recovery' && (
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  fontSize: 48, fontWeight: 800, color: textColor,
                  lineHeight: 1, letterSpacing: '-2px', textShadow: tShadow,
                }}>
                  {durationStr}
                </div>
                <div style={{
                  fontSize: 14, fontWeight: 600, color: isTransparent ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.4)',
                  textShadow: tShadow, letterSpacing: '1px', textTransform: 'uppercase', marginTop: 4,
                }}>
                  duration
                </div>
                {activity.calories > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: textColor, textShadow: tShadow }}>
                      {activity.calories}
                    </div>
                    <div style={{
                      fontSize: 10, color: isTransparent ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.35)',
                      textShadow: tShadow, textTransform: 'uppercase', letterSpacing: '0.5px',
                    }}>
                      calories
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Cardio without distance — show big duration */}
            {category === 'cardio' && !hasDistance && (
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  fontSize: 48, fontWeight: 800, color: textColor,
                  lineHeight: 1, letterSpacing: '-2px', textShadow: tShadow,
                }}>
                  {durationStr}
                </div>
                <div style={{
                  fontSize: 14, fontWeight: 600, color: isTransparent ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.4)',
                  textShadow: tShadow, letterSpacing: '1px', textTransform: 'uppercase', marginTop: 4,
                }}>
                  duration
                </div>
              </div>
            )}
          </div>

          {/* Footer: Rings + Category fractions with icons (centered row) */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginTop: 'auto', paddingTop: 0, gap: 10,
          }}>
            <MiniRings size={40} />
            <div>
              <div style={{
                fontSize: 9, color: isTransparent ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.35)',
                textShadow: tShadow, letterSpacing: '0.3px', marginBottom: 2,
              }}>
                This week
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                {weeklyProgress?.lifts && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <Dumbbell size={11} color="#00FF94" strokeWidth={2.5} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: isTransparent ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.5)', textShadow: tShadow }}>
                      {weeklyProgress.lifts.completed}/{weeklyProgress.lifts.goal}
                    </span>
                  </div>
                )}
                {weeklyProgress?.cardio && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <IconRun size={11} color="#FF9500" strokeWidth={2.5} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: isTransparent ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.5)', textShadow: tShadow }}>
                      {weeklyProgress.cardio.completed}/{weeklyProgress.cardio.goal}
                    </span>
                  </div>
                )}
                {weeklyProgress?.recovery && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <IconSnowflake size={11} color="#00D1FF" strokeWidth={2.5} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: isTransparent ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.5)', textShadow: tShadow }}>
                      {weeklyProgress.recovery.completed}/{weeklyProgress.recovery.goal}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Accent line at top */}
          <div style={{
            position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
            width: 40, height: 3, borderRadius: 2,
            backgroundColor: categoryColor, opacity: 0.6,
          }} />
            </>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: 12, marginTop: 20, width: 270 }}>
        <button
          onClick={handleSaveStamp}
          disabled={isSaving}
          style={{
            flex: 1, padding: '12px 0', borderRadius: 12, border: 'none',
            backgroundColor: 'rgba(255,255,255,0.1)', color: '#fff',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
            opacity: isSaving ? 0.5 : 1,
          }}
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={handleShareStamp}
          disabled={isSharing}
          style={{
            flex: 1, padding: '12px 0', borderRadius: 12, border: 'none',
            backgroundColor: categoryColor, color: '#000',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
            opacity: isSharing ? 0.5 : 1,
          }}
        >
          {isSharing ? 'Sharing...' : 'Share'}
        </button>
      </div>

      {/* Close button */}
      <button
        onClick={handleClose}
        style={{
          marginTop: 12, padding: '8px 24px', borderRadius: 8,
          backgroundColor: 'transparent', border: 'none',
          color: 'rgba(255,255,255,0.5)', fontSize: 14, fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        Close
      </button>
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

  // Detect provider reliably — on Capacitor, the web SDK's user.providerData may be empty,
  // so we use the Capacitor plugin's getCurrentUser() which has the correct providerData
  const [isEmailPasswordUser, setIsEmailPasswordUser] = useState(false);

  useEffect(() => {
    const detectProvider = async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
          const { user: nativeUser } = await FirebaseAuthentication.getCurrentUser();
          setIsEmailPasswordUser(!!nativeUser?.providerData?.some(p => p.providerId === 'password'));
        } catch {
          setIsEmailPasswordUser(!!user?.providerData?.some(p => p.providerId === 'password'));
        }
      } else {
        setIsEmailPasswordUser(!!user?.providerData?.some(p => p.providerId === 'password'));
      }
    };
    if (isOpen && user) detectProvider();
  }, [isOpen, user]);

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

      // For email/password users, re-authenticate with password first
      if (isEmailPasswordUser && password) {
        if (Capacitor.isNativePlatform()) {
          const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
          await FirebaseAuthentication.signInWithEmailAndPassword({
            email: user.email,
            password: password,
          });
        } else {
          const credential = EmailAuthProvider.credential(user.email, password);
          await reauthenticateWithCredential(auth.currentUser, credential);
        }
      }

      // Delete user data from Firestore
      await deleteUserAccount(user.uid, userProfile?.username);

      // Delete Firebase Auth account — try directly first, re-auth only if needed
      const deleteAuthAccount = async () => {
        if (Capacitor.isNativePlatform()) {
          const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
          await FirebaseAuthentication.deleteUser();
        } else {
          await auth.currentUser.delete();
        }
      };

      try {
        await deleteAuthAccount();
      } catch (authErr) {
        const code = authErr.code || authErr.message || '';
        if (code.includes('requires-recent-login')) {
          // Re-authenticate with the correct provider, then retry
          const isAppleUser = user?.providerData?.some(p => p.providerId === 'apple.com');
          const isGoogleUser = user?.providerData?.some(p => p.providerId === 'google.com');

          if (Capacitor.isNativePlatform()) {
            const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
            if (isEmailPasswordUser && password) {
              await FirebaseAuthentication.signInWithEmailAndPassword({
                email: user.email,
                password: password,
              });
            } else if (isAppleUser) {
              await FirebaseAuthentication.signInWithApple();
            } else if (isGoogleUser) {
              await FirebaseAuthentication.signInWithGoogle();
            }
          } else {
            if (isEmailPasswordUser && password) {
              const credential = EmailAuthProvider.credential(user.email, password);
              await reauthenticateWithCredential(auth.currentUser, credential);
            } else if (isAppleUser) {
              const { OAuthProvider, signInWithPopup } = await import('firebase/auth');
              const provider = new OAuthProvider('apple.com');
              await signInWithPopup(auth, provider);
            } else if (isGoogleUser) {
              const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
              const provider = new GoogleAuthProvider();
              await signInWithPopup(auth, provider);
            }
          }
          await deleteAuthAccount();
        } else {
          throw authErr;
        }
      }

      triggerHaptic(ImpactStyle.Heavy);
      onDeleteComplete();
    } catch (err) {
      const errorCode = err.code || err.message || '';
      if (errorCode.includes('wrong-password') || errorCode.includes('invalid-credential') || errorCode.includes('INVALID_LOGIN_CREDENTIALS')) {
        setError('Incorrect password. Please try again.');
      } else {
        console.error('[DeleteAccount] Error:', err);
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

// Smart Save Explanation Modal - shown once when the first walk is auto-saved
const SmartSaveExplainModal = ({ onClose, onDisable }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div
        className="mx-6 p-6 rounded-3xl max-w-sm w-full"
        style={{ backgroundColor: '#1a1a1a' }}
      >
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center" style={{ backgroundColor: 'rgba(0,255,148,0.1)' }}>
          <svg className="w-8 h-8" fill="none" stroke="#00FF94" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        </div>

        <h2 className="text-xl font-bold text-white text-center mb-2">
          Smart Save Active
        </h2>

        <p className="text-sm text-gray-400 text-center mb-4">
          Your casual walk was automatically saved to your history. Smart Save detects low-intensity walks based on your heart rate zones and saves them without notifications.
        </p>

        <div className="bg-zinc-800/50 rounded-xl p-3 mb-6">
          <p className="text-xs text-gray-500 mb-2">
            Walks are auto-saved when:
          </p>
          <ul className="text-xs text-gray-400 space-y-1">
            <li>• Heart rate is in Zone 1 (any duration)</li>
            <li>• Zone 2 walks under 40 minutes</li>
            <li>• Zone 3 walks under 15 minutes</li>
          </ul>
        </div>

        <div className="space-y-3">
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl font-semibold text-black"
            style={{ backgroundColor: '#00FF94' }}
          >
            Got It
          </button>
          <button
            onClick={onDisable}
            className="w-full py-3 rounded-xl font-medium text-gray-400"
            style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
          >
            Turn Off Smart Save
          </button>
        </div>
      </div>
    </div>
  );
};

// Onboarding Survey — Multi-step flow
const OnboardingSurvey = ({ onComplete, onCancel = null, currentGoals = null, currentPrivacy = null }) => {
  const isEditing = currentGoals !== null;
  const startStep = isEditing ? 5 : 1;
  const endStep = isEditing ? 6 : 7;
  const totalSteps = endStep - startStep + 1;

  const [currentStep, setCurrentStep] = useState(startStep);
  const [direction, setDirection] = useState('forward');

  // New onboarding fields
  const [fitnessGoal, setFitnessGoal] = useState(null);
  const [fitnessLevel, setFitnessLevel] = useState(null);
  const [favoriteRecovery, setFavoriteRecovery] = useState([]);
  const [wearable, setWearable] = useState(null);

  // Track whether user has manually changed goals (so we don't overwrite)
  const goalsManuallySet = useRef(false);

  // Smart defaults — explicit tables for full control per goal × level
  const smartDefaults = {
    beginner: {
      'shredded':     { liftsPerWeek: 3, cardioPerWeek: 2, recoveryPerWeek: 2, stepsPerDay: 8000,  caloriesPerDay: 400 },
      'faster':       { liftsPerWeek: 2, cardioPerWeek: 3, recoveryPerWeek: 2, stepsPerDay: 8000,  caloriesPerDay: 400 },
      'stronger':     { liftsPerWeek: 3, cardioPerWeek: 1, recoveryPerWeek: 2, stepsPerDay: 8000,  caloriesPerDay: 400 },
      'lose-weight':  { liftsPerWeek: 3, cardioPerWeek: 1, recoveryPerWeek: 2, stepsPerDay: 8000,  caloriesPerDay: 400 },
      'build-muscle': { liftsPerWeek: 3, cardioPerWeek: 1, recoveryPerWeek: 2, stepsPerDay: 8000,  caloriesPerDay: 400 },
    },
    intermediate: {
      'shredded':     { liftsPerWeek: 4, cardioPerWeek: 2, recoveryPerWeek: 2, stepsPerDay: 12000, caloriesPerDay: 750 },
      'faster':       { liftsPerWeek: 2, cardioPerWeek: 4, recoveryPerWeek: 2, stepsPerDay: 12000, caloriesPerDay: 600 },
      'stronger':     { liftsPerWeek: 4, cardioPerWeek: 1, recoveryPerWeek: 2, stepsPerDay: 8000,  caloriesPerDay: 600 },
      'lose-weight':  { liftsPerWeek: 3, cardioPerWeek: 2, recoveryPerWeek: 2, stepsPerDay: 12000, caloriesPerDay: 600 },
      'build-muscle': { liftsPerWeek: 4, cardioPerWeek: 1, recoveryPerWeek: 2, stepsPerDay: 8000,  caloriesPerDay: 750 },
    },
    advanced: {
      'shredded':     { liftsPerWeek: 4, cardioPerWeek: 3, recoveryPerWeek: 3, stepsPerDay: 12000, caloriesPerDay: 1000 },
      'faster':       { liftsPerWeek: 2, cardioPerWeek: 4, recoveryPerWeek: 3, stepsPerDay: 12000, caloriesPerDay: 850 },
      'stronger':     { liftsPerWeek: 4, cardioPerWeek: 2, recoveryPerWeek: 3, stepsPerDay: 12000, caloriesPerDay: 850 },
      'lose-weight':  { liftsPerWeek: 4, cardioPerWeek: 2, recoveryPerWeek: 3, stepsPerDay: 12000, caloriesPerDay: 850 },
      'build-muscle': { liftsPerWeek: 4, cardioPerWeek: 2, recoveryPerWeek: 2, stepsPerDay: 12000, caloriesPerDay: 1000 },
    },
  };
  const getSmartDefaults = (goal, level) => {
    return { ...(smartDefaults[level]?.[goal] || smartDefaults.intermediate.shredded) };
  };

  // Update goal defaults when fitness goal or level changes (only if user hasn't manually tweaked)
  useEffect(() => {
    if (fitnessGoal && fitnessLevel && !goalsManuallySet.current && !isEditing) {
      setGoals(getSmartDefaults(fitnessGoal, fitnessLevel));
    }
  }, [fitnessGoal, fitnessLevel]);

  // Goals (existing)
  const [goals, setGoals] = useState({
    liftsPerWeek: currentGoals?.liftsPerWeek ?? 3,
    cardioPerWeek: currentGoals?.cardioPerWeek ?? 2,
    recoveryPerWeek: currentGoals?.recoveryPerWeek ?? 2,
    stepsPerDay: currentGoals?.stepsPerDay ?? 10000,
    caloriesPerDay: currentGoals?.caloriesPerDay ?? 500
  });

  // Privacy (existing)
  const [privacy, setPrivacy] = useState({
    showInActivityFeed: currentPrivacy?.showInActivityFeed ?? true,
    showOnLeaderboard: currentPrivacy?.showOnLeaderboard ?? true
  });

  const canGoBack = currentStep > startStep;
  const goNext = () => { setDirection('forward'); setCurrentStep(s => s + 1); };
  const goBack = () => { setDirection('back'); setCurrentStep(s => s - 1); };

  // Check if current step can proceed
  const canContinue = (() => {
    switch (currentStep) {
      case 1: return fitnessGoal !== null;
      case 2: return fitnessLevel !== null;
      case 3: return favoriteRecovery.length > 0;
      case 4: return wearable !== null;
      case 5: return true; // goals have defaults
      case 6: return true; // goals have defaults
      case 7: return true; // privacy has defaults
      default: return true;
    }
  })();

  // Handle final submit
  const handleComplete = () => {
    onComplete(goals, isEditing ? undefined : privacy, isEditing ? undefined : { fitnessGoal, fitnessLevel, favoriteRecovery, wearable });
  };

  const isLastStep = currentStep === endStep;
  const progressIndex = currentStep - startStep;

  // Reusable press animation props
  const pressProps = {
    onTouchStart: (e) => { e.currentTarget.style.transform = 'scale(0.95)'; },
    onTouchEnd: (e) => { e.currentTarget.style.transform = 'scale(1)'; },
    onMouseDown: (e) => { e.currentTarget.style.transform = 'scale(0.95)'; },
    onMouseUp: (e) => { e.currentTarget.style.transform = 'scale(1)'; },
    onMouseLeave: (e) => { e.currentTarget.style.transform = 'scale(1)'; },
  };

  // Fitness goal options
  const fitnessGoalOptions = [
    { value: 'shredded', emoji: '\uD83D\uDD25', label: 'Getting Shredded' },
    { value: 'faster', emoji: '\u26A1', label: 'Getting Faster' },
    { value: 'stronger', emoji: '\uD83D\uDCAA', label: 'Getting Stronger' },
    { value: 'lose-weight', emoji: '\uD83C\uDFAF', label: 'Losing Weight' },
    { value: 'build-muscle', emoji: '\uD83C\uDFCB\uFE0F', label: 'Building Muscle' },
  ];

  // Fitness level options
  const fitnessLevelOptions = [
    { value: 'beginner', emoji: '\uD83C\uDF31', label: 'Just Starting Out', desc: 'New to fitness or getting back after a long break' },
    { value: 'intermediate', emoji: '\uD83D\uDD04', label: 'Getting Consistent', desc: 'Been training for a while, building habits' },
    { value: 'advanced', emoji: '\uD83D\uDE80', label: 'Experienced', desc: 'Training regularly for 5+ years' },
  ];

  // Favorite recovery options
  const recoveryOptions = [
    { value: 'cold-plunge', emoji: '\uD83E\uDDCA', label: 'Cold Plunge' },
    { value: 'sauna', emoji: '\uD83D\uDD25', label: 'Sauna' },
    { value: 'yoga-pilates', emoji: '\uD83E\uDDD8', label: 'Yoga / Pilates' },
    { value: 'meditation', emoji: '\uD83E\uDDE0', label: 'Meditation' },
    { value: 'massage', emoji: '\uD83D\uDC86', label: 'Massage / Bodywork' },
    { value: 'stretching', emoji: '\uD83E\uDD38', label: 'Stretching / Mobility' },
  ];

  // Wearable icon helper
  const getWearableIcon = (value, selected) => {
    const c = selected ? '#00FF94' : '#999';
    switch(value) {
      case 'apple-watch':
        return (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <rect x="7" y="1" width="10" height="3" rx="1" fill={c} opacity="0.4"/>
            <rect x="7" y="20" width="10" height="3" rx="1" fill={c} opacity="0.4"/>
            <rect x="5" y="3.5" width="14" height="17" rx="4" stroke={c} strokeWidth="1.5"/>
            <circle cx="12" cy="12" r="3.5" stroke={c} strokeWidth="1.2"/>
            <line x1="12" y1="12" x2="12" y2="9.5" stroke={c} strokeWidth="1.2" strokeLinecap="round"/>
            <line x1="12" y1="12" x2="14" y2="12" stroke={c} strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        );
      case 'garmin':
        return (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke={c} strokeWidth="1.5"/>
            <path d="M12 5L12 12L17 12" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M12 3v1.5M12 19.5v1.5M3 12h1.5M19.5 12h1.5" stroke={c} strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        );
      case 'fitbit':
        return (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <ellipse cx="12" cy="6.5" rx="2" ry="2.2" fill={c}/>
            <ellipse cx="12" cy="12" rx="2.5" ry="2.8" fill={c}/>
            <ellipse cx="12" cy="17.5" rx="2" ry="2.2" fill={c}/>
            <ellipse cx="17" cy="9.5" rx="1.3" ry="1.5" fill={c} opacity="0.5"/>
            <ellipse cx="17" cy="14.5" rx="1.3" ry="1.5" fill={c} opacity="0.5"/>
            <ellipse cx="7" cy="9.5" rx="1.3" ry="1.5" fill={c} opacity="0.5"/>
            <ellipse cx="7" cy="14.5" rx="1.3" ry="1.5" fill={c} opacity="0.5"/>
          </svg>
        );
      case 'whoop':
        return (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <rect x="2" y="8" width="20" height="8" rx="4" stroke={c} strokeWidth="1.5"/>
            <rect x="8" y="10" width="8" height="4" rx="2" fill={c} opacity="0.3"/>
            <circle cx="12" cy="12" r="1.5" fill={c}/>
          </svg>
        );
      case 'samsung':
        return (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke={c} strokeWidth="1.5"/>
            <circle cx="12" cy="12" r="6.5" stroke={c} strokeWidth="0.8" opacity="0.4"/>
            <path d="M12 5.5a6.5 6.5 0 0 1 4.5 11.2" stroke={c} strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        );
      case 'other':
        return (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <rect x="6" y="2" width="12" height="20" rx="3" stroke={c} strokeWidth="1.5"/>
            <line x1="9" y1="19" x2="15" y2="19" stroke={c} strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        );
      case 'none':
        return (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <line x1="6" y1="6" x2="18" y2="18" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round"/>
            <line x1="18" y1="6" x2="6" y2="18" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
        );
      default:
        return null;
    }
  };

  // Wearable options
  const wearableOptions = [
    { value: 'apple-watch', label: 'Apple Watch' },
    { value: 'garmin', label: 'Garmin' },
    { value: 'fitbit', label: 'Fitbit' },
    { value: 'whoop', label: 'WHOOP' },
    { value: 'samsung', label: 'Samsung Galaxy' },
    { value: 'other', label: 'Other' },
    { value: 'none', label: 'No Wearable' },
  ];

  // Goal selector row component
  const GoalSelector = ({ label, subtitle, color, goalKey, options, isSteps, isCalories, isScrollable }) => (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
        <label className="text-sm font-semibold">{label}</label>
      </div>
      {subtitle && <p className="text-xs text-gray-500 mb-2 ml-4">{subtitle}</p>}
      <div
        className={`flex gap-2 ${isScrollable ? 'overflow-x-auto pb-2 -mx-6 px-6' : ''}`}
        style={isScrollable ? { WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', msOverflowStyle: 'none', touchAction: 'pan-x' } : {}}
      >
        {options.map((option) => {
          const isActive = goals[goalKey] === option;
          const Tag = isScrollable ? 'div' : 'button';
          return (
            <Tag
              key={option}
              onClick={() => { goalsManuallySet.current = true; setGoals({ ...goals, [goalKey]: option }); }}
              className={`py-3 rounded-xl text-center border-2 select-none ${isScrollable ? 'flex-shrink-0 px-4 min-w-[70px] cursor-pointer' : 'flex-1 transition-all duration-200'}`}
              style={{
                backgroundColor: isActive ? `${color}25` : 'rgba(255,255,255,0.05)',
                borderColor: isActive ? color : 'transparent',
                ...(isScrollable ? {} : { transform: 'scale(1)' })
              }}
              {...(isScrollable ? {} : pressProps)}
            >
              <span className="font-bold" style={{ color: isActive ? color : 'white' }}>
                {isSteps ? `${option/1000}k` : `${option}`}
              </span>
            </Tag>
          );
        })}
      </div>
    </div>
  );

  // Render step content
  const renderStep = () => {
    switch (currentStep) {
      // Step 1: Fitness Goal
      case 1:
        return (
          <div className="space-y-3">
            <h2 className="text-2xl font-bold mb-1">What's your main fitness goal?</h2>
            <p className="text-gray-500 text-sm mb-6">This helps us personalize your experience.</p>
            {fitnessGoalOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFitnessGoal(opt.value)}
                className="w-full p-4 rounded-2xl text-left transition-all duration-200 border-2 flex items-center gap-4"
                style={{
                  backgroundColor: fitnessGoal === opt.value ? 'rgba(0,255,148,0.1)' : 'rgba(255,255,255,0.04)',
                  borderColor: fitnessGoal === opt.value ? '#00FF94' : 'rgba(255,255,255,0.08)',
                  transform: 'scale(1)'
                }}
                {...pressProps}
              >
                <span className="text-2xl">{opt.emoji}</span>
                <span className="font-semibold text-[15px]" style={{ color: fitnessGoal === opt.value ? '#00FF94' : 'white' }}>
                  {opt.label}
                </span>
              </button>
            ))}
          </div>
        );

      // Step 2: Fitness Level
      case 2:
        return (
          <div className="space-y-3">
            <h2 className="text-2xl font-bold mb-1">Where are you in your journey?</h2>
            <p className="text-gray-500 text-sm mb-6">This helps us suggest the right goals for you.</p>
            {fitnessLevelOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFitnessLevel(opt.value)}
                className="w-full p-5 rounded-2xl text-left transition-all duration-200 border-2 flex items-center gap-4"
                style={{
                  backgroundColor: fitnessLevel === opt.value ? 'rgba(0,255,148,0.1)' : 'rgba(255,255,255,0.04)',
                  borderColor: fitnessLevel === opt.value ? '#00FF94' : 'rgba(255,255,255,0.08)',
                  transform: 'scale(1)'
                }}
                {...pressProps}
              >
                <span className="text-2xl">{opt.emoji}</span>
                <div>
                  <span className="font-semibold text-[15px] block" style={{ color: fitnessLevel === opt.value ? '#00FF94' : 'white' }}>
                    {opt.label}
                  </span>
                  <span className="text-xs text-gray-500 mt-0.5 block">{opt.desc}</span>
                </div>
              </button>
            ))}
          </div>
        );

      // Step 3: Favorite Recovery (multi-select)
      case 3:
        return (
          <div className="space-y-3">
            <h2 className="text-2xl font-bold mb-1">What's your favorite type of recovery?</h2>
            <p className="text-gray-500 text-sm mb-6">Select all that apply — we all recover differently.</p>
            {recoveryOptions.map((opt) => {
              const isSelected = favoriteRecovery.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  onClick={() => setFavoriteRecovery(prev =>
                    prev.includes(opt.value)
                      ? prev.filter(v => v !== opt.value)
                      : [...prev, opt.value]
                  )}
                  className="w-full p-4 rounded-2xl text-left transition-all duration-200 border-2 flex items-center gap-4"
                  style={{
                    backgroundColor: isSelected ? 'rgba(0,255,148,0.1)' : 'rgba(255,255,255,0.04)',
                    borderColor: isSelected ? '#00FF94' : 'rgba(255,255,255,0.08)',
                    transform: 'scale(1)'
                  }}
                  {...pressProps}
                >
                  <span className="text-2xl">{opt.emoji}</span>
                  <span className="font-semibold text-[15px]" style={{ color: isSelected ? '#00FF94' : 'white' }}>
                    {opt.label}
                  </span>
                </button>
              );
            })}
          </div>
        );

      // Step 4: Wearable Device
      case 4:
        return (
          <div>
            <h2 className="text-2xl font-bold mb-1">Do you use a wearable to track workouts?</h2>
            <p className="text-gray-500 text-sm mb-6">We'll optimize your experience accordingly.</p>
            <div className="grid grid-cols-2 gap-3">
              {wearableOptions.map((opt) => {
                const isSelected = wearable === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setWearable(opt.value)}
                    className={`p-4 rounded-2xl text-center transition-all duration-200 border-2 flex flex-col items-center gap-2 ${opt.value === 'none' ? 'col-span-2' : ''}`}
                    style={{
                      backgroundColor: isSelected ? 'rgba(0,255,148,0.1)' : 'rgba(255,255,255,0.04)',
                      borderColor: isSelected ? '#00FF94' : 'rgba(255,255,255,0.08)',
                      transform: 'scale(1)'
                    }}
                    {...pressProps}
                  >
                    {getWearableIcon(opt.value, isSelected)}
                    <span className="font-semibold text-sm" style={{ color: isSelected ? '#00FF94' : 'white' }}>
                      {opt.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );

      // Step 5: Weekly Goals
      case 5:
        return (
          <div>
            <h2 className="text-2xl font-bold mb-1">{isEditing ? 'Edit Weekly Goals' : 'Set your weekly goals'}</h2>
            <p className="text-gray-500 text-sm mb-2">How many sessions per week for each category?</p>
            {!isEditing && fitnessGoal && !goalsManuallySet.current && (
              <p className="text-xs mb-4 flex items-center gap-1.5" style={{ color: '#00FF94' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                Suggested based on your goal — adjust anytime
              </p>
            )}
            {(isEditing || !fitnessGoal || goalsManuallySet.current) && <div className="mb-4" />}
            <GoalSelector
              label="Strength"
              subtitle="Weightlifting, calisthenics, resistance training"
              color="#00FF94"
              goalKey="liftsPerWeek"
              options={[2, 3, 4, 5, 6]}
            />
            <GoalSelector
              label="Cardio"
              subtitle="Running, cycling, sports, swimming"
              color="#FF9500"
              goalKey="cardioPerWeek"
              options={[1, 2, 3, 4, 5]}
            />
            <GoalSelector
              label="Recovery"
              subtitle="Cold plunge, sauna, yoga, pilates"
              color="#00D1FF"
              goalKey="recoveryPerWeek"
              options={[1, 2, 3, 4]}
            />
          </div>
        );

      // Step 6: Daily Goals
      case 6:
        return (
          <div>
            <h2 className="text-2xl font-bold mb-1">{isEditing ? 'Edit Daily Goals' : 'Set your daily goals'}</h2>
            <p className="text-gray-500 text-sm mb-2">Your daily movement targets.</p>
            {!isEditing && fitnessGoal && !goalsManuallySet.current && (
              <p className="text-xs mb-4 flex items-center gap-1.5" style={{ color: '#00FF94' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                Suggested based on your goal — adjust anytime
              </p>
            )}
            {(isEditing || !fitnessGoal || goalsManuallySet.current) && <div className="mb-4" />}
            <GoalSelector
              label="Daily Steps"
              subtitle="Recommended: 10k+ for general health"
              color="#00FF94"
              goalKey="stepsPerDay"
              options={[6000, 8000, 10000, 12000, 15000]}
              isSteps
            />
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#FF9500' }} />
                <label className="text-sm font-semibold">Active Calories</label>
              </div>
              <p className="text-xs text-gray-500 mb-2 ml-4">Calories burned from exercise only. Recommended: 400-600/day.</p>
              <div
                className="flex gap-2 overflow-x-auto pb-2 -mx-6 px-6"
                style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', msOverflowStyle: 'none', touchAction: 'pan-x' }}
              >
                {[300, 400, 500, 600, 750, 1000, 1250, 1500, 1750, 2000].map((option) => (
                  <div
                    key={option}
                    onClick={() => { goalsManuallySet.current = true; setGoals({ ...goals, caloriesPerDay: option }); }}
                    className="py-3 rounded-xl text-center border-2 flex-shrink-0 px-4 min-w-[70px] cursor-pointer select-none"
                    style={{
                      backgroundColor: goals.caloriesPerDay === option ? 'rgba(255,149,0,0.2)' : 'rgba(255,255,255,0.05)',
                      borderColor: goals.caloriesPerDay === option ? '#FF9500' : 'transparent',
                    }}
                  >
                    <span className="font-bold" style={{ color: goals.caloriesPerDay === option ? '#FF9500' : 'white' }}>
                      {option}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );

      // Step 7: Privacy
      case 7:
        return (
          <div>
            <h2 className="text-2xl font-bold mb-1">One last thing</h2>
            <p className="text-gray-500 text-sm mb-8">Choose how you appear to friends. You can change these anytime in Settings.</p>

            {/* Activity Feed Toggle */}
            <div className="flex items-center justify-between py-4 border-b border-zinc-800/50">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(0,209,255,0.1)' }}>
                  <span className="text-lg">📲</span>
                </div>
                <div>
                  <span className="text-[15px] text-white font-medium">Show in Activity Feed</span>
                  <p className="text-xs text-gray-500 mt-0.5">Friends can see your workouts</p>
                </div>
              </div>
              <button
                onClick={() => setPrivacy({ ...privacy, showInActivityFeed: !privacy.showInActivityFeed })}
                className="w-12 h-7 rounded-full transition-all duration-200 relative flex-shrink-0"
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
            <div className="flex items-center justify-between py-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(255,149,0,0.1)' }}>
                  <span className="text-lg">🏅</span>
                </div>
                <div>
                  <span className="text-[15px] text-white font-medium">Appear on Leaderboards</span>
                  <p className="text-xs text-gray-500 mt-0.5">Compete with friends</p>
                </div>
              </div>
              <button
                onClick={() => setPrivacy({ ...privacy, showOnLeaderboard: !privacy.showOnLeaderboard })}
                className="w-12 h-7 rounded-full transition-all duration-200 relative flex-shrink-0"
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
        );

      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black text-white flex flex-col overflow-hidden" style={{ overscrollBehavior: 'none', touchAction: 'pan-y' }}>
      {/* Header with progress bar and back/cancel */}
      <div className="flex-shrink-0 px-6 pt-12 pb-2">
        <div className="flex items-center justify-between mb-5">
          {/* Back or Cancel button */}
          {canGoBack ? (
            <button
              onClick={goBack}
              className="text-gray-400 flex items-center gap-1 transition-all duration-150 px-2 py-1 rounded-lg -ml-2"
              {...pressProps}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              <span className="text-sm">Back</span>
            </button>
          ) : isEditing && onCancel ? (
            <button
              onClick={onCancel}
              className="text-gray-400 text-sm transition-all duration-150 px-2 py-1 rounded-lg -ml-2"
              {...pressProps}
            >
              Cancel
            </button>
          ) : (
            <div />
          )}
          <div />
        </div>

        {/* Progress bar */}
        <div className="flex gap-1.5 mb-2">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className="h-1 flex-1 rounded-full transition-all duration-300"
              style={{
                backgroundColor: i <= progressIndex ? '#00FF94' : 'rgba(255,255,255,0.1)'
              }}
            />
          ))}
        </div>
      </div>

      {/* Step content with slide animation */}
      <div
        key={currentStep}
        className="flex-1 px-6 py-4 pb-32 overflow-y-auto"
        style={{
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          animation: `${direction === 'forward' ? 'slideInRight' : 'slideInLeft'} 0.3s ease-out`
        }}
      >
        {renderStep()}
      </div>

      {/* Bottom button */}
      <div className="fixed bottom-0 left-0 right-0 p-6 pb-12" style={{ background: 'linear-gradient(to top, #000 80%, transparent)' }}>
        <button
          onClick={isLastStep ? handleComplete : goNext}
          disabled={!canContinue}
          className="w-full py-4 rounded-xl font-bold text-lg transition-all duration-150"
          style={{
            backgroundColor: canContinue ? '#00FF94' : 'rgba(255,255,255,0.1)',
            color: canContinue ? 'black' : 'rgba(255,255,255,0.3)',
          }}
          onTouchStart={(e) => {
            if (canContinue) {
              e.currentTarget.style.transform = 'scale(0.97)';
              e.currentTarget.style.backgroundColor = '#00CC77';
            }
          }}
          onTouchEnd={(e) => {
            if (canContinue) {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.backgroundColor = '#00FF94';
            }
          }}
          onMouseDown={(e) => {
            if (canContinue) {
              e.currentTarget.style.transform = 'scale(0.97)';
              e.currentTarget.style.backgroundColor = '#00CC77';
            }
          }}
          onMouseUp={(e) => {
            if (canContinue) {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.backgroundColor = '#00FF94';
            }
          }}
          onMouseLeave={(e) => {
            if (canContinue) {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.backgroundColor = '#00FF94';
            }
          }}
        >
          {isLastStep ? (isEditing ? 'Save Goals' : 'Get Started') : 'Continue'}
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
  const hoursTouchRef = useRef({ startY: 0, startScroll: 0, lastY: 0, lastTime: 0, velocity: 0, animFrame: null, isTouching: false });
  const minutesTouchRef = useRef({ startY: 0, startScroll: 0, lastY: 0, lastTime: 0, velocity: 0, animFrame: null, isTouching: false });

  const itemHeight = 32;
  const visibleItems = 3;

  useEffect(() => {
    if (hoursRef.current && !hoursTouchRef.current.isTouching) {
      hoursRef.current.scrollTop = hours * itemHeight;
    }
    if (minutesRef.current && !minutesTouchRef.current.isTouching) {
      minutesRef.current.scrollTop = minutes * itemHeight;
    }
  }, [hours, minutes]);

  const snapToNearest = (ref, options, type) => {
    if (!ref.current) return;
    const scrollTop = ref.current.scrollTop;
    const index = Math.round(scrollTop / itemHeight);
    const clampedIndex = Math.max(0, Math.min(options.length - 1, index));
    ref.current.scrollTo({ top: clampedIndex * itemHeight, behavior: 'smooth' });
    if (type === 'hours' && clampedIndex !== hours) {
      onChange(clampedIndex, minutes);
    } else if (type === 'minutes' && clampedIndex !== hours) {
      onChange(hours, clampedIndex);
    }
  };

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

  const handleTouchStart = (e, ref, touchState) => {
    if (touchState.current.animFrame) cancelAnimationFrame(touchState.current.animFrame);
    const touch = e.touches[0];
    touchState.current = {
      startY: touch.clientY,
      startScroll: ref.current.scrollTop,
      lastY: touch.clientY,
      lastTime: Date.now(),
      velocity: 0,
      animFrame: null,
      isTouching: true
    };
  };

  const handleTouchMove = (e, ref, touchState) => {
    if (!touchState.current.isTouching) return;
    e.preventDefault();
    const touch = e.touches[0];
    const now = Date.now();
    const dt = now - touchState.current.lastTime;
    const dy = touchState.current.lastY - touch.clientY;
    if (dt > 0) {
      touchState.current.velocity = dy / dt;
    }
    touchState.current.lastY = touch.clientY;
    touchState.current.lastTime = now;
    const delta = touchState.current.startY - touch.clientY;
    ref.current.scrollTop = touchState.current.startScroll + delta;
  };

  const handleTouchEnd = (ref, touchState, options, type) => {
    touchState.current.isTouching = false;
    const velocity = touchState.current.velocity; // px/ms
    const maxScroll = (options.length - 1) * itemHeight;

    if (Math.abs(velocity) > 0.3) {
      // Momentum: apply velocity with friction
      let currentVelocity = velocity * 16; // convert to px/frame (~16ms)
      const friction = 0.92;
      const animate = () => {
        currentVelocity *= friction;
        if (Math.abs(currentVelocity) < 0.5) {
          snapToNearest(ref, options, type);
          return;
        }
        ref.current.scrollTop = Math.max(0, Math.min(maxScroll, ref.current.scrollTop + currentVelocity));
        touchState.current.animFrame = requestAnimationFrame(animate);
      };
      touchState.current.animFrame = requestAnimationFrame(animate);
    } else {
      snapToNearest(ref, options, type);
    }
  };

  const scrollToValue = (ref, value) => {
    if (ref.current) {
      ref.current.scrollTo({ top: value * itemHeight, behavior: 'smooth' });
    }
  };

  const renderWheel = (ref, touchState, options, value, type, formatFn) => (
    <div className="relative" style={{ height: itemHeight * visibleItems, width: '60px' }}>
      {/* Fade overlays */}
      <div className="absolute top-0 left-0 right-0 z-10 pointer-events-none"
        style={{ height: itemHeight, background: 'linear-gradient(to bottom, rgba(10,10,10,1) 0%, rgba(10,10,10,0) 100%)' }} />
      <div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none"
        style={{ height: itemHeight, background: 'linear-gradient(to top, rgba(10,10,10,1) 0%, rgba(10,10,10,0) 100%)' }} />
      {/* Selection highlight */}
      <div className="absolute left-0 right-0 z-5 pointer-events-none rounded-lg"
        style={{ top: itemHeight, height: itemHeight, backgroundColor: 'rgba(0,255,148,0.1)', border: '1px solid rgba(0,255,148,0.3)' }} />
      {/* Scrollable list */}
      <div
        ref={ref}
        className="h-full overflow-y-scroll scrollbar-hide"
        style={{ scrollSnapType: 'none', WebkitOverflowScrolling: 'auto' }}
        onScroll={() => handleScroll(ref, options, type)}
        onTouchStart={(e) => handleTouchStart(e, ref, touchState)}
        onTouchMove={(e) => handleTouchMove(e, ref, touchState)}
        onTouchEnd={() => handleTouchEnd(ref, touchState, options, type)}
      >
        <div style={{ height: itemHeight }} />
        {options.map((v) => (
          <div key={v} onClick={() => scrollToValue(ref, v)}
            className="flex items-center justify-center cursor-pointer transition-all duration-150"
            style={{ height: itemHeight, color: value === v ? '#00FF94' : 'rgba(255,255,255,0.5)', fontWeight: value === v ? 'bold' : 'normal', fontSize: value === v ? '18px' : '14px' }}>
            {formatFn(v)}
          </div>
        ))}
        <div style={{ height: itemHeight }} />
      </div>
    </div>
  );

  return (
    <div className="flex items-center justify-start gap-1" style={{ opacity: disabled ? 0.5 : 1 }}>
      {renderWheel(hoursRef, hoursTouchRef, hourOptions, hours, 'hours', (v) => v)}
      <div className="text-xs text-gray-400">hr</div>
      <div className="text-xl font-bold text-gray-500">:</div>
      {renderWheel(minutesRef, minutesTouchRef, minuteOptions, minutes, 'minutes', (v) => String(v).padStart(2, '0'))}
      <div className="text-xs text-gray-400">min</div>
    </div>
  );
};

// Minutes-only Picker (reuses DurationPicker scroll wheel style)
const MinutesPicker = ({ value, onChange, label = 'min' }) => {
  const minuteOptions = Array.from({ length: 60 }, (_, i) => i);
  const ref = useRef(null);
  const touchState = useRef({ startY: 0, startScroll: 0, lastY: 0, lastTime: 0, velocity: 0, animFrame: null, isTouching: false });
  const itemHeight = 32;
  const visibleItems = 3;

  useEffect(() => {
    if (ref.current && !touchState.current.isTouching) {
      ref.current.scrollTop = value * itemHeight;
    }
  }, [value]);

  const snapToNearest = () => {
    if (!ref.current) return;
    const index = Math.round(ref.current.scrollTop / itemHeight);
    const clamped = Math.max(0, Math.min(minuteOptions.length - 1, index));
    ref.current.scrollTo({ top: clamped * itemHeight, behavior: 'smooth' });
    if (clamped !== value) onChange(clamped);
  };

  const handleScroll = () => {
    if (!ref.current) return;
    const index = Math.round(ref.current.scrollTop / itemHeight);
    const clamped = Math.max(0, Math.min(minuteOptions.length - 1, index));
    if (clamped !== value) onChange(clamped);
  };

  const handleTouchStart = (e) => {
    if (touchState.current.animFrame) cancelAnimationFrame(touchState.current.animFrame);
    const touch = e.touches[0];
    touchState.current = { startY: touch.clientY, startScroll: ref.current.scrollTop, lastY: touch.clientY, lastTime: Date.now(), velocity: 0, animFrame: null, isTouching: true };
  };

  const handleTouchMove = (e) => {
    if (!touchState.current.isTouching) return;
    e.preventDefault();
    const touch = e.touches[0];
    const now = Date.now();
    const dt = now - touchState.current.lastTime;
    if (dt > 0) touchState.current.velocity = (touchState.current.lastY - touch.clientY) / dt;
    touchState.current.lastY = touch.clientY;
    touchState.current.lastTime = now;
    ref.current.scrollTop = touchState.current.startScroll + (touchState.current.startY - touch.clientY);
  };

  const handleTouchEnd = () => {
    touchState.current.isTouching = false;
    const velocity = touchState.current.velocity;
    const maxScroll = (minuteOptions.length - 1) * itemHeight;
    if (Math.abs(velocity) > 0.3) {
      let cv = velocity * 16;
      const friction = 0.92;
      const animate = () => {
        cv *= friction;
        if (Math.abs(cv) < 0.5) { snapToNearest(); return; }
        ref.current.scrollTop = Math.max(0, Math.min(maxScroll, ref.current.scrollTop + cv));
        touchState.current.animFrame = requestAnimationFrame(animate);
      };
      touchState.current.animFrame = requestAnimationFrame(animate);
    } else {
      snapToNearest();
    }
  };

  return (
    <div className="flex items-center gap-1">
      <div className="relative" style={{ height: itemHeight * visibleItems, width: '60px' }}>
        <div className="absolute top-0 left-0 right-0 z-10 pointer-events-none"
          style={{ height: itemHeight, background: 'linear-gradient(to bottom, rgba(10,10,10,1) 0%, rgba(10,10,10,0) 100%)' }} />
        <div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none"
          style={{ height: itemHeight, background: 'linear-gradient(to top, rgba(10,10,10,1) 0%, rgba(10,10,10,0) 100%)' }} />
        <div className="absolute left-0 right-0 z-5 pointer-events-none rounded-lg"
          style={{ top: itemHeight, height: itemHeight, backgroundColor: 'rgba(0,255,148,0.1)', border: '1px solid rgba(0,255,148,0.3)' }} />
        <div ref={ref} className="h-full overflow-y-scroll scrollbar-hide"
          style={{ scrollSnapType: 'none', WebkitOverflowScrolling: 'auto' }}
          onScroll={handleScroll}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div style={{ height: itemHeight }} />
          {minuteOptions.map(v => (
            <div key={v} onClick={() => { if (ref.current) ref.current.scrollTo({ top: v * itemHeight, behavior: 'smooth' }); }}
              className="flex items-center justify-center cursor-pointer transition-all duration-150"
              style={{ height: itemHeight, color: value === v ? '#00FF94' : 'rgba(255,255,255,0.5)', fontWeight: value === v ? 'bold' : 'normal', fontSize: value === v ? '18px' : '14px' }}>
              {String(v).padStart(2, '0')}
            </div>
          ))}
          <div style={{ height: itemHeight }} />
        </div>
      </div>
      <div className="text-xs text-gray-400">{label}</div>
    </div>
  );
};

// Add Activity Modal
const AddActivityModal = ({ isOpen, onClose, onSave, pendingActivity = null, defaultDate = null, userData = null, onSaveCustomActivity = null, onSaveHKPreference = null, onStartWorkout = null, hasActiveWorkout = false, otherPendingWorkoutsCount = 0, onSeeOtherWorkouts = null, onBackToWorkoutPicker = null, dismissedWorkoutUUIDs = [], linkedWorkoutUUIDs = [], pendingWorkouts = [], activeChallenges = [], friendsByUid = {} }) => {
  // Mode: null = initial choice, 'start' = start new workout, 'completed' = log completed (existing flow)
  const [mode, setMode] = useState(null);
  const [activityType, setActivityType] = useState(null);
  // Challenge fulfillment selection — null = user hasn't interacted (default-on for all matches);
  // Set => explicit selection (user toggled at least one row, including "uncheck all").
  // Sent to the cloud function as `intendedChallengeIds`. Empty array = "explicit none."
  const [challengeFulfillSelection, setChallengeFulfillSelection] = useState(null);
  const [isFromNotification, setIsFromNotification] = useState(false); // Track if opened from notification
  const [isChangingActivityType, setIsChangingActivityType] = useState(false); // Track if user clicked "Change" on activity type
  const [subtype, setSubtype] = useState('');
  const [strengthType, setStrengthType] = useState(''); // Weightlifting, Bodyweight
  const [focusAreas, setFocusAreas] = useState([]); // Multi-select: Full Body, Upper, Lower, etc.
  const [customSport, setCustomSport] = useState('');
  const [customSportEmoji, setCustomSportEmoji] = useState('⚽');
  const [showSportEmojiPicker, setShowSportEmojiPicker] = useState(false);
  const [saveCustomSport, setSaveCustomSport] = useState(false);
  // Custom "Other" activity state
  const [customActivityName, setCustomActivityName] = useState('');
  const [customActivityEmoji, setCustomActivityEmoji] = useState(''); // Kept for backwards compat with old data
  const [customActivityIcon, setCustomActivityIcon] = useState('CirclePlus'); // New: Lucide icon name for "Other" activities
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [saveCustomActivity, setSaveCustomActivity] = useState(false);
  const [saveHKIcon, setSaveHKIcon] = useState(false);
  const [saveHKCategory, setSaveHKCategory] = useState(false);
  const [customActivityCategory, setCustomActivityCategory] = useState(''); // 'strength', 'cardio', or 'recovery'

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
  // Link to Apple Health workout
  const [linkableWorkouts, setLinkableWorkouts] = useState([]);
  const [linkedWorkout, setLinkedWorkout] = useState(null);
  const [isLoadingWorkouts, setIsLoadingWorkouts] = useState(false);
  const [showOtherLinkableWorkouts, setShowOtherLinkableWorkouts] = useState(false);
  const [showAllInitialWorkouts, setShowAllInitialWorkouts] = useState(false); // For expanding workouts on initial screen
  // Activity time (set from linked workout)
  const [activityTime, setActivityTime] = useState('');
  // Photo upload state
  const [activityPhoto, setActivityPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [isPhotoPrivate, setIsPhotoPrivate] = useState(false);
  const [showPhotoOptions, setShowPhotoOptions] = useState(false);
  // Contrast Therapy state
  const [contrastColdType, setContrastColdType] = useState('Cold Plunge');
  const [contrastHotType, setContrastHotType] = useState('Sauna');
  const [contrastColdMinutes, setContrastColdMinutes] = useState(5);
  const [contrastHotMinutes, setContrastHotMinutes] = useState(10);
  const photoInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const hasInitializedRef = useRef(false);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen && !hasInitializedRef.current) {
      hasInitializedRef.current = true;
      // Seed challenge-fulfill selection from preset intent (from "Start workout" CTA), else null
      // (= default to all matching checked once matches resolve at render time).
      const presetIntent = pendingActivity?.intendedChallengeIds;
      setChallengeFulfillSelection(
        Array.isArray(presetIntent) ? new Set(presetIntent.map(String)) : null
      );
      // If there's a pending activity (from HealthKit or editing), go directly to completed flow
      // Otherwise show initial choice screen
      setMode(pendingActivity ? 'completed' : null);
      // When editing a 'Strength Training' activity, use the strengthType as the flattened activityType
      const editType = pendingActivity?.type === 'Strength Training' && pendingActivity?.strengthType
        ? pendingActivity.strengthType : (pendingActivity?.type || null);
      setActivityType(editType);
      setSubtype(pendingActivity?.subtype || '');
      setStrengthType(pendingActivity?.strengthType || '');
      setFocusAreas(normalizeFocusAreas(pendingActivity?.focusAreas || (pendingActivity?.focusArea ? [pendingActivity.focusArea] : [])));
      setCustomSport('');
      setCustomSportEmoji('⚽');
      setShowSportEmojiPicker(false);
      setSaveCustomSport(false);
      // For "Other" activities OR uncategorized Apple Health types, load custom fields
      const isUncatType = pendingActivity?.type && !['Strength Training', 'Weightlifting', 'Bodyweight', 'Circuit',
        'Running', 'Cycle', 'Sports', 'Stair Climbing', 'Elliptical', 'Walking',
        'Yoga', 'Pilates', 'Cold Plunge', 'Sauna', 'Contrast Therapy', 'Massage', 'Chiropractic', 'Other'].includes(pendingActivity.type);
      const loadCustomFields = pendingActivity?.type === 'Other' || isUncatType;
      setCustomActivityName(loadCustomFields
        ? (isUncatType ? (pendingActivity?.appleWorkoutName || pendingActivity?.type || '') : (pendingActivity?.subtype || ''))
        : '');
      setCustomActivityEmoji(pendingActivity?.type === 'Other' ? (pendingActivity?.customEmoji || '') : '');
      const defaultIcon = isUncatType ? 'IconHeartbeat' : 'CirclePlus';
      setCustomActivityIcon(loadCustomFields ? (pendingActivity?.customIcon || defaultIcon) : 'CirclePlus');
      setShowIconPicker(false);
      setSaveCustomActivity(false);
      setSaveHKIcon(false);
      setSaveHKCategory(false);
      setCustomActivityCategory(loadCustomFields ? (pendingActivity?.customActivityCategory || pendingActivity?.countToward || '') : '');
      // Apply saved HealthKit type preferences for uncategorized types
      if (isUncatType && userData?.healthKitTypePreferences) {
        const prefKey = pendingActivity?.appleWorkoutName || pendingActivity?.type;
        const pref = userData.healthKitTypePreferences[prefKey];
        if (pref?.icon) setCustomActivityIcon(pref.icon);
        if (pref?.category) setCustomActivityCategory(pref.category);
      }
      setDate(defaultDate || pendingActivity?.date || getTodayDate());
      setShowDatePicker(false);
      setNotes(pendingActivity?.notes || '');

      // Check if this is a workout from the notification banner (has healthKitUUID and id starts with 'hk_')
      // Workouts from notification have id like 'hk_com.apple.health...' while saved activities have Firebase IDs
      const fromNotification = pendingActivity?.healthKitUUID &&
        !pendingActivity?.linkedHealthKitUUID &&
        (typeof pendingActivity?.id === 'string' && pendingActivity.id.startsWith('hk_'));

      setIsFromNotification(fromNotification);

      if (fromNotification) {
        // Pre-fill all metrics from the workout and auto-link it
        setDistance(pendingActivity?.distance?.toString() || '');
        const duration = pendingActivity?.duration || 0;
        setDurationHours(Math.floor(duration / 60));
        setDurationMinutes(duration % 60);
        setCalories(pendingActivity?.calories?.toString() || '');
        setAvgHr(pendingActivity?.avgHr?.toString() || '');
        setMaxHr(pendingActivity?.maxHr?.toString() || '');
        setActivityTime(pendingActivity?.time || '');
        // Auto-link the workout
        setLinkedWorkout(pendingActivity);
      } else {
        // Normal edit flow or manual entry
        setDistance(pendingActivity?.distance || '');
        // Set duration based on activity type or existing data
        if (pendingActivity?.durationHours !== undefined || pendingActivity?.durationMinutes !== undefined) {
          // Use existing duration from the activity
          setDurationHours(pendingActivity?.durationHours ?? 0);
          setDurationMinutes(pendingActivity?.durationMinutes ?? 0);
        } else if (pendingActivity?.type === 'Sauna') {
          // Default to 10 minutes for Sauna
          setDurationHours(0);
          setDurationMinutes(10);
        } else if (pendingActivity?.type === 'Cold Plunge') {
          // Default to 5 minutes for Cold Plunge
          setDurationHours(0);
          setDurationMinutes(5);
        } else if (pendingActivity?.type === 'Contrast Therapy') {
          // Default to 15 minutes for Contrast Therapy
          setDurationHours(0);
          setDurationMinutes(15);
        } else {
          // Default to 1 hour for other activities
          setDurationHours(1);
          setDurationMinutes(0);
        }
        setCalories(pendingActivity?.calories || '');
        setAvgHr(pendingActivity?.avgHr || '');
        setMaxHr(pendingActivity?.maxHr || '');
        setActivityTime(pendingActivity?.time || '');
        // Set linked workout if editing an activity that was previously linked
        // Include activity data so the linked workout box shows details
        setLinkedWorkout(pendingActivity?.linkedHealthKitUUID ? {
          healthKitUUID: pendingActivity.linkedHealthKitUUID,
          type: pendingActivity.type,
          subtype: pendingActivity.subtype,
          appleWorkoutName: pendingActivity.appleWorkoutName,
          time: pendingActivity.time,
          duration: pendingActivity.duration,
          calories: pendingActivity.calories,
          distance: pendingActivity.distance,
          avgHr: pendingActivity.avgHr,
          maxHr: pendingActivity.maxHr,
          icon: pendingActivity.icon || (pendingActivity.type === 'Walking' ? '🚶' : '💪'),
          sourceDevice: pendingActivity.sourceDevice
        } : null);
      }

      // Reset linked workout state
      setLinkableWorkouts([]);
      setIsLoadingWorkouts(false);
      setShowOtherLinkableWorkouts(false);
      // Reset photo state
      setActivityPhoto(null);
      setPhotoPreview(pendingActivity?.photoURL || null);
      setIsPhotoPrivate(pendingActivity?.isPhotoPrivate || false);
      setShowPhotoOptions(false);
      // Load contrast therapy fields if editing
      if (pendingActivity?.type === 'Contrast Therapy') {
        setContrastColdType(pendingActivity.coldType || 'Cold Plunge');
        setContrastHotType(pendingActivity.hotType || 'Sauna');
        setContrastColdMinutes(pendingActivity.coldDuration || 5);
        setContrastHotMinutes(pendingActivity.hotDuration || 10);
      }
    }
    // Reset the initialization flag when modal closes
    if (!isOpen) {
      hasInitializedRef.current = false;
      setIsChangingActivityType(false);
      setIsFromNotification(false);
      setShowAllInitialWorkouts(false);
      setContrastColdType('Cold Plunge');
      setContrastHotType('Sauna');
      setContrastColdMinutes(5);
      setContrastHotMinutes(10);
      setChallengeFulfillSelection(null);
    }
  }, [isOpen, pendingActivity, defaultDate]);

  // Fetch HR data from HealthKit when editing an activity that's linked but missing HR
  useEffect(() => {
    if (!isOpen || !pendingActivity) return;

    // Fetch HR if activity is linked to Apple Health but missing HR data
    const isFromAppleHealth = pendingActivity?.linkedHealthKitUUID ||
      pendingActivity?.healthKitUUID ||
      pendingActivity?.fromAppleHealth ||
      pendingActivity?.source === 'healthkit';
    const missingHR = !pendingActivity?.avgHr && !pendingActivity?.maxHr;

    if (isFromAppleHealth && missingHR && pendingActivity?.date && pendingActivity?.time && pendingActivity?.duration) {
      // Construct time range from date, time, and duration
      const parseActivityTime = (dateStr, timeStr) => {
        const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
        if (!match) return null;
        let hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const isPM = match[3].toUpperCase() === 'PM';
        if (isPM && hours !== 12) hours += 12;
        if (!isPM && hours === 12) hours = 0;
        const date = new Date(dateStr + 'T00:00:00');
        date.setHours(hours, minutes, 0, 0);
        return date;
      };

      const startTime = parseActivityTime(pendingActivity.date, pendingActivity.time);
      if (startTime) {
        const endTime = new Date(startTime.getTime() + pendingActivity.duration * 60 * 1000);
        queryHeartRateForTimeRange(startTime.toISOString(), endTime.toISOString())
          .then(hrData => {
            if (hrData) {
              setAvgHr(hrData.avgHr.toString());
              setMaxHr(hrData.maxHr.toString());
            }
          })
          .catch(() => {});
      }
    }
  }, [isOpen, pendingActivity]);

  // Fetch linkable Apple Health workouts when modal opens or date changes
  // Also merge in pending workouts from the notification banner
  useEffect(() => {
    // Fetch on initial screen (mode === null) or in completed mode
    if (!isOpen || (mode !== null && mode !== 'completed') || !date) return;

    const fetchWorkouts = async () => {
      setIsLoadingWorkouts(true);
      try {
        // Get list of already linked workout IDs from user's activities
        const workouts = await fetchLinkableWorkouts(date, []);

        // Merge in pending workouts (from notification banner) that aren't already in the list
        // These may be from different dates, so they expand what the user sees
        const fetchedUUIDs = new Set(workouts.map(w => w.healthKitUUID));
        const extraPending = (pendingWorkouts || []).filter(w =>
          w.healthKitUUID && !fetchedUUIDs.has(w.healthKitUUID)
        );
        const allWorkouts = [...workouts, ...extraPending];

        // Filter out already linked or dismissed workouts
        const filteredWorkouts = allWorkouts.filter(w =>
          !linkedWorkoutUUIDs.includes(w.healthKitUUID) &&
          !dismissedWorkoutUUIDs.includes(w.healthKitUUID)
        );
        setLinkableWorkouts(filteredWorkouts);
      } catch (error) {
        // Fall back to pending workouts if fetch fails
        const filteredPending = (pendingWorkouts || []).filter(w =>
          !linkedWorkoutUUIDs.includes(w.healthKitUUID) &&
          !dismissedWorkoutUUIDs.includes(w.healthKitUUID)
        );
        setLinkableWorkouts(filteredPending);
      } finally {
        setIsLoadingWorkouts(false);
      }
    };

    fetchWorkouts();
  }, [isOpen, mode, date, linkedWorkoutUUIDs, dismissedWorkoutUUIDs, pendingWorkouts]);

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

  // Strength types are flattened into the main list (not nested under "Strength Training").
  // When saved, they store type: 'Strength Training' + strengthType for backwards compat.
  const STRENGTH_TYPES = ['Weightlifting', 'Bodyweight', 'Circuit'];

  const activityTypes = [
    { name: 'Weightlifting', subtypes: [], category: 'strength', hasFocusArea: true },
    { name: 'Bodyweight', subtypes: [], category: 'strength', hasFocusArea: true },
    { name: 'Circuit', subtypes: [], category: 'strength', hasFocusArea: true },
    { name: 'Running', subtypes: ['Outdoor', 'Indoor'], category: 'cardio' },
    { name: 'Cycle', subtypes: ['Outdoor', 'Indoor'], category: 'cardio' },
    { name: 'Sports', subtypes: [
      { name: 'Basketball', icon: '🏀' },
      { name: 'Soccer', icon: '⚽' },
      { name: 'Football', icon: '🏈' },
      { name: 'Tennis', icon: '🎾' },
      { name: 'Golf', icon: '⛳' },
      { name: 'Other', icon: '🏆' }
    ], category: 'cardio' },
    { name: 'Stair Climbing', subtypes: [], category: 'cardio' },
    { name: 'Elliptical', subtypes: [], category: 'cardio' },
    { name: 'Rowing', subtypes: [], category: 'cardio' },
    { name: 'Ski Trainer', subtypes: [], category: 'cardio' },
    { name: 'Yoga', subtypes: ['Vinyasa', 'Power', 'Hot', 'Yin', 'Restorative'], category: 'hybrid' },
    { name: 'Pilates', subtypes: ['Mat', 'Reformer', 'Tower', 'Chair'], category: 'hybrid' },
    { name: 'Walking', subtypes: ['Outdoor', 'Indoor'], category: 'hybrid' },
    { name: 'Cold Plunge', subtypes: [], category: 'recovery' },
    { name: 'Sauna', subtypes: [], category: 'recovery' },
    { name: 'Contrast Therapy', subtypes: [], category: 'recovery' },
    { name: 'Massage', subtypes: [], category: 'recovery' },
    { name: 'Chiropractic', subtypes: [], category: 'recovery' },
    { name: 'Other', subtypes: [], category: 'other' }
  ];

  // SVG icons for activity categories
  const categoryIcons = {
    strength: (
      // Dumbbell: weight rings on each end with a horizontal handle
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 4v16M18 4v16M2 9v6M22 9v6M6 12h12"/>
      </svg>
    ),
    cardio: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
      </svg>
    ),
    hybrid: (
      // Wind / flow lines — suggests the gentle, flowing motion of yoga, pilates, walking
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/>
        <path d="M9.6 4.6A2 2 0 1 1 11 8H2"/>
        <path d="M12.6 19.4A2 2 0 1 0 14 16H2"/>
      </svg>
    ),
    recovery: (
      // Snowflake — represents cold plunge / contrast therapy
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12h20M12 2v20"/>
        <path d="m20 16-4-4 4-4M4 8l4 4-4 4M16 4l-4 4-4-4M8 20l4-4 4 4"/>
      </svg>
    ),
    other: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>
      </svg>
    )
  };

  const activityCategories = [
    { id: 'strength', label: 'Strength' },
    { id: 'cardio', label: 'Cardio' },
    { id: 'hybrid', label: 'Hybrid' },
    { id: 'recovery', label: 'Recovery' }
  ];

  // strengthTypes array removed — now flattened into activityTypes above.

  const toggleFocusGroup = (groupName) => {
    const members = FOCUS_AREA_GROUPS[groupName];
    const allSelected = members.every(m => focusAreas.includes(m));
    if (allSelected) {
      setFocusAreas(prev => prev.filter(a => !members.includes(a)));
    } else {
      setFocusAreas(prev => [...new Set([...prev, ...members])]);
    }
  };

  const toggleFocusArea = (area) => {
    setFocusAreas(prev => prev.includes(area) ? prev.filter(a => a !== area) : [...prev, area]);
  };

  // Uses shared getDefaultCountToward() defined above

  const [countToward, setCountToward] = useState(null);

  // Update countToward when activity type or subtype changes
  useEffect(() => {
    if (activityType && activityType !== 'Other') {
      const defaultCT = getDefaultCountToward(activityType, subtype);
      if (defaultCT) {
        setCountToward(defaultCT);
      } else {
        // For uncategorized HK types, don't override — customActivityCategory handles it
        setCountToward(null);
      }
    } else {
      setCountToward(null);
    }
  }, [activityType, subtype]);

  const selectedType = activityTypes.find(t => t.name === activityType);
  const showCustomSportInput = activityType === 'Sports' && subtype === 'Other';
  // Standard types that have built-in category mapping and icon
  const STANDARD_ACTIVITY_TYPES = ['Strength Training', 'Weightlifting', 'Bodyweight', 'Circuit',
    'Running', 'Cycle', 'Sports', 'Stair Climbing', 'Elliptical', 'Rowing', 'Ski Trainer', 'Walking',
    'Yoga', 'Pilates', 'Cold Plunge', 'Sauna', 'Contrast Therapy', 'Massage', 'Chiropractic', 'Other',
    'Track & Field', 'Jump Rope', 'Downhill Skiing', 'Cross Country Skiing', 'Snowboarding', 'Skating', 'Surfing', 'Water Polo', 'Paddle Sports',
    'Basketball', 'Soccer', 'Football', 'Tennis', 'Golf', 'Badminton', 'Boxing', 'Martial Arts',
    'Baseball', 'Volleyball', 'Hockey', 'Lacrosse', 'Rugby', 'Softball', 'Squash', 'Table Tennis',
    'Racquetball', 'Handball', 'Pickleball', 'Cricket', 'Australian Football', 'Wrestling',
    'Fencing', 'Curling', 'Bowling'];
  const isUncategorizedHKType = activityType && !STANDARD_ACTIVITY_TYPES.includes(activityType);
  const showCustomActivityInput = activityType === 'Other' || isUncategorizedHKType;
  const showCountToward = activityType && activityType !== 'Other' && !isUncategorizedHKType;
  const isFromAppleHealth = !!pendingActivity?.fromAppleHealth;

  // Evaluate each accepted active challenge against the in-progress activity. Recomputed as
  // the user picks type / category / duration / distance. Splits into:
  //  - matchingChallenges: meet the target (eligible for fulfillment)
  //  - shortChallenges: right type but below the target (shown greyed-out with "X short" hint)
  const { matchingChallenges, shortChallenges } = useMemo(() => {
    if (!isOpen || !activeChallenges || activeChallenges.length === 0) {
      return { matchingChallenges: [], shortChallenges: [] };
    }
    // Strength sub-types collapse to 'Strength Training' so getChallengeCategory works.
    const normalizedType = ['Weightlifting', 'Bodyweight', 'Circuit'].includes(activityType)
      ? 'Strength Training'
      : activityType;
    // Same duration math the save uses (Contrast = cold+hot, Chiropractic = none, default = h*60+m).
    const computedDuration = activityType === 'Chiropractic'
      ? 0
      : activityType === 'Contrast Therapy'
        ? (contrastColdMinutes + contrastHotMinutes)
        : (durationHours * 60 + durationMinutes);
    const proxyActivity = {
      type: normalizedType,
      subtype,
      countToward,
      customActivityCategory: showCustomActivityInput ? customActivityCategory : undefined,
      distance: distance || 0,
      duration: computedDuration,
    };
    const matching = [];
    const short = [];
    for (const c of activeChallenges) {
      const result = evaluateActivityAgainstChallenge(proxyActivity, c.matchRule);
      if (result.matches) matching.push(c);
      else if (result.qualifies) short.push({ challenge: c, shortBy: result.shortBy });
    }
    return { matchingChallenges: matching, shortChallenges: short };
  }, [isOpen, activeChallenges, activityType, subtype, countToward, customActivityCategory, showCustomActivityInput, distance, durationHours, durationMinutes, contrastColdMinutes, contrastHotMinutes]);

  // Effective selection: explicit user choice if any, else "all matches selected" by default.
  const effectiveChallengeSelection = useMemo(() => {
    if (challengeFulfillSelection !== null) return challengeFulfillSelection;
    return new Set(matchingChallenges.map(c => c.id));
  }, [challengeFulfillSelection, matchingChallenges]);

  const toggleChallengeFulfill = (id) => {
    setChallengeFulfillSelection(prev => {
      const base = prev !== null ? new Set(prev) : new Set(matchingChallenges.map(c => c.id));
      if (base.has(id)) base.delete(id); else base.add(id);
      return base;
    });
  };

  // Handle linking an Apple Health workout
  const handleLinkWorkout = (workout) => {
    if (linkedWorkout?.healthKitUUID === workout.healthKitUUID) {
      // Unlink if already linked - clear metrics
      setLinkedWorkout(null);
      setCalories('');
      setAvgHr('');
      setMaxHr('');
      setDistance('');
      setDurationHours(1);
      setDurationMinutes(0);
      setActivityTime('');
    } else {
      // Link and auto-fill metrics
      setLinkedWorkout(workout);
      if (workout.calories) setCalories(workout.calories.toString());
      if (workout.avgHr) setAvgHr(workout.avgHr.toString());
      if (workout.maxHr) setMaxHr(workout.maxHr.toString());
      if (workout.distance) setDistance(workout.distance.toString());
      // Always set duration if it exists (including 0)
      if (workout.duration !== undefined && workout.duration !== null) {
        const hours = Math.floor(workout.duration / 60);
        const mins = Math.round(workout.duration % 60);
        setDurationHours(hours);
        setDurationMinutes(mins);
      }
      if (workout.time) setActivityTime(workout.time);
    }
  };

  // Photo handling with Capacitor Camera
  const [isLoadingPhoto, setIsLoadingPhoto] = useState(false);

  const handleChooseFromLibrary = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        setIsLoadingPhoto(true);
        photoPickerActive = true;
        const image = await Camera.getPhoto({
          quality: 80,
          allowEditing: false,
          resultType: CameraResultType.Uri,
          source: CameraSource.Photos
        });
        photoPickerActive = false;

        if (image.path) {
          // Use Capacitor's file URI for fast preview (no base64 encoding)
          const webPath = Capacitor.convertFileSrc(image.path);
          setPhotoPreview(webPath);

          // Create File blob in background for upload
          const response = await fetch(webPath);
          const blob = await response.blob();
          if (blob.size < 100) {
            setPhotoPreview(null);
            setIsLoadingPhoto(false);
            alert('Could not load this photo. If it\'s stored in iCloud, make sure it\'s downloaded to your device first.');
            return;
          }
          const file = new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' });
          setActivityPhoto(file);
        }
      } catch (error) {
        if (error.message !== 'User cancelled photos app') {
          alert('Could not load photo. Please try again or choose a different photo.');
        }
      } finally {
        photoPickerActive = false;
        setIsLoadingPhoto(false);
      }
    } else {
      photoInputRef.current?.click();
    }
  };

  const handleTakePhoto = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        setIsLoadingPhoto(true);
        photoPickerActive = true;
        const image = await Camera.getPhoto({
          quality: 80,
          allowEditing: false,
          resultType: CameraResultType.Uri,
          source: CameraSource.Camera
        });
        photoPickerActive = false;

        if (image.path) {
          const webPath = Capacitor.convertFileSrc(image.path);
          setPhotoPreview(webPath);

          const response = await fetch(webPath);
          const blob = await response.blob();
          if (blob.size < 100) {
            setPhotoPreview(null);
            setIsLoadingPhoto(false);
            alert('Could not load this photo. Please try again.');
            return;
          }
          const file = new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' });
          setActivityPhoto(file);
        }
      } catch (error) {
        if (error.message !== 'User cancelled photos app') {
          alert('Could not load photo. Please try again.');
        }
      } finally {
        setIsLoadingPhoto(false);
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
        backgroundColor: isClosing ? 'rgba(0,0,0,0)' : (isAnimating && dragY === 0 ? 'rgba(0,0,0,0.95)' : `rgba(0,0,0,${Math.max(0, 0.95 - dragY / 300)})`),
        touchAction: 'none'
      }}
      onClick={(e) => e.target === e.currentTarget && handleClose()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      <div
        ref={modalRef}
        className={`flex-1 flex flex-col mt-12 rounded-t-3xl overflow-hidden ${isDragging ? '' : 'transition-all duration-300 ease-out'}`}
        style={{
          backgroundColor: '#0A0A0A',
          transform: isAnimating ? `translateY(${dragY}px)` : 'translateY(100%)',
          touchAction: 'pan-y'
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
            // Determine if this is a flattened strength type
            const isStrengthType = STRENGTH_TYPES.includes(activityType);

            // Build subtype and final type
            let finalSubtype = subtype;
            let finalType = activityType;
            if (isStrengthType) {
              // Flattened strength: save as 'Strength Training' with strengthType for backwards compat
              finalType = 'Strength Training';
              finalSubtype = focusAreas.length > 0 ? `${activityType} - ${focusAreas.join(', ')}` : activityType;
            } else if (activityType === 'Sports' && subtype && subtype !== 'Other') {
              // Named sport: save as its own type (e.g., 'Basketball' instead of 'Sports')
              finalType = subtype;
              finalSubtype = '';
            } else if (showCustomSportInput) {
              finalSubtype = customSport;
            } else if (showCustomActivityInput && customActivityName) {
              if (isUncategorizedHKType) {
                // For uncategorized Apple Health types (Tai Chi, Dance, etc.), keep type as-is
                // Don't set subtype to the name — it's already the type
                finalSubtype = subtype || '';
              } else {
                // For manual "Other" activity, store the custom name as subtype
                finalSubtype = customActivityName;
              }
            }

            // Save custom activity to user profile if requested
            if (showCustomActivityInput && !isUncategorizedHKType && saveCustomActivity && customActivityName && onSaveCustomActivity) {
              onSaveCustomActivity({ name: customActivityName, icon: customActivityIcon, category: customActivityCategory });
            }

            // Save HealthKit type preferences if requested (for uncategorized Apple Health types)
            if (isUncategorizedHKType && (saveHKIcon || saveHKCategory) && onSaveHKPreference) {
              const hkPrefKey = pendingActivity?.appleWorkoutName || activityType;
              const hkPref = {};
              if (saveHKIcon && customActivityIcon !== 'CirclePlus' && customActivityIcon !== 'IconHeartbeat') hkPref.icon = customActivityIcon;
              if (saveHKCategory && customActivityCategory) hkPref.category = customActivityCategory;
              if (Object.keys(hkPref).length > 0) {
                onSaveHKPreference(hkPrefKey, hkPref);
              }
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

            // START WORKOUT MODE: Create active workout instead of saving
            if (mode === 'start' && onStartWorkout) {
              onStartWorkout({
                type: finalType,
                subtype: finalSubtype,
                strengthType: isStrengthType ? activityType : undefined,
                focusAreas: isStrengthType && focusAreas.length > 0 ? focusAreas : undefined,
                focusArea: isStrengthType && focusAreas.length > 0 ? focusAreas[0] : undefined,
                sportEmoji,
                customEmoji: showCustomActivityInput ? customActivityEmoji : undefined,
                customIcon: showCustomActivityInput ? customActivityIcon : undefined,
                countToward: showCustomActivityInput ? customActivityCategory : (countToward || undefined),
                customActivityCategory: showCustomActivityInput ? customActivityCategory : undefined,
                startTime: new Date().toISOString()
              });
              handleClose();
              return;
            }

            // COMPLETED MODE: Normal save flow
            onSave({
              id: pendingActivity?.id, // Preserve ID if editing
              time: activityTime || pendingActivity?.time, // Use linked workout time, or preserve time if editing
              type: finalType,
              subtype: finalSubtype,
              strengthType: isStrengthType ? activityType : undefined,
              focusAreas: isStrengthType && focusAreas.length > 0 ? focusAreas : undefined,
              focusArea: isStrengthType && focusAreas.length > 0 ? focusAreas[0] : undefined,
              date,
              notes,
              distance: distance ? parseFloat(distance) : undefined,
              duration: activityType === 'Chiropractic' ? undefined : activityType === 'Contrast Therapy' ? (contrastColdMinutes + contrastHotMinutes) : (durationHours * 60 + durationMinutes),
              calories: calories ? parseInt(calories) : undefined,
              avgHr: avgHr ? parseInt(avgHr) : undefined,
              maxHr: maxHr ? parseInt(maxHr) : undefined,
              // Contrast Therapy fields
              ...(activityType === 'Contrast Therapy' ? {
                coldType: contrastColdType,
                hotType: contrastHotType,
                coldDuration: contrastColdMinutes,
                hotDuration: contrastHotMinutes,
              } : {}),
              saveCustomSport,
              sportEmoji,
              customEmoji: showCustomActivityInput ? customActivityEmoji : undefined, // Store emoji for old "Other" activities
              customIcon: showCustomActivityInput ? customActivityIcon : undefined, // Store icon name for new "Other" activities
              fromAppleHealth: isFromAppleHealth,
              linkedHealthKitUUID: linkedWorkout?.healthKitUUID || undefined, // Link to Apple Health workout
              linkedHealthKitStartDate: linkedWorkout?.healthKitStartDate || undefined,
              sourceDevice: linkedWorkout?.sourceDevice || pendingActivity?.sourceDevice || undefined, // Device that recorded the workout
              countToward: showCustomActivityInput ? customActivityCategory : (countToward || undefined),
              customActivityCategory: showCustomActivityInput ? customActivityCategory : undefined,
              // Photo data
              photoFile: activityPhoto,
              photoURL: !activityPhoto ? (pendingActivity?.photoURL || null) : undefined, // Preserve existing photo if not changing
              isPhotoPrivate: isPhotoPrivate,
              // Resolved challenge-fulfill intent: only set when there are matches the user could see
              // in the modal. An empty array is meaningful (= explicit "don't apply to any").
              intendedChallengeIds: matchingChallenges.length > 0
                ? matchingChallenges
                    .map(c => c.id)
                    .filter(id => effectiveChallengeSelection.has(id))
                : undefined,
            });
            handleClose();
          }}
          className="font-bold transition-all duration-150 px-2 py-1 rounded-lg"
          style={{ color: !activityType || (showCustomSportInput && !customSport) || (showCustomActivityInput && !isUncategorizedHKType && (!customActivityName || !customActivityCategory)) || (showCustomActivityInput && isUncategorizedHKType && !customActivityCategory) || (STRENGTH_TYPES.includes(activityType) && focusAreas.length === 0) ? 'rgba(0,255,148,0.3)' : '#00FF94' }}
          disabled={!activityType || (showCustomSportInput && !customSport) || (showCustomActivityInput && !isUncategorizedHKType && (!customActivityName || !customActivityCategory)) || (showCustomActivityInput && isUncategorizedHKType && !customActivityCategory) || (STRENGTH_TYPES.includes(activityType) && focusAreas.length === 0)}
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

      <div
        className="flex-1 overflow-y-auto p-4 pb-32"
        style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}
        onTouchMove={(e) => e.stopPropagation()}
      >
        {/* Initial choice: Log Completed vs Workout Timer */}
        {mode === null ? (
          <div className="flex flex-col gap-4 pt-4">
            {/* Workout Timer option - Primary */}
            <button
              onClick={() => {
                if (hasActiveWorkout) {
                  // Warn user there's already an active workout
                  alert('You already have an active timer in progress. Finish it first before starting a new one.');
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
                <svg className="w-7 h-7" fill="#00FF94" viewBox="0 0 24 24">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
                </svg>
              </div>
              <div className="flex-1">
                <div className="font-semibold text-lg" style={{ color: '#00FF94' }}>Start an Activity</div>
                <div className="text-sm text-gray-400 mt-0.5">Live heart rate & calorie tracking with Apple Watch</div>
              </div>
              <div className="text-gray-500">→</div>
            </button>

            {/* Log Completed option - Secondary */}
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
                <div className="font-semibold text-lg text-gray-300">Log Completed Activity</div>
                <div className="text-sm text-gray-500 mt-0.5">Record a workout you already finished</div>
              </div>
              <div className="text-gray-500">→</div>
            </button>

            {/* Tips for different device users */}
            <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="text-xs text-gray-500 space-y-1.5">
                <div className="flex items-start gap-2">
                  <span>⌚</span>
                  <span><span className="text-gray-400 font-medium">Apple Watch:</span> Start here or from your watch — workouts sync automatically.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span>📱</span>
                  <span><span className="text-gray-400 font-medium">Garmin, Whoop & Others:</span> Track natively on your device, then link the workout here afterwards.</span>
                </div>
              </div>
            </div>

            {/* Apple Health Workouts Section — only show when we have actual results */}
            {linkableWorkouts.length > 0 && (
              <>
                {/* Divider */}
                <div className="flex items-center gap-3 my-2">
                  <div className="flex-1 h-px bg-white/10" />
                  <span className="text-xs text-gray-500 uppercase tracking-wider">or</span>
                  <div className="flex-1 h-px bg-white/10" />
                </div>

                {/* Section Header */}
                <div className="mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">Choose from Synced Workouts</span>
                    {linkableWorkouts.length > 0 && (
                      <span className="text-xs text-gray-500">({linkableWorkouts.length})</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">These are activities logged directly on Apple Watch, Whoop, and other devices/apps</p>
                </div>

                {/* Workouts List */}
                <div className="space-y-2">
                    {linkableWorkouts
                      .slice()
                      .sort((a, b) => {
                        // Sort by date then time, most recent first
                        const parseDateTime = (dateStr, timeStr) => {
                          const date = dateStr ? new Date(dateStr + 'T12:00:00') : new Date();
                          let hours = 0, minutes = 0;
                          if (timeStr) {
                            const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
                            if (match) {
                              hours = parseInt(match[1], 10);
                              minutes = parseInt(match[2], 10);
                              const isPM = match[3].toUpperCase() === 'PM';
                              if (isPM && hours !== 12) hours += 12;
                              if (!isPM && hours === 12) hours = 0;
                            }
                          }
                          date.setHours(hours, minutes, 0, 0);
                          return date.getTime();
                        };
                        return parseDateTime(b.date, b.time) - parseDateTime(a.date, a.time);
                      })
                      .slice(0, showAllInitialWorkouts ? undefined : 3) // Show first 3 or all
                      .map((workout) => {
                        // Format date for display
                        const formatWorkoutDate = (dateStr) => {
                          if (!dateStr) return '';
                          const workoutDate = new Date(dateStr + 'T12:00:00');
                          const today = new Date();
                          today.setHours(12, 0, 0, 0);
                          const yesterday = new Date(today);
                          yesterday.setDate(yesterday.getDate() - 1);

                          if (workoutDate.toDateString() === today.toDateString()) {
                            return 'Today';
                          } else if (workoutDate.toDateString() === yesterday.toDateString()) {
                            return 'Yesterday';
                          } else {
                            return workoutDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                          }
                        };

                        return (
                          <button
                            key={workout.healthKitUUID}
                            onClick={() => {
                              // Pre-fill the form with workout data
                              setMode('completed');
                              setActivityType(workout.type);
                              setSubtype(workout.subtype || '');
                              if (workout.date) setDate(workout.date);
                              setLinkedWorkout(workout);
                              setDurationHours(Math.floor((workout.duration || 0) / 60));
                              setDurationMinutes((workout.duration || 0) % 60);
                              if (workout.calories) setCalories(String(workout.calories));
                              if (workout.distance) setDistance(String(workout.distance));
                              if (workout.avgHr) setAvgHr(String(workout.avgHr));
                              if (workout.maxHr) setMaxHr(String(workout.maxHr));
                              triggerHaptic(ImpactStyle.Medium);
                            }}
                            className="w-full p-3 rounded-xl text-left transition-all duration-150 flex items-center gap-3"
                            style={{
                              backgroundColor: 'rgba(255,255,255,0.05)',
                              border: '1px solid rgba(255,255,255,0.1)'
                            }}
                            onTouchStart={(e) => {
                              e.currentTarget.style.transform = 'scale(0.98)';
                              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)';
                            }}
                            onTouchEnd={(e) => {
                              e.currentTarget.style.transform = 'scale(1)';
                              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                            }}
                          >
                            <ActivityIcon type={workout.type} subtype={workout.subtype} size={24} />
                            <div className="flex-1 min-w-0">
                              <div className="text-white font-medium truncate">
                                {workout.appleWorkoutName || workout.subtype || workout.type}
                              </div>
                              <div className="text-xs text-gray-400 mt-0.5">
                                {formatWorkoutDate(workout.date)} • {workout.time} • {workout.duration} min
                              </div>
                              {(workout.calories || workout.distance) && (
                                <div className="flex gap-2 mt-1 text-xs text-gray-500">
                                  {workout.calories && <span>🔥 {workout.calories} cal</span>}
                                  {workout.distance && <span>📍 {parseFloat(workout.distance).toFixed(2)} mi</span>}
                                </div>
                              )}
                            </div>
                            <span className="text-gray-500">→</span>
                          </button>
                        );
                      })}

                    {/* See all link if more than 3 */}
                    {linkableWorkouts.length > 3 && !showAllInitialWorkouts && (
                      <button
                        onClick={() => {
                          setShowAllInitialWorkouts(true);
                          triggerHaptic(ImpactStyle.Light);
                        }}
                        className="w-full py-2 text-center text-sm text-gray-400 hover:text-white transition-colors"
                      >
                        See all {linkableWorkouts.length} workouts →
                      </button>
                    )}
                  </div>
              </>
            )}
          </div>
        ) : !activityType ? (
          <div className="flex flex-wrap gap-2">
            {/* Back to mode selection or back to pre-filled workout */}
            {!pendingActivity ? (
              <button
                onClick={() => {
                  setMode(null);
                  triggerHaptic(ImpactStyle.Light);
                }}
                className="w-full mb-2 flex items-center gap-2 text-gray-400 text-sm"
              >
                <span>←</span>
                <span>Back</span>
              </button>
            ) : isChangingActivityType && pendingActivity?.type && (
              <button
                onClick={() => {
                  // Go back to the original workout type (map Strength Training to flattened type)
                  const origType = pendingActivity.type === 'Strength Training' && pendingActivity.strengthType
                    ? pendingActivity.strengthType : pendingActivity.type;
                  setActivityType(origType);
                  setSubtype(pendingActivity.subtype || '');
                  setIsChangingActivityType(false);
                  triggerHaptic(ImpactStyle.Light);
                }}
                className="w-full mb-2 flex items-center gap-2 text-gray-400 text-sm"
              >
                <span>←</span>
                <span>Back</span>
              </button>
            )}
            {/* Activity types organized by category - compact design */}
            {activityCategories.map((category, catIndex) => {
              const categoryTypes = activityTypes.filter(t => t.category === category.id);
              if (categoryTypes.length === 0) return null;
              return (
                <React.Fragment key={category.id}>
                  {/* Category header */}
                  <div className={`w-full flex items-center gap-2 ${catIndex === 0 ? '' : 'mt-3'} mb-2`}>
                    <span className="text-gray-400">{categoryIcons[category.id]}</span>
                    <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{category.label}</span>
                  </div>
                  {/* Category activities - horizontal pill buttons */}
                  {categoryTypes.map((type) => (
                    <button
                      key={type.name}
                      onClick={() => {
                        setActivityType(type.name);
                        // Reset focus areas when changing activity type
                        if (STRENGTH_TYPES.includes(type.name)) {
                          setStrengthType(type.name);
                          setFocusAreas([]);
                        }
                        // Set default duration based on activity type
                        if (type.name === 'Sauna') {
                          setDurationHours(0);
                          setDurationMinutes(10);
                        } else if (type.name === 'Cold Plunge') {
                          setDurationHours(0);
                          setDurationMinutes(5);
                        } else if (type.name === 'Contrast Therapy') {
                          setDurationHours(0);
                          setDurationMinutes(15);
                        } else if (type.name === 'Stair Climbing' || type.name === 'Elliptical') {
                          setDurationHours(0);
                          setDurationMinutes(20);
                        } else if (!pendingActivity?.durationHours && !pendingActivity?.durationMinutes) {
                          // Reset to default 1 hour for other activities (only if not editing)
                          setDurationHours(1);
                          setDurationMinutes(0);
                        }
                        setIsChangingActivityType(false);
                      }}
                      className="flex items-center gap-2 px-3 py-2 rounded-full transition-all duration-150 active:scale-95"
                      style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                      onTouchStart={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.12)';
                        triggerHaptic(ImpactStyle.Light);
                      }}
                      onTouchEnd={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                      }}
                      onMouseDown={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.12)';
                      }}
                      onMouseUp={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                      }}
                    >
                      <ActivityIcon type={type.name} size={18} />
                      <span className="text-sm font-medium whitespace-nowrap">{type.name}</span>
                    </button>
                  ))}
                </React.Fragment>
              );
            })}

            {/* Other section with custom activities */}
            <div className="w-full flex items-center gap-2 mt-3 mb-2">
              <span className="text-gray-400">{categoryIcons.other}</span>
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Other</span>
            </div>
            {/* User's saved custom activities */}
            {customActivities.map((customItem) => {
              // Support old string format, object with emoji, and new object with icon
              const activityName = typeof customItem === 'string' ? customItem : customItem.name;
              const activityIconName = typeof customItem === 'object' ? customItem.icon : undefined;
              const activityEmoji = typeof customItem === 'string' ? '' : (customItem.emoji || '');
              return (
                <button
                  key={`custom-${activityName}`}
                  onClick={() => {
                    setActivityType('Other');
                    setCustomActivityName(activityName);
                    if (activityIconName) {
                      setCustomActivityIcon(activityIconName);
                      setCustomActivityEmoji('');
                    } else {
                      setCustomActivityEmoji(activityEmoji);
                      setCustomActivityIcon(activityEmoji ? '' : 'CirclePlus');
                    }
                    setIsChangingActivityType(false);
                  }}
                  className="flex items-center gap-2 px-3 py-2 rounded-full transition-all duration-150 active:scale-95"
                  style={{ backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(0,255,148,0.2)' }}
                  onTouchStart={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.12)';
                    triggerHaptic(ImpactStyle.Light);
                  }}
                  onTouchEnd={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                  }}
                  onMouseDown={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.12)';
                  }}
                  onMouseUp={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                  }}
                >
                  {activityIconName ? (
                    <ActivityIcon type="Other" customIcon={activityIconName} size={18} />
                  ) : activityEmoji ? (
                    <span className="text-base">{activityEmoji}</span>
                  ) : (
                    <ActivityIcon type="Other" size={18} />
                  )}
                  <span className="text-sm font-medium whitespace-nowrap">{activityName}</span>
                </button>
              );
            })}
            {/* "Other" option always shown last */}
            <button
              key="Other"
              onClick={() => setActivityType('Other')}
              className="flex items-center gap-2 px-3 py-2 rounded-full transition-all duration-150 active:scale-95"
              style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
              onTouchStart={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.12)';
                triggerHaptic(ImpactStyle.Light);
              }}
              onTouchEnd={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
              }}
              onMouseDown={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.12)';
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
              }}
            >
              <ActivityIcon type="Other" size={18} />
              <span className="text-sm font-medium">Custom</span>
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Back button — hidden when single notification (header Cancel is enough) */}
            {!(isFromNotification && otherPendingWorkoutsCount === 0) && (
            <button
              onClick={() => {
                if (isFromNotification && otherPendingWorkoutsCount > 0 && onBackToWorkoutPicker) {
                  // Multiple pending workouts — go back to the workout picker modal
                  onBackToWorkoutPicker();
                  return;
                }
                setActivityType(null);
                setSubtype('');
                setStrengthType('');
                setFocusAreas([]);
                setCustomSport('');
                setCustomActivityName('');
                setCustomActivityEmoji('');
                setCustomActivityIcon('CirclePlus');
                setShowIconPicker(false);
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
              <span>{isFromNotification ? 'Back to linked activities' : 'Back to activities'}</span>
            </button>
            )}

            {/* Selected activity display with Change option */}
            <button
              onClick={() => {
                setIsChangingActivityType(true);
                setActivityType(null);
                setSubtype('');
                setStrengthType('');
                setFocusAreas([]);
                setCustomSport('');
                setCustomActivityName('');
                setCustomActivityEmoji('');
                setCustomActivityIcon('CirclePlus');
                setShowIconPicker(false);
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
              <span className="text-2xl flex items-center">{(() => {
                // Determine live color based on selected category
                const HEADER_COLORS = { strength: '#00FF94', cardio: '#FF9500', recovery: '#00D1FF', lifting: '#00FF94' };
                const selectedCategory = (isUncategorizedHKType || activityType === 'Other') ? customActivityCategory : countToward;
                const liveColor = selectedCategory ? HEADER_COLORS[selectedCategory] : undefined;
                if (activityType === 'Other' && customActivityIcon) return <ActivityIcon type="Other" customIcon={customActivityIcon} size={24} color={liveColor} />;
                if (activityType === 'Other') return customActivityEmoji || <ActivityIcon type="Other" size={24} color={liveColor} />;
                if (activityType === 'Sports' && subtype) {
                  if (subtype === 'Other') return customSportEmoji;
                  return <ActivityIcon type="Sports" subtype={subtype} size={24} color={liveColor} />;
                }
                return <ActivityIcon type={activityType} size={24} color={liveColor} />;
              })()}</span>
              <span className="font-semibold">{
                activityType === 'Sports' && subtype && subtype !== 'Other' ? subtype :
                activityType === 'Other' && customActivityName ? customActivityName : activityType
              }</span>
              <span className="ml-auto text-gray-500 text-sm">Change</span>
            </button>

            {/* Focus Area Selection — shown for all flattened strength types */}
            {STRENGTH_TYPES.includes(activityType) && (
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">Focus Areas</label>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(FOCUS_AREA_GROUPS).map(([groupName, members]) => {
                    const allSelected = members.every(m => focusAreas.includes(m));
                    const someSelected = members.some(m => focusAreas.includes(m));
                    return (
                      <div key={groupName} className="flex flex-col gap-1.5">
                        {/* Group header — select/deselect all */}
                        <button
                          onClick={() => toggleFocusGroup(groupName)}
                          className="px-2 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 text-center"
                          style={{
                            backgroundColor: allSelected ? 'rgba(0,255,148,0.25)' : someSelected ? 'rgba(0,255,148,0.1)' : 'rgba(255,255,255,0.08)',
                            border: allSelected ? '1px solid #00FF94' : someSelected ? '1px solid rgba(0,255,148,0.4)' : '1px solid rgba(255,255,255,0.15)',
                            color: allSelected || someSelected ? '#00FF94' : 'rgba(255,255,255,0.7)'
                          }}
                        >
                          {groupName}
                        </button>
                        {/* Individual muscles */}
                        {members.map((area) => (
                          <button
                            key={area}
                            onClick={() => toggleFocusArea(area)}
                            className="px-2 py-1.5 rounded-lg text-xs transition-all duration-200 text-center"
                            style={{
                              backgroundColor: focusAreas.includes(area) ? 'rgba(0,255,148,0.2)' : 'rgba(255,255,255,0.05)',
                              border: focusAreas.includes(area) ? '1px solid #00FF94' : '1px solid transparent',
                              color: focusAreas.includes(area) ? '#00FF94' : 'white'
                            }}
                          >
                            {area}
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Regular subtypes for non-strength activities */}
            {!STRENGTH_TYPES.includes(activityType) && selectedType?.subtypes.length > 0 && (
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
                        {activityType === 'Sports' ? <ActivityIcon type="Sports" subtype={stName} size={14} /> : stIcon ? <span>{stIcon}</span> : null}
                        {stName}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Count Toward selector for all standard activities */}
            {showCountToward && (
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">Count Toward</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (countToward === 'lifting+cardio') setCountToward('cardio');
                      else if (countToward === 'cardio') setCountToward('lifting+cardio');
                      else setCountToward('lifting');
                    }}
                    className="flex-1 p-3 rounded-xl text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2"
                    style={{
                      backgroundColor: (countToward === 'lifting' || countToward === 'lifting+cardio') ? 'rgba(0,255,148,0.2)' : 'rgba(255,255,255,0.05)',
                      border: (countToward === 'lifting' || countToward === 'lifting+cardio') ? '1px solid #00FF94' : '1px solid transparent',
                      color: (countToward === 'lifting' || countToward === 'lifting+cardio') ? '#00FF94' : 'white'
                    }}
                  >
                    <span>💪</span> Strength
                  </button>
                  <button
                    onClick={() => {
                      if (countToward === 'lifting+cardio') setCountToward('lifting');
                      else if (countToward === 'lifting') setCountToward('lifting+cardio');
                      else setCountToward('cardio');
                    }}
                    className="flex-1 p-3 rounded-xl text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2"
                    style={{
                      backgroundColor: (countToward === 'cardio' || countToward === 'lifting+cardio') ? 'rgba(255,149,0,0.2)' : 'rgba(255,255,255,0.05)',
                      border: (countToward === 'cardio' || countToward === 'lifting+cardio') ? '1px solid #FF9500' : '1px solid transparent',
                      color: (countToward === 'cardio' || countToward === 'lifting+cardio') ? '#FF9500' : 'white'
                    }}
                  >
                    <span>❤️‍🔥</span> Cardio
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
                {countToward === 'lifting+cardio' && (
                  <p className="text-[11px] text-gray-500 mt-2">
                    Circuit training combines resistance exercises with elevated heart rates, so it can count toward both strength and cardio goals.
                  </p>
                )}
                {/* Second row: Warm Up + Don't Count (Walking only) */}
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => setCountToward('warmup')}
                    className="flex-1 py-2 px-3 rounded-xl text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2"
                    style={{
                      backgroundColor: countToward === 'warmup' ? 'rgba(255,214,10,0.2)' : 'rgba(255,255,255,0.05)',
                      border: countToward === 'warmup' ? '1px solid #FFD60A' : '1px solid transparent',
                      color: countToward === 'warmup' ? '#FFD60A' : 'white'
                    }}
                  >
                    <span>🔥</span> Warm Up
                  </button>
                  {activityType === 'Walking' && (
                    <button
                      onClick={() => setCountToward(null)}
                      className="flex-1 py-2 px-3 rounded-xl text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2"
                      style={{
                        backgroundColor: countToward === null ? 'rgba(128,128,128,0.2)' : 'rgba(255,255,255,0.05)',
                        border: countToward === null ? '1px solid #808080' : '1px solid transparent',
                        color: countToward === null ? '#B0B0B0' : 'white'
                      }}
                    >
                      <span>➖</span> Don't Count
                    </button>
                  )}
                </div>
                {countToward === 'warmup' && (
                  <p className="text-[11px] text-gray-500 mt-2">
                    Warm-up activities won't count toward weekly goals, streaks, or personal records.
                  </p>
                )}
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

            {/* Custom "Other" Activity Input OR Uncategorized Apple Health Type */}
            {showCustomActivityInput && (
              <div className="p-4 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">
                  {isUncategorizedHKType ? 'Choose an Icon' : 'Activity Name'}
                </label>
                <div className="flex gap-2 mb-3">
                  {/* Icon Picker Button */}
                  <button
                    type="button"
                    onClick={() => setShowIconPicker(!showIconPicker)}
                    onTouchStart={() => triggerHaptic(ImpactStyle.Light)}
                    className="w-12 h-12 rounded-xl flex items-center justify-center transition-all"
                    style={{
                      backgroundColor: showIconPicker ? 'rgba(0,255,148,0.2)' : 'rgba(255,255,255,0.05)',
                      border: showIconPicker ? '1px solid #00FF94' : '1px solid rgba(255,255,255,0.1)'
                    }}
                  >
                    <ActivityIcon
                      type={isUncategorizedHKType ? activityType : 'Other'}
                      customIcon={customActivityIcon}
                      size={22}
                      color={customActivityCategory ? (
                        customActivityCategory === 'strength' ? '#00FF94' :
                        customActivityCategory === 'cardio' ? '#FF9500' :
                        customActivityCategory === 'recovery' ? '#00D1FF' :
                        customActivityCategory === 'warmup' ? '#FFD60A' : undefined
                      ) : undefined}
                    />
                  </button>
                  {isUncategorizedHKType ? (
                    <div className="flex-1 p-3 rounded-xl bg-white/5 border border-white/10 text-white flex items-center">
                      {customActivityName}
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={customActivityName}
                      onChange={(e) => setCustomActivityName(e.target.value)}
                      className="flex-1 p-3 rounded-xl bg-white/5 border border-white/10 text-white"
                      placeholder="Enter activity name..."
                    />
                  )}
                </div>

                {/* Icon Picker Grid — categorized */}
                {showIconPicker && (
                  <div className="mb-3 p-3 rounded-xl space-y-3" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    {ICON_PICKER_CATEGORIES.map((category) => (
                      <div key={category.label}>
                        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">{category.label}</div>
                        <div className="flex flex-wrap gap-2">
                          {category.icons.map(({ name, Icon }) => (
                            <button
                              key={name}
                              type="button"
                              onClick={() => {
                                setCustomActivityIcon(name);
                                setCustomActivityEmoji(''); // Clear old emoji
                                setShowIconPicker(false);
                                triggerHaptic(ImpactStyle.Light);
                              }}
                              className="w-10 h-10 rounded-lg flex items-center justify-center transition-all hover:bg-white/10"
                              style={{
                                backgroundColor: customActivityIcon === name ? 'rgba(0,255,148,0.2)' : 'transparent',
                                border: customActivityIcon === name ? '1px solid #00FF94' : '1px solid transparent'
                              }}
                            >
                              <Icon size={20} color={customActivityIcon === name ? '#00FF94' : '#9CA3AF'} strokeWidth={2} />
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
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
                      <span className="text-lg">💪</span>
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
                      <span className="text-lg">❤️‍🔥</span>
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
                  <button
                    type="button"
                    onClick={() => { setCustomActivityCategory('warmup'); triggerHaptic(ImpactStyle.Light); }}
                    className="w-full mt-2 py-2 px-3 rounded-xl text-center transition-all flex items-center justify-center gap-2"
                    style={{
                      backgroundColor: customActivityCategory === 'warmup' ? 'rgba(255,214,10,0.15)' : 'rgba(255,255,255,0.05)',
                      border: customActivityCategory === 'warmup' ? '1px solid #FFD60A' : '1px solid transparent'
                    }}
                  >
                    <span className="text-sm">🔥</span>
                    <span className="text-xs font-medium" style={{ color: customActivityCategory === 'warmup' ? '#FFD60A' : 'rgba(255,255,255,0.6)' }}>Warm Up</span>
                  </button>
                  {customActivityCategory === 'warmup' && (
                    <p className="text-[11px] text-gray-500 mt-2">
                      Warm-up activities won't count toward weekly goals, streaks, or personal records.
                    </p>
                  )}
                </div>

                {isUncategorizedHKType ? (
                  <>
                    <label className="flex items-center gap-3 cursor-pointer mt-4">
                      <div
                        className="w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all"
                        style={{
                          borderColor: saveHKIcon ? '#00FF94' : 'rgba(255,255,255,0.3)',
                          backgroundColor: saveHKIcon ? 'rgba(0,255,148,0.2)' : 'transparent'
                        }}
                        onClick={() => { setSaveHKIcon(!saveHKIcon); triggerHaptic(ImpactStyle.Light); }}
                      >
                        {saveHKIcon && <span style={{ color: '#00FF94' }}>✓</span>}
                      </div>
                      <span className="text-sm text-gray-400">Remember icon for future {customActivityName} workouts</span>
                    </label>
                    {customActivityCategory && (
                      <label className="flex items-center gap-3 cursor-pointer mt-3">
                        <div
                          className="w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all"
                          style={{
                            borderColor: saveHKCategory ? '#00FF94' : 'rgba(255,255,255,0.3)',
                            backgroundColor: saveHKCategory ? 'rgba(0,255,148,0.2)' : 'transparent'
                          }}
                          onClick={() => { setSaveHKCategory(!saveHKCategory); triggerHaptic(ImpactStyle.Light); }}
                        >
                          {saveHKCategory && <span style={{ color: '#00FF94' }}>✓</span>}
                        </div>
                        <span className="text-sm text-gray-400">
                          Always count {customActivityName} toward {
                            customActivityCategory === 'strength' ? 'Strength' :
                            customActivityCategory === 'cardio' ? 'Cardio' :
                            customActivityCategory === 'recovery' ? 'Recovery' :
                            customActivityCategory === 'warmup' ? 'Warm Up' : customActivityCategory
                          }
                        </span>
                      </label>
                    )}
                  </>
                ) : (
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
                )}
              </div>
            )}

            {mode !== 'start' && (activityType === 'Running' || activityType === 'Cycle' || activityType === 'Walking') && (
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
            {activityType === 'Contrast Therapy' ? (
            <div className="space-y-4">
              {/* Cold Type Picker */}
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">Cold</label>
                <div className="flex gap-2 mb-2">
                  {['Cold Plunge', 'Cold Shower'].map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setContrastColdType(type)}
                      className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all duration-150"
                      style={{
                        backgroundColor: contrastColdType === type ? 'rgba(0, 209, 255, 0.15)' : 'rgba(255,255,255,0.05)',
                        border: contrastColdType === type ? '1px solid rgba(0, 209, 255, 0.4)' : '1px solid rgba(255,255,255,0.1)',
                        color: contrastColdType === type ? '#00D1FF' : 'rgba(255,255,255,0.5)'
                      }}
                    >
                      {type === 'Cold Plunge' ? '🧊' : '🚿'} {type}
                    </button>
                  ))}
                </div>
                <MinutesPicker value={contrastColdMinutes} onChange={setContrastColdMinutes} />
              </div>
              {/* Hot Type Picker */}
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">Hot</label>
                <div className="flex gap-2 mb-2">
                  {['Sauna', 'Hot Plunge'].map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setContrastHotType(type)}
                      className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all duration-150"
                      style={{
                        backgroundColor: contrastHotType === type ? 'rgba(255, 149, 0, 0.15)' : 'rgba(255,255,255,0.05)',
                        border: contrastHotType === type ? '1px solid rgba(255, 149, 0, 0.4)' : '1px solid rgba(255,255,255,0.1)',
                        color: contrastHotType === type ? '#FF9500' : 'rgba(255,255,255,0.5)'
                      }}
                    >
                      {type === 'Sauna' ? '🔥' : '♨️'} {type}
                    </button>
                  ))}
                </div>
                <MinutesPicker value={contrastHotMinutes} onChange={setContrastHotMinutes} />
              </div>
              {/* Total Duration */}
              <div className="text-center text-xs text-gray-500">
                Total: {contrastColdMinutes + contrastHotMinutes} min
              </div>
            </div>
            ) : activityType !== 'Chiropractic' && (
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
            )}

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

            {/* Link to Apple Health Workout Section */}
            {!isFromAppleHealth && (linkableWorkouts.length > 0 || isLoadingWorkouts || linkedWorkout) && (
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">
                  Link to Apple Health Workout
                </label>
                {isLoadingWorkouts ? (
                  <div className="flex items-center justify-center p-4 rounded-xl bg-white/5 border border-white/10">
                    <span className="text-gray-500 text-sm">Finding workouts...</span>
                  </div>
                ) : linkableWorkouts.length === 0 && !linkedWorkout ? (
                  <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-center">
                    <span className="text-gray-500 text-sm">No workouts found for this date</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {(() => {
                      // Helper function to parse time strings like "7:30 AM" for sorting
                      const parseTime = (timeStr) => {
                        if (!timeStr) return 0;
                        const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
                        if (!match) return 0;
                        let hours = parseInt(match[1], 10);
                        const minutes = parseInt(match[2], 10);
                        const isPM = match[3].toUpperCase() === 'PM';
                        if (isPM && hours !== 12) hours += 12;
                        if (!isPM && hours === 12) hours = 0;
                        return hours * 60 + minutes;
                      };

                      // Filter and sort workouts by time (most recent first)
                      // Dismissed workouts are already filtered at fetch time, just sort here
                      const filteredAndSortedWorkouts = linkableWorkouts
                        .sort((a, b) => parseTime(b.time) - parseTime(a.time));

                      // Count of other workouts (excluding linked one)
                      const otherWorkoutsCount = filteredAndSortedWorkouts.filter(w => w.healthKitUUID !== linkedWorkout?.healthKitUUID).length;

                      return isFromNotification && linkedWorkout && !showOtherLinkableWorkouts ? (
                      <>
                        <div
                          className="p-3 rounded-xl bg-[#00FF94]/20 border-2 border-[#00FF94] cursor-pointer transition-all"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <ActivityIcon type={linkedWorkout.type} subtype={linkedWorkout.subtype} size={20} />
                              <div>
                                <div className="text-white text-sm font-medium">
                                  {linkedWorkout.appleWorkoutName || linkedWorkout.subtype || linkedWorkout.type}
                                </div>
                                <div className="text-xs text-gray-500">
                                  {linkedWorkout.time} • {linkedWorkout.duration} min
                                  {linkedWorkout.sourceDevice && <span className="text-cyan-400"> • {linkedWorkout.sourceDevice}</span>}
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <span className="text-[#00FF94] text-xs font-medium">✓ Linked</span>
                            </div>
                          </div>
                          {/* Show metrics preview */}
                          {(linkedWorkout.calories || linkedWorkout.avgHr || linkedWorkout.distance) && (
                            <div className="flex gap-4 mt-2 text-xs text-gray-400">
                              {linkedWorkout.calories && (
                                <span>🔥 {linkedWorkout.calories} cal</span>
                              )}
                              {linkedWorkout.avgHr && (
                                <span>❤️ {linkedWorkout.avgHr} bpm avg</span>
                              )}
                              {linkedWorkout.distance && (
                                <span>📍 {parseFloat(linkedWorkout.distance).toFixed(2)} mi</span>
                              )}
                            </div>
                          )}
                        </div>
                        {/* Show "See others" button if there are other non-dismissed workouts available */}
                        {otherWorkoutsCount > 0 && (
                          <button
                            onClick={() => setShowOtherLinkableWorkouts(true)}
                            className="w-full py-2 text-center text-sm transition-all active:opacity-70"
                            style={{ color: '#00FF94' }}
                          >
                            See other workouts ({otherWorkoutsCount})
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        {/* Show all linkable workouts (filtered and sorted) */}
                        {filteredAndSortedWorkouts.map((workout) => {
                          const isLinked = linkedWorkout?.healthKitUUID === workout.healthKitUUID;
                          return (
                            <div
                              key={workout.healthKitUUID || workout.id}
                              onClick={() => handleLinkWorkout(workout)}
                              className={`w-full p-3 rounded-xl text-left transition-all cursor-pointer ${
                                isLinked
                                  ? 'bg-[#00FF94]/20 border-2 border-[#00FF94]'
                                  : 'bg-white/5 border border-white/10 active:bg-white/20'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <ActivityIcon type={workout.type} subtype={workout.subtype} size={20} />
                                  <div>
                                    <div className="text-white text-sm font-medium">
                                      {workout.appleWorkoutName || workout.subtype || workout.type}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                      {workout.time} • {workout.duration} min
                                      {workout.sourceDevice && <span className="text-cyan-400"> • {workout.sourceDevice}</span>}
                                    </div>
                                  </div>
                                </div>
                                <div className="text-right">
                                  {isLinked ? (
                                    <span className="text-[#00FF94] text-xs font-medium">✓ Linked</span>
                                  ) : (
                                    <span className="text-gray-500 text-xs">Tap to link</span>
                                  )}
                                </div>
                              </div>
                              {/* Show metrics preview */}
                              {(workout.calories || workout.avgHr) && (
                                <div className="flex gap-4 mt-2 text-xs text-gray-400">
                                  {workout.calories && (
                                    <span>🔥 {workout.calories} cal</span>
                                  )}
                                  {workout.avgHr && (
                                    <span>❤️ {workout.avgHr} bpm avg</span>
                                  )}
                                  {workout.distance && (
                                    <span>📍 {parseFloat(workout.distance).toFixed(2)} mi</span>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {linkedWorkout && !linkableWorkouts.find(w => w.healthKitUUID === linkedWorkout.healthKitUUID) && (
                          <div
                            onClick={() => handleLinkWorkout(linkedWorkout)}
                            className="p-3 rounded-xl bg-[#00FF94]/20 border-2 border-[#00FF94] cursor-pointer transition-all"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <ActivityIcon type={linkedWorkout.type} subtype={linkedWorkout.subtype} size={20} />
                                <div>
                                  <div className="text-white text-sm font-medium">
                                    {linkedWorkout.appleWorkoutName || linkedWorkout.subtype || linkedWorkout.type}
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    {linkedWorkout.time} • {linkedWorkout.duration} min
                                    {linkedWorkout.sourceDevice && <span className="text-cyan-400"> • {linkedWorkout.sourceDevice}</span>}
                                  </div>
                                </div>
                              </div>
                              <div className="text-right">
                                <span className="text-[#00FF94] text-xs font-medium">✓ Linked</span>
                              </div>
                            </div>
                            {/* Show metrics preview */}
                            {(linkedWorkout.calories || linkedWorkout.distance) && (
                              <div className="flex gap-4 mt-2 text-xs text-gray-400">
                                {linkedWorkout.calories && (
                                  <span>🔥 {linkedWorkout.calories} cal</span>
                                )}
                                {linkedWorkout.distance && (
                                  <span>📍 {parseFloat(linkedWorkout.distance).toFixed(2)} mi</span>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                        {/* Show "Show less" button when in notification flow and showing others */}
                        {isFromNotification && showOtherLinkableWorkouts && (
                          <button
                            onClick={() => setShowOtherLinkableWorkouts(false)}
                            className="w-full py-2 text-center text-sm text-gray-400 transition-all active:opacity-70"
                          >
                            Show less
                          </button>
                        )}
                      </>
                    );
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* Optional Metrics Section */}
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">
                Workout Metrics {isFromAppleHealth ? <span style={{ color: '#00FF94' }}>(from Apple Health)</span> : linkedWorkout ? <span style={{ color: '#00FF94' }}>(from linked workout)</span> : <span className="text-gray-600">(optional)</span>}
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

            {(matchingChallenges.length > 0 || shortChallenges.length > 0) && (
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">
                  {matchingChallenges.length > 0
                    ? `Fulfilling ${matchingChallenges.length === 1 ? 'a challenge' : `${matchingChallenges.length} challenges`}`
                    : 'Active challenges'}
                </label>
                <div className="space-y-2">
                  {matchingChallenges.map(c => {
                    const isSelected = effectiveChallengeSelection.has(c.id);
                    const senderName = friendsByUid[c.challengerUid]?.displayName
                      || friendsByUid[c.challengerUid]?.username
                      || c.challengerName
                      || 'Friend';
                    const cat = c.matchRule?.category;
                    const tint = cat === 'lifting' ? '#00FF94' : cat === 'cardio' ? '#FF9500' : cat === 'recovery' ? '#00D1FF' : '#FFD60A';
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => { triggerHaptic(ImpactStyle.Light); toggleChallengeFulfill(c.id); }}
                        className="w-full flex items-center gap-3 p-3 rounded-xl text-left"
                        style={{
                          backgroundColor: isSelected ? `${tint}1A` : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${isSelected ? tint : 'rgba(255,255,255,0.08)'}`,
                        }}
                      >
                        <div
                          className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
                          style={{
                            backgroundColor: isSelected ? tint : 'transparent',
                            border: `1.5px solid ${isSelected ? tint : 'rgba(255,255,255,0.3)'}`,
                          }}
                        >
                          {isSelected && (
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                              <path d="M2 6.5L4.5 9L10 3" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm font-medium truncate">{senderName}'s challenge</p>
                          <p className="text-gray-500 text-xs truncate">{describeMatchRule(c.matchRule)}{c.title ? ` · ${c.title}` : ''}{c.requirePhoto ? ' · 📸 photo required' : ''}</p>
                        </div>
                      </button>
                    );
                  })}

                  {shortChallenges.map(({ challenge: c, shortBy }) => {
                    const senderName = friendsByUid[c.challengerUid]?.displayName
                      || friendsByUid[c.challengerUid]?.username
                      || c.challengerName
                      || 'Friend';
                    const shortLabel = shortBy?.distance
                      ? `${parseFloat(shortBy.distance).toFixed(shortBy.distance % 1 === 0 ? 0 : 1)} mi short`
                      : shortBy?.duration
                        ? `${Math.ceil(shortBy.duration)} min short`
                        : 'Below target';
                    return (
                      <div
                        key={c.id}
                        className="w-full flex items-center gap-3 p-3 rounded-xl"
                        style={{
                          backgroundColor: 'rgba(255,255,255,0.02)',
                          border: '1px dashed rgba(255,255,255,0.12)',
                          opacity: 0.6,
                        }}
                      >
                        <div className="w-5 h-5 rounded-md flex-shrink-0" style={{ border: '1.5px dashed rgba(255,255,255,0.25)' }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-gray-300 text-sm font-medium truncate">{senderName}'s challenge</p>
                          <p className="text-gray-500 text-xs truncate">{describeMatchRule(c.matchRule)} · <span style={{ color: '#FF9F0A' }}>{shortLabel}</span></p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

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

              {isLoadingPhoto ? (
                <div className="w-full h-48 rounded-xl bg-white/5 flex items-center justify-center">
                  <div className="w-8 h-8 border-2 border-gray-500 border-t-[#00FF94] rounded-full animate-spin" />
                </div>
              ) : photoPreview ? (
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

// Swipeable Workout Item for workout picker (swipe left to delete, like activity items)
const SwipeableWorkoutItem = ({ workout, onSelect, onDismiss }) => {
  const [swipeX, setSwipeX] = useState(0);
  const [touchStart, setTouchStart] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const deleteButtonWidth = 100;
  const snapThreshold = 40;

  // Format date for display
  const formatWorkoutDate = (dateStr) => {
    if (!dateStr) return '';
    const workoutDate = new Date(dateStr + 'T12:00:00');
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (workoutDate.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (workoutDate.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    } else {
      return workoutDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }
  };

  const handleDeleteClick = (e) => {
    e.stopPropagation();
    triggerHaptic(ImpactStyle.Medium);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    setShowDeleteConfirm(false);
    setSwipeX(-300);
    setTimeout(() => onDismiss(), 200);
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirm(false);
    setSwipeX(0);
  };

  const showDeleteButton = swipeX < 0;

  return (
    <>
      <div
        className="relative overflow-hidden rounded-xl"
        style={{
          backgroundColor: showDeleteButton ? '#FF453A' : 'transparent'
        }}
      >
        {/* Delete button - only visible when swiped */}
        {showDeleteButton && (
          <div
            className="absolute right-0 top-0 bottom-0 flex items-center justify-center"
            style={{ width: deleteButtonWidth }}
          >
            <button
              onClick={handleDeleteClick}
              className="w-full h-full flex items-center justify-center"
            >
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        )}

        {/* Swipeable content */}
        <div
          className="relative w-full p-4 text-left rounded-xl"
          style={{
            backgroundColor: '#1a1a1a',
            border: '1px solid rgba(255,255,255,0.1)',
            transform: `translateX(${swipeX}px)`,
            transition: touchStart ? 'none' : 'transform 0.3s ease-out'
          }}
          onTouchStart={(e) => {
            setTouchStart(e.touches[0].clientX);
          }}
          onTouchMove={(e) => {
            if (touchStart === null) return;
            const diff = e.touches[0].clientX - touchStart;
            if (diff < 0) {
              setSwipeX(Math.max(-deleteButtonWidth - 20, diff));
            } else if (swipeX < 0) {
              setSwipeX(Math.min(0, swipeX + diff));
            }
          }}
          onTouchEnd={() => {
            // Snap to open or closed position
            if (swipeX < -snapThreshold) {
              setSwipeX(-deleteButtonWidth);
            } else {
              setSwipeX(0);
            }
            setTouchStart(null);
          }}
          onClick={() => {
            if (swipeX === 0) {
              onSelect();
            } else {
              // Close the swipe if it's open
              setSwipeX(0);
            }
          }}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
              <ActivityIcon type={workout.type} subtype={workout.subtype} customIcon={workout.customIcon} customEmoji={workout.customEmoji} sportEmoji={workout.sportEmoji} strengthType={workout.strengthType} size={22} />
            </div>
            <div className="flex-1">
              <div className="text-white font-medium">
                {workout.appleWorkoutName || workout.subtype || workout.type}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                {formatWorkoutDate(workout.date)}{workout.date && ' • '}{workout.time} • {workout.duration} min
                {workout.sourceDevice && <span className="text-cyan-400"> • {workout.sourceDevice}</span>}
              </div>
              {(workout.calories || workout.distance || workout.avgHr) && (
                <div className="flex gap-3 mt-1.5 text-xs text-gray-500">
                  {workout.calories && <span>🔥 {workout.calories} cal</span>}
                  {workout.distance && <span>📍 {parseFloat(workout.distance).toFixed(2)} mi</span>}
                  {workout.avgHr && <span>♥ {workout.avgHr} bpm</span>}
                </div>
              )}
          </div>
          <span className="text-[#00FF94]">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </span>
        </div>
      </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={handleCancelDelete}>
          <div className="absolute inset-0 bg-black/70" />
          <div className="relative bg-zinc-900 rounded-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-2">Dismiss Workout?</h3>
            <p className="text-gray-400 text-sm mb-6">This workout won't appear in notifications again.</p>
            <div className="flex gap-3">
              <button
                onClick={handleCancelDelete}
                className="flex-1 py-3 rounded-xl font-medium bg-zinc-800 text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="flex-1 py-3 rounded-xl font-medium bg-red-500 text-white"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
};

// Home Tab - Simplified

const HomeTab = ({ onAddActivity, pendingSync, activities = [], weeklyProgress: propWeeklyProgress, userData, userProfile, onDeleteActivity, onEditActivity, user, weeklyGoalsRef, latestActivityRef, healthKitData = {}, onDismissWorkout, onWorkoutPickerChange, isPro, onPresentPaywall, onUseStreakShield, onDeactivateVacation, autoImportedCount = 0, onDismissAutoImported, onShareStamp, friends = [], onChallengeCountsChange, onChallengeActivity, onNavigateToHistory, onNavigateToChallenges, optimisticChallengeCompletions = new Map() }) => {
  const [showWorkoutNotification, setShowWorkoutNotification] = useState(true);
  const [hiddenNotificationUUIDs, setHiddenNotificationUUIDs] = useState([]); // UUIDs hidden from notification but still linkable
  const [dismissConfirmWorkouts, setDismissConfirmWorkouts] = useState(null); // Workouts pending dismiss confirmation
  const [showVacationDeactivateConfirm, setShowVacationDeactivateConfirm] = useState(false);
  const [showWorkoutPicker, setShowWorkoutPicker] = useState(false);
  const [workoutPickerDragY, setWorkoutPickerDragY] = useState(0);
  const [workoutPickerTouchStart, setWorkoutPickerTouchStart] = useState(null);
  const [dismissedWarningKey, setDismissedWarningKey] = useState(() => localStorage.getItem('dismissedStreakWarning'));
  const [activityReactions, setActivityReactions] = useState({});
  const [activityComments, setActivityComments] = useState({});
  const [reactionDetailModal, setReactionDetailModal] = useState(null); // { activityId, reactions, selectedEmoji }
  const [commentDetailModal, setCommentDetailModal] = useState(null); // { activityId, comments }
  const [showShieldInfo, setShowShieldInfo] = useState(false);
  const [showShieldConfirm, setShowShieldConfirm] = useState(false);

  // Lock body scroll when workout picker modal is open
  useEffect(() => {
    if (showWorkoutPicker) {
      // Store current scroll position
      const scrollY = window.scrollY;
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = '100%';
      document.body.style.overscrollBehavior = 'none';
      document.documentElement.style.overscrollBehavior = 'none';
    } else {
      // Restore scroll position
      const scrollY = document.body.style.top;
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      document.body.style.overscrollBehavior = '';
      document.documentElement.style.overscrollBehavior = '';
      if (scrollY) {
        window.scrollTo(0, parseInt(scrollY || '0') * -1);
      }
    }
    return () => {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      document.body.style.overscrollBehavior = '';
      document.documentElement.style.overscrollBehavior = '';
    };
  }, [showWorkoutPicker]);

  // Notify parent when workout picker visibility changes
  useEffect(() => {
    onWorkoutPickerChange?.(showWorkoutPicker);
  }, [showWorkoutPicker, onWorkoutPickerChange]);

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
      if (['Running', 'Cycle', 'Sports', 'Stair Climbing', 'Elliptical'].includes(activity.type)) return 'cardio';
      if (['Cold Plunge', 'Sauna', 'Contrast Therapy', 'Massage', 'Chiropractic', 'Yoga', 'Pilates'].includes(activity.type)) return 'recovery';
      return 'other';
    };

    const cat = (a) => getCategory(a);
    const lifts = weekActivities.filter(a => cat(a) === 'lifting' || cat(a) === 'lifting+cardio');
    const cardio = weekActivities.filter(a => cat(a) === 'cardio' || cat(a) === 'lifting+cardio');
    const recovery = weekActivities.filter(a => cat(a) === 'recovery');

    // Cardio breakdown
    const running = weekActivities.filter(a => a.type === 'Running');
    const cycling = weekActivities.filter(a => a.type === 'Cycle');
    const sports = weekActivities.filter(a => a.type === 'Sports');
    const otherCardio = weekActivities.filter(a => a.type === 'Other' && (a.customActivityCategory === 'cardio' || a.countToward === 'cardio'));

    // Strength breakdown - check strengthType field or if subtype starts with the type name
    const lifting = lifts.filter(a => a.strengthType === 'Weightlifting' || a.strengthType === 'Lifting' || a.subtype?.startsWith('Lifting') || (!a.subtype && !a.strengthType));
    const bodyweight = lifts.filter(a => a.strengthType === 'Bodyweight' || a.subtype?.startsWith('Bodyweight'));
    const circuit = lifts.filter(a => a.strengthType === 'Circuit');

    // Recovery breakdown
    const coldPlunge = weekActivities.filter(a => a.type === 'Cold Plunge');
    const sauna = weekActivities.filter(a => a.type === 'Sauna');
    const contrastTherapy = weekActivities.filter(a => a.type === 'Contrast Therapy');
    const massage = weekActivities.filter(a => a.type === 'Massage');
    const chiropractic = weekActivities.filter(a => a.type === 'Chiropractic');
    const yoga = weekActivities.filter(a => a.type === 'Yoga');
    const pilates = weekActivities.filter(a => a.type === 'Pilates');
    const otherRecovery = weekActivities.filter(a => a.type === 'Other' && (a.customActivityCategory === 'recovery' || a.countToward === 'recovery'));

    // Contrast Therapy adds individual tallies to each chosen subtype
    const contrastColdPlungeTally = contrastTherapy.filter(a => a.coldType === 'Cold Plunge').length;
    const contrastColdShowerTally = contrastTherapy.filter(a => a.coldType === 'Cold Shower').length;
    const contrastSaunaTally = contrastTherapy.filter(a => a.hotType === 'Sauna').length;
    const contrastHotPlungeTally = contrastTherapy.filter(a => a.hotType === 'Hot Plunge').length;

    // Strength "Other" activities
    const otherStrength = weekActivities.filter(a => a.type === 'Other' && (a.customActivityCategory === 'strength' || a.countToward === 'strength'));

    // Non-cardio walks (Walking activities that don't count toward goals)
    const nonCardioWalks = weekActivities.filter(a => a.type === 'Walking' && !a.countToward);


    // Muscle group breakdown — count each focus area individually (normalize old names)
    const muscleGroups = {};
    lifts.forEach(a => {
      const areas = normalizeFocusAreas(a.focusAreas || (a.focusArea ? [a.focusArea] : []));
      areas.forEach(area => {
        muscleGroups[area] = (muscleGroups[area] || 0) + 1;
      });
    });

    const totalMiles = running.reduce((sum, r) => sum + (parseFloat(r.distance) || 0), 0);
    const totalCalories = weekActivities.reduce((sum, a) => sum + (parseInt(a.calories) || 0), 0);

    // For today's calories: use HealthKit active calories directly when connected.
    // HealthKit already includes all active energy from wearables (Apple Watch, Whoop, etc.),
    // so adding manual workout calories on top would double-count.
    // When HealthKit isn't connected — including the brief window at cold launch before the
    // first sync resolves — fall back to summing TODAY's manual activity calories only.
    // Falling back to the full-week total here misreports up to 6 days of calories as "today"
    // until HealthKit responds.
    const todayDateStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
    const todayActivityCalories = weekActivities
      .filter(a => a.date === todayDateStr)
      .reduce((sum, a) => sum + (parseInt(a.calories) || 0), 0);
    const todayBurnedCalories = healthKitData.isConnected
      ? (healthKitData.todayCalories || 0)
      : todayActivityCalories;

    return {
      lifts: { completed: lifts.length, goal: goals.liftsPerWeek, sessions: lifts.map(l => l.subtype || l.type), breakdown: { lifting: lifting.length, bodyweight: bodyweight.length, circuit: circuit.length }, muscleGroups, otherActivities: otherStrength },
      cardio: { completed: cardio.length, goal: goals.cardioPerWeek, miles: totalMiles, sessions: cardio.map(c => c.type), breakdown: { running: running.length, cycling: cycling.length, sports: sports.length, other: otherCardio.length }, otherActivities: otherCardio },
      recovery: { completed: recovery.length, goal: goals.recoveryPerWeek, sessions: recovery.map(r => r.type), breakdown: { coldPlunge: coldPlunge.length + contrastColdPlungeTally, sauna: sauna.length + contrastSaunaTally, contrastTherapy: contrastTherapy.length, coldShower: contrastColdShowerTally, hotPlunge: contrastHotPlungeTally, massage: massage.length, chiropractic: chiropractic.length, yoga: yoga.length, pilates: pilates.length }, otherActivities: otherRecovery },
      // Non-cardio walks (don't count toward goals but should be displayed)
      walks: { count: nonCardioWalks.length, activities: nonCardioWalks },
      // Use HealthKit active calories directly — wearables already track all active energy
      calories: {
        burned: todayBurnedCalories,
        goal: goals.caloriesPerDay,
        source: healthKitData.isConnected ? 'healthkit' : 'manual'
      },
      // Use HealthKit steps
      steps: { today: healthKitData.todaySteps || 0, goal: goals.stepsPerDay }
    };
  }, [activities, userData?.goals, healthKitData.todaySteps, healthKitData.todayCalories, healthKitData.isConnected]);

  const stepsPercent = weekProgress.steps?.goal > 0 ? Math.min((weekProgress.steps.today / weekProgress.steps.goal) * 100, 100) : 0;
  const caloriesPercent = weekProgress.calories.goal > 0 ? Math.min((weekProgress.calories.burned / weekProgress.calories.goal) * 100, 100) : 0;
  const liftsPercent = weekProgress.lifts.goal > 0 ? Math.min((weekProgress.lifts.completed / weekProgress.lifts.goal) * 100, 100) : 0;
  const cardioPercent = weekProgress.cardio?.goal > 0 ? Math.min((weekProgress.cardio.completed / weekProgress.cardio.goal) * 100, 100) : 0;
  const recoveryPercent = weekProgress.recovery?.goal > 0 ? Math.min((weekProgress.recovery.completed / weekProgress.recovery.goal) * 100, 100) : 0;

  // Calculate days left in the week (including today, through Saturday)
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sunday, 6 = Saturday
  const daysLeft = 7 - dayOfWeek; // Days left including today (Saturday = 1, Friday = 2, etc.)
  
  const liftsRemaining = Math.max(0, weekProgress.lifts.goal - weekProgress.lifts.completed);
  const cardioRemaining = Math.max(0, (weekProgress.cardio?.goal || 0) - (weekProgress.cardio?.completed || 0));
  const recoveryRemaining = Math.max(0, (weekProgress.recovery?.goal || 0) - (weekProgress.recovery?.completed || 0));

  // Persist warning dismissal for the day — reappears next day if still needed
  const warningKey = new Date().toDateString();
  const streakWarningDismissed = dismissedWarningKey === warningKey;

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
  // Home shows the 3 most recent — full log lives on the Profile tab.
  const latestActivities = allLatestActivities.slice(0, 3);

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
              <SectionIcon type="activity" />
              <span className="text-[20px] font-semibold text-white" style={{ letterSpacing: '-0.3px' }}>Today's Activity</span>
            </div>
            <p className="text-[13px] -mt-1 pl-[30px]" style={{ color: '#777' }}>Synced from Apple Health</p>
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

      {/* Auto-Imported Summary Banner - Shows after onboarding auto-import */}
      {autoImportedCount > 0 && (
        <div className="mx-4 mb-4">
          <div
            className="w-full p-3 rounded-xl flex items-center gap-3"
            style={{ backgroundColor: 'rgba(0,255,148,0.1)', border: '1px solid rgba(0,255,148,0.3)' }}
          >
            <span className="text-lg">✅</span>
            <div className="flex-1">
              <div className="text-xs font-semibold" style={{ color: '#00FF94' }}>
                {autoImportedCount} {autoImportedCount === 1 ? 'activity' : 'activities'} imported from Apple Health
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                Your recent workouts have been auto-saved
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDismissAutoImported?.();
              }}
              className="p-1 rounded-full"
              style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Pending Workout Banners - Green for known types, Yellow for uncategorized */}
      {(() => {
        const visiblePendingSync = pendingSync.filter(w => !hiddenNotificationUUIDs.includes(w.healthKitUUID));
        if (visiblePendingSync.length === 0 || !showWorkoutNotification) return null;

        // Types that auto-categorize into strength/cardio/recovery goals
        const KNOWN_CATEGORY_TYPES = ['Strength Training', 'Running', 'Cycle', 'Sports', 'Stair Climbing', 'Elliptical', 'Rowing', 'Ski Trainer', 'Yoga', 'Pilates', 'Cold Plunge', 'Sauna', 'Contrast Therapy',
          'Track & Field', 'Jump Rope', 'Downhill Skiing', 'Cross Country Skiing', 'Snowboarding', 'Skating', 'Surfing', 'Water Polo', 'Paddle Sports',
          'Basketball', 'Soccer', 'Football', 'Tennis', 'Golf', 'Badminton', 'Boxing', 'Martial Arts',
          'Baseball', 'Volleyball', 'Hockey', 'Lacrosse', 'Rugby', 'Softball', 'Squash', 'Table Tennis',
          'Racquetball', 'Handball', 'Pickleball', 'Cricket', 'Australian Football', 'Wrestling',
          'Fencing', 'Curling', 'Bowling'];
        const isKnownCategory = (w) => {
          if (KNOWN_CATEGORY_TYPES.includes(w.type)) return true;
          // Check if user has saved a category preference for this Apple Health type
          const pref = userData?.healthKitTypePreferences?.[(w.appleWorkoutName || w.type)];
          return pref?.category ? true : false;
        };

        // Enrich pending workouts with saved preferences (icon + category)
        const enrichedPending = visiblePendingSync.map(w => {
          const pref = userData?.healthKitTypePreferences?.[(w.appleWorkoutName || w.type)];
          if (pref) {
            return {
              ...w,
              customIcon: pref.icon || w.customIcon,
              customActivityCategory: pref.category || w.customActivityCategory,
              countToward: pref.category || w.countToward,
            };
          }
          return w;
        });

        const categorizedPending = enrichedPending.filter(isKnownCategory);
        const uncategorizedPending = enrichedPending.filter(w => !isKnownCategory(w));

        const renderPendingBanner = (workouts, isUncategorized) => {
          if (workouts.length === 0) return null;
          const rgb = isUncategorized ? '255,200,0' : '0,255,148';
          const hex = isUncategorized ? '#FFC800' : '#00FF94';
          const emoji = isUncategorized ? '⚠️' : '📱';
          const title = workouts.length === 1
            ? (isUncategorized ? `${workouts[0].appleWorkoutName || workouts[0].type} workout detected` : 'New workout detected')
            : (isUncategorized
              ? `${workouts.length} uncategorized workouts detected`
              : `${workouts.length} new workouts detected`);
          const subtitle = workouts.length === 1
            ? (isUncategorized
              ? `${workouts[0].time} • ${workouts[0].duration} min • Needs details to count towards goals`
              : `${workouts[0].appleWorkoutName || workouts[0].subtype || workouts[0].type} • ${workouts[0].time} • ${workouts[0].duration} min`)
            : (isUncategorized ? 'Needs details to count towards goals' : 'Tap to view and add');

          return (
            <div className="mx-4 mb-4" key={isUncategorized ? 'uncategorized' : 'categorized'}>
              <button
                onClick={() => {
                  if (workouts.length === 1) {
                    onAddActivity(workouts[0]);
                  } else {
                    setShowWorkoutPicker(true);
                  }
                }}
                className="w-full p-3 rounded-xl flex items-center gap-3 transition-all duration-150"
                style={{ backgroundColor: `rgba(${rgb},0.1)`, border: `1px solid rgba(${rgb},0.3)` }}
                onTouchStart={(e) => {
                  e.currentTarget.style.transform = 'scale(0.98)';
                  e.currentTarget.style.backgroundColor = `rgba(${rgb},0.15)`;
                }}
                onTouchEnd={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = `rgba(${rgb},0.1)`;
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = 'scale(0.98)';
                  e.currentTarget.style.backgroundColor = `rgba(${rgb},0.15)`;
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = `rgba(${rgb},0.1)`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = `rgba(${rgb},0.1)`;
                }}
              >
                <span className="text-lg">{emoji}</span>
                <div className="flex-1 text-left">
                  <div className="text-xs font-semibold" style={{ color: hex }}>
                    {title}
                  </div>
                  <div className="text-[10px] text-gray-400">
                    {subtitle}
                  </div>
                </div>
                {workouts.length > 1 && (
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: hex, color: '#000' }}>
                    {workouts.length}
                  </span>
                )}
                <span className="px-3 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: `rgba(${rgb},0.2)`, color: hex }}>
                  {workouts.length === 1 ? 'Add' : 'View'}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerHaptic(ImpactStyle.Light);
                    // Show confirmation before dismissing
                    setDismissConfirmWorkouts(workouts);
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
          );
        };

        return (
          <>
            {renderPendingBanner(categorizedPending, false)}
            {renderPendingBanner(uncategorizedPending, true)}
          </>
        );
      })()}

      {/* Workout Picker Modal - Shows when multiple workouts detected */}
      {showWorkoutPicker && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ touchAction: 'none' }}
          onTouchMove={(e) => e.preventDefault()}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/70"
            style={{ opacity: Math.max(0, 1 - workoutPickerDragY / 200) }}
            onClick={() => {
              // Animate slide down then close
              setWorkoutPickerDragY(500);
              setTimeout(() => {
                setShowWorkoutPicker(false);
                setWorkoutPickerDragY(0);
              }, 300);
            }}
          />
          {/* Modal */}
          <div
            className="relative w-full max-h-[70vh] rounded-t-3xl overflow-hidden transition-transform"
            style={{
              backgroundColor: '#1a1a1a',
              transform: `translateY(${workoutPickerDragY}px)`,
              transition: workoutPickerTouchStart ? 'none' : 'transform 0.3s ease-out'
            }}
          >
            {/* Handle - swipe down from here to dismiss */}
            <div
              className="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing"
              onTouchStart={(e) => {
                setWorkoutPickerTouchStart(e.touches[0].clientY);
              }}
              onTouchMove={(e) => {
                if (workoutPickerTouchStart === null) return;
                const diff = e.touches[0].clientY - workoutPickerTouchStart;
                if (diff > 0) {
                  setWorkoutPickerDragY(diff);
                }
              }}
              onTouchEnd={() => {
                if (workoutPickerDragY > 100) {
                  setShowWorkoutPicker(false);
                }
                setWorkoutPickerDragY(0);
                setWorkoutPickerTouchStart(null);
              }}
            >
              <div className="w-10 h-1 rounded-full bg-gray-600" />
            </div>

            {/* Header - also draggable */}
            <div
              className="px-4 pb-3 border-b border-white/10"
              onTouchStart={(e) => {
                setWorkoutPickerTouchStart(e.touches[0].clientY);
              }}
              onTouchMove={(e) => {
                if (workoutPickerTouchStart === null) return;
                const diff = e.touches[0].clientY - workoutPickerTouchStart;
                if (diff > 0) {
                  setWorkoutPickerDragY(diff);
                }
              }}
              onTouchEnd={() => {
                if (workoutPickerDragY > 100) {
                  setShowWorkoutPicker(false);
                }
                setWorkoutPickerDragY(0);
                setWorkoutPickerTouchStart(null);
              }}
            >
              <h3 className="text-lg font-semibold text-white text-center">New Workouts from Apple Health</h3>
              <p className="text-xs text-gray-400 text-center mt-1">Tap to add, swipe left to dismiss</p>
            </div>

            {/* Workout List */}
            <div
              className="overflow-y-auto p-4 space-y-3"
              style={{ maxHeight: 'calc(70vh - 100px)', touchAction: 'pan-y' }}
              onTouchMove={(e) => e.stopPropagation()}
            >
              {pendingSync
                .slice()
                .sort((a, b) => {
                  // Sort by date then time, most recent first (descending)
                  const parseDateTime = (dateStr, timeStr) => {
                    const date = dateStr ? new Date(dateStr + 'T12:00:00') : new Date();
                    let hours = 0, minutes = 0;
                    if (timeStr) {
                      const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
                      if (match) {
                        hours = parseInt(match[1], 10);
                        minutes = parseInt(match[2], 10);
                        const isPM = match[3].toUpperCase() === 'PM';
                        if (isPM && hours !== 12) hours += 12;
                        if (!isPM && hours === 12) hours = 0;
                      }
                    }
                    date.setHours(hours, minutes, 0, 0);
                    return date.getTime();
                  };
                  return parseDateTime(b.date, b.time) - parseDateTime(a.date, a.time);
                })
                .map((workout) => (
                <SwipeableWorkoutItem
                  key={workout.healthKitUUID || workout.id}
                  workout={workout}
                  onSelect={() => {
                    setShowWorkoutPicker(false);
                    onAddActivity(workout);
                  }}
                  onDismiss={() => {
                    onDismissWorkout && onDismissWorkout(workout);
                  }}
                />
              ))}
            </div>

            {/* Cancel button */}
            <div className="p-4 border-t border-white/10">
              <button
                onClick={() => setShowWorkoutPicker(false)}
                className="w-full py-3 rounded-xl text-gray-400 font-medium transition-all active:bg-white/5"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dismiss Workout Confirmation Modal */}
      {dismissConfirmWorkouts && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={() => setDismissConfirmWorkouts(null)}>
          <div className="absolute inset-0 bg-black/70" />
          <div className="relative bg-zinc-900 rounded-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-2">
              {dismissConfirmWorkouts.length > 1 ? `Dismiss ${dismissConfirmWorkouts.length} Workouts?` : 'Dismiss Workout?'}
            </h3>
            <p className="text-gray-400 text-sm mb-6">
              {dismissConfirmWorkouts.length > 1
                ? "These workouts won't appear in notifications or be available to link to activities."
                : "This workout won't appear in notifications or be available to link to an activity."}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDismissConfirmWorkouts(null)}
                className="flex-1 py-3 rounded-xl font-medium bg-zinc-800 text-white"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  // Permanently dismiss
                  dismissConfirmWorkouts.forEach(w => {
                    if (w.healthKitUUID) {
                      onDismissWorkout && onDismissWorkout(w);
                    }
                  });
                  // Hide from banner immediately
                  const uuidsToHide = dismissConfirmWorkouts.map(w => w.healthKitUUID).filter(Boolean);
                  setHiddenNotificationUUIDs(prev => [...new Set([...prev, ...uuidsToHide])]);
                  setDismissConfirmWorkouts(null);
                }}
                className="flex-1 py-3 rounded-xl font-medium bg-red-500 text-white"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Section Divider */}
      <div className="mx-4 mb-4">
        <div className="h-px" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }} />
      </div>

      {/* Weekly Goals - Hero Section */}
      <div className="mx-4 mb-4">
        {/* Vacation Mode Active Banner */}
        {userData.vacationMode?.isActive && (
          <div className="p-3 rounded-xl mb-3 flex items-center gap-3" style={{ backgroundColor: 'rgba(0,209,255,0.08)', border: '1px solid rgba(0,209,255,0.2)' }}>
            <span className="text-lg">✈️</span>
            <div className="flex-1">
              <div className="text-xs font-semibold" style={{ color: '#00D1FF' }}>Vacation Mode Active</div>
              <div className="text-[10px] text-gray-400 mt-0.5">
                Your streaks are frozen until you deactivate
                {userData.vacationMode.startDate && (() => {
                  const start = new Date(userData.vacationMode.startDate + 'T12:00:00');
                  const now = new Date();
                  const daysUsed = Math.floor((now - start) / (24 * 60 * 60 * 1000));
                  const daysRemaining = Math.max(0, 14 - daysUsed);
                  return <span> · {daysRemaining} day{daysRemaining !== 1 ? 's' : ''} remaining</span>;
                })()}
              </div>
            </div>
            <button
              onClick={() => setShowVacationDeactivateConfirm(true)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold"
              style={{ backgroundColor: 'rgba(0,209,255,0.15)', color: '#00D1FF' }}
            >
              Deactivate
            </button>
          </div>
        )}

        {/* Streak at Risk Warning - hidden during vacation */}
        {!userData.vacationMode?.isActive && !streakWarningDismissed && daysLeft <= 3 && (liftsRemaining > 0 || cardioRemaining > 0 || recoveryRemaining > 0) && (
          <div
            className="relative p-3 rounded-xl mb-3 flex items-center gap-3"
            style={{
              backgroundColor: 'rgba(255,69,58,0.15)',
              border: '1px solid rgba(255,69,58,0.3)'
            }}
          >
            <span className="text-xl">⚠️</span>
            <div className="flex-1 pr-6">
              <div className="text-xs font-semibold" style={{ color: '#FF453A' }}>
                {daysLeft === 1 ? 'Last day to hit your goals!' : `${daysLeft} days left (including today)!`}
              </div>
              <div className="text-[10px] text-gray-400 mt-0.5">
                {[
                  liftsRemaining > 0 ? `${liftsRemaining} strength` : null,
                  cardioRemaining > 0 ? `${cardioRemaining} cardio` : null,
                  recoveryRemaining > 0 ? `${recoveryRemaining} recovery` : null
                ].filter(Boolean).join(', ')} remaining to keep your streak
              </div>
            </div>
            <button
              onClick={() => { localStorage.setItem('dismissedStreakWarning', warningKey); setDismissedWarningKey(warningKey); }}
              className="absolute flex items-center justify-center"
              style={{ top: 4, right: 4, width: 44, height: 44, color: 'rgba(255,69,58,0.6)' }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        )}

        {/* Streak Shield Button - hidden during vacation */}
        {!userData.vacationMode?.isActive && (() => {
          const currentWeek = getCurrentWeekKey();
          const previousWeek = getPreviousWeekKey();
          const hasActiveStreak = userData.streaks.master > 0 || userData.streaks.lifts > 0 || userData.streaks.cardio > 0 || userData.streaks.recovery > 0;

          // Determine if this is a retroactive shield (Sunday/Monday, saving last week)
          const isRetroactive = dayOfWeek <= 1;

          // For retroactive: check if previous week goals were incomplete.
          // Don't require hasActiveStreak — by Monday, a missed week has already
          // reset streaks to 0. Instead, verify the user had a streak going INTO
          // last week by checking the week before last hit at least one goal.
          let showRetroactive = false;
          if (isRetroactive) {
            const prevWeekStart = new Date(previousWeek + 'T00:00:00');
            const prevWeekEnd = new Date(prevWeekStart);
            prevWeekEnd.setDate(prevWeekEnd.getDate() + 6);
            const prevWeekStartStr = previousWeek;
            const prevWeekEndStr = `${prevWeekEnd.getFullYear()}-${String(prevWeekEnd.getMonth() + 1).padStart(2, '0')}-${String(prevWeekEnd.getDate()).padStart(2, '0')}`;
            const prevActivities = activities.filter(a => a.date >= prevWeekStartStr && a.date <= prevWeekEndStr);
            const goals = userData?.goals || { liftsPerWeek: 4, cardioPerWeek: 3, recoveryPerWeek: 2 };
            const getCategory = (activity) => {
              if (activity.countToward) return activity.countToward;
              return getDefaultCountToward(activity.type, activity.subtype);
            };
            const prevLifts = prevActivities.filter(a => { const c = getCategory(a); return c === 'lifting' || c === 'lifting+cardio'; }).length;
            const prevCardio = prevActivities.filter(a => { const c = getCategory(a); return c === 'cardio' || c === 'lifting+cardio'; }).length;
            const prevRecovery = prevActivities.filter(a => getCategory(a) === 'recovery').length;
            const prevIncomplete = prevLifts < goals.liftsPerWeek || prevCardio < (goals.cardioPerWeek || 2) || prevRecovery < (goals.recoveryPerWeek || 2);
            const prevAlreadyShielded = (userData.streakShield?.shieldedWeeks || []).includes(previousWeek);

            // Week before last: did at least one category hit its goal? If so, a streak was alive.
            const wblStart = new Date(prevWeekStart);
            wblStart.setDate(wblStart.getDate() - 7);
            const wblEnd = new Date(wblStart);
            wblEnd.setDate(wblEnd.getDate() + 6);
            const wblStartStr = `${wblStart.getFullYear()}-${String(wblStart.getMonth() + 1).padStart(2, '0')}-${String(wblStart.getDate()).padStart(2, '0')}`;
            const wblEndStr = `${wblEnd.getFullYear()}-${String(wblEnd.getMonth() + 1).padStart(2, '0')}-${String(wblEnd.getDate()).padStart(2, '0')}`;
            const wblActivities = activities.filter(a => a.date >= wblStartStr && a.date <= wblEndStr);
            const wblLifts = wblActivities.filter(a => { const c = getCategory(a); return c === 'lifting' || c === 'lifting+cardio'; }).length;
            const wblCardio = wblActivities.filter(a => { const c = getCategory(a); return c === 'cardio' || c === 'lifting+cardio'; }).length;
            const wblRecovery = wblActivities.filter(a => getCategory(a) === 'recovery').length;
            const hadStreakBeforeLastWeek = hasActiveStreak ||
              wblLifts >= goals.liftsPerWeek ||
              wblCardio >= (goals.cardioPerWeek || 2) ||
              wblRecovery >= (goals.recoveryPerWeek || 2);

            showRetroactive = hadStreakBeforeLastWeek && prevIncomplete && !prevAlreadyShielded;
          }

          // Current week shield (Thu/Fri/Sat as before)
          const showCurrentWeek = daysLeft <= 3 && (liftsRemaining > 0 || cardioRemaining > 0 || recoveryRemaining > 0) && hasActiveStreak;

          if (!showRetroactive && !showCurrentWeek) return null;

          // Determine which week the shield applies to
          const shieldWeekKey = showRetroactive ? previousWeek : currentWeek;
          const isShielded = (userData.streakShield?.shieldedWeeks || []).includes(shieldWeekKey);

          // Calculate 6-week cooldown from last use
          const SHIELD_COOLDOWN_WEEKS = 6;
          const lastUsedWeek = userData.streakShield?.lastUsedWeek;
          let weeksUntilAvailable = 0;
          let onCooldown = false;

          if (lastUsedWeek && lastUsedWeek !== shieldWeekKey) {
            const lastUsedDate = new Date(lastUsedWeek + 'T12:00:00');
            const shieldWeekDate = new Date(shieldWeekKey + 'T12:00:00');
            const weeksSinceUsed = Math.floor((shieldWeekDate - lastUsedDate) / (7 * 24 * 60 * 60 * 1000));
            if (weeksSinceUsed < SHIELD_COOLDOWN_WEEKS) {
              onCooldown = true;
              weeksUntilAvailable = SHIELD_COOLDOWN_WEEKS - weeksSinceUsed;
            }
          }

          const shieldAvailable = isPro && !isShielded && !onCooldown;

          // Hide on cooldown — purely informational, not actionable from home.
          // Status is visible on the Profile page and full management in Settings.
          if (isPro && onCooldown && !isShielded) return null;

          if (isShielded) {
            return (
              <div className="p-3 rounded-xl mb-3 flex items-center gap-3" style={{ backgroundColor: 'rgba(0,255,148,0.08)', border: '1px solid rgba(0,255,148,0.2)' }}>
                <span className="text-lg">🛡️</span>
                <div className="flex-1">
                  <div className="text-xs font-semibold" style={{ color: '#00FF94' }}>Streak Shield Active</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">{showRetroactive ? "Last week's streaks are protected" : 'Your streaks are protected this week'}</div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); setShowShieldInfo(true); }} className="w-6 h-6 flex items-center justify-center rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
                  <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                  </svg>
                </button>
              </div>
            );
          }

          return (
            <button
              onClick={async () => {
                if (!isPro) {
                  onPresentPaywall?.();
                  return;
                }
                if (onCooldown) return;
                if (shieldAvailable) {
                  triggerHaptic(ImpactStyle.Medium);
                  setShowShieldConfirm(true);
                }
              }}
              className="w-full p-3 rounded-xl mb-3 flex items-center gap-3 transition-all duration-150"
              style={{
                backgroundColor: !isPro ? 'rgba(255,255,255,0.03)' : onCooldown ? 'rgba(255,255,255,0.03)' : 'rgba(0,209,255,0.08)',
                border: !isPro ? '1px solid rgba(255,255,255,0.06)' : onCooldown ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(0,209,255,0.2)',
                opacity: onCooldown ? 0.6 : 1
              }}
              onTouchStart={(e) => { if (!onCooldown) e.currentTarget.style.opacity = '0.7'; }}
              onTouchEnd={(e) => { e.currentTarget.style.opacity = onCooldown ? '0.6' : '1'; }}
            >
              <span className="text-lg">🛡️</span>
              <div className="flex-1 text-left">
                <div className="text-xs font-semibold" style={{ color: !isPro ? '#9ca3af' : onCooldown ? '#9ca3af' : '#00D1FF' }}>
                  {!isPro ? 'Streak Shield' : onCooldown ? 'Streak Shield on Cooldown' : showRetroactive ? 'Revive Last Week\'s Broken Streak' : 'Use Streak Shield'}
                  {!isPro && <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(255,149,0,0.15)', color: '#FF9500' }}>PRO</span>}
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5">
                  {!isPro ? 'Protect your streaks when life gets busy' : onCooldown ? `Available again in ${weeksUntilAvailable} week${weeksUntilAvailable === 1 ? '' : 's'}` : showRetroactive ? 'You missed last week — shield it before Monday ends' : 'Protect your streaks for this week (1 per 6 weeks)'}
                </div>
              </div>
              <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); setShowShieldInfo(true); }} className="w-6 h-6 flex items-center justify-center rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
                  <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                  </svg>
                </button>
              </div>
            </button>
          );
        })()}

        {/* Streak Shield Info Modal */}
        {showShieldInfo && (
          <div className="fixed inset-0 z-[9999] flex items-end justify-center" onClick={() => setShowShieldInfo(false)}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <div
              className="relative w-full max-w-lg rounded-t-2xl p-6 pb-10"
              style={{ backgroundColor: '#1a1a1a' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drag handle */}
              <div className="flex justify-center mb-5">
                <div className="w-10 h-1 rounded-full bg-gray-600" />
              </div>

              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(0,209,255,0.1)' }}>
                  <span className="text-xl">🛡️</span>
                </div>
                <div>
                  <h3 className="text-white font-semibold text-base">Streak Shield</h3>
                  <p className="text-gray-400 text-xs">Pro Feature</p>
                </div>
              </div>

              <div className="space-y-3 mb-5">
                <div className="flex gap-3">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ backgroundColor: 'rgba(0,255,148,0.1)' }}>
                    <svg className="w-3 h-3" fill="none" stroke="#00FF94" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                  </div>
                  <div>
                    <p className="text-white text-sm font-medium">Protects your streaks</p>
                    <p className="text-gray-400 text-xs mt-0.5">If you can't complete your weekly goals, activate the shield to keep all your streaks from resetting.</p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ backgroundColor: 'rgba(0,209,255,0.1)' }}>
                    <svg className="w-3 h-3" fill="none" stroke="#00D1FF" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                  </div>
                  <div>
                    <p className="text-white text-sm font-medium">Available once every 6 weeks</p>
                    <p className="text-gray-400 text-xs mt-0.5">After using a shield, there's a 6-week cooldown before you can use another one. Use it wisely!</p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ backgroundColor: 'rgba(255,149,0,0.1)' }}>
                    <svg className="w-3 h-3" fill="none" stroke="#FF9500" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" /></svg>
                  </div>
                  <div>
                    <p className="text-white text-sm font-medium">Appears when you need it</p>
                    <p className="text-gray-400 text-xs mt-0.5">The shield shows up in the last days of the week when your goals are incomplete, or on Sunday/Monday to retroactively save last week's streak.</p>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setShowShieldInfo(false)}
                className="w-full py-3 rounded-xl text-sm font-semibold text-white"
                style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
              >
                Got it
              </button>
            </div>
          </div>
        )}

        {/* Streak Shield Confirmation Modal */}
        {showShieldConfirm && (() => {
          const currentWeek = getCurrentWeekKey();
          const previousWeek = getPreviousWeekKey();
          const isRetroactive = dayOfWeek <= 1 && !(userData.streakShield?.shieldedWeeks || []).includes(previousWeek);
          const shieldWeekKey = isRetroactive ? previousWeek : currentWeek;
          return (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={() => setShowShieldConfirm(false)}>
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
              <div
                className="relative w-[85%] max-w-sm rounded-2xl p-6"
                style={{ backgroundColor: '#1a1a1a' }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex flex-col items-center text-center mb-5">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3" style={{ backgroundColor: 'rgba(0,209,255,0.1)' }}>
                    <span className="text-3xl">🛡️</span>
                  </div>
                  <h3 className="text-white font-semibold text-lg">{isRetroactive ? 'Revive Last Week\'s Broken Streak?' : 'Use Streak Shield?'}</h3>
                  <p className="text-gray-400 text-sm mt-2 leading-relaxed">
                    {isRetroactive
                      ? 'Your streaks will stay alive as if last week counted. You only get 1 shield every 6 weeks — make it count.'
                      : 'This will protect all your current streaks for this week, even if you don\'t complete your goals.'}
                  </p>
                </div>

                <div className="rounded-xl p-3 mb-5" style={{ backgroundColor: 'rgba(255,149,0,0.08)', border: '1px solid rgba(255,149,0,0.15)' }}>
                  <div className="flex items-start gap-2">
                    <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="#FF9500" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                    </svg>
                    <p className="text-xs leading-relaxed" style={{ color: '#FF9500' }}>
                      You only get <span className="font-semibold">1 streak shield every 6 weeks</span>. Once used, you won't be able to use another one until the cooldown resets.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setShowShieldConfirm(false)}
                    className="flex-1 py-3 rounded-xl text-sm font-semibold text-white"
                    style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setShowShieldConfirm(false);
                      triggerHaptic(ImpactStyle.Heavy);
                      onUseStreakShield?.(shieldWeekKey);
                    }}
                    className="flex-1 py-3 rounded-xl text-sm font-semibold text-white"
                    style={{ backgroundColor: '#00D1FF' }}
                  >
                    Activate Shield
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Vacation Mode Deactivation Confirmation Modal */}
        {showVacationDeactivateConfirm && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={() => setShowVacationDeactivateConfirm(false)}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <div
              className="relative w-[85%] max-w-sm rounded-2xl p-6"
              style={{ backgroundColor: '#1a1a1a' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-col items-center text-center mb-5">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3" style={{ backgroundColor: 'rgba(255,149,0,0.1)' }}>
                  <span className="text-3xl">✈️</span>
                </div>
                <h3 className="text-white font-semibold text-lg">Deactivate Vacation Mode?</h3>
                <p className="text-gray-400 text-sm mt-2 leading-relaxed">
                  Your streaks will no longer be frozen. You'll need to complete your weekly goals to keep them going.
                </p>
              </div>

              <div className="rounded-xl p-3 mb-5" style={{ backgroundColor: 'rgba(255,149,0,0.08)', border: '1px solid rgba(255,149,0,0.15)' }}>
                <div className="flex items-start gap-2">
                  <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="#FF9500" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                  </svg>
                  <p className="text-xs leading-relaxed" style={{ color: '#FF9500' }}>
                    This uses one of your activations. You won't get it back if you turn it off early.
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowVacationDeactivateConfirm(false)}
                  className="flex-1 py-3 rounded-xl text-sm font-semibold text-white"
                  style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
                >
                  Keep Active
                </button>
                <button
                  onClick={() => {
                    setShowVacationDeactivateConfirm(false);
                    triggerHaptic(ImpactStyle.Medium);
                    onDeactivateVacation?.();
                  }}
                  className="flex-1 py-3 rounded-xl text-sm font-semibold text-white"
                  style={{ backgroundColor: '#FF9500' }}
                >
                  Deactivate
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Weekly Goals - tour highlight wraps header + card */}
        <div ref={weeklyGoalsRef}>
          <div className="mb-3">
            <div className="flex items-center gap-2">
              <SectionIcon type="target" />
              <span className="text-[20px] font-semibold text-white" style={{ letterSpacing: '-0.3px' }}>This Week's Goals</span>
            </div>
            <p className="text-[13px] -mt-1 pl-[30px]" style={{ color: '#777' }}>Hit these to keep your streaks alive · {daysLeft} day{daysLeft !== 1 ? 's' : ''} left</p>
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
              <div className="text-sm font-medium mt-2">💪 Strength</div>
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
              <div className="text-sm font-medium mt-2">❤️‍🔥 Cardio</div>
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
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-gray-400">Muscle groups trained</div>
                <div className="text-[10px] text-gray-500 flex items-center gap-1">
                  <ActivityIcon type="Strength Training" strengthType="Weightlifting" size={10} /> {weekProgress.lifts?.breakdown?.lifting || 0} Weightlifting · <ActivityIcon type="Strength Training" strengthType="Bodyweight" size={10} /> {weekProgress.lifts?.breakdown?.bodyweight || 0} Bodyweight{weekProgress.lifts?.breakdown?.circuit ? <> · <ActivityIcon type="Strength Training" strengthType="Circuit" size={10} /> {weekProgress.lifts.breakdown.circuit} Circuit</> : ''}
                </div>
              </div>
              {Object.keys(weekProgress.lifts?.muscleGroups || {}).length > 0 ? (
                <div className="grid grid-cols-3 gap-2 text-center">
                  {Object.entries(weekProgress.lifts.muscleGroups).sort((a, b) => b[1] - a[1]).map(([area, count]) => (
                    <div key={area} className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                      <div className="text-lg font-bold">{count}</div>
                      <div className="text-[10px] text-gray-400">{area}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-gray-500 text-center py-2">No focus areas logged yet</div>
              )}
            </div>
          )}
          
          {/* Cardio Breakdown - Expandable */}
          {showCardioBreakdown && (
            <div className="mt-4 pt-4 border-t border-white/10">
              <div className="text-xs text-gray-400 mb-2">Cardio Breakdown</div>
              <div className={`grid gap-2 text-center`} style={{ gridTemplateColumns: `repeat(${3 + (weekProgress.cardio?.otherActivities?.length || 0)}, minmax(0, 1fr))` }}>
                <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  <div className="text-lg font-bold">{weekProgress.cardio?.breakdown?.running || 0}</div>
                  <div className="flex items-center gap-1 text-[10px] text-gray-400"><ActivityIcon type="Running" size={10} /> Running</div>
                </div>
                <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  <div className="text-lg font-bold">{weekProgress.cardio?.breakdown?.cycling || 0}</div>
                  <div className="flex items-center gap-1 text-[10px] text-gray-400"><ActivityIcon type="Cycle" size={10} /> Cycling</div>
                </div>
                <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  <div className="text-lg font-bold">{weekProgress.cardio?.breakdown?.sports || 0}</div>
                  <div className="flex items-center gap-1 text-[10px] text-gray-400"><ActivityIcon type="Sports" size={10} /> Sports</div>
                </div>
                {/* Show each "Other" cardio activity */}
                {weekProgress.cardio?.otherActivities?.map((activity, i) => (
                  <div key={activity.id || i} className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    <div className="text-lg font-bold">1</div>
                    <div className="text-[10px] text-gray-400 flex items-center gap-1"><ActivityIcon type="Other" customIcon={activity.customIcon} customEmoji={activity.customEmoji} size={10} /> {activity.subtype || 'Other'}</div>
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
                  <div className="flex items-center gap-1 text-[10px] text-gray-400"><ActivityIcon type="Cold Plunge" size={10} /> Cold Plunge</div>
                </div>
                <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  <div className="text-lg font-bold">{weekProgress.recovery?.breakdown?.sauna || 0}</div>
                  <div className="flex items-center gap-1 text-[10px] text-gray-400"><ActivityIcon type="Sauna" size={10} /> Sauna</div>
                </div>
                <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  <div className="text-lg font-bold">{weekProgress.recovery?.breakdown?.contrastTherapy || 0}</div>
                  <div className="flex items-center gap-1 text-[10px] text-gray-400"><ActivityIcon type="Contrast Therapy" size={10} /> Contrast</div>
                </div>
                {(weekProgress.recovery?.breakdown?.coldShower || 0) > 0 && (
                <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  <div className="text-lg font-bold">{weekProgress.recovery?.breakdown?.coldShower}</div>
                  <div className="flex items-center gap-1 text-[10px] text-gray-400">🚿 Cold Shower</div>
                </div>
                )}
                {(weekProgress.recovery?.breakdown?.hotPlunge || 0) > 0 && (
                <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  <div className="text-lg font-bold">{weekProgress.recovery?.breakdown?.hotPlunge}</div>
                  <div className="flex items-center gap-1 text-[10px] text-gray-400">♨️ Hot Plunge</div>
                </div>
                )}
                <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  <div className="text-lg font-bold">{weekProgress.recovery?.breakdown?.massage || 0}</div>
                  <div className="flex items-center gap-1 text-[10px] text-gray-400"><ActivityIcon type="Massage" size={10} /> Massage</div>
                </div>
                <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  <div className="text-lg font-bold">{weekProgress.recovery?.breakdown?.chiropractic || 0}</div>
                  <div className="flex items-center gap-1 text-[10px] text-gray-400"><ActivityIcon type="Chiropractic" size={10} /> Chiropractic</div>
                </div>
                <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  <div className="text-lg font-bold">{weekProgress.recovery?.breakdown?.yoga || 0}</div>
                  <div className="flex items-center gap-1 text-[10px] text-gray-400"><ActivityIcon type="Yoga" size={10} /> Yoga</div>
                </div>
                <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  <div className="text-lg font-bold">{weekProgress.recovery?.breakdown?.pilates || 0}</div>
                  <div className="flex items-center gap-1 text-[10px] text-gray-400"><ActivityIcon type="Pilates" size={10} /> Pilates</div>
                </div>
                {/* Show each "Other" recovery activity */}
                {weekProgress.recovery?.otherActivities?.map((activity, i) => (
                  <div key={activity.id || i} className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    <div className="text-lg font-bold">1</div>
                    <div className="text-[10px] text-gray-400 flex items-center gap-1"><ActivityIcon type="Other" customIcon={activity.customIcon} customEmoji={activity.customEmoji} size={10} /> {activity.subtype || 'Other'}</div>
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
      </div>

      <ChallengesSection user={user} userProfile={userProfile} friends={friends} onChallengeCountsChange={onChallengeCountsChange} onSeeDetails={onNavigateToChallenges} optimisticCompletions={optimisticChallengeCompletions} />

      {/* Section Divider */}
      <div className="mx-4 mb-4">
        <div className="h-px" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }} />
      </div>

      {/* Recent Activity — up to 3 most recent; full log lives on the Profile tab */}
      <div className="mx-4 mb-4">
        <SwipeableProvider>
          <div ref={latestActivityRef}>
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-xs text-gray-500 uppercase tracking-wider">
                {latestActivities.length > 1 ? 'Recent Activity' : 'Last Workout'}
              </span>
              {onNavigateToHistory && (
                <button
                  onClick={() => { triggerHaptic(ImpactStyle.Light); onNavigateToHistory(); }}
                  className="text-xs text-gray-400"
                >
                  See all ›
                </button>
              )}
            </div>
            {latestActivities.length > 0 ? (
              <div className="space-y-2">
                {latestActivities.map((act) => (
                  <SwipeableActivityItem
                    key={act.id}
                    activity={act}
                    onDelete={(a) => onDeleteActivity && onDeleteActivity(a.id)}
                    onEdit={onEditActivity}
                  >
                    <div
                      onClick={() => {
                        triggerHaptic(ImpactStyle.Light);
                        setSelectedActivity(act);
                      }}
                      className="w-full p-3 flex items-center gap-3 text-left cursor-pointer active:opacity-70 transition-opacity"
                      style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                    >
                      <ActivityIcon type={act.type} subtype={act.subtype} size={20} sportEmoji={act.sportEmoji} customEmoji={act.customEmoji} customIcon={act.customIcon} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{
                          act.type === 'Other' ? (act.subtype || 'Other')
                          : act.type === 'Strength Training' ? (() => {
                            const st = act.strengthType || 'Strength Training';
                            const areas = normalizeFocusAreas(act.focusAreas || (act.focusArea ? [act.focusArea] : []));
                            if (areas.length > 0) return `${st} - ${areas.join(', ')}`;
                            return act.subtype || st;
                          })()
                          : (act.subtype ? `${act.type} • ${act.subtype}` : act.type)
                        }</div>
                        <div className="text-xs text-gray-400 flex items-center gap-2">
                          <span>{formatFriendlyDate(act.date)}{act.time ? ` at ${act.time}` : ''}{act.duration ? ` (${act.duration} min)` : ''}</span>
                          {(act.healthKitUUID || act.linkedHealthKitUUID || act.source === 'healthkit' || act.fromAppleHealth) && (
                            <span className="flex items-center gap-1 text-cyan-400">
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                              </svg>
                              <span className="text-[10px]">{act.sourceDevice || 'Apple Health'}</span>
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-gray-600 text-xs">›</span>
                    </div>
                  </SwipeableActivityItem>
                ))}
              </div>
            ) : (
              <div className="p-6 rounded-xl text-center" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                <div className="text-4xl mb-3">💪</div>
                <p className="text-white font-medium text-sm">Your first workout is waiting!</p>
                <p className="text-gray-500 text-xs mt-1">Tap the + button to log an activity</p>
              </div>
            )}
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
        onShareStamp={onShareStamp}
        isPro={isPro}
        onPresentPaywall={onPresentPaywall}
        onChallenge={onChallengeActivity}
        friends={friends}
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


// Main App
export default function DaySevenApp() {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isOnboarded, setIsOnboarded] = useState(null); // null = loading, true = onboarded, false = needs onboarding
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('home');
  const [showSettings, setShowSettings] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  const [prevTab, setPrevTab] = useState('home');
  const [tabDirection, setTabDirection] = useState(0); // -1 = left, 0 = none, 1 = right
  const [showAddActivity, setShowAddActivity] = useState(false);
  const [showWorkoutPicker, setShowWorkoutPicker] = useState(false);
  const [pendingActivity, setPendingActivity] = useState(null);
  const [defaultActivityDate, setDefaultActivityDate] = useState(null);
  const [showShare, setShowShare] = useState(false);
  const [shareWeekRange, setShareWeekRange] = useState(null); // { startDate, endDate } for week-specific sharing
  const [shareMonthRange, setShareMonthRange] = useState(null); // { startDate, endDate } for month-specific sharing
  const [showStampModal, setShowStampModal] = useState(false);
  const [stampActivity, setStampActivity] = useState(null);
  const [stampRouteCoords, setStampRouteCoords] = useState([]);
  const [showFriends, setShowFriends] = useState(false);
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [friends, setFriends] = useState([]);
  const [challengeModalActivity, setChallengeModalActivity] = useState(null); // activity to challenge a friend with (null = modal closed)
  const [outgoingThisMonthChallengeCount, setOutgoingThisMonthChallengeCount] = useState(0);
  // Set when a challenge notification is tapped — tells ChallengesTab which segment/sub
  // to open. Includes a `nonce` so re-navigating to the same target still re-applies.
  const [challengesNavTarget, setChallengesNavTarget] = useState(null);
  // Multi-match chooser state — shape: { activity, candidateChallenges } | null.
  // Set when an activity matches 2+ challenges and the cloud function deferred fulfillment
  // (push notification deep-link or anywhere we surface the modal).
  const [challengeChooserState, setChallengeChooserState] = useState(null);
  // Active accepted challenges for the current user — passed to AddActivityModal so it can
  // show "this fulfills these challenges" with checkboxes. Refreshed each time the modal opens.
  const [accepterActiveChallenges, setAccepterActiveChallenges] = useState([]);
  // Optimistic completions: challengeId → { activityId, completedAt }. The cloud function
  // takes a few seconds to actually flip status; this overlay flips it locally so the UI
  // moves Active → Completed immediately. Auto-pruned per entry after 30s; the listener will
  // have caught up by then and the overlay no-ops anyway.
  const [optimisticChallengeCompletions, setOptimisticChallengeCompletions] = useState(new Map());
  // Active challenge being applied to a past activity — drives the "Use past activity" picker modal.
  const [applyPastActivityChallenge, setApplyPastActivityChallenge] = useState(null);
  const [challengePickerForFriend, setChallengePickerForFriend] = useState(null); // friend object when picking which past activity to challenge with
  const [preSelectedChallengeFriend, setPreSelectedChallengeFriend] = useState(null); // friend uid to pre-fill in ChallengeFriendModal
  const [showCelebration, setShowCelebration] = useState(false);
  const [celebrationMessage, setCelebrationMessage] = useState('');
  const [celebrationType, setCelebrationType] = useState('weekly'); // 'weekly', 'daily-steps', 'daily-calories'
  const [showWeekStreakCelebration, setShowWeekStreakCelebration] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState('record'); // 'record' or 'success'
  const [pendingToast, setPendingToast] = useState(null); // Queue toast to show after celebration
  // Track which goals have been celebrated this week (prevents duplicate celebrations, allows re-celebration after delete)
  const [weekCelebrations, setWeekCelebrations] = useState(() => {
    try {
      const saved = localStorage.getItem('weekCelebrations');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.week === getCurrentWeekKey()) return parsed;
      }
    } catch {}
    return { ...emptyWeekCelebrations, week: getCurrentWeekKey() };
  });
  const [historyView, setHistoryView] = useState('calendar');
  const [historyStatsSubView, setHistoryStatsSubView] = useState('overview');
  const [showEditGoals, setShowEditGoals] = useState(false);
  const [pendingFriendRequests, setPendingFriendRequests] = useState(0);
  const [unreadFeedCount, setUnreadFeedCount] = useState(0);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [feedActiveView, setFeedActiveView] = useState('feed'); // 'feed' or 'leaderboard'
  const [isHomeWorkoutPickerOpen, setIsHomeWorkoutPickerOpen] = useState(false); // Track if HomeTab's workout picker is open
  const [isPro, setIsPro] = useState(false); // RevenueCat "dayseven Pro" entitlement

  // HealthKit data state
  const [healthKitData, setHealthKitData] = useState({
    todaySteps: 0,
    todayCalories: 0,
    pendingWorkouts: [], // Workouts from HealthKit not yet added to activities
    lastSynced: null,
    isConnected: false // True if HealthKit has ever returned data > 0
  });

  // Count of workouts auto-imported from Apple Health during onboarding (for summary banner)
  const [autoImportedCount, setAutoImportedCount] = useState(0);

  // Track daily goals celebrated (resets each day)
  const [dailyGoalsCelebrated, setDailyGoalsCelebrated] = useState(() => {
    try {
      const saved = localStorage.getItem('dailyGoalsCelebrated');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Check if it's from today
        const today = getTodayDate();
        if (parsed.date === today) {
          return parsed;
        }
      }
    } catch {}
    return { date: getTodayDate(), steps: false, calories: false };
  });

  // Track dismissed workout UUIDs (to not show them again)
  const [dismissedWorkoutUUIDs, setDismissedWorkoutUUIDs] = useState(() => {
    try {
      const saved = localStorage.getItem('dismissedWorkoutUUIDs');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const dismissedWorkoutUUIDsRef = useRef(dismissedWorkoutUUIDs);
  useEffect(() => { dismissedWorkoutUUIDsRef.current = dismissedWorkoutUUIDs; }, [dismissedWorkoutUUIDs]);

  // Handler to dismiss a workout from notifications
  const handleDismissWorkout = (workout) => {
    const uuid = workout.healthKitUUID || workout.id;
    if (uuid) {
      const newDismissed = [...dismissedWorkoutUUIDs, uuid];
      setDismissedWorkoutUUIDs(newDismissed);
      localStorage.setItem('dismissedWorkoutUUIDs', JSON.stringify(newDismissed));
      // Also remove from pending workouts
      setHealthKitData(prev => ({
        ...prev,
        pendingWorkouts: prev.pendingWorkouts.filter(w => (w.healthKitUUID || w.id) !== uuid)
      }));
    }
  };

  // Smart Save state
  const [showSmartSaveExplainModal, setShowSmartSaveExplainModal] = useState(false);
  const justOnboardedRef = useRef(false); // Suppress Smart Save modal on first sync after onboarding

  // Notification cleanup refs
  const notificationCleanupRef = useRef(null); // Stores cleanup function from initializePushNotifications
  const fcmTokenRef = useRef(null); // Stores current FCM token for removal on logout
  // Refs to access user/profile/activities in syncHealthKit callback without adding as dependencies
  const userProfileRef = useRef(userProfile);
  useEffect(() => { userProfileRef.current = userProfile; }, [userProfile]);
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);
  // Persists Activity Feed data across tab switches so re-mounts hydrate instantly
  // instead of flashing a spinner. Tagged with uid so a different signed-in user
  // doesn't see the previous user's cache.
  const feedCacheRef = useRef(null);
  const activitiesRef = useRef([]);
  // activitiesRef is synced after activities state is declared (see below)
  const lastFirestoreActivityCount = useRef(0); // Track last known Firestore activity count to prevent overwriting
  const activitiesFromFirestore = useRef(false); // Skip debounced save when activities came from Firestore or were saved directly
  const lastFirestoreSyncTime = useRef(0); // Timestamp of last Firestore sync/save — prevents stale saves for 10 seconds

  // Auto-detect max heart rate from HealthKit + workout history when not set
  // NOTE: This useEffect is declared before activities state — uses activitiesRef to avoid TDZ
  useEffect(() => {
    if (!user?.uid || userProfile?.maxHeartRate) return;

    const detectMaxHR = async () => {
      let maxFromHealthKit = null;
      let maxFromActivities = null;

      // Source 1: Query HealthKit for highest recorded HR (last 90 days)
      try {
        maxFromHealthKit = await queryMaxHeartRateFromHealthKit(90);
      } catch (e) {
        // Silently fail
      }

      // Source 2: Scan existing activities for highest maxHr (via ref)
      const currentActivities = activitiesRef.current || [];
      if (currentActivities.length > 0) {
        maxFromActivities = currentActivities.reduce((max, a) => {
          return a.maxHr && a.maxHr > (max || 0) ? a.maxHr : max;
        }, null);
      }

      // Use the higher of the two
      const detectedMax = Math.max(maxFromHealthKit || 0, maxFromActivities || 0);
      if (detectedMax >= 120) { // Only use if it's a reasonable max HR
        try {
          await updateUserProfile(user.uid, { maxHeartRate: detectedMax });
          setUserProfile(prev => ({ ...prev, maxHeartRate: detectedMax }));
        } catch (e) {
        }
      }
    };

    // Small delay to avoid running during initial load burst
    const timer = setTimeout(detectMaxHR, 3000);
    return () => clearTimeout(timer);
  }, [user?.uid, userProfile?.maxHeartRate]);

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
      // 1. First sync ever (timestamp is 0) OR
      // 2. Steps changed by more than 100 OR
      // 3. Calories changed by more than 50 OR
      // 4. It's been more than 5 minutes since last sync
      const firstSync = lastSync.timestamp === 0;
      const stepsChanged = Math.abs((healthKitData.todaySteps || 0) - (lastSync.steps || 0)) > 100;
      const caloriesChanged = Math.abs((healthKitData.todayCalories || 0) - (lastSync.calories || 0)) > 50;
      const timeElapsed = now - lastSync.timestamp > minSyncInterval;

      // Always sync on first sync (to clear stale data from previous day)
      // For subsequent syncs, only sync if there's actual data to avoid unnecessary writes
      const shouldSync = firstSync ||
                         ((stepsChanged || caloriesChanged || timeElapsed) &&
                         (healthKitData.todaySteps > 0 || healthKitData.todayCalories > 0));

      if (shouldSync) {
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

  // Backfill yesterday's health data on app open
  // The daily sync only writes while the app is open, so if the user closes
  // the app mid-day, the final calorie/step totals are never captured.
  // On next app open, query HealthKit for yesterday's complete data and update Firestore.
  useEffect(() => {
    if (!user?.uid || !Capacitor.isNativePlatform()) return;

    const backfillYesterday = async () => {
      try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const dateStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

        const data = await fetchHealthDataForDate(yesterday);
        if (data && (data.steps > 0 || data.calories > 0)) {
          // Only update if HealthKit has more data than what's stored
          const existing = await getDailyHealthData(user.uid, dateStr);
          const existingCals = existing?.calories || 0;
          const existingSteps = existing?.steps || 0;
          if (data.calories > existingCals || data.steps > existingSteps) {
            await saveDailyHealthData(user.uid, dateStr,
              Math.max(data.steps, existingSteps),
              Math.max(data.calories, existingCals)
            );
            // Refresh health history so the UI reflects the updated data
            const refreshed = await getDailyHealthHistory(user.uid, 365);
            setHealthHistory(refreshed);
          }
        }
      } catch (e) {
        // Silently fail
      }
    };

    backfillYesterday();
  }, [user?.uid]);

  // Live-subscribe to the current user's challengeStats. The cloud function increments
  // wins/losses/accepted server-side when challenges resolve; without this listener the
  // local userProfile stays stuck on whatever was loaded at login, so the W-L pill on
  // OwnProfileModal and the Challenges tab would only refresh on next app launch —
  // confusing right after a friend's challenge expires or the user wins one.
  useEffect(() => {
    if (!user?.uid) return;
    const unsub = subscribeToUserChallengeStats(user.uid, (challengeStats) => {
      setUserProfile(prev => prev ? { ...prev, challengeStats } : prev);
    });
    return () => { try { unsub?.(); } catch {} };
  }, [user?.uid]);

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
          const hasHealthData = (healthData.steps > 0 || healthData.calories > 0);
          setHealthKitData(prev => ({
            ...prev,
            todaySteps: healthData.steps || 0,
            todayCalories: healthData.calories || 0,
            lastSynced: healthData.lastUpdated,
            isConnected: prev.isConnected || hasHealthData // Once connected, stays connected
          }));
        }
      } catch (e) {
        // Silently fail
      }
    };

    loadHealthDataFromFirestore();

    // Refresh from Firestore every 5 minutes on desktop
    const refreshInterval = setInterval(loadHealthDataFromFirestore, 5 * 60 * 1000);

    // Also refresh when tab becomes visible (user switches back to tab)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadHealthDataFromFirestore();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(refreshInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [user?.uid]);

  // Badge count is now managed by Cloud Functions (accurate APNS badge)
  // and cleared on app open via clearBadge() + Firestore reset.
  // No need for a local useEffect to sync badge with pendingFriendRequests.

  // Load active workout from localStorage on mount, and check for active Live Activities
  useEffect(() => {
    try {
      const saved = localStorage.getItem('activeWorkout');
      if (saved) {
        const parsed = JSON.parse(saved);
        setActiveWorkout(parsed);

        // If it's a watch workout, verify it's still active
        if (parsed.source === 'watch') {
          getWatchWorkoutMetrics().then(metrics => {
            if (!metrics.isActive) {
              // Watch workout ended while app was closed — clear it
              setActiveWorkout(null);
              endAllLiveActivities();
            }
          }).catch(() => {
            // Can't reach watch — keep workout state, it'll re-check when reachable
          });
        }
      } else {
        // No saved workout state — check if a Live Activity is running
        // (watch may have started a workout while app was closed/backgrounded)
        checkActiveLiveActivity().then(result => {
          if (result.isActive) {
            console.log('[LiveActivity] Found active Live Activity on mount, restoring state:', result.activityType);
            setActiveWorkout({
              type: result.activityType,
              startTime: result.startTime,
              source: 'watch',
              icon: '⌚',
            });
          }
        });
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

  // Sync Live Activity state when app returns to foreground
  useEffect(() => {
    const handleVisibility = async () => {
      if (document.visibilityState !== 'visible') return;
      const result = await checkActiveLiveActivity();
      if (result.isActive && !activeWorkout) {
        // Live Activity running but no in-app state — restore it
        console.log('[LiveActivity] Restored active workout on resume:', result.activityType);
        setActiveWorkout({
          type: result.activityType,
          startTime: result.startTime,
          source: 'watch',
          icon: '⌚',
        });
      } else if (!result.isActive && activeWorkout?.source === 'watch') {
        // Live Activity ended while backgrounded — clear in-app state
        console.log('[LiveActivity] Watch workout ended while backgrounded, clearing state');
        setActiveWorkout(null);
        setShowFinishWorkout(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [activeWorkout]);

  // Listen for watch workout started/ended events (when user starts/ends on watch directly,
  // or when startWatchApp wakes the watch and it begins tracking)
  useEffect(() => {
    const removeStartListener = addWatchWorkoutStartedListener(async (data) => {
      console.log('[WatchEvent] Workout started on watch:', data.activityType);
      // If we have an active phone workout, cancel its HealthKit session
      // since the watch is now handling the workout with better sensors
      if (activeWorkout?.source === 'phone') {
        console.log('[WatchEvent] Watch took over — cancelling phone live workout');
        try {
          await cancelLiveWorkout();
        } catch (e) {
          console.log('[WatchEvent] Cancel phone workout failed (may not have been started):', e.message);
        }
      }

      // Start Live Activity from foreground (background start fails with "visibility" error)
      const displayType = data.strengthType || data.activityType || 'Other';
      startWatchWorkoutLiveActivity(displayType);

      setActiveWorkout(prev => ({
        ...(prev || {}),
        type: prev?.type || data.activityType,
        strengthType: prev?.strengthType || data.strengthType || null,
        startTime: prev?.startTime || data.startTime || new Date().toISOString(),
        source: 'watch',
        icon: prev?.icon || '⌚',
      }));
    });

    const removeEndListener = addWatchWorkoutEndedListener(async () => {
      console.log('[WatchEvent] Workout ended on watch');
      // End Live Activity from JS as safety net (native async Task may not complete in background)
      await endAllLiveActivities();
      setActiveWorkout(null);
      setShowFinishWorkout(false);
    });

    return () => {
      removeStartListener();
      removeEndListener();
    };
  }, [activeWorkout?.source]);

  // Listen for watch activity saved (watch saved an activity to Firestore while phone app is open)
  // This triggers a celebration check since goals may have been completed on the watch
  useEffect(() => {
    const removeListener = addWatchActivitySavedListener(async () => {
      if (!user?.uid) return;

      try {
        // Fetch fresh data directly from Firestore (bypass all caches)
        const freshActivities = await getUserActivities(user.uid, true);
        lastFirestoreActivityCount.current = freshActivities.length;
        activitiesRef.current = freshActivities;
        activitiesFromFirestore.current = true; // Skip debounced save — data is already in Firestore
        lastFirestoreSyncTime.current = Date.now(); // Timestamp-based protection window
        setActivities(freshActivities);

        const freshProfile = await getUserProfile(user.uid, true);
        const currentWeekKey = getCurrentWeekKey();

        // Sync streaks from Firestore
        if (freshProfile?.streaks) {
          setUserData(prev => ({
            ...prev,
            streaks: {
              master: freshProfile.streaks.master ?? prev.streaks.master,
              lifts: freshProfile.streaks.lifts ?? prev.streaks.lifts,
              cardio: freshProfile.streaks.cardio ?? prev.streaks.cardio,
              recovery: freshProfile.streaks.recovery ?? prev.streaks.recovery,
              stepsGoal: freshProfile.streaks.stepsGoal ?? prev.streaks.stepsGoal
            }
          }));
        }

        // Sync weekCelebrations
        if (freshProfile?.weekCelebrations?.week === currentWeekKey) {
          setWeekCelebrations(freshProfile.weekCelebrations);
          localStorage.setItem('weekCelebrations', JSON.stringify(freshProfile.weekCelebrations));
        }

        // Recalculate weekly progress for the UI rings
        const freshProgress = calculateWeeklyProgress(freshActivities);
        setWeeklyProgress(freshProgress);
        pushWidgetData(freshProgress);

        // Check if phone should show a celebration
        // ALWAYS verify actual activity counts — never trust firestoreSaysMaster alone
        // because watch may have stale data (e.g., phone deleted an activity the watch doesn't know about)
        const phoneShown = getPhoneCelebrationShown();
        if (!phoneShown.master) {
          const goals = userDataRef.current?.goals || freshProfile?.goals || { liftsPerWeek: 4, cardioPerWeek: 3, recoveryPerWeek: 2 };
          const allGoalsMet = freshProgress.lifts.completed >= goals.liftsPerWeek &&
            freshProgress.cardio.completed >= goals.cardioPerWeek &&
            freshProgress.recovery.completed >= goals.recoveryPerWeek;
          if (allGoalsMet) {
            const newWC = { week: currentWeekKey, lifts: true, cardio: true, recovery: true, master: true };
            setWeekCelebrations(newWC);
            localStorage.setItem('weekCelebrations', JSON.stringify(newWC));
            updateUserProfile(user.uid, { weekCelebrations: newWC }).catch(() => {});
            markPhoneCelebrationShown();
            setTimeout(() => {
              triggerHaptic(ImpactStyle.Heavy);
              setShowWeekStreakCelebration(true);
            }, 1000);
          }
        }
      } catch (e) {
        // Non-critical — celebration check failed, continue normally
      }
    });

    return () => removeListener();
  }, [user?.uid]);

  // Tab order for direction detection
  // 'history' stays in the order so swipe-direction calc still works while History remains
  // reachable via backdoor (HomeTab's "see all" taps). It's removed once History merges into Profile.
  const tabOrder = ['home', 'challenges', 'feed', 'profile'];

  // Custom tab switcher with direction tracking
  // Tapping the already-active tab scrolls to top (Instagram-style)
  const switchTab = useCallback((newTab) => {
    if (newTab === activeTab) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      document.documentElement.scrollTo({ top: 0, behavior: 'smooth' });
      document.body.scrollTo({ top: 0, behavior: 'smooth' });
      scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    // Clear unread feed notifications when opening feed tab
    if (newTab === 'feed' && unreadFeedCount > 0) {
      setUnreadFeedCount(0);
      if (user?.uid) {
        updateUserProfile(user.uid, { unreadFeedCount: 0 });
      }
    }

    const currentIndex = tabOrder.indexOf(activeTab);
    const newIndex = tabOrder.indexOf(newTab);
    setTabDirection(newIndex > currentIndex ? 1 : -1);
    setPrevTab(activeTab);
    setActiveTab(newTab);
  }, [activeTab, unreadFeedCount, user?.uid]);

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
  const challengesTabRef = useRef(null);
  const activeStreaksRef = useRef(null);
  const calendarRef = useRef(null);
  const statsRef = useRef(null);
  const progressPhotosRef = useRef(null);
  const historyLatestActivityRef = useRef(null);
  const friendsTabRef = useRef(null);
  const profileTabRef = useRef(null);
  const scrollContainerRef = useRef(null);

  // Triple-tap logo refs
  const logoTapCountRef = useRef(0);
  const logoTapTimerRef = useRef(null);

  // Track scroll position for collapsing header
  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
      setScrollY(scrollTop);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    document.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      document.removeEventListener('scroll', handleScroll);
    };
  }, []);

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
      challengesTabRef,    // 2: Challenges Tab
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
    setActiveTab('profile');
    setHistoryView('stats');
    setHistoryStatsSubView('records');
  };

  // Handle sign out
  const handleSignOut = async () => {
    // Capture user ID and token before clearing state (needed for cleanup)
    const currentUserId = user?.uid;
    const currentToken = fcmTokenRef.current;

    // Immediately clear user state to show login screen
    setUser(null);
    setUserProfile(null);
    setUserData(initialUserData); // Reset to initial, not null (prevents spread errors on re-login)
    setIsOnboarded(null); // null = loading state, prevents onboarding flash on re-login
    setActivities(initialActivities);
    setCalendarData(initialCalendarData);
    setFriends([]);
    setPendingFriendRequests(0);
    setUnreadFeedCount(0);
    setIsPro(false);
    setDevAuthEmail(null);

    // Then attempt actual sign out in background (don't block UI)
    (async () => {
      // Clean up push notification listeners and remove FCM token
      try {
        if (notificationCleanupRef.current) {
          notificationCleanupRef.current();
          notificationCleanupRef.current = null;
        }
        if (currentUserId && currentToken) {
          await removeFCMToken(currentUserId, currentToken);
          fcmTokenRef.current = null;
        }
        await clearBadge();
        await clearAllNotifications();
      } catch (e) {
        console.error('[App] Notification cleanup error:', e);
      }

      // Reset RevenueCat
      try {
        await logoutRevenueCat();
      } catch (e) {
        // Ignore RevenueCat logout errors
      }
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
    }
  };

  // Handle max heart rate update
  const handleUpdateMaxHeartRate = async (maxHeartRate) => {
    if (!user) return;
    try {
      await updateUserProfile(user.uid, { maxHeartRate });
      setUserProfile(prev => ({ ...prev, maxHeartRate }));
    } catch (error) {
    }
  };

  // Handle Smart Save explanation modal close
  const handleSmartSaveExplainClose = async () => {
    setShowSmartSaveExplainModal(false);
    if (user) {
      try {
        await updateUserProfile(user.uid, { smartSaveExplained: true });
        setUserProfile(prev => ({ ...prev, smartSaveExplained: true }));
      } catch (error) {
      }
    }
  };

  // Handle Smart Save disable from explanation modal
  const handleSmartSaveDisable = async () => {
    setShowSmartSaveExplainModal(false);
    if (user) {
      try {
        const newPrivacy = {
          ...userProfile?.privacySettings,
          smartSaveWalks: false
        };
        await updateUserProfile(user.uid, {
          privacySettings: newPrivacy,
          smartSaveExplained: true
        });
        setUserProfile(prev => ({
          ...prev,
          privacySettings: newPrivacy,
          smartSaveExplained: true
        }));
      } catch (error) {
      }
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
      setToastMessage('Failed to send reset email. Please try again.');
      setToastType('success');
      setShowToast(true);
    }
  };

  // Recalculate all personal records from activities and health history
  // This ensures records are always accurate and fixes any data corruption
  const recalculateAllRecordsFromActivities = (activitiesList, existingRecords = {}, healthHistoryData = []) => {
    const newRecords = {
      highestCalories: { value: 0, activityType: null },
      longestStrength: { value: 0, activityType: null },
      longestCardio: { value: 0, activityType: null },
      longestDistance: { value: 0, activityType: null },
      longestRun: { value: 0, activityType: null },
      longestCycle: { value: 0, activityType: null },
      longestWalk: { value: 0, activityType: null },
      fastestPace: { value: null, activityType: null },
      fastestCyclingPace: { value: null, activityType: null },
      mostWorkoutsWeek: 0,
      mostCaloriesWeek: 0,
      mostMilesWeek: 0,
      mostRunsWeek: 0,
      mostLiftsWeek: 0,
      mostRecoveryWeek: 0,
    };

    const recoveryTypes = ['Cold Plunge', 'Sauna', 'Contrast Therapy', 'Massage', 'Chiropractic'];

    // Calculate single-activity records
    activitiesList.forEach(activity => {
      const isWarmup = activity.countToward === 'warmup' || activity.customActivityCategory === 'warmup';
      if (isWarmup) return; // Warm-up activities don't count toward any records

      const yogaPilatesAsRecovery = ['Yoga', 'Pilates'].includes(activity.type) &&
        (!activity.countToward || activity.countToward === 'recovery');
      const isRecovery = recoveryTypes.includes(activity.type) || yogaPilatesAsRecovery;
      const isStrength = activity.type === 'Strength Training' || activity.countToward === 'strength';
      const isCardio = ['Running', 'Cycle', 'Sports', 'Stair Climbing', 'Elliptical'].includes(activity.type) || activity.countToward === 'cardio';

      // Highest calories (all activities except warmup)
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

        // Longest run
        if (activity.type === 'Running' && activity.distance && activity.distance > (newRecords.longestRun.value || 0)) {
          newRecords.longestRun = { value: activity.distance, activityType: 'Running' };
        }

        // Longest cycle
        if (activity.type === 'Cycle' && activity.distance && activity.distance > (newRecords.longestCycle.value || 0)) {
          newRecords.longestCycle = { value: activity.distance, activityType: 'Cycle' };
        }

        // Longest walk
        if (activity.type === 'Walking' && activity.distance && activity.distance > (newRecords.longestWalk.value || 0)) {
          newRecords.longestWalk = { value: activity.distance, activityType: 'Walking' };
        }

        // Fastest pace (running) - lower is better
        if (activity.type === 'Running' && activity.distance && activity.distance >= 0.1 && activity.duration) {
          const pace = activity.duration / activity.distance;
          if (pace >= 3 && pace <= 30) { // Reasonable range
            if (newRecords.fastestPace.value === null || pace < newRecords.fastestPace.value) {
              newRecords.fastestPace = { value: pace, activityType: 'Running' };
            }
          }
        }

        // Fastest cycling pace - lower is better
        if (activity.type === 'Cycle' && activity.distance && activity.distance >= 0.1 && activity.duration) {
          const pace = activity.duration / activity.distance;
          if (pace >= 0.5 && pace <= 30) { // Reasonable range
            if (newRecords.fastestCyclingPace.value === null || pace < newRecords.fastestCyclingPace.value) {
              newRecords.fastestCyclingPace = { value: pace, activityType: 'Cycle' };
            }
          }
        }
      }
    });

    // Build health data map from healthHistoryData
    const healthDataByDate = {};
    const safeHealthHistory = healthHistoryData || [];
    safeHealthHistory.forEach(entry => {
      if (entry.date) {
        healthDataByDate[entry.date] = entry;
      }
    });

    // Calculate weekly records - group activities by week
    const weeklyData = {};

    // First, collect all unique dates from both activities and health history
    const allDates = new Set();
    activitiesList.forEach(a => a.date && allDates.add(a.date));
    safeHealthHistory.forEach(h => h.date && allDates.add(h.date));

    // Helper to categorize activities (matches getShareCategory used by streaks)
    const getCategory = (a) => {
      if (a.countToward === 'warmup' || a.customActivityCategory === 'warmup') return 'warmup';
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

    // Group dates by week and calculate stats
    allDates.forEach(dateStr => {
      const actDate = new Date(dateStr + 'T12:00:00'); // Use noon to avoid timezone issues
      const weekStart = new Date(actDate);
      weekStart.setDate(actDate.getDate() - actDate.getDay());
      const weekKey = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;

      if (!weeklyData[weekKey]) {
        weeklyData[weekKey] = { workouts: 0, lifts: 0, runs: 0, cardio: 0, recovery: 0, calories: 0, miles: 0, dates: new Set() };
      }
      weeklyData[weekKey].dates.add(dateStr);
    });

    // Now calculate stats for each week
    Object.keys(weeklyData).forEach(weekKey => {
      const week = weeklyData[weekKey];
      let weekCalories = 0;

      week.dates.forEach(dateStr => {
        const dayActivities = activitiesList.filter(a => a.date === dateStr);

        dayActivities.forEach(activity => {
          const cat = getCategory(activity);
          if (cat === 'warmup') return; // Skip warmups

          week.miles += (parseFloat(activity.distance) || 0);

          // Only count strength + cardio toward "most workouts" (not walks, recovery, etc.)
          if (cat === 'lifting' || cat === 'cardio' || cat === 'lifting+cardio') {
            week.workouts++;
          }

          // Track per-category counts (lifting+cardio counts in both)
          if (cat === 'lifting' || cat === 'lifting+cardio') week.lifts++;
          if (cat === 'cardio' || cat === 'lifting+cardio') week.cardio++;
          if (cat === 'recovery') week.recovery++;
          if (activity.type === 'Running') week.runs++;
        });

        // Use HealthKit calories directly — wearables already track all active energy
        const healthData = healthDataByDate[dateStr];
        weekCalories += healthData?.calories || 0;
      });

      week.calories = weekCalories;
    });

    // Calculate weekly records
    Object.values(weeklyData).forEach(week => {
      if (week.workouts > newRecords.mostWorkoutsWeek) newRecords.mostWorkoutsWeek = week.workouts;
      if (week.calories > newRecords.mostCaloriesWeek) newRecords.mostCaloriesWeek = Math.round(week.calories);
      if (week.miles > newRecords.mostMilesWeek) newRecords.mostMilesWeek = parseFloat(week.miles.toFixed(1));
      if (week.runs > newRecords.mostRunsWeek) newRecords.mostRunsWeek = week.runs;
      if (week.lifts > newRecords.mostLiftsWeek) newRecords.mostLiftsWeek = week.lifts;
      if (week.recovery > newRecords.mostRecoveryWeek) newRecords.mostRecoveryWeek = week.recovery;
    });

    // Calculate longest historical streaks from weekly data
    // Sort weeks chronologically and find longest consecutive streak for each category
    const goals = existingRecords?._goals || {};
    const liftsGoal = goals.liftsPerWeek || 4;
    const cardioGoal = goals.cardioPerWeek || 2;
    const recoveryGoal = goals.recoveryPerWeek || 2;

    const sortedWeekKeys = Object.keys(weeklyData).sort();
    let longestMaster = 0, longestStrength = 0, longestCardio = 0, longestRecovery = 0;
    let curMaster = 0, curStrength = 0, curCardio = 0, curRecovery = 0;

    sortedWeekKeys.forEach(weekKey => {
      const week = weeklyData[weekKey];
      const liftsMet = week.lifts >= liftsGoal;
      const cardioMet = week.cardio >= cardioGoal;
      const recoveryMet = week.recovery >= recoveryGoal;

      curStrength = liftsMet ? curStrength + 1 : 0;
      curCardio = cardioMet ? curCardio + 1 : 0;
      curRecovery = recoveryMet ? curRecovery + 1 : 0;
      curMaster = (liftsMet && cardioMet && recoveryMet) ? curMaster + 1 : 0;

      longestStrength = Math.max(longestStrength, curStrength);
      longestCardio = Math.max(longestCardio, curCardio);
      longestRecovery = Math.max(longestRecovery, curRecovery);
      longestMaster = Math.max(longestMaster, curMaster);
    });

    // Also clamp to the user's current streaks — a longest-ever can't be lower than
    // what's running right now. Defends against drift where streaks.X tracked beyond
    // what the weekly recalc reconstructed (e.g., week-boundary mismatches).
    const cur = existingRecords?._currentStreaks || {};
    return {
      ...newRecords,
      longestMasterStreak: Math.max(longestMaster, existingRecords?.longestMasterStreak || 0, cur.master || 0),
      longestStrengthStreak: Math.max(longestStrength, existingRecords?.longestStrengthStreak || 0, cur.lifts || 0),
      longestCardioStreak: Math.max(longestCardio, existingRecords?.longestCardioStreak || 0, cur.cardio || 0),
      longestRecoveryStreak: Math.max(longestRecovery, existingRecords?.longestRecoveryStreak || 0, cur.recovery || 0),
    };
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
        } else if (user.authProvider && !profile.authProvider) {
          // Update authProvider for existing users who don't have it set
          await createUserProfile(user); // This will update authProvider
          profile = await getUserProfile(user.uid, true); // Force refresh
        }
      } catch (error) {
      }

      // Check onboarding status
      // If profile has user data (activities, username, streaks, etc.), user has clearly onboarded
      // even if hasCompletedOnboarding flag is missing (can happen if Firestore data was partially wiped)
      const hasActivities = Array.isArray(profile?.activities) && profile.activities.length > 0;
      const hasExistingUserData = hasActivities || profile?.username || profile?.streaks || profile?.personalRecords || profile?.maxHeartRate;
      const hasCompletedOnboarding = profile?.hasCompletedOnboarding === true || !!hasExistingUserData;

      // If we inferred onboarding from existing data but the flag is missing, repair it
      if (hasExistingUserData && profile?.hasCompletedOnboarding !== true) {
        setOnboardingComplete(user.uid).catch(() => {});
      }

      // Set user and profile together to avoid intermediate render states
      setUser(user);
      setUserProfile(profile);
      setUnreadFeedCount(profile?.unreadFeedCount || 0);
      setIsOnboarded(hasCompletedOnboarding);
      setActiveTab('home'); // Always go to home screen after login
      setAuthLoading(false);

      // Demo mode: load mock data for appreview account (marketing screen recordings)
      if (isDemoAccount(profile, user)) {
        const demoActivities = getDemoActivities();
        const demoUserData = getDemoUserData();
        const demoHealthKit = getDemoHealthKitData();
        setActivities(demoActivities);
        activitiesRef.current = demoActivities;
        setUserData(demoUserData);
        setCalendarData(getDemoCalendarData(demoActivities));
        setHealthKitData(prev => ({ ...prev, ...demoHealthKit }));
        setIsPro(true); // Show pro features in demo
        return;
      }

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
            // Re-persist goals to Firestore to ensure they stay synced
            saveUserGoals(user.uid, userGoals).catch(() => {});
          } else {
            // Goals missing from Firestore but user may have them in local state
            // (e.g., set during onboarding but Firestore was wiped)
            // Re-persist local goals to repair Firestore
            const localGoals = userDataRef.current?.goals;
            if (localGoals && localGoals.liftsPerWeek) {
              saveUserGoals(user.uid, localGoals).catch(() => {});
            }
          }

          // Initialize RevenueCat with Firebase UID
          if (Capacitor.isNativePlatform()) {
            try {
              setDevAuthEmail(user.email);
              const rcInitialized = await initializeRevenueCat(user.uid);
              if (rcInitialized) {
                const proStatus = await checkProStatus();
                setIsPro(proStatus);
                addCustomerInfoListener(({ isPro: newIsPro }) => {
                  setIsPro(newIsPro);
                });
              }
            } catch (rcError) {
              console.error('[App] RevenueCat init error:', rcError);
            }
          }

          // Re-fetch profile with forceRefresh to bypass native SDK cache
          // (watch may have updated streaks/weekCelebrations via REST API)
          const freshProfile = await getUserProfile(user.uid, true);

          // Load streaks and celebration state from fresh Firestore data
          const profileForStreaks = freshProfile || profile;
          if (profileForStreaks?.streaks) {
            setUserData(prev => ({
              ...prev,
              streaks: {
                master: profileForStreaks.streaks.master ?? prev.streaks.master,
                lifts: profileForStreaks.streaks.lifts ?? prev.streaks.lifts,
                cardio: profileForStreaks.streaks.cardio ?? prev.streaks.cardio,
                recovery: profileForStreaks.streaks.recovery ?? prev.streaks.recovery,
                stepsGoal: profileForStreaks.streaks.stepsGoal ?? prev.streaks.stepsGoal
              }
            }));
          }
          // Load streak shield data
          if (profileForStreaks?.streakShield) {
            setUserData(prev => ({
              ...prev,
              streakShield: {
                lastUsedWeek: profileForStreaks.streakShield.lastUsedWeek ?? null,
                shieldedWeeks: profileForStreaks.streakShield.shieldedWeeks ?? []
              }
            }));
          }
          // Load vacation mode data
          if (profileForStreaks?.vacationMode) {
            const vm = profileForStreaks.vacationMode;
            // Auto-deactivate if vacation exceeded 14 days
            if (vm.isActive && vm.startDate) {
              const start = new Date(vm.startDate + 'T12:00:00');
              const now = new Date();
              const daysSinceStart = Math.floor((now - start) / (24 * 60 * 60 * 1000));
              if (daysSinceStart >= 14) {
                const deactivated = { ...vm, isActive: false };
                setUserData(prev => ({ ...prev, vacationMode: deactivated }));
                updateUserProfile(user.uid, { vacationMode: deactivated }).catch(() => {});
              } else {
                // Add current week to vacationWeeks if not already there
                const currentWeek = getCurrentWeekKey();
                const updatedWeeks = vm.vacationWeeks || [];
                if (!updatedWeeks.includes(currentWeek)) {
                  const updated = { ...vm, vacationWeeks: [...updatedWeeks, currentWeek] };
                  setUserData(prev => ({ ...prev, vacationMode: updated }));
                  updateUserProfile(user.uid, { vacationMode: updated }).catch(() => {});
                } else {
                  setUserData(prev => ({ ...prev, vacationMode: vm }));
                }
              }
            } else {
              setUserData(prev => ({ ...prev, vacationMode: vm }));
            }
          }
          if (profileForStreaks?.weekCelebrations) {
            const wc = profileForStreaks.weekCelebrations;
            if (wc.week === getCurrentWeekKey()) {
              setWeekCelebrations(wc);
              localStorage.setItem('weekCelebrations', JSON.stringify(wc));
            }
          }

          // Load user's activities from Firestore (force refresh to pick up watch-saved activities)
          const userActivities = await getUserActivities(user.uid, true);
          lastFirestoreActivityCount.current = userActivities.length;
          if (userActivities.length > 0) {
            activitiesFromFirestore.current = true; // Skip debounced save — data is already in Firestore
        lastFirestoreSyncTime.current = Date.now(); // Timestamp-based protection window
            setActivities(userActivities);
            // Update ref immediately so syncHealthKit can see loaded activities
            activitiesRef.current = userActivities;
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

            // Recalculate streaks from actual activity history to fix any discrepancies
            const loadedGoals = userGoals || { liftsPerWeek: 4, cardioPerWeek: 3, recoveryPerWeek: 2 };
            const recalculated = recalculateStreaksFromHistory(userActivities, loadedGoals);
            if (recalculated) {
              const storedStreaks = profileForStreaks?.streaks || {};
              // Only update if there's a mismatch
              if (recalculated.master !== (storedStreaks.master || 0) ||
                  recalculated.lifts !== (storedStreaks.lifts || 0) ||
                  recalculated.cardio !== (storedStreaks.cardio || 0) ||
                  recalculated.recovery !== (storedStreaks.recovery || 0)) {
                console.log('[App] Streak mismatch detected, recalculating:', { stored: storedStreaks, recalculated });
                setUserData(prev => ({
                  ...prev,
                  streaks: {
                    ...prev.streaks,
                    ...recalculated
                  }
                }));
                // Persist corrected streaks
                updateUserProfile(user.uid, {
                  streaks: { ...storedStreaks, ...recalculated }
                }).catch(() => {});
              }
            }

            // Check for pending master celebration (may have been completed on watch)
            // ALWAYS verify actual activity counts — never trust firestoreSaysMaster alone
            // because watch may have stale data (e.g., phone deleted an activity the watch doesn't know about)
            const currentWeekKey = getCurrentWeekKey();
            const phoneShown = getPhoneCelebrationShown();
            if (!phoneShown.master) {
              const loadedProgress = calculateWeeklyProgress(userActivities);
              const goals = userGoals || { liftsPerWeek: 4, cardioPerWeek: 3, recoveryPerWeek: 2 };
              const allGoalsMet = loadedProgress.lifts.completed >= goals.liftsPerWeek &&
                loadedProgress.cardio.completed >= goals.cardioPerWeek &&
                loadedProgress.recovery.completed >= goals.recoveryPerWeek;
              if (allGoalsMet) {
                // Update weekCelebrations (streak tracking) if not already set
                const newWC = { week: currentWeekKey, lifts: true, cardio: true, recovery: true, master: true };
                setWeekCelebrations(newWC);
                localStorage.setItem('weekCelebrations', JSON.stringify(newWC));
                updateUserProfile(user.uid, { weekCelebrations: newWC }).catch(() => {});
                // Mark that phone has shown the celebration
                markPhoneCelebrationShown();
                setTimeout(() => {
                  triggerHaptic(ImpactStyle.Heavy);
                  setShowWeekStreakCelebration(true);
                }, 1500);
              }
            }
          }

          // Sync HealthKit AFTER activities are loaded so it can properly
          // detect already-saved/linked workouts via activitiesRef
          if (Capacitor.isNativePlatform()) {
            syncHealthKit();
          }

          // Load daily health history for trends (365 days for full year view)
          const healthHistoryData = await getDailyHealthHistory(user.uid, 365);
          setHealthHistory(healthHistoryData);

          // Load friends list
          const friendsList = await getFriends(user.uid);
          setFriends(friendsList);

          // Preload friend profile photos so they're cached before tab switch
          friendsList.forEach(f => {
            if (f.photoURL) {
              const img = new Image();
              img.src = f.photoURL;
            }
          });

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

          // Load user's personal records, then recalculate from activities to ensure accuracy
          const recordsResult = await getPersonalRecords(user.uid);
          const userRecords = recordsResult?.personalRecords ?? recordsResult;
          const userWeeksWon = recordsResult?.weeksWon || 0;

          // Recalculate records from activities and health history to ensure they're accurate
          // This fixes any corruption from race conditions or data issues. Pass current
          // streaks via `_currentStreaks` so the recalc clamps longest* to >= current
          // (a "longest ever" can't be less than what's running right now).
          try {
            const recalculatedRecords = recalculateAllRecordsFromActivities(
              userActivities || [],
              { ...userRecords, _goals: userGoals || {}, _currentStreaks: recordsResult?.streaks || {} },
              healthHistoryData || []
            );

            setUserData(prev => ({
              ...prev,
              personalRecords: { ...prev.personalRecords, ...recalculatedRecords, weeksWon: userWeeksWon }
            }));

            // Save recalculated records if they differ from stored records
            if (JSON.stringify(recalculatedRecords) !== JSON.stringify(userRecords)) {
              savePersonalRecords(user.uid, recalculatedRecords);
            }
          } catch (recalcError) {
            // If recalculation fails, just use stored records
            if (userRecords) {
              setUserData(prev => ({
                ...prev,
                personalRecords: { ...prev.personalRecords, ...userRecords, weeksWon: userWeeksWon }
              }));
            }
          }

          // Mark records as loaded (even if null - means user has no records yet)
          setRecordsLoaded(true);

          // Initialize push notifications on native platforms
          if (Capacitor.isNativePlatform()) {
            try {
              // Clear badge on app open and reset Firestore counter
              clearBadge();
              updateUserProfile(user.uid, { unreadBadgeCount: 0 });

              const { cleanup, token } = await initializePushNotifications(
                user.uid,
                async (notification) => {
                  // Handle foreground notification — check preferences and show in-app toast
                  const prefs = userProfileRef.current?.notificationPreferences;
                  if (prefs && !shouldShowNotification(notification, prefs)) return;

                  const title = notification?.notification?.title || notification?.title;
                  const body = notification?.notification?.body || notification?.body;
                  if (title || body) {
                    setToastMessage(body || title);
                    setToastType('success');
                    setShowToast(true);
                  }
                  // Increment badge for foreground notifications
                  incrementBadge();

                  // Track unread feed notifications locally (for red dot on Friends tab)
                  // notificationReceived wraps data at notification.notification.data or notification.data
                  const notifType = notification?.notification?.data?.type || notification?.data?.type;
                  const socialTypes = ['reaction', 'comment', 'reply', 'friend_request', 'friend_accepted', 'friend_workout'];
                  if (socialTypes.includes(notifType) && activeTabRef.current !== 'feed') {
                    setUnreadFeedCount(prev => prev + 1);
                  }

                  // If weekly/monthly summary arrived in foreground, persist share prompt for next app open
                  const showPrompt = notification?.notification?.data?.showSharePrompt || notification?.data?.showSharePrompt;
                  if ((notifType === 'weekly_summary' || notifType === 'monthly_summary') && showPrompt === 'true') {
                    localStorage.setItem('pendingSharePrompt', JSON.stringify({
                      type: notifType === 'weekly_summary' ? 'weekly' : 'monthly',
                      sentAt: new Date().toISOString()
                    }));
                  }
                },
                (notification, actionId) => {
                  // Handle notification tap - navigate to appropriate screen
                  clearBadge();
                  clearAllNotifications();
                  handleNotificationNavigation(notification, (tab, opts) => {
                    setActiveTab(tab);
                    // Challenge notifs hint at which segment/sub-segment to open.
                    if (tab === 'challenges' && (opts?.challengesSegment || opts?.challengesSubSegment)) {
                      setChallengesNavTarget({
                        segment: opts.challengesSegment || null,
                        subSegment: opts.challengesSubSegment || null,
                        // identity bump so ChallengesTab re-applies even if values match a prior nav
                        nonce: Date.now(),
                      });
                    }
                  }, {
                    onShowChallengePicker: ({ activityId, challengeIds }) => {
                      openChallengeChooser({ activityId, challengeIds });
                    },
                    onShowSharePrompt: (summaryData) => {
                      // Clear pending flag since user tapped the notification directly
                      localStorage.removeItem('pendingSharePrompt');
                      if (user?.uid) {
                        updateUserProfile(user.uid, { pendingSharePrompt: null }).catch(() => {});
                      }
                      // Calculate last week's date range (Sunday to Saturday)
                      const today = new Date();
                      const lastSunday = new Date(today);
                      lastSunday.setDate(today.getDate() - today.getDay() - 7);
                      const lastSaturday = new Date(lastSunday);
                      lastSaturday.setDate(lastSunday.getDate() + 6);
                      // Open share card for last week after a brief delay to let home tab render
                      setTimeout(() => {
                        setShareWeekRange({ startDate: lastSunday, endDate: lastSaturday });
                        setShowShare(true);
                      }, 500);
                    },
                  });
                }
              );
              // Store cleanup and token for logout
              notificationCleanupRef.current = cleanup;
              fcmTokenRef.current = token;
            } catch (notifError) {
              console.error('[App] Push notification init error:', notifError);
            }
          }
        } catch (error) {
          // Still mark as loaded on error so we don't block record checking forever
          setRecordsLoaded(true);
        }
      })();
    } else {
      setUserProfile(null);
      setFriends([]);
      setPendingFriendRequests(0);
      setIsOnboarded(null);
      setAuthLoading(false);
      setRecordsLoaded(false); // Reset on logout
    }
  }, []);

  // Refresh data function for pull-to-refresh
  const refreshData = useCallback(async () => {
    if (!user?.uid) return;

    try {
      // Reload activities — force refresh to pick up watch workouts
      const userActivities = await getUserActivities(user.uid, true);
      lastFirestoreActivityCount.current = userActivities.length;
      if (userActivities.length > 0) {
        activitiesFromFirestore.current = true; // Skip debounced save — data is already in Firestore
        lastFirestoreSyncTime.current = Date.now(); // Timestamp-based protection window
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

      // Reload health history for trends
      const healthHistoryData = await getDailyHealthHistory(user.uid, 365);
      setHealthHistory(healthHistoryData);

      // Reload friends and pending requests
      const [friendsList, requests] = await Promise.all([
        getFriends(user.uid),
        getFriendRequests(user.uid)
      ]);
      setFriends(friendsList);
      setPendingFriendRequests(requests.length);
      friendsList.forEach(f => { if (f.photoURL) { const img = new Image(); img.src = f.photoURL; } });

      // Refresh HealthKit data on pull-to-refresh (including workouts)
      // Use timeout so pull-to-refresh doesn't hang if HealthKit permission dialog is pending
      if (Capacitor.isNativePlatform()) {
        try {
          const healthKitPromise = syncHealthKitData();
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('HealthKit sync timeout')), 10000)
          );
          const result = await Promise.race([healthKitPromise, timeoutPromise]);
          if (result.success) {
            // Find workouts that aren't already in activities
            const existingUUIDs = new Set(
              userActivities
                .filter(a => a.healthKitUUID)
                .map(a => a.healthKitUUID)
            );
            const linkedUUIDs = new Set(
              userActivities
                .filter(a => a.linkedHealthKitUUID)
                .map(a => a.linkedHealthKitUUID)
            );
            const newWorkouts = result.workouts.filter(
              w => w.healthKitUUID &&
                   !existingUUIDs.has(w.healthKitUUID) &&
                   !linkedUUIDs.has(w.healthKitUUID)
            );

            const hasHealthData = (result.todaySteps > 0 || result.todayCalories > 0);
            setHealthKitData(prev => ({
              todaySteps: result.todaySteps ?? prev.todaySteps ?? 0,
              todayCalories: result.todayCalories ?? prev.todayCalories ?? 0,
              // Suppress pending workout notifications on first sync after onboarding
              // to avoid bombarding new users with historical HealthKit workouts
              pendingWorkouts: justOnboardedRef.current ? [] : newWorkouts,
              lastSynced: new Date().toISOString(),
              isConnected: prev.isConnected || hasHealthData
            }));
          }
        } catch (e) {
          // Silently fail HealthKit refresh (timeout or permission pending)
        }
      }
    } catch (error) {
    }
  }, [user?.uid]);

  // Sync HealthKit data function
  const syncHealthKit = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return;

    try {
      const result = await syncHealthKitData();
      if (result.success) {
        // Use ref to get current activities without needing as dependency
        const currentActivities = activitiesRef.current || [];

        // Find workouts that aren't already in activities (by healthKitUUID) and not dismissed
        const existingUUIDs = new Set(
          currentActivities
            .filter(a => a.healthKitUUID)
            .map(a => a.healthKitUUID)
        );

        // Also filter out linked workouts (where activity has linkedHealthKitUUID)
        const linkedUUIDs = new Set(
          currentActivities
            .filter(a => a.linkedHealthKitUUID)
            .map(a => a.linkedHealthKitUUID)
        );

        // Filter workouts - exclude already saved, linked, and dismissed activities
        const dismissedSet = new Set(dismissedWorkoutUUIDsRef.current);
        const newWorkouts = result.workouts.filter(
          w => w.healthKitUUID &&
               !existingUUIDs.has(w.healthKitUUID) &&
               !linkedUUIDs.has(w.healthKitUUID) &&
               !dismissedSet.has(w.healthKitUUID)
        );

        // --- Post-onboarding: auto-import ALL workouts silently ---
        if (justOnboardedRef.current && newWorkouts.length > 0) {
          const autoImportedActivities = newWorkouts.map((workout, i) => ({
            ...workout,
            id: Date.now() + i,
            time: workout.time || new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
            autoImported: true,
            source: 'healthkit',
          }));

          const uid = userRef.current?.uid;
          if (uid) {
            try {
              const freshActivities = await getUserActivities(uid, true);
              const merged = [...autoImportedActivities, ...freshActivities];
              lastFirestoreActivityCount.current = merged.length;
              activitiesRef.current = merged;
              activitiesFromFirestore.current = true; // Prevent debounced save — saving directly
              lastFirestoreSyncTime.current = Date.now();
              setActivities(merged);
              saveUserActivities(uid, merged).catch(() => {});
            } catch (e) {
              setActivities(prev => {
                const updated = [...autoImportedActivities, ...prev];
                saveUserActivities(uid, updated).catch(() => {});
                return updated;
              });
            }
          } else {
            setActivities(prev => [...autoImportedActivities, ...prev]);
          }

          setCalendarData(prev => {
            const updated = { ...prev };
            for (const workout of newWorkouts) {
              const dateKey = workout.date;
              if (!updated[dateKey]) updated[dateKey] = [];
              updated[dateKey] = [...updated[dateKey], {
                type: workout.type,
                subtype: workout.subtype,
                duration: workout.duration,
                distance: workout.distance,
                calories: workout.calories,
                avgHr: workout.avgHr,
                maxHr: workout.maxHr
              }];
            }
            return updated;
          });

          const hasHealthData = (result.todaySteps > 0 || result.todayCalories > 0);
          setHealthKitData(prev => ({
            todaySteps: result.todaySteps || 0,
            todayCalories: result.todayCalories || 0,
            pendingWorkouts: [], // No notifications on first sync
            lastSynced: new Date().toISOString(),
            isConnected: prev.isConnected || hasHealthData
          }));

          // Show summary banner on homescreen
          setAutoImportedCount(newWorkouts.length);

          justOnboardedRef.current = false;
        } else {
          // --- Normal flow: Smart Save walks, notify for others ---
          const profile = userProfileRef.current;
          const maxHR = profile?.maxHeartRate;
          const smartSaveEnabled = profile?.privacySettings?.smartSaveWalks !== false;
          const smartSaveExplained = profile?.smartSaveExplained;

          const workoutsForNotification = [];
          const walksToSmartSave = [];

          for (const workout of newWorkouts) {
            if (shouldSmartSaveWalk(workout, maxHR, smartSaveEnabled)) {
              walksToSmartSave.push(workout);
            } else {
              workoutsForNotification.push(workout);
            }
          }

          // Auto-save qualifying walks inline
          if (walksToSmartSave.length > 0) {
            const smartSavedActivities = walksToSmartSave.map((walk, i) => ({
              ...walk,
              id: Date.now() + i,
              time: walk.time || new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
              smartSaved: true,
              source: 'healthkit',
            }));

            const uid = userRef.current?.uid;
            if (uid) {
              try {
                const freshActivities = await getUserActivities(uid, true);
                const merged = [...smartSavedActivities, ...freshActivities];
                lastFirestoreActivityCount.current = merged.length;
                activitiesRef.current = merged;
                activitiesFromFirestore.current = true; // Prevent debounced save — saving directly
                lastFirestoreSyncTime.current = Date.now();
                setActivities(merged);
                saveUserActivities(uid, merged).catch(() => {});
              } catch (e) {
                setActivities(prev => {
                  const updated = [...smartSavedActivities, ...prev];
                  saveUserActivities(uid, updated).catch(() => {});
                  return updated;
                });
              }
            } else {
              setActivities(prev => [...smartSavedActivities, ...prev]);
            }

            setCalendarData(prev => {
              const updated = { ...prev };
              for (const walk of walksToSmartSave) {
                const dateKey = walk.date;
                if (!updated[dateKey]) updated[dateKey] = [];
                updated[dateKey] = [...updated[dateKey], {
                  type: walk.type,
                  subtype: walk.subtype,
                  duration: walk.duration,
                  distance: walk.distance,
                  calories: walk.calories,
                  avgHr: walk.avgHr,
                  maxHr: walk.maxHr
                }];
              }
              return updated;
            });

            // Show explanation modal on first smart-save
            if (!smartSaveExplained) {
              setShowSmartSaveExplainModal(true);
            }
          }

          const hasHealthData = (result.todaySteps > 0 || result.todayCalories > 0);
          setHealthKitData(prev => ({
            todaySteps: result.todaySteps || 0,
            todayCalories: result.todayCalories || 0,
            pendingWorkouts: workoutsForNotification,
            lastSynced: new Date().toISOString(),
            isConnected: prev.isConnected || hasHealthData
          }));
        }
      }
    } catch (error) {
    }
  }, []);

  // Periodically refresh HealthKit steps/calories and re-sync workouts on foreground
  // NOTE: Initial syncHealthKit() is called in the data loading block above AFTER
  // activities are loaded from Firebase, to avoid race condition with activitiesRef
  useEffect(() => {
    if (!user?.uid || !Capacitor.isNativePlatform()) return;

    // Function to refresh steps and calories from HealthKit
    const refreshHealthKitData = async () => {
      try {
        const [steps, calories] = await Promise.all([
          fetchTodaySteps(),
          fetchTodayCalories()
        ]);
        const hasHealthData = (steps > 0 || calories > 0);
        setHealthKitData(prev => ({
          ...prev,
          todaySteps: steps ?? prev.todaySteps ?? 0,
          todayCalories: calories ?? prev.todayCalories ?? 0,
          isConnected: prev.isConnected || hasHealthData
        }));
      } catch (e) {
        // Silently fail
      }
    };

    // Refresh steps and calories every 5 minutes (these update frequently)
    const refreshInterval = setInterval(refreshHealthKitData, 5 * 60 * 1000); // 5 minutes

    // Also refresh when app comes back to foreground (full sync including workouts)
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        // Skip refresh when returning from photo picker to prevent re-render glitch
        if (photoPickerActive) return;
        // Clear badge and delivered notifications when app returns to foreground
        clearBadge();
        clearAllNotifications();
        refreshHealthKitData();
        // Re-sync workouts when returning to foreground
        if (user?.uid) {
          try {
            // Fetch fresh activities (force refresh to pick up watch workouts)
            const freshActivities = await getUserActivities(user.uid, true);
            lastFirestoreActivityCount.current = freshActivities.length;
            activitiesRef.current = freshActivities;
            activitiesFromFirestore.current = true; // Skip debounced save — data is already in Firestore
            lastFirestoreSyncTime.current = Date.now(); // Timestamp-based protection window
            setActivities(freshActivities);

            // Recalculate weekly progress so dashboard rings update with fresh data
            const freshProgress = calculateWeeklyProgress(freshActivities);
            setWeeklyProgress(freshProgress);
            pushWidgetData(freshProgress);

            // Check for pending celebrations from watch (goals completed on watch but not yet celebrated on phone)
            try {
              // Read phone-local celebration flag BEFORE syncing from Firestore
              const phoneShown = getPhoneCelebrationShown();

              const freshProfile = await getUserProfile(user.uid, true);
              const currentWeekKey = getCurrentWeekKey();

              // Refresh unread feed count (for red dot on Friends tab)
              if (freshProfile?.unreadFeedCount > 0) {
                setUnreadFeedCount(freshProfile.unreadFeedCount);
              }

              // Check for pending share prompt (from weekly/monthly summary notification)
              const pendingLocal = localStorage.getItem('pendingSharePrompt');
              const pendingFirestore = freshProfile?.pendingSharePrompt;
              const pending = pendingLocal ? JSON.parse(pendingLocal) : pendingFirestore;
              if (pending?.type === 'weekly') {
                // Clear the flag immediately so it only shows once
                localStorage.removeItem('pendingSharePrompt');
                updateUserProfile(user.uid, { pendingSharePrompt: null }).catch(() => {});
                // Calculate last week's date range (Sunday to Saturday)
                const today = new Date();
                const lastSunday = new Date(today);
                lastSunday.setDate(today.getDate() - today.getDay() - 7);
                const lastSaturday = new Date(lastSunday);
                lastSaturday.setDate(lastSunday.getDate() + 6);
                // Only show if the prompt was sent within the last 7 days (avoid stale prompts)
                const sentAge = pending.sentAt ? (Date.now() - new Date(pending.sentAt).getTime()) : 0;
                if (sentAge < 7 * 24 * 60 * 60 * 1000) {
                  setTimeout(() => {
                    setShareWeekRange({ startDate: lastSunday, endDate: lastSaturday });
                    setShowShare(true);
                  }, 1000);
                }
              }

              // Load streaks from Firestore (watch may have updated them)
              if (freshProfile?.streaks) {
                setUserData(prev => ({
                  ...prev,
                  streaks: {
                    master: freshProfile.streaks.master ?? prev.streaks.master,
                    lifts: freshProfile.streaks.lifts ?? prev.streaks.lifts,
                    cardio: freshProfile.streaks.cardio ?? prev.streaks.cardio,
                    recovery: freshProfile.streaks.recovery ?? prev.streaks.recovery,
                    stepsGoal: freshProfile.streaks.stepsGoal ?? prev.streaks.stepsGoal
                  }
                }));
              }

              // Sync weekCelebrations from Firestore (for streak tracking state)
              if (freshProfile?.weekCelebrations?.week === currentWeekKey) {
                setWeekCelebrations(freshProfile.weekCelebrations);
                localStorage.setItem('weekCelebrations', JSON.stringify(freshProfile.weekCelebrations));
              }

              // Show master celebration if phone hasn't shown it yet
              // ALWAYS verify actual activity counts — never trust firestoreSaysMaster alone
              // because watch may have stale data (e.g., phone deleted an activity the watch doesn't know about)
              if (!phoneShown.master) {
                const goals = userDataRef.current?.goals || freshProfile?.goals || { liftsPerWeek: 4, cardioPerWeek: 3, recoveryPerWeek: 2 };
                const freshProgress = calculateWeeklyProgress(freshActivities);
                const allGoalsMet = freshProgress.lifts.completed >= goals.liftsPerWeek &&
                  freshProgress.cardio.completed >= goals.cardioPerWeek &&
                  freshProgress.recovery.completed >= goals.recoveryPerWeek;

                if (allGoalsMet) {
                  const newWC = { week: currentWeekKey, lifts: true, cardio: true, recovery: true, master: true };
                  setWeekCelebrations(newWC);
                  localStorage.setItem('weekCelebrations', JSON.stringify(newWC));
                  updateUserProfile(user.uid, { weekCelebrations: newWC }).catch(() => {});
                  markPhoneCelebrationShown();
                  setTimeout(() => {
                    triggerHaptic(ImpactStyle.Heavy);
                    setShowWeekStreakCelebration(true);
                  }, 800);
                }
              }
            } catch (e) {
              // Non-critical — celebration check failed, continue normally
              // Non-critical — celebration check failed, continue normally
            }

            // Small delay to ensure state is updated before syncHealthKit reads it
            await new Promise(r => setTimeout(r, 100));
            syncHealthKit();

            // Healing check: the Firestore SDK's offline persistence queue may flush
            // stale writes from BEFORE the import-only fix was deployed. These writes
            // happen at the native level (below JS) and can overwrite watch-saved data.
            // After a delay (giving the SDK time to flush), re-read Firestore and
            // re-stamp the correct data if it was overwritten.
            const capturedCount = freshActivities.length;
            const capturedUid = user.uid;
            setTimeout(async () => {
              try {
                const verifyActivities = await getUserActivities(capturedUid, true);
                if (verifyActivities.length < capturedCount) {
                  console.warn(`[VisibilityHeal] Stale SDK flush detected: server has ${verifyActivities.length} but should have ${capturedCount} — re-saving`);
                  await saveUserActivities(capturedUid, freshActivities);
                }
              } catch (e) {
                // Non-critical — healing check failed
              }
            }, 5000);
          } catch (e) {
            syncHealthKit();
          }
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(refreshInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [user?.uid, syncHealthKit]);

  // Pull-to-refresh hook (enabled on home tab only - feed tab has its own local pull-to-refresh)
  // Threshold of 80 matches native iOS UIRefreshControl feel
  // Disabled when modals are open to prevent accidental refresh
  const { pullDistance, isRefreshing } = usePullToRefresh(refreshData, {
    threshold: 80,
    resistance: 0.5,
    enabled: isOnboarded === true && !showAddActivity && !isHomeWorkoutPickerOpen && !showFinishWorkout && activeTab === 'home'
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
            setAuthLoading(false);
          }
          return; // Don't set up web listener on native
        } catch (error) {
          setAuthLoading(false);
          return;
        }
      }

      // Web auth listener (only for web, not native)
      const authTimeout = setTimeout(() => {
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

  // Check if tour should be shown for new/returning users who haven't seen it yet
  const tourShownRef = useRef(false);
  useEffect(() => {
    if (!isLoading && isOnboarded && userProfile && userProfile.hasCompletedTour !== true && !tourShownRef.current) {
      tourShownRef.current = true;
      // Delay to ensure home tab UI is fully rendered (especially after paywall dismissal)
      const timer = setTimeout(() => {
        setActiveTab('home');
        setShowTour(true);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [isLoading, isOnboarded, userProfile?.hasCompletedTour]);

  // Real state management
  const [activities, setActivities] = useState(initialActivities);
  useEffect(() => { activitiesRef.current = activities; }, [activities]);
  const [calendarData, setCalendarData] = useState(initialCalendarData);
  const [healthHistory, setHealthHistory] = useState([]);
  const [weeklyProgress, setWeeklyProgress] = useState(initialWeeklyProgress);
  const [userData, setUserData] = useState(initialUserData);
  const [recordsLoaded, setRecordsLoaded] = useState(false); // Track if records have been loaded from Firestore

  // Ref to always have access to latest userData (avoids stale closure issues)
  const userDataRef = useRef(userData);
  const recordsLoadedRef = useRef(false);
  const healthKitDataRef = useRef(healthKitData);
  useEffect(() => {
    userDataRef.current = userData;
  }, [userData]);
  useEffect(() => {
    healthKitDataRef.current = healthKitData;
  }, [healthKitData]);
  useEffect(() => {
    recordsLoadedRef.current = recordsLoaded;
  }, [recordsLoaded]);


  // Track if initial load is complete to avoid saving on mount
  const hasLoadedActivities = useRef(false);

  // Save activities to Firestore when they change
  useEffect(() => {
    if (!user) {
      return;
    }

    // Skip the initial load - only save after user makes changes
    if (!hasLoadedActivities.current) {
      hasLoadedActivities.current = true;
      return;
    }

    // Skip save if activities were just loaded from Firestore or saved directly
    // (handleActivitySaved and handleDeleteActivity now save directly and set this flag)
    if (activitiesFromFirestore.current) {
      activitiesFromFirestore.current = false;
      return;
    }

    // Skip save if we recently synced/saved (10-second protection window)
    // This catches race conditions where the flag was already consumed but data is still fresh
    const timeSinceSync = Date.now() - lastFirestoreSyncTime.current;
    if (timeSinceSync < 10000) {
      return;
    }

    // Guard: never overwrite Firestore with fewer activities than we last loaded/saved.
    if (activities.length < lastFirestoreActivityCount.current) {
      return;
    }

    // Debounced IMPORT-ONLY path — NEVER writes to Firestore.
    // All saves are handled directly by handleActivitySaved, handleDeleteActivity,
    // auto-import, and smart-save. This path only catches cases where the phone's
    // React state is behind Firestore (e.g., watch saved while phone was backgrounded).
    // Writing from here caused a critical bug: when the phone was backgrounded, JS was
    // suspended and protection flags were never set, so the debounced save would write
    // stale React state (e.g., 15 activities) overwriting watch saves (e.g., 18 activities).
    const timeoutId = setTimeout(async () => {
      // Re-check guards inside the timeout (state may have changed during the delay)
      if (activitiesFromFirestore.current) {
        activitiesFromFirestore.current = false;
        return;
      }
      const timeSinceSyncInner = Date.now() - lastFirestoreSyncTime.current;
      if (timeSinceSyncInner < 10000) {
        return;
      }
      // Don't run while app is in background — JS state may be stale
      if (document.visibilityState === 'hidden') {
        return;
      }
      // Check if Firestore has newer data and import it
      try {
        const currentActivities = await getUserActivities(user.uid, true);
        if (currentActivities.length > activities.length) {
          // Firestore has more activities (watch added some), adopt Firestore's data
          console.log('[DebouncedImport] Importing', currentActivities.length, 'activities from Firestore (local had', activities.length, ')');
          lastFirestoreActivityCount.current = currentActivities.length;
          activitiesRef.current = currentActivities;
          activitiesFromFirestore.current = true;
          lastFirestoreSyncTime.current = Date.now();
          setActivities(currentActivities);
          return;
        }
        // Counts match or local has more — update tracking ref
        lastFirestoreActivityCount.current = currentActivities.length;
      } catch (e) {
        // Fetch failed — skip silently
      }
    }, 2000);

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

  // Auto-save HealthKit type preferences to Firestore when they change
  const hasLoadedHKPreferences = useRef(false);
  useEffect(() => {
    if (!user || !userData?.healthKitTypePreferences) return;
    // Skip the initial load
    if (!hasLoadedHKPreferences.current) {
      hasLoadedHKPreferences.current = true;
      return;
    }
    if (Object.keys(userData.healthKitTypePreferences).length > 0) {
      const timeoutId = setTimeout(() => {
        updateUserProfile(user.uid, { healthKitTypePreferences: userData.healthKitTypePreferences });
      }, 500);
      return () => clearTimeout(timeoutId);
    }
  }, [userData?.healthKitTypePreferences, user]);

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
    if (['Running', 'Cycle', 'Sports', 'Stair Climbing', 'Elliptical'].includes(activity.type)) return 'cardio';
    if (['Cold Plunge', 'Sauna', 'Contrast Therapy', 'Massage', 'Chiropractic', 'Yoga', 'Pilates'].includes(activity.type)) return 'recovery';
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

    // Categorize using the helper (respects countToward, lifting+cardio counts in both)
    const lifts = weekActivities.filter(a => { const c = getActivityCategory(a); return c === 'lifting' || c === 'lifting+cardio'; });
    const cardio = weekActivities.filter(a => { const c = getActivityCategory(a); return c === 'cardio' || c === 'lifting+cardio'; });
    const recovery = weekActivities.filter(a => getActivityCategory(a) === 'recovery');
    
    // For breakdown, use actual activity types
    const running = weekActivities.filter(a => a.type === 'Running');
    const cycling = weekActivities.filter(a => a.type === 'Cycle');
    const sports = weekActivities.filter(a => a.type === 'Sports');
    const coldPlunge = weekActivities.filter(a => a.type === 'Cold Plunge');
    const sauna = weekActivities.filter(a => a.type === 'Sauna');
    const contrastTherapy = weekActivities.filter(a => a.type === 'Contrast Therapy');
    const massage = weekActivities.filter(a => a.type === 'Massage');
    const chiropractic = weekActivities.filter(a => a.type === 'Chiropractic');
    const yoga = weekActivities.filter(a => a.type === 'Yoga');
    const pilates = weekActivities.filter(a => a.type === 'Pilates');

    // Contrast Therapy adds individual tallies to each chosen subtype
    const contrastColdPlungeTally = contrastTherapy.filter(a => a.coldType === 'Cold Plunge').length;
    const contrastColdShowerTally = contrastTherapy.filter(a => a.coldType === 'Cold Shower').length;
    const contrastSaunaTally = contrastTherapy.filter(a => a.hotType === 'Sauna').length;
    const contrastHotPlungeTally = contrastTherapy.filter(a => a.hotType === 'Hot Plunge').length;

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
          coldPlunge: coldPlunge.length + contrastColdPlungeTally,
          sauna: sauna.length + contrastSaunaTally,
          contrastTherapy: contrastTherapy.length,
          coldShower: contrastColdShowerTally,
          hotPlunge: contrastHotPlungeTally,
          massage: massage.length,
          chiropractic: chiropractic.length,
          yoga: yoga.length,
          pilates: pilates.length
        }
      },
      calories: { burned: totalCalories, goal: userData.goals.caloriesPerDay },
      steps: { today: 0, goal: userData.goals.stepsPerDay }
    };
  };

  // Push data to iPhone home screen widget via App Group
  const pushWidgetData = (progress) => {
    const s = userDataRef.current?.streaks || {};
    const g = userDataRef.current?.goals || {};
    const p = progress || weeklyProgress;
    const hk = healthKitDataRef.current || {};

    // Build recent activities for large widget (most recent first, max 5)
    const allActs = activitiesRef.current || [];
    const recentActivities = [...allActs]
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .slice(0, 5)
      .map(a => {
        const cat = getActivityCategory(a);
        const name = a.type === 'Strength Training' ? (a.strengthType || a.subtype || 'Strength Training')
          : a.type === 'Other' ? (a.subtype || 'Other')
          : a.type;
        return JSON.stringify({ name, category: cat, date: a.date || '', duration: a.duration || 0, calories: a.calories || 0 });
      });

    // Days left in the week including today (Sunday=0 through Saturday=6)
    const daysLeft = 7 - new Date().getDay();

    updateWidgetData({
      masterStreak: s.master || 0,
      liftsStreak: s.lifts || 0,
      cardioStreak: s.cardio || 0,
      recoveryStreak: s.recovery || 0,
      liftsCompleted: p?.lifts?.completed || 0,
      liftsGoal: g.liftsPerWeek || 4,
      cardioCompleted: p?.cardio?.completed || 0,
      cardioGoal: g.cardioPerWeek || 3,
      recoveryCompleted: p?.recovery?.completed || 0,
      recoveryGoal: g.recoveryPerWeek || 2,
      todaySteps: hk.todaySteps || 0,
      stepsGoal: g.stepsPerDay || 10000,
      todayCalories: hk.todayCalories || 0,
      daysLeftInWeek: daysLeft,
      recentActivities
    });
  };

  // Re-push widget data when health stats update (steps/calories arrive async)
  useEffect(() => {
    if (healthKitData?.todaySteps > 0 || healthKitData?.todayCalories > 0) {
      pushWidgetData();
    }
  }, [healthKitData?.todaySteps, healthKitData?.todayCalories]);

  // Recalculate streaks from actual activity history
  // Walks backwards week by week from the current week and counts consecutive completed weeks
  const recalculateStreaksFromHistory = (allActivities, goals) => {
    if (!goals || !allActivities || allActivities.length === 0) return null;

    const today = new Date();
    const currentWeekStart = new Date(today);
    currentWeekStart.setDate(today.getDate() - today.getDay()); // Sunday
    currentWeekStart.setHours(0, 0, 0, 0);

    // Get shielded weeks and vacation weeks
    const shieldedWeeks = userDataRef.current?.streakShield?.shieldedWeeks || [];
    const vacationWeeks = userDataRef.current?.vacationMode?.vacationWeeks || [];

    // Walk backwards week by week, starting from LAST completed week
    // (current week is still in progress, so start from the week before)
    let streaks = { master: 0, lifts: 0, cardio: 0, recovery: 0 };
    let liftsAlive = true, cardioAlive = true, recoveryAlive = true;

    // Check up to 52 weeks back
    for (let weekOffset = 1; weekOffset <= 52; weekOffset++) {
      const weekStart = new Date(currentWeekStart);
      weekStart.setDate(weekStart.getDate() - (weekOffset * 7));
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);

      const weekStartStr = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
      const weekEndStr = `${weekEnd.getFullYear()}-${String(weekEnd.getMonth() + 1).padStart(2, '0')}-${String(weekEnd.getDate()).padStart(2, '0')}`;

      // Check if this week was shielded or on vacation
      const isShielded = shieldedWeeks.includes(weekStartStr);
      const isVacation = vacationWeeks.includes(weekStartStr);

      // Vacation weeks: streak stays alive but doesn't increment (frozen)
      if (isVacation) {
        // Don't increment any streaks, but don't break them either — just skip
        continue;
      }

      // Get activities for this week
      const weekActivities = allActivities.filter(a => a.date >= weekStartStr && a.date <= weekEndStr);
      const liftsCount = weekActivities.filter(a => { const c = getActivityCategory(a); return c === 'lifting' || c === 'lifting+cardio'; }).length;
      const cardioCount = weekActivities.filter(a => { const c = getActivityCategory(a); return c === 'cardio' || c === 'lifting+cardio'; }).length;
      const recoveryCount = weekActivities.filter(a => getActivityCategory(a) === 'recovery').length;

      const liftsGoalMet = isShielded || liftsCount >= goals.liftsPerWeek;
      const cardioGoalMet = isShielded || cardioCount >= goals.cardioPerWeek;
      const recoveryGoalMet = isShielded || recoveryCount >= goals.recoveryPerWeek;

      if (liftsAlive && liftsGoalMet) streaks.lifts++;
      else liftsAlive = false;

      if (cardioAlive && cardioGoalMet) streaks.cardio++;
      else cardioAlive = false;

      if (recoveryAlive && recoveryGoalMet) streaks.recovery++;
      else recoveryAlive = false;

      // Master streak: all three must be met
      if (liftsAlive && cardioAlive && recoveryAlive) streaks.master++;

      // If all streaks are broken, stop
      if (!liftsAlive && !cardioAlive && !recoveryAlive) break;
    }

    // Now check if current week's goals are also met (adds to streak)
    const currentWeekEnd = new Date(currentWeekStart);
    currentWeekEnd.setDate(currentWeekEnd.getDate() + 6);
    const cwStartStr = `${currentWeekStart.getFullYear()}-${String(currentWeekStart.getMonth() + 1).padStart(2, '0')}-${String(currentWeekStart.getDate()).padStart(2, '0')}`;
    const cwEndStr = `${currentWeekEnd.getFullYear()}-${String(currentWeekEnd.getMonth() + 1).padStart(2, '0')}-${String(currentWeekEnd.getDate()).padStart(2, '0')}`;
    const currentWeekShielded = shieldedWeeks.includes(cwStartStr);
    const currentWeekVacation = vacationWeeks.includes(cwStartStr);

    // If current week is vacation, don't add to streaks (frozen)
    if (currentWeekVacation) {
      return streaks;
    }

    const cwActivities = allActivities.filter(a => a.date >= cwStartStr && a.date <= cwEndStr);
    const cwLifts = cwActivities.filter(a => { const c = getActivityCategory(a); return c === 'lifting' || c === 'lifting+cardio'; }).length;
    const cwCardio = cwActivities.filter(a => { const c = getActivityCategory(a); return c === 'cardio' || c === 'lifting+cardio'; }).length;
    const cwRecovery = cwActivities.filter(a => getActivityCategory(a) === 'recovery').length;

    // Current week extends the streak if it's contiguous (streaks > 0 means the most recent
    // past week had the goal met). If the past chain broke at an older week, the streak from
    // recent weeks is still valid and the current week should extend it, not reset to 1.
    if (currentWeekShielded || cwLifts >= goals.liftsPerWeek) {
      streaks.lifts = streaks.lifts > 0 ? streaks.lifts + 1 : 1;
    }
    if (currentWeekShielded || cwCardio >= goals.cardioPerWeek) {
      streaks.cardio = streaks.cardio > 0 ? streaks.cardio + 1 : 1;
    }
    if (currentWeekShielded || cwRecovery >= goals.recoveryPerWeek) {
      streaks.recovery = streaks.recovery > 0 ? streaks.recovery + 1 : 1;
    }
    const allCurrentMet = currentWeekShielded || (cwLifts >= goals.liftsPerWeek && cwCardio >= goals.cardioPerWeek && cwRecovery >= goals.recoveryPerWeek);
    if (allCurrentMet) {
      streaks.master = streaks.master > 0 ? streaks.master + 1 : 1;
    }

    return streaks;
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

  // Refresh active accepted challenges whenever the AddActivityModal opens — used to show
  // the "fulfills these challenges" section with checkboxes. One-shot fetch (not a subscription)
  // because the user's accepted challenges don't churn during a single workout-logging session.
  useEffect(() => {
    if (!showAddActivity || !user?.uid) return;
    let cancelled = false;
    getChallengesForUser(user.uid).then(all => {
      if (cancelled) return;
      const accepted = all.filter(c => {
        if (c.status !== 'active') return false;
        const myStatus = c.participants?.[user.uid]?.status
          || (c.friendUid === user.uid ? c.friendStatus : null);
        return myStatus === 'accepted';
      });
      setAccepterActiveChallenges(accepted);
    });
    return () => { cancelled = true; };
  }, [showAddActivity, user?.uid]);

  // Resolve activity + challenge IDs from a multi-match push payload, then open the chooser modal.
  // Activity comes from local state; challenges come from a fresh fetch (so the chooser sees
  // current rule + status even if the user just changed something).
  const openChallengeChooser = useCallback(async ({ activityId, challengeIds }) => {
    if (!activityId || !Array.isArray(challengeIds) || challengeIds.length === 0 || !user?.uid) return;
    const activity = activities.find(a => String(a.id) === String(activityId));
    if (!activity) {
      console.warn('[openChallengeChooser] activity not found', activityId);
      return;
    }
    const all = await getChallengesForUser(user.uid);
    const wanted = new Set(challengeIds.map(String));
    const candidates = all.filter(c => wanted.has(String(c.id)) && c.status === 'active');
    if (candidates.length === 0) return;
    setChallengeChooserState({ activity, candidateChallenges: candidates });
  }, [user?.uid, activities]);

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
        // Continue saving the activity without the photo, but notify user
        setToastMessage('Photo could not be uploaded. Activity saved without photo.');
        setToastType('success');
        setShowToast(true);
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
      // Use the time from activityData (from linked workout) if available, otherwise use current time
      newActivity = {
        ...activityData,
        photoURL,
        id: activityId,
        time: activityData.time || new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
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

    // Save directly to Firestore — don't rely on debounced save to avoid race conditions with watch
    activitiesFromFirestore.current = true; // Prevent debounced save from re-saving
    lastFirestoreSyncTime.current = Date.now(); // 5-second protection window
    lastFirestoreActivityCount.current = updatedActivities.length;
    activitiesRef.current = updatedActivities;
    if (user?.uid) {
      saveUserActivities(user.uid, updatedActivities).then(() => {
        notifyWatchDataChanged();
      }).catch(err => {
        console.error('[handleActivitySaved] Direct save failed:', err);
      });
    }

    // Optimistic fulfillment — flip the UI to "completed" instantly for any challenge this
    // activity will fulfill. Mirrors the cloud function's decision logic so we don't get out
    // of sync. Cloud function still runs server-side for stats + push notifications.
    if (!isEdit && user?.uid && Array.isArray(accepterActiveChallenges) && accepterActiveChallenges.length > 0) {
      const intentIds = Array.isArray(newActivity.intendedChallengeIds)
        ? newActivity.intendedChallengeIds.map(String)
        : null;
      // Per-challenge match check using the same client helper the modal uses.
      const matched = accepterActiveChallenges.filter(c =>
        evaluateActivityAgainstChallenge(newActivity, c.matchRule).matches
      );
      // Photo-required gate: skip if photo missing.
      const eligible = matched.filter(c => !c.requirePhoto || newActivity.photoURL);
      let willFulfill = [];
      if (intentIds !== null) {
        // Explicit intent (incl. empty): only fulfill listed.
        const wanted = new Set(intentIds);
        willFulfill = eligible.filter(c => wanted.has(String(c.id)));
      } else if (eligible.length === 1) {
        willFulfill = eligible;
      }
      // Multi-match without intent stays deferred (cloud function sends pick-which push).
      if (willFulfill.length > 0) {
        const completedAt = Date.now();
        setOptimisticChallengeCompletions(prev => {
          const next = new Map(prev);
          for (const c of willFulfill) {
            next.set(c.id, { activityId: newActivity.id, completedAt });
            // Auto-prune after 30s — listener will have caught up by then.
            setTimeout(() => {
              setOptimisticChallengeCompletions(p => {
                const m = new Map(p);
                m.delete(c.id);
                return m;
              });
            }, 30000);
          }
          return next;
        });
        // Instant feedback — don't wait for the cloud-function-issued push notification.
        triggerHaptic(ImpactStyle.Medium);
        setToastMessage(willFulfill.length === 1 ? 'Challenge complete! 🏆' : `${willFulfill.length} challenges complete! 🏆`);
        setToastType('success');
        setShowToast(true);
      }
    }

    // If this was a HealthKit workout or linked to one, remove it from pending list
    const workoutUUIDToRemove = activityData.healthKitUUID || activityData.linkedHealthKitUUID;
    if (workoutUUIDToRemove) {
      setHealthKitData(prev => ({
        ...prev,
        pendingWorkouts: prev.pendingWorkouts.filter(w => w.healthKitUUID !== workoutUUIDToRemove)
      }));
    }

    // Recalculate weekly progress
    const newProgress = calculateWeeklyProgress(updatedActivities);
    setWeeklyProgress(newProgress);
    pushWidgetData(newProgress);

    // Write to HealthKit (fire-and-forget, don't block the save flow)
    // Skip if: editing existing activity, came from Apple Health, is HealthKit-sourced, linked to existing HealthKit workout, already saved (live workout), or is Cold Plunge/Sauna
    const skipHealthKitTypes = ['Cold Plunge', 'Sauna', 'Contrast Therapy', 'Massage', 'Chiropractic'];
    if (!isEdit && !activityData.fromAppleHealth && activityData.source !== 'healthkit' && !activityData.linkedHealthKitUUID && !activityData.healthKitSaved && !skipHealthKitTypes.includes(newActivity.type)) {
      saveWorkoutToHealthKit(newActivity)
        .then(() => {})
        .catch(() => {});
    }

    // Skip celebration for edits
    if (isEdit) return;

    // Offer to challenge a friend with this activity (only if user has friends + activity is challengeable).
    // isChallengeable enforces same-day, category, and non-warmup in one check.
    if (isChallengeable(newActivity) && friends.length > 0) {
      setChallengeModalActivity(newActivity);
    }

    // Trigger celebration for completing a goal
    const goals = userData.goals;
    // Calculate prev progress directly from activities state (not weeklyProgress which can be stale)
    const prevProgress = calculateWeeklyProgress(activities);
    // Use ref to get latest records (avoids stale closure issues)
    const records = userDataRef.current.personalRecords;
    
    // Get the effective category of this activity (respects countToward)
    const activityCategory = getActivityCategory(newActivity);
    
    // Check for personal records and return all broken records
    const checkAndUpdateRecords = () => {
      // Skip record checking if records haven't been loaded from Firestore yet
      // This prevents false "new record" notifications when comparing against initial zeros
      if (!recordsLoadedRef.current) {
        return null;
      }

      // Only track records that are actually updated (don't spread all records to avoid overwriting other concurrent updates)
      const updatedRecords = {};
      const recordsBroken = []; // Collect all broken records

      // Warm-up activities don't count toward any records or stats
      const isWarmup = activity.countToward === 'warmup' || activity.customActivityCategory === 'warmup';
      if (isWarmup) return null;

      // Recovery activities don't count as "workouts" for records
      const recoveryTypes = ['Cold Plunge', 'Sauna', 'Contrast Therapy', 'Massage', 'Chiropractic'];
      const yogaPilatesAsRecovery = ['Yoga', 'Pilates'].includes(activity.type) && (!activity.countToward || activity.countToward === 'recovery');
      const isRecovery = recoveryTypes.includes(activity.type) || yogaPilatesAsRecovery;
      const isStrength = activity.type === 'Strength Training' || activity.countToward === 'strength';
      const isCardio = ['Running', 'Cycle', 'Sports', 'Stair Climbing', 'Elliptical'].includes(activity.type) || activity.countToward === 'cardio';

      // Helper to get current record value (handles both old number format and new object format)
      // Check updatedRecords first in case we updated it earlier in this function
      const getRecordValue = (recordKey) => {
        const record = updatedRecords[recordKey] !== undefined ? updatedRecords[recordKey] : records[recordKey];
        if (record === null || record === undefined) return 0;
        if (typeof record === 'object') return record.value || 0;
        return record;
      };

      // Single activity: Highest calories (counts all activities except warmup)
      if (activity.calories && activity.calories > getRecordValue('highestCalories')) {
        updatedRecords.highestCalories = { value: activity.calories, activityType: activity.type };
        recordsBroken.push(`${activity.calories} cals (${activity.type === 'Other' ? (activity.subtype || 'Other') : activity.type}) 🔥`);
      }
      
      // Single workout records (only for non-recovery activities)
      if (!isRecovery) {
        // Longest strength session
        if (isStrength && activity.duration && activity.duration > getRecordValue('longestStrength')) {
          updatedRecords.longestStrength = { value: activity.duration, activityType: activity.type };
          const hours = Math.floor(activity.duration / 60);
          const mins = activity.duration % 60;
          const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins} min`;
          recordsBroken.push(`${durationStr} strength 💪`);
        }

        // Longest cardio session
        if (isCardio && activity.duration && activity.duration > getRecordValue('longestCardio')) {
          updatedRecords.longestCardio = { value: activity.duration, activityType: activity.type };
          const hours = Math.floor(activity.duration / 60);
          const mins = activity.duration % 60;
          const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins} min`;
          recordsBroken.push(`${durationStr} cardio (${activity.type === 'Other' ? (activity.subtype || 'Other') : activity.type}) ❤️‍🔥`);
        }

        // Longest distance
        if (activity.distance && activity.distance > getRecordValue('longestDistance')) {
          updatedRecords.longestDistance = { value: activity.distance, activityType: activity.type };
          recordsBroken.push(`${parseFloat(activity.distance).toFixed(2)} mi (${activity.type === 'Other' ? (activity.subtype || 'Other') : activity.type}) ❤️‍🔥`);
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
      
      // Calculate weekly calories using HealthKit data + manual workout calories (same as UI)
      // Use today's date consistently
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Reset to midnight to avoid timezone issues
      const weekStart = new Date(today);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday of current week
      const weekStartStr = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      // Build health data map from healthHistory + today's live data
      const healthDataByDate = {};
      healthHistory.forEach(entry => {
        if (entry.date) {
          healthDataByDate[entry.date] = entry;
        }
      });
      // Use live HealthKit data for today
      if (healthKitData.todayCalories > 0) {
        healthDataByDate[todayStr] = {
          date: todayStr,
          calories: healthKitData.todayCalories
        };
      }

      // Calculate weekly calories: HealthKit active energy + manual workout calories
      let weeklyCalories = 0;
      for (let d = 0; d <= today.getDay(); d++) {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + d);
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

        // Use HealthKit calories directly — wearables already track all active energy
        const healthData = healthDataByDate[dateStr];
        weeklyCalories += healthData?.calories || 0;
      }

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
    const justCompletedLifts = (activityCategory === 'lifting' || activityCategory === 'lifting+cardio') &&
      prevProgress.lifts.completed < goals.liftsPerWeek &&
      newProgress.lifts.completed >= goals.liftsPerWeek;

    const justCompletedCardio = (activityCategory === 'cardio' || activityCategory === 'lifting+cardio') &&
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

    // Get current week celebration state — only increment streaks if not already celebrated this week for that category
    const currentWeekKey = getCurrentWeekKey();
    const wc = weekCelebrations.week === currentWeekKey ? weekCelebrations : { ...emptyWeekCelebrations, week: currentWeekKey };
    const newWC = { ...wc };

    // Determine which categories are newly completing (transition) AND not already celebrated
    const shouldCelebrateLifts = justCompletedLifts && !wc.lifts;
    const shouldCelebrateCardio = justCompletedCardio && !wc.cardio;
    const shouldCelebrateRecovery = justCompletedRecovery && !wc.recovery;
    const willStreakWeek = willCompleteAllGoals && !wc.master;

    // Update streaks when goals are met - combined into single setUserData call to avoid race conditions
    // If week will be streaked, skip individual celebration (week streak takes priority)
    if (shouldCelebrateLifts) {
      const newStreak = userData.streaks.lifts + 1;
      const isNewRecord = isStreakRecord('strength', newStreak);
      setUserData(prev => ({
        ...prev,
        streaks: { ...prev.streaks, lifts: newStreak },
        personalRecords: isNewRecord
          ? { ...prev.personalRecords, longestStrengthStreak: newStreak }
          : prev.personalRecords
      }));
      newWC.lifts = true;
      // Only show individual celebration if NOT about to streak the week
      if (!willStreakWeek) {
        if (isNewRecord) {
          setCelebrationMessage(`New Record: ${newStreak} Week Strength Streak! 🏆`);
        } else if (checkStreakMilestone(newStreak)) {
          setCelebrationMessage(`${newStreak} Week Strength Streak! 💪`);
        } else {
          setCelebrationMessage('Strength goal complete! 💪');
        }
        setCelebrationType('strength');
        triggerHaptic(ImpactStyle.Heavy);
        setShowCelebration(true);
      }
    } else if (shouldCelebrateCardio) {
      const newStreak = userData.streaks.cardio + 1;
      const isNewRecord = isStreakRecord('cardio', newStreak);
      setUserData(prev => ({
        ...prev,
        streaks: { ...prev.streaks, cardio: newStreak },
        personalRecords: isNewRecord
          ? { ...prev.personalRecords, longestCardioStreak: newStreak }
          : prev.personalRecords
      }));
      newWC.cardio = true;
      // Only show individual celebration if NOT about to streak the week
      if (!willStreakWeek) {
        if (isNewRecord) {
          setCelebrationMessage(`New Record: ${newStreak} Week Cardio Streak! 🏆`);
        } else if (checkStreakMilestone(newStreak)) {
          setCelebrationMessage(`${newStreak} Week Cardio Streak! 🔥`);
        } else {
          setCelebrationMessage('Cardio goal complete! ❤️‍🔥');
        }
        setCelebrationType('cardio');
        triggerHaptic(ImpactStyle.Heavy);
        setShowCelebration(true);
      }
    } else if (shouldCelebrateRecovery) {
      const newStreak = userData.streaks.recovery + 1;
      const isNewRecord = isStreakRecord('recovery', newStreak);
      setUserData(prev => ({
        ...prev,
        streaks: { ...prev.streaks, recovery: newStreak },
        personalRecords: isNewRecord
          ? { ...prev.personalRecords, longestRecoveryStreak: newStreak }
          : prev.personalRecords
      }));
      newWC.recovery = true;
      // Only show individual celebration if NOT about to streak the week
      if (!willStreakWeek) {
        if (isNewRecord) {
          setCelebrationMessage(`New Record: ${newStreak} Week Recovery Streak! 🏆`);
        } else if (checkStreakMilestone(newStreak)) {
          setCelebrationMessage(`${newStreak} Week Recovery Streak! ❄️`);
        } else {
          setCelebrationMessage('Recovery goal complete! 🧊');
        }
        setCelebrationType('recovery');
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
    if (shouldCelebrateLifts || shouldCelebrateCardio || shouldCelebrateRecovery) {
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

      newWC.master = true;
      markPhoneCelebrationShown();

      // Show the week streak celebration modal immediately (no delay needed since we skipped individual celebration)
      setTimeout(() => {
        triggerHaptic(ImpactStyle.Heavy); // Strong haptic for celebration!
        setShowWeekStreakCelebration(true);
      }, 500);
    }

    // Persist weekCelebrations state (locally + Firestore)
    if (shouldCelebrateLifts || shouldCelebrateCardio || shouldCelebrateRecovery || willStreakWeek) {
      setWeekCelebrations(newWC);
      localStorage.setItem('weekCelebrations', JSON.stringify(newWC));

      // Persist streaks and celebration state to Firestore (single write for all changes)
      if (user?.uid) {
        setTimeout(() => {
          const latestData = userDataRef.current;
          updateUserProfile(user.uid, {
            streaks: latestData.streaks,
            weekCelebrations: newWC
          }).catch(() => {});
          savePersonalRecords(user.uid, latestData.personalRecords).catch(() => {});
        }, 100);
      }
    }

    // Safety net: recalculate streaks from actual activity history to ensure correctness
    // (handles edge cases like delete-then-re-add where state might be stale)
    const recalculated = recalculateStreaksFromHistory(updatedActivities, goals);
    if (recalculated) {
      setUserData(prev => ({
        ...prev,
        streaks: {
          ...prev.streaks,
          ...recalculated
        }
      }));
      // Persist recalculated streaks
      if (user?.uid) {
        setTimeout(() => {
          const latestData = userDataRef.current;
          updateUserProfile(user.uid, {
            streaks: latestData.streaks
          }).catch(() => {});
        }, 200);
      }
    }
  };

  const handleDeleteActivity = (activityId) => {
    // Find the activity to delete
    const activityToDelete = activities.find(a => a.id === activityId);
    if (!activityToDelete) return;

    // Haptic feedback for delete action
    triggerHaptic(ImpactStyle.Medium);

    // If this was a HealthKit workout, dismiss its UUID so it won't re-sync
    const hkUUID = activityToDelete.healthKitUUID || activityToDelete.linkedHealthKitUUID;
    if (hkUUID) {
      const newDismissed = [...dismissedWorkoutUUIDs, hkUUID];
      setDismissedWorkoutUUIDs(newDismissed);
      localStorage.setItem('dismissedWorkoutUUIDs', JSON.stringify(newDismissed));
    }

    // Remove from activities
    const updatedActivities = activities.filter(a => a.id !== activityId);
    setActivities(updatedActivities);

    // Prevent debounced save from interfering with the direct save below
    // (debounced save would see fewer activities and could undo the delete or overwrite watch data)
    activitiesFromFirestore.current = true;
    lastFirestoreSyncTime.current = Date.now();
    lastFirestoreActivityCount.current = updatedActivities.length;
    activitiesRef.current = updatedActivities;

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
    pushWidgetData(newProgress);

    // Recalculate single-activity personal records from remaining activities
    const recalculateRecords = () => {
      const currentRecords = userDataRef.current.personalRecords || {};
      const newRecords = {
        highestCalories: { value: 0, activityType: null },
        longestStrength: { value: 0, activityType: null },
        longestCardio: { value: 0, activityType: null },
        longestDistance: { value: 0, activityType: null },
        longestRun: { value: 0, activityType: null },
        longestCycle: { value: 0, activityType: null },
        longestWalk: { value: 0, activityType: null },
        fastestPace: { value: null, activityType: null },
        fastestCyclingPace: { value: null, activityType: null },
      };

      // Recovery activity types
      const recoveryTypes = ['Cold Plunge', 'Sauna', 'Contrast Therapy', 'Massage', 'Chiropractic'];

      updatedActivities.forEach(activity => {
        const isWarmup = activity.countToward === 'warmup' || activity.customActivityCategory === 'warmup';
        if (isWarmup) return; // Warm-up activities don't count toward any records

        const yogaPilatesAsRecovery = ['Yoga', 'Pilates'].includes(activity.type) &&
          (!activity.countToward || activity.countToward === 'recovery');
        const isRecovery = recoveryTypes.includes(activity.type) || yogaPilatesAsRecovery;
        const isStrength = activity.type === 'Strength Training' || activity.countToward === 'strength';
        const isCardio = ['Running', 'Cycle', 'Sports', 'Stair Climbing', 'Elliptical'].includes(activity.type) || activity.countToward === 'cardio';

        // Highest calories (all activities except warmup)
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

          // Longest run
          if (activity.type === 'Running' && activity.distance && activity.distance > (newRecords.longestRun.value || 0)) {
            newRecords.longestRun = { value: activity.distance, activityType: 'Running' };
          }

          // Longest cycle
          if (activity.type === 'Cycle' && activity.distance && activity.distance > (newRecords.longestCycle.value || 0)) {
            newRecords.longestCycle = { value: activity.distance, activityType: 'Cycle' };
          }

          // Longest walk
          if (activity.type === 'Walking' && activity.distance && activity.distance > (newRecords.longestWalk.value || 0)) {
            newRecords.longestWalk = { value: activity.distance, activityType: 'Walking' };
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

    // Check if deleting this activity drops any category below its goal
    // If so, clear the celebrated flag and decrement the streak (since it was wrongly incremented)
    const goals = userData.goals;
    const oldProgress = weeklyProgress; // progress before deletion
    const currentWeekKey = getCurrentWeekKey();
    const wc = weekCelebrations.week === currentWeekKey ? { ...weekCelebrations } : { ...emptyWeekCelebrations, week: currentWeekKey };
    let wcChanged = false;
    let streakChanges = {};

    // Check each category: was it at/above goal before, and now below?
    if (wc.lifts && oldProgress.lifts.completed >= goals.liftsPerWeek && newProgress.lifts.completed < goals.liftsPerWeek) {
      wc.lifts = false;
      wc.master = false; // master can't be valid if a category is incomplete
      streakChanges.lifts = userData.streaks.lifts - 1;
      if (wc.master === false && oldProgress.lifts.completed >= goals.liftsPerWeek && oldProgress.cardio.completed >= goals.cardioPerWeek && oldProgress.recovery.completed >= goals.recoveryPerWeek) {
        streakChanges.master = userData.streaks.master - 1;
      }
      wcChanged = true;
    }
    if (wc.cardio && (oldProgress.cardio?.completed || 0) >= goals.cardioPerWeek && (newProgress.cardio?.completed || 0) < goals.cardioPerWeek) {
      wc.cardio = false;
      wc.master = false;
      streakChanges.cardio = userData.streaks.cardio - 1;
      if (!('master' in streakChanges) && oldProgress.lifts.completed >= goals.liftsPerWeek && (oldProgress.cardio?.completed || 0) >= goals.cardioPerWeek && (oldProgress.recovery?.completed || 0) >= goals.recoveryPerWeek) {
        streakChanges.master = userData.streaks.master - 1;
      }
      wcChanged = true;
    }
    if (wc.recovery && (oldProgress.recovery?.completed || 0) >= goals.recoveryPerWeek && (newProgress.recovery?.completed || 0) < goals.recoveryPerWeek) {
      wc.recovery = false;
      wc.master = false;
      streakChanges.recovery = userData.streaks.recovery - 1;
      if (!('master' in streakChanges) && oldProgress.lifts.completed >= goals.liftsPerWeek && (oldProgress.cardio?.completed || 0) >= goals.cardioPerWeek && (oldProgress.recovery?.completed || 0) >= goals.recoveryPerWeek) {
        streakChanges.master = userData.streaks.master - 1;
      }
      wcChanged = true;
    }

    if (wcChanged) {
      setWeekCelebrations(wc);
      localStorage.setItem('weekCelebrations', JSON.stringify(wc));
      // Clear phone celebration shown flag so re-completing shows the celebration again
      localStorage.removeItem('phoneCelebrationShown');
    }

    // Full streak recalculation from history (handles all edge cases including past week deletions)
    const recalculated = recalculateStreaksFromHistory(updatedActivities, goals);
    if (recalculated) {
      setUserData(prev => ({
        ...prev,
        streaks: {
          ...prev.streaks,
          ...recalculated
        }
      }));
    }

    // Persist deletion to Firestore (direct save — no longer relies on debounced useEffect)
    if (user?.uid) {
      saveUserActivities(user.uid, updatedActivities, { allowDecrease: true }).then(() => {
        notifyWatchDataChanged();
      }).catch(() => {});
      // Always persist recalculated streaks after delete
      setTimeout(() => {
        const latestData = userDataRef.current;
        updateUserProfile(user.uid, {
          streaks: latestData.streaks,
          ...(wcChanged ? { weekCelebrations: wc } : {})
        }).catch(() => {});
      }, 100);

      // Fire-and-forget: clean up social data (reactions, comments, replies) and photo
      cleanupActivitySocialData(user.uid, activityId).catch(() => {});
      if (activityToDelete.photoURL) {
        deleteActivityPhoto(activityToDelete.photoURL).catch(() => {});
      }
    }

  };

  // Check for daily steps/calories goal completion and celebrate
  useEffect(() => {
    if (!userData?.goals) return;

    const stepsGoal = userData.goals.stepsPerDay || 10000;
    const caloriesGoal = userData.goals.caloriesPerDay || 500;
    const today = getTodayDate();

    // Reset if it's a new day
    if (dailyGoalsCelebrated.date !== today) {
      setDailyGoalsCelebrated({ date: today, steps: false, calories: false });
      localStorage.setItem('dailyGoalsCelebrated', JSON.stringify({ date: today, steps: false, calories: false }));
      return;
    }

    // Check steps goal
    if (!dailyGoalsCelebrated.steps && healthKitData.todaySteps >= stepsGoal && healthKitData.todaySteps > 0) {
      setCelebrationMessage('Steps Goal Hit!');
      setCelebrationType('daily-steps');
      setShowCelebration(true);
      triggerHaptic(ImpactStyle.Medium);
      const updated = { ...dailyGoalsCelebrated, steps: true };
      setDailyGoalsCelebrated(updated);
      localStorage.setItem('dailyGoalsCelebrated', JSON.stringify(updated));
    }
    // Check calories goal (only if steps celebration isn't showing)
    else if (!dailyGoalsCelebrated.calories && healthKitData.todayCalories >= caloriesGoal && healthKitData.todayCalories > 0 && !showCelebration) {
      setCelebrationMessage('Calories Goal Hit!');
      setCelebrationType('daily-calories');
      setShowCelebration(true);
      triggerHaptic(ImpactStyle.Medium);
      const updated = { ...dailyGoalsCelebrated, calories: true };
      setDailyGoalsCelebrated(updated);
      localStorage.setItem('dailyGoalsCelebrated', JSON.stringify(updated));
    }
  }, [healthKitData.todaySteps, healthKitData.todayCalories, userData?.goals, dailyGoalsCelebrated, showCelebration]);

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
      currentGoals={null}
      onCancel={null}
      onComplete={async (goals, privacySettings, extraData) => {
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

        // Save new onboarding fields to Firestore
        if (extraData) {
          const extraFields = {};
          if (extraData.fitnessGoal) extraFields.fitnessGoal = extraData.fitnessGoal;
          if (extraData.fitnessLevel) extraFields.fitnessLevel = extraData.fitnessLevel;
          if (extraData.favoriteRecovery) extraFields.favoriteRecovery = extraData.favoriteRecovery;
          if (extraData.wearable) extraFields.wearable = extraData.wearable;
          if (Object.keys(extraFields).length > 0) {
            await updateUserProfile(user.uid, extraFields);
          }
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
        // Present welcome offer paywall BEFORE setting isOnboarded to true
        // This keeps the onboarding black screen behind the native paywall
        // so users can't interact with the main app through the paywall overlay
        if (Capacitor.isNativePlatform()) {
          try {
            const { purchased } = await presentPaywall({ offeringIdentifier: 'Welcome Offer' });
            if (purchased) {
              const proStatus = await checkProStatus();
              setIsPro(proStatus);
            }
          } catch (e) {
            console.error('[App] Post-onboarding paywall error:', e);
          }
        }

        // NOW show the main app (after paywall is dismissed)
        justOnboardedRef.current = true; // Suppress Smart Save modal on first HealthKit sync
        setIsOnboarded(true);
        setActiveTab('home');
      }}
    />;
  }

  // Custom refresh indicator component
  return (
    <div
      ref={scrollContainerRef}
      className="min-h-screen text-white overflow-y-auto"
      style={{
        backgroundColor: '#0A0A0A',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif',
        height: '100vh'
      }}
      onScroll={(e) => {
        if (activeTab === 'home') {
          setScrollY(e.currentTarget.scrollTop);
        }
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
        key={activeWorkout?.startTime || 'no-workout'}
        workout={activeWorkout}
        activeTab={activeTab}
        isFinishing={showFinishWorkout}
        onFinish={async () => {
          // Pause the watch workout when opening the end workout screen
          if (activeWorkout?.source === 'watch') {
            try {
              await pauseWatchWorkout();
            } catch (e) {
              console.log('[FinishWorkout] Failed to pause watch:', e.message);
            }
          }
          setShowFinishWorkout(true);
        }}
        onResumedFromWatch={() => {
          // Watch was resumed by user on the watch — close the end workout modal on phone
          setShowFinishWorkout(false);
        }}
        onCancel={async () => {
          // Cancel the workout (watch or phone)
          try {
            if (activeWorkout?.source === 'watch') {
              await cancelWatchWorkout();
            } else {
              await cancelLiveWorkout();
            }
          } catch (e) {
            console.log('[CancelWorkout] Error (clearing anyway):', e.message);
          }
          setActiveWorkout(null);
          setShowFinishWorkout(false);
          triggerHaptic(ImpactStyle.Medium);
        }}
      />

      {/* Finish Workout Modal */}
      <FinishWorkoutModal
        isOpen={showFinishWorkout}
        workout={activeWorkout}
        onDiscard={async () => {
          try {
            if (activeWorkout?.source === 'watch') {
              await cancelWatchWorkout();
            } else {
              await cancelLiveWorkout();
            }
          } catch (e) {
            console.log('[DiscardWorkout] Error:', e.message);
          }
          setActiveWorkout(null);
          setShowFinishWorkout(false);
          triggerHaptic(ImpactStyle.Medium);
        }}
        onClose={async () => {
          // Resume the watch workout when cancelling out of end workout screen
          if (activeWorkout?.source === 'watch') {
            try {
              await resumeWatchWorkout();
            } catch (e) {
              console.log('[FinishWorkout] Failed to resume watch:', e.message);
            }
          }
          setShowFinishWorkout(false);
        }}
        linkedWorkoutUUIDs={[
          ...activities.filter(a => a.linkedHealthKitUUID).map(a => a.linkedHealthKitUUID),
          ...activities.filter(a => a.healthKitUUID).map(a => a.healthKitUUID)
        ]}
        onSave={async (finishedWorkout) => {
          // If user linked to an Apple Health workout, don't create a duplicate in HealthKit
          const shouldSkipHealthKitWrite = !!finishedWorkout.linkedHealthKitUUID;
          const isWatchWorkout = activeWorkout?.source === 'watch';

          let liveResult = { success: false };

          if (isWatchWorkout) {
            // End the watch workout — returns final metrics from watch
            try {
              const watchResult = await endWatchWorkout();
              const wasQueued = watchResult?.queued === true;
              if (wasQueued) {
                // Command was queued via applicationContext — watch will end when it wakes up
                console.log('[FinishWorkout] Watch end queued (watch not reachable)');
                liveResult = { success: true, queued: true };
              } else {
                liveResult = {
                  success: true,
                  workoutUUID: watchResult.workoutUUID,
                  duration: watchResult.duration,
                  calories: watchResult.calories,
                  avgHr: watchResult.avgHr,
                  maxHr: watchResult.maxHr,
                  distance: watchResult.distance || 0,
                };
                // Auto-fill metrics from watch if not manually entered
                if (!finishedWorkout.calories && watchResult.calories) {
                  finishedWorkout.calories = watchResult.calories;
                }
                if (!finishedWorkout.avgHr && watchResult.avgHr) {
                  finishedWorkout.avgHr = watchResult.avgHr;
                }
                if (!finishedWorkout.maxHr && watchResult.maxHr) {
                  finishedWorkout.maxHr = watchResult.maxHr;
                }
                if (!finishedWorkout.duration && watchResult.duration) {
                  finishedWorkout.duration = watchResult.duration;
                }
                // Distance from watch is in miles (already converted by WorkoutResult)
                if (!finishedWorkout.distance && watchResult.distance > 0) {
                  finishedWorkout.distance = parseFloat(watchResult.distance.toFixed(2));
                }
              }
            } catch (e) {
              console.log('[FinishWorkout] Watch end error:', e.message);
            }
          } else if (!shouldSkipHealthKitWrite) {
            // End the live workout in HealthKit (this saves it automatically)
            liveResult = await endLiveWorkout({
              calories: finishedWorkout.calories,
              distance: finishedWorkout.distance
            });
          } else {
            // Just cancel the live workout builder without saving (we're linking to existing)
            await cancelLiveWorkout();
          }

          // Mark workout data appropriately
          const workoutData = {
            ...finishedWorkout,
            healthKitSaved: shouldSkipHealthKitWrite || isWatchWorkout ? true : liveResult.success,
            healthKitUUID: shouldSkipHealthKitWrite ? undefined : liveResult.workoutUUID,
          };

          // Save the finished workout to Firestore using the existing handler
          handleActivitySaved(workoutData);

          // Open stamp modal for sharing
          setStampActivity(workoutData);
          // Fetch route coords if distance activity with HealthKit UUID
          const hasHkUUID = workoutData.healthKitUUID || workoutData.linkedHealthKitUUID;
          const isOutdoor = workoutData.subtype !== 'Indoor';
          if (hasHkUUID && isOutdoor) {
            fetchWorkoutRoute(workoutData.healthKitUUID || workoutData.linkedHealthKitUUID, workoutData.healthKitStartDate || workoutData.linkedHealthKitStartDate)
              .then(result => setStampRouteCoords(result.hasRoute ? result.coordinates : []))
              .catch(() => setStampRouteCoords([]));
          } else {
            setStampRouteCoords([]);
          }
          setShowStampModal(true);

          // Clear active workout state
          setActiveWorkout(null);
          setShowFinishWorkout(false);
          triggerHaptic(ImpactStyle.Heavy);
        }}
      />

      {/* Fixed Header for Home tab - collapses on scroll */}
      {activeTab === 'home' && (() => {
        const isCollapsed = scrollY > 50;
        const iconSize = isCollapsed ? 'h-9 w-9' : 'h-11 w-11';
        const wordmarkOpacity = isCollapsed ? 0 : 0.7;
        const wordmarkWidth = isCollapsed ? 'w-0' : 'w-auto';

        return (
          <div
            className="fixed top-0 left-0 right-0 z-40 px-4 pb-6 pointer-events-none"
            style={{
              paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)',
              background: 'linear-gradient(to bottom, rgba(10, 10, 10, 1) 0%, rgba(10, 10, 10, 1) 78%, rgba(10, 10, 10, 0.5) 92%, rgba(10, 10, 10, 0) 100%)',
              backdropFilter: 'blur(30px)',
              WebkitBackdropFilter: 'blur(30px)',
              maskImage: 'linear-gradient(to bottom, black 0%, black 82%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 82%, transparent 100%)'
            }}
          >
            <div className="flex items-center justify-between pointer-events-auto">
              <div className="flex items-center gap-0 cursor-pointer" onClick={handleLogoTap}>
                <img
                  src="/icon-transparent.png"
                  alt="Day Seven"
                  className={`${iconSize} transition-all duration-300 ease-out`}
                />
                <img
                  src="/wordmark.png"
                  alt="dayseven"
                  className={`h-4 ${wordmarkWidth} transition-all duration-300 ease-out overflow-hidden`}
                  style={{ opacity: wordmarkOpacity }}
                />
              </div>
              {userData?.streaks?.master > 0 && !activeWorkout && (
                <button
                  onClick={() => switchTab('profile')}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-all duration-300 ease-out active:scale-95"
                  style={{ backgroundColor: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.2)' }}
                >
                  <span style={{ fontSize: isCollapsed ? 12 : 14 }} className="transition-all duration-300">🔥</span>
                  <span className="font-bold transition-all duration-300" style={{ color: '#FFD700', fontSize: isCollapsed ? 12 : 14 }}>{userData.streaks.master}</span>
                  <span className="font-medium transition-all duration-300" style={{ color: 'rgba(255,215,0,0.7)', fontSize: isCollapsed ? 9 : 11 }}>week hybrid streak</span>
                </button>
              )}
            </div>
          </div>
        );
      })()}

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
                  pendingSync={(healthKitData.pendingWorkouts || []).filter(w => {
                    // Filter out dismissed workouts
                    if (dismissedWorkoutUUIDs.includes(w.healthKitUUID)) {
                      return false;
                    }
                    // Filter out workouts already saved/linked in activities
                    const isAlreadySaved = activities.some(a => {
                      // Direct UUID match
                      if (a.healthKitUUID === w.healthKitUUID || a.linkedHealthKitUUID === w.healthKitUUID) {
                        return true;
                      }
                      // Also check for same date + similar time (within 2 hours) + same type
                      // This handles cases where UUID format changed
                      if (a.date === w.date && a.type === w.type) {
                        // Parse times and check if they're close
                        const parseTime = (timeStr) => {
                          if (!timeStr) return null;
                          const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
                          if (!match) return null;
                          let hours = parseInt(match[1], 10);
                          const minutes = parseInt(match[2], 10);
                          if (match[3].toUpperCase() === 'PM' && hours !== 12) hours += 12;
                          if (match[3].toUpperCase() === 'AM' && hours === 12) hours = 0;
                          return hours * 60 + minutes;
                        };
                        const activityTime = parseTime(a.time);
                        const workoutTime = parseTime(w.time);
                        if (activityTime !== null && workoutTime !== null) {
                          const timeDiff = Math.abs(activityTime - workoutTime);
                          if (timeDiff <= 1) { // Within 1 minute - true duplicates have nearly identical times
                            return true;
                          }
                        }
                      }
                      return false;
                    });
                    return !isAlreadySaved;
                  })}
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
                  onDismissWorkout={handleDismissWorkout}
                  onWorkoutPickerChange={setIsHomeWorkoutPickerOpen}
                  friends={friends}
                  onChallengeCountsChange={({ outgoingThisMonthCount }) => setOutgoingThisMonthChallengeCount(outgoingThisMonthCount)}
                  onChallengeActivity={(activity) => setChallengeModalActivity(activity)}
                  onNavigateToHistory={() => {
                    setActiveTab('profile');
                    // Wait for the profile tab to mount + render, then scroll into view.
                    setTimeout(() => {
                      historyLatestActivityRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 150);
                  }}
                  onNavigateToChallenges={(challenge) => {
                    // Tapped a specific home card → jump to its segment + perspective.
                    // Section "See all" passes no challenge → just switch tab.
                    if (challenge?.id) {
                      const isMine = challenge.challengerUid === user?.uid;
                      setChallengesNavTarget({
                        segment: 'active',
                        subSegment: isMine ? 'sent' : 'received',
                        nonce: Date.now(),
                      });
                    }
                    switchTab('challenges');
                  }}
                  optimisticChallengeCompletions={optimisticChallengeCompletions}
                  isPro={isPro}
                  onPresentPaywall={async () => {
                    const { purchased } = await presentPaywall();
                    if (purchased) {
                      const proStatus = await checkProStatus();
                      setIsPro(proStatus);
                    }
                  }}
                  onUseStreakShield={(weekKey) => {
                    const newShield = {
                      lastUsedWeek: weekKey,
                      shieldedWeeks: [...(userData.streakShield?.shieldedWeeks || []), weekKey]
                    };
                    setUserData(prev => {
                      const updated = { ...prev, streakShield: newShield };
                      // Recalculate streaks after shield activation (especially important for retroactive use)
                      const goals = prev.goals || { liftsPerWeek: 4, cardioPerWeek: 3, recoveryPerWeek: 2 };
                      // Temporarily update the ref so recalculate picks up the new shieldedWeeks
                      const prevRef = userDataRef.current;
                      userDataRef.current = updated;
                      const recalculated = recalculateStreaksFromHistory(activities, goals);
                      userDataRef.current = prevRef;
                      if (recalculated) {
                        updated.streaks = { ...prev.streaks, ...recalculated };
                        if (user?.uid) {
                          updateUserProfile(user.uid, { streakShield: newShield, streaks: updated.streaks }).catch(() => {});
                        }
                      } else if (user?.uid) {
                        updateUserProfile(user.uid, { streakShield: newShield }).catch(() => {});
                      }
                      return updated;
                    });
                  }}
                  onDeactivateVacation={() => {
                    const updated = { ...userData.vacationMode, isActive: false };
                    setUserData(prev => ({ ...prev, vacationMode: updated }));
                    if (user?.uid) {
                      updateUserProfile(user.uid, { vacationMode: updated }).catch(() => {});
                    }
                  }}
                  autoImportedCount={autoImportedCount}
                  onDismissAutoImported={() => setAutoImportedCount(0)}
                  onShareStamp={(activity, routeCoords) => {
                    setStampActivity(activity);
                    setStampRouteCoords(routeCoords || []);
                    setShowStampModal(true);
                  }}
                />
              )}
              {activeTab === 'challenges' && (
                <ChallengesTab
                  user={user}
                  userProfile={userProfile}
                  userData={userData}
                  activities={activities}
                  friends={friends}
                  isPro={isPro}
                  onChallengeCountsChange={({ outgoingThisMonthCount }) => setOutgoingThisMonthChallengeCount(outgoingThisMonthCount)}
                  navTarget={challengesNavTarget}
                  optimisticCompletions={optimisticChallengeCompletions}
                  onStartChallengeWorkout={(challenge) => {
                    // Pre-fill the activity logger from the challenge — type from match rule (or
                    // challenger's activity), intent stamped so the cloud function fulfills this
                    // specific challenge instead of triggering the multi-match deferral.
                    const prefillType = challenge?.matchRule?.activityType || challenge?.challengerActivity?.type || null;
                    handleAddActivity({
                      type: prefillType,
                      intendedChallengeIds: [challenge.id],
                    });
                  }}
                  onApplyPastActivityToChallenge={(challenge) => setApplyPastActivityChallenge(challenge)}
                />
              )}
              {activeTab === 'feed' && (
                <ActivityFeed
                  user={user}
                  userProfile={userProfile}
                  friends={friends}
                  onOpenFriends={() => setShowFriends(true)}
                  pendingRequestsCount={pendingFriendRequests}
                  onActiveViewChange={setFeedActiveView}
                  onOpenChallenge={(friend) => setChallengePickerForFriend(friend)}
                  feedCacheRef={feedCacheRef}
                  isPro={isPro}
                  onPresentPaywall={async () => {
                    const { purchased } = await presentPaywall();
                    if (purchased) {
                      const proStatus = await checkProStatus();
                      setIsPro(proStatus);
                    }
                  }}
                />
              )}
              {activeTab === 'profile' && (
                <ProfilePage
                  user={user}
                  userProfile={userProfile}
                  userData={userData}
                  onOpenSettings={() => setShowSettings(true)}
                  onShare={(range) => {
                    if (range?.isMonthShare) {
                      setShareMonthRange({ startDate: range.startDate, endDate: range.endDate });
                      setShareWeekRange(null);
                    } else {
                      setShareWeekRange(range || null);
                      setShareMonthRange(null);
                    }
                    setShowShare(true);
                  }}
                  activities={activities}
                  calendarData={calendarData}
                  healthHistory={healthHistory}
                  healthKitData={healthKitData}
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
                  isPro={isPro}
                  onPresentPaywall={async () => {
                    const { purchased } = await presentPaywall();
                    if (purchased) {
                      const proStatus = await checkProStatus();
                      setIsPro(proStatus);
                    }
                  }}
                  onShareStamp={(activity, routeCoords) => {
                    setStampActivity(activity);
                    setStampRouteCoords(routeCoords || []);
                    setShowStampModal(true);
                  }}
                  friends={friends}
                  onChallengeActivity={(activity) => setChallengeModalActivity(activity)}
                  historyLatestActivityRef={historyLatestActivityRef}
                  onUseStreakShield={(weekKey) => {
                    const newShield = {
                      lastUsedWeek: weekKey,
                      shieldedWeeks: [...(userData.streakShield?.shieldedWeeks || []), weekKey]
                    };
                    setUserData(prev => {
                      const updated = { ...prev, streakShield: newShield };
                      const goals = prev.goals || { liftsPerWeek: 4, cardioPerWeek: 3, recoveryPerWeek: 2 };
                      const prevRef = userDataRef.current;
                      userDataRef.current = updated;
                      const recalculated = recalculateStreaksFromHistory(activities, goals);
                      userDataRef.current = prevRef;
                      if (recalculated) {
                        updated.streaks = { ...prev.streaks, ...recalculated };
                        if (user?.uid) {
                          updateUserProfile(user.uid, { streakShield: newShield, streaks: updated.streaks }).catch(() => {});
                        }
                      } else if (user?.uid) {
                        updateUserProfile(user.uid, { streakShield: newShield }).catch(() => {});
                      }
                      return updated;
                    });
                  }}
                  onToggleVacationMode={() => {
                    const vm = userData.vacationMode || {};
                    if (vm.isActive) {
                      const updated = { ...vm, isActive: false };
                      setUserData(prev => ({ ...prev, vacationMode: updated }));
                      if (user?.uid) {
                        updateUserProfile(user.uid, { vacationMode: updated }).catch(() => {});
                      }
                    } else {
                      const currentYear = new Date().getFullYear();
                      const used = vm.activationYear === currentYear ? (vm.activationsThisYear || 0) : 0;
                      if (used >= 3) {
                        setToastMessage('You\'ve used all 3 vacation activations this year');
                        setToastType('success');
                        setShowToast(true);
                        return;
                      }
                      const today = new Date();
                      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                      const currentWeek = getCurrentWeekKey();
                      const updated = {
                        isActive: true,
                        startDate: todayStr,
                        activationsThisYear: used + 1,
                        activationYear: currentYear,
                        vacationWeeks: [...(vm.vacationWeeks || []), ...(vm.vacationWeeks?.includes(currentWeek) ? [] : [currentWeek])]
                      };
                      setUserData(prev => ({ ...prev, vacationMode: updated }));
                      if (user?.uid) {
                        updateUserProfile(user.uid, { vacationMode: updated }).catch(() => {});
                      }
                    }
                  }}
                />
              )}
            </>
          )}
        </div>
        {showSettings && (
          <div className="fixed inset-0 z-50" style={{ backgroundColor: '#000' }}>
            {/* Status bar blur — same treatment as the regular non-home tabs underneath. */}
            <div
              className="fixed top-0 left-0 right-0 pointer-events-none"
              style={{
                height: 'calc(env(safe-area-inset-top, 0px) + 30px)',
                zIndex: 60,
                background: 'linear-gradient(to bottom, rgba(10, 10, 10, 1) 0%, rgba(10, 10, 10, 1) 50%, rgba(10, 10, 10, 0.9) 70%, rgba(10, 10, 10, 0.6) 85%, transparent 100%)',
                maskImage: 'linear-gradient(to bottom, black 0%, black 50%, rgba(0,0,0,0.7) 70%, rgba(0,0,0,0.3) 85%, transparent 100%)',
                WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 50%, rgba(0,0,0,0.7) 70%, rgba(0,0,0,0.3) 85%, transparent 100%)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
              }}
            />
            <SettingsPage
              onClose={() => setShowSettings(false)}
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
              onUpdateMaxHeartRate={handleUpdateMaxHeartRate}
              onChangePassword={() => setShowChangePassword(true)}
              onResetPassword={handleResetPassword}
              onDeleteAccount={() => setShowDeleteAccount(true)}
              onNotificationSettings={() => setShowNotificationSettings(true)}
              isPro={isPro}
              onPresentPaywall={async () => {
                const { purchased } = await presentPaywall();
                if (purchased) {
                  const proStatus = await checkProStatus();
                  setIsPro(proStatus);
                }
              }}
              onPresentCustomerCenter={presentCustomerCenter}
              onRestorePurchases={async () => {
                const { isPro: restoredPro } = await restorePurchases();
                setIsPro(restoredPro);
              }}
              onToggleVacationMode={() => {
                const vm = userData.vacationMode || {};
                if (vm.isActive) {
                  // Deactivate
                  const updated = { ...vm, isActive: false };
                  setUserData(prev => ({ ...prev, vacationMode: updated }));
                  if (user?.uid) {
                    updateUserProfile(user.uid, { vacationMode: updated }).catch(() => {});
                  }
                } else {
                  // Activate — check limits
                  const currentYear = new Date().getFullYear();
                  const used = vm.activationYear === currentYear ? (vm.activationsThisYear || 0) : 0;
                  if (used >= 3) {
                    setToastMessage('You\'ve used all 3 vacation activations this year');
                    setToastType('success');
                    setShowToast(true);
                    return;
                  }
                  const today = new Date();
                  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                  const currentWeek = getCurrentWeekKey();
                  const updated = {
                    isActive: true,
                    startDate: todayStr,
                    activationsThisYear: used + 1,
                    activationYear: currentYear,
                    vacationWeeks: [...(vm.vacationWeeks || []), ...(vm.vacationWeeks?.includes(currentWeek) ? [] : [currentWeek])]
                  };
                  setUserData(prev => ({ ...prev, vacationMode: updated }));
                  if (user?.uid) {
                    updateUserProfile(user.uid, { vacationMode: updated }).catch(() => {});
                  }
                }
              }}
              onUseStreakShield={(weekKey) => {
                const newShield = {
                  lastUsedWeek: weekKey,
                  shieldedWeeks: [...(userData.streakShield?.shieldedWeeks || []), weekKey]
                };
                setUserData(prev => {
                  const updated = { ...prev, streakShield: newShield };
                  const goals = prev.goals || { liftsPerWeek: 4, cardioPerWeek: 3, recoveryPerWeek: 2 };
                  const prevRef = userDataRef.current;
                  userDataRef.current = updated;
                  const recalculated = recalculateStreaksFromHistory(activities, goals);
                  userDataRef.current = prevRef;
                  if (recalculated) {
                    updated.streaks = { ...prev.streaks, ...recalculated };
                    if (user?.uid) {
                      updateUserProfile(user.uid, { streakShield: newShield, streaks: updated.streaks }).catch(() => {});
                    }
                  } else if (user?.uid) {
                    updateUserProfile(user.uid, { streakShield: newShield }).catch(() => {});
                  }
                  return updated;
                });
              }}
            />
          </div>
        )}
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

          {/* Challenges */}
          <button
            ref={challengesTabRef}
            onClick={() => switchTab('challenges')}
            className="flex-1 py-3 flex flex-col items-center gap-1 transition-all duration-150 relative"
            style={{ transform: 'scale(1)' }}
            onTouchStart={(e) => { e.currentTarget.style.transform = 'scale(0.92)'; triggerHaptic(ImpactStyle.Light); }}
            onTouchEnd={(e) => e.currentTarget.style.transform = 'scale(1)'}
            onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.92)'}
            onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
            onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
          >
            <svg className="w-6 h-6" fill="none" stroke={activeTab === 'challenges' ? 'white' : '#6b7280'} viewBox="0 0 24 24" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            <span className={`text-xs ${activeTab === 'challenges' ? 'text-white' : 'text-gray-500'}`}>Challenges</span>
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
            {(pendingFriendRequests > 0 || unreadFeedCount > 0) && (
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
          triggerHaptic(ImpactStyle.Heavy);

          // Try to start workout on Apple Watch first (better metrics via HKWorkoutSession)
          // Always attempt sendMessage — it can wake the watch app even if isReachable is false
          try {
            // Send the original activity type name to the watch (e.g. "Cold Plunge", "Running", "Sports").
            // The watch has its own ActivityTypes.mapToHKActivityType() that handles the HK mapping.
            // For Sports, the specific sport is sent as subtype (e.g. "Basketball").
            const activityType = workoutData.type;
            const strengthType = workoutData.strengthType || null;
            const subtype = workoutData.subtype || null;
            const focusAreas = workoutData.focusAreas || (workoutData.focusArea ? [workoutData.focusArea] : null);
            console.log('[StartWorkout] Sending to watch:', activityType, ', subtype:', subtype);
            await startWatchWorkout(activityType, strengthType, subtype, focusAreas);
            console.log('[StartWorkout] Watch workout started via sendMessage');
            setActiveWorkout({ ...workoutData, source: 'watch', startTime: new Date().toISOString() });
            return;
          } catch (e) {
            console.log('[StartWorkout] sendMessage failed, using phone fallback:', e.message);
          }

          // Fallback: Start a live HealthKit workout session on phone.
          // startWatchApp is also fired in the background (from Swift errorHandler),
          // so the watch may wake up and start tracking too. If it does, the
          // watchWorkoutStarted listener will cancel the phone session and switch to watch source.
          setActiveWorkout({ ...workoutData, source: 'phone', startTime: new Date().toISOString() });
          const activityType = getHealthKitActivityType(workoutData);
          await startLiveWorkout(activityType, workoutData.subtype);

          // Proactive watch detection: poll every 2s for up to 15s to see if the watch
          // woke up and started tracking (startWatchApp may have woken it).
          // This is a safety net in case the watch's workoutStarted notification doesn't arrive.
          let watchCheckCount = 0;
          const watchCheckInterval = setInterval(async () => {
            watchCheckCount++;
            if (watchCheckCount > 7) {
              clearInterval(watchCheckInterval);
              return;
            }
            try {
              const metrics = await getWatchWorkoutMetrics();
              if (metrics.isActive) {
                console.log('[StartWorkout] Watch became active — switching source to watch');
                clearInterval(watchCheckInterval);
                try { await cancelLiveWorkout(); } catch (e) { /* ignore */ }
                setActiveWorkout(prev => prev ? { ...prev, source: 'watch' } : prev);
              }
            } catch (e) { /* ignore */ }
          }, 2000);
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
        onSaveHKPreference={(appleWorkoutName, pref) => {
          // Save HealthKit type preference (icon and/or category) for future auto-detection
          setUserData(prev => ({
            ...prev,
            healthKitTypePreferences: {
              ...(prev.healthKitTypePreferences || {}),
              [appleWorkoutName]: {
                ...(prev.healthKitTypePreferences?.[appleWorkoutName] || {}),
                ...pref
              }
            }
          }));
        }}
        otherPendingWorkoutsCount={
          (typeof pendingActivity?.id === 'string' && pendingActivity.id.startsWith('hk_'))
            ? (healthKitData.pendingWorkouts || []).filter(w => (w.healthKitUUID || w.id) !== (pendingActivity.healthKitUUID || pendingActivity.id)).length
            : 0
        }
        onSeeOtherWorkouts={() => {
          // Close modal and re-open picker for other workouts
          setShowAddActivity(false);
          setPendingActivity(null);
          // Trigger a state that opens the workout picker
          setShowWorkoutPicker(true);
        }}
        onBackToWorkoutPicker={() => {
          // Check if there are other pending workouts to show in the picker
          const otherWorkouts = (healthKitData.pendingWorkouts || []).filter(w =>
            !dismissedWorkoutUUIDs.includes(w.healthKitUUID) &&
            (w.healthKitUUID || w.id) !== (pendingActivity?.healthKitUUID || pendingActivity?.id)
          );
          setShowAddActivity(false);
          setPendingActivity(null);
          if (otherWorkouts.length > 0) {
            // Show the picker with other pending workouts
            setShowWorkoutPicker(true);
          }
          // If no other workouts, just close the modal (don't open empty picker)
        }}
        dismissedWorkoutUUIDs={dismissedWorkoutUUIDs}
        linkedWorkoutUUIDs={[
          ...activities.filter(a => a.linkedHealthKitUUID).map(a => a.linkedHealthKitUUID),
          ...activities.filter(a => a.healthKitUUID).map(a => a.healthKitUUID)
        ]}
        pendingWorkouts={healthKitData.pendingWorkouts || []}
        activeChallenges={accepterActiveChallenges}
        friendsByUid={Object.fromEntries(friends.map(f => [f.uid, f]))}
      />

      <ChallengeFriendModal
        isOpen={!!challengeModalActivity}
        onClose={() => {
          setChallengeModalActivity(null);
          setPreSelectedChallengeFriend(null);
        }}
        user={user}
        userProfile={userProfile}
        activity={challengeModalActivity}
        friends={friends}
        outgoingThisMonthCount={outgoingThisMonthChallengeCount}
        preSelectedFriendUid={preSelectedChallengeFriend}
        isPro={isPro}
        onPresentPaywall={async () => {
          const { purchased } = await presentPaywall();
          if (purchased) {
            const proStatus = await checkProStatus();
            setIsPro(proStatus);
          }
        }}
        onCreated={() => {
          setToastMessage('Challenge sent!');
          setToastType('success');
          setShowToast(true);
          setPreSelectedChallengeFriend(null);
        }}
      />

      {/* Workout Picker Modal (shown from "See other workouts" or when multiple pending) */}
      {showWorkoutPicker && (healthKitData.pendingWorkouts || []).filter(w => !dismissedWorkoutUUIDs.includes(w.healthKitUUID)).length > 0 && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setShowWorkoutPicker(false)}
          />
          <div
            className="relative w-full max-h-[70vh] rounded-t-3xl overflow-hidden"
            style={{ backgroundColor: '#1a1a1a' }}
          >
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 rounded-full bg-gray-600" />
            </div>
            <div className="px-4 pb-3 border-b border-white/10">
              <h3 className="text-lg font-semibold text-white text-center">Pending Workouts</h3>
              <p className="text-xs text-gray-400 text-center mt-1">Tap to add, swipe left to dismiss</p>
            </div>
            <div className="overflow-y-auto p-4 space-y-3" style={{ maxHeight: 'calc(70vh - 100px)' }}>
              {(healthKitData.pendingWorkouts || [])
                .filter(w => !dismissedWorkoutUUIDs.includes(w.healthKitUUID))
                .slice()
                .sort((a, b) => {
                  // Sort by time, most recent first (descending)
                  // Parse time strings like "7:30 AM" or "6:00 PM"
                  const parseTime = (timeStr) => {
                    if (!timeStr) return 0;
                    const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
                    if (!match) return 0;
                    let hours = parseInt(match[1], 10);
                    const minutes = parseInt(match[2], 10);
                    const isPM = match[3].toUpperCase() === 'PM';
                    if (isPM && hours !== 12) hours += 12;
                    if (!isPM && hours === 12) hours = 0;
                    return hours * 60 + minutes;
                  };
                  return parseTime(b.time) - parseTime(a.time);
                })
                .map((workout) => (
                <SwipeableWorkoutItem
                  key={workout.healthKitUUID || workout.id}
                  workout={workout}
                  onSelect={() => {
                    setShowWorkoutPicker(false);
                    handleAddActivity(workout);
                  }}
                  onDismiss={() => handleDismissWorkout(workout)}
                />
              ))}
            </div>
            <div className="p-4 border-t border-white/10">
              <button
                onClick={() => setShowWorkoutPicker(false)}
                className="w-full py-3 rounded-xl text-gray-400 font-medium transition-all active:bg-white/5"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

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
          handleSignOut();
        }}
      />

      {showSmartSaveExplainModal && (
        <SmartSaveExplainModal
          onClose={handleSmartSaveExplainClose}
          onDisable={handleSmartSaveDisable}
        />
      )}

      <ShareModal
        isOpen={showShare}
        onClose={() => {
          setShowShare(false);
          setShareWeekRange(null);
          setShareMonthRange(null);
        }}
        weekRange={shareWeekRange}
        monthRange={shareMonthRange}
        isPro={isPro}
        onPresentPaywall={async () => {
          const { purchased } = await presentPaywall();
          if (purchased) {
            const proStatus = await checkProStatus();
            setIsPro(proStatus);
          }
        }}
        onWeekChange={(range) => setShareWeekRange(range)}
        onMonthChange={(range) => setShareMonthRange(range)}
        stats={(() => {
          // Determine which week to use for stats
          const getWeekRange = () => {
            if (shareWeekRange?.startDate && shareWeekRange?.endDate) {
              // Convert Date objects to strings if needed
              const formatDateStr = (d) => {
                if (d instanceof Date) {
                  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                }
                return d; // Already a string
              };
              return {
                startStr: formatDateStr(shareWeekRange.startDate),
                endStr: formatDateStr(shareWeekRange.endDate)
              };
            }
            // Default to current week (Sunday - Saturday)
            const today = new Date();
            const weekStart = new Date(today);
            weekStart.setDate(weekStart.getDate() - weekStart.getDay());
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            return {
              startStr: `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`,
              endStr: `${weekEnd.getFullYear()}-${String(weekEnd.getMonth() + 1).padStart(2, '0')}-${String(weekEnd.getDate()).padStart(2, '0')}`
            };
          };
          const weekRange = getWeekRange();
          const weekActivitiesForShare = activities.filter(a => a.date >= weekRange.startStr && a.date <= weekRange.endStr);

          // Helper to determine effective category respecting countToward
          const getShareCategory = (a) => {
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

          // Calculate historical streaks at the time of the selected week
          const calculateHistoricalStreaks = () => {
            const goals = userData.goals;

            // Filter activities up to and including the selected week
            const historicalActivities = activities.filter(a => a.date <= weekRange.endStr);

            // Build a map of weeks and their activity counts
            const weekMap = {};
            historicalActivities.forEach(a => {
              const date = new Date(a.date + 'T12:00:00');
              const weekStart = new Date(date);
              weekStart.setDate(date.getDate() - date.getDay());
              const weekKey = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;

              if (!weekMap[weekKey]) {
                weekMap[weekKey] = { lifts: 0, cardio: 0, recovery: 0 };
              }

              const cat = getShareCategory(a);
              if (cat === 'lifting') weekMap[weekKey].lifts++;
              else if (cat === 'cardio') weekMap[weekKey].cardio++;
              else if (cat === 'recovery') weekMap[weekKey].recovery++;
            });

            // Calculate streaks going backwards from the week BEFORE the selected week
            // (matches History page logic: build streak from completed weeks, then check selected week separately)
            let masterStreak = 0;
            let strengthStreak = 0;
            let cardioStreak = 0;
            let recoveryStreak = 0;
            let liftsAlive = true, cardioAlive = true, recoveryAlive = true;

            let previousWeekDate = new Date(weekRange.startStr + 'T12:00:00');
            previousWeekDate.setDate(previousWeekDate.getDate() - 7);

            // Check consecutive weeks going backwards from the week before the selected week
            for (let i = 0; i < 200; i++) {
              const weekKey = `${previousWeekDate.getFullYear()}-${String(previousWeekDate.getMonth() + 1).padStart(2, '0')}-${String(previousWeekDate.getDate()).padStart(2, '0')}`;
              const weekData = weekMap[weekKey] || { lifts: 0, cardio: 0, recovery: 0 };

              const liftsGoalMet = weekData.lifts >= goals.liftsPerWeek;
              const cardioGoalMet = weekData.cardio >= goals.cardioPerWeek;
              const recoveryGoalMet = weekData.recovery >= goals.recoveryPerWeek;

              if (liftsAlive && liftsGoalMet) strengthStreak++;
              else liftsAlive = false;

              if (cardioAlive && cardioGoalMet) cardioStreak++;
              else cardioAlive = false;

              if (recoveryAlive && recoveryGoalMet) recoveryStreak++;
              else recoveryAlive = false;

              if (liftsAlive && cardioAlive && recoveryAlive) masterStreak++;

              // If all streaks are broken, stop checking
              if (!liftsAlive && !cardioAlive && !recoveryAlive) break;

              // Move to the previous week
              previousWeekDate.setDate(previousWeekDate.getDate() - 7);
            }

            // Now check the selected week itself — if goal is met, add to streak (or start fresh at 1)
            const selectedWeekKey = (() => {
              const d = new Date(weekRange.startStr + 'T12:00:00');
              return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            })();
            const selectedWeekData = weekMap[selectedWeekKey] || { lifts: 0, cardio: 0, recovery: 0 };

            if (selectedWeekData.lifts >= goals.liftsPerWeek) {
              strengthStreak = liftsAlive ? strengthStreak + 1 : 1;
            }
            if (selectedWeekData.cardio >= goals.cardioPerWeek) {
              cardioStreak = cardioAlive ? cardioStreak + 1 : 1;
            }
            if (selectedWeekData.recovery >= goals.recoveryPerWeek) {
              recoveryStreak = recoveryAlive ? recoveryStreak + 1 : 1;
            }
            const allSelectedMet = selectedWeekData.lifts >= goals.liftsPerWeek && selectedWeekData.cardio >= goals.cardioPerWeek && selectedWeekData.recovery >= goals.recoveryPerWeek;
            if (allSelectedMet) {
              masterStreak = (liftsAlive && cardioAlive && recoveryAlive) ? masterStreak + 1 : 1;
            }

            return { masterStreak, strengthStreak, cardioStreak, recoveryStreak };
          };

          const historicalStreaks = calculateHistoricalStreaks();

          return {
          // Streak stats (historical at time of selected week)
          streak: historicalStreaks.masterStreak,
          longestStreak: Math.max(userData.personalRecords.longestMasterStreak || 0, userData.streaks.master, historicalStreaks.masterStreak),
          strengthStreak: historicalStreaks.strengthStreak,
          cardioStreak: historicalStreaks.cardioStreak,
          recoveryStreak: historicalStreaks.recoveryStreak,
          longestStrengthStreak: Math.max(userData.personalRecords.longestStrengthStreak || 0, historicalStreaks.strengthStreak),
          longestCardioStreak: Math.max(userData.personalRecords.longestCardioStreak || 0, historicalStreaks.cardioStreak),
          longestRecoveryStreak: Math.max(userData.personalRecords.longestRecoveryStreak || 0, historicalStreaks.recoveryStreak),
          // Last 4 weeks history relative to selected week (true = won, false = missed)
          last4Weeks: (() => {
            const weeks = [];
            const goals = userData.goals;

            // Use the selected week as reference instead of today
            const selectedWeekStart = new Date(weekRange.startStr + 'T12:00:00');

            for (let i = 0; i < 4; i++) {
              const weekStart = new Date(selectedWeekStart);
              weekStart.setDate(weekStart.getDate() - (i * 7));
              const weekEnd = new Date(weekStart);
              weekEnd.setDate(weekStart.getDate() + 6);
              const weekStartStr = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
              const weekEndStr = `${weekEnd.getFullYear()}-${String(weekEnd.getMonth() + 1).padStart(2, '0')}-${String(weekEnd.getDate()).padStart(2, '0')}`;

              const weekActivities = activities.filter(a => a.date >= weekStartStr && a.date <= weekEndStr);
              const lifts = weekActivities.filter(a => getShareCategory(a) === 'lifting').length;
              const cardio = weekActivities.filter(a => getShareCategory(a) === 'cardio').length;
              const recovery = weekActivities.filter(a => getShareCategory(a) === 'recovery').length;

              const won = lifts >= goals.liftsPerWeek && cardio >= goals.cardioPerWeek && recovery >= goals.recoveryPerWeek;
              weeks.push(won);
            }
            return weeks.reverse(); // oldest to newest
          })(),
          // Total weeks won (up to and including selected week)
          weeksWon: (() => {
            const goals = userData.goals;
            const weekMap = {};

            // Only count activities up to the selected week
            const historicalActivities = activities.filter(a => a.date <= weekRange.endStr);

            // Group activities by week
            historicalActivities.forEach(a => {
              const date = new Date(a.date + 'T12:00:00');
              const weekStart = new Date(date);
              weekStart.setDate(date.getDate() - date.getDay());
              const weekKey = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;

              if (!weekMap[weekKey]) {
                weekMap[weekKey] = { lifts: 0, cardio: 0, recovery: 0 };
              }

              const cat = getShareCategory(a);
              if (cat === 'lifting') weekMap[weekKey].lifts++;
              else if (cat === 'cardio') weekMap[weekKey].cardio++;
              else if (cat === 'recovery') weekMap[weekKey].recovery++;
            });

            // Count weeks where all goals were met
            return Object.values(weekMap).filter(w =>
              w.lifts >= goals.liftsPerWeek &&
              w.cardio >= goals.cardioPerWeek &&
              w.recovery >= goals.recoveryPerWeek
            ).length;
          })(),
          // Weekly stats - use selected week or current week
          weeklyLifts: weekActivitiesForShare.filter(a => getShareCategory(a) === 'lifting').length,
          weeklyCardio: weekActivitiesForShare.filter(a => getShareCategory(a) === 'cardio').length,
          weeklyRecovery: weekActivitiesForShare.filter(a => getShareCategory(a) === 'recovery').length,
          liftsGoal: userData.goals.liftsPerWeek,
          cardioGoal: userData.goals.cardioPerWeek,
          recoveryGoal: userData.goals.recoveryPerWeek,
          weeklyCalories: weekActivitiesForShare.reduce((sum, a) => sum + (parseInt(a.calories) || 0), 0),
          weeklyMiles: weekActivitiesForShare.filter(a => a.distance).reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0),
          // Weekly activities for analysis
          weeklyActivities: weekActivitiesForShare,
          // Monthly stats
          ...(() => {
            const cardioTypes = ['Running', 'Cycle', 'Sports', 'Walking', 'Hiking', 'Swimming', 'Rowing', 'Stair Climbing', 'Elliptical', 'HIIT'];
            const recoveryTypes = ['Cold Plunge', 'Sauna', 'Contrast Therapy', 'Massage', 'Chiropractic', 'Yoga', 'Pilates'];

            // Use monthRange if provided, otherwise current month
            const getMonthRange = () => {
              if (shareMonthRange?.startDate && shareMonthRange?.endDate) {
                const formatDateStr = (d) => {
                  if (d instanceof Date) {
                    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                  }
                  return d;
                };
                return {
                  startStr: formatDateStr(shareMonthRange.startDate),
                  endStr: formatDateStr(shareMonthRange.endDate),
                  monthDate: shareMonthRange.startDate instanceof Date ? shareMonthRange.startDate : new Date(shareMonthRange.startDate + 'T12:00:00')
                };
              }
              // Default to current month
              const today = new Date();
              const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
              const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
              return {
                startStr: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`,
                endStr: `${monthEnd.getFullYear()}-${String(monthEnd.getMonth() + 1).padStart(2, '0')}-${String(monthEnd.getDate()).padStart(2, '0')}`,
                monthDate: monthStart
              };
            };
            const monthRangeData = getMonthRange();
            const monthStart = monthRangeData.startStr;
            const monthEnd = monthRangeData.endStr;
            const monthDate = monthRangeData.monthDate;
            const today = new Date();

            const monthlyActivities = activities.filter(a => a.date >= monthStart && a.date <= monthEnd);

            // Calculate monthly session counts
            const monthlyLifts = monthlyActivities.filter(a => getShareCategory(a) === 'lifting').length;
            const monthlyCardio = monthlyActivities.filter(a => getShareCategory(a) === 'cardio').length;
            const monthlyRecovery = monthlyActivities.filter(a => getShareCategory(a) === 'recovery').length;

            // Calculate days active (unique days with activities)
            const monthlyDaysActive = new Set(monthlyActivities.map(a => a.date)).size;

            // Calculate monthly steps from healthHistory
            const monthlySteps = healthHistory
              .filter(h => h.date >= monthStart && h.date <= monthEnd)
              .reduce((sum, h) => sum + (h.steps || 0), 0);

            // Calculate weekly streaks for the month (how many weeks hit each goal)
            // Get all weeks that overlap with the selected month
            const getWeeksInMonth = () => {
              const weeks = [];
              const monthStartDate = new Date(monthDate);
              const monthEndDate = new Date(monthEnd + 'T23:59:59');
              const effectiveEndDate = monthEndDate < today ? monthEndDate : today;

              // Find the first Sunday of or before the month start
              let weekStart = new Date(monthStartDate);
              weekStart.setDate(weekStart.getDate() - weekStart.getDay());

              // Include up to 5 possible weeks (some months span 5 weeks)
              for (let i = 0; i < 5; i++) {
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekStart.getDate() + 6);

                // Only include weeks that overlap with the selected month
                // AND where the week has ended (or is current week with some days passed)
                const weekStartStr = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
                const weekEndStr = `${weekEnd.getFullYear()}-${String(weekEnd.getMonth() + 1).padStart(2, '0')}-${String(weekEnd.getDate()).padStart(2, '0')}`;

                // Check if week overlaps with selected month and is not in the future
                if (weekEnd >= monthStartDate && weekStart <= effectiveEndDate) {
                  weeks.push({ startStr: weekStartStr, endStr: weekEndStr });
                }

                weekStart = new Date(weekStart);
                weekStart.setDate(weekStart.getDate() + 7);

                if (weekStart > effectiveEndDate) break;
              }
              return weeks;
            };

            const weeksInMonth = getWeeksInMonth();
            const goals = userData.goals;

            // Count weeks where each goal was met
            let liftWeeksHit = 0;
            let cardioWeeksHit = 0;
            let recoveryWeeksHit = 0;
            let allGoalsWeeksHit = 0;

            weeksInMonth.forEach(week => {
              const weekActivities = activities.filter(a => a.date >= week.startStr && a.date <= week.endStr);
              const lifts = weekActivities.filter(a => getShareCategory(a) === 'lifting').length;
              const cardio = weekActivities.filter(a => getShareCategory(a) === 'cardio').length;
              const recovery = weekActivities.filter(a => getShareCategory(a) === 'recovery').length;

              if (lifts >= goals.liftsPerWeek) liftWeeksHit++;
              if (cardio >= goals.cardioPerWeek) cardioWeeksHit++;
              if (recovery >= goals.recoveryPerWeek) recoveryWeeksHit++;
              if (lifts >= goals.liftsPerWeek && cardio >= goals.cardioPerWeek && recovery >= goals.recoveryPerWeek) {
                allGoalsWeeksHit++;
              }
            });

            // Find highest calorie session this month
            const highestCalorieSession = monthlyActivities.reduce((best, a) => {
              const cal = parseInt(a.calories) || 0;
              if (!best || cal > best.calories) {
                return { calories: cal, type: a.type };
              }
              return best;
            }, null);

            // Find most frequent strength focus area (Full Body, Upper, Lower, etc.)
            const strengthFocusCounts = {};
            monthlyActivities.filter(a => a.type === 'Strength Training').forEach(a => {
              const areas = normalizeFocusAreas(a.focusAreas || (a.focusArea ? [a.focusArea] : []));
              areas.forEach(area => {
                strengthFocusCounts[area] = (strengthFocusCounts[area] || 0) + 1;
              });
            });
            const mostFrequentStrength = Object.entries(strengthFocusCounts).sort((a, b) => b[1] - a[1])[0];

            // Find most frequent cardio type (Running, Cycle, etc.)
            const cardioTypeCounts = {};
            monthlyActivities.filter(a => cardioTypes.includes(a.type)).forEach(a => {
              cardioTypeCounts[a.type] = (cardioTypeCounts[a.type] || 0) + 1;
            });
            const mostFrequentCardio = Object.entries(cardioTypeCounts).sort((a, b) => b[1] - a[1])[0];

            // Find most frequent workout type (for highlights - cardio or strength)
            const workoutTypeCounts = {};
            monthlyActivities.filter(a => cardioTypes.includes(a.type) || a.type === 'Strength Training').forEach(a => {
              workoutTypeCounts[a.type] = (workoutTypeCounts[a.type] || 0) + 1;
            });
            const mostFrequentWorkout = Object.entries(workoutTypeCounts).sort((a, b) => b[1] - a[1])[0];

            // Find most frequent recovery type
            const recoveryTypeCounts = {};
            monthlyActivities.filter(a => recoveryTypes.includes(a.type)).forEach(a => {
              recoveryTypeCounts[a.type] = (recoveryTypeCounts[a.type] || 0) + 1;
            });
            const mostFrequentRecovery = Object.entries(recoveryTypeCounts).sort((a, b) => b[1] - a[1])[0];

            // Find longest session this month
            const longestSession = monthlyActivities.reduce((best, a) => {
              const dur = parseInt(a.duration) || 0;
              if (!best || dur > best.duration) {
                return { duration: dur, type: a.type };
              }
              return best;
            }, null);

            // Find furthest distance (any activity with distance - walking, running, cycling, etc.)
            const furthestDistance = monthlyActivities.reduce((best, a) => {
              const dist = parseFloat(a.distance) || 0;
              if (dist > 0 && (!best || dist > best.distance)) {
                return { distance: dist, type: a.type };
              }
              return best;
            }, null);

            return {
              monthlyWorkouts: monthlyActivities.length,
              monthlyCalories: monthlyActivities.reduce((sum, a) => sum + (parseInt(a.calories) || 0), 0),
              monthlyMiles: monthlyActivities.filter(a => a.distance).reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0),
              monthlyLifts,
              monthlyCardio,
              monthlyRecovery,
              monthlyDaysActive,
              monthlySteps,
              // Week streak data for the month
              monthWeeksTotal: weeksInMonth.length,
              monthLiftWeeksHit: liftWeeksHit,
              monthCardioWeeksHit: cardioWeeksHit,
              monthRecoveryWeeksHit: recoveryWeeksHit,
              monthAllGoalsWeeksHit: allGoalsWeeksHit,
              // User goals for context
              liftsGoalMonthly: goals.liftsPerWeek,
              cardioGoalMonthly: goals.cardioPerWeek,
              recoveryGoalMonthly: goals.recoveryPerWeek,
              // Highlights
              monthlyHighestCalorieSession: highestCalorieSession,
              monthlyLongestSession: longestSession,
              monthlyFurthestDistance: furthestDistance,
              monthlyMostFrequentWorkout: mostFrequentWorkout ? { type: mostFrequentWorkout[0], count: mostFrequentWorkout[1] } : null,
              monthlyMostFrequentRecovery: mostFrequentRecovery ? { type: mostFrequentRecovery[0], count: mostFrequentRecovery[1] } : null,
              // Most frequent by category (for Total Sessions box)
              monthlyMostFrequentStrength: mostFrequentStrength ? mostFrequentStrength[0] : null,
              monthlyMostFrequentCardio: mostFrequentCardio ? mostFrequentCardio[0] : null,
              // Month info for display
              shareMonthName: monthDate.toLocaleDateString('en-US', { month: 'long' }),
              shareMonthYear: monthDate.getFullYear()
            };
          })(),
          // Personal records
          records: userData.personalRecords,
          // Totals
          workouts: activities.length
        };
        })()}
      />

      <CelebrationOverlay
        // Hold off on celebrations while the Challenge a friend modal is up — playing them
        // simultaneously buries the modal. Once the user dismisses the modal (or sends),
        // `challengeModalActivity` flips to null and the overlay animates in.
        show={showCelebration && !challengeModalActivity}
        message={celebrationMessage}
        type={celebrationType}
        onComplete={() => {
          setShowCelebration(false);
          setCelebrationType('weekly'); // Reset to default
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
        show={showWeekStreakCelebration && !challengeModalActivity}
        streakCount={userData?.streaks?.master || 1}
        goals={userData?.goals || {}}
        weekCounts={{
          strength: calculateWeeklyProgress(activities)?.lifts?.completed || 0,
          cardio: calculateWeeklyProgress(activities)?.cardio?.completed || 0,
          recovery: calculateWeeklyProgress(activities)?.recovery?.completed || 0
        }}
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

      <ActivityStampModal
        isOpen={showStampModal}
        onClose={() => {
          setShowStampModal(false);
          setStampActivity(null);
          setStampRouteCoords([]);
        }}
        activity={stampActivity}
        weeklyProgress={showStampModal ? calculateWeeklyProgress(activities) : weeklyProgress}
        routeCoords={stampRouteCoords}
        getActivityCategory={getActivityCategory}
      />

      <Toast
        // Same deferral as the celebration overlays — record toasts and any other queued
        // success toast wait for the Challenge a friend modal to close before appearing.
        show={showToast && !challengeModalActivity}
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
              friendsList.forEach(f => { if (f.photoURL) { const img = new Image(); img.src = f.photoURL; } });
              const requests = await getFriendRequests(user.uid);
              setPendingFriendRequests(requests.length);
            }
          }}
          isPro={isPro}
          onPresentPaywall={async () => {
            const { purchased } = await presentPaywall();
            if (purchased) {
              const proStatus = await checkProStatus();
              setIsPro(proStatus);
            }
          }}
          onOpenChallenge={(friend) => {
            // Close Friends modal first, then open the activity picker for this friend
            setShowFriends(false);
            setChallengePickerForFriend(friend);
          }}
        />
      )}

      {/* Activity picker — opened from a friend profile to challenge them with a past workout */}
      <ChallengeActivityPickerModal
        isOpen={!!challengePickerForFriend}
        onClose={() => setChallengePickerForFriend(null)}
        activities={activities}
        friend={challengePickerForFriend}
        onPick={(activity) => {
          const friend = challengePickerForFriend;
          setChallengePickerForFriend(null);
          setPreSelectedChallengeFriend(friend?.uid || null);
          setChallengeModalActivity(activity);
        }}
      />

      {/* Pick a past activity to apply to an active challenge (from the "Use past activity" CTA) */}
      <ChallengeApplyPastActivityModal
        isOpen={!!applyPastActivityChallenge}
        onClose={() => setApplyPastActivityChallenge(null)}
        activities={activities}
        challenge={applyPastActivityChallenge}
        onPick={async (activity) => {
          const challenge = applyPastActivityChallenge;
          setApplyPastActivityChallenge(null);
          if (!activity?.id || !challenge?.id) return;
          // Optimistically flip the card immediately + show toast — the callable runs in background.
          const completedAt = Date.now();
          setOptimisticChallengeCompletions(prev => {
            const next = new Map(prev);
            next.set(challenge.id, { activityId: activity.id, completedAt });
            setTimeout(() => {
              setOptimisticChallengeCompletions(p => {
                const m = new Map(p);
                m.delete(challenge.id);
                return m;
              });
            }, 30000);
            return next;
          });
          triggerHaptic(ImpactStyle.Medium);
          setToastMessage('Challenge complete! 🏆');
          setToastType('success');
          setShowToast(true);
          const result = await applyChallengeIntent(activity.id, [challenge.id]);
          const fulfilled = (result?.results || []).some(r => r.fulfilled);
          if (!fulfilled) {
            setToastMessage("Couldn't apply — challenge state may have changed.");
            setToastType('error');
            setShowToast(true);
          }
        }}
      />

      {/* Challenge match chooser — surfaced via push when an activity matched 2+ challenges */}
      <ChallengeMatchChooser
        isOpen={!!challengeChooserState}
        onClose={() => setChallengeChooserState(null)}
        activity={challengeChooserState?.activity}
        candidateChallenges={challengeChooserState?.candidateChallenges || []}
        friendsByUid={Object.fromEntries(friends.map(f => [f.uid, f]))}
        onApplied={(result) => {
          const fulfilledCount = (result?.results || []).filter(r => r.fulfilled).length;
          setToastMessage(fulfilledCount > 0
            ? `Applied to ${fulfilledCount} challenge${fulfilledCount === 1 ? '' : 's'} 🎯`
            : `Couldn't apply — challenge state may have changed.`);
          setToastType(fulfilledCount > 0 ? 'success' : 'error');
          setShowToast(true);
        }}
      />

      {/* Notification Settings Modal */}
      {showNotificationSettings && (
        <NotificationSettings
          userId={user?.uid}
          onClose={() => setShowNotificationSettings(false)}
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
