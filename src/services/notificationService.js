/**
 * Push Notification Service for DaySeven
 *
 * Handles:
 * - FCM token management
 * - Permission requests
 * - Notification listeners
 * - Token storage in Firestore
 */

import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { Capacitor } from '@capacitor/core';
import { doc, setDoc, updateDoc, arrayUnion, arrayRemove, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

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
    const userTokensRef = doc(db, 'userTokens', userId);
    const deviceInfo = {
      token,
      platform: Capacitor.getPlatform(),
      lastUpdated: serverTimestamp(),
    };

    // Use setDoc with merge to create or update
    await setDoc(userTokensRef, {
      userId,
      tokens: arrayUnion(token),
      devices: {
        [token]: deviceInfo
      },
      updatedAt: serverTimestamp(),
    }, { merge: true });

  } catch (error) {
    // token save failed
  }
};

/**
 * Remove FCM token from Firestore (on logout or token refresh)
 * @param {string} userId - The user's Firebase UID
 * @param {string} token - The FCM token to remove
 */
export const removeFCMToken = async (userId, token) => {
  if (!userId || !token) return;

  try {
    const userTokensRef = doc(db, 'userTokens', userId);
    await updateDoc(userTokensRef, {
      tokens: arrayRemove(token),
      [`devices.${token}`]: null,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    // token removal failed
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
 * Initialize push notifications for the app
 * Sets up listeners and requests permissions if needed
 * @param {string} userId - The user's Firebase UID
 * @param {Function} onNotificationReceived - Callback when notification is received
 * @param {Function} onNotificationTapped - Callback when notification is tapped
 * @returns {Promise<{cleanup: Function}>}
 */
export const initializePushNotifications = async (userId, onNotificationReceived, onNotificationTapped) => {
  if (!isNotificationSupported()) {
    return { cleanup: () => {} };
  }

  const listeners = [];

  try {
    // Request permissions
    const { granted } = await requestNotificationPermission();

    if (!granted) {
      return { cleanup: () => {} };
    }

    // Get and save FCM token
    const token = await getFCMToken();
    if (token && userId) {
      await saveFCMToken(userId, token);
    }

    // Listen for token refresh
    const tokenListener = await FirebaseMessaging.addListener('tokenReceived', async (event) => {
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
      if (onNotificationTapped) {
        onNotificationTapped(event.notification, event.actionId);
      }
    });
    listeners.push(tapListener);

    // Return cleanup function
    return {
      cleanup: () => {
        listeners.forEach(listener => {
          if (listener && listener.remove) {
            listener.remove();
          }
        });
      }
    };
  } catch (error) {
    return { cleanup: () => {} };
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
 * Get badge count for the app
 * @returns {Promise<number>}
 */
export const getBadgeCount = async () => {
  if (!isNotificationSupported()) return 0;

  try {
    // Note: You'll need to track this in your app state or Firestore
    // FCM doesn't provide a direct way to get badge count
    return 0;
  } catch (error) {
    return 0;
  }
};

/**
 * Clear all notifications
 */
export const clearAllNotifications = async () => {
  if (!isNotificationSupported()) return;

  try {
    await FirebaseMessaging.removeAllDeliveredNotifications();
  } catch (error) {
    // clear failed
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
    // subscribe failed
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
    // unsubscribe failed
  }
};
