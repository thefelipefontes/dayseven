import React, { useState, useEffect } from 'react';
import SectionIcon from './SectionIcon';
import { SwipeableProvider, SwipeableActivityItem } from './SwipeableActivityItem';
import ActivityIcon from './ActivityIcon';
import { initialUserData } from '../utils/initialUserData';

const WeekStatsModal = ({ isOpen, onClose, weekData, weekLabel, onDeleteActivity, onSelectActivity, onShare, userData }) => {
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
  
  const getWeekActivityCategory = (a) => {
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
  const lifts = weekData?.activities?.filter(a => getWeekActivityCategory(a) === 'lifting') || [];
  const cardioActivities = weekData?.activities?.filter(a => getWeekActivityCategory(a) === 'cardio') || [];
  const recoveryActivities = weekData?.activities?.filter(a => getWeekActivityCategory(a) === 'recovery') || [];
  const nonCardioWalks = weekData?.activities?.filter(a =>
    a.type === 'Walking' && !a.countToward
  ) || [];

  const goals = userData?.goals || initialUserData.goals;
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
            onClick={() => onShare && onShare()}
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
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
              <polyline points="16 6 12 2 8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
            <span>Share</span>
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(0,255,148,0.1)' }}>
            <div className="text-2xl font-black" style={{ color: '#00FF94' }}>{weekData?.lifts || 0}</div>
            <div className="text-[10px] text-gray-400">💪 Strength</div>
          </div>
          <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'rgba(255,149,0,0.1)' }}>
            <div className="text-2xl font-black" style={{ color: '#FF9500' }}>{weekData?.cardio || 0}</div>
            <div className="text-[10px] text-gray-400">❤️‍🔥 Cardio</div>
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
          <div className="flex items-center gap-2 mb-3">
            <SectionIcon type="chart" />
            <span className="text-[20px] font-semibold text-white" style={{ letterSpacing: '-0.3px' }}>Week Totals</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
              <div className="text-lg font-black">{weekData?.calories?.toLocaleString() || 0}</div>
              <div className="text-[10px] text-gray-400">Calories Burned</div>
              <div className="text-[10px] text-gray-500 mt-1">~{Math.round((weekData?.calories || 0) / 7).toLocaleString()}/day avg</div>
            </div>
            <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
              <div className="text-lg font-black">{(weekData?.miles || 0).toFixed(2)} mi</div>
              <div className="text-[10px] text-gray-400">Distance Traveled</div>
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
          <div className="flex items-center gap-2 mb-3">
            <SectionIcon type="streak" />
            <span className="text-[20px] font-semibold text-white" style={{ letterSpacing: '-0.3px' }}>Streaks Maintained</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="p-3 rounded-xl flex items-center justify-between" style={{ 
              backgroundColor: liftsGoalMet ? 'rgba(0,255,148,0.1)' : 'rgba(255,255,255,0.05)',
              border: liftsGoalMet ? '1px solid rgba(0,255,148,0.2)' : 'none'
            }}>
              <div>
                <span className="text-xs">💪 Strength</span>
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
                <span className="text-xs">❤️‍🔥 Cardio</span>
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
          <div className="flex items-center gap-2">
            <SectionIcon type="activity" />
            <span className="text-[20px] font-semibold text-white" style={{ letterSpacing: '-0.3px' }}>Activities Completed</span>
          </div>
          <p className="text-[13px] -mt-1 pl-[30px]" style={{ color: '#777' }}>All sessions from this week</p>
        </div>

        <SwipeableProvider>
        {/* Strength Section */}
        {lifts.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-300">💪 Strength ({lifts.length})</span>
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
                        {activity.type === 'Other' && (activity.customIcon || activity.customEmoji) && <ActivityIcon type="Other" customIcon={activity.customIcon} customEmoji={activity.customEmoji} size={14} />}
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
                <span className="text-xs font-medium text-gray-300">❤️‍🔥 Cardio ({cardioActivities.length})</span>
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
                        {activity.type === 'Other' && (activity.customIcon || activity.customEmoji) && <ActivityIcon type="Other" customIcon={activity.customIcon} customEmoji={activity.customEmoji} size={14} />}
                        {activity.subtype || activity.type}
                      </div>
                      <div className="text-xs text-gray-500">{activity.date}</div>
                    </div>
                    <div className="flex gap-4 text-xs text-gray-400">
                      {activity.distance && <span>{parseFloat(activity.distance).toFixed(2)} mi</span>}
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
                <span className="text-xs font-medium text-gray-300">🧊 Recovery ({recoveryActivities.length})</span>
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
                        {activity.type === 'Other' && (activity.customIcon || activity.customEmoji) && <ActivityIcon type="Other" customIcon={activity.customIcon} customEmoji={activity.customEmoji} size={14} />}
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

        {/* Non-Cardio Walks Section */}
        {nonCardioWalks.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-400">🚶 Walks</span>
                <span className="text-[10px] text-gray-500">(non-cardio)</span>
              </div>
            </div>
            <div className="space-y-2">
              {nonCardioWalks.map((activity, i) => (
                <SwipeableActivityItem
                  key={activity.id || i}
                  activity={activity}
                  onDelete={(act) => onDeleteActivity?.(act.id)}
                >
                  <div
                    onClick={() => onSelectActivity?.(activity)}
                    className="p-3 rounded-xl cursor-pointer"
                    style={{ backgroundColor: 'rgba(128,128,128,0.05)' }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-medium text-sm flex items-center gap-1">
                        {activity.subtype ? `Walking • ${activity.subtype}` : 'Walking'}
                      </div>
                      <div className="text-xs text-gray-500">{activity.date}</div>
                    </div>
                    <div className="flex gap-4 text-xs text-gray-400">
                      {activity.distance && <span>{parseFloat(activity.distance).toFixed(2)} mi</span>}
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
    </div>
  );
};

export default WeekStatsModal;
