/**
 * NotificationSettings Component
 *
 * UI for users to manage their push notification preferences.
 * Include this in your Settings or Profile section.
 */

import React, { useState, useEffect } from 'react';
import {
  getNotificationPreferences,
  saveNotificationPreferences,
  requestNotificationPermission,
  checkNotificationPermission,
  isNotificationSupported,
} from './services/notificationService';

const NotificationSettings = ({ userId, onClose }) => {
  const [saving, setSaving] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(null); // null = checking, true/false = known
  const [preferences, setPreferences] = useState({
    // Social
    friendRequests: true,
    reactions: true,
    comments: true,
    friendActivity: true,
    // Reminders
    streakReminders: true,
    goalReminders: true,
    dailyReminders: false,
    dailyReminderTime: '09:00',
    // Activity detection
    newActivityDetected: true,
    // Achievements & Summaries
    streakMilestones: true,
    goalAchievements: true,
    weeklySummary: true,
    monthlySummary: true,
    // Quiet hours
    quietHoursEnabled: false,
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
  });

  useEffect(() => {
    loadSettings();
  }, [userId]);

  const loadSettings = async () => {
    // Load in background - UI shows immediately with defaults

    // Permission check (non-blocking)
    if (isNotificationSupported()) {
      checkNotificationPermission()
        .then(result => setPermissionGranted(result.granted))
        .catch(() => setPermissionGranted(false));
    } else {
      setPermissionGranted(false);
    }

    // Preferences fetch (non-blocking)
    if (userId) {
      getNotificationPreferences(userId)
        .then(prefs => {
          if (prefs) setPreferences(prev => ({ ...prev, ...prefs }));
        })
        .catch(err => console.log('Failed to load preferences:', err));
    }
  };

  const handleRequestPermission = async () => {
    const { granted } = await requestNotificationPermission();
    setPermissionGranted(granted);

    if (!granted) {
      alert('Please enable notifications in your device settings to receive push notifications.');
    }
  };

  const handleToggle = async (key) => {
    const newValue = !preferences[key];
    const newPrefs = { ...preferences, [key]: newValue };
    setPreferences(newPrefs);

    // Auto-save
    setSaving(true);
    try {
      await saveNotificationPreferences(userId, newPrefs);
    } catch (error) {
      console.error('Error saving preferences:', error);
      // Revert on error
      setPreferences(preferences);
    }
    setSaving(false);
  };

  const handleTimeChange = async (key, value) => {
    const newPrefs = { ...preferences, [key]: value };
    setPreferences(newPrefs);

    // Auto-save
    setSaving(true);
    try {
      await saveNotificationPreferences(userId, newPrefs);
    } catch (error) {
      console.error('Error saving preferences:', error);
      setPreferences(preferences);
    }
    setSaving(false);
  };

  const Toggle = ({ enabled, onToggle, disabled = false }) => (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        enabled ? 'bg-cyan-500' : 'bg-zinc-700'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          enabled ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );

  const SettingRow = ({ label, description, enabled, onToggle, disabled = false }) => (
    <div className="flex items-center justify-between py-3 border-b border-zinc-800">
      <div className="flex-1 pr-4">
        <p className="text-white font-medium">{label}</p>
        {description && (
          <p className="text-zinc-500 text-sm mt-0.5">{description}</p>
        )}
      </div>
      <Toggle enabled={enabled} onToggle={onToggle} disabled={disabled} />
    </div>
  );

  const SectionHeader = ({ children }) => (
    <h3 className="text-cyan-400 text-sm font-semibold uppercase tracking-wider mt-6 mb-2">
      {children}
    </h3>
  );

  // Prevent background scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const notSupported = !isNotificationSupported();
  const permissionChecking = permissionGranted === null;

  return (
    <div
      className="fixed inset-0 bg-zinc-950 z-50 overflow-auto"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        WebkitOverflowScrolling: 'touch',
        overscrollBehavior: 'contain'
      }}
    >
      <div className="min-h-full px-4 py-4 pb-20">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">Notifications</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-2 -mr-2"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {saving && (
          <div className="text-cyan-400 text-sm mb-4">Saving...</div>
        )}

        {/* Permission banner */}
        {notSupported ? (
          <div className="bg-zinc-800/50 rounded-xl p-4 mb-6">
            <p className="text-zinc-400 text-sm">
              Push notifications are only available on mobile devices.
            </p>
          </div>
        ) : permissionChecking ? (
          <div className="bg-zinc-800/50 rounded-xl p-4 mb-6">
            <p className="text-zinc-400 text-sm">Checking notification status...</p>
          </div>
        ) : !permissionGranted ? (
          <div className="bg-zinc-800/50 rounded-xl p-4 mb-6">
            <p className="text-white font-medium mb-2">Enable Notifications</p>
            <p className="text-zinc-400 text-sm mb-3">
              Get notified about friend activity, streak reminders, and more.
            </p>
            <button
              onClick={handleRequestPermission}
              className="bg-cyan-500 text-black font-semibold px-4 py-2 rounded-lg"
            >
              Enable Notifications
            </button>
          </div>
        ) : (
          <div className="bg-green-900/30 border border-green-700/50 rounded-xl p-4 mb-6">
            <p className="text-green-400 text-sm flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              Notifications are enabled
            </p>
          </div>
        )}

        {/* Settings sections */}
        <div className={notSupported || !permissionGranted ? 'opacity-50 pointer-events-none' : ''}>
          {/* Social Notifications */}
          <SectionHeader>Social</SectionHeader>
          <div className="bg-zinc-900/50 rounded-xl px-4">
            <SettingRow
              label="Friend Requests"
              description="When someone sends you a friend request"
              enabled={preferences.friendRequests}
              onToggle={() => handleToggle('friendRequests')}
            />
            <SettingRow
              label="Reactions"
              description="When someone reacts to your activity"
              enabled={preferences.reactions}
              onToggle={() => handleToggle('reactions')}
            />
            <SettingRow
              label="Comments"
              description="When someone comments on your activity"
              enabled={preferences.comments}
              onToggle={() => handleToggle('comments')}
            />
            <SettingRow
              label="Friend Activity"
              description="When friends complete workouts"
              enabled={preferences.friendActivity}
              onToggle={() => handleToggle('friendActivity')}
            />
          </div>

          {/* Reminders */}
          <SectionHeader>Reminders</SectionHeader>
          <div className="bg-zinc-900/50 rounded-xl px-4">
            <SettingRow
              label="Streak Reminders"
              description="Remind me to log activity before losing my streak"
              enabled={preferences.streakReminders}
              onToggle={() => handleToggle('streakReminders')}
            />
            <SettingRow
              label="Goal Reminders"
              description="Remind me about my weekly goals"
              enabled={preferences.goalReminders}
              onToggle={() => handleToggle('goalReminders')}
            />
            <div className="py-3 border-b border-zinc-800">
              <div className="flex items-center justify-between">
                <div className="flex-1 pr-4">
                  <p className="text-white font-medium">Daily Reminder</p>
                  <p className="text-zinc-500 text-sm mt-0.5">
                    Get a daily reminder to work out
                  </p>
                </div>
                <Toggle
                  enabled={preferences.dailyReminders}
                  onToggle={() => handleToggle('dailyReminders')}
                />
              </div>
              {preferences.dailyReminders && (
                <div className="mt-3">
                  <label className="text-zinc-400 text-sm">Remind me at</label>
                  <select
                    value={preferences.dailyReminderTime}
                    onChange={(e) => handleTimeChange('dailyReminderTime', e.target.value)}
                    className="ml-3 bg-zinc-800 text-white rounded-lg px-3 py-1.5 text-sm"
                  >
                    {Array.from({ length: 24 }, (_, i) => {
                      const hour = i.toString().padStart(2, '0');
                      const label = i === 0 ? '12:00 AM' :
                        i < 12 ? `${i}:00 AM` :
                        i === 12 ? '12:00 PM' :
                        `${i - 12}:00 PM`;
                      return (
                        <option key={hour} value={`${hour}:00`}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Activity Detection */}
          <SectionHeader>Activity Detection</SectionHeader>
          <div className="bg-zinc-900/50 rounded-xl px-4">
            <SettingRow
              label="New Workout Detected"
              description="When Apple Health syncs a workout you can log"
              enabled={preferences.newActivityDetected}
              onToggle={() => handleToggle('newActivityDetected')}
            />
          </div>

          {/* Achievements & Summaries */}
          <SectionHeader>Achievements & Summaries</SectionHeader>
          <div className="bg-zinc-900/50 rounded-xl px-4">
            <SettingRow
              label="Streak Milestones"
              description="Celebrate when you hit 7, 30, 100 day streaks"
              enabled={preferences.streakMilestones}
              onToggle={() => handleToggle('streakMilestones')}
            />
            <SettingRow
              label="Goal Achievements"
              description="When you complete your weekly goals"
              enabled={preferences.goalAchievements}
              onToggle={() => handleToggle('goalAchievements')}
            />
            <SettingRow
              label="Weekly Summary"
              description="Get a summary of your week every Sunday with option to share"
              enabled={preferences.weeklySummary}
              onToggle={() => handleToggle('weeklySummary')}
            />
            <SettingRow
              label="Monthly Summary"
              description="Get a recap on the 1st of each month with option to share"
              enabled={preferences.monthlySummary}
              onToggle={() => handleToggle('monthlySummary')}
            />
          </div>

          {/* Quiet Hours */}
          <SectionHeader>Quiet Hours</SectionHeader>
          <div className="bg-zinc-900/50 rounded-xl px-4">
            <div className="py-3 border-b border-zinc-800">
              <div className="flex items-center justify-between">
                <div className="flex-1 pr-4">
                  <p className="text-white font-medium">Quiet Hours</p>
                  <p className="text-zinc-500 text-sm mt-0.5">
                    Don't send notifications during these hours
                  </p>
                </div>
                <Toggle
                  enabled={preferences.quietHoursEnabled}
                  onToggle={() => handleToggle('quietHoursEnabled')}
                />
              </div>
              {preferences.quietHoursEnabled && (
                <div className="mt-3 flex items-center gap-2">
                  <select
                    value={preferences.quietHoursStart}
                    onChange={(e) => handleTimeChange('quietHoursStart', e.target.value)}
                    className="bg-zinc-800 text-white rounded-lg px-3 py-1.5 text-sm"
                  >
                    {Array.from({ length: 24 }, (_, i) => {
                      const hour = i.toString().padStart(2, '0');
                      const label = i === 0 ? '12:00 AM' :
                        i < 12 ? `${i}:00 AM` :
                        i === 12 ? '12:00 PM' :
                        `${i - 12}:00 PM`;
                      return (
                        <option key={hour} value={`${hour}:00`}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                  <span className="text-zinc-500">to</span>
                  <select
                    value={preferences.quietHoursEnd}
                    onChange={(e) => handleTimeChange('quietHoursEnd', e.target.value)}
                    className="bg-zinc-800 text-white rounded-lg px-3 py-1.5 text-sm"
                  >
                    {Array.from({ length: 24 }, (_, i) => {
                      const hour = i.toString().padStart(2, '0');
                      const label = i === 0 ? '12:00 AM' :
                        i < 12 ? `${i}:00 AM` :
                        i === 12 ? '12:00 PM' :
                        `${i - 12}:00 PM`;
                      return (
                        <option key={hour} value={`${hour}:00`}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-8 text-center text-zinc-600 text-xs">
          Notification preferences are synced across your devices
        </div>
      </div>
    </div>
  );
};

export default NotificationSettings;
