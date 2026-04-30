import React, { useState, useEffect } from 'react';
import ActivityIcon from './ActivityIcon';
import RouteMapView from './RouteMapView';
import MuscleBodyMap from './MuscleBodyMap';
import { triggerHaptic, ImpactStyle } from '../utils/haptics';
import { formatFriendlyDate } from '../utils/dateHelpers';
import { normalizeFocusAreas } from '../utils/focusAreas';
import { fetchWorkoutRoute } from '../services/healthService';
import { getReactions, addReaction, removeReaction, getComments, addComment } from '../services/friendService';
import { isChallengeable } from '../services/challengeService';

const ActivityDetailModal = ({ isOpen, onClose, activity, onDelete, onEdit, user, userProfile, onShareStamp, isPro, onPresentPaywall, onChallenge, friends = [] }) => {
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

  // Route map state
  const [routeCoords, setRouteCoords] = useState([]);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeChecked, setRouteChecked] = useState(false);

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

  // Load GPS route for outdoor activities with a HealthKit UUID
  useEffect(() => {
    if (!isOpen || !activity) {
      setRouteCoords([]);
      setRouteChecked(false);
      return;
    }

    // Try to load route for any activity linked to Apple Health (not just specific types).
    // The route query will return no data if the workout doesn't have GPS data.
    const hasRoute = activity.subtype !== 'Indoor' &&
                     (activity.healthKitUUID || activity.linkedHealthKitUUID);

    if (!hasRoute) {
      setRouteChecked(true);
      return;
    }

    setRouteLoading(true);
    setRouteChecked(false);

    fetchWorkoutRoute(activity.healthKitUUID || activity.linkedHealthKitUUID, activity.healthKitStartDate || activity.linkedHealthKitStartDate)
      .then(result => {
        setRouteCoords(result.hasRoute ? result.coordinates : []);
      })
      .catch(() => setRouteCoords([]))
      .finally(() => {
        setRouteLoading(false);
        setRouteChecked(true);
      });
  }, [isOpen, activity?.id, activity?.healthKitUUID]);

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
    if (type === 'Running' || type === 'Cycle' || type === 'Sports' || type === 'Stair Climbing' || type === 'Elliptical') return '#FF9500';
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
              <ActivityIcon type={activity.type} subtype={activity.subtype} size={28} sportEmoji={activity.sportEmoji} customEmoji={activity.customEmoji} customIcon={activity.customIcon} />
            </div>
            <div className="flex-1">
              <div className="text-xl font-bold">{
                activity.type === 'Other' ? (activity.subtype || activity.type)
                : activity.type === 'Strength Training' ? (activity.strengthType || activity.subtype || 'Strength Training')
                : activity.type
              }</div>
              {activity.type === 'Strength Training' && (activity.focusAreas?.length || activity.focusArea) ? (
                <div className="text-sm text-gray-400">{normalizeFocusAreas(activity.focusAreas || [activity.focusArea]).join(', ')}</div>
              ) : activity.subtype && activity.type !== 'Other' && activity.type !== 'Strength Training' && (
                <div className="text-sm text-gray-400">{activity.subtype}</div>
              )}
              {activity.type === 'Walking' && (
                <div className="text-xs mt-0.5" style={{ color: activity.countToward === 'cardio' ? '#FF9500' : activity.countToward === 'warmup' ? '#FFD60A' : '#808080' }}>
                  {activity.countToward === 'cardio' ? '❤️‍🔥 Counts as Cardio' : activity.countToward === 'warmup' ? '🔥 Warm Up' : '🚶 Casual Walk'}
                </div>
              )}
              {(activity.avgHr || activity.maxHr) && (
                <div className="flex items-center gap-2 text-xs text-gray-400 mt-1">
                  <span className="text-red-400">♥</span>
                  {activity.avgHr && <span>{activity.avgHr} avg</span>}
                  {activity.avgHr && activity.maxHr && <span>•</span>}
                  {activity.maxHr && <span>{activity.maxHr} max</span>}
                </div>
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
                <div className="text-lg font-bold">{parseFloat(activity.distance).toFixed(2)} mi</div>
              </div>
            )}
            {activity.calories && (
              <div className="p-4 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                <div className="text-xs text-gray-500 mb-1">Calories</div>
                <div className="text-lg font-bold">{activity.calories} cal</div>
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

          {/* Route Map */}
          {routeLoading && (
            <div className="flex items-center gap-2 p-4 rounded-xl mb-4"
                 style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white/80 rounded-full animate-spin" />
              <span className="text-xs text-gray-500">Loading route...</span>
            </div>
          )}
          {!routeLoading && routeChecked && routeCoords.length >= 2 && (
            <div className="mb-4">
              <div className="text-xs text-gray-500 mb-2">Route</div>
              <RouteMapView
                coordinates={routeCoords}
                color={color}
                height={180}
              />
              <div className="flex justify-between text-xs text-gray-600 mt-1 px-1">
                <span>Start</span>
                <span>End</span>
              </div>
            </div>
          )}

          {/* Muscle Heatmap for Strength Training */}
          {(() => {
            const areas = activity.focusAreas || (activity.focusArea ? [activity.focusArea] : []);
            if (areas.length === 0 || activity.type !== 'Strength Training') return null;
            const muscleData = {};
            areas.forEach(a => { muscleData[a] = 1; });
            // Bucket labels (Upper / Lower / Legs / Full Body) drive the heat map
            // but should never render as pills — show the individual muscles instead.
            const pillAreas = normalizeFocusAreas(areas);
            return (
              <div className="mb-4">
                <div className="text-xs text-gray-500 mb-2">Muscles Worked</div>
                <div className="p-4 rounded-xl flex flex-col items-center" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  <MuscleBodyMap muscleData={muscleData} scale={0.62} hideLabels />
                  <div className="flex flex-wrap gap-1.5 mt-3 justify-center">
                    {pillAreas.map(a => (
                      <span key={a} className="px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ backgroundColor: 'rgba(0,255,148,0.15)', color: '#00FF94' }}>{a}</span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Notes */}
          {activity.notes && (
            <div className="p-4 rounded-xl mb-4" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
              <div className="text-xs text-gray-500 mb-2">Notes</div>
              <div className="text-sm">{activity.notes}</div>
            </div>
          )}

          {/* Activity Photo */}
          {activity.photoURL && (() => {
            const photoLocked = !isPro && activity.date && (() => {
              const actDate = new Date(activity.date + 'T12:00:00');
              const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);
              return actDate < cutoff;
            })();
            return (
            <div className="mb-4 rounded-xl overflow-hidden">
              <button
                onClick={() => {
                  if (photoLocked) { onPresentPaywall?.(); return; }
                  setShowFullscreenPhoto(true);
                }}
                className="w-full relative group"
              >
                <img
                  src={activity.photoURL}
                  alt="Activity"
                  className="w-full h-auto max-h-64 object-cover"
                  style={photoLocked ? { filter: 'blur(12px)', transform: 'scale(1.05)' } : undefined}
                />
                {photoLocked ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30">
                    <span className="text-2xl mb-1">🔒</span>
                    <span className="text-xs text-white/90 font-semibold">Upgrade to Pro</span>
                    <span className="text-[10px] text-white/60 mt-0.5">to view older photos</span>
                  </div>
                ) : (
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                  <svg className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                  </svg>
                </div>
                )}
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
            );
          })()}

          {/* Reactions & Comments Section - show if user is logged in (below photo, Instagram-style) */}
          {user && (
            <div className="mb-4 pt-3 border-t border-white/10">
              {/* Reactions Row */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1">
                  {/* Only show reaction buttons if viewing someone else's activity */}
                  {activityOwnerId !== user?.uid ? (
                    reactionEmojis.map((emoji) => {
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
                    })
                  ) : (
                    /* For own activities, show reactions others left (display only) */
                    reactions.length > 0 ? (
                      reactionEmojis.map((emoji) => {
                        const count = reactions.filter(r => r.reactionType === emoji).length;
                        if (count === 0) return null;
                        return (
                          <div
                            key={emoji}
                            className="flex items-center gap-1 px-2 py-1 rounded-full bg-zinc-800"
                          >
                            <span className="text-sm">{emoji}</span>
                            <span className="text-xs text-gray-400">{count}</span>
                          </div>
                        );
                      })
                    ) : null
                  )}
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

          {/* Fullscreen Photo Modal */}
          {showFullscreenPhoto && activity.photoURL && (
            <div
              className="fixed inset-0 z-[100] bg-black flex items-center justify-center"
              onClick={() => setShowFullscreenPhoto(false)}
            >
              <div className="relative max-w-full max-h-full flex flex-col items-end" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => setShowFullscreenPhoto(false)}
                  className="mb-2 mr-1 w-10 h-10 bg-white/10 rounded-full flex items-center justify-center shrink-0"
                >
                  <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <img
                  src={activity.photoURL}
                  alt="Activity fullscreen"
                  className="max-w-full max-h-[85vh] object-contain"
                />
              </div>
            </div>
          )}

          {/* Source indicator */}
          {(activity.fromAppleHealth || activity.healthKitUUID || activity.linkedHealthKitUUID || activity.source === 'healthkit') && (
            <div className="flex items-center gap-2 text-xs text-gray-500 mb-4">
              <span>📱</span>
              <span>Synced from Apple Health</span>
              {activity.sourceDevice && (
                <span className="text-cyan-400">• {activity.sourceDevice}</span>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-2 pb-4">
            {/* Share Stamp Button */}
            {onShareStamp && (
              <button
                onClick={() => {
                  onShareStamp(activity, routeCoords);
                  handleClose();
                }}
                className="w-full py-3 rounded-xl font-medium transition-all duration-150"
                style={{ backgroundColor: 'rgba(255,149,0,0.1)', color: '#FF9500' }}
                onTouchStart={(e) => {
                  e.currentTarget.style.transform = 'scale(0.98)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,149,0,0.2)';
                }}
                onTouchEnd={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,149,0,0.1)';
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = 'scale(0.98)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,149,0,0.2)';
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,149,0,0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,149,0,0.1)';
                }}
              >
                Share Stamp
              </button>
            )}
            {/* Challenge Button — only for own activity, within 7 days, with friends */}
            {onChallenge && activityOwnerId === user?.uid && friends.length > 0 && isChallengeable(activity) && (
              <button
                onClick={() => {
                  triggerHaptic(ImpactStyle.Light);
                  onChallenge(activity);
                  handleClose();
                }}
                className="w-full py-3 rounded-xl font-medium transition-all duration-150"
                style={{ backgroundColor: 'rgba(255,214,10,0.12)', color: '#FFD60A' }}
                onTouchStart={(e) => { e.currentTarget.style.transform = 'scale(0.98)'; e.currentTarget.style.backgroundColor = 'rgba(255,214,10,0.22)'; }}
                onTouchEnd={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.backgroundColor = 'rgba(255,214,10,0.12)'; }}
                onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.98)'; e.currentTarget.style.backgroundColor = 'rgba(255,214,10,0.22)'; }}
                onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.backgroundColor = 'rgba(255,214,10,0.12)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.backgroundColor = 'rgba(255,214,10,0.12)'; }}
              >
                ⚡ Challenge a Friend
              </button>
            )}

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

export default ActivityDetailModal;
