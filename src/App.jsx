import React, { useState, useEffect } from 'react';

// Mock data
const mockUserData = {
  name: 'Alex',
  goals: {
    liftsPerWeek: 4,
    runsPerWeek: 3,
    recoveryPerWeek: 2,
    stepsPerDay: 10000,
    caloriesPerWeek: 3500
  },
  streaks: {
    master: 3,
    lifts: 7,
    runs: 5,
    recovery: 4,
    stepsGoal: 6
  }
};

const mockWhoopData = {
  recovery: 78,
  sleep: 85,
  strain: 12.4,
  hrv: 62
};

const mockWeeklyProgress = {
  lifts: { completed: 2, goal: 4, sessions: ['Upper', 'Lower'] },
  runs: { completed: 1, goal: 3, miles: 4.2, targetMiles: 15 },
  recovery: { completed: 1, goal: 2, sessions: ['Cold Plunge'] },
  calories: { burned: 2100, goal: 3500 },
  steps: { today: 7234, goal: 10000 }
};

const mockActivities = [
  { id: 1, type: 'Lifting', subtype: 'Upper', date: '2026-01-20', time: '6:30 AM', calories: 340, avgHr: 125, maxHr: 165, duration: 55 },
  { id: 2, type: 'Running', subtype: 'Easy Run', date: '2026-01-19', time: '7:00 AM', calories: 420, avgHr: 145, maxHr: 168, distance: 4.2, duration: 38 },
  { id: 3, type: 'Cold Plunge', subtype: null, date: '2026-01-19', time: '7:45 AM', duration: 5, temp: 45 },
  { id: 4, type: 'Lifting', subtype: 'Lower', date: '2026-01-18', time: '6:00 AM', calories: 380, avgHr: 130, maxHr: 172, duration: 62 }
];

const mockWeeklyStats = {
  'week-3': { 
    workouts: 5, 
    recovery: 2, 
    calories: 3200, 
    steps: 72000, 
    miles: 12.4, 
    goalsMet: true,
    lifts: 3,
    runs: 2,
    liftBreakdown: { Upper: 2, Lower: 1 },
    runBreakdown: { Easy: 1, Long: 1 },
    recoveryBreakdown: { 'Cold Plunge': 1, Sauna: 1 },
    activities: [
      { type: 'Lifting', subtype: 'Upper', date: 'Jan 6', duration: 52, calories: 380, avgHr: 125 },
      { type: 'Running', subtype: 'Easy', date: 'Jan 7', duration: 35, calories: 320, distance: 3.2 },
      { type: 'Lifting', subtype: 'Lower', date: 'Jan 8', duration: 48, calories: 350, avgHr: 118 },
      { type: 'Cold Plunge', date: 'Jan 9', duration: 5, temp: 45 },
      { type: 'Lifting', subtype: 'Upper', date: 'Jan 10', duration: 55, calories: 410, avgHr: 128 },
      { type: 'Sauna', date: 'Jan 11', duration: 20, temp: 180 },
      { type: 'Running', subtype: 'Long', date: 'Jan 12', duration: 68, calories: 580, distance: 6.2 }
    ]
  },
  'week-2': { 
    workouts: 4, 
    recovery: 3, 
    calories: 3500, 
    steps: 68000, 
    miles: 15.2, 
    goalsMet: true,
    lifts: 2,
    runs: 2,
    liftBreakdown: { Legs: 1, Upper: 1 },
    runBreakdown: { Easy: 1, Tempo: 1 },
    recoveryBreakdown: { 'Cold Plunge': 1, Sauna: 1, Yoga: 1 },
    activities: [
      { type: 'Lifting', subtype: 'Legs', date: 'Jan 13', duration: 50, calories: 390, avgHr: 130 },
      { type: 'Yoga', date: 'Jan 13', duration: 45, calories: 120 },
      { type: 'Lifting', subtype: 'Upper', date: 'Jan 15', duration: 48, calories: 360, avgHr: 122 },
      { type: 'Running', subtype: 'Tempo', date: 'Jan 16', duration: 42, calories: 450, distance: 5.1 },
      { type: 'Sauna', date: 'Jan 17', duration: 25, temp: 175 },
      { type: 'Running', subtype: 'Easy', date: 'Jan 19', duration: 30, calories: 280, distance: 2.8 },
      { type: 'Cold Plunge', date: 'Jan 19', duration: 6, temp: 42 }
    ]
  },
  'week-1': { 
    workouts: 6, 
    recovery: 2, 
    calories: 3800, 
    steps: 82000, 
    miles: 18.1, 
    goalsMet: true,
    lifts: 4,
    runs: 2,
    liftBreakdown: { Upper: 2, Lower: 1, Chest: 1 },
    runBreakdown: { Easy: 1, Long: 1 },
    recoveryBreakdown: { 'Cold Plunge': 2 },
    activities: [
      { type: 'Lifting', subtype: 'Upper', date: 'Jan 20', duration: 55, calories: 420, avgHr: 126 },
      { type: 'Running', subtype: 'Easy', date: 'Jan 21', duration: 32, calories: 290, distance: 3.0 },
      { type: 'Lifting', subtype: 'Lower', date: 'Jan 22', duration: 50, calories: 380, avgHr: 120 },
      { type: 'Cold Plunge', date: 'Jan 22', duration: 5, temp: 45 },
      { type: 'Lifting', subtype: 'Chest', date: 'Jan 24', duration: 45, calories: 340, avgHr: 118 },
      { type: 'Running', subtype: 'Long', date: 'Jan 25', duration: 75, calories: 620, distance: 7.2 },
      { type: 'Lifting', subtype: 'Upper', date: 'Jan 26', duration: 52, calories: 390, avgHr: 124 },
      { type: 'Cold Plunge', date: 'Jan 26', duration: 6, temp: 43 }
    ]
  }
};

const mockCalendarData = {
  // January 2026
  '2026-01-01': [{ type: 'Lifting', subtype: 'Upper' }],
  '2026-01-02': [{ type: 'Running', subtype: 'Easy' }],
  '2026-01-03': [{ type: 'Lifting', subtype: 'Lower' }, { type: 'Cold Plunge' }],
  '2026-01-04': [],
  '2026-01-05': [{ type: 'Running', subtype: 'Long' }],
  '2026-01-06': [{ type: 'Lifting', subtype: 'Upper' }, { type: 'Cold Plunge' }],
  '2026-01-07': [],
  '2026-01-08': [{ type: 'Lifting', subtype: 'Lower' }],
  '2026-01-09': [{ type: 'Running', subtype: 'Easy' }],
  '2026-01-10': [{ type: 'Lifting', subtype: 'Upper' }],
  '2026-01-11': [{ type: 'Cold Plunge' }],
  '2026-01-12': [{ type: 'Running', subtype: 'Long' }],
  '2026-01-13': [{ type: 'Lifting', subtype: 'Legs' }, { type: 'Yoga' }],
  '2026-01-14': [],
  '2026-01-15': [{ type: 'Lifting', subtype: 'Upper' }],
  '2026-01-16': [{ type: 'Running', subtype: 'Tempo' }],
  '2026-01-17': [{ type: 'Sauna' }],
  '2026-01-18': [{ type: 'Lifting', subtype: 'Lower' }],
  '2026-01-19': [{ type: 'Running', subtype: 'Easy' }, { type: 'Cold Plunge' }],
  '2026-01-20': [{ type: 'Lifting', subtype: 'Upper' }],
  // December 2025 (for context)
  '2025-12-25': [],
  '2025-12-26': [{ type: 'Lifting', subtype: 'Upper' }],
  '2025-12-27': [{ type: 'Running', subtype: 'Easy' }],
  '2025-12-28': [{ type: 'Lifting', subtype: 'Lower' }, { type: 'Sauna' }],
  '2025-12-29': [],
  '2025-12-30': [{ type: 'Running', subtype: 'Long' }],
  '2025-12-31': [{ type: 'Lifting', subtype: 'Upper' }, { type: 'Cold Plunge' }, { type: 'Yoga' }]
};

const mockPendingSync = [
  { source: 'Whoop', type: 'Lifting', date: '2026-01-21', time: '6:15 AM', calories: 295, avgHr: 118, maxHr: 155, duration: 48, durationHours: 0, durationMinutes: 48 }
];

const mockPersonalRecords = {
  // General
  mostStepsWeek: 98234,
  mostStepsDay: 18432,
  mostCaloriesWeek: 4200,
  mostCaloriesDay: 890,
  longestMasterStreak: 12,
  longestWorkoutStreak: 15,
  longestRecoveryStreak: 8,
  // Lifting
  mostLiftsWeek: 6,
  longestLiftStreak: 8,
  highestLiftCalories: 520,
  // Running
  fastestMile: '7:23',
  longestRun: 13.1,
  mostMilesWeek: 28.4,
  mostRunsWeek: 5,
  // Recovery
  mostRecoveryWeek: 5,
  longestColdPlunge: 8,
  coldestPlunge: 39,
  mostSaunaMinutes: 45,
  // Totals 2026
  totalWorkouts2026: 18,
  totalRecovery2026: 8,
  totalMiles2026: 42.6,
  // All-time totals
  totalWorkoutsAllTime: 847,
  totalRecoveryAllTime: 312,
  totalMilesAllTime: 1842.3
};

const mockLiftingBreakdown = {
  '2026': { Upper: 6, Lower: 4, Legs: 3, Chest: 2, Back: 2, Shoulders: 1 },
  'all-time': { Upper: 245, Lower: 198, Legs: 156, Chest: 89, Back: 87, Shoulders: 72 }
};

const mockRunningBreakdown = {
  '2026': { Easy: 5, Tempo: 3, Long: 2, Sprints: 1, Recovery: 1 },
  'all-time': { Easy: 312, Tempo: 156, Long: 89, Sprints: 45, Recovery: 67 }
};

const mockRecoveryBreakdown = {
  '2026': { 'Cold Plunge': 4, 'Sauna': 2, 'Yoga': 2 },
  'all-time': { 'Cold Plunge': 156, 'Sauna': 89, 'Yoga': 67 }
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
    'Lifting': '🏋️',
    'Running': '🏃',
    'Cold Plunge': '🧊',
    'Sauna': '🔥',
    'Yoga': '🧘',
    'Cycle': '🚴',
    'Sports': '⚽',
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

// Celebration Animation Component
const CelebrationOverlay = ({ show, onComplete, message = "Goal Complete!" }) => {
  useEffect(() => {
    if (show) {
      const timer = setTimeout(() => {
        onComplete();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [show, onComplete]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
      <div className="text-center animate-bounce-in">
        <div className="text-6xl mb-4">🎉</div>
        <div className="text-2xl font-black" style={{ color: '#00FF94' }}>{message}</div>
        <div className="text-gray-400 mt-2">Keep pushing!</div>
      </div>
      
      {/* Confetti particles */}
      <div className="absolute inset-0 overflow-hidden">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute w-2 h-2 rounded-full animate-confetti"
            style={{
              backgroundColor: ['#00FF94', '#00D1FF', '#FF9500', '#BF5AF2', '#FFD700'][i % 5],
              left: `${Math.random() * 100}%`,
              top: '-10px',
              animationDelay: `${Math.random() * 0.5}s`,
              animationDuration: `${1 + Math.random() * 1}s`
            }}
          />
        ))}
      </div>
      
      <style>{`
        @keyframes bounceIn {
          0% { transform: scale(0); opacity: 0; }
          50% { transform: scale(1.2); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes confetti {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
        .animate-bounce-in {
          animation: bounceIn 0.5s ease-out forwards;
        }
        .animate-confetti {
          animation: confetti 2s ease-out forwards;
        }
      `}</style>
    </div>
  );
};

// Share Modal
const ShareModal = ({ isOpen, onClose, stats }) => {
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl p-6" style={{ backgroundColor: '#1A1A1A' }}>
        <h3 className="text-xl font-bold mb-4 text-center">Share Your Stats</h3>
        
        <div className="p-4 rounded-xl mb-4" style={{ background: 'linear-gradient(135deg, #0A0A0A 0%, #1A1A1A 100%)', border: '1px solid rgba(0,255,148,0.3)' }}>
          <div className="text-center mb-3">
            <span className="text-2xl font-black">STREAKD</span>
            <div className="text-xs text-gray-500">Win the week.</div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div>
              <div className="text-2xl font-black" style={{ color: '#00FF94' }}>{stats?.streak || 7}</div>
              <div className="text-xs text-gray-400">Weeks Streakd 🔥</div>
            </div>
            <div>
              <div className="text-2xl font-black">{stats?.workouts || 18}</div>
              <div className="text-xs text-gray-400">Workouts in 2026</div>
            </div>
          </div>
        </div>
        
        <div className="grid grid-cols-3 gap-3 mb-4">
          <button className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
            <span className="text-2xl">📸</span>
            <div className="text-xs mt-1">Story</div>
          </button>
          <button className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
            <span className="text-2xl">📱</span>
            <div className="text-xs mt-1">Post</div>
          </button>
          <button className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
            <span className="text-2xl">💬</span>
            <div className="text-xs mt-1">Message</div>
          </button>
        </div>
        
        <button
          onClick={onClose}
          className="w-full py-3 rounded-xl font-medium"
          style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

// Week Stats Modal
const WeekStatsModal = ({ isOpen, onClose, weekData, weekLabel }) => {
  if (!isOpen) return null;
  
  const lifts = weekData?.activities?.filter(a => a.type === 'Lifting') || [];
  const runs = weekData?.activities?.filter(a => a.type === 'Running') || [];
  const recoveryActivities = weekData?.activities?.filter(a => 
    a.type === 'Cold Plunge' || a.type === 'Sauna' || a.type === 'Yoga'
  ) || [];

  const goals = mockUserData.goals;
  const liftsGoalMet = (weekData?.lifts || 0) >= goals.liftsPerWeek;
  const runsGoalMet = (weekData?.runs || 0) >= goals.runsPerWeek;
  const recoveryGoalMet = (weekData?.recovery || 0) >= goals.recoveryPerWeek;
  
  return (
    <div className="fixed inset-0 bg-black/95 z-50 flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <button onClick={onClose} className="text-gray-400">← Back</button>
        <h2 className="font-bold">{weekLabel}</h2>
        <button 
          className="px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1"
          style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
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
            <div className="text-[10px] text-gray-400">🏋️ Lifts</div>
          </div>
          <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(255,149,0,0.1)' }}>
            <div className="text-2xl font-black" style={{ color: '#FF9500' }}>{weekData?.runs || 0}</div>
            <div className="text-[10px] text-gray-400">🏃 Runs</div>
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
                <span className="text-xs">🏋️ Lifts</span>
                <div className="text-[10px] text-gray-500">{goals.liftsPerWeek}+ per week</div>
              </div>
              <span className="text-xs font-bold" style={{ color: liftsGoalMet ? '#00FF94' : '#FF453A' }}>
                {liftsGoalMet ? '✓' : '✗'}
              </span>
            </div>
            <div className="p-3 rounded-xl flex items-center justify-between" style={{ 
              backgroundColor: runsGoalMet ? 'rgba(255,149,0,0.1)' : 'rgba(255,255,255,0.05)',
              border: runsGoalMet ? '1px solid rgba(255,149,0,0.2)' : 'none'
            }}>
              <div>
                <span className="text-xs">🏃 Runs</span>
                <div className="text-[10px] text-gray-500">{goals.runsPerWeek}+ per week</div>
              </div>
              <span className="text-xs font-bold" style={{ color: runsGoalMet ? '#FF9500' : '#FF453A' }}>
                {runsGoalMet ? '✓' : '✗'}
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

        {/* Lifts Section */}
        {lifts.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-300">🏋️ Lifts</span>
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

        {/* Runs Section */}
        {runs.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-300">🏃 Runs</span>
              </div>
              {weekData?.runBreakdown && (
                <div className="flex gap-1">
                  {Object.entries(weekData.runBreakdown).map(([type, count]) => (
                    <span key={type} className="px-2 py-0.5 rounded-full text-[10px]" style={{ backgroundColor: 'rgba(255,149,0,0.1)', color: '#FF9500' }}>
                      {count} {type}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              {runs.map((activity, i) => (
                <div key={i} className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,149,0,0.05)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-medium text-sm">{activity.subtype}</div>
                    <div className="text-xs text-gray-500">{activity.date}</div>
                  </div>
                  <div className="flex gap-4 text-xs text-gray-400">
                    <span>{activity.distance} mi</span>
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
  );
};

// Onboarding Survey
const OnboardingSurvey = ({ onComplete }) => {
  const [goals, setGoals] = useState({
    liftsPerWeek: 3,
    runsPerWeek: 2,
    recoveryPerWeek: 2,
    stepsPerDay: 10000
  });

  const questions = [
    { title: "Lifts per week", key: 'liftsPerWeek', options: [2, 3, 4, 5, 6] },
    { title: "Runs per week", key: 'runsPerWeek', options: [0, 1, 2, 3, 4, 5] },
    { title: "Recovery sessions", key: 'recoveryPerWeek', options: [1, 2, 3, 4] },
    { title: "Daily step goal", key: 'stepsPerDay', options: [6000, 8000, 10000, 12000, 15000], isSteps: true }
  ];

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <div className="p-6 pt-12">
        <h1 className="text-3xl font-black tracking-tight mb-1">STREAKD</h1>
        <p className="text-sm mb-4" style={{ color: '#00FF94' }}>Win the week.</p>
        <h2 className="text-xl font-bold mb-2">Set Your Goals</h2>
        <p className="text-gray-500 text-sm">Be realistic. Consistency beats intensity.</p>
      </div>

      <div className="flex-1 px-6 py-4 space-y-6 overflow-auto pb-32">
        {questions.map((q) => (
          <div key={q.key}>
            <label className="text-sm font-semibold mb-3 block">{q.title}</label>
            <div className="flex gap-2">
              {q.options.map((option) => (
                <button
                  key={option}
                  onClick={() => setGoals({ ...goals, [q.key]: option })}
                  className="flex-1 py-3 rounded-xl text-center transition-all duration-200 border-2"
                  style={{
                    backgroundColor: goals[q.key] === option ? 'rgba(0,255,148,0.15)' : 'rgba(255,255,255,0.05)',
                    borderColor: goals[q.key] === option ? '#00FF94' : 'transparent'
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
          className="w-full py-4 rounded-xl font-bold text-black text-lg transition-all duration-200 active:scale-98"
          style={{ backgroundColor: '#00FF94' }}
        >
          Start Streakd
        </button>
      </div>
    </div>
  );
};

// Duration Picker Component
const DurationPicker = ({ hours, minutes, onChange, disabled = false }) => {
  const hourOptions = Array.from({ length: 6 }, (_, i) => i);
  const minuteOptions = Array.from({ length: 12 }, (_, i) => i * 5);
  
  return (
    <div className="flex gap-2">
      <div className="flex-1">
        <label className="text-xs text-gray-500 mb-1 block">Hours</label>
        <select
          value={hours}
          onChange={(e) => onChange(parseInt(e.target.value), minutes)}
          disabled={disabled}
          className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-white appearance-none"
          style={{ opacity: disabled ? 0.5 : 1 }}
        >
          {hourOptions.map((h) => (
            <option key={h} value={h} className="bg-black">{h}h</option>
          ))}
        </select>
      </div>
      <div className="flex-1">
        <label className="text-xs text-gray-500 mb-1 block">Minutes</label>
        <select
          value={minutes}
          onChange={(e) => onChange(hours, parseInt(e.target.value))}
          disabled={disabled}
          className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-white appearance-none"
          style={{ opacity: disabled ? 0.5 : 1 }}
        >
          {minuteOptions.map((m) => (
            <option key={m} value={m} className="bg-black">{m}m</option>
          ))}
        </select>
      </div>
    </div>
  );
};

// Add Activity Modal
const AddActivityModal = ({ isOpen, onClose, onSave, pendingActivity = null }) => {
  const [activityType, setActivityType] = useState(pendingActivity?.type || null);
  const [subtype, setSubtype] = useState(pendingActivity?.subtype || '');
  const [customSport, setCustomSport] = useState('');
  const [saveCustomSport, setSaveCustomSport] = useState(false);
  const [date, setDate] = useState(pendingActivity?.date || '2026-01-21');
  const [notes, setNotes] = useState('');
  const [distance, setDistance] = useState('');
  const [durationHours, setDurationHours] = useState(pendingActivity?.durationHours || 0);
  const [durationMinutes, setDurationMinutes] = useState(pendingActivity?.durationMinutes || 0);

  const activityTypes = [
    { name: 'Lifting', icon: '🏋️', subtypes: ['Upper', 'Lower', 'Legs', 'Chest', 'Back', 'Shoulders', 'Arms', 'Full Body'] },
    { name: 'Running', icon: '🏃', subtypes: ['Easy', 'Tempo', 'Long', 'Sprints', 'Recovery'] },
    { name: 'Cycle', icon: '🚴', subtypes: ['Road', 'Spin', 'Mountain'] },
    { name: 'Sports', icon: '⚽', subtypes: ['Basketball', 'Soccer', 'Tennis', 'Golf', 'Pickleball', 'Other'] },
    { name: 'Yoga', icon: '🧘', subtypes: ['Vinyasa', 'Hot', 'Restorative', 'Power'] },
    { name: 'Cold Plunge', icon: '🧊', subtypes: [] },
    { name: 'Sauna', icon: '🔥', subtypes: [] },
    { name: 'Other', icon: '💪', subtypes: [] }
  ];

  const selectedType = activityTypes.find(t => t.name === activityType);
  const showCustomSportInput = activityType === 'Sports' && subtype === 'Other';

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/95 z-50 flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <button onClick={onClose} className="text-gray-400 text-sm">Cancel</button>
        <h2 className="font-bold">Log Activity</h2>
        <button 
          onClick={() => {
            onSave({ 
              type: activityType, 
              subtype: showCustomSportInput ? customSport : subtype, 
              date, 
              notes, 
              distance, 
              duration: durationHours * 60 + durationMinutes,
              saveCustomSport 
            });
            onClose();
          }}
          className="font-bold"
          style={{ color: '#00FF94' }}
          disabled={!activityType || (showCustomSportInput && !customSport)}
        >
          Save
        </button>
      </div>

      {pendingActivity && (
        <div className="mx-4 mt-4 p-3 rounded-xl" style={{ backgroundColor: 'rgba(0,255,148,0.1)', border: '1px solid rgba(0,255,148,0.3)' }}>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-lg">📱</span>
            <span style={{ color: '#00FF94' }}>Synced from {pendingActivity.source}</span>
          </div>
          <div className="flex gap-4 mt-2 text-xs text-gray-400">
            <span>{pendingActivity.calories} cal</span>
            <span>{pendingActivity.duration} min</span>
            <span>Avg HR: {pendingActivity.avgHr}</span>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto p-4 pb-32">
        {!activityType ? (
          <div className="grid grid-cols-2 gap-3">
            {activityTypes.map((type) => (
              <button
                key={type.name}
                onClick={() => setActivityType(type.name)}
                className="p-4 rounded-xl text-left transition-all duration-200 active:scale-98"
                style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
              >
                <span className="text-2xl">{type.icon}</span>
                <div className="mt-2 font-semibold">{type.name}</div>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            <button 
              onClick={() => {
                setActivityType(null);
                setSubtype('');
                setCustomSport('');
              }}
              className="flex items-center gap-3 p-3 rounded-xl w-full"
              style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
            >
              <span className="text-2xl">{selectedType?.icon}</span>
              <span className="font-semibold">{activityType}</span>
              <span className="ml-auto text-gray-500 text-sm">Change</span>
            </button>

            {selectedType?.subtypes.length > 0 && (
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

            {activityType === 'Running' && (
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
                Duration {pendingActivity && <span style={{ color: '#00FF94' }}>(synced)</span>}
              </label>
              <DurationPicker 
                hours={durationHours}
                minutes={durationMinutes}
                onChange={(h, m) => {
                  setDurationHours(h);
                  setDurationMinutes(m);
                }}
                disabled={!!pendingActivity}
              />
            </div>

            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-white"
              />
            </div>

            {pendingActivity && (
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">Synced Metrics</label>
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    <div className="text-xs text-gray-500">Calories</div>
                    <div className="font-bold">{pendingActivity.calories}</div>
                  </div>
                  <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    <div className="text-xs text-gray-500">Avg HR</div>
                    <div className="font-bold">{pendingActivity.avgHr}</div>
                  </div>
                  <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    <div className="text-xs text-gray-500">Max HR</div>
                    <div className="font-bold">{pendingActivity.maxHr}</div>
                  </div>
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
          </div>
        )}
      </div>
    </div>
  );
};

// Home Tab - Simplified
const HomeTab = ({ onAddActivity, pendingSync }) => {
  const [showWorkoutNotification, setShowWorkoutNotification] = useState(true);
  const [maintenanceCardIndex, setMaintenanceCardIndex] = useState(0);
  const weekProgress = mockWeeklyProgress;
  const whoop = mockWhoopData;

  const liftsPercent = (weekProgress.lifts.completed / weekProgress.lifts.goal) * 100;
  const runsPercent = (weekProgress.runs.completed / weekProgress.runs.goal) * 100;
  const recoveryPercent = (weekProgress.recovery.completed / weekProgress.recovery.goal) * 100;
  const caloriesPercent = (weekProgress.calories.burned / weekProgress.calories.goal) * 100;
  const stepsPercent = (weekProgress.steps.today / weekProgress.steps.goal) * 100;

  const daysLeft = 4;
  const liftsRemaining = weekProgress.lifts.goal - weekProgress.lifts.completed;
  const runsRemaining = weekProgress.runs.goal - weekProgress.runs.completed;
  const recoveryRemaining = weekProgress.recovery.goal - weekProgress.recovery.completed;

  // Calculate overall weekly progress
  const totalGoals = weekProgress.lifts.goal + weekProgress.runs.goal + weekProgress.recovery.goal;
  const totalCompleted = weekProgress.lifts.completed + weekProgress.runs.completed + weekProgress.recovery.completed;
  const overallPercent = Math.round((totalCompleted / totalGoals) * 100);

  // Handle swipe for maintenance card
  const handleMaintenanceSwipe = (direction) => {
    if (direction === 'left' && maintenanceCardIndex === 0) {
      setMaintenanceCardIndex(1);
    } else if (direction === 'right' && maintenanceCardIndex === 1) {
      setMaintenanceCardIndex(0);
    }
  };

  return (
    <div className="pb-32">
      {/* Daily Maintenance Section - Swipeable */}
      <div className="px-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">Daily Maintenance</span>
              <span>⛽</span>
            </div>
            <p className="text-[11px] text-gray-500 mt-0.5">{maintenanceCardIndex === 0 ? 'Your daily vitals and readiness' : 'Whoop recovery metrics'}</p>
          </div>
          {/* Card indicators */}
          <div className="flex gap-1.5">
            <div 
              className="w-1.5 h-1.5 rounded-full transition-all cursor-pointer"
              style={{ backgroundColor: maintenanceCardIndex === 0 ? '#00FF94' : 'rgba(255,255,255,0.3)' }}
              onClick={() => setMaintenanceCardIndex(0)}
            />
            <div 
              className="w-1.5 h-1.5 rounded-full transition-all cursor-pointer"
              style={{ backgroundColor: maintenanceCardIndex === 1 ? '#00FF94' : 'rgba(255,255,255,0.3)' }}
              onClick={() => setMaintenanceCardIndex(1)}
            />
          </div>
        </div>
        
        {/* Swipeable Card Container */}
        <div 
          className="relative overflow-hidden rounded-2xl"
          onTouchStart={(e) => {
            e.currentTarget.touchStartX = e.touches[0].clientX;
          }}
          onTouchEnd={(e) => {
            const diff = e.currentTarget.touchStartX - e.changedTouches[0].clientX;
            if (Math.abs(diff) > 50) {
              handleMaintenanceSwipe(diff > 0 ? 'left' : 'right');
            }
          }}
          onWheel={(e) => {
            // Two-finger swipe on trackpad (deltaX for horizontal scroll)
            if (Math.abs(e.deltaX) > 30) {
              handleMaintenanceSwipe(e.deltaX > 0 ? 'left' : 'right');
            }
          }}
        >
          <div 
            className="flex transition-transform duration-300 ease-out"
            style={{ transform: `translateX(-${maintenanceCardIndex * 100}%)` }}
          >
            {/* Card 1: Daily Vitals */}
            <div className="w-full flex-shrink-0 p-4 space-y-3" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
              {/* Steps */}
              <div className="flex items-center gap-3">
                <span className="text-lg">👟</span>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-400">Steps</span>
                    <span className="text-xs font-bold">{weekProgress.steps.today.toLocaleString()} / {(weekProgress.steps.goal/1000).toFixed(0)}k</span>
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
                    <span className="text-xs text-gray-400">Calories Burned</span>
                    <span className="text-xs font-bold">{weekProgress.calories.burned.toLocaleString()} / {(weekProgress.calories.goal/1000).toFixed(1)}k</span>
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
              
              {/* Recovery Score */}
              <div className="flex items-center gap-3">
                <span className="text-lg">💚</span>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-400">Recovery Score</span>
                    <span className="text-xs font-bold" style={{ color: whoop.recovery > 66 ? '#00FF94' : whoop.recovery > 33 ? '#FFD60A' : '#FF453A' }}>
                      {whoop.recovery}% {whoop.recovery > 66 ? 'Ready' : whoop.recovery > 33 ? 'Moderate' : 'Rest'}
                    </span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>
                    <div 
                      className="h-full rounded-full transition-all duration-1000"
                      style={{ 
                        width: `${whoop.recovery}%`,
                        backgroundColor: whoop.recovery > 66 ? '#00FF94' : whoop.recovery > 33 ? '#FFD60A' : '#FF453A'
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Card 2: Whoop Metrics - Same height as Card 1 */}
            <div className="w-full flex-shrink-0 p-4 space-y-3" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
              {/* Sleep */}
              <div className="flex items-center gap-3">
                <span className="text-lg">😴</span>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-400">Sleep Performance</span>
                    <span className="text-xs font-bold" style={{ color: '#007AFF' }}>{whoop.sleep}%</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>
                    <div className="h-full rounded-full" style={{ width: `${whoop.sleep}%`, backgroundColor: '#007AFF' }} />
                  </div>
                </div>
              </div>
              
              {/* Strain */}
              <div className="flex items-center gap-3">
                <span className="text-lg">⚡</span>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-400">Day Strain</span>
                    <span className="text-xs font-bold" style={{ color: '#FF9500' }}>{whoop.strain} / 21</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>
                    <div className="h-full rounded-full" style={{ width: `${(whoop.strain / 21) * 100}%`, backgroundColor: '#FF9500' }} />
                  </div>
                </div>
              </div>
              
              {/* HRV & RHR Row */}
              <div className="flex items-center gap-3">
                <span className="text-lg">💓</span>
                <div className="flex-1 flex items-center gap-6">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-400">HRV</span>
                    <span className="text-xs font-bold" style={{ color: '#00FF94' }}>{whoop.hrv} ms</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-400">RHR</span>
                    <span className="text-xs font-bold" style={{ color: '#FF453A' }}>52 bpm</span>
                  </div>
                </div>
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
            className="w-full p-3 rounded-xl flex items-center gap-3"
            style={{ backgroundColor: 'rgba(0,255,148,0.1)', border: '1px solid rgba(0,255,148,0.3)' }}
          >
            <span className="text-lg">📱</span>
            <div className="flex-1 text-left">
              <div className="text-xs font-semibold" style={{ color: '#00FF94' }}>New workout detected</div>
              <div className="text-[10px] text-gray-400">{pendingSync[0].type} • {pendingSync[0].duration} min • from {pendingSync[0].source}</div>
            </div>
            <span className="px-3 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: 'rgba(0,255,148,0.2)', color: '#00FF94' }}>
              Add
            </span>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setShowWorkoutNotification(false);
              }}
              className="w-6 h-6 rounded-full flex items-center justify-center"
              style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
            >
              <span className="text-gray-400 text-xs">✕</span>
            </button>
          </button>
        </div>
      )}

      {/* Weekly Goals - Hero Section */}
      <div className="mx-4 mb-4">
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
            {/* Lifts */}
            <div className="text-center">
              <div className="relative inline-block">
                <ProgressRing progress={liftsPercent} size={72} strokeWidth={6} color="#00FF94" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xl font-black">{weekProgress.lifts.completed}/{weekProgress.lifts.goal}</span>
                </div>
              </div>
              <div className="text-sm font-medium mt-2">🏋️ Lifts</div>
            </div>
            
            {/* Runs */}
            <div className="text-center">
              <div className="relative inline-block">
                <ProgressRing progress={runsPercent} size={72} strokeWidth={6} color="#FF9500" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xl font-black">{weekProgress.runs.completed}/{weekProgress.runs.goal}</span>
                </div>
              </div>
              <div className="text-sm font-medium mt-2">🏃 Runs</div>
            </div>
            
            {/* Recovery */}
            <div className="text-center">
              <div className="relative inline-block">
                <ProgressRing progress={recoveryPercent} size={72} strokeWidth={6} color="#00D1FF" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xl font-black">{weekProgress.recovery.completed}/{weekProgress.recovery.goal}</span>
                </div>
              </div>
              <div className="text-sm font-medium mt-2">🧊 Recovery</div>
            </div>
          </div>
          
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
        {(liftsRemaining > 0 || runsRemaining > 0 || recoveryRemaining > 0) && (
          <div className="mt-3 p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
            <div className="text-xs text-gray-500 mb-2">Remaining:</div>
            <div className="flex gap-2 flex-wrap">
              {liftsRemaining > 0 && (
                <span className="px-2 py-1 rounded-full text-xs" style={{ backgroundColor: 'rgba(0,255,148,0.1)', color: '#00FF94' }}>
                  {liftsRemaining} lift{liftsRemaining > 1 ? 's' : ''}
                </span>
              )}
              {runsRemaining > 0 && (
                <span className="px-2 py-1 rounded-full text-xs" style={{ backgroundColor: 'rgba(255,149,0,0.1)', color: '#FF9500' }}>
                  {runsRemaining} run{runsRemaining > 1 ? 's' : ''}
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
        <div className="space-y-2">
          {mockActivities.slice(0, 3).map((activity) => (
            <div key={activity.id} className="p-3 rounded-xl flex items-center gap-3" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
              <ActivityIcon type={activity.type} size={20} />
              <div className="flex-1">
                <div className="text-sm font-semibold">{activity.type}{activity.subtype ? ` • ${activity.subtype}` : ''}</div>
                <div className="text-[10px] text-gray-500">{activity.date} at {activity.time}</div>
              </div>
              <div className="text-right">
                {activity.calories && <div className="text-sm font-bold">{activity.calories} cal</div>}
                {activity.distance && <div className="text-sm font-bold">{activity.distance} mi</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// History Tab
const HistoryTab = ({ onShare }) => {
  const [view, setView] = useState('calendar');
  const [calendarView, setCalendarView] = useState('heatmap');
  const [selectedDate, setSelectedDate] = useState('2026-01-20');
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [showWeekStats, setShowWeekStats] = useState(false);
  const [showDayModal, setShowDayModal] = useState(false);
  const [compareWeek, setCompareWeek] = useState('average');
  const [totalsView, setTotalsView] = useState('2026');
  const records = mockPersonalRecords;
  const streaks = mockUserData.streaks;
  const goals = mockUserData.goals;

  const weeks = [
    { id: 'week-3', label: 'Jan 6-12', dates: [6,7,8,9,10,11,12], startDay: 6, endDay: 12 },
    { id: 'week-2', label: 'Jan 13-19', dates: [13,14,15,16,17,18,19], startDay: 13, endDay: 19 },
    { id: 'week-1', label: 'Jan 20-26', dates: [20,21,22,23,24,25,26], startDay: 20, endDay: 26, isCurrent: true }
  ];

  const generateCalendarDays = () => {
    const days = [];
    for (let i = 1; i <= 31; i++) {
      const dateStr = `2026-01-${i.toString().padStart(2, '0')}`;
      days.push({
        day: i,
        date: dateStr,
        activities: mockCalendarData[dateStr] || [],
        isToday: i === 21,
        isFuture: i > 21
      });
    }
    return days;
  };

  const calendarDays = generateCalendarDays();
  const currentWeekStats = { workouts: 4, recovery: 1, calories: 2100, steps: 52000, miles: 4.2, goalsMet: false };

  const getTotalsData = () => {
    if (totalsView === '2026') {
      return {
        workouts: records.totalWorkouts2026,
        recovery: records.totalRecovery2026,
        miles: records.totalMiles2026,
        lifting: mockLiftingBreakdown['2026'],
        running: mockRunningBreakdown['2026'],
        recoveryBreakdown: mockRecoveryBreakdown['2026']
      };
    }
    return {
      workouts: records.totalWorkoutsAllTime,
      recovery: records.totalRecoveryAllTime,
      miles: records.totalMilesAllTime,
      lifting: mockLiftingBreakdown['all-time'],
      running: mockRunningBreakdown['all-time'],
      recoveryBreakdown: mockRecoveryBreakdown['all-time']
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
            className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
            style={{ backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <span>📤</span>
            <span>Share Streaks</span>
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
          {/* Lifts Streak */}
          <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(0,255,148,0.1)', border: '1px solid rgba(0,255,148,0.2)' }}>
            <div className="text-2xl font-black" style={{ color: '#00FF94' }}>🏋️ {streaks.lifts} Weeks</div>
            <div className="text-sm text-gray-300 mt-1">Lifts</div>
            <div className="text-[10px] text-gray-500 mt-1">{goals.liftsPerWeek}+ per week</div>
          </div>
          
          {/* Runs Streak */}
          <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,149,0,0.1)', border: '1px solid rgba(255,149,0,0.2)' }}>
            <div className="text-2xl font-black" style={{ color: '#FF9500' }}>🏃 {streaks.runs} Weeks</div>
            <div className="text-sm text-gray-300 mt-1">Runs</div>
            <div className="text-[10px] text-gray-500 mt-1">{goals.runsPerWeek}+ per week</div>
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
      <div className="mx-4 mb-4 flex gap-2 p-1 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
        {[
          { key: 'calendar', label: 'Calendar' },
          { key: 'records', label: 'My Records' },
          { key: 'totals', label: 'Stats' }
        ].map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className="flex-1 py-2 rounded-lg text-sm font-medium transition-all duration-200"
            style={{ 
              backgroundColor: view === v.key ? 'rgba(255,255,255,0.1)' : 'transparent',
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
          
          <div className="text-lg font-bold mb-3">January 2026</div>
          
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
                    if (mockCalendarData[day.date]?.length > 0) {
                      setShowDayModal(true);
                    }
                  }}
                  className="flex-1 aspect-square rounded-md flex flex-col items-center justify-center relative transition-all duration-200"
                  style={{
                    backgroundColor: selectedDate === day.date ? 'rgba(0,255,148,0.2)' : 
                                     day.activities.length > 0 ? 'rgba(255,255,255,0.05)' : 'transparent',
                    border: day.isToday ? '2px solid #00FF94' : 'none',
                    opacity: day.isFuture ? 0.3 : 1
                  }}
                >
                  <span className={`text-[11px] ${day.activities.length > 0 ? 'font-bold' : 'text-gray-500'}`}>
                    {day.day}
                  </span>
                  {day.activities.length > 0 && (
                    <div className="flex gap-0.5 mt-0.5">
                      {day.activities.slice(0, 2).map((a, i) => (
                        <div key={i} className="w-1 h-1 rounded-full"
                          style={{ backgroundColor: a.type === 'Lifting' ? '#00FF94' : a.type === 'Running' ? '#FF9500' : '#00D1FF' }}
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
                  className="w-8 h-8 rounded-md flex items-center justify-center text-[10px]"
                  style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                >
                  📊
                </button>
                {calendarDays.slice(week.startDay - 1, week.endDay).map((day) => (
                  <button
                    key={day.day}
                    onClick={() => {
                      setSelectedDate(day.date);
                      if (mockCalendarData[day.date]?.length > 0) {
                        setShowDayModal(true);
                      }
                    }}
                    className="flex-1 aspect-square rounded-md flex flex-col items-center justify-center relative transition-all duration-200"
                    style={{
                      backgroundColor: selectedDate === day.date ? 'rgba(0,255,148,0.2)' : 
                                       day.activities.length > 0 ? 'rgba(255,255,255,0.05)' : 'transparent',
                      border: day.isToday ? '2px solid #00FF94' : 'none',
                      opacity: day.isFuture ? 0.3 : 1
                    }}
                  >
                    <span className={`text-[11px] ${day.activities.length > 0 ? 'font-bold' : 'text-gray-500'}`}>
                      {day.day}
                    </span>
                    {day.activities.length > 0 && (
                      <div className="flex gap-0.5 mt-0.5">
                        {day.activities.slice(0, 2).map((a, i) => (
                          <div key={i} className="w-1 h-1 rounded-full"
                            style={{ backgroundColor: a.type === 'Lifting' ? '#00FF94' : a.type === 'Running' ? '#FF9500' : '#00D1FF' }}
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
                    if (mockCalendarData[day.date]?.length > 0) {
                      setShowDayModal(true);
                    }
                  }}
                  className="flex-1 aspect-square rounded-md flex flex-col items-center justify-center relative transition-all duration-200"
                  style={{
                    backgroundColor: selectedDate === day.date ? 'rgba(0,255,148,0.2)' : 
                                     day.activities.length > 0 ? 'rgba(255,255,255,0.05)' : 'transparent',
                    opacity: day.isFuture ? 0.3 : 1
                  }}
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
            <div className="flex p-1 rounded-lg mb-4" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
              <button
                onClick={() => setCompareWeek('average')}
                className="flex-1 py-2 rounded-md text-xs font-medium transition-all"
                style={{ 
                  backgroundColor: compareWeek === 'average' ? 'rgba(255,255,255,0.1)' : 'transparent',
                  color: compareWeek === 'average' ? 'white' : 'rgba(255,255,255,0.5)'
                }}
              >
                vs Average
              </button>
              <button
                onClick={() => setCompareWeek('week-2')}
                className="flex-1 py-2 rounded-md text-xs font-medium transition-all"
                style={{ 
                  backgroundColor: compareWeek === 'week-2' ? 'rgba(255,255,255,0.1)' : 'transparent',
                  color: compareWeek === 'week-2' ? 'white' : 'rgba(255,255,255,0.5)'
                }}
              >
                vs Last Week
              </button>
            </div>
            
            {/* This Week Stats - With comparison arrows */}
            <div className="p-4 rounded-2xl mb-2" style={{ backgroundColor: 'rgba(0,255,148,0.1)', border: '1px solid rgba(0,255,148,0.2)' }}>
              <div className="text-xs text-gray-400 mb-3">This Week (Jan 20-26)</div>
              <div className="grid grid-cols-5 gap-2 text-center">
                <div>
                  <div className="text-lg font-black" style={{ color: '#00FF94' }}>2</div>
                  <div className="text-[10px] text-gray-400">🏋️ Lifts</div>
                  <div className="text-[10px] mt-1" style={{ color: 2 >= (compareWeek === 'average' ? 3 : mockWeeklyStats['week-2']?.lifts || 0) ? '#00FF94' : '#FF453A' }}>
                    {2 >= (compareWeek === 'average' ? 3 : mockWeeklyStats['week-2']?.lifts || 0) ? '↑' : '↓'}
                  </div>
                </div>
                <div>
                  <div className="text-lg font-black" style={{ color: '#FF9500' }}>1</div>
                  <div className="text-[10px] text-gray-400">🏃 Runs</div>
                  <div className="text-[10px] mt-1" style={{ color: 1 >= (compareWeek === 'average' ? 2 : mockWeeklyStats['week-2']?.runs || 0) ? '#00FF94' : '#FF453A' }}>
                    {1 >= (compareWeek === 'average' ? 2 : mockWeeklyStats['week-2']?.runs || 0) ? '↑' : '↓'}
                  </div>
                </div>
                <div>
                  <div className="text-lg font-black" style={{ color: '#00D1FF' }}>{currentWeekStats.recovery}</div>
                  <div className="text-[10px] text-gray-400">🧊 Recovery</div>
                  <div className="text-[10px] mt-1" style={{ color: currentWeekStats.recovery >= (compareWeek === 'average' ? 2 : mockWeeklyStats['week-2']?.recovery || 0) ? '#00FF94' : '#FF453A' }}>
                    {currentWeekStats.recovery >= (compareWeek === 'average' ? 2 : mockWeeklyStats['week-2']?.recovery || 0) ? '↑' : '↓'}
                  </div>
                </div>
                <div>
                  <div className="text-lg font-black">{(currentWeekStats.calories/1000).toFixed(1)}k</div>
                  <div className="text-[10px] text-gray-400">🔥 Cals</div>
                  <div className="text-[10px] mt-1" style={{ color: currentWeekStats.calories >= (compareWeek === 'average' ? 3500 : mockWeeklyStats['week-2']?.calories || 0) ? '#00FF94' : '#FF453A' }}>
                    {currentWeekStats.calories >= (compareWeek === 'average' ? 3500 : mockWeeklyStats['week-2']?.calories || 0) ? '↑' : '↓'}
                  </div>
                </div>
                <div>
                  <div className="text-lg font-black">{currentWeekStats.miles}</div>
                  <div className="text-[10px] text-gray-400">📍 Miles</div>
                  <div className="text-[10px] mt-1" style={{ color: currentWeekStats.miles >= (compareWeek === 'average' ? 15 : mockWeeklyStats['week-2']?.miles || 0) ? '#00FF94' : '#FF453A' }}>
                    {currentWeekStats.miles >= (compareWeek === 'average' ? 15 : mockWeeklyStats['week-2']?.miles || 0) ? '↑' : '↓'}
                  </div>
                </div>
              </div>
            </div>

            {/* Comparison Stats - No arrows */}
            <div className="p-4 rounded-2xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
              <div className="text-xs text-gray-400 mb-3">
                {compareWeek === 'average' ? 'Your Average Week' : 'Last Week (Jan 13-19)'}
              </div>
              <div className="grid grid-cols-5 gap-2 text-center">
                <div>
                  <div className="text-lg font-black">{compareWeek === 'average' ? '3' : mockWeeklyStats['week-2']?.lifts || 0}</div>
                  <div className="text-[10px] text-gray-400">🏋️ Lifts</div>
                </div>
                <div>
                  <div className="text-lg font-black">{compareWeek === 'average' ? '2' : mockWeeklyStats['week-2']?.runs || 0}</div>
                  <div className="text-[10px] text-gray-400">🏃 Runs</div>
                </div>
                <div>
                  <div className="text-lg font-black">{compareWeek === 'average' ? '2' : mockWeeklyStats['week-2']?.recovery || 0}</div>
                  <div className="text-[10px] text-gray-400">🧊 Recovery</div>
                </div>
                <div>
                  <div className="text-lg font-black">{compareWeek === 'average' ? '3.5k' : ((mockWeeklyStats['week-2']?.calories || 0)/1000).toFixed(1) + 'k'}</div>
                  <div className="text-[10px] text-gray-400">🔥 Cals</div>
                </div>
                <div>
                  <div className="text-lg font-black">{compareWeek === 'average' ? '15' : mockWeeklyStats['week-2']?.miles || 0}</div>
                  <div className="text-[10px] text-gray-400">📍 Miles</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Day Stats Modal - Full screen like week review */}
      {showDayModal && mockCalendarData[selectedDate] && (() => {
        const dayActivities = mockCalendarData[selectedDate];
        const lifts = dayActivities.filter(a => a.type === 'Lifting');
        const runs = dayActivities.filter(a => a.type === 'Running');
        const recoveryActivities = dayActivities.filter(a => 
          a.type === 'Cold Plunge' || a.type === 'Sauna' || a.type === 'Yoga'
        );
        
        // Format date nicely
        const dateObj = new Date(selectedDate);
        const formattedDate = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        
        // Calculate daily totals (mock data)
        const dayCalories = lifts.length * 380 + runs.length * 320 + recoveryActivities.filter(a => a.type === 'Yoga').length * 120;
        const daySteps = 8500 + Math.floor(Math.random() * 4000); // Mock daily steps
        const dayMiles = runs.length > 0 ? (runs.length * 3.2).toFixed(1) : 0;
        const totalSessions = dayActivities.length;
        
        return (
          <div className="fixed inset-0 bg-black/95 z-50 flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <button onClick={() => setShowDayModal(false)} className="text-gray-400">← Back</button>
              <h2 className="font-bold">{formattedDate}</h2>
              <div className="w-12" />
            </div>
            
            <div className="flex-1 overflow-auto p-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(0,255,148,0.1)' }}>
                  <div className="text-2xl font-black" style={{ color: '#00FF94' }}>{lifts.length}</div>
                  <div className="text-[10px] text-gray-400">🏋️ Lifts</div>
                </div>
                <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(255,149,0,0.1)' }}>
                  <div className="text-2xl font-black" style={{ color: '#FF9500' }}>{runs.length}</div>
                  <div className="text-[10px] text-gray-400">🏃 Runs</div>
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
                    <div className="text-lg font-black">{dayMiles} mi</div>
                    <div className="text-[10px] text-gray-400">Miles Run</div>
                  </div>
                  <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    <div className="text-lg font-black">{daySteps.toLocaleString()}</div>
                    <div className="text-[10px] text-gray-400">Steps Taken</div>
                  </div>
                  <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    <div className="text-lg font-black">{totalSessions}</div>
                    <div className="text-[10px] text-gray-400">Total Sessions</div>
                  </div>
                </div>
              </div>

              {/* Activities Completed Header */}
              <div className="mb-4">
                <div className="text-sm font-semibold text-white">💪 Activities Completed</div>
                <p className="text-[11px] text-gray-500 mt-0.5">All sessions from this day</p>
              </div>

              {/* Lifts Section */}
              {lifts.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-medium text-gray-300">🏋️ Lifts</span>
                  </div>
                  <div className="space-y-2">
                    {lifts.map((activity, i) => {
                      const activityStats = mockActivities.find(a => a.type === 'Lifting') || {};
                      return (
                        <div key={i} className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(0,255,148,0.05)' }}>
                          <div className="font-medium text-sm mb-2">{activity.subtype || 'Lifting'}</div>
                          <div className="flex gap-4 text-xs text-gray-400">
                            <span>{activityStats.duration || 45} min</span>
                            <span>{activityStats.calories || 350} cal</span>
                            <span>♥ {activityStats.avgHr || 120} avg</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Runs Section */}
              {runs.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-medium text-gray-300">🏃 Runs</span>
                  </div>
                  <div className="space-y-2">
                    {runs.map((activity, i) => {
                      const activityStats = mockActivities.find(a => a.type === 'Running') || {};
                      return (
                        <div key={i} className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,149,0,0.05)' }}>
                          <div className="font-medium text-sm mb-2">{activity.subtype || 'Running'}</div>
                          <div className="flex gap-4 text-xs text-gray-400">
                            <span>{activityStats.distance || 3.0} mi</span>
                            <span>{activityStats.duration || 30} min</span>
                            <span>{activityStats.calories || 300} cal</span>
                          </div>
                        </div>
                      );
                    })}
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
                      <div key={i} className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(0,209,255,0.05)' }}>
                        <div className="font-medium text-sm mb-2">{activity.type}</div>
                        <div className="flex gap-4 text-xs text-gray-400">
                          {activity.type === 'Cold Plunge' && (
                            <>
                              <span>5 min</span>
                              <span>45°F</span>
                            </>
                          )}
                          {activity.type === 'Sauna' && (
                            <>
                              <span>20 min</span>
                              <span>180°F</span>
                            </>
                          )}
                          {activity.type === 'Yoga' && (
                            <>
                              <span>45 min</span>
                              <span>120 cal</span>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Records View */}
      {view === 'records' && (
        <div className="mx-4 mt-2 space-y-6">
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
                  <div className="text-2xl font-black" style={{ color: '#FFD700' }}>{records.longestMasterStreak} weeks</div>
                </div>
                <span className="text-3xl">🏆</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(0,255,148,0.1)', border: '1px solid rgba(0,255,148,0.2)' }}>
                  <div className="text-xs text-gray-400">🏋️ Longest Lifts Streak</div>
                  <div className="text-xl font-black" style={{ color: '#00FF94' }}>{records.longestLiftStreak} weeks</div>
                </div>
                <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,149,0,0.1)', border: '1px solid rgba(255,149,0,0.2)' }}>
                  <div className="text-xs text-gray-400">🏃 Longest Runs Streak</div>
                  <div className="text-xl font-black" style={{ color: '#FF9500' }}>{records.longestWorkoutStreak} weeks</div>
                </div>
                <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(0,209,255,0.1)', border: '1px solid rgba(0,209,255,0.2)' }}>
                  <div className="text-xs text-gray-400">🧊 Longest Recovery Streak</div>
                  <div className="text-xl font-black" style={{ color: '#00D1FF' }}>{records.longestRecoveryStreak} weeks</div>
                </div>
                <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(191,90,242,0.1)', border: '1px solid rgba(191,90,242,0.2)' }}>
                  <div className="text-xs text-gray-400">👟 Longest Steps Streak</div>
                  <div className="text-xl font-black" style={{ color: '#BF5AF2' }}>12 weeks</div>
                </div>
              </div>
            </div>
          </div>

          {/* Activities Section */}
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">💪 Activity Records</div>
            <div className="space-y-2">
              {/* Lifting */}
              <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(0,255,148,0.05)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <span>🏋️</span>
                  <span className="text-xs text-gray-400 uppercase tracking-wider">Lifting</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] text-gray-500">Most Lifts (Week)</div>
                    <div className="text-lg font-black">{records.mostLiftsWeek}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-500">Most Calories (Single)</div>
                    <div className="text-lg font-black">{records.highestLiftCalories}</div>
                  </div>
                </div>
              </div>
              
              {/* Running */}
              <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,149,0,0.05)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <span>🏃</span>
                  <span className="text-xs text-gray-400 uppercase tracking-wider">Running</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] text-gray-500">Fastest Mile</div>
                    <div className="text-lg font-black" style={{ color: '#FF9500' }}>{records.fastestMile}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-500">Longest Run</div>
                    <div className="text-lg font-black">{records.longestRun} mi</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-500">Most Miles (Week)</div>
                    <div className="text-lg font-black">{records.mostMilesWeek} mi</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-500">Most Runs (Week)</div>
                    <div className="text-lg font-black">{records.mostRunsWeek}</div>
                  </div>
                </div>
              </div>
              
              {/* Recovery */}
              <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(0,209,255,0.05)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <span>🧊</span>
                  <span className="text-xs text-gray-400 uppercase tracking-wider">Recovery</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] text-gray-500">Most Sessions (Week)</div>
                    <div className="text-lg font-black" style={{ color: '#00D1FF' }}>{records.mostRecoveryWeek}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-500">Longest Cold Plunge</div>
                    <div className="text-lg font-black">{records.longestColdPlunge} min</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-500">Coldest Plunge</div>
                    <div className="text-lg font-black">{records.coldestPlunge}°F</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-500">Longest Sauna</div>
                    <div className="text-lg font-black">{records.mostSaunaMinutes} min</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Daily Bests Section */}
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">📈 Daily Bests</div>
            <div className="space-y-2">
              {/* Steps */}
              <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(191,90,242,0.05)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <span>👟</span>
                  <span className="text-xs text-gray-400 uppercase tracking-wider">Steps</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] text-gray-500">Most Steps (Day)</div>
                    <div className="text-lg font-black" style={{ color: '#BF5AF2' }}>{records.mostStepsDay.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-500">Most Steps (Week)</div>
                    <div className="text-lg font-black">{records.mostStepsWeek.toLocaleString()}</div>
                  </div>
                </div>
              </div>
              
              {/* Calories */}
              <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <span>🔥</span>
                  <span className="text-xs text-gray-400 uppercase tracking-wider">Calories Burned</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] text-gray-500">Most Burned (Day)</div>
                    <div className="text-lg font-black">{records.mostCaloriesDay.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-500">Most Burned (Week)</div>
                    <div className="text-lg font-black">{records.mostCaloriesWeek.toLocaleString()}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Totals View */}
      {view === 'totals' && (
        <div className="mx-4 mt-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-sm font-semibold text-white">Your Stats</div>
              <p className="text-[11px] text-gray-500 mt-0.5">Your totals over time</p>
            </div>
            <select
              value={totalsView}
              onChange={(e) => setTotalsView(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs"
            >
              <option value="2026" className="bg-black">2026</option>
              <option value="all-time" className="bg-black">All-Time</option>
            </select>
          </div>
          
          {/* Main Stats Grid */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="p-4 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(0,255,148,0.2) 0%, rgba(0,255,148,0.05) 100%)' }}>
              <div className="text-4xl font-black" style={{ color: '#00FF94' }}>{totalsData.lifting?.Upper + totalsData.lifting?.Lower + totalsData.lifting?.Legs + totalsData.lifting?.Chest || 12}</div>
              <div className="text-sm text-gray-400">🏋️ Lifts</div>
            </div>
            <div className="p-4 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(255,149,0,0.2) 0%, rgba(255,149,0,0.05) 100%)' }}>
              <div className="text-4xl font-black" style={{ color: '#FF9500' }}>{totalsData.running?.Easy + totalsData.running?.Long + totalsData.running?.Tempo || 8}</div>
              <div className="text-sm text-gray-400">🏃 Runs</div>
            </div>
            <div className="p-4 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(0,209,255,0.2) 0%, rgba(0,209,255,0.05) 100%)' }}>
              <div className="text-4xl font-black" style={{ color: '#00D1FF' }}>{totalsData.recovery}</div>
              <div className="text-sm text-gray-400">🧊 Recovery</div>
            </div>
            <div className="p-4 rounded-2xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
              <div className="text-4xl font-black">{totalsData.miles}</div>
              <div className="text-sm text-gray-400">📍 Miles Run</div>
            </div>
          </div>

          {/* Lifting Breakdown */}
          <div className="mb-6">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">🏋️ Lifting Breakdown</div>
            <div className="p-4 rounded-2xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
              <div className="space-y-2">
                {Object.entries(totalsData.lifting).map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between">
                    <span className="text-gray-400">{type}</span>
                    <span className="font-bold">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Running Breakdown */}
          <div className="mb-6">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">🏃 Running Breakdown</div>
            <div className="p-4 rounded-2xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
              <div className="space-y-2">
                {Object.entries(totalsData.running).map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between">
                    <span className="text-gray-400">{type}</span>
                    <span className="font-bold">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Recovery Breakdown */}
          <div className="mb-6">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">🧊 Recovery Breakdown</div>
            <div className="space-y-2">
              {Object.entries(totalsData.recoveryBreakdown).map(([type, count]) => (
                <div key={type} className="p-3 rounded-xl flex items-center justify-between" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{type === 'Cold Plunge' ? '🧊' : type === 'Sauna' ? '🔥' : '🧘'}</span>
                    <span>{type}</span>
                  </div>
                  <span className="font-bold">{count}</span>
                </div>
              ))}
            </div>
          </div>

          {totalsView === '2026' && (
            <>
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">January Highlights</div>
              <div className="p-4 rounded-2xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Best Week</span>
                    <span className="font-bold">Week 2 (5 workouts)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Most Consistent</span>
                    <span className="font-bold">Lifting</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Longest Run</span>
                    <span className="font-bold">6.2 mi (Jan 12)</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Week Stats Modal */}
      <WeekStatsModal 
        isOpen={showWeekStats}
        onClose={() => setShowWeekStats(false)}
        weekData={selectedWeek ? mockWeeklyStats[selectedWeek.id] : null}
        weekLabel={selectedWeek?.label || ''}
      />
    </div>
  );
};

// Main App
export default function StreakdApp() {
  const [isOnboarded, setIsOnboarded] = useState(true);
  const [activeTab, setActiveTab] = useState('home');
  const [showAddActivity, setShowAddActivity] = useState(false);
  const [pendingActivity, setPendingActivity] = useState(null);
  const [showShare, setShowShare] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [celebrationMessage, setCelebrationMessage] = useState('');

  const handleAddActivity = (pending = null) => {
    setPendingActivity(pending);
    setShowAddActivity(true);
  };

  const handleActivitySaved = (activity) => {
    console.log('Saved:', activity);
    // Trigger celebration for completing a goal (simulated)
    if (activity.type === 'Lifting') {
      setCelebrationMessage('Week Streakd! 🔥');
      setShowCelebration(true);
    }
  };

  if (!isOnboarded) {
    return <OnboardingSurvey onComplete={() => setIsOnboarded(true)} />;
  }

  return (
    <div className="min-h-screen text-white" style={{ 
      backgroundColor: '#0A0A0A',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif'
    }}>
      <div className="h-12" />
      
      <div className="px-4 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight">STREAKD</h1>
          <p className="text-xs text-gray-500">Win the week.</p>
        </div>
        <button 
          onClick={() => setIsOnboarded(false)}
          className="w-10 h-10 rounded-full flex items-center justify-center text-xl"
          style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
        >
          ⚙️
        </button>
      </div>

      <div className="mt-2">
        {activeTab === 'home' && (
          <HomeTab 
            onAddActivity={handleAddActivity} 
            pendingSync={mockPendingSync}
          />
        )}
        {activeTab === 'history' && <HistoryTab onShare={() => setShowShare(true)} />}
      </div>

      <div className="fixed bottom-0 left-0 right-0 px-4 pb-8 pt-4" style={{ background: 'linear-gradient(to top, #0A0A0A 80%, transparent)' }}>
        <div className="flex items-center justify-around p-2 rounded-2xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(20px)' }}>
          <button 
            onClick={() => setActiveTab('home')}
            className="flex-1 py-3 flex flex-col items-center gap-1"
          >
            <span className="text-xl">👤</span>
            <span className={`text-xs ${activeTab === 'home' ? 'text-white' : 'text-gray-500'}`}>Profile</span>
          </button>
          
          <button 
            onClick={() => handleAddActivity()}
            className="w-14 h-14 rounded-full flex items-center justify-center -mt-6 shadow-lg"
            style={{ backgroundColor: '#00FF94' }}
          >
            <span className="text-2xl text-black font-bold">+</span>
          </button>
          
          <button 
            onClick={() => setActiveTab('history')}
            className="flex-1 py-3 flex flex-col items-center gap-1"
          >
            <span className="text-xl">📊</span>
            <span className={`text-xs ${activeTab === 'history' ? 'text-white' : 'text-gray-500'}`}>History</span>
          </button>
        </div>
      </div>

      <AddActivityModal 
        isOpen={showAddActivity}
        onClose={() => {
          setShowAddActivity(false);
          setPendingActivity(null);
        }}
        onSave={handleActivitySaved}
        pendingActivity={pendingActivity}
      />

      <ShareModal 
        isOpen={showShare}
        onClose={() => setShowShare(false)}
        stats={{ streak: 7, workouts: 18 }}
      />

      <CelebrationOverlay 
        show={showCelebration}
        message={celebrationMessage}
        onComplete={() => setShowCelebration(false)}
      />
    </div>
  );
}
