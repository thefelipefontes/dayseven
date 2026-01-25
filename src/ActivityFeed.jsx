import React, { useState, useEffect, useCallback } from 'react';
import { getUserActivities } from './services/userService';
import { addReaction, getReactions, removeReaction } from './services/friendService';

const ActivityFeed = ({ user, userProfile, friends }) => {
  const [feedActivities, setFeedActivities] = useState([]);
  const [activityReactions, setActivityReactions] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [touchStart, setTouchStart] = useState(null);

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

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadFeed();
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!friends || friends.length === 0) {
    return (
      <div className="text-center py-12 px-6">
        <div className="text-5xl mb-4">👥</div>
        <p className="text-gray-400 mb-2">No friends yet</p>
        <p className="text-gray-500 text-sm">Add friends to see their workouts!</p>
      </div>
    );
  }

  if (feedActivities.length === 0) {
    return (
      <div className="text-center py-12 px-6">
        <div className="text-5xl mb-4">📭</div>
        <p className="text-gray-400 mb-2">No activity yet</p>
        <p className="text-gray-500 text-sm">Your friends haven't logged any workouts</p>
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

      {/* Feed content */}
      <div className="px-4 pb-4">
        {feedActivities.map((activity, index) => (
          <ActivityCard key={`${activity.friend.uid}-${activity.id || index}`} activity={activity} />
        ))}
      </div>
    </div>
  );
};

export default ActivityFeed;
