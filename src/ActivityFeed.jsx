import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getUserActivities } from './services/userService';
import { addReaction, getReactions, removeReaction, addComment, getComments, deleteComment } from './services/friendService';
import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';

// TouchButton component - fires action reliably on touch devices
// Tracks touch position and fires on touchend if finger hasn't moved (prevents scroll conflicts)
const TouchButton = ({ onClick, disabled = false, className, style, children }) => {
  const touchStartPos = useRef(null);
  const hasMoved = useRef(false);
  const touchHandled = useRef(false); // Prevent double-fire from click after touchend
  const buttonRef = useRef(null);

  const handleTouchStart = (e) => {
    if (disabled) return;
    touchStartPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    hasMoved.current = false;
    touchHandled.current = false;
    if (buttonRef.current) {
      buttonRef.current.style.transform = 'scale(0.95)';
    }
  };

  const handleTouchMove = (e) => {
    if (!touchStartPos.current) return;
    const dx = Math.abs(e.touches[0].clientX - touchStartPos.current.x);
    const dy = Math.abs(e.touches[0].clientY - touchStartPos.current.y);
    // If moved more than 10px, consider it a scroll/swipe
    if (dx > 10 || dy > 10) {
      hasMoved.current = true;
      // Reset scale when scrolling starts
      if (buttonRef.current) {
        buttonRef.current.style.transform = '';
      }
    }
  };

  const handleTouchEnd = (e) => {
    if (buttonRef.current) {
      buttonRef.current.style.transform = '';
    }
    if (disabled || hasMoved.current || !touchStartPos.current) {
      touchStartPos.current = null;
      return;
    }
    // Fire the action on touchend for reliability
    if (onClick) {
      e.preventDefault(); // Prevent the delayed click event
      touchHandled.current = true;
      onClick(e);
    }
    touchStartPos.current = null;
  };

  const handleTouchCancel = () => {
    // Reset state if touch is cancelled (e.g., system gesture)
    if (buttonRef.current) {
      buttonRef.current.style.transform = '';
    }
    touchStartPos.current = null;
    hasMoved.current = false;
  };

  const handleClick = (e) => {
    // Only fire click if it wasn't already handled by touch
    // This handles desktop clicks and accessibility
    if (disabled || touchHandled.current) {
      touchHandled.current = false;
      return;
    }
    onClick && onClick(e);
  };

  const handleMouseDown = () => {
    if (disabled) return;
    if (buttonRef.current) {
      buttonRef.current.style.transform = 'scale(0.95)';
    }
  };

  const handleMouseUp = () => {
    if (buttonRef.current) {
      buttonRef.current.style.transform = '';
    }
  };

  return (
    <button
      ref={buttonRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={handleClick}
      disabled={disabled}
      className={className}
      style={style}
    >
      {children}
    </button>
  );
};

// Segmented control component - defined outside ActivityFeed for stable reference (enables CSS animations)
const SegmentedControl = ({ activeView, setActiveView }) => (
  <div className="px-4 pb-4">
    <div className="relative flex p-1 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
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
          className="flex-1 py-2 px-4 rounded-lg text-sm font-medium relative z-10"
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

const ActivityFeed = ({ user, userProfile, friends, onOpenFriends, pendingRequestsCount = 0 }) => {
  const [feedActivities, setFeedActivities] = useState([]);
  const [activityReactions, setActivityReactions] = useState({});
  const [activityComments, setActivityComments] = useState({});
  const [commentsModal, setCommentsModal] = useState(null); // { activity, comments }
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [touchStart, setTouchStart] = useState(null);
  const [activeView, setActiveView] = useState('feed'); // 'feed' or 'leaderboard'
  const [leaderboardData, setLeaderboardData] = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardCategory, setLeaderboardCategory] = useState('master'); // 'master', 'strength', 'cardio', 'recovery', 'calories', 'steps'
  const [leaderboardTimeRange, setLeaderboardTimeRange] = useState('week'); // 'week', 'month', 'year', 'all'
  const [selectedFriend, setSelectedFriend] = useState(null); // For viewing friend profile

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
          }
        })
      );
      setActivityReactions(reactionsMap);
      setActivityComments(commentsMap);
    } catch (error) {
      console.error('Error loading activity feed:', error);
    }
    setIsLoading(false);
    setIsRefreshing(false);
  }, [friends]);

  const loadLeaderboard = useCallback(async () => {
    setLeaderboardLoading(true);

    // Dummy data for demo purposes
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

    try {
      // Also add current user to leaderboard
      const currentUserDocRef = doc(db, 'users', user.uid);
      const currentUserDoc = await getDoc(currentUserDocRef);
      const currentUserData = currentUserDoc.exists() ? currentUserDoc.data() : {};

      // If we have real friends, fetch their data too
      let realFriendsData = [];
      if (friends && friends.length > 0) {
        const leaderboardPromises = friends.map(async (friend) => {
          const userDocRef = doc(db, 'users', friend.uid);
          const userDoc = await getDoc(userDocRef);
          const userData = userDoc.exists() ? userDoc.data() : {};

          return {
            uid: friend.uid,
            username: friend.username,
            displayName: friend.displayName,
            photoURL: friend.photoURL,
            masterStreak: userData.streaks?.master || 0,
            strengthStreak: userData.streaks?.strength || 0,
            cardioStreak: userData.streaks?.cardio || 0,
            recoveryStreak: userData.streaks?.recovery || 0,
            weeksWon: userData.weeksWon || 0,
            totalWorkouts: userData.totalWorkouts || 0,
            stats: {
              calories: {
                week: userData.weeklyCalories || Math.floor(Math.random() * 5000) + 1000,
                month: userData.monthlyCalories || Math.floor(Math.random() * 20000) + 5000,
                year: userData.yearlyCalories || Math.floor(Math.random() * 200000) + 50000,
                all: userData.allTimeCalories || Math.floor(Math.random() * 500000) + 100000
              },
              steps: {
                week: userData.weeklySteps || Math.floor(Math.random() * 70000) + 20000,
                month: userData.monthlySteps || Math.floor(Math.random() * 300000) + 100000,
                year: userData.yearlySteps || Math.floor(Math.random() * 3000000) + 1000000,
                all: userData.allTimeSteps || Math.floor(Math.random() * 10000000) + 3000000
              }
            }
          };
        });
        realFriendsData = await Promise.all(leaderboardPromises);
      }

      const allUsers = [
        ...dummyFriends,
        ...realFriendsData,
        {
          uid: user.uid,
          username: userProfile?.username || 'You',
          displayName: userProfile?.displayName || 'You',
          photoURL: userProfile?.photoURL,
          masterStreak: currentUserData.streaks?.master || 24,
          strengthStreak: currentUserData.streaks?.strength || 18,
          cardioStreak: currentUserData.streaks?.cardio || 14,
          recoveryStreak: currentUserData.streaks?.recovery || 9,
          weeksWon: currentUserData.weeksWon || 10,
          totalWorkouts: currentUserData.totalWorkouts || 145,
          stats: {
            calories: {
              week: currentUserData.weeklyCalories || 3800,
              month: currentUserData.monthlyCalories || 16200,
              year: currentUserData.yearlyCalories || 185000,
              all: currentUserData.allTimeCalories || 420000
            },
            steps: {
              week: currentUserData.weeklySteps || 58000,
              month: currentUserData.monthlySteps || 245000,
              year: currentUserData.yearlySteps || 2800000,
              all: currentUserData.allTimeSteps || 8500000
            }
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

      setLeaderboardData(allUsers);
    } catch (error) {
      console.error('Error loading leaderboard:', error);
    }
    setLeaderboardLoading(false);
  }, [friends, user, userProfile]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  useEffect(() => {
    if (activeView === 'leaderboard' && leaderboardData.length === 0) {
      loadLeaderboard();
    }
  }, [activeView, leaderboardData.length, loadLeaderboard]);

  const handleRefresh = async () => {
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

    console.log('Adding reaction:', activity.id, activity.friend.uid, emoji);

    const key = `${activity.friend.uid}-${activity.id}`;
    const currentReactions = activityReactions[key] || [];
    const existingReaction = currentReactions.find(r => r.reactorUid === user.uid);

    try {
      if (existingReaction && existingReaction.reactionType === emoji) {
        // Remove reaction (toggle off)
        console.log('Removing reaction for activity:', activity.id);
        await removeReaction(activity.friend.uid, activity.id, user.uid);
        console.log('Reaction removed successfully');
        setActivityReactions(prev => ({
          ...prev,
          [key]: currentReactions.filter(r => r.reactorUid !== user.uid)
        }));
      } else {
        // Add or update reaction
        console.log('Calling addReaction with:', {
          activityId: activity.id,
          ownerUid: activity.friend.uid,
          reactorUid: user.uid,
          reactorName: userProfile?.displayName || userProfile?.username || 'User',
          reactorPhoto: userProfile?.photoURL || null,
          reactionType: emoji
        });
        const result = await addReaction(
          activity.id,
          activity.friend.uid,
          user.uid,
          userProfile?.displayName || userProfile?.username || 'User',
          userProfile?.photoURL || null,
          emoji
        );
        console.log('addReaction result:', result);

        // Update local state
        const newReaction = {
          reactorUid: user.uid,
          reactorName: userProfile?.displayName || userProfile?.username || 'User',
          reactorPhoto: userProfile?.photoURL || null,
          reactionType: emoji
        };

        if (existingReaction) {
          // Replace existing reaction
          setActivityReactions(prev => ({
            ...prev,
            [key]: currentReactions.map(r =>
              r.reactorUid === user.uid ? newReaction : r
            )
          }));
        } else {
          // Add new reaction
          setActivityReactions(prev => ({
            ...prev,
            [key]: [...currentReactions, newReaction]
          }));
        }
      }
    } catch (error) {
      console.error('Error handling reaction:', error);
      console.error('Error details:', error.message, error.code);
    }
  };

  const handleOpenComments = (activity) => {
    if (!activity.id) return;
    const key = `${activity.friend.uid}-${activity.id}`;
    const comments = activityComments[key] || [];
    setCommentsModal({ activity, comments });
  };

  const handleAddComment = async (text) => {
    if (!commentsModal || !text.trim()) return;
    const { activity } = commentsModal;
    const key = `${activity.friend.uid}-${activity.id}`;

    try {
      const commentId = await addComment(
        activity.id,
        activity.friend.uid,
        user.uid,
        userProfile?.displayName || userProfile?.username || 'User',
        userProfile?.photoURL || null,
        text.trim()
      );

      const newComment = {
        id: commentId,
        commenterUid: user.uid,
        commenterName: userProfile?.displayName || userProfile?.username || 'User',
        commenterPhoto: userProfile?.photoURL || null,
        text: text.trim(),
        createdAt: { toDate: () => new Date() }
      };

      // Update local state
      const updatedComments = [...(activityComments[key] || []), newComment];
      setActivityComments(prev => ({
        ...prev,
        [key]: updatedComments
      }));
      setCommentsModal(prev => ({
        ...prev,
        comments: updatedComments
      }));
    } catch (error) {
      console.error('Error adding comment:', error);
    }
  };

  const handleDeleteComment = async (commentId) => {
    if (!commentsModal) return;
    const { activity } = commentsModal;
    const key = `${activity.friend.uid}-${activity.id}`;

    try {
      await deleteComment(activity.friend.uid, activity.id, commentId);

      // Update local state
      const updatedComments = (activityComments[key] || []).filter(c => c.id !== commentId);
      setActivityComments(prev => ({
        ...prev,
        [key]: updatedComments
      }));
      setCommentsModal(prev => ({
        ...prev,
        comments: updatedComments
      }));
    } catch (error) {
      console.error('Error deleting comment:', error);
    }
  };

  // Pull to refresh handlers - only activate when touching the scroll container directly
  const handleTouchStart = (e) => {
    // Only start pull-to-refresh if we're at the top and touching the container itself
    // Check if the touch target is a button or interactive element - if so, don't start pull
    const target = e.target;
    if (target.closest('button') || target.closest('a') || target.closest('[role="button"]')) {
      return;
    }
    if (e.currentTarget.scrollTop === 0) {
      setTouchStart(e.touches[0].clientY);
    }
  };

  const handleTouchMove = (e) => {
    if (touchStart === null) return;
    const currentTouch = e.touches[0].clientY;
    const diff = currentTouch - touchStart;
    if (diff > 0 && e.currentTarget.scrollTop === 0) {
      setPullDistance(Math.min(diff * 0.5, 80));
    }
  };

  const handleTouchEnd = () => {
    if (pullDistance > 60) {
      handleRefresh();
    }
    setPullDistance(0);
    setTouchStart(null);
  };


  const ProfilePhoto = ({ photoURL, displayName, size = 40 }) => (
    <div
      className="rounded-full bg-zinc-700 flex items-center justify-center overflow-hidden flex-shrink-0"
      style={{ width: size, height: size }}
    >
      {photoURL ? (
        <img src={photoURL} alt={displayName} className="w-full h-full object-cover" />
      ) : (
        <span className="text-white text-sm">{displayName?.[0]?.toUpperCase() || '?'}</span>
      )}
    </div>
  );

  const ActivityCard = ({ activity }) => {
    const { friend, type, duration, calories, distance, date, id, customEmoji, sportEmoji } = activity;
    // Use custom emoji for "Other" activities, sport emoji for Sports, otherwise use default icons
    let icon = activityIcons[type] || '💪';
    if (type === 'Other' && customEmoji) {
      icon = customEmoji;
    } else if (type === 'Sports' && sportEmoji) {
      icon = sportEmoji;
    }
    const key = `${friend.uid}-${id}`;
    const reactions = activityReactions[key] || [];
    const comments = activityComments[key] || [];
    const [showFullscreenPhoto, setShowFullscreenPhoto] = useState(false);

    // Count reactions by type
    const reactionCounts = {};
    reactions.forEach(r => {
      reactionCounts[r.reactionType] = (reactionCounts[r.reactionType] || 0) + 1;
    });

    // Check if current user has reacted
    const userReaction = reactions.find(r => r.reactorUid === user.uid);

    // Get reactors for display (max 3 photos)
    const reactorPhotos = reactions
      .filter(r => r.reactorPhoto)
      .slice(0, 3);

    return (
      <div className="bg-zinc-900 rounded-xl p-4 mb-3">
        {/* Header - Friend info */}
        <div className="flex items-center gap-3 mb-3">
          <TouchButton
            onClick={() => setSelectedFriend(friend)}
            className="flex-shrink-0 transition-transform"
          >
            <ProfilePhoto photoURL={friend.photoURL} displayName={friend.displayName} />
          </TouchButton>
          <TouchButton
            onClick={() => setSelectedFriend(friend)}
            className="flex-1 min-w-0 text-left transition-opacity"
          >
            <p className="text-white font-medium truncate">
              {friend.displayName || friend.username}
            </p>
            <p className="text-gray-500 text-xs">@{friend.username}</p>
          </TouchButton>
          <span className="text-gray-500 text-xs">{formatTimeAgo(date)}</span>
        </div>

        {/* Activity details */}
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center">
            <span className="text-2xl">{icon}</span>
          </div>
          <div className="flex-1">
            <p className="text-white font-medium">{type}</p>
            <div className="flex items-center gap-3 mt-1">
              {duration && (
                <span className="text-gray-400 text-sm">
                  ⏱ {formatDuration(duration)}
                </span>
              )}
              {calories && (
                <span className="text-gray-400 text-sm">
                  🔥 {calories} cal
                </span>
              )}
              {distance && (
                <span className="text-gray-400 text-sm">
                  📍 {distance} mi
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Activity Photo - only show if not private */}
        {activity.photoURL && !activity.isPhotoPrivate && (
          <>
            <button
              onClick={() => setShowFullscreenPhoto(true)}
              className="mt-3 rounded-xl overflow-hidden w-full relative group"
            >
              <img
                src={activity.photoURL}
                alt="Activity"
                className="w-full h-auto max-h-80 object-cover"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                <svg className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                </svg>
              </div>
            </button>

            {/* Fullscreen Photo Modal */}
            {showFullscreenPhoto && (
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
          </>
        )}

        {/* Reactions and Comments section */}
        {id && (
          <div className="mt-3 pt-3 border-t border-zinc-800">
            <div className="flex items-center justify-between">
              {/* Reaction buttons and comment button */}
              <div className="flex items-center gap-1">
                {reactionEmojis.map((emoji) => {
                  const count = reactionCounts[emoji] || 0;
                  const isSelected = userReaction?.reactionType === emoji;

                  return (
                    <TouchButton
                      key={emoji}
                      onClick={() => handleReaction(activity, emoji)}
                      className={`flex items-center gap-1 px-2 py-1 rounded-full transition-all duration-150 ${
                        isSelected
                          ? 'bg-zinc-700 ring-1 ring-white/20'
                          : 'bg-zinc-800 hover:bg-zinc-700'
                      }`}
                    >
                      <span className="text-sm">{emoji}</span>
                      {count > 0 && (
                        <span className={`text-xs ${isSelected ? 'text-white' : 'text-gray-400'}`}>
                          {count}
                        </span>
                      )}
                    </TouchButton>
                  );
                })}
                {/* Comment button */}
                <TouchButton
                  onClick={() => handleOpenComments(activity)}
                  className="flex items-center gap-1 px-2 py-1 rounded-full transition-all duration-150 bg-zinc-800 hover:bg-zinc-700"
                >
                  <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  {comments.length > 0 && (
                    <span className="text-xs text-gray-400">{comments.length}</span>
                  )}
                </TouchButton>
              </div>

              {/* Reactor photos */}
              {reactorPhotos.length > 0 && (
                <div className="flex items-center -space-x-2">
                  {reactorPhotos.map((reactor, idx) => (
                    <div
                      key={reactor.reactorUid || idx}
                      className="w-6 h-6 rounded-full border-2 border-zinc-900 overflow-hidden"
                    >
                      <img
                        src={reactor.reactorPhoto}
                        alt={reactor.reactorName}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ))}
                  {reactions.length > 3 && (
                    <span className="text-gray-500 text-xs ml-2">
                      +{reactions.length - 3}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // Comments Modal Component
  const CommentsModal = ({ data, onClose, onAddComment, onDeleteComment, currentUserId }) => {
    const [newComment, setNewComment] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const inputRef = useRef(null);

    const handleSubmit = async () => {
      if (!newComment.trim() || isSubmitting) return;
      setIsSubmitting(true);
      await onAddComment(newComment);
      setNewComment('');
      setIsSubmitting(false);
    };

    const formatCommentTime = (createdAt) => {
      if (!createdAt) return '';
      const date = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays}d ago`;
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    if (!data) return null;

    return (
      <div
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/80"
        onClick={onClose}
      >
        <div
          className="w-full max-h-[70vh] bg-zinc-900 rounded-t-2xl flex flex-col animate-slide-up"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
            <h3 className="text-white font-semibold">
              Comments {data.comments.length > 0 && `(${data.comments.length})`}
            </h3>
            <TouchButton onClick={onClose} className="p-1">
              <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </TouchButton>
          </div>

          {/* Comments list */}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {data.comments.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500">No comments yet</p>
                <p className="text-gray-600 text-sm mt-1">Be the first to comment!</p>
              </div>
            ) : (
              <div className="space-y-4">
                {data.comments.map((comment) => (
                  <div key={comment.id} className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center overflow-hidden flex-shrink-0">
                      {comment.commenterPhoto ? (
                        <img src={comment.commenterPhoto} alt={comment.commenterName} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-white text-xs">{comment.commenterName?.[0]?.toUpperCase() || '?'}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-white text-sm font-medium">{comment.commenterName}</span>
                        <span className="text-gray-500 text-xs">{formatCommentTime(comment.createdAt)}</span>
                      </div>
                      <p className="text-gray-300 text-sm mt-0.5 break-words">{comment.text}</p>
                    </div>
                    {comment.commenterUid === currentUserId && (
                      <TouchButton
                        onClick={() => onDeleteComment(comment.id)}
                        className="text-red-400 text-xs px-2 py-1 hover:bg-red-400/10 rounded"
                      >
                        Delete
                      </TouchButton>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Input area */}
          <div className="px-4 py-3 border-t border-zinc-800 flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="Add a comment..."
              className="flex-1 bg-zinc-800 text-white px-4 py-2 rounded-full text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
            />
            <TouchButton
              onClick={handleSubmit}
              disabled={!newComment.trim() || isSubmitting}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                newComment.trim() && !isSubmitting
                  ? 'bg-green-500 text-black'
                  : 'bg-zinc-700 text-gray-500'
              }`}
            >
              {isSubmitting ? '...' : 'Send'}
            </TouchButton>
          </div>
        </div>

        <style>{`
          @keyframes slide-up {
            from { transform: translateY(100%); }
            to { transform: translateY(0); }
          }
          .animate-slide-up {
            animation: slide-up 0.3s ease-out forwards;
          }
        `}</style>
      </div>
    );
  };

  const LeaderboardRow = ({ userData, rank, category, timeRange, maxValue, onTap }) => {
    const getRankStyle = (rank) => {
      if (rank === 1) return 'bg-gradient-to-r from-yellow-400 to-yellow-600 text-black';
      if (rank === 2) return 'bg-gradient-to-r from-gray-300 to-gray-500 text-black';
      if (rank === 3) return 'bg-gradient-to-r from-amber-600 to-amber-800 text-white';
      return 'bg-zinc-700 text-white';
    };

    const getValue = (tr = timeRange) => {
      switch (category) {
        case 'strength': return userData.strengthStreak || 0;
        case 'cardio': return userData.cardioStreak || 0;
        case 'recovery': return userData.recoveryStreak || 0;
        case 'calories': return userData.stats?.calories?.[tr] || 0;
        case 'steps': return userData.stats?.steps?.[tr] || 0;
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
      if (category !== 'calories' && category !== 'steps') {
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
        case 'strength': return '#FF6B6B';
        case 'cardio': return '#4ECDC4';
        case 'recovery': return '#9B59B6';
        case 'calories': return '#F39C12';
        case 'steps': return '#3498DB';
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
            background: `linear-gradient(to right, ${getCategoryColor()} ${progressPercent}%, transparent ${progressPercent}%)`
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
      switch (category) {
        case 'strength': return userData.strengthStreak || 0;
        case 'cardio': return userData.cardioStreak || 0;
        case 'recovery': return userData.recoveryStreak || 0;
        case 'calories': return userData.stats?.calories?.[timeRange] || 0;
        case 'steps': return userData.stats?.steps?.[timeRange] || 0;
        default: return userData.masterStreak || 0;
      }
    };

    const formatValue = (val) => {
      if (category === 'calories' || category === 'steps') {
        return val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val;
      }
      return val;
    };

    const PodiumSpot = ({ userData, place, height }) => (
      <TouchButton
        onClick={() => !userData.isCurrentUser && onTap && onTap(userData)}
        disabled={userData.isCurrentUser}
        className="flex flex-col items-center transition-all duration-150"
      >
        {/* Crown for 1st place */}
        {place === 1 && (
          <div className="text-2xl mb-1 animate-bounce">👑</div>
        )}

        {/* Profile photo with ring */}
        <div className={`relative mb-2 ${place === 1 ? 'scale-110' : ''}`}>
          <div className={`rounded-full p-0.5 ${
            place === 1 ? 'bg-gradient-to-r from-yellow-400 to-yellow-600' :
            place === 2 ? 'bg-gradient-to-r from-gray-300 to-gray-500' :
            'bg-gradient-to-r from-amber-600 to-amber-800'
          }`}>
            <div className="rounded-full overflow-hidden bg-black">
              <ProfilePhoto
                photoURL={userData.photoURL}
                displayName={userData.displayName}
                size={place === 1 ? 56 : 48}
              />
            </div>
          </div>
          {/* Place badge */}
          <div className={`absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
            place === 1 ? 'bg-yellow-500 text-black' :
            place === 2 ? 'bg-gray-400 text-black' :
            'bg-amber-700 text-white'
          }`}>
            {place}
          </div>
        </div>

        {/* Name */}
        <p className={`text-xs font-medium truncate max-w-[80px] ${userData.isCurrentUser ? 'text-green-400' : 'text-white'}`}>
          {userData.isCurrentUser ? 'You' : (userData.displayName?.split(' ')[0] || userData.username)}
        </p>

        {/* Score */}
        <p className="text-white font-bold text-sm">{formatValue(getValue(userData))}</p>

        {/* Podium bar */}
        <div
          className={`w-20 rounded-t-lg mt-2 flex items-end justify-center ${
            place === 1 ? 'bg-gradient-to-t from-yellow-600 to-yellow-400' :
            place === 2 ? 'bg-gradient-to-t from-gray-500 to-gray-300' :
            'bg-gradient-to-t from-amber-800 to-amber-600'
          }`}
          style={{ height: `${height}px` }}
        >
          <span className="text-2xl font-bold text-white/30 mb-2">{place}</span>
        </div>
      </TouchButton>
    );

    // Reorder for podium display: 2nd, 1st, 3rd
    return (
      <div className="flex items-end justify-center gap-2 mb-6 pt-8">
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

    useEffect(() => {
      if (friend) {
        setIsClosing(false);
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
            <ProfilePhoto photoURL={friend?.photoURL} displayName={friend?.displayName} size={64} />
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
    );
  };

  // Header component (title and add button only)
  const FriendsHeaderTop = () => (
    <div className="px-4 pt-2 pb-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Friends</h1>
          <p className="text-xs text-gray-500">
            {friends?.length || 0} friend{friends?.length !== 1 ? 's' : ''}
          </p>
        </div>
        <TouchButton
          onClick={onOpenFriends}
          className="flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-150 relative"
          style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
        >
          <span className="text-sm">➕</span>
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

  if (!friends || friends.length === 0) {
    return (
      <div>
        <FriendsHeaderTop />
        <SegmentedControl activeView={activeView} setActiveView={setActiveView} />
        <div className="text-center py-12 px-6">
          <div className="text-5xl mb-4">👥</div>
          <p className="text-white font-medium mb-2">Find your workout buddies</p>
          <p className="text-gray-500 text-sm mb-6">Add friends to see their workouts and cheer them on!</p>
          <TouchButton
            onClick={onOpenFriends}
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
      switch (leaderboardCategory) {
        case 'strength': return userData.strengthStreak || 0;
        case 'cardio': return userData.cardioStreak || 0;
        case 'recovery': return userData.recoveryStreak || 0;
        case 'calories': return userData.stats?.calories?.[leaderboardTimeRange] || 0;
        case 'steps': return userData.stats?.steps?.[leaderboardTimeRange] || 0;
        default: return userData.masterStreak || 0;
      }
    };

    const sortedLeaderboard = [...leaderboardData].sort((a, b) => getSortValue(b) - getSortValue(a));
    const maxValue = sortedLeaderboard.length > 0 ? getSortValue(sortedLeaderboard[0]) : 0;
    const topThree = sortedLeaderboard.slice(0, 3);
    const rest = sortedLeaderboard.slice(3);

    const getCategoryLabel = () => {
      switch (leaderboardCategory) {
        case 'strength': return '💪 Strength Streak';
        case 'cardio': return '🏃 Cardio Streak';
        case 'recovery': return '🧘 Recovery Streak';
        case 'calories': return '🔥 Calories Burned';
        case 'steps': return '👟 Steps';
        default: return '🏆 Overall Streak';
      }
    };

    // Find current user's rank
    const currentUserRank = sortedLeaderboard.findIndex(u => u.isCurrentUser) + 1;

    return (
      <div
        className="h-full overflow-y-auto"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Pull to refresh indicator */}
        <div
          className="flex justify-center items-center transition-all duration-300"
          style={{
            height: isRefreshing ? '60px' : `${pullDistance}px`,
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
            🔄
          </div>
        </div>

        <FriendsHeaderTop />
        <SegmentedControl activeView={activeView} setActiveView={setActiveView} />

        {/* Leaderboard content */}
        <div className="px-4 pb-32">
          {/* Leaderboard headline */}
          <div className="mb-4">
            <div className="text-sm font-semibold text-white">Leaderboard</div>
            <p className="text-[11px] text-gray-500 mt-0.5">See how you rank among friends</p>
          </div>

          {/* Time Range Toggle - smaller secondary style, centered and narrower */}
          <div className="relative flex p-1 rounded-lg mb-4 max-w-sm mx-auto" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
            <div
              className="absolute top-1 bottom-1 rounded-md transition-all duration-300 ease-out"
              style={{
                backgroundColor: 'rgba(255,255,255,0.1)',
                width: 'calc((100% - 8px) / 4)',
                left: (() => {
                  const ranges = ['week', 'month', 'year', 'all'];
                  const index = ranges.indexOf(leaderboardTimeRange);
                  return `calc(4px + ${index} * (100% - 8px) / 4)`;
                })()
              }}
            />
            {[
              { key: 'week', label: 'Week' },
              { key: 'month', label: 'Month' },
              { key: 'year', label: 'Year' },
              { key: 'all', label: 'All Time' }
            ].map((range) => (
              <TouchButton
                key={range.key}
                onClick={() => setLeaderboardTimeRange(range.key)}
                className="flex-1 py-1.5 rounded-md text-xs font-medium transition-colors duration-200 relative z-10"
                style={{ color: leaderboardTimeRange === range.key ? 'white' : 'rgba(255,255,255,0.5)' }}
              >
                {range.label}
              </TouchButton>
            ))}
          </div>

          {/* Category Selector */}
          <div className="flex gap-2 mb-4 overflow-x-auto pb-2 -mx-4 px-4 no-scrollbar">
            {[
              { key: 'master', label: '🏆 Overall', color: '#FFD700' },
              { key: 'strength', label: '💪 Strength', color: '#FF6B6B' },
              { key: 'cardio', label: '🏃 Cardio', color: '#4ECDC4' },
              { key: 'recovery', label: '🧘 Recovery', color: '#9B59B6' },
              { key: 'calories', label: '🔥 Calories', color: '#F39C12' },
              { key: 'steps', label: '👟 Steps', color: '#3498DB' }
            ].map((cat) => (
              <TouchButton
                key={cat.key}
                onClick={() => setLeaderboardCategory(cat.key)}
                className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-200"
                style={{
                  backgroundColor: leaderboardCategory === cat.key ? cat.color : 'rgba(255,255,255,0.05)',
                  color: leaderboardCategory === cat.key ? (cat.key === 'master' ? 'black' : 'white') : 'rgba(255,255,255,0.5)'
                }}
              >
                {cat.label}
              </TouchButton>
            ))}
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
                <div className="bg-gradient-to-r from-green-900/30 to-green-800/20 rounded-xl p-3 mb-4 border border-green-500/20">
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
                          return (leaderboardCategory === 'calories' || leaderboardCategory === 'steps')
                            ? (val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val)
                            : val;
                        })()}
                      </p>
                      <p className="text-gray-500 text-xs">
                        {leaderboardCategory === 'calories' ? 'cal' : leaderboardCategory === 'steps' ? 'steps' : 'streak'}
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
                  <div className="text-sm font-semibold text-white">Category Leaders</div>
                  <p className="text-[11px] text-gray-500 mt-0.5">Top performers by volume this {leaderboardTimeRange === 'all' ? 'all time' : leaderboardTimeRange}</p>
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
                            <span className="text-[11px] font-bold" style={{ color: '#4ECDC4' }}>{user.volume?.runs?.[leaderboardTimeRange] || 0}</span>
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
                            <span className="text-[11px] font-bold" style={{ color: '#4ECDC4' }}>{user.volume?.miles?.[leaderboardTimeRange]?.toFixed(0) || 0}</span>
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
                              <span className="text-[11px] font-bold" style={{ color: '#4ECDC4' }}>{hrs}h</span>
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
                            <span className="text-[11px] font-bold" style={{ color: '#FF6B6B' }}>{user.volume?.strengthSessions?.[leaderboardTimeRange] || 0}</span>
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
                              <span className="text-[11px] font-bold" style={{ color: '#FF6B6B' }}>{hrs}h</span>
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
    <div
      className="h-full overflow-y-auto"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull to refresh indicator */}
      <div
        className="flex justify-center items-center transition-all duration-300"
        style={{
          height: isRefreshing ? '60px' : `${pullDistance}px`,
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
          🔄
        </div>
      </div>

      <FriendsHeaderTop />
        <SegmentedControl activeView={activeView} setActiveView={setActiveView} />

      {/* Feed content */}
      <div className="px-4 pb-32">
        {/* Feed headline */}
        <div className="mb-4">
          <div className="text-sm font-semibold text-white">Feed</div>
          <p className="text-[11px] text-gray-500 mt-0.5">Recent activity from friends</p>
        </div>

        {feedActivities.map((activity, index) => (
          <ActivityCard key={`${activity.friend.uid}-${activity.id || index}`} activity={activity} />
        ))}
      </div>

      {/* Friend Profile Modal */}
      <FriendProfileModal friend={selectedFriend} onClose={() => setSelectedFriend(null)} />

      {/* Comments Modal */}
      {commentsModal && (
        <CommentsModal
          data={commentsModal}
          onClose={() => setCommentsModal(null)}
          onAddComment={handleAddComment}
          onDeleteComment={handleDeleteComment}
          currentUserId={user.uid}
        />
      )}
    </div>
  );
};

export default ActivityFeed;
