/**
 * DaySeven Cloud Functions for Push Notifications
 *
 * These functions trigger on Firestore events and send push notifications
 * to users via Firebase Cloud Messaging (FCM).
 */

const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

// Initialize Firebase Admin
initializeApp();

const db = getFirestore();
const messaging = getMessaging();

// Notification types
const NotificationType = {
  FRIEND_REQUEST: 'friend_request',
  FRIEND_ACCEPTED: 'friend_accepted',
  REACTION: 'reaction',
  COMMENT: 'comment',
  REPLY: 'reply',
  FRIEND_WORKOUT: 'friend_workout',
  STREAK_REMINDER: 'streak_reminder',
  GOAL_REMINDER: 'goal_reminder',
  DAILY_REMINDER: 'daily_reminder',
  STREAK_MILESTONE: 'streak_milestone',
  GOAL_ACHIEVED: 'goal_achieved',
  WEEKLY_SUMMARY: 'weekly_summary',
  MONTHLY_SUMMARY: 'monthly_summary',
  NEW_ACTIVITY_DETECTED: 'new_activity_detected',
};

/**
 * Helper: Get user's FCM tokens
 */
async function getUserTokens(userId) {
  const tokenDoc = await db.collection('userTokens').doc(userId).get();
  if (!tokenDoc.exists) return [];
  return tokenDoc.data().tokens || [];
}

/**
 * Helper: Get user's notification preferences
 */
async function getUserPreferences(userId) {
  const prefsDoc = await db.collection('notificationPreferences').doc(userId).get();
  if (!prefsDoc.exists) return getDefaultPreferences();
  return { ...getDefaultPreferences(), ...prefsDoc.data() };
}

/**
 * Helper: Get user's display name
 */
async function getUserDisplayName(userId) {
  const userDoc = await db.collection('users').doc(userId).get();
  if (!userDoc.exists) return 'Someone';
  return userDoc.data().displayName || userDoc.data().username || 'Someone';
}

/**
 * Helper: Check if current time is within quiet hours
 */
function isQuietHours(preferences) {
  if (!preferences.quietHoursEnabled) return false;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startHour, startMin] = preferences.quietHoursStart.split(':').map(Number);
  const [endHour, endMin] = preferences.quietHoursEnd.split(':').map(Number);

  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;

  // Handle overnight quiet hours (e.g., 22:00 to 07:00)
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

/**
 * Default notification preferences
 */
function getDefaultPreferences() {
  return {
    friendRequests: true,
    reactions: true,
    comments: true,
    friendActivity: true,
    streakReminders: true,
    goalReminders: true,
    dailyReminders: false,
    dailyReminderTime: '09:00',
    streakMilestones: true,
    goalAchievements: true,
    weeklySummary: true,
    monthlySummary: true,
    newActivityDetected: true,
    quietHoursEnabled: false,
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
  };
}

/**
 * Helper: Send notification to user
 */
async function sendNotificationToUser(userId, title, body, data = {}, options = {}) {
  try {
    const tokens = await getUserTokens(userId);
    if (tokens.length === 0) {
      console.log(`No tokens found for user ${userId}`);
      return { success: false, reason: 'no_tokens' };
    }

    const preferences = await getUserPreferences(userId);

    // Check quiet hours
    if (isQuietHours(preferences) && !options.ignoreQuietHours) {
      console.log(`Quiet hours active for user ${userId}, skipping notification`);
      return { success: false, reason: 'quiet_hours' };
    }

    // Build the message
    const message = {
      notification: {
        title,
        body,
      },
      data: {
        ...data,
        timestamp: Date.now().toString(),
      },
      apns: {
        payload: {
          aps: {
            badge: data.badge ? parseInt(data.badge) : 1,
            sound: 'default',
          },
        },
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'default',
        },
      },
      tokens,
    };

    // Send to all user's devices
    const response = await messaging.sendEachForMulticast(message);

    console.log(`Notification sent to ${userId}: ${response.successCount} success, ${response.failureCount} failures`);

    // Clean up invalid tokens
    if (response.failureCount > 0) {
      const invalidTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const error = resp.error;
          if (
            error?.code === 'messaging/invalid-registration-token' ||
            error?.code === 'messaging/registration-token-not-registered'
          ) {
            invalidTokens.push(tokens[idx]);
          }
        }
      });

      if (invalidTokens.length > 0) {
        const tokenRef = db.collection('userTokens').doc(userId);
        await tokenRef.update({
          tokens: FieldValue.arrayRemove(...invalidTokens),
        });
        console.log(`Removed ${invalidTokens.length} invalid tokens for user ${userId}`);
      }
    }

    return { success: response.successCount > 0 };
  } catch (error) {
    console.error(`Error sending notification to ${userId}:`, error);
    return { success: false, error: error.message };
  }
}

// ==========================================
// SOCIAL NOTIFICATIONS
// ==========================================

/**
 * Send notification when someone sends a friend request
 */
exports.onFriendRequestCreated = onDocumentCreated(
  'friendRequests/{requestId}',
  async (event) => {
    const request = event.data.data();
    const { toUserId, fromUserId } = request;

    const prefs = await getUserPreferences(toUserId);
    if (!prefs.friendRequests) return;

    const fromName = await getUserDisplayName(fromUserId);

    await sendNotificationToUser(
      toUserId,
      'New Friend Request',
      `${fromName} wants to be your friend`,
      {
        type: NotificationType.FRIEND_REQUEST,
        fromUserId,
        requestId: event.params.requestId,
      }
    );
  }
);

/**
 * Send notification when a friend request is accepted
 */
exports.onFriendshipCreated = onDocumentCreated(
  'friendships/{friendshipId}',
  async (event) => {
    const friendship = event.data.data();
    const { user1, user2, initiatedBy } = friendship;

    // Notify the person who sent the original request
    const notifyUserId = initiatedBy === user1 ? user1 : user2;
    const acceptedByUserId = initiatedBy === user1 ? user2 : user1;

    const prefs = await getUserPreferences(notifyUserId);
    if (!prefs.friendRequests) return;

    const acceptedByName = await getUserDisplayName(acceptedByUserId);

    await sendNotificationToUser(
      notifyUserId,
      'Friend Request Accepted',
      `${acceptedByName} accepted your friend request`,
      {
        type: NotificationType.FRIEND_ACCEPTED,
        friendUserId: acceptedByUserId,
      }
    );
  }
);

/**
 * Send notification when someone reacts to an activity
 */
exports.onReactionCreated = onDocumentCreated(
  'reactions/{reactionId}',
  async (event) => {
    const reaction = event.data.data();
    const { activityOwnerId, userId: reactorId, emoji } = reaction;

    // Don't notify yourself
    if (activityOwnerId === reactorId) return;

    const prefs = await getUserPreferences(activityOwnerId);
    if (!prefs.reactions) return;

    const reactorName = await getUserDisplayName(reactorId);

    await sendNotificationToUser(
      activityOwnerId,
      'New Reaction',
      `${reactorName} reacted ${emoji} to your activity`,
      {
        type: NotificationType.REACTION,
        fromUserId: reactorId,
        emoji,
        activityId: reaction.activityId,
      }
    );
  }
);

/**
 * Send notification when someone comments on an activity
 */
exports.onCommentCreated = onDocumentCreated(
  'comments/{commentId}',
  async (event) => {
    const comment = event.data.data();
    const { activityOwnerId, userId: commenterId, text } = comment;

    // Don't notify yourself
    if (activityOwnerId === commenterId) return;

    const prefs = await getUserPreferences(activityOwnerId);
    if (!prefs.comments) return;

    const commenterName = await getUserDisplayName(commenterId);
    const truncatedText = text.length > 50 ? text.substring(0, 47) + '...' : text;

    await sendNotificationToUser(
      activityOwnerId,
      'New Comment',
      `${commenterName}: "${truncatedText}"`,
      {
        type: NotificationType.COMMENT,
        fromUserId: commenterId,
        activityId: comment.activityId,
        commentId: event.params.commentId,
      }
    );
  }
);

// ==========================================
// ACTIVITY NOTIFICATIONS
// ==========================================

/**
 * Send notification to friends when someone logs a workout
 * This is optional and can be enabled per-user
 */
exports.onActivityCreated = onDocumentCreated(
  'activities/{activityId}',
  async (event) => {
    const activity = event.data.data();
    const { userId, type, duration } = activity;

    // Get user's friends
    const friendsSnapshot = await db.collection('friendships')
      .where('users', 'array-contains', userId)
      .get();

    if (friendsSnapshot.empty) return;

    const userName = await getUserDisplayName(userId);
    const durationMin = Math.round(duration / 60);

    // Notify each friend who has friendActivity notifications enabled
    const notificationPromises = friendsSnapshot.docs.map(async (doc) => {
      const friendship = doc.data();
      const friendId = friendship.users.find(id => id !== userId);

      const prefs = await getUserPreferences(friendId);
      if (!prefs.friendActivity) return;

      return sendNotificationToUser(
        friendId,
        'Friend Activity',
        `${userName} completed a ${durationMin}min ${type}`,
        {
          type: NotificationType.FRIEND_WORKOUT,
          fromUserId: userId,
          activityId: event.params.activityId,
          activityType: type,
        }
      );
    });

    await Promise.all(notificationPromises.filter(Boolean));
  }
);

// ==========================================
// SCHEDULED REMINDERS
// ==========================================

/**
 * Daily streak reminder - runs every day at 8 PM
 * Reminds users who haven't logged activity today but have an active streak
 */
exports.sendStreakReminders = onSchedule(
  {
    schedule: '0 20 * * *', // 8 PM every day
    timeZone: 'America/New_York',
  },
  async () => {
    console.log('Running streak reminder job');

    const today = new Date().toISOString().split('T')[0];

    // Get users with active streaks who want reminders
    const usersSnapshot = await db.collection('users')
      .where('streak', '>', 0)
      .get();

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();

      // Check if they already logged today
      const activitiesSnapshot = await db.collection('activities')
        .where('userId', '==', userId)
        .where('date', '==', today)
        .limit(1)
        .get();

      if (!activitiesSnapshot.empty) continue; // Already logged today

      const prefs = await getUserPreferences(userId);
      if (!prefs.streakReminders) continue;

      await sendNotificationToUser(
        userId,
        'Protect Your Streak!',
        `You have a ${userData.streak}-day streak. Log activity today to keep it going!`,
        {
          type: NotificationType.STREAK_REMINDER,
          streak: userData.streak.toString(),
        }
      );
    }
  }
);

/**
 * Daily scheduled reminder - runs every hour to check for users' preferred time
 * Users can set their preferred daily reminder time
 */
exports.sendDailyReminders = onSchedule(
  {
    schedule: '0 * * * *', // Every hour
    timeZone: 'America/New_York',
  },
  async () => {
    const now = new Date();
    const currentHour = now.getHours().toString().padStart(2, '0');
    const currentTime = `${currentHour}:00`;

    console.log(`Checking daily reminders for time: ${currentTime}`);

    // Get users who want reminders at this time
    const prefsSnapshot = await db.collection('notificationPreferences')
      .where('dailyReminders', '==', true)
      .get();

    for (const prefDoc of prefsSnapshot.docs) {
      const prefs = prefDoc.data();
      const reminderHour = prefs.dailyReminderTime?.split(':')[0] || '09';

      if (reminderHour !== currentHour) continue;

      const userId = prefDoc.id;

      // Check if they already logged today
      const today = new Date().toISOString().split('T')[0];
      const activitiesSnapshot = await db.collection('activities')
        .where('userId', '==', userId)
        .where('date', '==', today)
        .limit(1)
        .get();

      if (!activitiesSnapshot.empty) continue; // Already logged today

      await sendNotificationToUser(
        userId,
        'Time to Move!',
        'Ready for today\'s workout? Your body will thank you.',
        {
          type: NotificationType.DAILY_REMINDER,
        }
      );
    }
  }
);

/**
 * Weekly summary - runs every Sunday at 10 AM
 * Includes social sharing prompt for users who had a great week
 */
exports.sendWeeklySummary = onSchedule(
  {
    schedule: '0 10 * * 0', // 10 AM every Sunday
    timeZone: 'America/New_York',
  },
  async () => {
    console.log('Sending weekly summaries');

    const usersSnapshot = await db.collection('users').get();
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const weekAgoStr = oneWeekAgo.toISOString().split('T')[0];

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();

      const prefs = await getUserPreferences(userId);
      if (!prefs.weeklySummary) continue;

      // Count activities this week
      const activitiesSnapshot = await db.collection('activities')
        .where('userId', '==', userId)
        .where('date', '>=', weekAgoStr)
        .get();

      const count = activitiesSnapshot.size;
      const currentStreak = userData.streak || 0;

      // Calculate total duration this week
      let totalMinutes = 0;
      activitiesSnapshot.docs.forEach(doc => {
        const activity = doc.data();
        totalMinutes += Math.round((activity.duration || 0) / 60);
      });

      if (count === 0) {
        await sendNotificationToUser(
          userId,
          'Weekly Check-in',
          'No workouts logged this week. New week, fresh start!',
          {
            type: NotificationType.WEEKLY_SUMMARY,
            activitiesCount: '0',
            totalMinutes: '0',
            showSharePrompt: 'false',
          }
        );
      } else if (count >= 5 || currentStreak >= 7) {
        // Great week - prompt to share with friends!
        await sendNotificationToUser(
          userId,
          'Amazing Week! Share with Friends?',
          `${count} workouts, ${totalMinutes} minutes${currentStreak >= 7 ? `, ${currentStreak}-day streak` : ''}! Your friends would love to see this.`,
          {
            type: NotificationType.WEEKLY_SUMMARY,
            activitiesCount: count.toString(),
            totalMinutes: totalMinutes.toString(),
            streak: currentStreak.toString(),
            showSharePrompt: 'true',
          }
        );
      } else {
        await sendNotificationToUser(
          userId,
          'Your Week in Review',
          `You crushed ${count} workout${count > 1 ? 's' : ''} (${totalMinutes} min) this week! Keep it up!`,
          {
            type: NotificationType.WEEKLY_SUMMARY,
            activitiesCount: count.toString(),
            totalMinutes: totalMinutes.toString(),
            showSharePrompt: 'false',
          }
        );
      }
    }
  }
);

/**
 * Monthly summary - runs on the 1st of each month at 10 AM
 * Includes social sharing prompt and month-over-month comparison
 */
exports.sendMonthlySummary = onSchedule(
  {
    schedule: '0 10 1 * *', // 10 AM on the 1st of every month
    timeZone: 'America/New_York',
  },
  async () => {
    console.log('Sending monthly summaries');

    const usersSnapshot = await db.collection('users').get();

    // Calculate last month's date range
    const now = new Date();
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0); // Last day of previous month
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1); // First day of previous month
    const lastMonthStartStr = lastMonthStart.toISOString().split('T')[0];
    const lastMonthEndStr = lastMonthEnd.toISOString().split('T')[0];

    // Calculate month before last for comparison
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth() - 1, 0);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const prevMonthStartStr = prevMonthStart.toISOString().split('T')[0];
    const prevMonthEndStr = prevMonthEnd.toISOString().split('T')[0];

    const monthName = lastMonthStart.toLocaleDateString('en-US', { month: 'long' });

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();

      const prefs = await getUserPreferences(userId);
      if (!prefs.monthlySummary) continue;

      // Get last month's activities
      const lastMonthActivities = await db.collection('activities')
        .where('userId', '==', userId)
        .where('date', '>=', lastMonthStartStr)
        .where('date', '<=', lastMonthEndStr)
        .get();

      // Get previous month's activities for comparison
      const prevMonthActivities = await db.collection('activities')
        .where('userId', '==', userId)
        .where('date', '>=', prevMonthStartStr)
        .where('date', '<=', prevMonthEndStr)
        .get();

      const lastMonthCount = lastMonthActivities.size;
      const prevMonthCount = prevMonthActivities.size;

      // Calculate total duration
      let lastMonthMinutes = 0;
      lastMonthActivities.docs.forEach(doc => {
        lastMonthMinutes += Math.round((doc.data().duration || 0) / 60);
      });

      let prevMonthMinutes = 0;
      prevMonthActivities.docs.forEach(doc => {
        prevMonthMinutes += Math.round((doc.data().duration || 0) / 60);
      });

      const currentStreak = userData.streak || 0;

      // Determine comparison message
      let comparisonText = '';
      if (prevMonthCount > 0) {
        const diff = lastMonthCount - prevMonthCount;
        if (diff > 0) {
          comparisonText = ` (+${diff} from last month!)`;
        } else if (diff < 0) {
          comparisonText = '';
        } else {
          comparisonText = ' (same as last month)';
        }
      }

      if (lastMonthCount === 0) {
        await sendNotificationToUser(
          userId,
          `${monthName} Recap`,
          'No workouts logged last month. This month is a fresh start!',
          {
            type: NotificationType.MONTHLY_SUMMARY,
            month: monthName,
            activitiesCount: '0',
            totalMinutes: '0',
            showSharePrompt: 'false',
          }
        );
      } else if (lastMonthCount >= 15 || currentStreak >= 30) {
        // Amazing month - definitely prompt to share!
        const hours = Math.floor(lastMonthMinutes / 60);
        const mins = lastMonthMinutes % 60;
        const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${lastMonthMinutes}m`;

        await sendNotificationToUser(
          userId,
          `Incredible ${monthName}! Share Your Progress?`,
          `${lastMonthCount} workouts, ${timeStr} total${comparisonText}. Your dedication is inspiring!`,
          {
            type: NotificationType.MONTHLY_SUMMARY,
            month: monthName,
            activitiesCount: lastMonthCount.toString(),
            totalMinutes: lastMonthMinutes.toString(),
            streak: currentStreak.toString(),
            showSharePrompt: 'true',
            comparison: (lastMonthCount - prevMonthCount).toString(),
          }
        );
      } else {
        const hours = Math.floor(lastMonthMinutes / 60);
        const mins = lastMonthMinutes % 60;
        const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${lastMonthMinutes}m`;

        await sendNotificationToUser(
          userId,
          `Your ${monthName} Recap`,
          `${lastMonthCount} workouts, ${timeStr} total${comparisonText}. Keep building momentum!`,
          {
            type: NotificationType.MONTHLY_SUMMARY,
            month: monthName,
            activitiesCount: lastMonthCount.toString(),
            totalMinutes: lastMonthMinutes.toString(),
            showSharePrompt: lastMonthCount >= 10 ? 'true' : 'false',
          }
        );
      }
    }
  }
);

/**
 * New activity detected from HealthKit
 * Triggered when a pending workout is saved to Firestore
 */
exports.onPendingWorkoutCreated = onDocumentCreated(
  'pendingWorkouts/{workoutId}',
  async (event) => {
    const workout = event.data.data();
    const { userId, type, duration, sourceName } = workout;

    const prefs = await getUserPreferences(userId);
    if (!prefs.newActivityDetected) return;

    const durationMin = Math.round((duration || 0) / 60);
    const source = sourceName || 'Apple Health';

    // Format the activity type nicely
    const activityTypeMap = {
      'running': 'Run',
      'walking': 'Walk',
      'cycling': 'Ride',
      'swimming': 'Swim',
      'traditionalStrengthTraining': 'Strength Training',
      'functionalStrengthTraining': 'Functional Training',
      'yoga': 'Yoga',
      'pilates': 'Pilates',
      'hiking': 'Hike',
      'elliptical': 'Elliptical',
      'stairClimbing': 'Stairs',
      'highIntensityIntervalTraining': 'HIIT',
    };

    const activityName = activityTypeMap[type] || type;

    await sendNotificationToUser(
      userId,
      'New Workout Detected!',
      `${durationMin}min ${activityName} from ${source}. Tap to log it.`,
      {
        type: NotificationType.NEW_ACTIVITY_DETECTED,
        workoutId: event.params.workoutId,
        activityType: type,
        duration: duration.toString(),
        source: source,
      }
    );
  }
);

// ==========================================
// ACHIEVEMENT NOTIFICATIONS
// ==========================================

/**
 * Notify user when they hit a streak milestone
 */
exports.onStreakMilestone = onDocumentUpdated(
  'users/{userId}',
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();

    const userId = event.params.userId;
    const oldStreak = before.streak || 0;
    const newStreak = after.streak || 0;

    // Check if they just hit a milestone (7, 14, 30, 60, 90, 100, 365 days)
    const milestones = [7, 14, 30, 60, 90, 100, 200, 365];
    const hitMilestone = milestones.find(m => newStreak >= m && oldStreak < m);

    if (!hitMilestone) return;

    const prefs = await getUserPreferences(userId);
    if (!prefs.streakMilestones) return;

    const messages = {
      7: 'One week strong! You\'re building a habit.',
      14: 'Two weeks! You\'re unstoppable!',
      30: 'A whole month! You\'re a machine!',
      60: '60 days! This is who you are now.',
      90: '90 days! You\'ve transformed.',
      100: '100 days! Legendary status achieved!',
      200: '200 days! You\'re an inspiration.',
      365: 'ONE YEAR! You\'re officially elite!',
    };

    await sendNotificationToUser(
      userId,
      `${hitMilestone}-Day Streak!`,
      messages[hitMilestone],
      {
        type: NotificationType.STREAK_MILESTONE,
        milestone: hitMilestone.toString(),
        streak: newStreak.toString(),
      }
    );
  }
);
