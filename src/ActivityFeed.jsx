import React, { useState, useEffect, useCallback, useRef, useMemo, createContext, useContext } from 'react';
import { getUserActivities, getPersonalRecords, getDailyHealthHistory } from './services/userService';
import { addReaction, getReactions, removeReaction, addComment, getComments, deleteComment, addReply, getReplies, deleteReply, getFriends } from './services/friendService';
import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

// Helper function for haptic feedback
const triggerHaptic = async (style = ImpactStyle.Medium) => {
  try {
    await Haptics.impact({ style });
  } catch (e) {
    // Fallback to vibrate API for web/Android
    if (navigator.vibrate) navigator.vibrate(10);
  }
};

// Helper to determine effective category of an activity (same logic as App.jsx)
const getActivityCategory = (activity) => {
  if (activity.countToward) {
    if (activity.countToward === 'strength') return 'lifting';
    return activity.countToward;
  }
  if (activity.customActivityCategory) {
    if (activity.customActivityCategory === 'strength') return 'lifting';
    return activity.customActivityCategory;
  }
  if (activity.type === 'Strength Training') return 'lifting';
  if (['Running', 'Cycle', 'Sports'].includes(activity.type)) return 'cardio';
  if (['Cold Plunge', 'Sauna', 'Yoga', 'Pilates'].includes(activity.type)) return 'recovery';
  return 'other';
};

// Helper to calculate leaderboard stats from activities and health data
const calculateLeaderboardStats = (activities, healthHistory, personalRecords) => {
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  // Calculate date boundaries
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay()); // Start of week (Sunday)
  weekStart.setHours(0, 0, 0, 0);
  const weekStartStr = weekStart.toISOString().split('T')[0];

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthStartStr = monthStart.toISOString().split('T')[0];

  const yearStart = new Date(now.getFullYear(), 0, 1);
  const yearStartStr = yearStart.toISOString().split('T')[0];

  // Filter activities by time period
  const weekActivities = activities.filter(a => a.date >= weekStartStr);
  const monthActivities = activities.filter(a => a.date >= monthStartStr);
  const yearActivities = activities.filter(a => a.date >= yearStartStr);
  const allActivities = activities;

  // Filter health data by time period
  const weekHealth = healthHistory.filter(h => h.date >= weekStartStr);
  const monthHealth = healthHistory.filter(h => h.date >= monthStartStr);
  const yearHealth = healthHistory.filter(h => h.date >= yearStartStr);
  const allHealth = healthHistory;

  // Helper to calculate stats for a period
  const calcPeriodStats = (periodActivities, periodHealth) => {
    const calories = periodActivities.reduce((sum, a) => sum + (parseInt(a.calories) || 0), 0);
    const steps = periodHealth.reduce((sum, h) => sum + (parseInt(h.steps) || 0), 0);
    return { calories, steps };
  };

  // Helper to calculate volume for a period
  const calcPeriodVolume = (periodActivities) => {
    const running = periodActivities.filter(a => a.type === 'Running');
    const cycling = periodActivities.filter(a => a.type === 'Cycle');
    const strength = periodActivities.filter(a => getActivityCategory(a) === 'lifting');
    const recovery = periodActivities.filter(a => getActivityCategory(a) === 'recovery');
    const coldPlunge = periodActivities.filter(a => a.type === 'Cold Plunge');
    const sauna = periodActivities.filter(a => a.type === 'Sauna');
    const yoga = periodActivities.filter(a => a.type === 'Yoga');

    return {
      runs: running.length,
      miles: running.reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0),
      runMinutes: running.reduce((sum, a) => sum + (parseInt(a.duration) || 0), 0),
      strengthSessions: strength.length,
      liftingMinutes: strength.reduce((sum, a) => sum + (parseInt(a.duration) || 0), 0),
      recoverySessions: recovery.length,
      coldPlunges: coldPlunge.length,
      saunaSessions: sauna.length,
      yogaSessions: yoga.length,
      rides: cycling.length,
      cycleMiles: cycling.reduce((sum, a) => sum + (parseFloat(a.distance) || 0), 0),
      cycleMinutes: cycling.reduce((sum, a) => sum + (parseInt(a.duration) || 0), 0)
    };
  };

  // Calculate stats for each period
  const weekStats = calcPeriodStats(weekActivities, weekHealth);
  const monthStats = calcPeriodStats(monthActivities, monthHealth);
  const yearStats = calcPeriodStats(yearActivities, yearHealth);
  const allStats = calcPeriodStats(allActivities, allHealth);

  // Calculate volume for each period
  const weekVolume = calcPeriodVolume(weekActivities);
  const monthVolume = calcPeriodVolume(monthActivities);
  const yearVolume = calcPeriodVolume(yearActivities);
  const allVolume = calcPeriodVolume(allActivities);

  // Count total workouts (strength + cardio, not recovery)
  const totalWorkouts = allActivities.filter(a => {
    const cat = getActivityCategory(a);
    return cat === 'lifting' || cat === 'cardio';
  }).length;

  return {
    masterStreak: personalRecords?.longestMasterStreak || 0,
    strengthStreak: personalRecords?.longestStrengthStreak || 0,
    cardioStreak: personalRecords?.longestCardioStreak || 0,
    recoveryStreak: personalRecords?.longestRecoveryStreak || 0,
    weeksWon: 0, // TODO: implement weeks won tracking if needed
    totalWorkouts,
    stats: {
      calories: { week: weekStats.calories, month: monthStats.calories, year: yearStats.calories, all: allStats.calories },
      steps: { week: weekStats.steps, month: monthStats.steps, year: yearStats.steps, all: allStats.steps }
    },
    volume: {
      runs: { week: weekVolume.runs, month: monthVolume.runs, year: yearVolume.runs, all: allVolume.runs },
      miles: { week: weekVolume.miles, month: monthVolume.miles, year: yearVolume.miles, all: allVolume.miles },
      runMinutes: { week: weekVolume.runMinutes, month: monthVolume.runMinutes, year: yearVolume.runMinutes, all: allVolume.runMinutes },
      strengthSessions: { week: weekVolume.strengthSessions, month: monthVolume.strengthSessions, year: yearVolume.strengthSessions, all: allVolume.strengthSessions },
      liftingMinutes: { week: weekVolume.liftingMinutes, month: monthVolume.liftingMinutes, year: yearVolume.liftingMinutes, all: allVolume.liftingMinutes },
      recoverySessions: { week: weekVolume.recoverySessions, month: monthVolume.recoverySessions, year: yearVolume.recoverySessions, all: allVolume.recoverySessions },
      coldPlunges: { week: weekVolume.coldPlunges, month: monthVolume.coldPlunges, year: yearVolume.coldPlunges, all: allVolume.coldPlunges },
      saunaSessions: { week: weekVolume.saunaSessions, month: monthVolume.saunaSessions, year: yearVolume.saunaSessions, all: allVolume.saunaSessions },
      yogaSessions: { week: weekVolume.yogaSessions, month: monthVolume.yogaSessions, year: yearVolume.yogaSessions, all: allVolume.yogaSessions },
      rides: { week: weekVolume.rides, month: monthVolume.rides, year: yearVolume.rides, all: allVolume.rides },
      cycleMiles: { week: weekVolume.cycleMiles, month: monthVolume.cycleMiles, year: yearVolume.cycleMiles, all: allVolume.cycleMiles },
      cycleMinutes: { week: weekVolume.cycleMinutes, month: monthVolume.cycleMinutes, year: yearVolume.cycleMinutes, all: allVolume.cycleMinutes }
    }
  };
};

// Section header icon component - SVG line icons in brand cyan
const SectionIcon = ({ type, size = 22, color = '#04d1ff' }) => {
  const icons = {
    leaderboard: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 21V11M16 21V7M12 21V3"/>
      </svg>
    ),
    trophy: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>
        <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
        <path d="M4 22h16"/>
        <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
        <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
        <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
      </svg>
    ),
    feed: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 11a9 9 0 0 1 9 9"/>
        <path d="M4 4a16 16 0 0 1 16 16"/>
        <circle cx="5" cy="19" r="1"/>
      </svg>
    ),
  };
  return icons[type] || null;
};

// ScrollablePill - a pill button that allows horizontal scrolling through it
// Uses onPointerUp for tap detection which doesn't block scroll gestures
const ScrollablePill = ({ onClick, isSelected, color, textColor, children }) => {
  const startPos = useRef({ x: 0, y: 0 });

  const handlePointerDown = (e) => {
    startPos.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e) => {
    const dx = Math.abs(e.clientX - startPos.current.x);
    const dy = Math.abs(e.clientY - startPos.current.y);
    // Only trigger click if minimal movement (not a scroll)
    if (dx < 10 && dy < 10) {
      onClick();
    }
  };

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      className="px-2.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-200 flex-shrink-0 cursor-pointer select-none"
      style={{
        backgroundColor: isSelected ? color : 'rgba(255,255,255,0.05)',
        color: isSelected ? textColor : 'rgba(255,255,255,0.5)',
      }}
    >
      {children}
    </div>
  );
};

// Pull-to-Refresh Indicator Component for Feed - uses fixed positioning to avoid layout shifts
// visualThreshold controls how much the indicator moves - lower = less movement needed to show full indicator
const FeedPullToRefreshIndicator = ({ pullDistance, isRefreshing, threshold = 28, visualThreshold }) => {
  const effectiveThreshold = visualThreshold !== undefined ? visualThreshold : threshold;
  const progress = Math.min(pullDistance / effectiveThreshold, 1);
  const rotation = progress * 180;

  if (pullDistance === 0 && !isRefreshing) return null;

  // Position below the Friends header and toggle
  return (
    <div
      className="fixed left-0 right-0 flex items-center justify-center z-50 pointer-events-none"
      style={{
        top: 'calc(env(safe-area-inset-top, 0px) + 160px)',
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

// Context for swipeable comments
const SwipeableCommentContext = createContext({ openId: null, setOpenId: () => {} });

// Swipeable Comment Component for swipe-to-delete
const SwipeableComment = ({ children, commentId, onDelete, canDelete }) => {
  const { openId, setOpenId } = useContext(SwipeableCommentContext);
  const [swipeX, setSwipeX] = useState(0);
  const [startX, setStartX] = useState(null);
  const [startSwipeX, setStartSwipeX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const deleteButtonWidth = 70;
  const snapThreshold = 30;

  // Close this item if another one becomes open
  useEffect(() => {
    if (openId !== commentId && swipeX !== 0) {
      setSwipeX(0);
    }
  }, [openId, commentId, swipeX]);

  const handleTouchStart = (e) => {
    if (!canDelete) return;
    setStartX(e.touches[0].clientX);
    setStartSwipeX(swipeX);
    setIsSwiping(true);
  };

  const handleTouchMove = (e) => {
    if (!canDelete || startX === null) return;
    const currentX = e.touches[0].clientX;
    const diff = currentX - startX;

    if (diff < 0) {
      setOpenId(commentId);
    }

    const newSwipeX = Math.max(-deleteButtonWidth - 20, Math.min(0, startSwipeX + diff));
    setSwipeX(newSwipeX);
  };

  const handleTouchEnd = () => {
    if (!canDelete) return;
    setIsSwiping(false);
    setStartX(null);

    if (swipeX < -snapThreshold) {
      setSwipeX(-deleteButtonWidth);
      setOpenId(commentId);
    } else {
      setSwipeX(0);
      if (openId === commentId) {
        setOpenId(null);
      }
    }
  };

  const handleDelete = (e) => {
    e.stopPropagation();
    setSwipeX(0);
    setOpenId(null);
    onDelete();
  };

  if (!canDelete) {
    return <div>{children}</div>;
  }

  return (
    <div className="relative overflow-hidden rounded-lg">
      {/* Delete button - positioned on the right, only visible when swiping */}
      <div
        className="absolute inset-y-0 right-0 flex items-center rounded-r-lg"
        style={{
          width: Math.abs(swipeX) + deleteButtonWidth,
          backgroundColor: '#FF453A',
          opacity: swipeX < 0 ? 1 : 0,
          pointerEvents: swipeX < 0 ? 'auto' : 'none',
          justifyContent: 'flex-end',
          paddingRight: 8
        }}
      >
        <button
          onClick={handleDelete}
          className="h-full flex items-center justify-center"
          style={{ width: 40 }}
        >
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div
        className="relative"
        style={{
          transform: `translateX(${swipeX}px)`,
          transition: isSwiping ? 'none' : 'transform 0.3s ease-out'
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>
    </div>
  );
};

// TouchButton component - uses native DOM event listeners for tap detection
// This allows window-level capture listeners to still receive touch events for pull-to-refresh
const TouchButton = ({ onClick, disabled = false, className, style, children, touchAction = 'pan-y' }) => {
  const ref = useRef(null);
  const touchStartRef = useRef({ x: 0, y: 0, time: 0 });
  const [isPressed, setIsPressed] = useState(false);
  const [transitionsEnabled, setTransitionsEnabled] = useState(false);

  // Delay enabling transitions to prevent flash on mount/refresh from cached styles
  useEffect(() => {
    const timer = setTimeout(() => setTransitionsEnabled(true), 150);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled || !onClick) return;

    const handleTouchStart = (e) => {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        time: Date.now()
      };
      setIsPressed(true);
    };

    const handleTouchEnd = (e) => {
      setIsPressed(false);
      const touch = e.changedTouches[0];
      const dx = Math.abs(touch.clientX - touchStartRef.current.x);
      const dy = Math.abs(touch.clientY - touchStartRef.current.y);
      const dt = Date.now() - touchStartRef.current.time;
      // Only trigger tap if minimal movement and quick touch
      if (dx < 10 && dy < 10 && dt < 300) {
        onClick();
      }
    };

    const handleTouchCancel = () => {
      setIsPressed(false);
    };

    // Use passive: true to not block scrolling, and NOT capture phase so window gets events first
    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });
    el.addEventListener('touchcancel', handleTouchCancel, { passive: true });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, [disabled, onClick]);

  // Handle mouse clicks for desktop browsers
  const handleClick = () => {
    if (disabled || !onClick) return;
    onClick();
  };

  return (
    <div
      ref={ref}
      role={disabled ? undefined : "button"}
      tabIndex={disabled ? undefined : 0}
      onClick={handleClick}
      className={className}
      style={{
        ...style,
        touchAction: touchAction,
        cursor: disabled ? 'default' : 'pointer',
        // Only apply transform/opacity when pressed, use undefined (not explicit value) otherwise
        // This prevents the browser from animating from a cached value on refresh
        transform: isPressed ? 'scale(0.95)' : undefined,
        opacity: isPressed ? 0.7 : undefined,
        transition: transitionsEnabled ? 'transform 0.1s ease-out, opacity 0.1s ease-out' : 'none'
      }}
    >
      {children}
    </div>
  );
};

// Segmented control component - defined outside ActivityFeed for stable reference (enables CSS animations)
const SegmentedControl = ({ activeView, setActiveView }) => (
  <div className="px-4 pb-4" style={{ touchAction: 'pan-y' }}>
    <div className="relative flex p-1 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)', touchAction: 'pan-y' }}>
      {/* Sliding pill indicator - uses transform for smooth hardware-accelerated animation */}
      <div
        className="absolute top-1 bottom-1 left-1 rounded-lg"
        style={{
          backgroundColor: 'rgba(255,255,255,0.1)',
          width: 'calc(50% - 4px)',
          transform: activeView === 'feed' ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
        }}
      />
      {[
        { key: 'feed', label: 'Feed' },
        { key: 'leaderboard', label: 'Leaderboard' }
      ].map((tab) => (
        <TouchButton
          key={tab.key}
          onClick={() => setActiveView(tab.key)}
          className="flex-1 py-2 px-4 rounded-lg text-sm font-medium relative z-10 text-center"
          style={{
            color: activeView === tab.key ? 'white' : 'rgba(255,255,255,0.5)',
            transition: 'color 0.2s ease-out'
          }}
        >
          {tab.label}
        </TouchButton>
      ))}
    </div>
  </div>
);

// ProfilePhoto component - defined outside ActivityFeed for stable reference
const ProfilePhoto = React.memo(({ photoURL, displayName, size = 40 }) => (
  <div
    className="rounded-full bg-zinc-700 flex items-center justify-center overflow-hidden flex-shrink-0"
    style={{
      width: size,
      height: size,
      touchAction: 'pan-y',
      WebkitTouchCallout: 'none',
      WebkitUserSelect: 'none',
      userSelect: 'none',
    }}
  >
    {photoURL ? (
      <img
        src={photoURL}
        alt={displayName}
        className="w-full h-full object-cover"
        draggable={false}
        style={{
          touchAction: 'pan-y',
          pointerEvents: 'none',
          WebkitTouchCallout: 'none',
          WebkitUserSelect: 'none',
          userSelect: 'none',
        }}
      />
    ) : (
      <span className="text-white text-sm" style={{ pointerEvents: 'none' }}>{displayName?.[0]?.toUpperCase() || '?'}</span>
    )}
  </div>
));

// Memoized ActivityCard - only re-renders when its specific props change
const MemoizedActivityCard = React.memo(({
  activity,
  activityKey,
  reactions,
  comments,
  commentReplies,
  showComments,
  user,
  userProfile,
  onReaction,
  onToggleComments,
  onSubmitComment,
  onDeleteComment,
  onSubmitReply,
  onDeleteReply,
  onSelectFriend,
  commentInputRef,
  formatTimeAgo,
  formatDuration,
  formatCommentTime,
  reactionEmojis,
  activityIcons
}) => {
  const { friend, type, duration, calories, distance, date, id, customEmoji, sportEmoji } = activity;
  const [showFullscreenPhoto, setShowFullscreenPhoto] = useState(false);
  const [openCommentId, setOpenCommentId] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null); // { commentId, commenterName }
  const [expandedReplies, setExpandedReplies] = useState({});
  const inputRef = useRef(null);
  const replyInputRef = useRef(null);

  // Set up the ref callback
  useEffect(() => {
    if (inputRef.current) {
      commentInputRef(inputRef.current);
    }
  }, [commentInputRef]);

  // Focus reply input when replying
  useEffect(() => {
    if (replyingTo && replyInputRef.current) {
      replyInputRef.current.focus();
    }
  }, [replyingTo]);

  let icon = activityIcons[type] || '💪';
  if (type === 'Other' && customEmoji) {
    icon = customEmoji;
  } else if (type === 'Sports' && sportEmoji) {
    icon = sportEmoji;
  }

  // Count reactions by type
  const reactionCounts = {};
  reactions.forEach(r => {
    reactionCounts[r.reactionType] = (reactionCounts[r.reactionType] || 0) + 1;
  });

  const userReaction = reactions.find(r => r.reactorUid === user.uid);
  const reactorPhotos = reactions.filter(r => r.reactorPhoto).slice(0, 3);

  return (
    <div className="bg-zinc-900 rounded-xl p-4 mb-3">
      {/* Header - Friend info */}
      <div className="flex items-center gap-3 mb-3">
        <TouchButton onClick={() => onSelectFriend(friend)} className="flex-shrink-0">
          <ProfilePhoto photoURL={friend.photoURL} displayName={friend.displayName} />
        </TouchButton>
        <div className="flex-1 min-w-0">
          <TouchButton onClick={() => onSelectFriend(friend)} className="text-left block w-full">
            <p className="text-white font-medium truncate">{friend.displayName || friend.username}</p>
            <p className="text-gray-500 text-xs truncate">@{friend.username}</p>
          </TouchButton>
        </div>
        <span className="text-gray-500 text-xs flex-shrink-0">{formatTimeAgo(date)}</span>
      </div>

      {/* Activity details */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center">
          <span className="text-2xl">{icon}</span>
        </div>
        <div className="flex-1">
          <p className="text-white font-medium">{type}{activity.subtype ? ` • ${activity.subtype}` : ''}</p>
          <div className="flex items-center gap-3 mt-1">
            {duration && <span className="text-gray-400 text-sm">⏱ {formatDuration(duration)}</span>}
            {calories && <span className="text-gray-400 text-sm">🔥 {calories} cal</span>}
            {distance && <span className="text-gray-400 text-sm">📍 {distance} mi</span>}
          </div>
        </div>
      </div>

      {/* Activity Photo */}
      {activity.photoURL && !activity.isPhotoPrivate && (
        <>
          <TouchButton onClick={() => setShowFullscreenPhoto(true)} className="mt-3 rounded-xl overflow-hidden w-full relative group block">
            <img src={activity.photoURL} alt="Activity" className="w-full h-auto max-h-80 object-cover" />
          </TouchButton>
          {/* Fullscreen modal - always rendered but hidden to prevent flash */}
          <div
            className="fixed inset-0 z-[100] bg-black flex items-center justify-center transition-opacity duration-150"
            style={{
              opacity: showFullscreenPhoto ? 1 : 0,
              pointerEvents: showFullscreenPhoto ? 'auto' : 'none',
              visibility: showFullscreenPhoto ? 'visible' : 'hidden'
            }}
            onClick={() => setShowFullscreenPhoto(false)}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
          >
            <TouchButton onClick={() => setShowFullscreenPhoto(false)} className="absolute top-4 right-4 w-10 h-10 bg-white/10 rounded-full flex items-center justify-center z-10">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </TouchButton>
            <img src={activity.photoURL} alt="Activity fullscreen" className="max-w-full max-h-full object-contain" onClick={(e) => e.stopPropagation()} />
          </div>
        </>
      )}

      {/* Reactions and Comments section */}
      {id && (
        <div className="mt-3 pt-3 border-t border-zinc-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              {reactionEmojis.map((emoji) => {
                const count = reactionCounts[emoji] || 0;
                const isSelected = userReaction?.reactionType === emoji;
                return (
                  <TouchButton
                    key={emoji}
                    onClick={() => onReaction(activity, emoji)}
                    className={`flex items-center gap-1 px-2 py-1 rounded-full transition-all duration-150 ${isSelected ? 'bg-zinc-700 ring-1 ring-white/20' : 'bg-zinc-800 hover:bg-zinc-700'}`}
                  >
                    <span className="text-sm">{emoji}</span>
                    {count > 0 && <span className={`text-xs ${isSelected ? 'text-white' : 'text-gray-400'}`}>{count}</span>}
                  </TouchButton>
                );
              })}
              <TouchButton
                onClick={() => {
                  onToggleComments();
                  // Don't auto-focus keyboard - let user tap "Add a comment" to focus
                }}
                className={`flex items-center gap-1 px-2 py-1 rounded-full transition-all duration-150 ${showComments ? 'bg-zinc-700 ring-1 ring-white/20' : 'bg-zinc-800 hover:bg-zinc-700'}`}
              >
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                {comments.length > 0 && <span className="text-xs text-gray-400">{comments.length}</span>}
              </TouchButton>
            </div>

            {reactorPhotos.length > 0 && (
              <div className="flex items-center -space-x-2">
                {reactorPhotos.map((reactor, idx) => (
                  <div key={reactor.reactorUid || idx} className="w-6 h-6 rounded-full border-2 border-zinc-900 overflow-hidden">
                    <img src={reactor.reactorPhoto} alt={reactor.reactorName} className="w-full h-full object-cover" />
                  </div>
                ))}
                {reactions.length > 3 && <span className="text-gray-500 text-xs ml-2">+{reactions.length - 3}</span>}
              </div>
            )}
          </div>

          {/* Inline Comments Section */}
          <div className="overflow-hidden transition-all duration-300 ease-out" style={{ maxHeight: showComments ? '1000px' : '0', opacity: showComments ? 1 : 0 }}>
            <div className="pt-3 mt-3 border-t border-zinc-800">
              {comments.length > 0 && (
                <SwipeableCommentContext.Provider value={{ openId: openCommentId, setOpenId: setOpenCommentId }}>
                  <div className="space-y-2 mb-3">
                    {comments.map((comment) => {
                      const replies = commentReplies?.[comment.id] || [];
                      const isExpanded = expandedReplies[comment.id];
                      return (
                        <div key={comment.id} className="py-1">
                          <SwipeableComment
                            commentId={comment.id}
                            canDelete={comment.commenterUid === user.uid}
                            onDelete={() => onDeleteComment(comment.id)}
                          >
                            <div className="flex gap-2 items-start">
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
                              </div>
                            </div>
                          </SwipeableComment>
                          <div className="flex items-center gap-3 ml-9 mt-0.5">
                            <span className="text-gray-500 text-[10px]">{formatCommentTime(comment.createdAt)}</span>
                            {/* Only post owner can reply to comments */}
                            {user?.uid === friend.uid && (
                              <button
                                onClick={() => setReplyingTo({ commentId: comment.id, commenterName: comment.commenterName })}
                                className="text-gray-400 text-[10px] font-medium hover:text-white"
                              >
                                Reply
                              </button>
                            )}
                            {replies.length > 0 && !isExpanded && (
                              <button
                                onClick={() => setExpandedReplies(prev => ({ ...prev, [comment.id]: true }))}
                                className="text-blue-400 text-[10px] font-medium"
                              >
                                View {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
                              </button>
                            )}
                          </div>

                          {/* Replies thread */}
                          {isExpanded && replies.length > 0 && (
                            <div className="ml-9 mt-2 space-y-2 border-l-2 border-zinc-700 pl-3">
                              {replies.map((reply) => (
                                <div key={reply.id}>
                                  <SwipeableComment
                                    commentId={`reply-${reply.id}`}
                                    canDelete={reply.replierUid === user.uid}
                                    onDelete={() => onDeleteReply(comment.id, reply.id)}
                                  >
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
                                      </div>
                                    </div>
                                  </SwipeableComment>
                                  <span className="text-gray-500 text-[9px] ml-8">{formatCommentTime(reply.createdAt)}</span>
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

                          {/* Reply input for this comment */}
                          {replyingTo?.commentId === comment.id && (
                            <div className="ml-9 mt-2 flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center overflow-hidden flex-shrink-0">
                                {userProfile?.photoURL ? (
                                  <img src={userProfile.photoURL} alt="You" className="w-full h-full object-cover" />
                                ) : (
                                  <span className="text-white text-[9px]">{userProfile?.displayName?.[0]?.toUpperCase() || '?'}</span>
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
                                        try {
                                          await onSubmitReply(comment.id, text);
                                          replyInputRef.current.value = '';
                                          setReplyingTo(null);
                                          setExpandedReplies(prev => ({ ...prev, [comment.id]: true }));
                                        } catch (error) {
                                          // console.error('Failed to post reply:', error);
                                        }
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
                                      try {
                                        await onSubmitReply(comment.id, text);
                                        replyInputRef.current.value = '';
                                        setReplyingTo(null);
                                        setExpandedReplies(prev => ({ ...prev, [comment.id]: true }));
                                      } catch (error) {
                                        // console.error('Failed to post reply:', error);
                                      }
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
                </SwipeableCommentContext.Provider>
              )}

              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {userProfile?.photoURL ? (
                    <img src={userProfile.photoURL} alt="You" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-white text-[10px]">{userProfile?.displayName?.[0]?.toUpperCase() || '?'}</span>
                  )}
                </div>
                <div className="flex-1 flex items-center gap-2 bg-zinc-800 rounded-full px-3 py-1.5">
                  <input
                    ref={inputRef}
                    type="text"
                    defaultValue=""
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        onSubmitComment(activityKey);
                      }
                    }}
                    placeholder="Add a comment..."
                    className="flex-1 bg-transparent text-white text-sm focus:outline-none"
                    style={{ fontSize: '16px' }}
                  />
                  <button onClick={() => onSubmitComment(activityKey)} className="text-sm font-medium text-green-500">Post</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render if these specific props change
  return (
    prevProps.activityKey === nextProps.activityKey &&
    prevProps.reactions === nextProps.reactions &&
    prevProps.comments === nextProps.comments &&
    prevProps.commentReplies === nextProps.commentReplies &&
    prevProps.showComments === nextProps.showComments &&
    prevProps.activity === nextProps.activity
  );
});

const ActivityFeed = ({ user, userProfile, friends, onOpenFriends, pendingRequestsCount = 0, onActiveViewChange }) => {
  const [feedActivities, setFeedActivities] = useState([]);
  const [activityReactions, setActivityReactions] = useState({});
  const [activityComments, setActivityComments] = useState({});
  const [commentReplies, setCommentReplies] = useState({}); // { activityKey: { commentId: [replies] } }
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeView, setActiveView] = useState('feed'); // 'feed' or 'leaderboard'
  const [leaderboardData, setLeaderboardData] = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardSection, setLeaderboardSection] = useState('activity'); // 'activity' or 'streak'
  const [leaderboardCategory, setLeaderboardCategory] = useState('calories'); // Activity: 'calories', 'steps', 'workouts' | Streak: 'master', 'strength', 'cardio', 'recovery'
  const [leaderboardTimeRange, setLeaderboardTimeRange] = useState('week'); // Activity: 'week', 'month', 'year', 'all' | Streak: 'year', 'all'
  const [selectedFriend, setSelectedFriend] = useState(null); // For viewing friend profile
  const [expandedComments, setExpandedComments] = useState({}); // Track which activities have expanded comments

  // Local pull-to-refresh state (only for feed cards area)
  const [localPullDistance, setLocalPullDistance] = useState(0);
  const [localIsRefreshing, setLocalIsRefreshing] = useState(false);
  const feedCardsRef = useRef(null);
  const touchStartY = useRef(0);
  const touchStartedInFeed = useRef(false);
  const isPulling = useRef(false);
  const localIsRefreshingRef = useRef(false);
  const hasTriggeredRefresh = useRef(false);

  // Notify parent when active view changes (for pull-to-refresh threshold)
  useEffect(() => {
    if (onActiveViewChange) {
      onActiveViewChange(activeView);
    }
  }, [activeView, onActiveViewChange]);

  const reactionEmojis = ['💪', '🔥', '👏', '❤️'];

  const activityIcons = {
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

  const formatTimeAgo = (dateStr) => {
    const now = new Date();
    const date = new Date(dateStr + 'T12:00:00');
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatDuration = (minutes) => {
    if (!minutes) return null;
    if (minutes < 60) return `${minutes}min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  const loadFeed = useCallback(async () => {
    // Check if this is the appreview account
    const isAppReviewAccount = userProfile?.username?.toLowerCase() === 'appreview' ||
                               user?.email?.toLowerCase() === 'appreview@dayseven.app';

    // Generate dummy feed data for appreview account
    if (isAppReviewAccount) {
      const dummyFriends = [
        { uid: 'dummy1', username: 'alex_fitness', displayName: 'Alex Thompson', photoURL: 'https://i.pravatar.cc/150?img=1' },
        { uid: 'dummy2', username: 'sarah_runs', displayName: 'Sarah Chen', photoURL: 'https://i.pravatar.cc/150?img=5' },
        { uid: 'dummy3', username: 'mike_lifts', displayName: 'Mike Johnson', photoURL: 'https://i.pravatar.cc/150?img=8' },
        { uid: 'dummy4', username: 'emma_yoga', displayName: 'Emma Williams', photoURL: 'https://i.pravatar.cc/150?img=9' },
        { uid: 'dummy5', username: 'jake_athlete', displayName: 'Jake Martinez', photoURL: 'https://i.pravatar.cc/150?img=12' },
        { uid: 'dummy6', username: 'lisa_cardio', displayName: 'Lisa Park', photoURL: 'https://i.pravatar.cc/150?img=16' }
      ];

      const today = new Date();
      const formatDate = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };

      const dummyActivities = [
        // Today's activities
        {
          id: 'demo-1',
          type: 'Strength Training',
          subtype: 'Lifting - Push',
          strengthType: 'Lifting',
          date: formatDate(today),
          time: '7:30 AM',
          duration: 65,
          calories: 420,
          friend: dummyFriends[0],
          photoURL: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&h=400&fit=crop'
        },
        {
          id: 'demo-2',
          type: 'Running',
          date: formatDate(today),
          time: '6:15 AM',
          duration: 42,
          distance: 5.2,
          pace: '8:05',
          calories: 485,
          friend: dummyFriends[1]
        },
        // Yesterday's activities
        {
          id: 'demo-3',
          type: 'Yoga',
          date: formatDate(new Date(today.getTime() - 86400000)),
          time: '6:00 AM',
          duration: 45,
          friend: dummyFriends[3],
          photoURL: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=400&h=400&fit=crop'
        },
        {
          id: 'demo-4',
          type: 'Strength Training',
          subtype: 'Lifting - Legs',
          strengthType: 'Lifting',
          date: formatDate(new Date(today.getTime() - 86400000)),
          time: '5:45 PM',
          duration: 72,
          calories: 380,
          friend: dummyFriends[2],
          photoURL: 'https://images.unsplash.com/photo-1574680096145-d05b474e2155?w=400&h=400&fit=crop'
        },
        {
          id: 'demo-5',
          type: 'Cycle',
          date: formatDate(new Date(today.getTime() - 86400000)),
          time: '7:00 AM',
          duration: 55,
          distance: 18.5,
          calories: 520,
          friend: dummyFriends[4]
        },
        // 2 days ago
        {
          id: 'demo-6',
          type: 'Running',
          date: formatDate(new Date(today.getTime() - 2 * 86400000)),
          time: '6:30 AM',
          duration: 38,
          distance: 4.8,
          pace: '7:55',
          calories: 445,
          friend: dummyFriends[5],
          photoURL: 'https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?w=400&h=400&fit=crop'
        },
        {
          id: 'demo-7',
          type: 'Cold Plunge',
          date: formatDate(new Date(today.getTime() - 2 * 86400000)),
          time: '7:15 AM',
          duration: 5,
          friend: dummyFriends[0]
        },
        {
          id: 'demo-8',
          type: 'Strength Training',
          subtype: 'Lifting - Pull',
          strengthType: 'Lifting',
          date: formatDate(new Date(today.getTime() - 2 * 86400000)),
          time: '6:00 PM',
          duration: 58,
          calories: 345,
          friend: dummyFriends[1]
        },
        // 3 days ago
        {
          id: 'demo-9',
          type: 'Sauna',
          date: formatDate(new Date(today.getTime() - 3 * 86400000)),
          time: '8:00 PM',
          duration: 20,
          friend: dummyFriends[2]
        },
        {
          id: 'demo-10',
          type: 'Running',
          date: formatDate(new Date(today.getTime() - 3 * 86400000)),
          time: '5:30 AM',
          duration: 52,
          distance: 6.5,
          pace: '8:00',
          calories: 580,
          friend: dummyFriends[4],
          photoURL: 'https://images.unsplash.com/photo-1549060279-7e168fcee0c2?w=400&h=400&fit=crop'
        }
      ];

      // Generate dummy reactions
      const dummyReactions = {
        'dummy1-demo-1': [
          { reactorUid: 'dummy2', reactionType: '🔥', reactorName: 'Sarah Chen', reactorPhoto: 'https://i.pravatar.cc/150?img=5' },
          { reactorUid: 'dummy3', reactionType: '💪', reactorName: 'Mike Johnson', reactorPhoto: 'https://i.pravatar.cc/150?img=8' },
          { reactorUid: 'dummy4', reactionType: '🔥', reactorName: 'Emma Williams', reactorPhoto: 'https://i.pravatar.cc/150?img=9' }
        ],
        'dummy2-demo-2': [
          { reactorUid: 'dummy1', reactionType: '🏃', reactorName: 'Alex Thompson', reactorPhoto: 'https://i.pravatar.cc/150?img=1' },
          { reactorUid: 'dummy5', reactionType: '🔥', reactorName: 'Jake Martinez', reactorPhoto: 'https://i.pravatar.cc/150?img=12' }
        ],
        'dummy4-demo-3': [
          { reactorUid: 'dummy6', reactionType: '🧘', reactorName: 'Lisa Park', reactorPhoto: 'https://i.pravatar.cc/150?img=16' },
          { reactorUid: 'dummy2', reactionType: '💚', reactorName: 'Sarah Chen', reactorPhoto: 'https://i.pravatar.cc/150?img=5' }
        ],
        'dummy3-demo-4': [
          { reactorUid: 'dummy1', reactionType: '💪', reactorName: 'Alex Thompson', reactorPhoto: 'https://i.pravatar.cc/150?img=1' },
          { reactorUid: 'dummy5', reactionType: '🔥', reactorName: 'Jake Martinez', reactorPhoto: 'https://i.pravatar.cc/150?img=12' },
          { reactorUid: 'dummy6', reactionType: '💪', reactorName: 'Lisa Park', reactorPhoto: 'https://i.pravatar.cc/150?img=16' },
          { reactorUid: 'dummy4', reactionType: '🔥', reactorName: 'Emma Williams', reactorPhoto: 'https://i.pravatar.cc/150?img=9' }
        ],
        'dummy5-demo-5': [
          { reactorUid: 'dummy3', reactionType: '🚴', reactorName: 'Mike Johnson', reactorPhoto: 'https://i.pravatar.cc/150?img=8' }
        ],
        'dummy6-demo-6': [
          { reactorUid: 'dummy2', reactionType: '🏃', reactorName: 'Sarah Chen', reactorPhoto: 'https://i.pravatar.cc/150?img=5' },
          { reactorUid: 'dummy4', reactionType: '🔥', reactorName: 'Emma Williams', reactorPhoto: 'https://i.pravatar.cc/150?img=9' }
        ],
        'dummy1-demo-7': [
          { reactorUid: 'dummy3', reactionType: '🧊', reactorName: 'Mike Johnson', reactorPhoto: 'https://i.pravatar.cc/150?img=8' }
        ],
        'dummy5-demo-10': [
          { reactorUid: 'dummy1', reactionType: '🔥', reactorName: 'Alex Thompson', reactorPhoto: 'https://i.pravatar.cc/150?img=1' },
          { reactorUid: 'dummy2', reactionType: '🏃', reactorName: 'Sarah Chen', reactorPhoto: 'https://i.pravatar.cc/150?img=5' },
          { reactorUid: 'dummy6', reactionType: '💪', reactorName: 'Lisa Park', reactorPhoto: 'https://i.pravatar.cc/150?img=16' }
        ]
      };

      // Generate dummy comments
      const dummyComments = {
        'dummy1-demo-1': [
          { id: 'c1', commenterUid: 'dummy2', commenterName: 'Sarah Chen', commenterPhoto: 'https://i.pravatar.cc/150?img=5', text: 'Beast mode! 💪', createdAt: new Date(today.getTime() - 3600000).toISOString() },
          { id: 'c2', commenterUid: 'dummy3', commenterName: 'Mike Johnson', commenterPhoto: 'https://i.pravatar.cc/150?img=8', text: 'What exercises did you do?', createdAt: new Date(today.getTime() - 1800000).toISOString() }
        ],
        'dummy3-demo-4': [
          { id: 'c3', commenterUid: 'dummy1', commenterName: 'Alex Thompson', commenterPhoto: 'https://i.pravatar.cc/150?img=1', text: 'Leg day is the best day! 🦵', createdAt: new Date(today.getTime() - 86400000 - 3600000).toISOString() }
        ],
        'dummy6-demo-6': [
          { id: 'c4', commenterUid: 'dummy2', commenterName: 'Sarah Chen', commenterPhoto: 'https://i.pravatar.cc/150?img=5', text: 'Great pace! Keep it up 🏃‍♀️', createdAt: new Date(today.getTime() - 2 * 86400000 - 7200000).toISOString() },
          { id: 'c5', commenterUid: 'dummy5', commenterName: 'Jake Martinez', commenterPhoto: 'https://i.pravatar.cc/150?img=12', text: 'We should run together sometime!', createdAt: new Date(today.getTime() - 2 * 86400000 - 3600000).toISOString() }
        ],
        'dummy5-demo-10': [
          { id: 'c6', commenterUid: 'dummy6', commenterName: 'Lisa Park', commenterPhoto: 'https://i.pravatar.cc/150?img=16', text: 'Beautiful sunrise run! 🌅', createdAt: new Date(today.getTime() - 3 * 86400000 - 3600000).toISOString() }
        ]
      };

      setFeedActivities(dummyActivities);
      setActivityReactions(dummyReactions);
      setActivityComments(dummyComments);
      setCommentReplies({});
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    // Regular flow for non-appreview accounts
    if (!friends || friends.length === 0) {
      setFeedActivities([]);
      setIsLoading(false);
      return;
    }

    try {
      // Fetch activities from all friends in parallel
      const activityPromises = friends.map(async (friend) => {
        const activities = await getUserActivities(friend.uid);
        // Add friend info to each activity
        return activities.map(activity => ({
          ...activity,
          friend: {
            uid: friend.uid,
            username: friend.username,
            displayName: friend.displayName,
            photoURL: friend.photoURL
          }
        }));
      });

      const allActivities = await Promise.all(activityPromises);
      const flatActivities = allActivities.flat();

      // Sort by date (most recent first)
      flatActivities.sort((a, b) => {
        const dateA = new Date(a.date + 'T' + (a.time || '12:00'));
        const dateB = new Date(b.date + 'T' + (b.time || '12:00'));
        return dateB - dateA;
      });

      // Limit to most recent 50 activities
      const limitedActivities = flatActivities.slice(0, 50);
      setFeedActivities(limitedActivities);

      // Fetch reactions and comments for each activity
      const reactionsMap = {};
      const commentsMap = {};
      const repliesMap = {};
      await Promise.all(
        limitedActivities.map(async (activity) => {
          if (activity.id) {
            const key = `${activity.friend.uid}-${activity.id}`;
            const [reactions, comments] = await Promise.all([
              getReactions(activity.friend.uid, activity.id),
              getComments(activity.friend.uid, activity.id)
            ]);
            reactionsMap[key] = reactions;
            commentsMap[key] = comments;

            // Load replies for each comment
            if (comments.length > 0) {
              repliesMap[key] = {};
              await Promise.all(
                comments.map(async (comment) => {
                  const replies = await getReplies(activity.friend.uid, activity.id, comment.id);
                  if (replies.length > 0) {
                    repliesMap[key][comment.id] = replies;
                  }
                })
              );
            }
          }
        })
      );
      setActivityReactions(reactionsMap);
      setActivityComments(commentsMap);
      setCommentReplies(repliesMap);
    } catch (error) {
      // console.error('Error loading activity feed:', error);
    }
    setIsLoading(false);
    setIsRefreshing(false);
    setLocalIsRefreshing(false);
  }, [friends, user, userProfile]);

  // Keep ref in sync with state for use in event handlers
  useEffect(() => {
    localIsRefreshingRef.current = localIsRefreshing;
  }, [localIsRefreshing]);

  // Local pull-to-refresh handler for feed cards area only
  const handleLocalRefresh = useCallback(async () => {
    if (localIsRefreshingRef.current) return;
    localIsRefreshingRef.current = true;
    hasTriggeredRefresh.current = true;
    setLocalIsRefreshing(true);
    triggerHaptic(ImpactStyle.Heavy);

    const startTime = Date.now();
    try {
      await loadFeed();
    } finally {
      // Ensure minimum 600ms refresh animation for visual feedback
      const elapsed = Date.now() - startTime;
      const remainingTime = Math.max(600 - elapsed, 0);

      setTimeout(() => {
        setLocalIsRefreshing(false);
        localIsRefreshingRef.current = false;
        setLocalPullDistance(0);
        hasTriggeredRefresh.current = false;
      }, remainingTime);
    }
  }, [loadFeed]);

  // Touch handlers for local pull-to-refresh (window-level, but only active when touch starts in feed area)
  useEffect(() => {
    if (activeView !== 'feed') return;

    const getScrollTop = () => {
      const root = document.getElementById('root');
      const rootScroll = root?.scrollTop || 0;
      const windowScroll = window.pageYOffset || 0;
      const docScroll = document.documentElement.scrollTop || 0;
      const bodyScroll = document.body.scrollTop || 0;
      const appContainer = root?.firstElementChild;
      const appScroll = appContainer ? appContainer.scrollTop || 0 : 0;
      return Math.max(rootScroll, windowScroll, docScroll, bodyScroll, appScroll);
    };

    const handleTouchStart = (e) => {
      if (localIsRefreshingRef.current) return;

      // Check if touch started in feed cards area
      const feedCards = feedCardsRef.current;
      if (feedCards && feedCards.contains(e.target)) {
        touchStartY.current = e.touches[0].clientY;
        touchStartedInFeed.current = true;
        isPulling.current = false;
        hasTriggeredRefresh.current = false;
      } else {
        touchStartedInFeed.current = false;
      }
    };

    const handleTouchMove = (e) => {
      if (!touchStartedInFeed.current || localIsRefreshingRef.current) return;

      const scrollTop = getScrollTop();
      const touchY = e.touches[0].clientY;
      const diff = touchY - touchStartY.current;

      // Only allow pull when at top of page and pulling down
      if (scrollTop <= 5 && diff > 0) {
        // Prevent default scroll/bounce behavior when pulling to refresh
        e.preventDefault();

        isPulling.current = true;
        const distance = Math.min(diff * 0.5, 100);
        setLocalPullDistance(distance);

        // Trigger refresh when threshold reached
        if (distance >= 60 && !hasTriggeredRefresh.current) {
          handleLocalRefresh();
        }
      } else if (isPulling.current && scrollTop > 5) {
        // Cancel pull if scrolled away from top
        isPulling.current = false;
        setLocalPullDistance(0);
      }
    };

    const handleTouchEnd = () => {
      if (touchStartedInFeed.current && !localIsRefreshingRef.current) {
        isPulling.current = false;
        setLocalPullDistance(0);
      }
      touchStartedInFeed.current = false;
    };

    // Use window-level listeners with capture phase to get events before children
    // touchmove needs passive: false to allow preventDefault() for stopping page scroll
    window.addEventListener('touchstart', handleTouchStart, { passive: true, capture: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: false, capture: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true, capture: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart, { capture: true });
      window.removeEventListener('touchmove', handleTouchMove, { capture: true });
      window.removeEventListener('touchend', handleTouchEnd, { capture: true });
    };
  }, [activeView, handleLocalRefresh]);

  const loadLeaderboard = useCallback(async () => {
    if (!user) {
      setLeaderboardLoading(false);
      return;
    }
    setLeaderboardLoading(true);

    try {
      // Check if this is the appreview account
      const isAppReviewAccount = userProfile?.username?.toLowerCase() === 'appreview' ||
                                 user.email?.toLowerCase() === 'appreview@dayseven.app';

      // Dummy data for appreview account (App Store demo)
      const dummyFriends = [
        {
          uid: 'dummy1',
          username: 'alex_fitness',
          displayName: 'Alex Thompson',
          photoURL: 'https://i.pravatar.cc/150?img=1',
          masterStreak: 28,
          strengthStreak: 15,
          cardioStreak: 12,
          recoveryStreak: 8,
          weeksWon: 12,
          totalWorkouts: 156,
          stats: {
            calories: { week: 4850, month: 18200, year: 198000, all: 485000 },
            steps: { week: 68000, month: 285000, year: 3200000, all: 9500000 }
          },
          volume: {
            runs: { week: 4, month: 16, year: 180, all: 420 },
            miles: { week: 18.5, month: 72, year: 820, all: 1950 },
            runMinutes: { week: 180, month: 720, year: 8200, all: 19500 },
            strengthSessions: { week: 5, month: 20, year: 220, all: 520 },
            liftingMinutes: { week: 300, month: 1200, year: 13200, all: 31200 },
            recoverySessions: { week: 2, month: 8, year: 90, all: 210 },
            coldPlunges: { week: 1, month: 4, year: 45, all: 108 },
            saunaSessions: { week: 1, month: 3, year: 35, all: 84 },
            yogaSessions: { week: 0, month: 1, year: 10, all: 18 },
            rides: { week: 3, month: 12, year: 140, all: 336 },
            cycleMiles: { week: 45, month: 180, year: 2100, all: 5040 },
            cycleMinutes: { week: 150, month: 600, year: 7000, all: 16800 }
          }
        },
        {
          uid: 'dummy2',
          username: 'sarah_runs',
          displayName: 'Sarah Chen',
          photoURL: 'https://i.pravatar.cc/150?img=5',
          masterStreak: 45,
          strengthStreak: 8,
          cardioStreak: 32,
          recoveryStreak: 14,
          weeksWon: 18,
          totalWorkouts: 234,
          stats: {
            calories: { week: 5200, month: 21500, year: 245000, all: 620000 },
            steps: { week: 92000, month: 380000, year: 4100000, all: 12000000 }
          },
          volume: {
            runs: { week: 6, month: 24, year: 280, all: 680 },
            miles: { week: 32, month: 128, year: 1480, all: 3600 },
            runMinutes: { week: 320, month: 1280, year: 14800, all: 36000 },
            strengthSessions: { week: 2, month: 8, year: 96, all: 230 },
            liftingMinutes: { week: 90, month: 360, year: 4320, all: 10350 },
            recoverySessions: { week: 3, month: 12, year: 140, all: 340 },
            coldPlunges: { week: 1, month: 4, year: 46, all: 112 },
            saunaSessions: { week: 1, month: 4, year: 48, all: 116 },
            yogaSessions: { week: 1, month: 4, year: 46, all: 112 },
            rides: { week: 2, month: 8, year: 96, all: 230 },
            cycleMiles: { week: 30, month: 120, year: 1440, all: 3450 },
            cycleMinutes: { week: 100, month: 400, year: 4800, all: 11500 }
          }
        },
        {
          uid: 'dummy3',
          username: 'mike_lifts',
          displayName: 'Mike Johnson',
          photoURL: 'https://i.pravatar.cc/150?img=8',
          masterStreak: 21,
          strengthStreak: 35,
          cardioStreak: 5,
          recoveryStreak: 18,
          weeksWon: 8,
          totalWorkouts: 189,
          stats: {
            calories: { week: 3800, month: 15600, year: 172000, all: 380000 },
            steps: { week: 42000, month: 175000, year: 1900000, all: 5200000 }
          },
          volume: {
            runs: { week: 1, month: 4, year: 48, all: 115 },
            miles: { week: 3, month: 12, year: 144, all: 345 },
            runMinutes: { week: 30, month: 120, year: 1440, all: 3450 },
            strengthSessions: { week: 6, month: 24, year: 288, all: 690 },
            liftingMinutes: { week: 420, month: 1680, year: 20160, all: 48300 },
            recoverySessions: { week: 3, month: 12, year: 144, all: 345 },
            coldPlunges: { week: 2, month: 8, year: 96, all: 230 },
            saunaSessions: { week: 1, month: 4, year: 48, all: 115 },
            yogaSessions: { week: 0, month: 0, year: 0, all: 0 },
            rides: { week: 1, month: 4, year: 48, all: 115 },
            cycleMiles: { week: 15, month: 60, year: 720, all: 1725 },
            cycleMinutes: { week: 50, month: 200, year: 2400, all: 5750 }
          }
        },
        {
          uid: 'dummy4',
          username: 'emma_yoga',
          displayName: 'Emma Williams',
          photoURL: 'https://i.pravatar.cc/150?img=9',
          masterStreak: 62,
          strengthStreak: 12,
          cardioStreak: 18,
          recoveryStreak: 45,
          weeksWon: 24,
          totalWorkouts: 312,
          stats: {
            calories: { week: 2900, month: 12400, year: 142000, all: 340000 },
            steps: { week: 55000, month: 230000, year: 2600000, all: 7800000 }
          },
          volume: {
            runs: { week: 3, month: 12, year: 140, all: 336 },
            miles: { week: 12, month: 48, year: 560, all: 1344 },
            runMinutes: { week: 120, month: 480, year: 5600, all: 13440 },
            strengthSessions: { week: 3, month: 12, year: 144, all: 345 },
            liftingMinutes: { week: 135, month: 540, year: 6480, all: 15525 },
            recoverySessions: { week: 7, month: 28, year: 336, all: 806 },
            coldPlunges: { week: 1, month: 4, year: 48, all: 115 },
            saunaSessions: { week: 1, month: 4, year: 48, all: 115 },
            yogaSessions: { week: 5, month: 20, year: 240, all: 576 },
            rides: { week: 4, month: 16, year: 192, all: 460 },
            cycleMiles: { week: 60, month: 240, year: 2880, all: 6900 },
            cycleMinutes: { week: 200, month: 800, year: 9600, all: 23000 }
          }
        },
        {
          uid: 'dummy5',
          username: 'jake_athlete',
          displayName: 'Jake Martinez',
          photoURL: 'https://i.pravatar.cc/150?img=12',
          masterStreak: 35,
          strengthStreak: 22,
          cardioStreak: 28,
          recoveryStreak: 10,
          weeksWon: 15,
          totalWorkouts: 267,
          stats: {
            calories: { week: 6100, month: 24800, year: 285000, all: 720000 },
            steps: { week: 78000, month: 320000, year: 3600000, all: 10500000 }
          },
          volume: {
            runs: { week: 5, month: 20, year: 240, all: 576 },
            miles: { week: 28, month: 112, year: 1344, all: 3225 },
            runMinutes: { week: 280, month: 1120, year: 13440, all: 32250 },
            strengthSessions: { week: 5, month: 20, year: 240, all: 576 },
            liftingMinutes: { week: 350, month: 1400, year: 16800, all: 40320 },
            recoverySessions: { week: 2, month: 8, year: 96, all: 230 },
            coldPlunges: { week: 1, month: 4, year: 48, all: 115 },
            saunaSessions: { week: 1, month: 4, year: 48, all: 115 },
            yogaSessions: { week: 0, month: 0, year: 0, all: 0 },
            rides: { week: 5, month: 20, year: 240, all: 576 },
            cycleMiles: { week: 75, month: 300, year: 3600, all: 8640 },
            cycleMinutes: { week: 250, month: 1000, year: 12000, all: 28800 }
          }
        },
        {
          uid: 'dummy6',
          username: 'lisa_cardio',
          displayName: 'Lisa Park',
          photoURL: 'https://i.pravatar.cc/150?img=16',
          masterStreak: 18,
          strengthStreak: 6,
          cardioStreak: 42,
          recoveryStreak: 8,
          weeksWon: 9,
          totalWorkouts: 198,
          stats: {
            calories: { week: 4200, month: 17500, year: 195000, all: 465000 },
            steps: { week: 105000, month: 420000, year: 4800000, all: 14000000 }
          },
          volume: {
            runs: { week: 7, month: 28, year: 336, all: 806 },
            miles: { week: 35, month: 140, year: 1680, all: 4032 },
            runMinutes: { week: 350, month: 1400, year: 16800, all: 40320 },
            strengthSessions: { week: 1, month: 4, year: 48, all: 115 },
            liftingMinutes: { week: 45, month: 180, year: 2160, all: 5175 },
            recoverySessions: { week: 2, month: 8, year: 96, all: 230 },
            coldPlunges: { week: 0, month: 2, year: 24, all: 58 },
            saunaSessions: { week: 1, month: 4, year: 48, all: 115 },
            yogaSessions: { week: 1, month: 2, year: 24, all: 57 },
            rides: { week: 6, month: 24, year: 288, all: 690 },
            cycleMiles: { week: 90, month: 360, year: 4320, all: 10350 },
            cycleMinutes: { week: 300, month: 1200, year: 14400, all: 34500 }
          }
        }
      ];

      // Fetch current user's real data
      const [userActivities, userRecords, userHealthHistory] = await Promise.all([
        getUserActivities(user.uid),
        getPersonalRecords(user.uid),
        getDailyHealthHistory(user.uid, 365) // Get full year of health data
      ]);

      // Calculate current user's stats from real data
      const currentUserStats = calculateLeaderboardStats(
        userActivities || [],
        userHealthHistory || [],
        userRecords
      );

      // Build current user entry with real stats
      const currentUserEntry = {
        uid: user.uid,
        username: userProfile?.username || 'You',
        displayName: userProfile?.displayName || 'You',
        photoURL: userProfile?.photoURL,
        ...currentUserStats,
        isCurrentUser: true
      };

      let allUsers = [];

      if (isAppReviewAccount) {
        // For appreview account, use dummy friends + current user with dummy stats
        allUsers = [
          ...dummyFriends,
          {
            uid: user.uid,
            username: userProfile?.username || 'You',
            displayName: userProfile?.displayName || 'You',
            photoURL: userProfile?.photoURL,
            masterStreak: 24,
            strengthStreak: 18,
            cardioStreak: 14,
            recoveryStreak: 9,
            weeksWon: 10,
            totalWorkouts: 145,
            stats: {
              calories: { week: 3800, month: 16200, year: 185000, all: 420000 },
              steps: { week: 58000, month: 245000, year: 2800000, all: 8500000 }
            },
            volume: {
              runs: { week: 4, month: 15, year: 175, all: 420 },
              miles: { week: 20, month: 78, year: 910, all: 2184 },
              runMinutes: { week: 200, month: 780, year: 9100, all: 21840 },
              strengthSessions: { week: 4, month: 16, year: 192, all: 460 },
              liftingMinutes: { week: 240, month: 960, year: 11520, all: 27600 },
              recoverySessions: { week: 2, month: 9, year: 105, all: 252 },
              coldPlunges: { week: 1, month: 3, year: 35, all: 84 },
              saunaSessions: { week: 1, month: 4, year: 45, all: 108 },
              yogaSessions: { week: 0, month: 2, year: 25, all: 60 },
              rides: { week: 3, month: 11, year: 130, all: 312 },
              cycleMiles: { week: 40, month: 150, year: 1750, all: 4200 },
              cycleMinutes: { week: 130, month: 500, year: 5800, all: 13900 }
            },
            isCurrentUser: true
          }
        ];
      } else {
        // For regular users, fetch real friends and their data
        const friends = await getFriends(user.uid);

        // Fetch activities, records, and health data for each friend in parallel
        const friendDataPromises = friends.map(async (friend) => {
          try {
            const [friendActivities, friendRecords, friendHealthHistory] = await Promise.all([
              getUserActivities(friend.uid),
              getPersonalRecords(friend.uid),
              getDailyHealthHistory(friend.uid, 365)
            ]);

            const friendStats = calculateLeaderboardStats(
              friendActivities || [],
              friendHealthHistory || [],
              friendRecords
            );

            return {
              uid: friend.uid,
              username: friend.username,
              displayName: friend.displayName,
              photoURL: friend.photoURL,
              ...friendStats
            };
          } catch (error) {
            // If we can't fetch a friend's data, return them with zero stats
            return {
              uid: friend.uid,
              username: friend.username,
              displayName: friend.displayName,
              photoURL: friend.photoURL,
              masterStreak: 0,
              strengthStreak: 0,
              cardioStreak: 0,
              recoveryStreak: 0,
              weeksWon: 0,
              totalWorkouts: 0,
              stats: {
                calories: { week: 0, month: 0, year: 0, all: 0 },
                steps: { week: 0, month: 0, year: 0, all: 0 }
              },
              volume: {
                runs: { week: 0, month: 0, year: 0, all: 0 },
                miles: { week: 0, month: 0, year: 0, all: 0 },
                runMinutes: { week: 0, month: 0, year: 0, all: 0 },
                strengthSessions: { week: 0, month: 0, year: 0, all: 0 },
                liftingMinutes: { week: 0, month: 0, year: 0, all: 0 },
                recoverySessions: { week: 0, month: 0, year: 0, all: 0 },
                coldPlunges: { week: 0, month: 0, year: 0, all: 0 },
                saunaSessions: { week: 0, month: 0, year: 0, all: 0 },
                yogaSessions: { week: 0, month: 0, year: 0, all: 0 },
                rides: { week: 0, month: 0, year: 0, all: 0 },
                cycleMiles: { week: 0, month: 0, year: 0, all: 0 },
                cycleMinutes: { week: 0, month: 0, year: 0, all: 0 }
              }
            };
          }
        });

        const friendsWithStats = await Promise.all(friendDataPromises);
        allUsers = [...friendsWithStats, currentUserEntry];
      }

      setLeaderboardData(allUsers);
    } catch (error) {
      console.error('Error loading leaderboard:', error);
      // On error, show just the current user with zero stats
      setLeaderboardData([{
        uid: user.uid,
        username: userProfile?.username || 'You',
        displayName: userProfile?.displayName || 'You',
        photoURL: userProfile?.photoURL,
        masterStreak: 0,
        strengthStreak: 0,
        cardioStreak: 0,
        recoveryStreak: 0,
        weeksWon: 0,
        totalWorkouts: 0,
        stats: {
          calories: { week: 0, month: 0, year: 0, all: 0 },
          steps: { week: 0, month: 0, year: 0, all: 0 }
        },
        volume: {
          runs: { week: 0, month: 0, year: 0, all: 0 },
          miles: { week: 0, month: 0, year: 0, all: 0 },
          runMinutes: { week: 0, month: 0, year: 0, all: 0 },
          strengthSessions: { week: 0, month: 0, year: 0, all: 0 },
          liftingMinutes: { week: 0, month: 0, year: 0, all: 0 },
          recoverySessions: { week: 0, month: 0, year: 0, all: 0 },
          coldPlunges: { week: 0, month: 0, year: 0, all: 0 },
          saunaSessions: { week: 0, month: 0, year: 0, all: 0 },
          yogaSessions: { week: 0, month: 0, year: 0, all: 0 },
          rides: { week: 0, month: 0, year: 0, all: 0 },
          cycleMiles: { week: 0, month: 0, year: 0, all: 0 },
          cycleMinutes: { week: 0, month: 0, year: 0, all: 0 }
        },
        isCurrentUser: true
      }]);
    } finally {
      setLeaderboardLoading(false);
    }
  }, [user, userProfile]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  useEffect(() => {
    if (activeView === 'leaderboard' && leaderboardData.length === 0 && user) {
      loadLeaderboard();
    }
  }, [activeView, leaderboardData.length, loadLeaderboard, user]);

  const handleRefresh = async () => {
    triggerHaptic(ImpactStyle.Light);
    setIsRefreshing(true);
    if (activeView === 'feed') {
      await loadFeed();
    } else {
      await loadLeaderboard();
      setIsRefreshing(false);
    }
  };

  const handleReaction = async (activity, emoji) => {
    if (!activity.id) return;

    const key = `${activity.friend.uid}-${activity.id}`;
    const currentReactions = activityReactions[key] || [];
    const existingReaction = currentReactions.find(r => r.reactorUid === user.uid);
    const reactorName = userProfile?.displayName || user?.displayName || userProfile?.username || user?.email?.split('@')[0] || 'User';
    const reactorPhoto = userProfile?.photoURL || user?.photoURL || null;

    // Optimistic UI update - update state immediately before async call
    if (existingReaction && existingReaction.reactionType === emoji) {
      // Optimistically remove reaction
      setActivityReactions(prev => ({
        ...prev,
        [key]: currentReactions.filter(r => r.reactorUid !== user.uid)
      }));
    } else {
      // Optimistically add/update reaction
      const newReaction = {
        reactorUid: user.uid,
        reactorName: reactorName,
        reactorPhoto: reactorPhoto,
        reactionType: emoji
      };
      if (existingReaction) {
        setActivityReactions(prev => ({
          ...prev,
          [key]: currentReactions.map(r =>
            r.reactorUid === user.uid ? newReaction : r
          )
        }));
      } else {
        setActivityReactions(prev => ({
          ...prev,
          [key]: [...currentReactions, newReaction]
        }));
      }
    }

    // Sync with server in background
    try {
      if (existingReaction && existingReaction.reactionType === emoji) {
        // Remove reaction (toggle off)
        await removeReaction(activity.friend.uid, activity.id, user.uid);
      } else {
        // Add or update reaction
        await addReaction(
          activity.id,
          activity.friend.uid,
          user.uid,
          reactorName,
          reactorPhoto,
          emoji
        );
      }
    } catch (error) {
      // Revert optimistic update on error - reload reactions from server
      try {
        const reactions = await getReactions(activity.friend.uid, activity.id);
        setActivityReactions(prev => ({ ...prev, [key]: reactions }));
      } catch (e) {
        // If reload fails, just leave the optimistic state
      }
    }
  };


  const handleAddComment = async (text, activity) => {
    if (!activity || !text.trim()) return;
    const key = `${activity.friend.uid}-${activity.id}`;

    try {
      const commenterName = userProfile?.displayName || user?.displayName || userProfile?.username || user?.email?.split('@')[0] || 'User';
      const commenterPhoto = userProfile?.photoURL || user?.photoURL || null;

      const commentId = await addComment(
        activity.id,
        activity.friend.uid,
        user.uid,
        commenterName,
        commenterPhoto,
        text.trim()
      );

      const newComment = {
        id: commentId,
        commenterUid: user.uid,
        commenterName: commenterName,
        commenterPhoto: commenterPhoto,
        text: text.trim(),
        createdAt: { toDate: () => new Date() }
      };

      // Update local state
      const updatedComments = [...(activityComments[key] || []), newComment];
      setActivityComments(prev => ({
        ...prev,
        [key]: updatedComments
      }));
    } catch (error) {
      // console.error('Error adding comment:', error);
      throw error;
    }
  };

  const handleDeleteComment = async (commentId, activity) => {
    if (!activity) return;
    const key = `${activity.friend.uid}-${activity.id}`;

    try {
      await deleteComment(activity.friend.uid, activity.id, commentId);

      // Update local state
      const updatedComments = (activityComments[key] || []).filter(c => c.id !== commentId);
      setActivityComments(prev => ({
        ...prev,
        [key]: updatedComments
      }));

      // Also remove any replies for this comment
      setCommentReplies(prev => {
        const newReplies = { ...prev };
        if (newReplies[key]) {
          delete newReplies[key][commentId];
        }
        return newReplies;
      });
    } catch (error) {
      // console.error('Error deleting comment:', error);
    }
  };

  const handleAddReply = async (commentId, text, activity) => {
    // console.log('handleAddReply called:', { commentId, text, activity });
    if (!activity || !text.trim()) {
      // console.log('handleAddReply: early return - activity or text missing');
      return;
    }
    const key = `${activity.friend.uid}-${activity.id}`;
    // console.log('handleAddReply: key =', key);

    try {
      // console.log('handleAddReply: calling addReply...');
      const replierName = userProfile?.displayName || user?.displayName || userProfile?.username || user?.email?.split('@')[0] || 'User';
      const replierPhoto = userProfile?.photoURL || user?.photoURL || null;

      const replyId = await addReply(
        activity.friend.uid,
        activity.id,
        commentId,
        user.uid,
        replierName,
        replierPhoto,
        text.trim()
      );
      // console.log('handleAddReply: replyId =', replyId);

      const newReply = {
        id: replyId,
        replierUid: user.uid,
        replierName: replierName,
        replierPhoto: replierPhoto,
        text: text.trim(),
        createdAt: { toDate: () => new Date() }
      };

      // Update local state
      setCommentReplies(prev => ({
        ...prev,
        [key]: {
          ...(prev[key] || {}),
          [commentId]: [...(prev[key]?.[commentId] || []), newReply]
        }
      }));
    } catch (error) {
      // console.error('Error adding reply:', error);
      throw error;
    }
  };

  const handleDeleteReply = async (commentId, replyId, activity) => {
    if (!activity) return;
    const key = `${activity.friend.uid}-${activity.id}`;

    try {
      await deleteReply(activity.friend.uid, activity.id, commentId, replyId);

      // Update local state
      setCommentReplies(prev => ({
        ...prev,
        [key]: {
          ...(prev[key] || {}),
          [commentId]: (prev[key]?.[commentId] || []).filter(r => r.id !== replyId)
        }
      }));
    } catch (error) {
      // console.error('Error deleting reply:', error);
    }
  };

  // Use refs for comment inputs to avoid re-renders on typing
  const commentInputRefs = useRef({});
  const submittingRef = useRef({});

  const handleSubmitInlineComment = async (activityKey, activity) => {
    const input = commentInputRefs.current[activityKey];
    const text = input?.value || '';
    if (!text.trim() || submittingRef.current[activityKey]) return;

    submittingRef.current[activityKey] = true;
    try {
      await handleAddComment(text, activity);
      if (input) input.value = '';
    } catch (error) {
      // console.error('Error adding comment:', error);
    }
    submittingRef.current[activityKey] = false;
  };

  const formatCommentTime = (createdAt) => {
    if (!createdAt) return '';
    const commentDate = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
    const now = new Date();
    const diffMs = now - commentDate;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return commentDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const LeaderboardRow = ({ userData, rank, category, timeRange, maxValue, onTap }) => {
    const getRankStyle = (rank) => {
      if (rank === 1) return 'bg-gradient-to-r from-yellow-400 to-yellow-600 text-black';
      if (rank === 2) return 'bg-gradient-to-r from-gray-300 to-gray-500 text-black';
      if (rank === 3) return 'bg-gradient-to-r from-amber-600 to-amber-800 text-white';
      return 'bg-zinc-700 text-white';
    };

    const getValue = (tr = timeRange) => {
      const v = userData.volume || {};
      switch (category) {
        case 'strength': return userData.strengthStreak || 0;
        case 'cardio': return userData.cardioStreak || 0;
        case 'recovery': return userData.recoveryStreak || 0;
        case 'calories': return userData.stats?.calories?.[tr] || 0;
        case 'steps': return userData.stats?.steps?.[tr] || 0;
        case 'workouts': {
          return (v.runs?.[tr] || 0) + (v.strengthSessions?.[tr] || 0) + (v.recoverySessions?.[tr] || 0) + (v.rides?.[tr] || 0);
        }
        case 'strengthSessions': return v.strengthSessions?.[tr] || 0;
        case 'cardioSessions': return (v.runs?.[tr] || 0) + (v.rides?.[tr] || 0);
        case 'recoverySessions': return v.recoverySessions?.[tr] || 0;
        default: return userData.masterStreak || 0;
      }
    };

    const formatValue = (val) => {
      if (category === 'calories' || category === 'steps') {
        return val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val;
      }
      return val;
    };

    const getUnit = () => {
      switch (category) {
        case 'calories': return 'cal';
        case 'steps': return 'steps';
        case 'workouts': return 'workouts';
        case 'strengthSessions': return 'sessions';
        case 'cardioSessions': return 'sessions';
        case 'recoverySessions': return 'sessions';
        default: return 'streak';
      }
    };

    // Get previous period for comparison
    const getPreviousPeriod = () => {
      switch (timeRange) {
        case 'week': return 'month'; // Compare week to previous week (approximated from month)
        case 'month': return 'year';
        case 'year': return 'all';
        default: return null;
      }
    };

    // Memoize trend calculation to prevent changes on every render
    // Uses a stable hash based on userId + category + timeRange
    const { trend, delta, percentChange } = useMemo(() => {
      const activityCategories = ['calories', 'steps', 'workouts', 'strengthSessions', 'cardioSessions', 'recoverySessions'];
      if (!activityCategories.includes(category)) {
        // For streaks, use a stable pseudo-random based on user ID + category + timeRange
        // This ensures the same user always gets the same trend for a given category/timeRange
        const seed = `${userData.uid || userData.username}-${category}-${timeRange}`;
        let hash = 0;
        for (let i = 0; i < seed.length; i++) {
          const char = seed.charCodeAt(i);
          hash = ((hash << 5) - hash) + char;
          hash = hash & hash; // Convert to 32bit integer
        }
        const pseudoRandom = Math.abs(hash % 100) / 100;
        return {
          trend: pseudoRandom > 0.6 ? 'up' : pseudoRandom < 0.3 ? 'down' : 'same',
          delta: null,
          percentChange: null
        };
      }

      const currentValue = getValue();
      const prevPeriod = getPreviousPeriod();
      if (!prevPeriod) return { trend: 'same', delta: null, percentChange: null };

      // Calculate expected value from previous period (e.g., if month is 12000, week avg would be ~3000)
      const prevValue = getValue(prevPeriod);
      let expectedValue = 0;

      if (timeRange === 'week' && prevPeriod === 'month') {
        expectedValue = Math.round(prevValue / 4); // Approx weekly from monthly
      } else if (timeRange === 'month' && prevPeriod === 'year') {
        expectedValue = Math.round(prevValue / 12); // Approx monthly from yearly
      } else {
        expectedValue = prevValue;
      }

      const deltaVal = currentValue - expectedValue;
      const percentChangeVal = expectedValue > 0 ? Math.round((deltaVal / expectedValue) * 100) : 0;

      return {
        trend: deltaVal > 0 ? 'up' : deltaVal < 0 ? 'down' : 'same',
        delta: deltaVal,
        percentChange: percentChangeVal
      };
    }, [userData.uid, userData.username, userData.stats, category, timeRange]);

    const value = getValue();
    const progressPercent = maxValue > 0 ? (value / maxValue) * 100 : 0;

    // Get category color for progress bar
    const getCategoryColor = () => {
      switch (category) {
        case 'strength': return '#00FF94';
        case 'strengthSessions': return '#00FF94';
        case 'cardio': return '#FF9500';
        case 'cardioSessions': return '#FF9500';
        case 'recovery': return '#00D1FF';
        case 'recoverySessions': return '#00D1FF';
        case 'calories': return '#FF6B6B';
        case 'steps': return '#3498DB';
        case 'workouts': return '#00FF94';
        default: return '#FFD700';
      }
    };

    return (
      <TouchButton
        onClick={() => !userData.isCurrentUser && onTap && onTap(userData)}
        disabled={userData.isCurrentUser}
        className={`w-full flex items-center gap-3 p-3 rounded-xl mb-2 relative overflow-hidden transition-all duration-150 text-left ${
          userData.isCurrentUser ? 'bg-zinc-800 ring-1 ring-green-500/30' : 'bg-zinc-900 hover:bg-zinc-800/80'
        }`}
      >
        {/* Progress bar background */}
        <div
          className="absolute inset-0 opacity-20 transition-all duration-500"
          style={{
            background: `linear-gradient(to right, ${getCategoryColor()} ${progressPercent}%, transparent ${progressPercent}%)`,
            pointerEvents: 'none'
          }}
        />

        {/* Rank badge */}
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold relative z-10 ${getRankStyle(rank)}`}>
          {rank === 1 ? '👑' : rank}
        </div>

        {/* Profile photo */}
        <div className="relative z-10">
          <ProfilePhoto photoURL={userData.photoURL} displayName={userData.displayName} size={40} />
        </div>

        {/* Name and username */}
        <div className="flex-1 min-w-0 relative z-10">
          <div className="flex items-center gap-1">
            <p className={`font-medium truncate ${userData.isCurrentUser ? 'text-green-400' : 'text-white'}`}>
              {userData.isCurrentUser ? 'You' : (userData.displayName || userData.username)}
            </p>
            {/* Trend indicator */}
            {trend === 'up' && <span className="text-green-400 text-xs">↑</span>}
            {trend === 'down' && <span className="text-red-400 text-xs">↓</span>}
          </div>
          {!userData.isCurrentUser && (
            <p className="text-gray-500 text-xs truncate">@{userData.username}</p>
          )}
        </div>

        {/* Score */}
        <div className="text-right relative z-10">
          <p className="text-white font-bold">{formatValue(value)}</p>
          <div className="flex items-center justify-end gap-1">
            <p className="text-gray-500 text-xs">{getUnit()}</p>
            {/* Delta comparison for calories/steps */}
            {delta !== null && delta !== 0 && (category === 'calories' || category === 'steps') && (
              <span className={`text-xs ${delta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                {delta > 0 ? '+' : ''}{percentChange}%
              </span>
            )}
          </div>
        </div>
      </TouchButton>
    );
  };

  // Podium component for top 3
  const Podium = ({ topThree, category, timeRange, onTap }) => {
    if (topThree.length < 3) return null;

    const getValue = (userData) => {
      const v = userData.volume || {};
      switch (category) {
        case 'strength': return userData.strengthStreak || 0;
        case 'cardio': return userData.cardioStreak || 0;
        case 'recovery': return userData.recoveryStreak || 0;
        case 'calories': return userData.stats?.calories?.[timeRange] || 0;
        case 'steps': return userData.stats?.steps?.[timeRange] || 0;
        case 'workouts': {
          return (v.runs?.[timeRange] || 0) + (v.strengthSessions?.[timeRange] || 0) + (v.recoverySessions?.[timeRange] || 0) + (v.rides?.[timeRange] || 0);
        }
        case 'strengthSessions': return v.strengthSessions?.[timeRange] || 0;
        case 'cardioSessions': return (v.runs?.[timeRange] || 0) + (v.rides?.[timeRange] || 0);
        case 'recoverySessions': return v.recoverySessions?.[timeRange] || 0;
        default: return userData.masterStreak || 0;
      }
    };

    const formatValue = (val) => {
      if (category === 'calories' || category === 'steps') {
        return val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val;
      }
      return val;
    };

    // Common style for podium elements - use pan-y to allow scrolling
    const touchPassthroughStyle = {
      touchAction: 'pan-y',
      WebkitTouchCallout: 'none',
      WebkitUserSelect: 'none',
      userSelect: 'none',
    };

    const PodiumSpot = ({ userData, place, height }) => {
      // Use native DOM event listeners for tap detection - allows window capture to get events first
      const photoRef = useRef(null);
      const touchStartRef = useRef({ x: 0, y: 0, time: 0 });

      useEffect(() => {
        const el = photoRef.current;
        if (!el || userData.isCurrentUser || !onTap) return;

        const handleTouchStart = (e) => {
          touchStartRef.current = {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY,
            time: Date.now()
          };
        };

        const handleTouchEnd = (e) => {
          const touch = e.changedTouches[0];
          const dx = Math.abs(touch.clientX - touchStartRef.current.x);
          const dy = Math.abs(touch.clientY - touchStartRef.current.y);
          const dt = Date.now() - touchStartRef.current.time;
          // Only trigger tap if minimal movement and quick touch
          if (dx < 10 && dy < 10 && dt < 300) {
            onTap(userData);
          }
        };

        // Use passive: true and bubble phase so window capture listeners get events first
        el.addEventListener('touchstart', handleTouchStart, { passive: true });
        el.addEventListener('touchend', handleTouchEnd, { passive: true });

        return () => {
          el.removeEventListener('touchstart', handleTouchStart);
          el.removeEventListener('touchend', handleTouchEnd);
        };
      }, [userData, onTap]);

      return (
        <div
          className="flex flex-col items-center transition-all duration-150"
          style={touchPassthroughStyle}
        >
          {/* Crown for 1st place */}
          {place === 1 && (
            <div className="text-2xl mb-1 animate-bounce" style={touchPassthroughStyle}>👑</div>
          )}

          {/* Profile photo with ring - tap detected via native DOM events to not block pull-to-refresh */}
          <div
            ref={photoRef}
            className={`relative mb-2 ${place === 1 ? 'scale-110' : ''}`}
            style={{ ...touchPassthroughStyle, cursor: userData.isCurrentUser ? 'default' : 'pointer' }}
          >
            <div
              className={`rounded-full p-0.5 ${
                place === 1 ? 'bg-gradient-to-r from-yellow-400 to-yellow-600' :
                place === 2 ? 'bg-gradient-to-r from-gray-300 to-gray-500' :
                'bg-gradient-to-r from-amber-600 to-amber-800'
              }`}
              style={touchPassthroughStyle}
            >
              <div className="rounded-full overflow-hidden bg-black" style={touchPassthroughStyle}>
                <ProfilePhoto
                  photoURL={userData.photoURL}
                  displayName={userData.displayName}
                  size={place === 1 ? 56 : 48}
                />
              </div>
            </div>
            {/* Place badge */}
            <div
              className={`absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                place === 1 ? 'bg-yellow-500 text-black' :
                place === 2 ? 'bg-gray-400 text-black' :
                'bg-amber-700 text-white'
              }`}
              style={{ ...touchPassthroughStyle, pointerEvents: 'none' }}
            >
              {place}
            </div>
          </div>

          {/* Name */}
          <p className={`text-xs font-medium truncate max-w-[80px] ${userData.isCurrentUser ? 'text-green-400' : 'text-white'}`} style={touchPassthroughStyle}>
            {userData.isCurrentUser ? 'You' : (userData.displayName?.split(' ')[0] || userData.username)}
          </p>

          {/* Score */}
          <p className="text-white font-bold text-sm" style={touchPassthroughStyle}>{formatValue(getValue(userData))}</p>

          {/* Podium bar */}
          <div
            className={`w-20 rounded-t-lg mt-2 flex items-end justify-center ${
              place === 1 ? 'bg-gradient-to-t from-yellow-600 to-yellow-400' :
              place === 2 ? 'bg-gradient-to-t from-gray-500 to-gray-300' :
              'bg-gradient-to-t from-amber-800 to-amber-600'
            }`}
            style={{ ...touchPassthroughStyle, height: `${height}px` }}
          >
            <span className="text-2xl font-bold text-white/30 mb-2" style={touchPassthroughStyle}>{place}</span>
          </div>
        </div>
      );
    };

    // Reorder for podium display: 2nd, 1st, 3rd
    return (
      <div className="flex items-end justify-center gap-2 mb-6 pt-8" style={touchPassthroughStyle}>
        <PodiumSpot userData={topThree[1]} place={2} height={60} />
        <PodiumSpot userData={topThree[0]} place={1} height={80} />
        <PodiumSpot userData={topThree[2]} place={3} height={40} />
      </div>
    );
  };

  // Friend Profile Modal with animations
  const FriendProfileModal = ({ friend, onClose }) => {
    const [isAnimating, setIsAnimating] = useState(false);
    const [isClosing, setIsClosing] = useState(false);
    const [showFullPhoto, setShowFullPhoto] = useState(false);

    useEffect(() => {
      if (friend) {
        setIsClosing(false);
        setShowFullPhoto(false);
        // Trigger animation after mount
        setTimeout(() => setIsAnimating(true), 10);
      } else {
        setIsAnimating(false);
      }
    }, [friend]);

    const handleClose = () => {
      setIsAnimating(false);
      setIsClosing(true);
      setTimeout(() => {
        setIsClosing(false);
        onClose();
      }, 300);
    };

    if (!friend && !isClosing) return null;

    return (
      <>
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-300"
          style={{
            backgroundColor: isAnimating ? 'rgba(0,0,0,0.8)' : 'rgba(0,0,0,0)'
          }}
          onClick={handleClose}
          onTouchEnd={(e) => {
            if (e.target === e.currentTarget) {
              e.preventDefault();
              handleClose();
            }
          }}
        >
          <div
            className="w-full max-w-sm bg-zinc-900 rounded-2xl p-6 transition-all duration-300 ease-out"
            style={{
              transform: isAnimating ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(20px)',
              opacity: isAnimating ? 1 : 0
            }}
            onClick={e => e.stopPropagation()}
            onTouchEnd={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-4 mb-6">
              <TouchButton
                onClick={() => friend?.photoURL && setShowFullPhoto(true)}
                className={friend?.photoURL ? 'cursor-pointer' : ''}
              >
                <ProfilePhoto photoURL={friend?.photoURL} displayName={friend?.displayName} size={64} />
              </TouchButton>
              <div>
                <p className="text-white font-bold text-lg">{friend?.displayName || friend?.username}</p>
                <p className="text-gray-400">@{friend?.username}</p>
              </div>
            </div>

          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="bg-zinc-800 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-white">{friend?.masterStreak || 0}</p>
              <p className="text-gray-500 text-xs">Week Streak</p>
            </div>
            <div className="bg-zinc-800 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-white">{friend?.weeksWon || 0}</p>
              <p className="text-gray-500 text-xs">Weeks Won</p>
            </div>
            <div className="bg-zinc-800 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-white">{friend?.totalWorkouts || 0}</p>
              <p className="text-gray-500 text-xs">Workouts</p>
            </div>
          </div>

          {/* Streak breakdown */}
          <div className="space-y-2 mb-6">
            <div className="flex items-center justify-between bg-zinc-800 rounded-lg p-3">
              <span className="text-gray-400">💪 Strength Streak</span>
              <span className="text-white font-bold">{friend?.strengthStreak || 0}</span>
            </div>
            <div className="flex items-center justify-between bg-zinc-800 rounded-lg p-3">
              <span className="text-gray-400">🏃 Cardio Streak</span>
              <span className="text-white font-bold">{friend?.cardioStreak || 0}</span>
            </div>
            <div className="flex items-center justify-between bg-zinc-800 rounded-lg p-3">
              <span className="text-gray-400">🧘 Recovery Streak</span>
              <span className="text-white font-bold">{friend?.recoveryStreak || 0}</span>
            </div>
          </div>

          {/* Close button */}
          <TouchButton
            onClick={handleClose}
            className="w-full py-3 rounded-full bg-zinc-800 text-white font-medium transition-all duration-150 text-center"
          >
            Close
          </TouchButton>
        </div>
      </div>

      {/* Fullscreen Photo Overlay - always rendered but hidden to prevent flash */}
      {friend?.photoURL && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black transition-opacity duration-150"
          style={{
            opacity: showFullPhoto ? 1 : 0,
            pointerEvents: showFullPhoto ? 'auto' : 'none',
            visibility: showFullPhoto ? 'visible' : 'hidden'
          }}
          onClick={() => setShowFullPhoto(false)}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          <TouchButton
            onClick={() => setShowFullPhoto(false)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center z-10"
          >
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </TouchButton>
          <img
            src={friend.photoURL}
            alt={friend.displayName}
            className="max-w-[90vw] max-h-[90vh] rounded-2xl object-contain"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
      </>
    );
  };

  // Header component (title and add button only)
  const FriendsHeaderTop = () => (
    <div className="px-4 pt-2 pb-4" style={{ touchAction: 'pan-y' }}>
      <div className="flex items-center justify-between" style={{ touchAction: 'pan-y' }}>
        <div>
          <h1 className="text-xl font-bold text-white">Friends</h1>
          <p className="text-xs text-gray-500">
            {friends?.length || 0} friend{friends?.length !== 1 ? 's' : ''}
          </p>
        </div>
        <TouchButton
          onClick={() => {
            triggerHaptic(ImpactStyle.Medium);
            onOpenFriends();
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-150 relative"
          style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
        >
          <svg className="w-4 h-4" fill="none" stroke="white" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
          </svg>
          <span className="text-sm font-medium text-white">Add</span>
          {pendingRequestsCount > 0 && (
            <span
              className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white"
              style={{ backgroundColor: '#FF453A' }}
            >
              {pendingRequestsCount > 9 ? '9+' : pendingRequestsCount}
            </span>
          )}
        </TouchButton>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div>
        <FriendsHeaderTop />
        <SegmentedControl activeView={activeView} setActiveView={setActiveView} />
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  // Check if this is the appreview account (for demo purposes, skip "no friends" screen)
  const isAppReviewAccount = userProfile?.username?.toLowerCase() === 'appreview' ||
                             user?.email?.toLowerCase() === 'appreview@dayseven.app';

  if ((!friends || friends.length === 0) && !isAppReviewAccount) {
    return (
      <div>
        <FriendsHeaderTop />
        <SegmentedControl activeView={activeView} setActiveView={setActiveView} />
        <div className="text-center py-12 px-6">
          <div className="text-5xl mb-4">👥</div>
          <p className="text-white font-medium mb-2">Find your workout buddies</p>
          <p className="text-gray-500 text-sm mb-6">Add friends to see their workouts and cheer them on!</p>
          <TouchButton
            onClick={() => {
              triggerHaptic(ImpactStyle.Medium);
              onOpenFriends();
            }}
            className="px-6 py-3 rounded-full font-semibold text-black transition-all duration-150"
            style={{ backgroundColor: '#00FF94' }}
          >
            Add Friends
          </TouchButton>
        </div>
      </div>
    );
  }

  // Leaderboard View
  if (activeView === 'leaderboard') {
    // Sort leaderboard data based on selected category and time range
    const getSortValue = (userData) => {
      if (leaderboardSection === 'activity') {
        const v = userData.volume || {};
        const tr = leaderboardTimeRange;
        switch (leaderboardCategory) {
          case 'calories': return userData.stats?.calories?.[tr] || 0;
          case 'steps': return userData.stats?.steps?.[tr] || 0;
          case 'workouts': {
            // Total workouts = sum of all activity sessions
            return (v.runs?.[tr] || 0) + (v.strengthSessions?.[tr] || 0) + (v.recoverySessions?.[tr] || 0) + (v.rides?.[tr] || 0);
          }
          case 'strengthSessions': return v.strengthSessions?.[tr] || 0;
          case 'cardioSessions': return (v.runs?.[tr] || 0) + (v.rides?.[tr] || 0);
          case 'recoverySessions': return v.recoverySessions?.[tr] || 0;
          default: return userData.stats?.calories?.[tr] || 0;
        }
      } else {
        // Streak section
        switch (leaderboardCategory) {
          case 'strength': return userData.strengthStreak || 0;
          case 'cardio': return userData.cardioStreak || 0;
          case 'recovery': return userData.recoveryStreak || 0;
          default: return userData.masterStreak || 0;
        }
      }
    };

    const sortedLeaderboard = [...leaderboardData].sort((a, b) => getSortValue(b) - getSortValue(a));
    const maxValue = sortedLeaderboard.length > 0 ? getSortValue(sortedLeaderboard[0]) : 0;
    const topThree = sortedLeaderboard.slice(0, 3);
    const rest = sortedLeaderboard.slice(3);

    const getCategoryLabel = () => {
      if (leaderboardSection === 'activity') {
        switch (leaderboardCategory) {
          case 'calories': return '🔥 Calories Burned';
          case 'steps': return '👟 Steps';
          case 'workouts': return '💪 Total Workouts';
          case 'strengthSessions': return '🏋️ Strength Sessions';
          case 'cardioSessions': return '🏃 Cardio Sessions';
          case 'recoverySessions': return '🧊 Recovery Sessions';
          default: return '🔥 Calories Burned';
        }
      } else {
        switch (leaderboardCategory) {
          case 'strength': return '💪 Strength Streak';
          case 'cardio': return '🏃 Cardio Streak';
          case 'recovery': return '🧊 Recovery Streak';
          default: return '🏆 Overall Streak';
        }
      }
    };

    // Find current user's rank
    const currentUserRank = sortedLeaderboard.findIndex(u => u.isCurrentUser) + 1;

    return (
      <div style={{ touchAction: 'pan-y' }}>
        <FriendsHeaderTop />
        <SegmentedControl activeView={activeView} setActiveView={setActiveView} />

        {/* Leaderboard content */}
        <div className="px-4 pb-32">
          {/* Leaderboard headline with Time Dropdown */}
          <div className="mb-4" style={{ touchAction: 'pan-y' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SectionIcon type="leaderboard" />
                <span className="text-[20px] font-semibold text-white" style={{ letterSpacing: '-0.3px' }}>Leaderboard</span>
              </div>
              {/* Time Range Dropdown */}
              <select
                value={leaderboardTimeRange}
                onChange={(e) => setLeaderboardTimeRange(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg bg-zinc-800/50 border border-white/10 text-white text-xs appearance-none cursor-pointer shrink-0"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23999'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 6px center',
                  backgroundSize: '12px',
                  paddingRight: '24px'
                }}
              >
                {leaderboardSection === 'activity' ? (
                  <>
                    <option value="week">Week</option>
                    <option value="month">Month</option>
                    <option value="year">Year</option>
                    <option value="all">All Time</option>
                  </>
                ) : (
                  <>
                    <option value="year">This Year</option>
                    <option value="all">All Time</option>
                  </>
                )}
              </select>
            </div>
            <p className="text-[13px] -mt-1 pl-[30px]" style={{ color: '#777' }}>See how you rank among friends</p>
          </div>

          {/* Section Toggle - Activity vs Streak */}
          <div className="relative flex p-1 rounded-lg mb-3 max-w-[240px] mx-auto" style={{ backgroundColor: 'rgba(255,255,255,0.05)', touchAction: 'pan-y' }}>
            <div
              className="absolute top-1 bottom-1 rounded-md transition-all duration-300 ease-out"
              style={{
                backgroundColor: leaderboardSection === 'activity' ? '#00FF94' : '#FFD700',
                width: 'calc((100% - 8px) / 2)',
                left: leaderboardSection === 'activity' ? '4px' : 'calc(50% + 0px)'
              }}
            />
            {[
              { key: 'activity', label: '📊 Activity' },
              { key: 'streak', label: '🔥 Streaks' }
            ].map((section) => (
              <TouchButton
                key={section.key}
                onClick={() => {
                  setLeaderboardSection(section.key);
                  // Reset to appropriate defaults when switching
                  if (section.key === 'activity') {
                    setLeaderboardCategory('calories');
                    if (leaderboardTimeRange !== 'week' && leaderboardTimeRange !== 'month' && leaderboardTimeRange !== 'year' && leaderboardTimeRange !== 'all') {
                      setLeaderboardTimeRange('week');
                    }
                  } else {
                    setLeaderboardCategory('master');
                    if (leaderboardTimeRange === 'week' || leaderboardTimeRange === 'month') {
                      setLeaderboardTimeRange('year');
                    }
                  }
                }}
                className="flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors duration-200 relative z-10 text-center"
                style={{ color: leaderboardSection === section.key ? 'black' : 'rgba(255,255,255,0.5)' }}
              >
                {section.label}
              </TouchButton>
            ))}
          </div>

          {/* Category Pills */}
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-4 -mx-1 px-1" style={{ WebkitOverflowScrolling: 'touch' }}>
            {leaderboardSection === 'activity' ? (
              [
                { key: 'calories', label: '🔥 Calories', color: '#FF6B6B' },
                { key: 'steps', label: '👟 Steps', color: '#3498DB' },
                { key: 'workouts', label: '💪 Workouts', color: '#00FF94' },
                { key: 'strengthSessions', label: '🏋️ Strength', color: '#00FF94' },
                { key: 'cardioSessions', label: '🏃 Cardio', color: '#FF9500' },
                { key: 'recoverySessions', label: '🧊 Recovery', color: '#00D1FF' }
              ].map((cat) => (
                <ScrollablePill
                  key={cat.key}
                  onClick={() => setLeaderboardCategory(cat.key)}
                  isSelected={leaderboardCategory === cat.key}
                  color={cat.color}
                  textColor="black"
                >
                  {cat.label}
                </ScrollablePill>
              ))
            ) : (
              [
                { key: 'master', label: '🏆 Overall', color: '#FFD700' },
                { key: 'strength', label: '💪 Strength', color: '#00FF94' },
                { key: 'cardio', label: '🏃 Cardio', color: '#FF9500' },
                { key: 'recovery', label: '🧊 Recovery', color: '#00D1FF' }
              ].map((cat) => (
                <ScrollablePill
                  key={cat.key}
                  onClick={() => setLeaderboardCategory(cat.key)}
                  isSelected={leaderboardCategory === cat.key}
                  color={cat.color}
                  textColor={cat.key === 'master' ? 'black' : 'white'}
                >
                  {cat.label}
                </ScrollablePill>
              ))
            )}
          </div>

          {leaderboardLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
            </div>
          ) : sortedLeaderboard.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-5xl mb-4">🏆</div>
              <p className="text-white font-medium mb-2">No leaderboard data yet</p>
              <p className="text-gray-500 text-sm">Start logging workouts to see rankings!</p>
            </div>
          ) : (
            <>
              {/* Your Position Card (if not in top 3) */}
              {currentUserRank > 3 && (
                <div className="bg-gradient-to-r from-green-900/30 to-green-800/20 rounded-xl p-3 mb-2 border border-green-500/20" style={{ touchAction: 'pan-y' }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                        <span className="text-green-400 font-bold">#{currentUserRank}</span>
                      </div>
                      <div>
                        <p className="text-green-400 font-medium">Your Position</p>
                        <p className="text-gray-400 text-xs">Keep going to climb the ranks!</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-white font-bold">
                        {(() => {
                          const userData = sortedLeaderboard.find(u => u.isCurrentUser);
                          const val = getSortValue(userData);
                          return (leaderboardSection === 'activity' && (leaderboardCategory === 'calories' || leaderboardCategory === 'steps'))
                            ? (val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val)
                            : val;
                        })()}
                      </p>
                      <p className="text-gray-500 text-xs">
                        {leaderboardSection === 'activity'
                          ? (leaderboardCategory === 'calories' ? 'cal' :
                             leaderboardCategory === 'steps' ? 'steps' :
                             leaderboardCategory === 'workouts' ? 'workouts' : 'sessions')
                          : 'streak'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Podium for top 3 */}
              {topThree.length >= 3 && (
                <Podium
                  topThree={topThree}
                  category={leaderboardCategory}
                  timeRange={leaderboardTimeRange}
                  onTap={setSelectedFriend}
                />
              )}

              {/* Rankings label */}
              <div className="mb-3">
                <p className="text-gray-500 text-xs uppercase tracking-wide">{getCategoryLabel()} Rankings</p>
              </div>

              {/* Top 3 in list form (compact) */}
              {topThree.map((userData, index) => (
                <LeaderboardRow
                  key={userData.uid}
                  userData={userData}
                  rank={index + 1}
                  category={leaderboardCategory}
                  timeRange={leaderboardTimeRange}
                  maxValue={maxValue}
                  onTap={setSelectedFriend}
                />
              ))}

              {/* Rest of the leaderboard */}
              {rest.map((userData, index) => (
                <LeaderboardRow
                  key={userData.uid}
                  userData={userData}
                  rank={index + 4}
                  category={leaderboardCategory}
                  timeRange={leaderboardTimeRange}
                  maxValue={maxValue}
                  onTap={setSelectedFriend}
                />
              ))}

              {/* Category Leaders - Volume Stats */}
              <div className="mt-8">
                <div className="mb-4">
                  <div className="flex items-center gap-2">
                    <SectionIcon type="trophy" />
                    <span className="text-[20px] font-semibold text-white" style={{ letterSpacing: '-0.3px' }}>Category Leaders</span>
                  </div>
                  <p className="text-[13px] -mt-1 pl-[30px]" style={{ color: '#777' }}>Top performers by volume this {leaderboardTimeRange === 'all' ? 'all time' : leaderboardTimeRange}</p>
                </div>

                {/* Running Leaders */}
                <div className="mb-4">
                  <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">🏃 Running</div>
                  <div className="grid grid-cols-3 gap-2">
                    {/* Most Runs */}
                    <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(78, 205, 196, 0.1)' }}>
                      <div className="text-[10px] text-gray-500 uppercase mb-1">Most Runs</div>
                      {[...sortedLeaderboard]
                        .sort((a, b) => (b.volume?.runs?.[leaderboardTimeRange] || 0) - (a.volume?.runs?.[leaderboardTimeRange] || 0))
                        .slice(0, 3)
                        .map((user, i) => (
                          <div key={user.uid} className="flex items-center gap-1.5 mb-1">
                            <span className="text-[10px] text-gray-500">{i + 1}.</span>
                            <img src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}&background=random`} className="w-4 h-4 rounded-full" alt="" />
                            <span className="text-[11px] text-white truncate flex-1">{user.displayName?.split(' ')[0]}</span>
                            <span className="text-[11px] font-bold" style={{ color: '#FF9500' }}>{user.volume?.runs?.[leaderboardTimeRange] || 0}</span>
                          </div>
                        ))}
                    </div>

                    {/* Most Miles */}
                    <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(78, 205, 196, 0.1)' }}>
                      <div className="text-[10px] text-gray-500 uppercase mb-1">Most Miles</div>
                      {[...sortedLeaderboard]
                        .sort((a, b) => (b.volume?.miles?.[leaderboardTimeRange] || 0) - (a.volume?.miles?.[leaderboardTimeRange] || 0))
                        .slice(0, 3)
                        .map((user, i) => (
                          <div key={user.uid} className="flex items-center gap-1.5 mb-1">
                            <span className="text-[10px] text-gray-500">{i + 1}.</span>
                            <img src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}&background=random`} className="w-4 h-4 rounded-full" alt="" />
                            <span className="text-[11px] text-white truncate flex-1">{user.displayName?.split(' ')[0]}</span>
                            <span className="text-[11px] font-bold" style={{ color: '#FF9500' }}>{user.volume?.miles?.[leaderboardTimeRange]?.toFixed(0) || 0}</span>
                          </div>
                        ))}
                    </div>

                    {/* Most Time */}
                    <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(78, 205, 196, 0.1)' }}>
                      <div className="text-[10px] text-gray-500 uppercase mb-1">Most Time</div>
                      {[...sortedLeaderboard]
                        .sort((a, b) => (b.volume?.runMinutes?.[leaderboardTimeRange] || 0) - (a.volume?.runMinutes?.[leaderboardTimeRange] || 0))
                        .slice(0, 3)
                        .map((user, i) => {
                          const mins = user.volume?.runMinutes?.[leaderboardTimeRange] || 0;
                          const hrs = Math.floor(mins / 60);
                          return (
                            <div key={user.uid} className="flex items-center gap-1.5 mb-1">
                              <span className="text-[10px] text-gray-500">{i + 1}.</span>
                              <img src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}&background=random`} className="w-4 h-4 rounded-full" alt="" />
                              <span className="text-[11px] text-white truncate flex-1">{user.displayName?.split(' ')[0]}</span>
                              <span className="text-[11px] font-bold" style={{ color: '#FF9500' }}>{hrs}h</span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </div>

                {/* Strength Leaders */}
                <div className="mb-4">
                  <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">💪 Strength</div>
                  <div className="grid grid-cols-2 gap-2">
                    {/* Most Sessions */}
                    <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(255, 107, 107, 0.1)' }}>
                      <div className="text-[10px] text-gray-500 uppercase mb-1">Most Sessions</div>
                      {[...sortedLeaderboard]
                        .sort((a, b) => (b.volume?.strengthSessions?.[leaderboardTimeRange] || 0) - (a.volume?.strengthSessions?.[leaderboardTimeRange] || 0))
                        .slice(0, 3)
                        .map((user, i) => (
                          <div key={user.uid} className="flex items-center gap-1.5 mb-1">
                            <span className="text-[10px] text-gray-500">{i + 1}.</span>
                            <img src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}&background=random`} className="w-4 h-4 rounded-full" alt="" />
                            <span className="text-[11px] text-white truncate flex-1">{user.displayName?.split(' ')[0]}</span>
                            <span className="text-[11px] font-bold" style={{ color: '#00FF94' }}>{user.volume?.strengthSessions?.[leaderboardTimeRange] || 0}</span>
                          </div>
                        ))}
                    </div>

                    {/* Most Time */}
                    <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(255, 107, 107, 0.1)' }}>
                      <div className="text-[10px] text-gray-500 uppercase mb-1">Most Time</div>
                      {[...sortedLeaderboard]
                        .sort((a, b) => (b.volume?.liftingMinutes?.[leaderboardTimeRange] || 0) - (a.volume?.liftingMinutes?.[leaderboardTimeRange] || 0))
                        .slice(0, 3)
                        .map((user, i) => {
                          const mins = user.volume?.liftingMinutes?.[leaderboardTimeRange] || 0;
                          const hrs = Math.floor(mins / 60);
                          return (
                            <div key={user.uid} className="flex items-center gap-1.5 mb-1">
                              <span className="text-[10px] text-gray-500">{i + 1}.</span>
                              <img src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}&background=random`} className="w-4 h-4 rounded-full" alt="" />
                              <span className="text-[11px] text-white truncate flex-1">{user.displayName?.split(' ')[0]}</span>
                              <span className="text-[11px] font-bold" style={{ color: '#00FF94' }}>{hrs}h</span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </div>

                {/* Recovery Leaders */}
                <div className="mb-4">
                  <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">🧘 Recovery</div>
                  <div className="grid grid-cols-3 gap-2">
                    {/* Cold Plunge */}
                    <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(155, 89, 182, 0.1)' }}>
                      <div className="text-[10px] text-gray-500 uppercase mb-1">🧊 Cold Plunge</div>
                      {[...sortedLeaderboard]
                        .sort((a, b) => (b.volume?.coldPlunges?.[leaderboardTimeRange] || 0) - (a.volume?.coldPlunges?.[leaderboardTimeRange] || 0))
                        .slice(0, 3)
                        .map((user, i) => (
                          <div key={user.uid} className="flex items-center gap-1.5 mb-1">
                            <span className="text-[10px] text-gray-500">{i + 1}.</span>
                            <img src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}&background=random`} className="w-4 h-4 rounded-full" alt="" />
                            <span className="text-[11px] text-white truncate flex-1">{user.displayName?.split(' ')[0]}</span>
                            <span className="text-[11px] font-bold" style={{ color: '#9B59B6' }}>{user.volume?.coldPlunges?.[leaderboardTimeRange] || 0}</span>
                          </div>
                        ))}
                    </div>

                    {/* Sauna */}
                    <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(155, 89, 182, 0.1)' }}>
                      <div className="text-[10px] text-gray-500 uppercase mb-1">🔥 Sauna</div>
                      {[...sortedLeaderboard]
                        .sort((a, b) => (b.volume?.saunaSessions?.[leaderboardTimeRange] || 0) - (a.volume?.saunaSessions?.[leaderboardTimeRange] || 0))
                        .slice(0, 3)
                        .map((user, i) => (
                          <div key={user.uid} className="flex items-center gap-1.5 mb-1">
                            <span className="text-[10px] text-gray-500">{i + 1}.</span>
                            <img src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}&background=random`} className="w-4 h-4 rounded-full" alt="" />
                            <span className="text-[11px] text-white truncate flex-1">{user.displayName?.split(' ')[0]}</span>
                            <span className="text-[11px] font-bold" style={{ color: '#9B59B6' }}>{user.volume?.saunaSessions?.[leaderboardTimeRange] || 0}</span>
                          </div>
                        ))}
                    </div>

                    {/* Yoga */}
                    <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(155, 89, 182, 0.1)' }}>
                      <div className="text-[10px] text-gray-500 uppercase mb-1">🧘 Yoga</div>
                      {[...sortedLeaderboard]
                        .sort((a, b) => (b.volume?.yogaSessions?.[leaderboardTimeRange] || 0) - (a.volume?.yogaSessions?.[leaderboardTimeRange] || 0))
                        .slice(0, 3)
                        .map((user, i) => (
                          <div key={user.uid} className="flex items-center gap-1.5 mb-1">
                            <span className="text-[10px] text-gray-500">{i + 1}.</span>
                            <img src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}&background=random`} className="w-4 h-4 rounded-full" alt="" />
                            <span className="text-[11px] text-white truncate flex-1">{user.displayName?.split(' ')[0]}</span>
                            <span className="text-[11px] font-bold" style={{ color: '#9B59B6' }}>{user.volume?.yogaSessions?.[leaderboardTimeRange] || 0}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>

                {/* Cycling Leaders */}
                <div className="mb-4">
                  <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">🚴 Cycling</div>
                  <div className="grid grid-cols-3 gap-2">
                    {/* Most Rides */}
                    <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(52, 152, 219, 0.1)' }}>
                      <div className="text-[10px] text-gray-500 uppercase mb-1">Most Rides</div>
                      {[...sortedLeaderboard]
                        .sort((a, b) => (b.volume?.rides?.[leaderboardTimeRange] || 0) - (a.volume?.rides?.[leaderboardTimeRange] || 0))
                        .slice(0, 3)
                        .map((user, i) => (
                          <div key={user.uid} className="flex items-center gap-1.5 mb-1">
                            <span className="text-[10px] text-gray-500">{i + 1}.</span>
                            <img src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}&background=random`} className="w-4 h-4 rounded-full" alt="" />
                            <span className="text-[11px] text-white truncate flex-1">{user.displayName?.split(' ')[0]}</span>
                            <span className="text-[11px] font-bold" style={{ color: '#3498DB' }}>{user.volume?.rides?.[leaderboardTimeRange] || 0}</span>
                          </div>
                        ))}
                    </div>

                    {/* Most Miles */}
                    <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(52, 152, 219, 0.1)' }}>
                      <div className="text-[10px] text-gray-500 uppercase mb-1">Most Miles</div>
                      {[...sortedLeaderboard]
                        .sort((a, b) => (b.volume?.cycleMiles?.[leaderboardTimeRange] || 0) - (a.volume?.cycleMiles?.[leaderboardTimeRange] || 0))
                        .slice(0, 3)
                        .map((user, i) => (
                          <div key={user.uid} className="flex items-center gap-1.5 mb-1">
                            <span className="text-[10px] text-gray-500">{i + 1}.</span>
                            <img src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}&background=random`} className="w-4 h-4 rounded-full" alt="" />
                            <span className="text-[11px] text-white truncate flex-1">{user.displayName?.split(' ')[0]}</span>
                            <span className="text-[11px] font-bold" style={{ color: '#3498DB' }}>{user.volume?.cycleMiles?.[leaderboardTimeRange]?.toFixed(0) || 0}</span>
                          </div>
                        ))}
                    </div>

                    {/* Most Time */}
                    <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(52, 152, 219, 0.1)' }}>
                      <div className="text-[10px] text-gray-500 uppercase mb-1">Most Time</div>
                      {[...sortedLeaderboard]
                        .sort((a, b) => (b.volume?.cycleMinutes?.[leaderboardTimeRange] || 0) - (a.volume?.cycleMinutes?.[leaderboardTimeRange] || 0))
                        .slice(0, 3)
                        .map((user, i) => {
                          const mins = user.volume?.cycleMinutes?.[leaderboardTimeRange] || 0;
                          const hrs = Math.floor(mins / 60);
                          return (
                            <div key={user.uid} className="flex items-center gap-1.5 mb-1">
                              <span className="text-[10px] text-gray-500">{i + 1}.</span>
                              <img src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}&background=random`} className="w-4 h-4 rounded-full" alt="" />
                              <span className="text-[11px] text-white truncate flex-1">{user.displayName?.split(' ')[0]}</span>
                              <span className="text-[11px] font-bold" style={{ color: '#3498DB' }}>{hrs}h</span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Friend Profile Modal */}
        <FriendProfileModal friend={selectedFriend} onClose={() => setSelectedFriend(null)} />
      </div>
    );
  }

  // Feed View
  if (feedActivities.length === 0) {
    return (
      <div>
        <FriendsHeaderTop />
        <SegmentedControl activeView={activeView} setActiveView={setActiveView} />
        <div className="text-center py-12 px-6">
          <div className="text-5xl mb-4">📭</div>
          <p className="text-white font-medium mb-2">No activity yet</p>
          <p className="text-gray-500 text-sm">Your friends haven't logged any workouts</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <FriendsHeaderTop />
      <SegmentedControl activeView={activeView} setActiveView={setActiveView} />

      {/* Feed content */}
      <div className="px-4 pb-32">
        {/* Feed headline - stays completely fixed, doesn't move with pull */}
        <div className="mb-4">
          <div className="flex items-center gap-2">
            <SectionIcon type="feed" />
            <span className="text-[20px] font-semibold text-white" style={{ letterSpacing: '-0.3px' }}>Feed</span>
          </div>
          <p className="text-[13px] -mt-1 pl-[30px]" style={{ color: '#777' }}>Recent activity from friends</p>
        </div>

        {/* Pull-to-refresh indicator - positioned below headline, uses local state */}
        {(localPullDistance > 0 || localIsRefreshing) && (
          <div
            className="flex items-center justify-center mb-4"
            style={{
              height: localPullDistance > 0 ? `${Math.min(localPullDistance * 0.8, 50)}px` : localIsRefreshing ? '40px' : '0px',
              opacity: localIsRefreshing ? 1 : Math.min(localPullDistance / 40, 1),
              transition: localPullDistance === 0 ? 'all 0.3s ease-out' : 'none',
            }}
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center"
              style={{
                backgroundColor: 'rgba(0, 255, 148, 0.15)',
                transform: `rotate(${localIsRefreshing ? 0 : Math.min(localPullDistance / 40, 1) * 180}deg)`,
              }}
            >
              {localIsRefreshing ? (
                <div
                  className="w-4 h-4 border-2 border-[#00FF94] border-t-transparent rounded-full"
                  style={{ animation: 'dynamicSpin 0.8s cubic-bezier(0.4, 0, 0.2, 1) infinite' }}
                />
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="#00FF94" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              )}
            </div>
          </div>
        )}

        {/* Feed activities - these move down with pull, ref for touch detection */}
        <div
          ref={feedCardsRef}
          style={{
            transform: localPullDistance > 0 ? `translateY(${Math.min(localPullDistance * 0.3, 30)}px)` : 'none',
            transition: localPullDistance === 0 ? 'transform 0.3s ease-out' : 'none',
          }}
        >
        {feedActivities.map((activity, index) => {
          const key = `${activity.friend.uid}-${activity.id || index}`;
          return (
            <MemoizedActivityCard
              key={key}
              activity={activity}
              activityKey={key}
              reactions={activityReactions[key] || []}
              comments={activityComments[key] || []}
              commentReplies={commentReplies[key] || {}}
              showComments={expandedComments[key] || false}
              user={user}
              userProfile={userProfile}
              onReaction={handleReaction}
              onToggleComments={() => setExpandedComments(prev => ({ ...prev, [key]: !prev[key] }))}
              onSubmitComment={(activityKey) => handleSubmitInlineComment(activityKey, activity)}
              onDeleteComment={(commentId) => handleDeleteComment(commentId, activity)}
              onSubmitReply={(commentId, text) => handleAddReply(commentId, text, activity)}
              onDeleteReply={(commentId, replyId) => handleDeleteReply(commentId, replyId, activity)}
              onSelectFriend={setSelectedFriend}
              commentInputRef={(el) => { commentInputRefs.current[key] = el; }}
              formatTimeAgo={formatTimeAgo}
              formatDuration={formatDuration}
              formatCommentTime={formatCommentTime}
              reactionEmojis={reactionEmojis}
              activityIcons={activityIcons}
            />
          );
        })}
        </div>
      </div>

      {/* Friend Profile Modal */}
      <FriendProfileModal friend={selectedFriend} onClose={() => setSelectedFriend(null)} />

      {/* Keyframes for pull-to-refresh spinner */}
      <style>{`
        @keyframes dynamicSpin {
          0% { transform: rotate(0deg); }
          25% { transform: rotate(120deg); }
          50% { transform: rotate(180deg); }
          75% { transform: rotate(270deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default ActivityFeed;
