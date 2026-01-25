import React, { useState, useEffect, useCallback } from 'react';
import { getUserActivities } from './services/userService';
import { addReaction, getReactions, removeReaction } from './services/friendService';
import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';

const ActivityFeed = ({ user, userProfile, friends, onOpenFriends, pendingRequestsCount = 0 }) => {
  const [feedActivities, setFeedActivities] = useState([]);
  const [activityReactions, setActivityReactions] = useState({});
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
  const [showShareModal, setShowShareModal] = useState(false);

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

      // Fetch reactions for each activity
      const reactionsMap = {};
      await Promise.all(
        limitedActivities.map(async (activity) => {
          if (activity.id) {
            const reactions = await getReactions(activity.friend.uid, activity.id);
            const key = `${activity.friend.uid}-${activity.id}`;
            reactionsMap[key] = reactions;
          }
        })
      );
      setActivityReactions(reactionsMap);
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

  // Pull to refresh handlers
  const handleTouchStart = (e) => {
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

  // Haptic button press handlers
  const handlePressIn = (e) => {
    e.currentTarget.style.transform = 'scale(0.9)';
  };

  const handlePressOut = (e) => {
    e.currentTarget.style.transform = 'scale(1)';
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
    const { friend, type, duration, calories, distance, date, id } = activity;
    const icon = activityIcons[type] || '💪';
    const key = `${friend.uid}-${id}`;
    const reactions = activityReactions[key] || [];

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
          <ProfilePhoto photoURL={friend.photoURL} displayName={friend.displayName} />
          <div className="flex-1 min-w-0">
            <p className="text-white font-medium truncate">
              {friend.displayName || friend.username}
            </p>
            <p className="text-gray-500 text-xs">@{friend.username}</p>
          </div>
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

        {/* Reactions section */}
        {id && (
          <div className="mt-3 pt-3 border-t border-zinc-800">
            <div className="flex items-center justify-between">
              {/* Reaction buttons */}
              <div className="flex items-center gap-1">
                {reactionEmojis.map((emoji) => {
                  const count = reactionCounts[emoji] || 0;
                  const isSelected = userReaction?.reactionType === emoji;

                  return (
                    <button
                      key={emoji}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleReaction(activity, emoji);
                      }}
                      className={`flex items-center gap-1 px-2 py-1 rounded-full transition-all duration-150 ${
                        isSelected
                          ? 'bg-zinc-700 ring-1 ring-white/20'
                          : 'bg-zinc-800 hover:bg-zinc-700'
                      }`}
                      style={{ transform: 'scale(1)' }}
                      onTouchStart={(e) => {
                        e.stopPropagation();
                        handlePressIn(e);
                      }}
                      onTouchEnd={(e) => {
                        e.stopPropagation();
                        handlePressOut(e);
                      }}
                      onMouseDown={handlePressIn}
                      onMouseUp={handlePressOut}
                      onMouseLeave={handlePressOut}
                    >
                      <span className="text-sm">{emoji}</span>
                      {count > 0 && (
                        <span className={`text-xs ${isSelected ? 'text-white' : 'text-gray-400'}`}>
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
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

    // Calculate trend and delta
    const calculateTrendAndDelta = () => {
      if (category !== 'calories' && category !== 'steps') {
        // For streaks, use mock trend
        const random = Math.random();
        return {
          trend: random > 0.6 ? 'up' : random < 0.3 ? 'down' : 'same',
          delta: null
        };
      }

      const currentValue = getValue();
      const prevPeriod = getPreviousPeriod();
      if (!prevPeriod) return { trend: 'same', delta: null };

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

      const delta = currentValue - expectedValue;
      const percentChange = expectedValue > 0 ? Math.round((delta / expectedValue) * 100) : 0;

      return {
        trend: delta > 0 ? 'up' : delta < 0 ? 'down' : 'same',
        delta: delta,
        percentChange: percentChange
      };
    };

    const value = getValue();
    const { trend, delta, percentChange } = calculateTrendAndDelta();
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
      <button
        onClick={() => !userData.isCurrentUser && onTap && onTap(userData)}
        className={`w-full flex items-center gap-3 p-3 rounded-xl mb-2 relative overflow-hidden transition-all duration-150 active:scale-[0.98] ${
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
      </button>
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
      <button
        onClick={() => !userData.isCurrentUser && onTap && onTap(userData)}
        className="flex flex-col items-center transition-all duration-150 active:scale-95"
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
      </button>
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

  // Friend Profile Modal
  const FriendProfileModal = ({ friend, onClose }) => {
    if (!friend) return null;

    return (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-end justify-center" onClick={onClose}>
        <div
          className="w-full max-w-lg bg-zinc-900 rounded-t-3xl p-6 pb-8"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center gap-4 mb-6">
            <ProfilePhoto photoURL={friend.photoURL} displayName={friend.displayName} size={64} />
            <div>
              <p className="text-white font-bold text-lg">{friend.displayName || friend.username}</p>
              <p className="text-gray-400">@{friend.username}</p>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="bg-zinc-800 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-white">{friend.masterStreak || 0}</p>
              <p className="text-gray-500 text-xs">Week Streak</p>
            </div>
            <div className="bg-zinc-800 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-white">{friend.weeksWon || 0}</p>
              <p className="text-gray-500 text-xs">Weeks Won</p>
            </div>
            <div className="bg-zinc-800 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-white">{friend.totalWorkouts || 0}</p>
              <p className="text-gray-500 text-xs">Workouts</p>
            </div>
          </div>

          {/* Streak breakdown */}
          <div className="space-y-2 mb-6">
            <div className="flex items-center justify-between bg-zinc-800 rounded-lg p-3">
              <span className="text-gray-400">💪 Strength Streak</span>
              <span className="text-white font-bold">{friend.strengthStreak || 0}</span>
            </div>
            <div className="flex items-center justify-between bg-zinc-800 rounded-lg p-3">
              <span className="text-gray-400">🏃 Cardio Streak</span>
              <span className="text-white font-bold">{friend.cardioStreak || 0}</span>
            </div>
            <div className="flex items-center justify-between bg-zinc-800 rounded-lg p-3">
              <span className="text-gray-400">🧘 Recovery Streak</span>
              <span className="text-white font-bold">{friend.recoveryStreak || 0}</span>
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            className="w-full py-3 rounded-full bg-zinc-800 text-white font-medium"
          >
            Close
          </button>
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
        <button
          onClick={onOpenFriends}
          className="flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-150 relative"
          style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
          onTouchStart={(e) => {
            e.currentTarget.style.transform = 'scale(0.95)';
            e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.15)';
          }}
          onTouchEnd={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = 'scale(0.95)';
            e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.15)';
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
        </button>
      </div>
    </div>
  );

  // Segmented control as a separate element (not recreated on state change)
  const segmentedControl = (
    <div className="px-4 pb-4">
      <div className="relative flex p-1 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
        {/* Sliding pill indicator */}
        <div
          className="absolute top-1 bottom-1 rounded-lg"
          style={{
            backgroundColor: 'rgba(255,255,255,0.1)',
            width: 'calc((100% - 8px) / 2)',
            left: activeView === 'feed' ? '4px' : 'calc(4px + (100% - 8px) / 2)',
            transition: 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
          }}
        />
        <button
          onClick={() => setActiveView('feed')}
          className="flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors duration-200 relative z-10"
          style={{
            color: activeView === 'feed' ? 'white' : 'rgba(255,255,255,0.5)',
            transform: 'scale(1)'
          }}
          onTouchStart={(e) => e.currentTarget.style.transform = 'scale(0.95)'}
          onTouchEnd={(e) => e.currentTarget.style.transform = 'scale(1)'}
          onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.95)'}
          onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
          onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
        >
          Feed
        </button>
        <button
          onClick={() => setActiveView('leaderboard')}
          className="flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors duration-200 relative z-10"
          style={{
            color: activeView === 'leaderboard' ? 'white' : 'rgba(255,255,255,0.5)',
            transform: 'scale(1)'
          }}
          onTouchStart={(e) => e.currentTarget.style.transform = 'scale(0.95)'}
          onTouchEnd={(e) => e.currentTarget.style.transform = 'scale(1)'}
          onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.95)'}
          onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
          onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
        >
          Leaderboard
        </button>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div>
        <FriendsHeaderTop />
        {segmentedControl}
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
        {segmentedControl}
        <div className="text-center py-12 px-6">
          <div className="text-5xl mb-4">👥</div>
          <p className="text-white font-medium mb-2">Find your workout buddies</p>
          <p className="text-gray-500 text-sm mb-6">Add friends to see their workouts and cheer them on!</p>
          <button
            onClick={onOpenFriends}
            className="px-6 py-3 rounded-full font-semibold text-black transition-all duration-150"
            style={{ backgroundColor: '#00FF94' }}
            onTouchStart={(e) => {
              e.currentTarget.style.transform = 'scale(0.95)';
            }}
            onTouchEnd={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'scale(0.95)';
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            Add Friends
          </button>
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
        {segmentedControl}

        {/* Leaderboard content */}
        <div className="px-4 pb-32">
          {/* Time Range Toggle - smaller secondary style */}
          <div className="relative flex p-1 rounded-lg mb-4" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
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
              <button
                key={range.key}
                onClick={() => setLeaderboardTimeRange(range.key)}
                className="flex-1 py-1.5 rounded-md text-xs font-medium transition-colors duration-200 relative z-10"
                style={{
                  color: leaderboardTimeRange === range.key ? 'white' : 'rgba(255,255,255,0.5)'
                }}
              >
                {range.label}
              </button>
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
              <button
                key={cat.key}
                onClick={() => setLeaderboardCategory(cat.key)}
                className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-200"
                style={{
                  backgroundColor: leaderboardCategory === cat.key ? cat.color : 'rgba(255,255,255,0.05)',
                  color: leaderboardCategory === cat.key ? (cat.key === 'master' ? 'black' : 'white') : 'rgba(255,255,255,0.5)'
                }}
              >
                {cat.label}
              </button>
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

              {/* Rankings label with share button */}
              <div className="flex items-center justify-between mb-3">
                <p className="text-gray-500 text-xs uppercase tracking-wide">{getCategoryLabel()} Rankings</p>
                <button
                  onClick={() => setShowShareModal(true)}
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
            </>
          )}
        </div>

        {/* Friend Profile Modal */}
        <FriendProfileModal friend={selectedFriend} onClose={() => setSelectedFriend(null)} />

        {/* Share Modal */}
        {showShareModal && (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setShowShareModal(false)}>
            <div className="bg-zinc-900 rounded-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
              <div className="text-center mb-6">
                <div className="text-4xl mb-2">🏆</div>
                <h3 className="text-white font-bold text-lg">Share Leaderboard</h3>
                <p className="text-gray-400 text-sm mt-1">Show off your ranking!</p>
              </div>

              {/* Preview card */}
              <div className="bg-gradient-to-br from-zinc-800 to-zinc-900 rounded-xl p-4 mb-6 border border-zinc-700">
                <p className="text-gray-400 text-xs mb-2">{getCategoryLabel()}</p>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                    <span className="text-green-400 font-bold text-lg">#{currentUserRank}</span>
                  </div>
                  <div>
                    <p className="text-white font-bold">{userProfile?.displayName || 'You'}</p>
                    <p className="text-gray-400 text-sm">
                      {(() => {
                        const userData = sortedLeaderboard.find(u => u.isCurrentUser);
                        const val = getSortValue(userData);
                        return (leaderboardCategory === 'calories' || leaderboardCategory === 'steps')
                          ? (val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val)
                          : val;
                      })()} {leaderboardCategory === 'calories' ? 'cal' : leaderboardCategory === 'steps' ? 'steps' : 'streak'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowShareModal(false)}
                  className="flex-1 py-3 rounded-full bg-zinc-800 text-white font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    // In a real app, this would trigger native share
                    if (navigator.share) {
                      navigator.share({
                        title: 'My Streakd Ranking',
                        text: `I'm ranked #${currentUserRank} on the ${getCategoryLabel()} leaderboard! 🏆`
                      });
                    }
                    setShowShareModal(false);
                  }}
                  className="flex-1 py-3 rounded-full font-medium text-black"
                  style={{ backgroundColor: '#00FF94' }}
                >
                  Share
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Feed View
  if (feedActivities.length === 0) {
    return (
      <div>
        <FriendsHeaderTop />
        {segmentedControl}
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
        {segmentedControl}

      {/* Feed content */}
      <div className="px-4 pb-32">
        {feedActivities.map((activity, index) => (
          <ActivityCard key={`${activity.friend.uid}-${activity.id || index}`} activity={activity} />
        ))}
      </div>
    </div>
  );
};

export default ActivityFeed;
