/**
 * DaySeven Cloud Functions for Push Notifications
 * Runtime: Node.js 22
 *
 * These functions trigger on Firestore events and send push notifications
 * to users via Firebase Cloud Messaging (FCM).
 */

const { onDocumentCreated, onDocumentUpdated, onDocumentWritten } = require("firebase-functions/v2/firestore");
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
 * Helper: Get effective activity category for goal tracking.
 *
 * NOTE ON NAMING: The strength/lifting category has inconsistent naming across the codebase.
 * - The UI button label says "Strength" and the activity type is "Strength Training"
 * - But the stored countToward value is 'lifting' (matching the goal key 'liftsPerWeek')
 * - Both 'lifting' and 'strength' are accepted here for backwards compatibility
 * - The canonical internal value is 'lifting' — always use 'lifting' when writing new code
 */
function getActivityCategoryForGoals(activity) {
  // 1. Explicit countToward field (set by user in finish modal)
  const ct = activity.countToward || '';
  if (ct === 'lifting' || ct === 'strength') return 'lifting';
  if (ct === 'cardio') return 'cardio';
  if (ct === 'recovery') return 'recovery';
  if (ct === 'warmup') return 'warmup';
  // 2. Custom activity category fallback
  const cc = activity.customActivityCategory || '';
  if (cc === 'lifting' || cc === 'strength') return 'lifting';
  if (cc === 'cardio') return 'cardio';
  if (cc === 'recovery') return 'recovery';
  // 3. Infer from activity type (matches client-side getDefaultCountToward)
  const type = activity.type || '';
  const subtype = activity.subtype || '';
  if (['Strength Training', 'Weightlifting', 'Bodyweight', 'Circuit'].includes(type)) return 'lifting';
  if (['Running', 'Cycle', 'Sports', 'Stair Climbing', 'Elliptical'].includes(type)) return 'cardio';
  if (['Basketball', 'Soccer', 'Football', 'Tennis', 'Golf', 'Badminton', 'Boxing', 'Martial Arts',
    'Baseball', 'Volleyball', 'Hockey', 'Lacrosse', 'Rugby', 'Softball', 'Squash', 'Table Tennis',
    'Racquetball', 'Handball', 'Pickleball', 'Cricket', 'Australian Football', 'Wrestling',
    'Fencing', 'Curling', 'Bowling', 'Track & Field', 'Jump Rope', 'Downhill Skiing',
    'Cross Country Skiing', 'Snowboarding', 'Skating', 'Surfing', 'Water Polo',
    'Paddle Sports'].includes(type)) return 'cardio';
  if (type === 'Yoga') {
    if (['Power', 'Hot', 'Vinyasa'].includes(subtype)) return 'cardio';
    return 'recovery';
  }
  if (['Pilates', 'Stretching', 'Foam Rolling', 'Cold Plunge', 'Sauna'].includes(type)) return 'recovery';
  if (['Swimming', 'Rowing', 'Hiking', 'Dance'].includes(type)) return 'cardio';
  return null;
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
    friendActivity: false,
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

    // Increment unread badge count in Firestore for accurate app icon badge
    const userRef = db.collection('users').doc(userId);
    await userRef.set({ unreadBadgeCount: FieldValue.increment(1) }, { merge: true });

    // If this is a social notification, also increment unreadFeedCount (for in-app red dot)
    const socialTypes = ['reaction', 'comment', 'reply', 'friend_request', 'friend_accepted', 'friend_workout'];
    if (socialTypes.includes(data.type)) {
      await userRef.set({ unreadFeedCount: FieldValue.increment(1) }, { merge: true });
    }

    // Read the updated badge count for APNS payload
    const updatedUser = await userRef.get();
    const badgeCount = updatedUser.data()?.unreadBadgeCount || 1;

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
            badge: badgeCount,
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
 * Path: friendRequests/{requestId}
 * Fields: fromUid, toUid, status
 */
exports.onFriendRequestCreated = onDocumentCreated(
  'friendRequests/{requestId}',
  async (event) => {
    const request = event.data.data();
    const { toUid, fromUid } = request;

    if (!toUid || !fromUid) return;

    const prefs = await getUserPreferences(toUid);
    if (!prefs.friendRequests) return;

    const fromName = await getUserDisplayName(fromUid);

    await sendNotificationToUser(
      toUid,
      'New Friend Request',
      `${fromName} wants to be your friend`,
      {
        type: NotificationType.FRIEND_REQUEST,
        fromUserId: fromUid,
        requestId: event.params.requestId,
      }
    );
  }
);

/**
 * Send notification when a friend request is accepted
 * Triggers when friendRequests/{id} status changes to 'accepted'
 */
exports.onFriendRequestAccepted = onDocumentUpdated(
  'friendRequests/{requestId}',
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();

    // Only trigger when status changes to 'accepted'
    if (before.status === 'accepted' || after.status !== 'accepted') return;

    const { fromUid, toUid } = after;
    if (!fromUid || !toUid) return;

    // Notify the person who sent the request that it was accepted
    const prefs = await getUserPreferences(fromUid);
    if (!prefs.friendRequests) return;

    const acceptedByName = await getUserDisplayName(toUid);

    await sendNotificationToUser(
      fromUid,
      'Friend Request Accepted',
      `${acceptedByName} accepted your friend request`,
      {
        type: NotificationType.FRIEND_ACCEPTED,
        friendUserId: toUid,
      }
    );
  }
);

/**
 * Send notification when someone reacts to an activity
 * Path: users/{ownerId}/activityReactions/{activityId}/reactions/{reactorId}
 * Fields: reactorUid, reactorName, reactorPhoto, reactionType
 */
exports.onReactionCreated = onDocumentCreated(
  'users/{ownerId}/activityReactions/{activityId}/reactions/{reactionId}',
  async (event) => {
    const reaction = event.data.data();
    const ownerId = event.params.ownerId;
    const reactorId = reaction.reactorUid;
    const emoji = reaction.reactionType || '👍';

    if (!reactorId) return;

    // Don't notify yourself
    if (ownerId === reactorId) return;

    const prefs = await getUserPreferences(ownerId);
    if (!prefs.reactions) return;

    const reactorName = reaction.reactorName || await getUserDisplayName(reactorId);

    await sendNotificationToUser(
      ownerId,
      'New Reaction',
      `${reactorName} reacted ${emoji} to your activity`,
      {
        type: NotificationType.REACTION,
        fromUserId: reactorId,
        emoji,
        activityId: event.params.activityId,
      }
    );
  }
);

/**
 * Send notification when someone comments on an activity
 * Path: users/{ownerId}/activityComments/{activityId}/comments/{commentId}
 * Fields: commenterUid, commenterName, commenterPhoto, text
 */
exports.onCommentCreated = onDocumentCreated(
  'users/{ownerId}/activityComments/{activityId}/comments/{commentId}',
  async (event) => {
    const comment = event.data.data();
    const ownerId = event.params.ownerId;
    const commenterId = comment.commenterUid;
    const text = comment.text || '';

    if (!commenterId) return;

    // Don't notify yourself
    if (ownerId === commenterId) return;

    const prefs = await getUserPreferences(ownerId);
    if (!prefs.comments) return;

    const commenterName = comment.commenterName || await getUserDisplayName(commenterId);
    const truncatedText = text.length > 50 ? text.substring(0, 47) + '...' : text;

    await sendNotificationToUser(
      ownerId,
      'New Comment',
      `${commenterName}: "${truncatedText}"`,
      {
        type: NotificationType.COMMENT,
        fromUserId: commenterId,
        activityId: event.params.activityId,
        commentId: event.params.commentId,
      }
    );
  }
);

/**
 * Notify comment author when someone replies to their comment
 * Respects the 'comments' preference (replies share the comments toggle)
 */
exports.onReplyCreated = onDocumentCreated(
  'users/{ownerId}/activityComments/{activityId}/comments/{commentId}/replies/{replyId}',
  async (event) => {
    const reply = event.data.data();
    const { ownerId, activityId, commentId } = event.params;
    const replierId = reply.replierUid;
    const text = reply.text || '';

    if (!replierId) return;

    // Get the parent comment to find who to notify
    const commentDoc = await db
      .collection('users').doc(ownerId)
      .collection('activityComments').doc(activityId)
      .collection('comments').doc(commentId)
      .get();

    if (!commentDoc.exists) return;
    const comment = commentDoc.data();
    const commenterId = comment.commenterUid;

    // Don't notify yourself
    if (!commenterId || commenterId === replierId) return;

    const prefs = await getUserPreferences(commenterId);
    if (!prefs.comments) return;

    const replierName = reply.replierName || await getUserDisplayName(replierId);
    const truncatedText = text.length > 50 ? text.substring(0, 47) + '...' : text;

    await sendNotificationToUser(
      commenterId,
      'New Reply',
      `${replierName} replied: "${truncatedText}"`,
      {
        type: NotificationType.REPLY,
        fromUserId: replierId,
        activityOwnerId: ownerId,
        activityId,
        commentId,
      }
    );
  }
);

// ==========================================
// SCHEDULED REMINDERS
// ==========================================

/**
 * Streak reminder - runs every day at 8 PM
 * Only reminds users who haven't logged activity in 48+ hours
 * Activities are stored as arrays in users/{uid} documents
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
      // Activities are stored as an array in the user document
      const activities = userData.activities || [];
      const hasRecentActivity = activities.some(a => a.date >= twoDaysAgoStr);

      if (hasRecentActivity) continue; // Has recent activity, skip

      // Skip users on vacation mode
      if (userData.vacationMode?.isActive) continue;

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
 * Returns { time: "HH:00", dateStr: "YYYY-MM-DD", dayOfWeek: 0-6 } in the user's local timezone
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

    // Get the local day of week (0 = Sunday, 6 = Saturday)
    const weekdayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
    const weekdayStr = weekdayFormatter.format(now);
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dayOfWeek = dayMap[weekdayStr] ?? now.getDay();

    return { time: `${hour}:00`, dateStr, dayOfWeek };
  } catch {
    // Fallback if timezone is invalid
    const now = new Date();
    const h = now.getUTCHours().toString().padStart(2, '0');
    const d = now.toISOString().split('T')[0];
    return { time: `${h}:00`, dateStr: d, dayOfWeek: now.getDay() };
  }
}

/**
 * Daily scheduled reminder - runs every hour to match users' preferred time
 * Uses each user's stored timezone for accurate local time matching
 * Activities are stored as arrays in users/{uid} documents
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
      // Activities are stored as an array in the user document
      const activities = userData.activities || [];
      const hasActivityToday = activities.some(a => a.date === userToday);

      if (hasActivityToday) continue; // Already logged today

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
 * End of week goal reminder - runs every hour, sends at 8 AM Thursday in each user's timezone
 * Reminds users what they need to hit their weekly goals
 * Activities are stored as arrays in users/{uid} documents
 * Uses the 'countToward' field for category (strength/cardio/recovery)
 */
exports.sendGoalReminder = onSchedule(
  {
    schedule: '0 * * * *', // Every hour on the hour
    timeZone: 'UTC',
  },
  async () => {

    const usersSnapshot = await db.collection('users').get();

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();

      // Skip users on vacation mode
      if (userData.vacationMode?.isActive) continue;

      const prefs = await getUserPreferences(userId);
      if (!prefs.goalReminders) continue;

      // Check if it's 8 AM Thursday in the user's timezone
      const { time: userLocalTime, dateStr: userToday, dayOfWeek } = getUserLocalTime(prefs.timezone);
      if (dayOfWeek !== 4 || userLocalTime !== '08:00') continue;

      // Get start of current week (Sunday) in the user's local timezone
      // userToday is Thursday (day 4), so Sunday is 4 days back
      const todayParts = userToday.split('-').map(Number);
      const localToday = new Date(todayParts[0], todayParts[1] - 1, todayParts[2]);
      localToday.setDate(localToday.getDate() - dayOfWeek);
      const weekStartStr = localToday.toISOString().split('T')[0];

      // Get user's goals
      const goals = userData.goals || { liftsPerWeek: 3, cardioPerWeek: 2, recoveryPerWeek: 2 };

      // Count activities this week by category from user's activities array
      const activities = userData.activities || [];
      const thisWeekActivities = activities.filter(a => a.date >= weekStartStr);

      let strength = 0;
      let cardio = 0;
      let recovery = 0;

      thisWeekActivities.forEach(activity => {
        const category = getActivityCategoryForGoals(activity);
        if (category === 'lifting') {
          strength++;
        } else if (category === 'cardio') {
          cardio++;
        } else if (category === 'recovery') {
          recovery++;
        }
      });

      // Calculate remaining
      const strengthRemaining = Math.max(0, goals.liftsPerWeek - strength);
      const cardioRemaining = Math.max(0, goals.cardioPerWeek - cardio);
      const recoveryRemaining = Math.max(0, goals.recoveryPerWeek - recovery);

      const daysLeft = 7 - dayOfWeek; // Days until end of week (Saturday)
      const totalGoals = goals.liftsPerWeek + goals.cardioPerWeek + goals.recoveryPerWeek;
      const totalDone = Math.min(strength, goals.liftsPerWeek) + Math.min(cardio, goals.cardioPerWeek) + Math.min(recovery, goals.recoveryPerWeek);

      // Check if all goals are met
      if (strengthRemaining === 0 && cardioRemaining === 0 && recoveryRemaining === 0) {
        await sendNotificationToUser(
          userId,
          'Goals Complete! 🎯',
          `You've hit all ${totalGoals} activities this week with ${daysLeft} days to spare. Amazing!`,
          {
            type: NotificationType.GOAL_REMINDER,
            allGoalsMet: 'true',
          }
        );
        continue;
      }

      // Build completed summary (what they've done so far)
      const completed = [];
      if (strength > 0) completed.push(`${strength}/${goals.liftsPerWeek} strength`);
      if (cardio > 0) completed.push(`${cardio}/${goals.cardioPerWeek} cardio`);
      if (recovery > 0) completed.push(`${recovery}/${goals.recoveryPerWeek} recovery`);

      // Build remaining summary (only categories still needed)
      const remaining = [];
      if (strengthRemaining > 0) remaining.push(`${strengthRemaining} strength`);
      if (cardioRemaining > 0) remaining.push(`${cardioRemaining} cardio`);
      if (recoveryRemaining > 0) remaining.push(`${recoveryRemaining} recovery`);
      const remainingStr = remaining.join(', ');

      // Personalize the message based on progress
      let body;
      if (totalDone === 0) {
        body = `You still need ${remainingStr} to hit your goals. ${daysLeft} days left — time to get moving! 💪`;
      } else {
        const completedStr = completed.join(', ');
        body = `You've done ${completedStr} so far. Still need ${remainingStr} — ${daysLeft} days left! 💪`;
      }

      await sendNotificationToUser(
        userId,
        `${totalDone}/${totalGoals} Activities Done — ${daysLeft} Days Left`,
        body,
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
 * Activities are stored as arrays in users/{uid} documents
 */
exports.sendWeeklySummary = onSchedule(
  {
    schedule: '0 10 * * 0', // 10 AM every Sunday
    timeZone: 'America/New_York',
  },
  async () => {

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

      // Count activities this week by category from user's activities array
      const activities = userData.activities || [];
      const thisWeekActivities = activities.filter(a => a.date >= weekAgoStr);

      let strength = 0;
      let cardio = 0;
      let recovery = 0;
      let totalCalories = 0;

      thisWeekActivities.forEach(activity => {
        totalCalories += activity.calories || 0;
        const category = getActivityCategoryForGoals(activity);
        if (category === 'lifting') {
          strength++;
        } else if (category === 'cardio') {
          cardio++;
        } else if (category === 'recovery') {
          recovery++;
        }
      });

      const workouts = strength + cardio; // Combined strength and cardio
      const totalCount = thisWeekActivities.length;

      // Check if all goals were met
      const allGoalsMet = strength >= goals.liftsPerWeek &&
                          cardio >= goals.cardioPerWeek &&
                          recovery >= goals.recoveryPerWeek;

      if (totalCount === 0) {
        await sendNotificationToUser(
          userId,
          'Weekly Check-in',
          'No activities logged this week. New week, fresh start!',
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
          `${workouts} workouts, ${recovery} recovery sessions, ${caloriesStr} cal. Tap to share with friends!`,
          {
            type: NotificationType.WEEKLY_SUMMARY,
            workouts: workouts.toString(),
            recovery: recovery.toString(),
            totalCalories: totalCalories.toString(),
            allGoalsMet: 'true',
            showSharePrompt: 'true',
          }
        );
        // Persist share prompt so app shows it on next open even without tapping notification
        await db.collection('users').doc(userId).update({
          pendingSharePrompt: { type: 'weekly', sentAt: new Date().toISOString() }
        });
      } else {
        // Regular summary
        const caloriesStr = totalCalories >= 1000 ? `${(totalCalories / 1000).toFixed(1)}k` : totalCalories.toString();
        await sendNotificationToUser(
          userId,
          'Your Week in Review',
          `${workouts} workouts, ${recovery} recovery sessions, ${caloriesStr} cal. Tap to share with friends!`,
          {
            type: NotificationType.WEEKLY_SUMMARY,
            workouts: workouts.toString(),
            recovery: recovery.toString(),
            totalCalories: totalCalories.toString(),
            allGoalsMet: 'false',
            showSharePrompt: 'true',
          }
        );
        // Persist share prompt so app shows it on next open even without tapping notification
        await db.collection('users').doc(userId).update({
          pendingSharePrompt: { type: 'weekly', sentAt: new Date().toISOString() }
        });
      }
    }
  }
);

/**
 * Monthly summary - runs on the 1st of each month at 10 AM
 * Includes social sharing prompt and month-over-month comparison
 * Activities are stored as arrays in users/{uid} documents
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

      // Filter activities from user's activities array by date range
      const activities = userData.activities || [];
      const lastMonthActivitiesList = activities.filter(a => a.date >= lastMonthStartStr && a.date <= lastMonthEndStr);
      const prevMonthActivitiesList = activities.filter(a => a.date >= prevMonthStartStr && a.date <= prevMonthEndStr);

      const lastMonthCount = lastMonthActivitiesList.length;
      const prevMonthCount = prevMonthActivitiesList.length;

      // Calculate total duration
      let lastMonthMinutes = 0;
      lastMonthActivitiesList.forEach(activity => {
        lastMonthMinutes += Math.round((activity.duration || 0) / 60);
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
          'No activities logged last month. This month is a fresh start!',
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
          `${lastMonthCount} activities, ${timeStr} total${comparisonText}. Tap to share with friends!`,
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

// ==========================================
// FRIEND ACTIVITY NOTIFICATIONS
// ==========================================

/**
 * Notify friends when a user logs a new activity.
 * Only sends if the friend has friendActivity preference enabled (off by default).
 * Skips warmup activities.
 */
exports.onFriendActivityLogged = onDocumentUpdated(
  'users/{userId}',
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    const userId = event.params.userId;

    const beforeActivities = before.activities || [];
    const afterActivities = after.activities || [];

    // Quick check: only proceed if activities were added
    if (afterActivities.length <= beforeActivities.length) return;

    // Find new activities (IDs in after but not in before)
    const beforeIds = new Set(beforeActivities.map(a => String(a.id)));
    const newActivities = afterActivities.filter(a => !beforeIds.has(String(a.id)));
    if (newActivities.length === 0) return;

    // Pick the first notifiable new activity (skip warmups)
    const notifiableActivity = newActivities.find(a =>
      a.countToward !== 'warmup' && a.customActivityCategory !== 'warmup'
    );
    if (!notifiableActivity) return;

    // Get user's display name
    const displayName = after.displayName || after.username || 'A friend';
    // For "Other" activities, show the custom name (stored in subtype) instead of "Other"
    const activityType = notifiableActivity.type === 'Other'
      ? (notifiableActivity.subtype || 'a workout')
      : (notifiableActivity.type || 'a workout');

    // Get friends list
    const friendsSnap = await db.collection('users').doc(userId).collection('friends').get();
    if (friendsSnap.empty) return;

    // Notify each friend (respecting their preferences)
    const promises = friendsSnap.docs.map(async (friendDoc) => {
      const friendUid = friendDoc.data().friendUid;
      if (!friendUid) return;

      const prefs = await getUserPreferences(friendUid);
      if (!prefs.friendActivity) return;

      await sendNotificationToUser(
        friendUid,
        `${displayName} just worked out! 💪`,
        `${displayName} completed ${activityType}`,
        {
          type: NotificationType.FRIEND_WORKOUT,
          fromUserId: userId,
          fromUserName: displayName,
          activityType: notifiableActivity.type || '',
        }
      );
    });

    await Promise.allSettled(promises);
  }
);

// ==========================================
// GOAL ACHIEVEMENT NOTIFICATIONS
// ==========================================

/**
 * Notify user when ALL three weekly goals (strength, cardio, recovery) are complete.
 *
 * Detection strategy: watch for weekCelebrations.master going from false → true.
 * Both the phone and watch set this flag when all goals are met.
 * Sends notification regardless of source (watch or phone) — the
 * lastGoalAchievedNotifWeek dedup ensures only one notification per week.
 * If the user is on the phone, the foreground handler shows a toast.
 */
exports.onGoalAchieved = onDocumentUpdated(
  'users/{userId}',
  async (event) => {
    const userId = event.params.userId;
    const before = event.data.before.data();
    const after = event.data.after.data();

    // Check if weekCelebrations.master went from false/unset → true
    const beforeMaster = (before.weekCelebrations || {}).master === true;
    const afterMaster = (after.weekCelebrations || {}).master === true;

    // When master goes true → false (user deleted an activity), clear the dedup
    // field so the next completion can send a fresh notification.
    if (beforeMaster && !afterMaster) {
      const userRef = db.collection('users').doc(userId);
      await userRef.set({ lastGoalAchievedNotifAt: null }, { merge: true });
      console.log(`[onGoalAchieved] ${userId}: Goals un-completed, cleared dedup`);
      return;
    }

    if (!afterMaster || beforeMaster) {
      // Either goals not completed in this write, or already completed before
      return;
    }

    // master just went false → true — send push notification.
    // Could come from watch (batchSave) or phone (updateUserProfile).
    // The timestamp dedup below ensures only one notification per completion event.
    console.log(`[onGoalAchieved] ${userId}: All goals completed, sending notification`);

    const prefs = await getUserPreferences(userId);
    if (!prefs.goalAchievements) {
      console.log(`[onGoalAchieved] ${userId}: goalAchievements preference disabled`);
      return;
    }

    // Deduplicate: Cloud Functions has at-least-once delivery, so this trigger
    // can fire multiple times for the same write. Use a short time window (30s)
    // to prevent duplicate notifications while allowing re-completions.
    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();
    const lastNotifAt = userSnap.data()?.lastGoalAchievedNotifAt;

    if (lastNotifAt) {
      const elapsed = Date.now() - new Date(lastNotifAt).getTime();
      if (elapsed < 30000) { // 30 second window for at-least-once dedup
        console.log(`[onGoalAchieved] ${userId}: Duplicate trigger within 30s, skipping`);
        return;
      }
    }

    // Mark timestamp before sending (prevents race between duplicate triggers)
    await userRef.set({ lastGoalAchievedNotifAt: new Date().toISOString() }, { merge: true });

    await sendNotificationToUser(
      userId,
      'All Weekly Goals Complete! 🏆',
      'You\'ve hit all your strength, cardio, and recovery goals this week!',
      {
        type: NotificationType.GOAL_ACHIEVED,
      }
    );
  }
);

// ==========================================
// FIELD PROTECTION: Prevent goals/profile wipe
// ==========================================

/**
 * Monitors writes to user documents and automatically restores critical fields
 * (goals, hasCompletedOnboarding, username) if they get wiped.
 * Also logs what changed for debugging.
 */
exports.protectUserFields = onDocumentWritten(
  { document: "users/{userId}" },
  async (event) => {
    const userId = event.params.userId;
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    // Skip if document was deleted
    if (!after) return;

    // Check if critical fields were wiped
    const goalsWiped = before?.goals && !after.goals;
    const usernameWiped = before?.username && !after.username;
    const onboardingWiped = before?.hasCompletedOnboarding === true && after.hasCompletedOnboarding !== true;

    if (goalsWiped || usernameWiped || onboardingWiped) {
      const beforeKeys = before ? Object.keys(before).sort() : [];
      const afterKeys = after ? Object.keys(after).sort() : [];
      const removedKeys = beforeKeys.filter(k => !afterKeys.includes(k) || after[k] === undefined);

      console.error(`[FIELD_WIPE_DETECTED] userId=${userId}`, {
        goalsWiped,
        usernameWiped,
        onboardingWiped,
        beforeKeys,
        afterKeys,
        removedKeys,
      });

      // Restore wiped fields
      const restore = {};
      if (goalsWiped && before.goals) restore.goals = before.goals;
      if (usernameWiped && before.username) restore.username = before.username;
      if (onboardingWiped) restore.hasCompletedOnboarding = true;

      if (Object.keys(restore).length > 0) {
        try {
          await db.collection("users").doc(userId).set(restore, { merge: true });
          console.log(`[FIELD_WIPE_RESTORED] userId=${userId} restored:`, Object.keys(restore));
        } catch (err) {
          console.error(`[FIELD_WIPE_RESTORE_FAILED] userId=${userId}:`, err);
        }
      }
    }
  }
);
