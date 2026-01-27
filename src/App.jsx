import React, { useState, useEffect, useMemo, useRef, createContext, useContext } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './firebase';
import Login from './Login';
import UsernameSetup from './UsernameSetup';
import Friends from './Friends';
import ActivityFeed from './ActivityFeed';
import { createUserProfile, getUserProfile, saveUserActivities, getUserActivities, saveCustomActivities, getCustomActivities } from './services/userService';
import { getFriends, getReactions, getFriendRequests } from './services/friendService';

// Get today's date in YYYY-MM-DD format
const getTodayDate = () => {
  const today = new Date();
  return today.toISOString().split('T')[0];
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
    caloriesPerWeek: 3500
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
  calories: { burned: 0, goal: 3500 },
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

const ActivityIcon = ({ type, size = 20 }) => {
  const icons = {
    'Strength Training': '🏋️',
    'Running': '🏃',
    'Cold Plunge': '🧊',
    'Sauna': '🔥',
    'Yoga': '🧘',
    'Pilates': '🤸',
    'Cycle': '🚴',
    'Sports': '🏀',
    'Other': '💪'
  };
  return <span style={{ fontSize: size }}>{icons[type] || '💪'}</span>;
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

// Toast Notification Component
const Toast = ({ show, message, onDismiss, onTap, type = 'record' }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    if (show) {
      setIsVisible(true);
      setIsLeaving(false);
      
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

  const handleTap = () => {
    setIsLeaving(true);
    setTimeout(() => {
      setIsVisible(false);
      onDismiss && onDismiss();
      onTap && onTap();
    }, 300);
  };

  if (!isVisible) return null;

  const bgColor = type === 'record' 
    ? 'linear-gradient(135deg, rgba(255,215,0,0.15) 0%, rgba(255,149,0,0.1) 100%)'
    : 'rgba(0,255,148,0.1)';
  const borderColor = type === 'record' ? 'rgba(255,215,0,0.3)' : 'rgba(0,255,148,0.3)';
  const icon = type === 'record' ? '🏆' : '✓';

  return (
    <div 
      className="fixed bottom-28 left-4 right-4 z-50 transition-all duration-300"
      style={{
        transform: isLeaving ? 'translateY(100px)' : 'translateY(0)',
        opacity: isLeaving ? 0 : 1
      }}
    >
      <button 
        onClick={handleTap}
        className="w-full p-4 rounded-2xl flex items-start gap-3 shadow-lg text-left transition-all duration-150"
        style={{ 
          background: bgColor,
          border: `1px solid ${borderColor}`,
          backdropFilter: 'blur(20px)'
        }}
        onTouchStart={(e) => e.currentTarget.style.transform = 'scale(0.98)'}
        onTouchEnd={(e) => e.currentTarget.style.transform = 'scale(1)'}
        onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.98)'}
        onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
      >
        <span className="text-2xl">{icon}</span>
        <div className="flex-1">
          <div className="text-sm font-bold text-white" style={{ whiteSpace: 'pre-line' }}>{message}</div>
          <div className="text-xs text-gray-400 mt-1">Tap to view Hall of Fame →</div>
        </div>
        <button 
          onClick={(e) => {
            e.stopPropagation();
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
      </button>
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

      // Start fade out after 2.5s
      const fadeTimer = setTimeout(() => {
        setIsFadingOut(true);
      }, 2500);

      // Complete after fade out (2.5s + 0.8s fade)
      const completeTimer = setTimeout(() => {
        setIsVisible(false);
        onComplete();
      }, 3300);

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
        transition: 'opacity 0.8s ease-out, transform 0.8s ease-out'
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
      } else if (diff < 0 && weeklySlide > 0) {
        setWeeklySlide(weeklySlide - 1); // Swipe right = prev slide
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
    if (allGoalsMet) return "Crushed it! 💪";
    if (streak >= 52) return "Legend status achieved!";
    if (streak >= 26) return "Half-year warrior!";
    if (streak >= 12) return "Consistency is key!";
    if (streak >= 4) return "Building the habit!";
    if (streak >= 2) return "Momentum building!";
    return "Every week counts!";
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

    return {
      mostCommonWorkout: mostCommonWorkout ? { type: mostCommonWorkout[0], count: mostCommonWorkout[1] } : null,
      mostCommonRecovery: mostCommonRecovery ? { type: mostCommonRecovery[0], count: mostCommonRecovery[1] } : null,
      bestCalorieWorkout,
      longestWorkout,
      longestDistance: longestDistance?.distance ? longestDistance : null,
      uniqueDays,
      totalMinutes,
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
      'Other': '💪'
    };
    return emojis[type] || '💪';
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
    switch (cardType) {
      case 'records':
        const records = stats?.records || {};
        const longestDist = getRecordVal(records.longestDistance);
        return (
          <div className="relative h-full flex flex-col items-center justify-between pt-6 pb-3 px-5">
            <div className="text-3xl" style={{ animation: 'pulse-glow 2s ease-in-out infinite' }}>🏆</div>
            <div className="flex-1 flex flex-col items-center justify-center w-full">
              <div className="text-center mb-3">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Personal Records</div>
                <div className="font-black text-xl" style={{ color: colors.primary, textShadow: `0 0 30px ${colors.glow}` }}>Hall of Fame</div>
              </div>

              {/* Streaks Section */}
              <div className="w-full p-2.5 rounded-xl mb-2" style={{ backgroundColor: 'rgba(255,215,0,0.05)' }}>
                <div className="text-[9px] text-gray-500 uppercase tracking-wider text-center mb-2">🔥 Streak Records</div>
                <div className="flex justify-around">
                  <div className="text-center">
                    <div className="text-lg font-black" style={{ color: colors.primary }}>{records.longestMasterStreak || 0}</div>
                    <div className="text-[8px] text-gray-500">Master</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-black" style={{ color: '#00FF94' }}>{records.longestStrengthStreak || 0}</div>
                    <div className="text-[8px] text-gray-500">Strength</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-black" style={{ color: '#FF9500' }}>{records.longestCardioStreak || 0}</div>
                    <div className="text-[8px] text-gray-500">Cardio</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-black" style={{ color: '#00D1FF' }}>{records.longestRecoveryStreak || 0}</div>
                    <div className="text-[8px] text-gray-500">Recovery</div>
                  </div>
                </div>
              </div>

              {/* Totals Section */}
              <div className="w-full p-2.5 rounded-xl" style={{ backgroundColor: 'rgba(255,215,0,0.05)' }}>
                <div className="text-[9px] text-gray-500 uppercase tracking-wider text-center mb-2">📊 All-Time Bests</div>
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-gray-400">🏃 Longest Distance</span>
                    <span className="font-bold text-xs" style={{ color: colors.primary }}>{longestDist ? `${longestDist.toFixed(2)} mi` : '--'}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-gray-400">🏃 Most Runs/Week</span>
                    <span className="font-bold text-xs" style={{ color: colors.primary }}>{records.mostRunsWeek || 0}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-gray-400">🏋️ Most Lifts/Week</span>
                    <span className="font-bold text-xs" style={{ color: colors.primary }}>{records.mostLiftsWeek || 0}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-gray-400">💪 Most Workouts/Week</span>
                    <span className="font-bold text-xs" style={{ color: colors.primary }}>{records.mostWorkoutsWeek || 0}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-gray-400">🧊 Most Recovery/Week</span>
                    <span className="font-bold text-xs" style={{ color: colors.primary }}>{records.mostRecoveryWeek || 0}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-gray-400">🔥 Most Calories/Day</span>
                    <span className="font-bold text-xs" style={{ color: colors.primary }}>{records.mostCaloriesDay ? records.mostCaloriesDay.toLocaleString() : (getRecordVal(records.highestCalories) || '--')}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-gray-400">📍 Most Miles/Week</span>
                    <span className="font-bold text-xs" style={{ color: colors.primary }}>{records.mostMilesWeek ? `${records.mostMilesWeek.toFixed(1)} mi` : '--'}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="text-center w-full">
              <div className="inline-block text-base font-black tracking-wider" style={{ background: 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', opacity: 0.7 }}>STREAKD</div>
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
        const ringSize = 64;
        const ringStroke = 5;
        const ringRadius = (ringSize - ringStroke) / 2;
        const ringCircumference = ringRadius * 2 * Math.PI;

        // Analyze weekly activities
        const weeklyAnalysis = analyzeWeeklyActivities(stats?.weeklyActivities);

        // Build achievements list
        const achievements = [];
        if (allGoalsMet) achievements.push({ emoji: '🏆', text: 'All goals completed!' });
        if (weeklyAnalysis?.uniqueDays >= 5) achievements.push({ emoji: '📅', text: `Worked out ${weeklyAnalysis.uniqueDays} days` });
        if (stats?.streak >= 2) achievements.push({ emoji: '🔥', text: `${stats.streak} week streak!` });
        if (weeklyAnalysis?.bestCalorieWorkout && parseInt(weeklyAnalysis.bestCalorieWorkout.calories) >= 500) {
          achievements.push({ emoji: '💥', text: `${parseInt(weeklyAnalysis.bestCalorieWorkout.calories).toLocaleString()} cal burn` });
        }
        if (weeklyAnalysis?.longestDistance?.distance >= 3) {
          achievements.push({ emoji: '🏃', text: `${parseFloat(weeklyAnalysis.longestDistance.distance).toFixed(1)}mi run` });
        }
        if (weeklyAnalysis?.totalMinutes >= 300) {
          achievements.push({ emoji: '⏱️', text: `${Math.round(weeklyAnalysis.totalMinutes / 60)}hrs total` });
        }

        // Slide 1: Progress
        if (weeklySlide === 0) {
          return (
            <div
              className="relative h-full flex flex-col items-center justify-between pt-4 pb-4 px-6"
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              {/* Celebratory banner when week is streaked */}
              {allGoalsMet ? (
                <div
                  className="w-full py-2 px-4 rounded-xl text-center mb-2"
                  style={{
                    background: 'linear-gradient(135deg, #FFD700 0%, #00FF94 100%)',
                    boxShadow: '0 4px 15px rgba(255, 215, 0, 0.3)'
                  }}
                >
                  <div className="font-black text-sm text-black tracking-wide">WEEK STREAKED! 🔥</div>
                </div>
              ) : (
                <div className="text-4xl" style={{ animation: 'pulse-glow 2s ease-in-out infinite' }}>📅</div>
              )}
              <div className="flex-1 flex flex-col items-center justify-center w-full">
                <div className="text-center mb-3">
                  <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">{getWeekDateRange()}</div>
                  <div className="font-black text-2xl" style={{ color: allGoalsMet ? colors.primary : 'white' }}>
                    {allGoalsMet ? '✓ Week Complete!' : `${overallPercent}% Complete`}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">{getMotivationalTagline(stats?.streak || 0, allGoalsMet)}</div>
                </div>

                {/* Progress bar with segmented colors */}
                <div className="w-full mb-4">
                  <div className="h-2 rounded-full overflow-hidden flex" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
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
                <div className="flex items-center justify-around w-full mb-3">
                  <div className="text-center">
                    <div className="relative inline-block">
                      <svg width={ringSize} height={ringSize} className="transform -rotate-90">
                        <circle cx={ringSize/2} cy={ringSize/2} r={ringRadius} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={ringStroke} />
                        <circle cx={ringSize/2} cy={ringSize/2} r={ringRadius} fill="none" stroke="#00FF94" strokeWidth={ringStroke} strokeLinecap="round"
                          strokeDasharray={ringCircumference} strokeDashoffset={ringCircumference - (liftsPercent / 100) * ringCircumference} />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-sm font-black">{weeklyLifts}/{liftsGoal}</span>
                      </div>
                    </div>
                    <div className="text-[10px] text-gray-400 mt-1">🏋️ Strength</div>
                  </div>
                  <div className="text-center">
                    <div className="relative inline-block">
                      <svg width={ringSize} height={ringSize} className="transform -rotate-90">
                        <circle cx={ringSize/2} cy={ringSize/2} r={ringRadius} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={ringStroke} />
                        <circle cx={ringSize/2} cy={ringSize/2} r={ringRadius} fill="none" stroke="#FF9500" strokeWidth={ringStroke} strokeLinecap="round"
                          strokeDasharray={ringCircumference} strokeDashoffset={ringCircumference - (cardioPercent / 100) * ringCircumference} />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-sm font-black">{weeklyCardio}/{cardioGoal}</span>
                      </div>
                    </div>
                    <div className="text-[10px] text-gray-400 mt-1">🏃 Cardio</div>
                  </div>
                  <div className="text-center">
                    <div className="relative inline-block">
                      <svg width={ringSize} height={ringSize} className="transform -rotate-90">
                        <circle cx={ringSize/2} cy={ringSize/2} r={ringRadius} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={ringStroke} />
                        <circle cx={ringSize/2} cy={ringSize/2} r={ringRadius} fill="none" stroke="#00D1FF" strokeWidth={ringStroke} strokeLinecap="round"
                          strokeDasharray={ringCircumference} strokeDashoffset={ringCircumference - (recoveryPercent / 100) * ringCircumference} />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-sm font-black">{weeklyRecovery}/{recoveryGoal}</span>
                      </div>
                    </div>
                    <div className="text-[10px] text-gray-400 mt-1">🧘 Recovery</div>
                  </div>
                </div>

                {/* Streaks */}
                <div className="w-full p-3 rounded-2xl mt-4" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-xl">🔥</span>
                    <span className="text-2xl font-black" style={{ color: '#00FF94' }}>{stats?.streak || 0}</span>
                    <span className="text-xs text-gray-400">weeks hitting all goals</span>
                  </div>
                  <div className="w-full h-px my-2.5" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }} />
                  <div className="flex justify-around">
                    <div className="text-center">
                      <div className="text-base font-bold" style={{ color: '#00FF94' }}>{stats?.strengthStreak || 0}</div>
                      <div className="text-[9px] text-gray-500 -mt-0.5">🏋️ weeks</div>
                    </div>
                    <div className="text-center">
                      <div className="text-base font-bold" style={{ color: '#FF9500' }}>{stats?.cardioStreak || 0}</div>
                      <div className="text-[9px] text-gray-500 -mt-0.5">🏃 weeks</div>
                    </div>
                    <div className="text-center">
                      <div className="text-base font-bold" style={{ color: '#00D1FF' }}>{stats?.recoveryStreak || 0}</div>
                      <div className="text-[9px] text-gray-500 -mt-0.5">🧊 weeks</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="text-center mt-auto w-full">
                <div className="inline-block text-lg font-black tracking-wider" style={{ background: 'linear-gradient(135deg, #00FF94 0%, #00D1FF 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', opacity: 0.7 }}>STREAKD</div>
                <div className="text-[9px] text-gray-600 tracking-widest uppercase -mt-0.5">Weekly Recap</div>
                {/* Slide indicator */}
                <div className="flex justify-center gap-2 mt-3">
                  <button onClick={() => setWeeklySlide(0)} className="w-2 h-2 rounded-full transition-all" style={{ backgroundColor: weeklySlide === 0 ? colors.primary : 'rgba(255,255,255,0.2)' }} />
                  <button onClick={() => setWeeklySlide(1)} className="w-2 h-2 rounded-full transition-all" style={{ backgroundColor: weeklySlide === 1 ? colors.primary : 'rgba(255,255,255,0.2)' }} />
                  <button onClick={() => setWeeklySlide(2)} className="w-2 h-2 rounded-full transition-all" style={{ backgroundColor: weeklySlide === 2 ? colors.primary : 'rgba(255,255,255,0.2)' }} />
                </div>
              </div>
            </div>
          );
        }

        // Slide 2: Highlights & Achievements
        if (weeklySlide === 1) {
        return (
          <div
            className="relative h-full flex flex-col items-center justify-between pt-8 pb-4 px-6"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <div className="text-3xl" style={{ animation: 'pulse-glow 2s ease-in-out infinite' }}>⭐</div>
            <div className="flex-1 flex flex-col items-center justify-center w-full overflow-hidden">
              <div className="text-center mb-3">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{getWeekDateRange()}</div>
                <div className="font-black text-xl" style={{ color: colors.primary }}>Week Highlights</div>
              </div>

              {/* Achievements as simple list */}
              {achievements.length > 0 && (
                <div className="w-full mb-3 text-center">
                  <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
                    {achievements.slice(0, 4).map((a, i) => (
                      <span key={i} className="text-xs text-gray-300">
                        {a.emoji} {a.text}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Best workout & longest distance in compact grid */}
              <div className="w-full grid grid-cols-2 gap-2 mb-3">
                {/* Best workout */}
                {weeklyAnalysis?.bestCalorieWorkout && (
                  <div className="p-2.5 rounded-xl text-center" style={{ backgroundColor: 'rgba(255,149,0,0.08)' }}>
                    <div className="text-[9px] text-gray-500 uppercase mb-1">Best Burn</div>
                    <div className="text-lg">{getActivityEmoji(weeklyAnalysis.bestCalorieWorkout.type)}</div>
                    <div className="text-base font-black" style={{ color: '#FF9500' }}>{parseInt(weeklyAnalysis.bestCalorieWorkout.calories).toLocaleString()}</div>
                    <div className="text-[9px] text-gray-500">calories</div>
                  </div>
                )}
                {/* Longest distance or longest workout */}
                {weeklyAnalysis?.longestDistance && parseFloat(weeklyAnalysis.longestDistance.distance) > 0 ? (
                  <div className="p-2.5 rounded-xl text-center" style={{ backgroundColor: 'rgba(0,209,255,0.08)' }}>
                    <div className="text-[9px] text-gray-500 uppercase mb-1">Longest Run</div>
                    <div className="text-lg">{getActivityEmoji(weeklyAnalysis.longestDistance.type)}</div>
                    <div className="text-base font-black" style={{ color: '#00D1FF' }}>{parseFloat(weeklyAnalysis.longestDistance.distance).toFixed(2)}</div>
                    <div className="text-[9px] text-gray-500">miles</div>
                  </div>
                ) : weeklyAnalysis?.longestWorkout && (
                  <div className="p-2.5 rounded-xl text-center" style={{ backgroundColor: 'rgba(0,255,148,0.08)' }}>
                    <div className="text-[9px] text-gray-500 uppercase mb-1">Longest Session</div>
                    <div className="text-lg">{getActivityEmoji(weeklyAnalysis.longestWorkout.type)}</div>
                    <div className="text-base font-black" style={{ color: '#00FF94' }}>{weeklyAnalysis.longestWorkout.duration}</div>
                    <div className="text-[9px] text-gray-500">minutes</div>
                  </div>
                )}
              </div>

              {/* Week summary stats */}
              <div className="w-full grid grid-cols-3 gap-2 mb-3">
                <div className="text-center p-2 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                  <div className="text-base font-bold text-white">{weeklyAnalysis?.totalWorkouts || 0}</div>
                  <div className="text-[8px] text-gray-500">Workouts</div>
                </div>
                <div className="text-center p-2 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                  <div className="text-base font-bold text-white">{weeklyAnalysis?.uniqueDays || 0}</div>
                  <div className="text-[8px] text-gray-500">Days Active</div>
                </div>
                <div className="text-center p-2 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                  <div className="text-base font-bold text-white">{weeklyAnalysis?.totalMinutes ? Math.round(weeklyAnalysis.totalMinutes / 60) : 0}h</div>
                  <div className="text-[8px] text-gray-500">Total Time</div>
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
                    <div className="text-[9px] text-gray-500 uppercase text-center mb-1">Records Set This Week</div>
                    <div className="flex flex-wrap justify-center gap-2">
                      {topPRs.map((pr, i) => (
                        <div key={i} className="px-2 py-1 rounded-full text-[10px]" style={{ backgroundColor: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.3)' }}>
                          <span style={{ color: '#FFD700' }}>🏆 {pr.label}: {pr.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="text-center mt-auto w-full">
              <div className="inline-block text-lg font-black tracking-wider" style={{ background: 'linear-gradient(135deg, #00FF94 0%, #00D1FF 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', opacity: 0.7 }}>STREAKD</div>
              <div className="text-[9px] text-gray-600 tracking-widest uppercase -mt-0.5">Week Highlights</div>
              {/* Slide indicator */}
              <div className="flex justify-center gap-2 mt-3">
                <button onClick={() => setWeeklySlide(0)} className="w-2 h-2 rounded-full transition-all" style={{ backgroundColor: weeklySlide === 0 ? colors.primary : 'rgba(255,255,255,0.2)' }} />
                <button onClick={() => setWeeklySlide(1)} className="w-2 h-2 rounded-full transition-all" style={{ backgroundColor: weeklySlide === 1 ? colors.primary : 'rgba(255,255,255,0.2)' }} />
                <button onClick={() => setWeeklySlide(2)} className="w-2 h-2 rounded-full transition-all" style={{ backgroundColor: weeklySlide === 2 ? colors.primary : 'rgba(255,255,255,0.2)' }} />
              </div>
            </div>
          </div>
        );
        }

        // Slide 3: Streaks
        return (
          <div
            className="relative h-full flex flex-col items-center justify-between pt-6 pb-3 px-5"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <div className="text-3xl" style={{ animation: 'pulse-glow 2s ease-in-out infinite' }}>🔥</div>
            <div className="flex-1 flex flex-col items-center justify-center w-full -mt-2">
              {/* Main master streak number */}
              <div className="text-center">
                <div className="font-black leading-none" style={{ fontSize: '4rem', color: colors.primary, textShadow: `0 0 40px ${colors.glow}, 0 0 80px ${colors.glow}`, animation: 'ring-pulse 3s ease-in-out infinite' }}>
                  {stats?.streak || 0}
                </div>
                <div className="text-[10px] font-semibold tracking-widest text-gray-400 uppercase mt-1">Master Streak</div>
                <div className="text-[8px] text-gray-500 mt-0.5">weeks hitting all goals</div>
              </div>

              {/* Active Streaks */}
              <div className="w-full p-2 rounded-xl mt-2" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                <div className="flex items-center justify-center mb-0.5">
                  <span className="text-[9px] text-gray-400 uppercase tracking-wider">Active Streaks</span>
                </div>
                <div className="w-full h-px mb-1.5" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }} />
                <div className="flex justify-around">
                  <div className="text-center">
                    <div className="text-sm font-bold" style={{ color: '#00FF94' }}>{stats?.strengthStreak || 0}</div>
                    <div className="text-[8px] text-gray-500 -mt-0.5">🏋️ weeks</div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-bold" style={{ color: '#FF9500' }}>{stats?.cardioStreak || 0}</div>
                    <div className="text-[8px] text-gray-500 -mt-0.5">🏃 weeks</div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-bold" style={{ color: '#00D1FF' }}>{stats?.recoveryStreak || 0}</div>
                    <div className="text-[8px] text-gray-500 -mt-0.5">🧊 weeks</div>
                  </div>
                </div>
              </div>

              {/* Streak Records */}
              <div className="w-full p-2 rounded-xl mt-1.5" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                <div className="flex items-center justify-center mb-0.5">
                  <span className="text-[9px] text-gray-400 uppercase tracking-wider">Streak Records</span>
                </div>
                <div className="w-full h-px mb-1.5" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }} />
                <div className="flex justify-around">
                  <div className="text-center">
                    <div className="text-sm font-bold" style={{ color: '#00FF94' }}>{stats?.longestStrengthStreak || 0}</div>
                    <div className="text-[8px] text-gray-500 -mt-0.5">🏋️ weeks</div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-bold" style={{ color: '#FF9500' }}>{stats?.longestCardioStreak || 0}</div>
                    <div className="text-[8px] text-gray-500 -mt-0.5">🏃 weeks</div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-bold" style={{ color: '#00D1FF' }}>{stats?.longestRecoveryStreak || 0}</div>
                    <div className="text-[8px] text-gray-500 -mt-0.5">🧊 weeks</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom stats */}
            <div className="w-full">
              <div className="grid grid-cols-2 gap-2 p-2 rounded-xl mb-2" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                <div className="text-center">
                  <div className="text-xl font-black text-white">{stats?.longestStreak || stats?.streak || 0}</div>
                  <div className="text-[8px] text-gray-500 uppercase">Streak Record</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-black text-white">{stats?.weeksWon || 0}</div>
                  <div className="text-[8px] text-gray-500 uppercase">Weeks Won</div>
                </div>
              </div>
              <div className="text-center">
                <div className="inline-block text-base font-black tracking-wider" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #888888 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', opacity: 0.7 }}>STREAKD</div>
                <div className="text-[8px] text-gray-600 tracking-widest uppercase -mt-0.5">Streak Stats</div>
                {/* Slide indicator */}
                <div className="flex justify-center gap-2 mt-3">
                  <button onClick={() => setWeeklySlide(0)} className="w-2 h-2 rounded-full transition-all" style={{ backgroundColor: weeklySlide === 0 ? colors.primary : 'rgba(255,255,255,0.2)' }} />
                  <button onClick={() => setWeeklySlide(1)} className="w-2 h-2 rounded-full transition-all" style={{ backgroundColor: weeklySlide === 1 ? colors.primary : 'rgba(255,255,255,0.2)' }} />
                  <button onClick={() => setWeeklySlide(2)} className="w-2 h-2 rounded-full transition-all" style={{ backgroundColor: weeklySlide === 2 ? colors.primary : 'rgba(255,255,255,0.2)' }} />
                </div>
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
          <div className="relative h-full flex flex-col items-center justify-between pt-8 pb-14 px-6">
            <div className="text-4xl" style={{ animation: 'pulse-glow 2s ease-in-out infinite' }}>📊</div>
            <div className="flex-1 flex flex-col items-center justify-center w-full">
              <div className="text-center mb-4">
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">{currentMonth} {currentYear}</div>
                <div className="font-black text-2xl" style={{ color: colors.primary, textShadow: `0 0 30px ${colors.glow}` }}>Monthly Recap</div>
              </div>
              <div className="w-full space-y-3">
                <div className="text-center p-4 rounded-2xl" style={{ backgroundColor: 'rgba(139,92,246,0.1)' }}>
                  <div className="text-4xl font-black" style={{ color: colors.primary }}>{monthlyWorkouts}</div>
                  <div className="text-xs text-gray-400 uppercase tracking-wider mt-1">Workouts Completed</div>
                  <div className="text-[9px] text-gray-500 mt-1">~{avgPerWeek} per week</div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="text-center p-3 rounded-xl" style={{ backgroundColor: 'rgba(139,92,246,0.05)' }}>
                    <div className="text-2xl font-bold" style={{ color: colors.secondary }}>{(stats?.monthlyCalories || 0).toLocaleString()}</div>
                    <div className="text-[9px] text-gray-500">🔥 Calories</div>
                  </div>
                  <div className="text-center p-3 rounded-xl" style={{ backgroundColor: 'rgba(139,92,246,0.05)' }}>
                    <div className="text-2xl font-bold" style={{ color: colors.secondary }}>{(stats?.monthlyMiles || 0).toFixed(1)}</div>
                    <div className="text-[9px] text-gray-500">🏃 Miles</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="text-center p-3 rounded-xl" style={{ backgroundColor: 'rgba(139,92,246,0.05)' }}>
                    <div className="text-xl font-bold text-white">{stats?.streak || 0}</div>
                    <div className="text-[9px] text-gray-500">🔥 Week Streak</div>
                  </div>
                  <div className="text-center p-3 rounded-xl" style={{ backgroundColor: 'rgba(139,92,246,0.05)' }}>
                    <div className="text-xl font-bold text-white">{daysIntoMonth}</div>
                    <div className="text-[9px] text-gray-500">📅 Days In</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="text-center mt-auto w-full">
              <div className="inline-block text-lg font-black tracking-wider" style={{ background: 'linear-gradient(135deg, #8B5CF6 0%, #06B6D4 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', opacity: 0.7 }}>STREAKD</div>
              <div className="text-[9px] text-gray-600 tracking-widest uppercase -mt-0.5">Monthly Stats</div>
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
        className="w-full max-w-xs transition-all duration-500 ease-out"
        style={{
          transform: isAnimating ? 'scale(1) translateY(0)' : 'scale(0.8) translateY(50px)',
          opacity: isAnimating ? 1 : 0
        }}
      >
        {/* Card Type Tabs */}
        <div className="flex gap-1 p-1 rounded-2xl mb-4" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
          {cardTypes.map((type) => (
            <button
              key={type.id}
              onClick={() => setCardType(type.id)}
              className="flex-1 py-2 px-1 rounded-xl text-center transition-all duration-200"
              style={{
                backgroundColor: cardType === type.id ? colorSchemes[type.id].primary + '20' : 'transparent',
                color: cardType === type.id ? colorSchemes[type.id].primary : 'rgba(255,255,255,0.5)'
              }}
            >
              <div className="text-lg">{type.label}</div>
              <div className="text-[9px] font-medium">{type.name}</div>
            </button>
          ))}
        </div>

        {/* Share Card */}
        <div
          className="relative rounded-3xl overflow-hidden mb-4"
          style={{
            aspectRatio: '9/16',
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

        {/* Share Options */}
        <div className="flex justify-center gap-4 mb-4">
          <button
            className="flex flex-col items-center gap-2 p-4 rounded-2xl transition-all duration-150"
            style={{ backgroundColor: 'rgba(255,255,255,0.05)', transform: 'scale(1)' }}
            onClick={() => {/* TODO: Implement share to story */}}
            onTouchStart={(e) => {
              e.currentTarget.style.transform = 'scale(0.92)';
              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
            }}
            onTouchEnd={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'scale(0.92)';
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
            <span className="text-2xl">📸</span>
            <span className="text-xs text-gray-400">Story</span>
          </button>
          <button
            className="flex flex-col items-center gap-2 p-4 rounded-2xl transition-all duration-150"
            style={{ backgroundColor: 'rgba(255,255,255,0.05)', transform: 'scale(1)' }}
            onClick={() => {/* TODO: Implement save image */}}
            onTouchStart={(e) => {
              e.currentTarget.style.transform = 'scale(0.92)';
              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
            }}
            onTouchEnd={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'scale(0.92)';
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
            <span className="text-2xl">💾</span>
            <span className="text-xs text-gray-400">Save</span>
          </button>
          <button
            className="flex flex-col items-center gap-2 p-4 rounded-2xl transition-all duration-150"
            style={{ backgroundColor: 'rgba(255,255,255,0.05)', transform: 'scale(1)' }}
            onClick={() => {/* TODO: Implement share */}}
            onTouchStart={(e) => {
              e.currentTarget.style.transform = 'scale(0.92)';
              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
            }}
            onTouchEnd={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'scale(0.92)';
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
            <span className="text-2xl">📤</span>
            <span className="text-xs text-gray-400">Share</span>
          </button>
        </div>

        {/* Close Button */}
        <button
          onClick={handleClose}
          className="w-full py-3 rounded-xl font-medium transition-all duration-150 text-gray-400"
          style={{ backgroundColor: 'rgba(255,255,255,0.05)', transform: 'scale(1)' }}
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
          Close
        </button>
      </div>
    </div>
  );
};

// Week Stats Modal
const WeekStatsModal = ({ isOpen, onClose, weekData, weekLabel }) => {
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
  
  const lifts = weekData?.activities?.filter(a => a.type === 'Strength Training') || [];
  const cardioActivities = weekData?.activities?.filter(a => 
    a.type === 'Running' || a.type === 'Cycle' || a.type === 'Sports'
  ) || [];
  const recoveryActivities = weekData?.activities?.filter(a => 
    a.type === 'Cold Plunge' || a.type === 'Sauna' || a.type === 'Yoga'
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
        className="flex-1 flex flex-col mt-8 rounded-t-3xl transition-all duration-300 ease-out overflow-hidden"
        style={{ 
          backgroundColor: '#0A0A0A',
          transform: isAnimating ? 'translateY(0)' : 'translateY(100%)'
        }}
      >
        <div className="flex items-center justify-between p-4 border-b border-white/10">
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
                <div key={i} className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(0,255,148,0.05)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-medium text-sm">{activity.subtype}</div>
                    <div className="text-xs text-gray-500">{activity.date}</div>
                  </div>
                  <div className="flex gap-4 text-xs text-gray-400">
                    <span>{activity.duration} min</span>
                    <span>{activity.calories} cal</span>
                    <span>♥ {activity.avgHr} avg</span>
                  </div>
                </div>
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
                <div key={i} className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,149,0,0.05)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-medium text-sm">{activity.subtype || activity.type}</div>
                    <div className="text-xs text-gray-500">{activity.date}</div>
                  </div>
                  <div className="flex gap-4 text-xs text-gray-400">
                    {activity.distance && <span>{activity.distance} mi</span>}
                    <span>{activity.duration} min</span>
                    <span>{activity.calories} cal</span>
                  </div>
                </div>
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
                <div key={i} className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(0,209,255,0.05)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-medium text-sm">{activity.type}</div>
                    <div className="text-xs text-gray-500">{activity.date}</div>
                  </div>
                  <div className="flex gap-4 text-xs text-gray-400">
                    <span>{activity.duration} min</span>
                    {activity.temp && <span>{activity.temp}°F</span>}
                    {activity.calories && <span>{activity.calories} cal</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
};

// Activity Detail Modal
const ActivityDetailModal = ({ isOpen, onClose, activity, onDelete, onEdit }) => {
  const [isAnimating, setIsAnimating] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  
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
        className="w-full max-w-lg rounded-t-3xl transition-all duration-300 ease-out overflow-hidden"
        style={{ 
          backgroundColor: '#0A0A0A',
          transform: isAnimating ? 'translateY(0)' : 'translateY(100%)'
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
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
        <div className="p-5">
          {/* Activity Type Header */}
          <div className="flex items-center gap-4 mb-6">
            <div 
              className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ backgroundColor: `${color}20` }}
            >
              <ActivityIcon type={activity.type} size={28} />
            </div>
            <div className="flex-1">
              <div className="text-xl font-bold">{activity.type}</div>
              {activity.subtype && (
                <div className="text-sm text-gray-400">{activity.subtype}</div>
              )}
              {activity.strengthType && activity.focusArea && (
                <div className="text-sm text-gray-400">{activity.strengthType} • {activity.focusArea}</div>
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

          {/* Notes */}
          {activity.notes && (
            <div className="p-4 rounded-xl mb-4" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
              <div className="text-xs text-gray-500 mb-2">Notes</div>
              <div className="text-sm">{activity.notes}</div>
            </div>
          )}

          {/* Source indicator */}
          {activity.fromAppleHealth && (
            <div className="flex items-center gap-2 text-xs text-gray-500 mb-6">
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
const OnboardingSurvey = ({ onComplete, onCancel = null, currentGoals = null }) => {
  const [goals, setGoals] = useState({
    liftsPerWeek: currentGoals?.liftsPerWeek ?? 3,
    cardioPerWeek: currentGoals?.cardioPerWeek ?? 2,
    recoveryPerWeek: currentGoals?.recoveryPerWeek ?? 2,
    stepsPerDay: currentGoals?.stepsPerDay ?? 10000
  });

  const isEditing = currentGoals !== null;

  const questions = [
    { title: "Strength per week", key: 'liftsPerWeek', options: [2, 3, 4, 5, 6] },
    { title: "Cardio per week", key: 'cardioPerWeek', options: [0, 1, 2, 3, 4, 5], subtitle: "Running, Cycling, Sports" },
    { title: "Recovery per week", key: 'recoveryPerWeek', options: [0, 1, 2, 3, 4], subtitle: "Cold Plunge, Sauna, Yoga, Pilates" },
    { title: "Daily step goal", key: 'stepsPerDay', options: [6000, 8000, 10000, 12000, 15000], isSteps: true }
  ];

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <div className="p-6 pt-12">
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
        <h1 className="text-3xl font-black tracking-tight mb-1">STREAKD</h1>
        <p className="text-sm mb-4" style={{ color: '#00FF94' }}>Win the week.</p>
        <h2 className="text-xl font-bold mb-2">{isEditing ? 'Edit Your Goals' : 'Set Your Goals'}</h2>
        <p className="text-gray-500 text-sm">Be realistic. Consistency beats intensity.</p>
      </div>

      <div className="flex-1 px-6 py-4 space-y-6 overflow-auto pb-32">
        {questions.map((q) => (
          <div key={q.key}>
            <label className="text-sm font-semibold mb-1 block">{q.title}</label>
            {q.subtitle && <p className="text-xs text-gray-500 mb-2">{q.subtitle}</p>}
            <div className={`flex gap-2 ${!q.subtitle ? 'mt-3' : ''}`}>
              {q.options.map((option) => (
                <button
                  key={option}
                  onClick={() => setGoals({ ...goals, [q.key]: option })}
                  className="flex-1 py-3 rounded-xl text-center transition-all duration-200 border-2"
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
                    {q.isSteps ? `${option/1000}k` : option}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-6 pb-12" style={{ background: 'linear-gradient(to top, #000 80%, transparent)' }}>
        <button
          onClick={() => onComplete(goals)}
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
          {isEditing ? 'Save Goals' : 'Start Streakd'}
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
const SwipeableContext = createContext({ openId: null, setOpenId: () => {} });

// Provider component to wrap lists of swipeable items
const SwipeableProvider = ({ children }) => {
  const [openId, setOpenId] = useState(null);
  return (
    <SwipeableContext.Provider value={{ openId, setOpenId }}>
      {children}
    </SwipeableContext.Provider>
  );
};

// Swipeable Activity Item Component for swipe-to-delete
const SwipeableActivityItem = ({ children, onDelete, activity }) => {
  const { openId, setOpenId } = useContext(SwipeableContext);
  const [swipeX, setSwipeX] = useState(0);
  const [startX, setStartX] = useState(null);
  const [startSwipeX, setStartSwipeX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [isBouncing, setIsBouncing] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [hasMoved, setHasMoved] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const deleteButtonWidth = 100;
  const snapThreshold = 40;
  const itemId = activity.id;

  // Close this item if another one becomes the open one
  useEffect(() => {
    if (openId !== null && openId !== itemId && swipeX !== 0) {
      setSwipeX(0);
      setIsBouncing(false);
    }
  }, [openId, itemId, swipeX]);

  const handleTouchStart = (e) => {
    setStartX(e.touches[0].clientX);
    setStartSwipeX(swipeX);
    setIsSwiping(true);
    setIsBouncing(false);
    setHasMoved(false);
    // Only show press effect if card is closed
    if (swipeX === 0) {
      setIsPressed(true);
    }
  };

  const handleTouchMove = (e) => {
    if (startX === null) return;
    const currentX = e.touches[0].clientX;
    const diff = currentX - startX;

    // If moved more than 5px, cancel the press effect and enable swiping
    if (Math.abs(diff) > 5) {
      setHasMoved(true);
      setIsPressed(false);
      // Notify context that this item is being swiped (close others)
      if (diff < 0) {
        setOpenId(itemId);
      }
    }

    // Allow slight overswipe for bounce effect
    const newSwipeX = Math.max(-deleteButtonWidth - 30, Math.min(0, startSwipeX + diff));
    setSwipeX(newSwipeX);
  };

  const handleTouchEnd = () => {
    setIsSwiping(false);
    setStartX(null);
    setIsPressed(false);

    if (swipeX < -snapThreshold) {
      // Snap open with bounce
      setIsBouncing(true);
      setSwipeX(-deleteButtonWidth);
      setOpenId(itemId);
      setTimeout(() => setIsBouncing(false), 500);
    } else {
      setSwipeX(0);
      // If closing, clear the open id
      if (openId === itemId) {
        setOpenId(null);
      }
    }
  };

  const handleDeleteClick = (e) => {
    e.stopPropagation();
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
    if (isSwiping) return 'none';
    if (isBouncing) return 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)'; // Stronger bounce easing
    return 'transform 0.3s ease-out';
  };

  // Only show delete button when actually swiped left (not just touched)
  const showDeleteButton = swipeX < 0 || hasMoved;

  return (
    <>
      <div
        className="relative overflow-hidden rounded-xl"
        style={{ backgroundColor: showDeleteButton ? '#FF453A' : 'transparent' }}
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
          className="relative bg-zinc-900"
          style={{
            transform: `translateX(${swipeX}px)${isPressed ? ' scale(0.98)' : ''}`,
            transition: getTransition()
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onClick={() => swipeX !== 0 && resetSwipe()}
        >
          {children}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.8)' }}
          onClick={handleCancelDelete}
        >
          <div
            className="w-full max-w-xs bg-zinc-900 rounded-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
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
                onClick={handleCancelDelete}
                className="flex-1 py-4 text-white font-medium border-r border-zinc-800 transition-colors active:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="flex-1 py-4 text-red-500 font-medium transition-colors active:bg-zinc-800"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// Add Activity Modal
const AddActivityModal = ({ isOpen, onClose, onSave, pendingActivity = null, defaultDate = null, userData = null, onSaveCustomActivity = null }) => {
  const [activityType, setActivityType] = useState(null);
  const [subtype, setSubtype] = useState('');
  const [strengthType, setStrengthType] = useState(''); // Lifting, Bodyweight
  const [focusArea, setFocusArea] = useState(''); // Full Body, Upper, Lower, etc.
  const [customSport, setCustomSport] = useState('');
  const [saveCustomSport, setSaveCustomSport] = useState(false);
  // Custom "Other" activity state
  const [customActivityName, setCustomActivityName] = useState('');
  const [customActivityEmoji, setCustomActivityEmoji] = useState('💪');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [saveCustomActivity, setSaveCustomActivity] = useState(false);

  // Common activity emojis for picker
  const activityEmojis = ['💪', '🏃', '🚴', '🏊', '⛷️', '🧗', '🥊', '🎾', '⚽', '🏀', '🏈', '⚾', '🎯', '🏋️', '🤸', '🧘', '🥋', '🏇', '🚣', '🛹', '⛸️', '🎿', '🏌️', '🤾', '🏸', '🥏', '🎳', '🧊', '🔥', '⭐', '🌟', '✨', '💫', '🎉', '🏆', '🥇', '❤️', '💚', '💙', '🧠', '🦵', '💨', '⚡'];
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

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setActivityType(pendingActivity?.type || null);
      setSubtype(pendingActivity?.subtype || '');
      setStrengthType(pendingActivity?.strengthType || '');
      setFocusArea(pendingActivity?.focusArea || '');
      setCustomSport('');
      setSaveCustomSport(false);
      setCustomActivityName('');
      setCustomActivityEmoji('💪');
      setShowEmojiPicker(false);
      setSaveCustomActivity(false);
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
    { name: 'Sports', icon: '🏀', subtypes: ['Basketball', 'Soccer', 'Tennis', 'Golf', 'Pickleball', 'Other'] },
    { name: 'Yoga', icon: '🧘', subtypes: ['Vinyasa', 'Power', 'Hot', 'Yin', 'Restorative'] },
    { name: 'Pilates', icon: '🤸', subtypes: ['Mat', 'Reformer', 'Tower', 'Chair'] },
    { name: 'Cold Plunge', icon: '🧊', subtypes: [] },
    { name: 'Sauna', icon: '🔥', subtypes: [] },
    { name: 'Other', icon: '💪', subtypes: [] }
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

  // Get user's custom activities
  const customActivities = userData?.customActivities || [];

  const [isAnimating, setIsAnimating] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  
  useEffect(() => {
    if (isOpen) {
      setIsClosing(false);
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
      onClose();
    }, 300);
  };

  if (!isOpen && !isClosing) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex flex-col transition-all duration-300"
      style={{ 
        backgroundColor: isAnimating ? 'rgba(0,0,0,0.95)' : 'rgba(0,0,0,0)'
      }}
      onClick={(e) => e.target === e.currentTarget && handleClose()}
    >
      <div 
        className="flex-1 flex flex-col mt-12 rounded-t-3xl transition-all duration-300 ease-out overflow-hidden"
        style={{ 
          backgroundColor: '#0A0A0A',
          transform: isAnimating ? 'translateY(0)' : 'translateY(100%)'
        }}
      >
        <div className="flex items-center justify-between p-4 border-b border-white/10">
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
          <h2 className="font-bold">{pendingActivity?.id ? 'Edit Activity' : 'Log Activity'}</h2>
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
              onSaveCustomActivity({ name: customActivityName, emoji: customActivityEmoji });
            }

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
              fromAppleHealth: isFromAppleHealth,
              countToward: countToward || undefined
            });
            handleClose();
          }}
          className="font-bold transition-all duration-150 px-2 py-1 rounded-lg"
          style={{ color: !activityType || (showCustomSportInput && !customSport) || (showCustomActivityInput && !customActivityName) || (activityType === 'Strength Training' && (!strengthType || !focusArea)) ? 'rgba(0,255,148,0.3)' : '#00FF94' }}
          disabled={!activityType || (showCustomSportInput && !customSport) || (showCustomActivityInput && !customActivityName) || (activityType === 'Strength Training' && (!strengthType || !focusArea))}
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
          Save
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
        {!activityType ? (
          <div className="grid grid-cols-2 gap-3">
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
              <span className="text-2xl">💪</span>
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
                setCustomActivityEmoji('💪');
                setShowEmojiPicker(false);
                setCountToward(null);
              }}
              className="flex items-center gap-2 text-gray-400 text-sm transition-all duration-150 px-2 py-1 rounded-lg"
              onTouchStart={(e) => {
                e.currentTarget.style.transform = 'scale(0.95)';
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
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
                setCustomActivityEmoji('💪');
                setShowEmojiPicker(false);
                setCountToward(null);
              }}
              className="flex items-center gap-3 p-3 rounded-xl w-full transition-all duration-150"
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
              <span className="text-2xl">{selectedType?.icon || (activityType === 'Other' ? customActivityEmoji : '💪')}</span>
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
                  {selectedType.subtypes.map((st) => (
                    <button
                      key={st}
                      onClick={() => setSubtype(st)}
                      className="px-4 py-2 rounded-full text-sm transition-all duration-200"
                      style={{
                        backgroundColor: subtype === st ? 'rgba(0,255,148,0.2)' : 'rgba(255,255,255,0.05)',
                        border: subtype === st ? '1px solid #00FF94' : '1px solid transparent',
                        color: subtype === st ? '#00FF94' : 'white'
                      }}
                    >
                      {st}
                    </button>
                  ))}
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
                <input
                  type="text"
                  value={customSport}
                  onChange={(e) => setCustomSport(e.target.value)}
                  className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-white mb-3"
                  placeholder="Enter sport name..."
                />
                <label className="flex items-center gap-3 cursor-pointer">
                  <div
                    className="w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all"
                    style={{
                      borderColor: saveCustomSport ? '#00FF94' : 'rgba(255,255,255,0.3)',
                      backgroundColor: saveCustomSport ? 'rgba(0,255,148,0.2)' : 'transparent'
                    }}
                    onClick={() => setSaveCustomSport(!saveCustomSport)}
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

                <label className="flex items-center gap-3 cursor-pointer">
                  <div
                    className="w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all"
                    style={{
                      borderColor: saveCustomActivity ? '#00FF94' : 'rgba(255,255,255,0.3)',
                      backgroundColor: saveCustomActivity ? 'rgba(0,255,148,0.2)' : 'transparent'
                    }}
                    onClick={() => setSaveCustomActivity(!saveCustomActivity)}
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
          </div>
        )}
      </div>
      </div>
    </div>
  );
};

// Home Tab - Simplified
const HomeTab = ({ onAddActivity, pendingSync, activities = [], weeklyProgress: propWeeklyProgress, userData, onDeleteActivity, onEditActivity, user }) => {
  const [showWorkoutNotification, setShowWorkoutNotification] = useState(true);
  const [activityReactions, setActivityReactions] = useState({});

  // Calculate weekly progress directly from activities to ensure it's always in sync
  const weekProgress = useMemo(() => {
    const goals = userData?.goals || { liftsPerWeek: 4, cardioPerWeek: 3, recoveryPerWeek: 2, caloriesPerWeek: 3500, stepsPerDay: 10000 };

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
    const running = weekActivities.filter(a => a.type === 'Running');
    const cycling = weekActivities.filter(a => a.type === 'Cycle');
    const sports = weekActivities.filter(a => a.type === 'Sports');
    const totalMiles = running.reduce((sum, r) => sum + (parseFloat(r.distance) || 0), 0);
    const totalCalories = weekActivities.reduce((sum, a) => sum + (parseInt(a.calories) || 0), 0);

    return {
      lifts: { completed: lifts.length, goal: goals.liftsPerWeek, sessions: lifts.map(l => l.subtype || l.type) },
      cardio: { completed: cardio.length, goal: goals.cardioPerWeek, miles: totalMiles, sessions: cardio.map(c => c.type), breakdown: { running: running.length, cycling: cycling.length, sports: sports.length } },
      recovery: { completed: recovery.length, goal: goals.recoveryPerWeek, sessions: recovery.map(r => r.type) },
      calories: { burned: totalCalories, goal: goals.caloriesPerWeek },
      steps: { today: 0, goal: goals.stepsPerDay }
    };
  }, [activities, userData?.goals]);

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

  // Get latest activities for display
  const allLatestActivities = activities.slice(0, 10); // Cap at 10 total
  const latestActivities = activityExpanded ? allLatestActivities : allLatestActivities.slice(0, 2);

  // Fetch reactions for user's activities
  useEffect(() => {
    const fetchReactions = async () => {
      if (!user?.uid || activities.length === 0) return;

      const reactionsMap = {};
      await Promise.all(
        allLatestActivities.map(async (activity) => {
          if (activity.id) {
            try {
              const reactions = await getReactions(user.uid, activity.id);
              if (reactions.length > 0) {
                reactionsMap[activity.id] = reactions;
              }
            } catch (error) {
              console.error('Error fetching reactions for activity:', activity.id, error);
            }
          }
        })
      );
      setActivityReactions(reactionsMap);
    };

    fetchReactions();
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

    return { counts, total: reactions.length };
  };

  return (
    <div className="pb-32">
      {/* Header */}
      <div className="px-4 pt-2 pb-3">
        <h1 className="text-xl font-bold text-white">STREAKD</h1>
        <p className="text-xs" style={{ color: '#00FF94' }}>Win the week.</p>
      </div>

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
                <span className="text-xs font-bold">{weekProgress.calories.burned.toLocaleString()}</span>
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
              onTouchStart={(e) => e.currentTarget.style.transform = 'scale(0.93)'}
              onTouchEnd={(e) => e.currentTarget.style.transform = 'scale(1)'}
              onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.93)'}
              onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              <div className="relative inline-block">
                <ProgressRing progress={liftsPercent} size={72} strokeWidth={6} color="#00FF94" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xl font-black">{weekProgress.lifts.completed}/{weekProgress.lifts.goal}</span>
                </div>
              </div>
              <div className="text-sm font-medium mt-2">🏋️ Strength</div>
              <div className="text-[10px] text-gray-500">{showStrengthBreakdown ? '▲' : '▼'}</div>
            </button>
            
            {/* Cardio */}
            <button 
              className="text-center transition-all duration-150"
              onClick={() => setShowCardioBreakdown(!showCardioBreakdown)}
              onTouchStart={(e) => e.currentTarget.style.transform = 'scale(0.93)'}
              onTouchEnd={(e) => e.currentTarget.style.transform = 'scale(1)'}
              onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.93)'}
              onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              <div className="relative inline-block">
                <ProgressRing progress={cardioPercent} size={72} strokeWidth={6} color="#FF9500" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xl font-black">{weekProgress.cardio?.completed || 0}/{weekProgress.cardio?.goal || 0}</span>
                </div>
              </div>
              <div className="text-sm font-medium mt-2">🏃 Cardio</div>
              <div className="text-[10px] text-gray-500">{showCardioBreakdown ? '▲' : '▼'}</div>
            </button>
            
            {/* Recovery */}
            <button 
              className="text-center transition-all duration-150"
              onClick={() => setShowRecoveryBreakdown(!showRecoveryBreakdown)}
              onTouchStart={(e) => e.currentTarget.style.transform = 'scale(0.93)'}
              onTouchEnd={(e) => e.currentTarget.style.transform = 'scale(1)'}
              onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.93)'}
              onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              <div className="relative inline-block">
                <ProgressRing progress={recoveryPercent} size={72} strokeWidth={6} color="#00D1FF" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xl font-black">{weekProgress.recovery?.completed || 0}/{weekProgress.recovery?.goal || 0}</span>
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
              <div className="grid grid-cols-3 gap-2 text-center">
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
              </div>
            </div>
          )}
          
          {/* Overall Progress Bar */}
          <div className="mt-4 pt-4 border-t border-white/10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400">Week Progress</span>
              <span className="text-xs font-bold" style={{ color: overallPercent >= 100 ? '#00FF94' : 'white' }}>{overallPercent}%</span>
            </div>
            <ProgressBar progress={overallPercent} height={4} color={overallPercent >= 100 ? '#00FF94' : '#00FF94'} />
          </div>
        </div>

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
        <div className="mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white">Latest Activity</span>
            <span>📋</span>
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">Your recent workout and recovery sessions</p>
        </div>
        <SwipeableProvider>
          <div
            className="space-y-2 transition-all duration-300 ease-out overflow-hidden"
          >
            {latestActivities.length > 0 ? (
              <>
                {latestActivities.map((activity) => (
                  <SwipeableActivityItem
                    key={activity.id}
                    activity={activity}
                    onDelete={(act) => onDeleteActivity && onDeleteActivity(act.id)}
                  >
                    <div
                      onClick={() => setSelectedActivity(activity)}
                      className="w-full p-3 flex items-center gap-3 text-left cursor-pointer"
                      style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                    >
                      <ActivityIcon type={activity.type} size={20} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold truncate">{activity.type}{activity.subtype ? ` • ${activity.subtype}` : ''}</span>
                          {(() => {
                            const summary = getReactionSummary(activity.id);
                            if (!summary) return null;
                            return (
                              <span
                                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full flex-shrink-0"
                                style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
                              >
                                {Object.entries(summary.counts).slice(0, 4).map(([emoji, count]) => (
                                  <span key={emoji} className="flex items-center text-xs">
                                    <span>{emoji}</span>
                                    {count > 1 && <span className="text-gray-300 text-[10px] ml-0.5">{count}</span>}
                                  </span>
                                ))}
                              </span>
                            );
                          })()}
                        </div>
                        <div className="text-[10px] text-gray-500">{formatFriendlyDate(activity.date)} at {activity.time}</div>
                      </div>
                      <div className="text-right">
                        {activity.calories && <div className="text-sm font-bold">{activity.calories} cal</div>}
                        {activity.distance && <div className="text-sm font-bold">{activity.distance} mi</div>}
                        {activity.duration && !activity.calories && !activity.distance && <div className="text-sm font-bold">{activity.duration} min</div>}
                      </div>
                      <span className="text-gray-600 text-xs">›</span>
                    </div>
                  </SwipeableActivityItem>
                ))}
              {allLatestActivities.length > 2 && (
                <button
                  onClick={() => setActivityExpanded(!activityExpanded)}
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
          ) : (
            <div className="p-6 rounded-xl text-center" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
              <div className="text-4xl mb-3">🏋️</div>
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
        const lifts = fullDayActivities.filter(a => a.type === 'Strength Training');
        const cardioActivities = fullDayActivities.filter(a =>
          a.type === 'Running' || a.type === 'Cycle' || a.type === 'Sports'
        );
        const recoveryActivities = fullDayActivities.filter(a =>
          a.type === 'Cold Plunge' || a.type === 'Sauna' || a.type === 'Yoga' || a.type === 'Pilates'
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
const HistoryTab = ({ onShare, activities = [], calendarData = {}, userData, onAddActivity, onDeleteActivity, onEditActivity, initialView = 'calendar', initialStatsSubView = 'overview' }) => {
  const [view, setView] = useState(initialView);
  const [statsSubView, setStatsSubView] = useState(initialStatsSubView); // 'overview' or 'records'
  const [calendarView, setCalendarView] = useState('heatmap');
  const [selectedDate, setSelectedDate] = useState(getTodayDate());
  const [selectedDayActivity, setSelectedDayActivity] = useState(null); // For activity detail modal
  
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
  const [showDayModal, setShowDayModal] = useState(false);
  const [dayModalAnimating, setDayModalAnimating] = useState(false);
  const [dayModalClosing, setDayModalClosing] = useState(false);
  const [compareWeek, setCompareWeek] = useState('average');
  const [totalsView, setTotalsView] = useState('this-month');
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
  const currentDay = today.getDate();
  const currentMonth = today.getMonth(); // 0-indexed
  const currentYear = today.getFullYear();
  
  // Generate weeks dynamically based on current date
  const generateWeeks = () => {
    const weeks = [];
    // Generate last 3-4 weeks
    for (let w = 2; w >= 0; w--) {
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay() - (w * 7)); // Start of week (Sunday)
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      
      const startDay = weekStart.getDate();
      const endDay = weekEnd.getDate();
      const monthName = weekStart.toLocaleDateString('en-US', { month: 'short' });
      
      weeks.push({
        id: `week-${w + 1}`,
        label: `${monthName} ${startDay}-${endDay}`,
        startDay,
        endDay,
        startDate: weekStart,
        endDate: weekEnd,
        isCurrent: w === 0
      });
    }
    return weeks;
  };
  
  const weeks = generateWeeks();
  
  // Helper to determine effective category of an activity
  const getActivityCategory = (activity) => {
    if (activity.countToward) return activity.countToward;
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
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    
    for (let i = 1; i <= daysInMonth; i++) {
      const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      days.push({
        day: i,
        date: dateStr,
        activities: calendarData[dateStr] || [],
        isToday: i === currentDay,
        isFuture: i > currentDay
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
      {/* Active Streaks Section */}
      <div className="mx-4 mb-4">
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
          <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(0,255,148,0.1)', border: '1px solid rgba(0,255,148,0.2)' }}>
            <div className="text-2xl font-black" style={{ color: '#00FF94' }}>🏋️ {streaks.lifts} Weeks</div>
            <div className="text-sm text-gray-300 mt-1">Strength</div>
            <div className="text-[10px] text-gray-500 mt-1">{goals.liftsPerWeek}+ per week</div>
          </div>
          
          {/* Cardio Streak */}
          <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,149,0,0.1)', border: '1px solid rgba(255,149,0,0.2)' }}>
            <div className="text-2xl font-black" style={{ color: '#FF9500' }}>🏃 {streaks.cardio} Weeks</div>
            <div className="text-sm text-gray-300 mt-1">Cardio</div>
            <div className="text-[10px] text-gray-500 mt-1">{goals.cardioPerWeek}+ per week</div>
          </div>
          
          {/* Recovery Streak */}
          <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(0,209,255,0.1)', border: '1px solid rgba(0,209,255,0.2)' }}>
            <div className="text-2xl font-black" style={{ color: '#00D1FF' }}>🧊 {streaks.recovery} Weeks</div>
            <div className="text-sm text-gray-300 mt-1">Recovery</div>
            <div className="text-[10px] text-gray-500 mt-1">{goals.recoveryPerWeek}+ per week</div>
          </div>
          
          {/* Steps Streak */}
          <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(191,90,242,0.1)', border: '1px solid rgba(191,90,242,0.2)' }}>
            <div className="text-2xl font-black" style={{ color: '#BF5AF2' }}>👟 {streaks.stepsGoal} Weeks</div>
            <div className="text-sm text-gray-300 mt-1">Steps</div>
            <div className="text-[10px] text-gray-500 mt-1">{(goals.stepsPerDay/1000).toFixed(0)}k+ daily avg</div>
          </div>
        </div>
      </div>

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
        {[
          { key: 'calendar', label: 'Calendar' },
          { key: 'stats', label: 'Stats' },
          { key: 'trends', label: 'Trends' }
        ].map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors duration-200 relative z-10"
            style={{ 
              color: view === v.key ? 'white' : 'rgba(255,255,255,0.5)'
            }}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Calendar View */}
      {view === 'calendar' && (
        <div className="mx-4 mt-2">
          <div className="mb-4">
            <div className="text-sm font-semibold text-white">Activity Calendar</div>
            <p className="text-[11px] text-gray-500 mt-0.5">Tap any day or week to see details</p>
          </div>
          
          <div className="text-lg font-bold mb-3">{new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div>
          
          {/* Week days header with week button column */}
          <div className="flex gap-0.5 mb-1">
            <div className="w-8" />
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <div key={i} className="flex-1 text-center text-[10px] text-gray-500 py-1">{d}</div>
            ))}
          </div>
          
          {/* Calendar with week buttons */}
          <div className="space-y-0.5">
            {/* First partial week (days 1-4) */}
            <div className="flex gap-0.5">
              <div className="w-8" />
              {[...Array(4)].map((_, i) => (
                <div key={`empty-${i}`} className="flex-1 aspect-square" />
              ))}
              {calendarDays.slice(0, 4).map((day) => (
                <button
                  key={day.day}
                  onClick={() => {
                    setSelectedDate(day.date);
                    if (calendarData[day.date]?.length > 0) {
                      openDayModal();
                    } else if (!day.isFuture) {
                      // Empty day - directly open add activity with this date
                      onAddActivity && onAddActivity(day.date);
                    }
                  }}
                  className="flex-1 aspect-square rounded-md flex flex-col items-center justify-center relative transition-all duration-150"
                  style={{
                    backgroundColor: selectedDate === day.date ? 'rgba(0,255,148,0.2)' : 
                                     day.activities.length > 0 ? 'rgba(255,255,255,0.05)' : 'transparent',
                    border: day.isToday ? '2px solid #00FF94' : 'none',
                    opacity: day.isFuture ? 0.3 : 1
                  }}
                  onTouchStart={(e) => {
                    if (!day.isFuture) e.currentTarget.style.transform = 'scale(0.92)';
                  }}
                  onTouchEnd={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  onMouseDown={(e) => {
                    if (!day.isFuture) e.currentTarget.style.transform = 'scale(0.92)';
                  }}
                  onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                >
                  <span className={`text-[11px] ${day.activities.length > 0 ? 'font-bold' : 'text-gray-500'}`}>
                    {day.day}
                  </span>
                  {day.activities.length > 0 && (
                    <div className="flex gap-0.5 mt-0.5">
                      {day.activities.slice(0, 2).map((a, i) => (
                        <div key={i} className="w-1 h-1 rounded-full"
                          style={{ backgroundColor: a.type === 'Strength Training' ? '#00FF94' : a.type === 'Running' ? '#FF9500' : '#00D1FF' }}
                        />
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>

            {/* Full weeks */}
            {weeks.map((week) => (
              <div key={week.id} className="flex gap-0.5">
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
                {calendarDays.slice(week.startDay - 1, week.endDay).map((day) => (
                  <button
                    key={day.day}
                    onClick={() => {
                      setSelectedDate(day.date);
                      if (calendarData[day.date]?.length > 0) {
                        openDayModal();
                      } else if (!day.isFuture) {
                        onAddActivity && onAddActivity(day.date);
                      }
                    }}
                    className="flex-1 aspect-square rounded-md flex flex-col items-center justify-center relative transition-all duration-150"
                    style={{
                      backgroundColor: selectedDate === day.date ? 'rgba(0,255,148,0.2)' : 
                                       day.activities.length > 0 ? 'rgba(255,255,255,0.05)' : 'transparent',
                      border: day.isToday ? '2px solid #00FF94' : 'none',
                      opacity: day.isFuture ? 0.3 : 1
                    }}
                    onTouchStart={(e) => {
                      if (!day.isFuture) e.currentTarget.style.transform = 'scale(0.92)';
                    }}
                    onTouchEnd={(e) => e.currentTarget.style.transform = 'scale(1)'}
                    onMouseDown={(e) => {
                      if (!day.isFuture) e.currentTarget.style.transform = 'scale(0.92)';
                    }}
                    onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    <span className={`text-[11px] ${day.activities.length > 0 ? 'font-bold' : 'text-gray-500'}`}>
                      {day.day}
                    </span>
                    {day.activities.length > 0 && (
                      <div className="flex gap-0.5 mt-0.5">
                        {day.activities.slice(0, 2).map((a, i) => (
                          <div key={i} className="w-1 h-1 rounded-full"
                            style={{ backgroundColor: a.type === 'Strength Training' ? '#00FF94' : a.type === 'Running' ? '#FF9500' : '#00D1FF' }}
                          />
                        ))}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            ))}

            {/* Last partial week (days 27-31) */}
            <div className="flex gap-0.5">
              <div className="w-8" />
              {calendarDays.slice(26, 31).map((day) => (
                <button
                  key={day.day}
                  onClick={() => {
                    setSelectedDate(day.date);
                    if (calendarData[day.date]?.length > 0) {
                      openDayModal();
                    } else if (!day.isFuture) {
                      onAddActivity && onAddActivity(day.date);
                    }
                  }}
                  className="flex-1 aspect-square rounded-md flex flex-col items-center justify-center relative transition-all duration-150"
                  style={{
                    backgroundColor: selectedDate === day.date ? 'rgba(0,255,148,0.2)' : 
                                     day.activities.length > 0 ? 'rgba(255,255,255,0.05)' : 'transparent',
                    opacity: day.isFuture ? 0.3 : 1
                  }}
                  onTouchStart={(e) => {
                    if (!day.isFuture) e.currentTarget.style.transform = 'scale(0.92)';
                  }}
                  onTouchEnd={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  onMouseDown={(e) => {
                    if (!day.isFuture) e.currentTarget.style.transform = 'scale(0.92)';
                  }}
                  onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                >
                  <span className={`text-[11px] ${day.activities.length > 0 ? 'font-bold' : 'text-gray-500'}`}>
                    {day.day}
                  </span>
                </button>
              ))}
              {[...Array(2)].map((_, i) => (
                <div key={`end-empty-${i}`} className="flex-1 aspect-square" />
              ))}
            </div>
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
                  <div className="text-[10px] text-gray-400">🏋️ Strength</div>
                  {(() => {
                    const compare = compareWeek === 'average' ? weeklyStats['average']?.lifts || 0 : weeklyStats['week-2']?.lifts || 0;
                    if (currentWeekStats.lifts > compare) return <div className="text-[10px] mt-1" style={{ color: '#00FF94' }}>↑</div>;
                    if (currentWeekStats.lifts < compare) return <div className="text-[10px] mt-1" style={{ color: '#FF453A' }}>↓</div>;
                    return <div className="text-[10px] mt-1 opacity-0">-</div>;
                  })()}
                </div>
                <div>
                  <div className="text-lg font-black text-white">{currentWeekStats.cardio}</div>
                  <div className="text-[10px] text-gray-400">🏃 Cardio</div>
                  {(() => {
                    const compare = compareWeek === 'average' ? weeklyStats['average']?.cardio || 0 : weeklyStats['week-2']?.cardio || 0;
                    if (currentWeekStats.cardio > compare) return <div className="text-[10px] mt-1" style={{ color: '#00FF94' }}>↑</div>;
                    if (currentWeekStats.cardio < compare) return <div className="text-[10px] mt-1" style={{ color: '#FF453A' }}>↓</div>;
                    return <div className="text-[10px] mt-1 opacity-0">-</div>;
                  })()}
                </div>
                <div>
                  <div className="text-lg font-black text-white">{currentWeekStats.recovery}</div>
                  <div className="text-[10px] text-gray-400">🧊 Recovery</div>
                  {(() => {
                    const compare = compareWeek === 'average' ? weeklyStats['average']?.recovery || 0 : weeklyStats['week-2']?.recovery || 0;
                    if (currentWeekStats.recovery > compare) return <div className="text-[10px] mt-1" style={{ color: '#00FF94' }}>↑</div>;
                    if (currentWeekStats.recovery < compare) return <div className="text-[10px] mt-1" style={{ color: '#FF453A' }}>↓</div>;
                    return <div className="text-[10px] mt-1 opacity-0">-</div>;
                  })()}
                </div>
                <div>
                  <div className="text-lg font-black text-white">{(currentWeekStats.calories/1000).toFixed(1)}k</div>
                  <div className="text-[10px] text-gray-400">🔥 Cals</div>
                  {(() => {
                    const compare = compareWeek === 'average' ? weeklyStats['average']?.calories || 0 : weeklyStats['week-2']?.calories || 0;
                    if (currentWeekStats.calories > compare) return <div className="text-[10px] mt-1" style={{ color: '#00FF94' }}>↑</div>;
                    if (currentWeekStats.calories < compare) return <div className="text-[10px] mt-1" style={{ color: '#FF453A' }}>↓</div>;
                    return <div className="text-[10px] mt-1 opacity-0">-</div>;
                  })()}
                </div>
                <div>
                  <div className="text-lg font-black text-white">{currentWeekStats.miles.toFixed(1)}</div>
                  <div className="text-[10px] text-gray-400">📍 Miles</div>
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
                  <div className="text-[10px] text-gray-400">🏋️ Strength</div>
                  <div className="text-[10px] mt-1 opacity-0">-</div>
                </div>
                <div>
                  <div className="text-lg font-black">{compareWeek === 'average' ? weeklyStats['average']?.cardio || 0 : weeklyStats['week-2']?.cardio || 0}</div>
                  <div className="text-[10px] text-gray-400">🏃 Cardio</div>
                  <div className="text-[10px] mt-1 opacity-0">-</div>
                </div>
                <div>
                  <div className="text-lg font-black">{compareWeek === 'average' ? weeklyStats['average']?.recovery || 0 : weeklyStats['week-2']?.recovery || 0}</div>
                  <div className="text-[10px] text-gray-400">🧊 Recovery</div>
                  <div className="text-[10px] mt-1 opacity-0">-</div>
                </div>
                <div>
                  <div className="text-lg font-black">{compareWeek === 'average' ? ((weeklyStats['average']?.calories || 0)/1000).toFixed(1) + 'k' : ((weeklyStats['week-2']?.calories || 0)/1000).toFixed(1) + 'k'}</div>
                  <div className="text-[10px] text-gray-400">🔥 Cals</div>
                  <div className="text-[10px] mt-1 opacity-0">-</div>
                </div>
                <div>
                  <div className="text-lg font-black">{compareWeek === 'average' ? weeklyStats['average']?.miles || 0 : weeklyStats['week-2']?.miles || 0}</div>
                  <div className="text-[10px] text-gray-400">📍 Miles</div>
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
        const lifts = fullDayActivities.filter(a => a.type === 'Strength Training');
        const cardioActivities = fullDayActivities.filter(a => 
          a.type === 'Running' || a.type === 'Cycle' || a.type === 'Sports'
        );
        const recoveryActivities = fullDayActivities.filter(a => 
          a.type === 'Cold Plunge' || a.type === 'Sauna' || a.type === 'Yoga' || a.type === 'Pilates'
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
            <div className="flex items-center justify-between p-4 border-b border-white/10">
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
                            <div className="font-medium text-sm">{activity.strengthType && activity.focusArea ? `${activity.strengthType} • ${activity.focusArea}` : activity.subtype || 'Strength Training'}</div>
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
                            <div className="font-medium text-sm">{activity.subtype || activity.type}</div>
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
                            <div className="font-medium text-sm">{activity.subtype ? `${activity.type} • ${activity.subtype}` : activity.type}</div>
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
        <div className="mx-4 mt-2">
          {/* Stats Headline */}
          <div className="mb-4">
            <div className="text-sm font-semibold text-white">Your Stats</div>
            <p className="text-[11px] text-gray-500 mt-0.5">Your totals over time</p>
          </div>

          {/* Toggle and Dropdown Row */}
          <div className="relative flex items-center justify-center mb-4">
            {/* Mini Toggle - centered */}
            <div className="relative flex p-1 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.05)', width: '50%' }}>
              {/* Sliding pill indicator */}
              <div
                className="absolute top-1 bottom-1 rounded-md transition-all duration-300 ease-out"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.1)',
                  width: 'calc((100% - 8px) / 2)',
                  left: statsSubView === 'overview' ? '4px' : 'calc(4px + (100% - 8px) / 2)'
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
                My Records
              </button>
            </div>

            {/* Time Period Dropdown - positioned on right, only show for overview */}
            {statsSubView === 'overview' && (
              <select
                value={totalsView}
                onChange={(e) => setTotalsView(e.target.value)}
                className="absolute right-0 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs"
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
                <div className="p-4 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(0,255,148,0.2) 0%, rgba(0,255,148,0.05) 100%)' }}>
                  <div className="text-4xl font-black" style={{ color: '#00FF94' }}>{Object.values(totalsData.lifting || {}).reduce((a, b) => a + b, 0)}</div>
                  <div className="text-sm text-gray-400">🏋️ Strength</div>
                </div>
                <div className="p-4 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(255,149,0,0.2) 0%, rgba(255,149,0,0.05) 100%)' }}>
                  <div className="text-4xl font-black" style={{ color: '#FF9500' }}>{Object.values(totalsData.cardio || {}).reduce((a, b) => a + b, 0)}</div>
                  <div className="text-sm text-gray-400">🏃 Cardio</div>
                </div>
                <div className="p-4 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(0,209,255,0.2) 0%, rgba(0,209,255,0.05) 100%)' }}>
                  <div className="text-4xl font-black" style={{ color: '#00D1FF' }}>{totalsData.recovery}</div>
                  <div className="text-sm text-gray-400">🧊 Recovery</div>
                </div>
                <div className="p-4 rounded-2xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  <div className="text-4xl font-black">{totalsData.miles.toFixed(1)}</div>
                  <div className="text-sm text-gray-400">📍 Miles Run</div>
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
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">🔥 Streak Records</div>
                <div className="space-y-2">
                  <div className="p-4 rounded-2xl flex items-center justify-between" style={{ background: 'linear-gradient(135deg, rgba(255,215,0,0.15) 0%, rgba(255,149,0,0.1) 100%)', border: '1px solid rgba(255,215,0,0.3)' }}>
                    <div>
                      <div className="text-sm text-gray-400">🏆 Longest Master Streak</div>
                      <div className="text-2xl font-black" style={{ color: records.longestMasterStreak ? '#FFD700' : 'rgba(255,255,255,0.3)' }}>
                        {records.longestMasterStreak ? `${records.longestMasterStreak} weeks` : '—'}
                      </div>
                    </div>
                    <span className="text-3xl">🏆</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(0,255,148,0.1)', border: '1px solid rgba(0,255,148,0.2)' }}>
                      <div className="text-xs text-gray-400">🏋️ Strength Streak</div>
                      <div className="text-xl font-black" style={{ color: records.longestStrengthStreak ? '#00FF94' : 'rgba(255,255,255,0.3)' }}>
                        {records.longestStrengthStreak ? `${records.longestStrengthStreak} weeks` : '—'}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,149,0,0.1)', border: '1px solid rgba(255,149,0,0.2)' }}>
                      <div className="text-xs text-gray-400">🏃 Cardio Streak</div>
                      <div className="text-xl font-black" style={{ color: records.longestCardioStreak ? '#FF9500' : 'rgba(255,255,255,0.3)' }}>
                        {records.longestCardioStreak ? `${records.longestCardioStreak} weeks` : '—'}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(0,209,255,0.1)', border: '1px solid rgba(0,209,255,0.2)' }}>
                      <div className="text-xs text-gray-400">🧊 Recovery Streak</div>
                      <div className="text-xl font-black" style={{ color: records.longestRecoveryStreak ? '#00D1FF' : 'rgba(255,255,255,0.3)' }}>
                        {records.longestRecoveryStreak ? `${records.longestRecoveryStreak} weeks` : '—'}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)' }}>
                      <div className="text-xs text-gray-400">📊 Current Master</div>
                      <div className="text-xl font-black" style={{ color: streaks.master ? 'white' : 'rgba(255,255,255,0.3)' }}>
                        {streaks.master ? `${streaks.master} weeks` : '—'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Single Workout Records */}
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">💪 Single Workout Records</div>
                <div className="space-y-2">
                  {/* Highest Calories */}
                  <div className="p-3 rounded-xl flex items-center justify-between" style={{ backgroundColor: 'rgba(255,149,0,0.05)' }}>
                    <div>
                      <div className="text-[10px] text-gray-500">🔥 Highest Calories Burned</div>
                      <div className="text-xl font-black" style={{ color: getRecordValue(records.highestCalories) ? '#FF9500' : 'rgba(255,255,255,0.3)' }}>
                        {getRecordValue(records.highestCalories) 
                          ? `${getRecordValue(records.highestCalories)} cal` 
                          : '—'}
                      </div>
                      {getRecordType(records.highestCalories) && (
                        <div className="text-[10px] text-gray-600">{getRecordType(records.highestCalories)}</div>
                      )}
                    </div>
                  </div>
                  
                  {/* Longest Strength */}
                  <div className="p-3 rounded-xl flex items-center justify-between" style={{ backgroundColor: 'rgba(0,255,148,0.05)' }}>
                    <div>
                      <div className="text-[10px] text-gray-500">🏋️ Longest Strength Session</div>
                      <div className="text-xl font-black" style={{ color: getRecordValue(records.longestStrength) ? '#00FF94' : 'rgba(255,255,255,0.3)' }}>
                        {getRecordValue(records.longestStrength) ? (() => {
                          const duration = getRecordValue(records.longestStrength);
                          const hours = Math.floor(duration / 60);
                          const mins = duration % 60;
                          return hours > 0 ? `${hours}h ${mins}m` : `${mins} min`;
                        })() : '—'}
                      </div>
                    </div>
                  </div>
                  
                  {/* Longest Cardio */}
                  <div className="p-3 rounded-xl flex items-center justify-between" style={{ backgroundColor: 'rgba(255,149,0,0.05)' }}>
                    <div>
                      <div className="text-[10px] text-gray-500">🏃 Longest Cardio Session</div>
                      <div className="text-xl font-black" style={{ color: getRecordValue(records.longestCardio) ? '#FF9500' : 'rgba(255,255,255,0.3)' }}>
                        {getRecordValue(records.longestCardio) ? (() => {
                          const duration = getRecordValue(records.longestCardio);
                          const hours = Math.floor(duration / 60);
                          const mins = duration % 60;
                          return hours > 0 ? `${hours}h ${mins}m` : `${mins} min`;
                        })() : '—'}
                      </div>
                      {getRecordType(records.longestCardio) && (
                        <div className="text-[10px] text-gray-600">{getRecordType(records.longestCardio)}</div>
                      )}
                    </div>
                  </div>
                  
                  {/* Longest Distance */}
                  <div className="p-3 rounded-xl flex items-center justify-between" style={{ backgroundColor: 'rgba(255,149,0,0.05)' }}>
                    <div>
                      <div className="text-[10px] text-gray-500">📍 Longest Distance</div>
                      <div className="text-xl font-black" style={{ color: getRecordValue(records.longestDistance) ? '#FF9500' : 'rgba(255,255,255,0.3)' }}>
                        {getRecordValue(records.longestDistance) 
                          ? `${parseFloat(getRecordValue(records.longestDistance)).toFixed(1)} mi` 
                          : '—'}
                      </div>
                      {getRecordType(records.longestDistance) && (
                        <div className="text-[10px] text-gray-600">{getRecordType(records.longestDistance)}</div>
                      )}
                    </div>
                  </div>
                  
                  {/* Fastest Running Pace */}
                  <div className="p-3 rounded-xl flex items-center justify-between" style={{ backgroundColor: 'rgba(255,149,0,0.05)' }}>
                    <div>
                      <div className="text-[10px] text-gray-500">🏃 Fastest Running Pace</div>
                      <div className="text-xl font-black" style={{ color: getRecordValue(records.fastestPace) ? '#FF9500' : 'rgba(255,255,255,0.3)' }}>
                        {getRecordValue(records.fastestPace) ? (() => {
                          const pace = getRecordValue(records.fastestPace);
                          const paceMin = Math.floor(pace);
                          const paceSec = Math.round((pace - paceMin) * 60);
                          return `${paceMin}:${paceSec.toString().padStart(2, '0')}/mi`;
                        })() : '—'}
                      </div>
                      {getRecordType(records.fastestPace) && (
                        <div className="text-[10px] text-gray-600">{getRecordType(records.fastestPace)}</div>
                      )}
                    </div>
                  </div>

                  {/* Fastest Cycling Pace */}
                  <div className="p-3 rounded-xl flex items-center justify-between" style={{ backgroundColor: 'rgba(0,209,255,0.05)' }}>
                    <div>
                      <div className="text-[10px] text-gray-500">🚴 Fastest Cycling Pace</div>
                      <div className="text-xl font-black" style={{ color: getRecordValue(records.fastestCyclingPace) ? '#00D1FF' : 'rgba(255,255,255,0.3)' }}>
                        {getRecordValue(records.fastestCyclingPace) ? (() => {
                          const pace = getRecordValue(records.fastestCyclingPace);
                          const paceMin = Math.floor(pace);
                          const paceSec = Math.round((pace - paceMin) * 60);
                          return `${paceMin}:${paceSec.toString().padStart(2, '0')}/mi`;
                        })() : '—'}
                      </div>
                      {getRecordType(records.fastestCyclingPace) && (
                        <div className="text-[10px] text-gray-600">{getRecordType(records.fastestCyclingPace)}</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Weekly Records */}
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">📅 Weekly Records</div>
                <div className="space-y-2">
                  {/* Most Workouts */}
                  <div className="p-3 rounded-xl flex items-center justify-between" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                    <div>
                      <div className="text-[10px] text-gray-500">🎯 Most Workouts in a Week</div>
                      <div className="text-xl font-black" style={{ color: records.mostWorkoutsWeek ? 'white' : 'rgba(255,255,255,0.3)' }}>
                        {records.mostWorkoutsWeek || '—'}
                      </div>
                    </div>
                  </div>
                  
                  {/* Most Calories */}
                  <div className="p-3 rounded-xl flex items-center justify-between" style={{ backgroundColor: 'rgba(255,149,0,0.05)' }}>
                    <div>
                      <div className="text-[10px] text-gray-500">🔥 Most Calories in a Week</div>
                      <div className="text-xl font-black" style={{ color: records.mostCaloriesWeek ? '#FF9500' : 'rgba(255,255,255,0.3)' }}>
                        {records.mostCaloriesWeek ? `${records.mostCaloriesWeek.toLocaleString()} cal` : '—'}
                      </div>
                    </div>
                  </div>
                  
                  {/* Most Miles */}
                  <div className="p-3 rounded-xl flex items-center justify-between" style={{ backgroundColor: 'rgba(255,149,0,0.05)' }}>
                    <div>
                      <div className="text-[10px] text-gray-500">🏃 Most Miles in a Week</div>
                      <div className="text-xl font-black" style={{ color: records.mostMilesWeek ? '#FF9500' : 'rgba(255,255,255,0.3)' }}>
                        {records.mostMilesWeek ? `${parseFloat(records.mostMilesWeek).toFixed(1)} mi` : '—'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Trends View */}
      {view === 'trends' && (
        <TrendsView activities={activities} calendarData={calendarData} />
      )}

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
      />
    </div>
  );
};

// Profile Tab Component
const ProfileTab = ({ user, userProfile, userData, onSignOut, onEditGoals }) => {
  const goalLabels = {
    liftsPerWeek: { label: 'Strength', icon: '🏋️', suffix: '/week' },
    cardioPerWeek: { label: 'Cardio', icon: '🏃', suffix: '/week' },
    recoveryPerWeek: { label: 'Recovery', icon: '🧊', suffix: '/week' },
    stepsPerDay: { label: 'Steps', icon: '👟', suffix: '/day', format: (v) => `${(v/1000).toFixed(0)}k` }
  };

  return (
    <div className="pb-32">
      {/* Header */}
      <div className="px-4 pt-2 pb-4">
        <h1 className="text-xl font-bold text-white">Profile</h1>
      </div>

      <div className="px-4">
        {/* Profile Section */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">PROFILE</h3>
          <div className="rounded-2xl p-4" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
            {/* Profile Photo & Name */}
            <div className="flex items-center gap-4 mb-4">
              <div className="w-16 h-16 rounded-full bg-zinc-700 flex items-center justify-center overflow-hidden">
                {userProfile?.photoURL ? (
                  <img src={userProfile.photoURL} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-2xl text-white">
                    {userProfile?.displayName?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?'}
                  </span>
                )}
              </div>
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
                  {user?.metadata?.creationTime
                    ? new Date(user.metadata.creationTime).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                    : 'Unknown'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Goals Section */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-400">WEEKLY GOALS</h3>
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
          </div>
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

        {/* App Info Section */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">APP</h3>
          <div className="rounded-2xl p-4" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-gray-400">Version</span>
              <span className="text-sm text-white">1.0.0</span>
            </div>
          </div>
        </div>

        {/* Sign Out Button */}
        <button
          onClick={onSignOut}
          className="w-full py-4 rounded-xl font-semibold text-red-500 transition-all duration-150 mb-8"
          style={{ backgroundColor: 'rgba(255,69,58,0.1)', transform: 'scale(1)' }}
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
          Sign Out
        </button>
      </div>
    </div>
  );
};

// Main App
export default function StreakdApp() {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isOnboarded, setIsOnboarded] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('home');
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [historyView, setHistoryView] = useState('calendar');
  const [historyStatsSubView, setHistoryStatsSubView] = useState('overview');
  const [showEditGoals, setShowEditGoals] = useState(false);
  const [pendingFriendRequests, setPendingFriendRequests] = useState(0);
  
  // Navigate to Hall of Fame
  const navigateToHallOfFame = () => {
    setActiveTab('history');
    setHistoryView('stats');
    setHistoryStatsSubView('records');
  };

  // Handle sign out
  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setActiveTab('home');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };
  
  // Listen to auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      if (user) {
        // Check if user profile exists, create if not
        let profile = await getUserProfile(user.uid);
        if (!profile) {
          await createUserProfile(user);
          profile = await getUserProfile(user.uid);
        }
        setUserProfile(profile);
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
      } else {
        setUserProfile(null);
        setFriends([]);
        setPendingFriendRequests(0);
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Simulate initial load
  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 800);
    return () => clearTimeout(timer);
  }, []);

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

  // Track if initial load is complete to avoid saving on mount
  const hasLoadedActivities = useRef(false);

  // Save activities to Firestore when they change
  useEffect(() => {
    console.log('Activities effect triggered:', { user: !!user, activitiesCount: activities.length, hasLoaded: hasLoadedActivities.current });

    if (!user) {
      console.log('No user, skipping save');
      return;
    }

    // Skip the initial load - only save after user makes changes
    if (!hasLoadedActivities.current) {
      console.log('Initial load, marking as loaded');
      hasLoadedActivities.current = true;
      return;
    }

    // Debounce the save to avoid too many writes
    const timeoutId = setTimeout(() => {
      console.log('Saving activities:', activities);
      saveUserActivities(user.uid, activities);
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [activities, user]);

  // Save custom activities to Firestore when they change
  const hasLoadedCustomActivities = useRef(false);
  useEffect(() => {
    if (!user) return;

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
  }, [userData.customActivities, user]);

  // Helper to determine effective category of an activity
  const getActivityCategory = (activity) => {
    // If countToward is set (for Yoga/Pilates), use that
    if (activity.countToward) {
      return activity.countToward;
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
      calories: { burned: totalCalories, goal: userData.goals.caloriesPerWeek },
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

  const handleActivitySaved = (activity) => {
    // Check if this is an edit (activity has existing ID) or new activity
    const isEdit = activity.id && activities.some(a => a.id === activity.id);
    
    let newActivity;
    let updatedActivities;
    
    if (isEdit) {
      // Update existing activity
      newActivity = {
        ...activity,
        time: activity.time || new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      };
      updatedActivities = activities.map(a => a.id === activity.id ? newActivity : a);
      
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
        ...activity,
        id: Date.now(),
        time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      };
      
      // Add to activities list
      updatedActivities = [newActivity, ...activities];
      
      // Update calendar data
      const dateKey = activity.date;
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

    // Recalculate weekly progress
    const newProgress = calculateWeeklyProgress(updatedActivities);
    setWeeklyProgress(newProgress);

    console.log('Saved activity:', newActivity, 'Cardio count:', newProgress.cardio?.completed);

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

    // Update streaks when goals are met - combined into single setUserData call to avoid race conditions
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
      if (isNewRecord) {
        setCelebrationMessage(`New Record: ${newStreak} Week Strength Streak! 🏆`);
      } else if (checkStreakMilestone(newStreak)) {
        setCelebrationMessage(`${newStreak} Week Strength Streak! 💪`);
      } else {
        setCelebrationMessage('Strength goal complete! 🏋️');
      }
      setShowCelebration(true);
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
      if (isNewRecord) {
        setCelebrationMessage(`New Record: ${newStreak} Week Cardio Streak! 🏆`);
      } else if (checkStreakMilestone(newStreak)) {
        setCelebrationMessage(`${newStreak} Week Cardio Streak! 🔥`);
      } else {
        setCelebrationMessage('Cardio goal complete! 🏃');
      }
      setShowCelebration(true);
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
      if (isNewRecord) {
        setCelebrationMessage(`New Record: ${newStreak} Week Recovery Streak! 🏆`);
      } else if (checkStreakMilestone(newStreak)) {
        setCelebrationMessage(`${newStreak} Week Recovery Streak! ❄️`);
      } else {
        setCelebrationMessage('Recovery goal complete! 🧊');
      }
      setShowCelebration(true);
    } else {
      // No goal completed, check for personal records (use toast instead of full celebration)
      const record = checkAndUpdateRecords();
      if (record) {
        setToastMessage(record.message);
        setShowToast(true);
      }
    }

    // Always check and update records (mostMilesWeek, etc.) even when a goal was completed
    // The if/else above handles celebrations, but we still need to update distance/calorie records
    if (justCompletedLifts || justCompletedCardio || justCompletedRecovery) {
      checkAndUpdateRecords();
    }
    
    // Check if all goals met (master streak)
    const allGoalsMet = newProgress.lifts.completed >= goals.liftsPerWeek &&
        newProgress.cardio.completed >= goals.cardioPerWeek &&
        newProgress.recovery.completed >= goals.recoveryPerWeek;
    
    const wasAllGoalsMet = prevProgress.lifts.completed >= goals.liftsPerWeek &&
        prevProgress.cardio.completed >= goals.cardioPerWeek &&
        prevProgress.recovery.completed >= goals.recoveryPerWeek;
    
    if (allGoalsMet && !wasAllGoalsMet) {
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
      
      // Show the week streak celebration modal after a short delay
      setTimeout(() => {
        setShowWeekStreakCelebration(true);
      }, 2000);
    }
  };

  const handleDeleteActivity = (activityId) => {
    // Find the activity to delete
    const activityToDelete = activities.find(a => a.id === activityId);
    if (!activityToDelete) return;

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

    console.log('Deleted activity:', activityId);
  };

  // Pull to refresh handlers
  let touchStartY = 0;
  const handleTouchStart = (e) => {
    if (window.scrollY === 0) {
      touchStartY = e.touches[0].clientY;
    }
  };

  const handleTouchMove = (e) => {
    if (window.scrollY === 0 && !isRefreshing) {
      const touchY = e.touches[0].clientY;
      const distance = touchY - touchStartY;
      if (distance > 0) {
        setPullDistance(distance * 0.5);
      }
    }
  };

  const handleTouchEnd = () => {
    if (pullDistance > 60 && !isRefreshing) {
      // Trigger refresh
      setIsRefreshing(true);
      setPullDistance(0);
      
      // Simulate refresh (in real app, would fetch data)
      setTimeout(() => {
        setIsRefreshing(false);
      }, 1500);
    } else {
      setPullDistance(0);
    }
  };

  // Show loading spinner while checking auth
  if (authLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Show login if no user
  if (!user) {
    return <Login onLogin={() => {}} />;
  }

  // Show username setup if user doesn't have a username
  if (!userProfile?.username) {
    return (
      <UsernameSetup
        user={user}
        onComplete={(username) => setUserProfile(prev => ({ ...prev, username }))}
      />
    );
  }

  if (!isOnboarded) {
    return <OnboardingSurvey 
      currentGoals={userData.goals}
      onCancel={() => setIsOnboarded(true)}
      onComplete={(goals) => {
        // Update userData with user's chosen goals
        setUserData(prev => ({
          ...prev,
          goals: {
            ...prev.goals,
            liftsPerWeek: goals.liftsPerWeek,
            cardioPerWeek: goals.cardioPerWeek,
            recoveryPerWeek: goals.recoveryPerWeek,
            stepsPerDay: goals.stepsPerDay
          }
        }));
        // Recalculate weekly progress with new goals
        setWeeklyProgress(prev => ({
          ...prev,
          lifts: { ...prev.lifts, goal: goals.liftsPerWeek },
          cardio: { ...prev.cardio, goal: goals.cardioPerWeek },
          recovery: { ...prev.recovery, goal: goals.recoveryPerWeek },
          steps: { ...prev.steps, goal: goals.stepsPerDay }
        }));
        setIsOnboarded(true);
      }} 
    />;
  }

  return (
    <div 
      className="min-h-screen text-white" 
      style={{ 
        backgroundColor: '#0A0A0A',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif'
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull to Refresh Indicator */}
      <div 
        className="fixed top-0 left-0 right-0 flex justify-center items-center transition-all duration-300 z-30"
        style={{ 
          height: isRefreshing ? '60px' : `${Math.min(pullDistance, 80)}px`,
          opacity: isRefreshing ? 1 : Math.min(pullDistance / 60, 1)
        }}
      >
        <div 
          className={`text-2xl ${isRefreshing ? 'animate-spin' : ''}`}
          style={{ 
            transform: isRefreshing ? 'none' : `rotate(${pullDistance * 3}deg)`,
            transition: isRefreshing ? 'none' : 'transform 0.1s'
          }}
        >
          {isRefreshing ? '⟳' : '↓'}
        </div>
      </div>

      <div
        className="h-12"
        style={{ marginTop: isRefreshing ? '48px' : '0', transition: 'margin 0.3s' }}
      />

      <div className="mt-2">
        <div 
          key={activeTab}
          className="animate-fade-in"
          style={{
            animation: 'fadeIn 100ms ease-out'
          }}
        >
          {isLoading ? (
            <HomeTabSkeleton />
          ) : (
            <>
              {activeTab === 'home' && (
                <HomeTab
                  onAddActivity={handleAddActivity}
                  pendingSync={initialPendingSync}
                  activities={activities}
                  weeklyProgress={weeklyProgress}
                  userData={userData}
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
                />
              )}
              {activeTab === 'feed' && (
                <ActivityFeed
                  user={user}
                  userProfile={userProfile}
                  friends={friends}
                  onOpenFriends={() => setShowFriends(true)}
                  pendingRequestsCount={pendingFriendRequests}
                />
              )}
              {activeTab === 'profile' && (
                <ProfileTab
                  user={user}
                  userProfile={userProfile}
                  userData={userData}
                  onSignOut={handleSignOut}
                  onEditGoals={() => setShowEditGoals(true)}
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
          onClick={() => handleAddActivity()}
          className="absolute left-1/2 -translate-x-1/2 w-20 h-20 rounded-full flex items-center justify-center shadow-xl transition-all duration-150 z-50"
          style={{
            bottom: 'calc(100% - 60px)',
            backgroundColor: '#00FF94',
            boxShadow: '0 8px 32px rgba(0, 255, 148, 0.5)',
            transform: 'translateX(-50%) scale(1)'
          }}
          onTouchStart={(e) => {
            e.currentTarget.style.transform = 'translateX(-50%) scale(0.9)';
            e.currentTarget.style.boxShadow = '0 4px 16px rgba(0, 255, 148, 0.7)';
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
            e.currentTarget.style.boxShadow = '0 8px 32px rgba(0, 255, 148, 0.5)';
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = 'translateX(-50%) scale(0.9)';
            e.currentTarget.style.boxShadow = '0 4px 16px rgba(0, 255, 148, 0.7)';
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = 'translateX(-50%) scale(1)';
            e.currentTarget.style.boxShadow = '0 8px 32px rgba(0, 255, 148, 0.5)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateX(-50%) scale(1)';
            e.currentTarget.style.boxShadow = '0 8px 32px rgba(0, 255, 148, 0.5)';
          }}
        >
          <span className="text-4xl text-black font-bold leading-none" style={{ marginTop: '-2px' }}>+</span>
        </button>

        <div className="flex items-center justify-around p-2 rounded-2xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(20px)' }}>
          {/* Home */}
          <button
            onClick={() => setActiveTab('home')}
            className="flex-1 py-3 flex flex-col items-center gap-1 transition-all duration-150"
            style={{ transform: 'scale(1)' }}
            onTouchStart={(e) => e.currentTarget.style.transform = 'scale(0.92)'}
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
            onClick={() => setActiveTab('history')}
            className="flex-1 py-3 flex flex-col items-center gap-1 transition-all duration-150"
            style={{ transform: 'scale(1)' }}
            onTouchStart={(e) => e.currentTarget.style.transform = 'scale(0.92)'}
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
            onClick={() => setActiveTab('feed')}
            className="flex-1 py-3 flex flex-col items-center gap-1 transition-all duration-150 relative"
            style={{ transform: 'scale(1)' }}
            onTouchStart={(e) => e.currentTarget.style.transform = 'scale(0.92)'}
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
            onClick={() => setActiveTab('profile')}
            className="flex-1 py-3 flex flex-col items-center gap-1 transition-all duration-150"
            style={{ transform: 'scale(1)' }}
            onTouchStart={(e) => e.currentTarget.style.transform = 'scale(0.92)'}
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
        onComplete={() => setShowCelebration(false)}
      />

      <WeekStreakCelebration
        show={showWeekStreakCelebration}
        onClose={() => setShowWeekStreakCelebration(false)}
        onShare={() => {
          setShowWeekStreakCelebration(false);
          setShowShare(true);
        }}
      />

      <Toast
        show={showToast}
        message={toastMessage}
        onDismiss={() => setShowToast(false)}
        onTap={navigateToHallOfFame}
        type="record"
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
            onComplete={(goals) => {
              setUserData(prev => ({
                ...prev,
                goals: {
                  ...prev.goals,
                  liftsPerWeek: goals.liftsPerWeek,
                  cardioPerWeek: goals.cardioPerWeek,
                  recoveryPerWeek: goals.recoveryPerWeek,
                  stepsPerDay: goals.stepsPerDay
                }
              }));
              setWeeklyProgress(prev => ({
                ...prev,
                lifts: { ...prev.lifts, goal: goals.liftsPerWeek },
                cardio: { ...prev.cardio, goal: goals.cardioPerWeek },
                recovery: { ...prev.recovery, goal: goals.recoveryPerWeek },
                steps: { ...prev.steps, goal: goals.stepsPerDay }
              }));
              setShowEditGoals(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
