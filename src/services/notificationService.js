/**
 * Push Notification Service for DaySeven
 *
 * Handles:
 * - FCM token management
 * - Permission requests
 * - Notification listeners
 * - Token storage in Firestore
 * - Badge count management
 */

import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { FirebaseFirestore } from '@capacitor-firebase/firestore';
import { Capacitor } from '@capacitor/core';
import { doc, setDoc, updateDoc, arrayUnion, arrayRemove, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

const isNative = Capacitor.isNativePlatform();

// Lazy-loaded badge plugin (avoids import errors on web)
let Badge = null;
const loadBadgePlugin = async () => {
  if (!isNative || Badge) return Badge;
  try {
    const module = await import('@capawesome/capacitor-badge');
    Badge = module.Badge;
    return Badge;
  } catch {
    console.warn('[Notifications] Badge plugin not available');
    return null;
  }
};

// Notification types for your app
export const NotificationType = {
  // Social notifications
  FRIEND_REQUEST: 'friend_request',
  FRIEND_ACCEPTED: 'friend_accepted',
  REACTION: 'reaction',
  COMMENT: 'comment',
  REPLY: 'reply',

  // Activity notifications
  FRIEND_WORKOUT: 'friend_workout',
  NEW_ACTIVITY_DETECTED: 'new_activity_detected',

  // Reminder notifications
  STREAK_REMINDER: 'streak_reminder',
  GOAL_REMINDER: 'goal_reminder',
  DAILY_REMINDER: 'daily_reminder',

  // Achievement notifications
  STREAK_MILESTONE: 'streak_milestone',
  GOAL_ACHIEVED: 'goal_achieved',
  WEEKLY_SUMMARY: 'weekly_summary',
  MONTHLY_SUMMARY: 'monthly_summary',
};

/**
 * Check if push notifications are supported on this platform
 */
export const isNotificationSupported = () => {
  return Capacitor.isNativePlatform();
};

/**
 * Request notification permissions from the user
 * @returns {Promise<{granted: boolean}>}
 */
export const requestNotificationPermission = async () => {
  if (!isNotificationSupported()) {
    return { granted: false };
  }

  try {
    const result = await FirebaseMessaging.requestPermissions();
    return { granted: result.receive === 'granted' };
  } catch (error) {
    console.error('[Notifications] Permission request failed:', error);
    return { granted: false };
  }
};

/**
 * Check current notification permission status
 * @returns {Promise<{granted: boolean}>}
 */
export const checkNotificationPermission = async () => {
  if (!isNotificationSupported()) {
    return { granted: false };
  }

  try {
    const result = await FirebaseMessaging.checkPermissions();
    return { granted: result.receive === 'granted' };
  } catch (error) {
    console.error('[Notifications] Permission check failed:', error);
    return { granted: false };
  }
};

/**
 * Get the FCM token for this device
 * @returns {Promise<string|null>}
 */
export const getFCMToken = async () => {
  if (!isNotificationSupported()) {
    return null;
  }

  try {
    const result = await FirebaseMessaging.getToken();
    return result.token;
  } catch (error) {
    console.error('[Notifications] Failed to get FCM token:', error);
    return null;
  }
};

/**
 * Save FCM token to Firestore for a user
 * Also stores device info for managing multiple devices
 * @param {string} userId - The user's Firebase UID
 * @param {string} token - The FCM token
 */
export const saveFCMToken = async (userId, token) => {
  if (!userId || !token) return;

  try {
    if (isNative) {
      // First, read existing tokens to merge safely
      let existingTokens = [];
      try {
        const { snapshot } = await FirebaseFirestore.getDocument({
          reference: `userTokens/${userId}`,
        });
        existingTokens = snapshot?.data?.tokens || [];
      } catch {
        // Document may not exist yet — start with empty array (expected for new users)
      }

      // Add token if not already present
      const tokensSet = new Set(existingTokens);
      tokensSet.add(token);

      await FirebaseFirestore.setDocument({
        reference: `userTokens/${userId}`,
        data: {
          userId,
          tokens: Array.from(tokensSet),
          [`devices.${token}`]: {
            token,
            platform: Capacitor.getPlatform(),
            lastUpdated: new Date().toISOString(),
          },
          updatedAt: new Date().toISOString(),
        },
        merge: true,
      });
    } else {
      const userTokensRef = doc(db, 'userTokens', userId);
      const deviceInfo = {
        token,
        platform: Capacitor.getPlatform(),
        lastUpdated: serverTimestamp(),
      };

      await setDoc(userTokensRef, {
        userId,
        tokens: arrayUnion(token),
        devices: {
          [token]: deviceInfo
        },
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }
  } catch (error) {
    console.error('[Notifications] Failed to save FCM token:', error);
  }
};

/**
 * Remove FCM token from Firestore (on logout)
 * @param {string} userId - The user's Firebase UID
 * @param {string} token - The FCM token to remove
 */
export const removeFCMToken = async (userId, token) => {
  if (!userId || !token) return;

  try {
    if (isNative) {
      // Read existing tokens, remove the current one, and write back
      let existingTokens = [];
      try {
        const { snapshot } = await FirebaseFirestore.getDocument({
          reference: `userTokens/${userId}`,
        });
        existingTokens = snapshot?.data?.tokens || [];
      } catch {
        // Document may not exist
      }

      const filtered = existingTokens.filter(t => t !== token);

      await FirebaseFirestore.setDocument({
        reference: `userTokens/${userId}`,
        data: {
          tokens: filtered,
          [`devices.${token}`]: null,
          updatedAt: new Date().toISOString(),
        },
        merge: true,
      });
    } else {
      const userTokensRef = doc(db, 'userTokens', userId);
      await updateDoc(userTokensRef, {
        tokens: arrayRemove(token),
        [`devices.${token}`]: null,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    console.error('[Notifications] Failed to remove FCM token:', error);
  }
};

/**
 * Get user's notification preferences
 * Reads from users/{uid} document (notificationPreferences field)
 * @param {string} userId - The user's Firebase UID
 * @returns {Promise<Object>}
 */
export const getNotificationPreferences = async (userId) => {
  if (!userId) return getDefaultPreferences();

  try {
    const { getUserProfile } = await import('./userService');
    const profile = await getUserProfile(userId);
    if (profile?.notificationPreferences) {
      return { ...getDefaultPreferences(), ...profile.notificationPreferences };
    }
    return getDefaultPreferences();
  } catch (error) {
    console.error('[Notifications] Failed to get preferences:', error);
    return getDefaultPreferences();
  }
};

/**
 * Save user's notification preferences
 * Writes to users/{uid} document (notificationPreferences field)
 * @param {string} userId - The user's Firebase UID
 * @param {Object} preferences - The notification preferences
 */
export const saveNotificationPreferences = async (userId, preferences) => {
  if (!userId) throw new Error('No userId');

  const { updateUserProfile } = await import('./userService');
  await updateUserProfile(userId, { notificationPreferences: preferences });
};

/**
 * Default notification preferences
 */
export const getDefaultPreferences = () => ({
  // Social notifications
  friendRequests: true,
  reactions: true,
  comments: true,
  friendActivity: true,

  // Reminders
  streakReminders: true,
  goalReminders: true,
  dailyReminders: false,
  dailyReminderTime: '09:00', // Default 9 AM

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

/**
 * Check if current time is within quiet hours
 * @param {Object} preferences - Notification preferences
 * @returns {boolean}
 */
export const isQuietHours = (preferences) => {
  if (!preferences?.quietHoursEnabled) return false;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startH, startM] = (preferences.quietHoursStart || '22:00').split(':').map(Number);
  const [endH, endM] = (preferences.quietHoursEnd || '07:00').split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    // Same day range (e.g., 08:00 - 17:00)
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Overnight range (e.g., 22:00 - 07:00)
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
};

/**
 * Check if a notification should be shown based on user preferences
 * @param {Object} notification - The notification data
 * @param {Object} preferences - User's notification preferences
 * @returns {boolean}
 */
export const shouldShowNotification = (notification, preferences) => {
  if (!preferences) return true;

  // Check quiet hours first
  if (isQuietHours(preferences)) return false;

  const type = notification?.data?.type;
  if (!type) return true;

  // Map notification types to preference keys
  const prefMap = {
    [NotificationType.FRIEND_REQUEST]: 'friendRequests',
    [NotificationType.FRIEND_ACCEPTED]: 'friendRequests',
    [NotificationType.REACTION]: 'reactions',
    [NotificationType.COMMENT]: 'comments',
    [NotificationType.REPLY]: 'comments',
    [NotificationType.FRIEND_WORKOUT]: 'friendActivity',
    [NotificationType.NEW_ACTIVITY_DETECTED]: 'newActivityDetected',
    [NotificationType.STREAK_REMINDER]: 'streakReminders',
    [NotificationType.GOAL_REMINDER]: 'goalReminders',
    [NotificationType.DAILY_REMINDER]: 'dailyReminders',
    [NotificationType.STREAK_MILESTONE]: 'streakMilestones',
    [NotificationType.GOAL_ACHIEVED]: 'goalAchievements',
    [NotificationType.WEEKLY_SUMMARY]: 'weeklySummary',
    [NotificationType.MONTHLY_SUMMARY]: 'monthlySummary',
  };

  const prefKey = prefMap[type];
  if (prefKey && preferences[prefKey] === false) return false;

  return true;
};

/**
 * Initialize push notifications for the app
 * Sets up listeners and requests permissions if needed
 * @param {string} userId - The user's Firebase UID
 * @param {Function} onNotificationReceived - Callback when notification is received in foreground
 * @param {Function} onNotificationTapped - Callback when notification is tapped
 * @returns {Promise<{cleanup: Function, token: string|null}>}
 */
export const initializePushNotifications = async (userId, onNotificationReceived, onNotificationTapped) => {
  if (!isNotificationSupported()) {
    return { cleanup: () => {}, token: null };
  }

  const listeners = [];
  let currentToken = null;

  try {
    // Request permissions
    const { granted } = await requestNotificationPermission();

    if (!granted) {
      console.warn('[Notifications] Permission not granted');
      return { cleanup: () => {}, token: null };
    }

    // Get and save FCM token
    currentToken = await getFCMToken();
    if (currentToken && userId) {
      await saveFCMToken(userId, currentToken);
    }

    // Listen for token refresh
    const tokenListener = await FirebaseMessaging.addListener('tokenReceived', async (event) => {
      currentToken = event.token;
      if (userId) {
        await saveFCMToken(userId, event.token);
      }
    });
    listeners.push(tokenListener);

    // Listen for foreground notifications
    const foregroundListener = await FirebaseMessaging.addListener('notificationReceived', (notification) => {
      if (onNotificationReceived) {
        onNotificationReceived(notification);
      }
    });
    listeners.push(foregroundListener);

    // Listen for notification taps (when user taps notification)
    const tapListener = await FirebaseMessaging.addListener('notificationActionPerformed', (event) => {
      // Clear badge on notification tap
      clearBadge();
      if (onNotificationTapped) {
        onNotificationTapped(event.notification, event.actionId);
      }
    });
    listeners.push(tapListener);

    // Return cleanup function and token
    return {
      token: currentToken,
      cleanup: () => {
        listeners.forEach(listener => {
          if (listener && listener.remove) {
            listener.remove();
          }
        });
      }
    };
  } catch (error) {
    console.error('[Notifications] Initialization failed:', error);
    return { cleanup: () => {}, token: null };
  }
};

/**
 * Handle notification navigation based on notification type
 * Call this when a notification is tapped
 * @param {Object} notification - The notification data
 * @param {Function} navigate - Navigation function (e.g., to switch tabs)
 * @param {Object} options - Additional options like callbacks for specific actions
 */
export const handleNotificationNavigation = (notification, navigate, options = {}) => {
  const data = notification?.data || {};
  const type = data.type;

  switch (type) {
    case NotificationType.FRIEND_REQUEST:
    case NotificationType.FRIEND_ACCEPTED:
      navigate('friends');
      break;

    case NotificationType.REACTION:
    case NotificationType.COMMENT:
    case NotificationType.REPLY:
    case NotificationType.FRIEND_WORKOUT:
      navigate('feed');
      break;

    case NotificationType.STREAK_REMINDER:
    case NotificationType.GOAL_REMINDER:
    case NotificationType.DAILY_REMINDER:
      navigate('home');
      break;

    case NotificationType.STREAK_MILESTONE:
    case NotificationType.GOAL_ACHIEVED:
      navigate('profile');
      break;

    case NotificationType.WEEKLY_SUMMARY:
    case NotificationType.MONTHLY_SUMMARY:
      // If there's a share prompt, navigate to profile with share modal
      if (data.showSharePrompt === 'true' && options.onShowSharePrompt) {
        options.onShowSharePrompt({
          type: type === NotificationType.WEEKLY_SUMMARY ? 'weekly' : 'monthly',
          activitiesCount: data.activitiesCount,
          totalMinutes: data.totalMinutes,
          streak: data.streak,
          month: data.month,
        });
      }
      navigate('profile');
      break;

    case NotificationType.NEW_ACTIVITY_DETECTED:
      // Navigate to home and optionally open the pending workouts modal
      if (options.onShowPendingWorkouts) {
        options.onShowPendingWorkouts(data.workoutId);
      }
      navigate('home');
      break;

    default:
      // Default to home
      navigate('home');
  }
};

/**
 * Set app badge count
 * @param {number} count - Badge count to set
 */
export const setBadge = async (count) => {
  if (!isNotificationSupported()) return;

  try {
    const badge = await loadBadgePlugin();
    if (badge) {
      await badge.set({ count });
    }
  } catch (error) {
    console.error('[Notifications] Failed to set badge:', error);
  }
};

/**
 * Get current app badge count
 * @returns {Promise<number>}
 */
export const getBadgeCount = async () => {
  if (!isNotificationSupported()) return 0;

  try {
    const badge = await loadBadgePlugin();
    if (badge) {
      const result = await badge.get();
      return result.count || 0;
    }
    return 0;
  } catch (error) {
    console.error('[Notifications] Failed to get badge count:', error);
    return 0;
  }
};

/**
 * Increment app badge count by 1
 */
export const incrementBadge = async () => {
  const current = await getBadgeCount();
  await setBadge(current + 1);
};

/**
 * Clear app badge count (set to 0)
 */
export const clearBadge = async () => {
  await setBadge(0);
};

/**
 * Clear all delivered notifications
 */
export const clearAllNotifications = async () => {
  if (!isNotificationSupported()) return;

  try {
    await FirebaseMessaging.removeAllDeliveredNotifications();
    await clearBadge();
  } catch (error) {
    console.error('[Notifications] Failed to clear notifications:', error);
  }
};

/**
 * Subscribe to a topic for group notifications
 * @param {string} topic - The topic name (e.g., 'weekly-summary')
 */
export const subscribeToTopic = async (topic) => {
  if (!isNotificationSupported()) return;

  try {
    await FirebaseMessaging.subscribeToTopic({ topic });
  } catch (error) {
    console.error('[Notifications] Failed to subscribe to topic:', error);
  }
};

/**
 * Unsubscribe from a topic
 * @param {string} topic - The topic name
 */
export const unsubscribeFromTopic = async (topic) => {
  if (!isNotificationSupported()) return;

  try {
    await FirebaseMessaging.unsubscribeFromTopic({ topic });
  } catch (error) {
    console.error('[Notifications] Failed to unsubscribe from topic:', error);
  }
};
