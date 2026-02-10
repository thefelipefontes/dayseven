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
  const [saveStatus, setSaveStatus] = useState(null); // null, 'saved', 'error'
  const [permissionGranted, setPermissionGranted] = useState(null); // null = checking, true/false = known
  const [allEnabled, setAllEnabled] = useState(true);
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
          if (prefs) {
            setPreferences(prev => ({ ...prev, ...prefs }));
            // Check if all toggleable preferences are off
            const toggleKeys = ['friendRequests', 'reactions', 'comments', 'friendActivity', 'streakReminders', 'goalReminders', 'dailyReminders', 'newActivityDetected', 'streakMilestones', 'weeklySummary', 'monthlySummary'];
            const anyEnabled = toggleKeys.some(key => prefs[key]);
            setAllEnabled(anyEnabled);
          }
        })
        .catch(() => {});
    }
  };

  const handleRequestPermission = async () => {
    const { granted } = await requestNotificationPermission();
    setPermissionGranted(granted);

    if (!granted) {
      alert('Please enable notifications in your device settings to receive push notifications.');
    }
  };

  const saveWithTimeout = async (prefs) => {
    // Always include the user's timezone so cloud functions send at the right local time
    const prefsWithTz = { ...prefs, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Save timeout')), 5000)
    );
    await Promise.race([
      saveNotificationPreferences(userId, prefsWithTz),
      timeoutPromise
    ]);
  };

  const handleToggle = async (key) => {
    const newValue = !preferences[key];
    const newPrefs = { ...preferences, [key]: newValue };
    setPreferences(newPrefs);

    // Update master toggle state
    const toggleKeys = ['friendRequests', 'reactions', 'comments', 'friendActivity', 'streakReminders', 'goalReminders', 'dailyReminders', 'newActivityDetected', 'streakMilestones', 'weeklySummary', 'monthlySummary'];
    const anyEnabled = toggleKeys.some(k => k === key ? newValue : newPrefs[k]);
    setAllEnabled(anyEnabled);

    // Auto-save with timeout
    setSaving(true);
    setSaveStatus(null);
    try {
      await saveWithTimeout(newPrefs);
      setSaveStatus('saved');
    } catch (error) {
      setSaveStatus('error');
      setPreferences(preferences);
    }
    setSaving(false);
    setTimeout(() => setSaveStatus(null), 2000);
  };

  const handleToggleAll = async () => {
    const newEnabled = !allEnabled;
    setAllEnabled(newEnabled);

    const toggleKeys = ['friendRequests', 'reactions', 'comments', 'friendActivity', 'streakReminders', 'goalReminders', 'dailyReminders', 'newActivityDetected', 'streakMilestones', 'weeklySummary', 'monthlySummary'];
    const newPrefs = { ...preferences };
    toggleKeys.forEach(key => { newPrefs[key] = newEnabled; });
    setPreferences(newPrefs);

    setSaving(true);
    setSaveStatus(null);
    try {
      await saveWithTimeout(newPrefs);
      setSaveStatus('saved');
    } catch (error) {
      setSaveStatus('error');
      setPreferences(preferences);
      setAllEnabled(!newEnabled);
    }
    setSaving(false);
    setTimeout(() => setSaveStatus(null), 2000);
  };

  const handleTimeChange = async (key, value) => {
    const newPrefs = { ...preferences, [key]: value };
    setPreferences(newPrefs);

    // Auto-save with timeout
    setSaving(true);
    setSaveStatus(null);
    try {
      await saveWithTimeout(newPrefs);
      setSaveStatus('saved');
    } catch (error) {
      setSaveStatus('error');
      setPreferences(preferences);
    }
    setSaving(false);
    setTimeout(() => setSaveStatus(null), 2000);
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
        WebkitOverflowScrolling: 'touch',
        overscrollBehavior: 'contain'
      }}
    >
      {/* Status bar blur overlay */}
      <div
        className="fixed top-0 left-0 right-0 z-[60] pointer-events-none"
        style={{
          height: 'calc(env(safe-area-inset-top, 0px) + 30px)',
          background: 'linear-gradient(to bottom, rgba(10, 10, 10, 1) 0%, rgba(10, 10, 10, 1) 50%, rgba(10, 10, 10, 0.9) 70%, rgba(10, 10, 10, 0.6) 85%, transparent 100%)',
          maskImage: 'linear-gradient(to bottom, black 0%, black 50%, rgba(0,0,0,0.7) 70%, rgba(0,0,0,0.3) 85%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 50%, rgba(0,0,0,0.7) 70%, rgba(0,0,0,0.3) 85%, transparent 100%)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}
      />
      <div className="min-h-full px-4 py-4 pb-20" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}>
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
        {!saving && saveStatus === 'saved' && (
          <div className="text-green-400 text-sm mb-4">Saved</div>
        )}
        {!saving && saveStatus === 'error' && (
          <div className="text-red-400 text-sm mb-4">Failed to save. Please try again.</div>
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
          {/* Master Toggle */}
          <div className="bg-zinc-900/50 rounded-xl px-4 mb-4">
            <div className="flex items-center justify-between py-4">
              <div className="flex-1 pr-4">
                <p className="text-white font-semibold text-lg">All Notifications</p>
                <p className="text-zinc-500 text-sm mt-0.5">
                  {allEnabled ? 'Turn off all notifications' : 'Turn on all notifications'}
                </p>
              </div>
              <Toggle enabled={allEnabled} onToggle={handleToggleAll} />
            </div>
          </div>

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
              description="Nudge me if I haven't logged in 2+ days"
              enabled={preferences.streakReminders}
              onToggle={() => handleToggle('streakReminders')}
            />
            <SettingRow
              label="Goal Reminders"
              description="Thursday reminder of what I need to hit my goals"
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
                    {Array.from({ length: 24 * 4 }, (_, i) => {
                      const hour = Math.floor(i / 4);
                      const minute = (i % 4) * 15;
                      const hourStr = hour.toString().padStart(2, '0');
                      const minuteStr = minute.toString().padStart(2, '0');
                      const value = `${hourStr}:${minuteStr}`;
                      const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
                      const ampm = hour < 12 ? 'AM' : 'PM';
                      const label = `${displayHour}:${minuteStr} ${ampm}`;
                      return (
                        <option key={value} value={value}>
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
              description="Celebrate 5, 10, 25, 52, 78, and 104-week streaks"
              enabled={preferences.streakMilestones}
              onToggle={() => handleToggle('streakMilestones')}
            />
            <SettingRow
              label="Weekly Summary"
              description="Sunday recap with workouts, recovery, and calories"
              enabled={preferences.weeklySummary}
              onToggle={() => handleToggle('weeklySummary')}
            />
            <SettingRow
              label="Monthly Summary"
              description="1st of each month recap with comparison to last month"
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
