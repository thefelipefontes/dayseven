/**
 * DaySeven Cloud Functions for Push Notifications
 *
 * These functions trigger on Firestore events and send push notifications
 * to users via Firebase Cloud Messaging (FCM).
 */

const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError, onRequest } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { getAuth } = require("firebase-admin/auth");

// Initialize Firebase Admin
initializeApp();

const db = getFirestore();
const messaging = getMessaging();

// ==========================================
// WATCH APP AUTHENTICATION
// ==========================================

/**
 * Generate a custom auth token for the Apple Watch app.
 * Called by the iOS app when the watch requests authentication.
 * The caller must be authenticated — the token is generated for their UID.
 */
exports.generateWatchToken = onRequest(async (req, res) => {
  console.log("[generateWatchToken] Called with method:", req.method);

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Extract the Bearer token from Authorization header
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    console.log("[generateWatchToken] No Bearer token in Authorization header");
    res.status(401).json({ error: "Missing authorization token" });
    return;
  }

  const idToken = authHeader.split("Bearer ")[1];

  try {
    // Verify the ID token to get the user's UID
    const decodedToken = await getAuth().verifyIdToken(idToken);
    const uid = decodedToken.uid;
    console.log("[generateWatchToken] Verified user uid:", uid);

    // Generate a custom token for the watch
    const customToken = await getAuth().createCustomToken(uid);
    console.log("[generateWatchToken] Custom token generated successfully");

    res.status(200).json({ token: customToken, uid: uid });
  } catch (err) {
    console.error("[generateWatchToken] Error:", err.message);
    res.status(500).json({ error: "Failed to generate token: " + err.message });
  }
});

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
 * Reads from users/{uid} document's notificationPreferences field
 */
async function getUserPreferences(userId) {
  const userDoc = await db.collection('users').doc(userId).get();
  if (!userDoc.exists) return getDefaultPreferences();
  const prefs = userDoc.data().notificationPreferences;
  if (!prefs) return getDefaultPreferences();
  return { ...getDefaultPreferences(), ...prefs };
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
 * Helper: Check if current time is within quiet hours (timezone-aware)
 */
function isQuietHours(preferences) {
  if (!preferences.quietHoursEnabled) return false;

  // Get current time in user's timezone
  const tz = preferences.timezone || 'America/New_York';
  let currentHour, currentMin;
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    currentHour = parseInt(parts.find(p => p.type === 'hour').value, 10);
    currentMin = parseInt(parts.find(p => p.type === 'minute').value, 10);
  } catch {
    const now = new Date();
    currentHour = now.getUTCHours();
    currentMin = now.getUTCMinutes();
  }

  const currentMinutes = currentHour * 60 + currentMin;

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
      return { success: false, reason: 'no_tokens' };
    }

    const preferences = await getUserPreferences(userId);

    // Check quiet hours
    if (isQuietHours(preferences) && !options.ignoreQuietHours) {
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
            alert: {
              title,
              body,
            },
            badge: data.badge ? parseInt(data.badge) : 1,
            sound: 'default',
            'mutable-content': 1,
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
 * Streak reminder - runs every day at 8 PM
 * Only reminds users who haven't logged activity in 48+ hours
 */
exports.sendStreakReminders = onSchedule(
  {
    schedule: '0 20 * * *', // 8 PM every day
    timeZone: 'America/New_York',
  },
  async () => {

    const now = new Date();
    const twoDaysAgo = new Date(now);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const twoDaysAgoStr = twoDaysAgo.toISOString().split('T')[0];

    // Get users with active streaks who want reminders
    const usersSnapshot = await db.collection('users')
      .where('streak', '>', 0)
      .get();

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();

      // Check if they've logged any activity in the last 48 hours
      const recentActivities = await db.collection('activities')
        .where('userId', '==', userId)
        .where('date', '>=', twoDaysAgoStr)
        .limit(1)
        .get();

      if (!recentActivities.empty) continue; // Has recent activity, skip

      const prefs = await getUserPreferences(userId);
      if (!prefs.streakReminders) continue;

      await sendNotificationToUser(
        userId,
        'Missing You! 👋',
        `It's been a couple days. Your ${userData.streak}-week streak is waiting for you!`,
        {
          type: NotificationType.STREAK_REMINDER,
          streak: userData.streak.toString(),
        }
      );
    }
  }
);

/**
 * Helper: Get the current time in a user's timezone as "HH:00" (rounded to the hour)
 * Returns { time: "HH:00", dateStr: "YYYY-MM-DD" } in the user's local timezone
 */
function getUserLocalTime(timezone) {
  const tz = timezone || 'America/New_York';
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hour = parts.find(p => p.type === 'hour').value;

    // Also get the local date for activity check
    const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz }); // en-CA gives YYYY-MM-DD
    const dateStr = dateFormatter.format(now);

    return { time: `${hour}:00`, dateStr };
  } catch {
    // Fallback if timezone is invalid
    const now = new Date();
    const h = now.getUTCHours().toString().padStart(2, '0');
    const d = now.toISOString().split('T')[0];
    return { time: `${h}:00`, dateStr: d };
  }
}

/**
 * Daily scheduled reminder - runs every hour to match users' preferred time
 * Uses each user's stored timezone for accurate local time matching
 */
exports.sendDailyReminders = onSchedule(
  {
    schedule: '0 * * * *', // Every hour on the hour
    timeZone: 'UTC',
  },
  async () => {

    // Get all users and check their notificationPreferences field
    const usersSnapshot = await db.collection('users').get();

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();
      const prefs = userData.notificationPreferences;

      // Skip users without preferences or with daily reminders disabled
      if (!prefs || !prefs.dailyReminders) continue;

      const reminderTime = prefs.dailyReminderTime || '09:00';
      const { time: userLocalTime, dateStr: userToday } = getUserLocalTime(prefs.timezone);

      if (reminderTime !== userLocalTime) continue;

      // Check if they already logged today (in their timezone)
      const activitiesSnapshot = await db.collection('activities')
        .where('userId', '==', userId)
        .where('date', '==', userToday)
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
 * End of week goal reminder - runs Thursday at 6 PM
 * Reminds users what they need to hit their weekly goals
 */
exports.sendGoalReminder = onSchedule(
  {
    schedule: '0 18 * * 4', // 6 PM every Thursday
    timeZone: 'America/New_York',
  },
  async () => {

    const cardioTypes = ['Running', 'Cycle', 'Sports', 'Walking', 'Hiking', 'Swimming', 'Rowing', 'Stair Climbing', 'Elliptical', 'HIIT'];
    const recoveryTypes = ['Cold Plunge', 'Sauna', 'Yoga', 'Pilates'];

    // Get start of current week (Sunday)
    const now = new Date();
    const dayOfWeek = now.getDay();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - dayOfWeek);
    weekStart.setHours(0, 0, 0, 0);
    const weekStartStr = weekStart.toISOString().split('T')[0];

    const usersSnapshot = await db.collection('users').get();

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();

      const prefs = await getUserPreferences(userId);
      if (!prefs.goalReminders) continue;

      // Get user's goals
      const goals = userData.goals || { liftsPerWeek: 3, cardioPerWeek: 2, recoveryPerWeek: 2 };

      // Count activities this week by category
      const activitiesSnapshot = await db.collection('activities')
        .where('userId', '==', userId)
        .where('date', '>=', weekStartStr)
        .get();

      let strength = 0;
      let cardio = 0;
      let recovery = 0;

      activitiesSnapshot.docs.forEach(doc => {
        const activity = doc.data();
        if (activity.type === 'Strength Training') {
          strength++;
        } else if (cardioTypes.includes(activity.type)) {
          cardio++;
        } else if (recoveryTypes.includes(activity.type)) {
          recovery++;
        }
      });

      // Calculate remaining
      const strengthRemaining = Math.max(0, goals.liftsPerWeek - strength);
      const cardioRemaining = Math.max(0, goals.cardioPerWeek - cardio);
      const recoveryRemaining = Math.max(0, goals.recoveryPerWeek - recovery);

      // Check if all goals are met
      if (strengthRemaining === 0 && cardioRemaining === 0 && recoveryRemaining === 0) {
        // Already hit all goals!
        await sendNotificationToUser(
          userId,
          'Goals Complete! 🎯',
          'You\'ve hit all your weekly goals with days to spare. Amazing!',
          {
            type: NotificationType.GOAL_REMINDER,
            allGoalsMet: 'true',
          }
        );
        continue;
      }

      // Build the remaining message
      const remaining = [];
      if (strengthRemaining > 0) remaining.push(`${strengthRemaining} strength`);
      if (cardioRemaining > 0) remaining.push(`${cardioRemaining} cardio`);
      if (recoveryRemaining > 0) remaining.push(`${recoveryRemaining} recovery`);

      const daysLeft = 7 - dayOfWeek; // Days until end of week (Saturday)
      const remainingStr = remaining.join(', ');

      await sendNotificationToUser(
        userId,
        `${daysLeft} Days Left This Week`,
        `You need ${remainingStr} to hit your goals. You've got this! 💪`,
        {
          type: NotificationType.GOAL_REMINDER,
          strengthRemaining: strengthRemaining.toString(),
          cardioRemaining: cardioRemaining.toString(),
          recoveryRemaining: recoveryRemaining.toString(),
          daysLeft: daysLeft.toString(),
        }
      );
    }
  }
);

/**
 * Weekly summary - runs every Sunday at 10 AM
 * Shows "You crushed your week!" if all category goals were met
 */
exports.sendWeeklySummary = onSchedule(
  {
    schedule: '0 10 * * 0', // 10 AM every Sunday
    timeZone: 'America/New_York',
  },
  async () => {

    const cardioTypes = ['Running', 'Cycle', 'Sports', 'Walking', 'Hiking', 'Swimming', 'Rowing', 'Stair Climbing', 'Elliptical', 'HIIT'];
    const recoveryTypes = ['Cold Plunge', 'Sauna', 'Yoga', 'Pilates'];

    const usersSnapshot = await db.collection('users').get();
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const weekAgoStr = oneWeekAgo.toISOString().split('T')[0];

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();

      const prefs = await getUserPreferences(userId);
      if (!prefs.weeklySummary) continue;

      // Get user's goals
      const goals = userData.goals || { liftsPerWeek: 3, cardioPerWeek: 2, recoveryPerWeek: 2 };

      // Count activities this week by category
      const activitiesSnapshot = await db.collection('activities')
        .where('userId', '==', userId)
        .where('date', '>=', weekAgoStr)
        .get();

      let strength = 0;
      let cardio = 0;
      let recovery = 0;
      let totalCalories = 0;

      activitiesSnapshot.docs.forEach(doc => {
        const activity = doc.data();
        totalCalories += activity.calories || 0;

        if (activity.type === 'Strength Training') {
          strength++;
        } else if (cardioTypes.includes(activity.type)) {
          cardio++;
        } else if (recoveryTypes.includes(activity.type)) {
          recovery++;
        }
      });

      const workouts = strength + cardio; // Combined strength and cardio
      const totalCount = activitiesSnapshot.size;

      // Check if all goals were met
      const allGoalsMet = strength >= goals.liftsPerWeek &&
                          cardio >= goals.cardioPerWeek &&
                          recovery >= goals.recoveryPerWeek;

      if (totalCount === 0) {
        await sendNotificationToUser(
          userId,
          'Weekly Check-in',
          'No workouts logged this week. New week, fresh start!',
          {
            type: NotificationType.WEEKLY_SUMMARY,
            activitiesCount: '0',
            totalCalories: '0',
            showSharePrompt: 'false',
          }
        );
      } else if (allGoalsMet) {
        // All goals met - celebrate!
        const caloriesStr = totalCalories >= 1000 ? `${(totalCalories / 1000).toFixed(1)}k` : totalCalories.toString();
        await sendNotificationToUser(
          userId,
          'You Crushed Your Week! 🔥',
          `${workouts} workouts, ${recovery} recovery, ${caloriesStr} cal. Tap to share with friends!`,
          {
            type: NotificationType.WEEKLY_SUMMARY,
            workouts: workouts.toString(),
            recovery: recovery.toString(),
            totalCalories: totalCalories.toString(),
            allGoalsMet: 'true',
            showSharePrompt: 'true',
          }
        );
      } else {
        // Regular summary
        const caloriesStr = totalCalories >= 1000 ? `${(totalCalories / 1000).toFixed(1)}k` : totalCalories.toString();
        await sendNotificationToUser(
          userId,
          'Your Week in Review',
          `${workouts} workouts, ${recovery} recovery, ${caloriesStr} cal. Tap to share with friends!`,
          {
            type: NotificationType.WEEKLY_SUMMARY,
            workouts: workouts.toString(),
            recovery: recovery.toString(),
            totalCalories: totalCalories.toString(),
            allGoalsMet: 'false',
            showSharePrompt: 'true',
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
      } else {
        const hours = Math.floor(lastMonthMinutes / 60);
        const mins = lastMonthMinutes % 60;
        const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${lastMonthMinutes}m`;

        await sendNotificationToUser(
          userId,
          `Your ${monthName} Recap 📊`,
          `${lastMonthCount} workouts, ${timeStr} total${comparisonText}. Tap to share with friends!`,
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
 * Notify user when they hit a streak milestone (in weeks)
 * Milestones: 5, 10, 25, 52 (1 year), 78 (1.5 years), 104 (2 years)
 */
exports.onStreakMilestone = onDocumentUpdated(
  'users/{userId}',
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();

    const userId = event.params.userId;
    const oldStreak = before.streak || 0;
    const newStreak = after.streak || 0;

    // Check if they just hit a milestone (weeks)
    const milestones = [5, 10, 25, 52, 78, 104];
    const hitMilestone = milestones.find(m => newStreak >= m && oldStreak < m);

    if (!hitMilestone) return;

    const prefs = await getUserPreferences(userId);
    if (!prefs.streakMilestones) return;

    const messages = {
      5: '5 weeks strong! You\'re building a habit. 💪',
      10: '10 weeks! Double digits, you\'re unstoppable! 🔥',
      25: '25 weeks! Half a year of consistency! 🏆',
      52: 'ONE YEAR STREAK! 52 weeks of pure dedication! 👑',
      78: '78 weeks! 1.5 years of crushing it! 🌟',
      104: 'TWO YEAR STREAK! 104 weeks. You\'re a legend! 🎉',
    };

    const titles = {
      5: '5-Week Streak! 💪',
      10: '10-Week Streak! 🔥',
      25: '25-Week Streak! 🏆',
      52: '1 Year Streak! 👑',
      78: '1.5 Year Streak! 🌟',
      104: '2 Year Streak! 🎉',
    };

    await sendNotificationToUser(
      userId,
      titles[hitMilestone],
      messages[hitMilestone],
      {
        type: NotificationType.STREAK_MILESTONE,
        milestone: hitMilestone.toString(),
        streak: newStreak.toString(),
      }
    );
  }
);
