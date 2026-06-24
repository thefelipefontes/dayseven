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
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { getAuth } = require("firebase-admin/auth");
const jwt = require("jsonwebtoken");
const http2 = require("http2");
const fs = require("fs");
const path = require("path");

// Initialize Firebase Admin
initializeApp();

const db = getFirestore();
const messaging = getMessaging();

// Shared secret guarding the RevenueCat webhook. Set it with:
//   firebase functions:secrets:set REVENUECAT_WEBHOOK_SECRET
const revenueCatWebhookSecret = defineSecret("REVENUECAT_WEBHOOK_SECRET");

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

// ==========================================
// ACTIVITYKIT LIVE ACTIVITY PUSH
// ==========================================

// APNs configuration
const APNS_KEY_ID = "4RCDUK8HZW";
const APNS_TEAM_ID = "J4CL5KMB23";
const APNS_TOPIC = "app.dayseven.fitness.push-type.liveactivity";

// Cache the APNs key and JWT
let apnsKeyCache = null;
let apnsJwtCache = null;
let apnsJwtExpiry = 0;

function getApnsKey() {
  if (!apnsKeyCache) {
    apnsKeyCache = fs.readFileSync(path.join(__dirname, "apns", "AuthKey_4RCDUK8HZW.p8"), "utf8");
  }
  return apnsKeyCache;
}

function getApnsJwt() {
  const now = Math.floor(Date.now() / 1000);
  // Refresh JWT every 50 minutes (APNs tokens are valid for 60 min)
  if (apnsJwtCache && now < apnsJwtExpiry) {
    return apnsJwtCache;
  }
  const key = getApnsKey();
  apnsJwtCache = jwt.sign({ iss: APNS_TEAM_ID, iat: now }, key, {
    algorithm: "ES256",
    header: { alg: "ES256", kid: APNS_KEY_ID },
  });
  apnsJwtExpiry = now + 3000; // 50 minutes
  return apnsJwtCache;
}

/**
 * Send an APNs push notification for ActivityKit Live Activity
 */
function sendApnsLiveActivityPush(deviceToken, payload, useSandbox = false) {
  return new Promise((resolve, reject) => {
    const host = useSandbox ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
    const client = http2.connect(host);

    client.on("error", (err) => {
      console.error("[APNs] Connection error:", err.message);
      reject(err);
    });

    const headers = {
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      "authorization": `bearer ${getApnsJwt()}`,
      "apns-topic": APNS_TOPIC,
      "apns-push-type": "liveactivity",
      "apns-priority": "10",
    };

    const req = client.request(headers);
    let responseData = "";
    let statusCode = 0;

    req.on("response", (headers) => {
      statusCode = headers[":status"];
    });

    req.on("data", (chunk) => {
      responseData += chunk;
    });

    req.on("end", () => {
      client.close();
      if (statusCode === 200) {
        console.log("[APNs] Push sent successfully");
        resolve({ success: true, status: statusCode });
      } else {
        console.error(`[APNs] Push failed: status=${statusCode}, body=${responseData}`);
        resolve({ success: false, status: statusCode, error: responseData });
      }
    });

    req.on("error", (err) => {
      client.close();
      reject(err);
    });

    req.write(JSON.stringify(payload));
    req.end();
  });
}

/**
 * Map activity type to SF Symbol icon name (mirrors Swift liveActivityIconForType)
 */
function liveActivityIconForType(type) {
  const lowered = (type || "").toLowerCase();
  if (lowered.includes("run")) return "figure.run";
  if (lowered.includes("cycl") || lowered.includes("bik")) return "figure.outdoor.cycle";
  if (lowered.includes("swim")) return "figure.pool.swim";
  if (lowered.includes("hik")) return "figure.hiking";
  if (lowered.includes("walk")) return "figure.walk";
  if (lowered.includes("yoga")) return "figure.yoga";
  if (lowered.includes("strength") || lowered.includes("weight") || lowered.includes("lift")) return "dumbbell.fill";
  if (lowered.includes("pilates")) return "figure.pilates";
  if (lowered.includes("row")) return "figure.rower";
  if (lowered.includes("stretch") || lowered.includes("cool") || lowered.includes("recover")) return "figure.cooldown";
  if (lowered.includes("hiit") || lowered.includes("interval") || lowered.includes("cross")) return "flame.fill";
  if (lowered.includes("dance")) return "figure.dance";
  if (lowered.includes("box") || lowered.includes("martial") || lowered.includes("kickbox")) return "figure.boxing";
  if (lowered.includes("elliptical")) return "figure.elliptical";
  if (lowered.includes("stair")) return "figure.stair.stepper";
  return "figure.mixed.cardio";
}

/**
 * Map activity type to category color string (mirrors Swift liveActivityCategoryForType)
 */
function liveActivityCategoryForType(type) {
  const lowered = (type || "").toLowerCase();
  if (lowered.includes("strength") || lowered.includes("weight") || lowered.includes("lift")
      || lowered.includes("bodyweight") || lowered.includes("calisthenics")) return "strength";
  if (lowered.includes("yoga") || lowered.includes("stretch") || lowered.includes("pilates")
      || lowered.includes("cool") || lowered.includes("recover") || lowered.includes("meditation")
      || lowered.includes("foam") || lowered.includes("mobility")) return "recovery";
  return "cardio";
}

/**
 * Start a Live Activity on the user's iPhone via APNs push-to-start.
 * Called by the Apple Watch when a workout begins.
 */
exports.startLiveActivityPush = onRequest(async (req, res) => {
  console.log("[startLiveActivityPush] Called");

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Authenticate via Bearer token
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing authorization token" });
    return;
  }

  const idToken = authHeader.split("Bearer ")[1];

  try {
    const decodedToken = await getAuth().verifyIdToken(idToken);
    const uid = decodedToken.uid;
    console.log("[startLiveActivityPush] Verified user:", uid);

    const { activityType, strengthType } = req.body;
    const displayType = strengthType || activityType || "Other";
    console.log("[startLiveActivityPush] Activity:", displayType);

    // Get the user's Live Activity push-to-start token from Firestore
    const tokenDoc = await db.collection("userTokens").doc(uid).get();
    const tokenData = tokenDoc.data();
    const liveActivityToken = tokenData?.liveActivityPushToken;

    if (!liveActivityToken) {
      console.log("[startLiveActivityPush] No liveActivityPushToken for user", uid);
      res.status(404).json({ error: "No Live Activity push token found" });
      return;
    }

    // Build the APNs payload for push-to-start
    // startTime uses timeIntervalSince1970 (matches custom Codable on Swift side)
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      aps: {
        timestamp: now,
        event: "start",
        "content-state": {
          isPaused: false,
          accumulatedPauseTime: 0,
        },
        "attributes-type": "WorkoutActivityAttributes",
        "attributes": {
          activityType: displayType,
          activityIcon: liveActivityIconForType(displayType),
          startTime: Date.now() / 1000, // timeIntervalSince1970
          categoryColor: liveActivityCategoryForType(displayType),
        },
        alert: {
          title: displayType,
          body: "Workout In Progress",
        },
      },
    };

    console.log("[startLiveActivityPush] Sending APNs push to token:", liveActivityToken.substring(0, 16) + "...");

    // Try sandbox first (for dev builds), fall back to production
    let result = await sendApnsLiveActivityPush(liveActivityToken, payload, true);
    if (!result.success && result.status === 400) {
      console.log("[startLiveActivityPush] Sandbox failed, trying production...");
      result = await sendApnsLiveActivityPush(liveActivityToken, payload, false);
    }

    if (result.success) {
      res.status(200).json({ success: true });
    } else {
      res.status(502).json({ success: false, apnsStatus: result.status, error: result.error });
    }
  } catch (err) {
    console.error("[startLiveActivityPush] Error:", err.message);
    res.status(500).json({ error: err.message });
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
  CHALLENGE_RECEIVED: 'challenge_received',
  CHALLENGE_ACCEPTED: 'challenge_accepted',
  CHALLENGE_COMPLETED: 'challenge_completed',
  CHALLENGE_EXPIRING: 'challenge_expiring',
  CHALLENGE_ACCEPT_EXPIRED: 'challenge_accept_expired',
  CHALLENGE_CANCEL_REQUESTED: 'challenge_cancel_requested',
  CHALLENGE_CANCEL_ACCEPTED: 'challenge_cancel_accepted',
  CHALLENGE_CANCEL_DECLINED: 'challenge_cancel_declined',
  CHALLENGE_PICK_WHICH: 'challenge_pick_which',
  // Lifecycle / retention
  TRIAL_ENDING: 'trial_ending',
  TRIAL_FINAL: 'trial_final',
  WINBACK: 'winback',
  ACTIVATION: 'activation',
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
    dailyReminders: true, // default ON — the core daily habit nudge (retention)
    dailyReminderTime: '09:00',
    streakMilestones: true,
    goalAchievements: true,
    weeklySummary: true,
    monthlySummary: true,
    newActivityDetected: true,
    challengeReceived: true,
    challengeAccepted: true,
    challengeCompleted: true,
    challengeExpiring: true,
    challengeAcceptExpired: true,
    challengeCancelRequest: true,
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

    // Best-effort instrumentation: record the send for open-rate analysis
    // (paired with the 'opened' events from logNotificationOpen on tap). Awaited
    // + guarded so a metrics failure never affects delivery.
    if (response.successCount > 0) {
      try {
        const sentAt = new Date();
        await db.collection('notificationEvents').add({
          type: data.type || 'unknown',
          event: 'sent',
          uid: userId,
          stage: data.stage || null,
          ts: sentAt.toISOString(),
          date: sentAt.toISOString().split('T')[0],
        });
      } catch (e) {
        console.warn(`[notif-metrics] sent-log failed for ${userId}: ${e.message}`);
      }
    }

    return { success: response.successCount > 0 };
  } catch (error) {
    console.error(`Error sending notification to ${userId}:`, error);
    return { success: false, error: error.message };
  }
}

// ==========================================
// NOTIFICATION METRICS (open tracking)
// ==========================================
//
// The client POSTs here when a user taps a notification (opens can't be known
// on the send side). Pairs with the 'sent' events written in
// sendNotificationToUser → per-type open rates (functions/scripts/notificationStats.js).
exports.logNotificationOpen = onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.status(204).send('');
    return;
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing token' }); return; }

  try {
    const decoded = await getAuth().verifyIdToken(authHeader.split('Bearer ')[1]);
    const body = req.body || {};
    const openedAt = new Date();
    await db.collection('notificationEvents').add({
      type: body.type || 'unknown',
      event: 'opened',
      uid: decoded.uid, // from the verified token — can't be spoofed for another user
      stage: body.stage || null,
      ts: openedAt.toISOString(),
      date: openedAt.toISOString().split('T')[0],
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    console.warn('[logNotificationOpen] error:', err.message);
    res.status(401).json({ error: 'Invalid token' });
  }
});

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

      // Skip users on vacation or injury mode (streak is frozen — don't nag)
      if (userData.vacationMode?.isActive) continue;
      if (userData.injuryMode?.isActive) continue;

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

      // Skip users healing — injury mode softens the "time to move" nudge
      if (userData.injuryMode?.isActive) continue;

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

      // Skip users on vacation or injury mode (streak is frozen — don't nag)
      if (userData.vacationMode?.isActive) continue;
      if (userData.injuryMode?.isActive) continue;

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

      // Skip recap while healing — a "you crushed it / nothing logged" summary
      // lands wrong during an injury pause.
      if (userData.injuryMode?.isActive) continue;

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

      // Skip recap while healing (see weekly summary).
      if (userData.injuryMode?.isActive) continue;

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

// ==========================================
// SUBSCRIPTION STATE — RevenueCat webhook
// ==========================================
//
// The server otherwise has ZERO knowledge of subscription state (it lives
// client-side in RevenueCat). This webhook persists a compact `subscription`
// object on users/{uid}, which is what makes the trial-end nudge and win-back
// sequences below possible.
//
// One-time setup in the RevenueCat dashboard:
//   Project Settings > Integrations > Webhooks
//     URL:                  https://us-central1-<project>.cloudfunctions.net/revenueCatWebhook
//     Authorization header: <REVENUECAT_WEBHOOK_SECRET>   (value you choose)
//   Then store the secret so the function can verify it:
//     firebase functions:secrets:set REVENUECAT_WEBHOOK_SECRET
//
// `app_user_id` equals the Firebase UID once loginRevenueCat(uid) has aliased
// the anonymous user at sign-in; we pick the first non-anonymous id available.
exports.revenueCatWebhook = onRequest(
  { secrets: [revenueCatWebhookSecret] },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // RevenueCat sends the Authorization header value you configure in the
    // dashboard. Accept it with or without a "Bearer " prefix.
    const expected = revenueCatWebhookSecret.value();
    const raw = req.headers.authorization || '';
    const provided = raw.startsWith('Bearer ') ? raw.slice(7) : raw;
    if (!expected || provided !== expected) {
      console.warn('[revenueCatWebhook] Unauthorized request');
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const event = req.body && req.body.event;
    if (!event || !event.type) {
      res.status(200).json({ ok: true, skipped: 'no_event' });
      return;
    }

    // Resolve the Firebase UID, skipping RevenueCat anonymous ids.
    const uid = [event.app_user_id, event.original_app_user_id, ...(event.aliases || [])]
      .filter(Boolean)
      .find((id) => !String(id).startsWith('$RCAnonymousID:'));
    if (!uid) {
      res.status(200).json({ ok: true, skipped: 'anonymous_only' });
      return;
    }

    try {
      const type = event.type;
      const periodType = event.period_type || null; // TRIAL | NORMAL | INTRO
      const expirationMs = event.expiration_at_ms || null;
      const expiresAt = expirationMs ? new Date(expirationMs).toISOString() : null;

      const ACTIVE = ['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'SUBSCRIPTION_EXTENDED', 'TEMPORARY_ENTITLEMENT_GRANT'];
      const INACTIVE = ['EXPIRATION', 'BILLING_ISSUE', 'SUBSCRIPTION_PAUSED'];

      let entitlementActive;
      if (ACTIVE.includes(type)) entitlementActive = true;
      else if (INACTIVE.includes(type)) entitlementActive = false;
      // CANCELLATION = auto-renew off but still entitled until expiry.
      else if (type === 'CANCELLATION') entitlementActive = expirationMs ? expirationMs > Date.now() : true;
      else entitlementActive = expirationMs ? expirationMs > Date.now() : false;

      const isTrial = periodType === 'TRIAL';
      const subscription = {
        entitlementActive,
        status: !entitlementActive ? 'expired' : (isTrial ? 'trial' : 'active'),
        periodType,
        expiresAt,
        trialEndsAt: isTrial && entitlementActive ? expiresAt : null,
        willRenew: type === 'CANCELLATION' ? false : entitlementActive,
        lastEventType: type,
        updatedAt: new Date().toISOString(),
      };

      const update = { subscription };
      // Converting clears/re-arms the lifecycle nudges so a re-subscribe gets a
      // fresh trial-end reminder and stops any in-flight win-back sequence.
      if (entitlementActive) {
        update.winbackStage = FieldValue.delete();
        update.winbackLastSentAt = FieldValue.delete();
        if (isTrial && type === 'INITIAL_PURCHASE') {
          update.trialEndingNotified = FieldValue.delete();
          update.trialFinalNotified = FieldValue.delete();
        }
      }

      await db.collection('users').doc(uid).set(update, { merge: true });
      console.log(`[revenueCatWebhook] ${type}/${periodType} uid=${uid} active=${entitlementActive} expiresAt=${expiresAt}`);
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[revenueCatWebhook] Error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * Helper: server-side mirror of the app's "full access" gate. A user can use
 * the app (and therefore log workouts) when they hold an active entitlement,
 * are grandfathered (pre-cutover, no subscriptionRequired field), or comped.
 */
function hasAppAccess(userData) {
  if (userData.subscriptionRequired !== true) return true; // grandfathered
  if (userData.forceProTier === true) return true; // comped
  return userData.subscription?.entitlementActive === true;
}

/**
 * Safety gate for the win-back sequence. Win-back targets users WITHOUT
 * server-side access — but until the RevenueCat webhook is live and populating
 * `subscription`, EVERY post-cutover user looks access-less, which would nag
 * real subscribers. So win-back stays dormant until you explicitly enable it
 * AFTER confirming the webhook works:
 *   Firestore → config/lifecycleNotifications → { winbackEnabled: true }
 * (trial-end + activation are safe by construction and need no flag.)
 */
async function isWinbackEnabled() {
  try {
    const doc = await db.collection('config').doc('lifecycleNotifications').get();
    return doc.exists && doc.data().winbackEnabled === true;
  } catch (e) {
    return false;
  }
}

/**
 * Helper: whole days elapsed since an ISO timestamp (null-safe).
 */
function daysSince(iso) {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return Infinity;
  return (Date.now() - t) / (24 * 60 * 60 * 1000);
}

/**
 * Helper: count this-week (last 7 days) workouts + recovery for a value recap.
 */
function weekRecap(userData) {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const weekAgoStr = oneWeekAgo.toISOString().split('T')[0];
  let workouts = 0;
  let recovery = 0;
  (userData.activities || []).filter((a) => a.date >= weekAgoStr).forEach((a) => {
    const cat = getActivityCategoryForGoals(a);
    if (cat === 'lifting' || cat === 'cardio') workouts++;
    else if (cat === 'recovery') recovery++;
  });
  return { workouts, recovery };
}

// ==========================================
// LIFECYCLE / RETENTION REMINDERS
// ==========================================

/**
 * Trial-end conversion nudge — runs hourly. Sends a "trial ends tomorrow"
 * value recap ~24h out and a final nudge ~2h out. Each fires once (flagged)
 * and ignores quiet hours since the timing is pinned to the trial expiry.
 *
 * Depends on the RevenueCat webhook having stamped subscription.trialEndsAt.
 */
exports.sendTrialEndingReminders = onSchedule(
  {
    schedule: '0 * * * *', // every hour
    timeZone: 'UTC',
  },
  async () => {
    const snap = await db.collection('users')
      .where('subscription.status', '==', 'trial')
      .get();

    const now = Date.now();
    for (const userDoc of snap.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();
      const sub = userData.subscription || {};
      if (!sub.entitlementActive || !sub.trialEndsAt) continue;

      const hoursLeft = (new Date(sub.trialEndsAt).getTime() - now) / (60 * 60 * 1000);
      if (hoursLeft <= 0) continue;

      // Day-before nudge (~24h), once.
      if (hoursLeft >= 22 && hoursLeft < 26 && !userData.trialEndingNotified) {
        const { workouts, recovery } = weekRecap(userData);
        const streak = userData.streak || 0;
        const built = workouts > 0 || recovery > 0 || streak > 0;
        const recapStr = built
          ? `Your week: ${workouts} workout${workouts === 1 ? '' : 's'}` +
            (recovery > 0 ? `, ${recovery} recovery` : '') +
            (streak > 0 ? `, a ${streak}-week streak` : '') + '.'
          : 'Keep your plan, streaks, and challenges.';
        await sendNotificationToUser(
          userId,
          'Your free week ends tomorrow ⏳',
          `${recapStr} Tap to keep it going.`,
          { type: NotificationType.TRIAL_ENDING },
          { ignoreQuietHours: true }
        );
        await db.collection('users').doc(userId).set({ trialEndingNotified: true }, { merge: true });
        continue;
      }

      // Final nudge (~2h), once.
      if (hoursLeft > 0 && hoursLeft < 3 && !userData.trialFinalNotified) {
        await sendNotificationToUser(
          userId,
          'Last chance — trial ending ⏰',
          "Your free trial ends in about an hour. Don't lose your streak and stats.",
          { type: NotificationType.TRIAL_FINAL },
          { ignoreQuietHours: true }
        );
        await db.collection('users').doc(userId).set({ trialFinalNotified: true }, { merge: true });
      }
    }
  }
);

/**
 * Win-back sequence — runs daily at 6 PM ET. Targets post-cutover accounts
 * (subscriptionRequired === true) that lack app access (never subscribed or
 * lapsed) but DID complete signup (have a username, hence an FCM token). Three
 * escalating touches at day 1 / 3 / 7, one per run, tracked by `winbackStage`.
 * Taps open the app → the hard gate (LockedScreen) carries the subscribe CTA.
 */
exports.sendWinbackReminders = onSchedule(
  {
    schedule: '0 18 * * *', // 6 PM daily
    timeZone: 'America/New_York',
  },
  async () => {
    // Dormant until explicitly enabled (see isWinbackEnabled). Guards against
    // nagging real subscribers before the RevenueCat webhook is populating state.
    if (!(await isWinbackEnabled())) {
      console.log('[sendWinbackReminders] disabled (config/lifecycleNotifications.winbackEnabled !== true) — skipping');
      return;
    }

    const snap = await db.collection('users')
      .where('subscriptionRequired', '==', true)
      .get();

    const STAGES = [
      { stage: 1, minDays: 1, title: 'Your free week is waiting 🎁', body: 'You built your plan — now unlock it. Start your 7-day free trial.' },
      { stage: 2, minDays: 3, title: "Don't lose your progress 💪", body: 'Your goals are set up and ready. Start your free trial and pick up where you left off.' },
      { stage: 3, minDays: 7, title: 'Last call 👋', body: 'Your DaySeven plan is still here. Tap to start your free 7-day trial.' },
    ];

    for (const userDoc of snap.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();

      if (hasAppAccess(userData)) continue;       // subscribed/comped — not a target
      if (!userData.username) continue;            // still mid-onboarding
      if (userData.demoMode === true) continue;

      const sentStage = userData.winbackStage || 0;
      if (sentStage >= STAGES.length) continue;    // sequence complete

      // Highest stage now due beyond what we last sent. One message per run.
      // Stage clock starts when they LOST access (lapsed subs/trials) — not raw
      // account age — so a lapsed trial gets the full day 1/3/7 sequence from the
      // lapse, not a truncated "last call". Never-subscribed users have no
      // expiry, so they fall back to signup (createdAt), which is correct.
      const sub = userData.subscription;
      const clockStart = (sub && sub.entitlementActive === false && sub.expiresAt) ? sub.expiresAt : userData.createdAt;
      const age = daysSince(clockStart);
      const due = [...STAGES].reverse().find((s) => age >= s.minDays && s.stage > sentStage);
      if (!due) continue;

      const result = await sendNotificationToUser(
        userId, due.title, due.body,
        { type: NotificationType.WINBACK, stage: String(due.stage) }
      );
      if (result.success) {
        await db.collection('users').doc(userId).set({
          winbackStage: due.stage,
          winbackLastSentAt: new Date().toISOString(),
        }, { merge: true });
      }
    }
  }
);

/**
 * Week-one activation nudges — runs daily at 5 PM ET. Targets brand-new users
 * WITH app access (trialing/comped/grandfathered) who haven't gotten going:
 *  - "log your first workout" ~day 1 if they have zero activities, and
 *  - "finish your first week" ~day 3 if they've started but not hit their goals.
 * Fills the gap left by the streak reminder, which can't fire in week one
 * (streak is still 0). Gated on the streakReminders pref. Each fires once.
 */
exports.sendActivationReminders = onSchedule(
  {
    schedule: '0 17 * * *', // 5 PM daily
    timeZone: 'America/New_York',
  },
  async () => {
    const snap = await db.collection('users')
      .where('subscriptionRequired', '==', true)
      .get();

    for (const userDoc of snap.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();

      if (!hasAppAccess(userData)) continue;       // locked out → win-back handles them
      if (!userData.username) continue;             // still mid-onboarding
      if (userData.demoMode === true) continue;
      if (userData.injuryMode?.isActive || userData.vacationMode?.isActive) continue;
      if ((userData.streak || 0) > 0) continue;     // past their first completed week
      if (daysSince(userData.createdAt) >= 7) continue; // week-one only

      const prefs = await getUserPreferences(userId);
      if (!prefs.streakReminders) continue;

      const activities = userData.activities || [];
      const age = daysSince(userData.createdAt);

      // First-workout nudge — once, from ~day 1, when nothing is logged yet.
      if (activities.length === 0) {
        if (age >= 1 && !userData.activationFirstNudge) {
          await sendNotificationToUser(
            userId,
            'Start your first streak 🔥',
            'Log your first workout to kick off week one — it only takes a tap.',
            { type: NotificationType.ACTIVATION, stage: 'first' }
          );
          await db.collection('users').doc(userId).set({ activationFirstNudge: true }, { merge: true });
        }
        continue;
      }

      // Finish-the-week nudge — once, from ~day 3, when started but goals unmet.
      if (age >= 3 && !userData.activationWeekNudge) {
        const goals = userData.goals || { liftsPerWeek: 3, cardioPerWeek: 2, recoveryPerWeek: 2 };
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        const weekAgoStr = oneWeekAgo.toISOString().split('T')[0];
        let strength = 0, cardio = 0, recovery = 0;
        activities.filter((a) => a.date >= weekAgoStr).forEach((a) => {
          const cat = getActivityCategoryForGoals(a);
          if (cat === 'lifting') strength++;
          else if (cat === 'cardio') cardio++;
          else if (cat === 'recovery') recovery++;
        });
        const done = strength >= goals.liftsPerWeek && cardio >= goals.cardioPerWeek && recovery >= goals.recoveryPerWeek;
        if (!done) {
          const completed = strength + cardio + recovery;
          await sendNotificationToUser(
            userId,
            "You're building something 💪",
            `${completed} workout${completed === 1 ? '' : 's'} down this week. Finish your goals before Sunday to lock in week one!`,
            { type: NotificationType.ACTIVATION, stage: 'week' }
          );
          await db.collection('users').doc(userId).set({ activationWeekNudge: true }, { merge: true });
        }
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

    // Don't fire celebratory milestones while the streak is paused for injury.
    if (after.injuryMode?.isActive) return;

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

// ==========================================
// CHALLENGES
// ==========================================

/**
 * Check whether a logged activity satisfies a challenge's match rule.
 * Mirrors buildMatchRule() in src/services/challengeService.js — keep them in sync.
 */
/**
 * Run the per-challenge fulfillment transaction + notifications for a single
 * (userId, challenge, matched activity) trio. Used by both the activity trigger
 * and the applyChallengeIntent callable.
 *
 * Returns:
 *   { fulfilled: boolean, photoRequired: boolean, completedChallengeId: string|null }
 *  - fulfilled=true when the user's status flipped to 'completed' inside this call.
 *  - photoRequired=true when the challenge required a photo and the activity didn't have one.
 */
async function fulfillChallengeForUser({ userId, challengeDocRef, challenge, matched, message }) {
  // Trim + cap the optional accepter message to a lock-screen-friendly size.
  const cleanMessage = (typeof message === 'string' && message.trim())
    ? message.trim().slice(0, 140)
    : null;
  // Fast pre-bail using the caller's view — avoids opening a transaction when the photo is
  // obviously missing. The authoritative gate runs inside the transaction below, against
  // fresh challenge + activity state, so a stale caller object cannot bypass enforcement.
  if (challenge.requirePhoto && !matched.photoURL) {
    return { fulfilled: false, photoRequired: true, completedChallengeId: null };
  }

  let didFulfill = false;
  let photoRequired = false;
  await db.runTransaction(async (tx) => {
    const friendRef = db.collection('users').doc(userId);
    const [fresh, friendSnap] = await Promise.all([
      tx.get(challengeDocRef),
      tx.get(friendRef),
    ]);
    if (!fresh.exists) return;
    const data = fresh.data();

    const myStatusFresh = data.participants?.[userId]?.status
      || (data.friendUid === userId ? data.friendStatus : null);
    if (myStatusFresh !== 'accepted') return;

    // Authoritative photo gate: re-check against the fresh challenge doc and the user's
    // current activity (reread inside the transaction). This is the bulletproof point —
    // a stale `challenge` arg or a race where photoURL was removed cannot get past here.
    if (data.requirePhoto) {
      const freshActivities = friendSnap.data()?.activities || [];
      const freshActivity = freshActivities.find(a => String(a.id) === String(matched.id));
      const photoURL = freshActivity?.photoURL || matched.photoURL;
      if (!photoURL) {
        photoRequired = true;
        return;
      }
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const update = {};
    if (data.participants) {
      update[`participants.${userId}.status`] = 'completed';
      update[`participants.${userId}.completedAt`] = nowIso;
      update[`participants.${userId}.fulfillingActivityId`] = String(matched.id || '');
      if (matched.photoURL) {
        // Denormalize the proof photo onto the challenge doc so the detail modal can
        // render it without a separate fetch into the accepter's activities array.
        update[`participants.${userId}.fulfillingPhotoURL`] = matched.photoURL;
      }
      if (cleanMessage) {
        update[`participants.${userId}.completionMessage`] = cleanMessage;
      }
    }
    if (data.friendUid === userId) {
      update.friendStatus = 'completed';
      update.completedAt = nowIso;
      update.fulfillingActivityId = String(matched.id || '');
      if (matched.photoURL) {
        update.fulfillingPhotoURL = matched.photoURL;
      }
      if (cleanMessage) {
        update.completionMessage = cleanMessage;
      }
    }

    let overallNowComplete = false;
    if (data.type !== 'group') {
      overallNowComplete = true;
    } else {
      const allParticipants = data.participants || {};
      const stillOpen = Object.entries(allParticipants).some(([uid, p]) => {
        if (uid === userId) return false;
        return p.status === 'pending' || p.status === 'accepted';
      });
      overallNowComplete = !stillOpen;
    }

    if (overallNowComplete) {
      update.status = 'completed';
      update.completedAt = nowIso;
      const completedUids = [userId];
      if (data.participants) {
        for (const [uid, p] of Object.entries(data.participants)) {
          if (uid === userId) continue;
          if (p.status === 'completed') completedUids.push(uid);
        }
      }
      update.winnerUids = Array.from(new Set(completedUids));
    }

    const friendStats = (friendSnap.data()?.challengeStats) || {};
    const friendNewStreak = (friendStats.currentWinStreak || 0) + 1;

    tx.update(challengeDocRef, update);
    tx.set(friendRef, {
      challengeStats: {
        wins: FieldValue.increment(1),
        currentWinStreak: friendNewStreak,
        longestWinStreak: Math.max(friendStats.longestWinStreak || 0, friendNewStreak),
      },
    }, { merge: true });

    didFulfill = true;
  });

  if (didFulfill) {
    try {
      const [challengerPrefs, friendPrefs] = await Promise.all([
        getUserPreferences(challenge.challengerUid),
        getUserPreferences(userId),
      ]);
      const friendName = await getUserDisplayName(userId);
      const isGroup = challenge.type === 'group';

      if (challengerPrefs.challengeCompleted) {
        const baseBody = isGroup
          ? `${friendName} crushed your group challenge.`
          : `${friendName} matched your challenge.`;
        const body = cleanMessage
          ? `${baseBody}\n💬 "${cleanMessage}"`
          : baseBody;
        await sendNotificationToUser(
          challenge.challengerUid,
          'Challenge Completed! 🎯',
          body,
          {
            type: NotificationType.CHALLENGE_COMPLETED,
            fromUserId: userId,
            challengeId: challengeDocRef.id,
          }
        );
      }
      if (friendPrefs.challengeCompleted) {
        await sendNotificationToUser(
          userId,
          'Challenge Complete! 🏆',
          'You crushed it. Win logged.',
          {
            type: NotificationType.CHALLENGE_COMPLETED,
            fromUserId: challenge.challengerUid,
            challengeId: challengeDocRef.id,
          }
        );
      }
    } catch (err) {
      console.error('[fulfillChallengeForUser] notify failed:', err);
    }
  }

  return { fulfilled: didFulfill, photoRequired, completedChallengeId: didFulfill ? challengeDocRef.id : null };
}

function activityMatchesRule(activity, rule) {
  if (!activity || !rule) return false;
  const category = getActivityCategoryForGoals(activity);
  if (category !== rule.category) return false;

  if (rule.activityType && activity.type !== rule.activityType) return false;

  if (rule.distanceMin) {
    const distance = parseFloat(activity.distance) || 0;
    return distance >= rule.distanceMin;
  }

  if (rule.paceMaxSecondsPerMile) {
    const distance = parseFloat(activity.distance) || 0;
    const duration = parseInt(activity.duration, 10) || 0;
    if (distance <= 0 || duration <= 0) return false;
    const pace = (duration * 60) / distance;
    return pace <= rule.paceMaxSecondsPerMile;
  }

  const duration = parseInt(activity.duration, 10) || 0;
  return duration >= (rule.durationMin || 0);
}

/**
 * Notify every recipient (1v1 = one friend, group = N friends) when a new challenge lands.
 */
exports.onChallengeCreated = onDocumentCreated(
  'challenges/{challengeId}',
  async (event) => {
    const challenge = event.data.data();
    const { challengerUid, challengerName, matchRule, type, participants, title, challengerActivity } = challenge;
    if (!challengerUid) return;

    // Recipient list: participants map keys (preferred) OR legacy friendUid (Phase 1 1v1)
    const recipientUids = participants
      ? Object.keys(participants)
      : (challenge.friendUid ? [challenge.friendUid] : []);
    if (recipientUids.length === 0) return;

    const fromName = challengerName || await getUserDisplayName(challengerUid);

    // Scope label for the notification headline. Pulled from the challenger's actual
    // activity (so Cold Plunge reads as "Cold Plunge", not just "Recovery") with
    // short verb substitutions for the common distance sports.
    const SCOPE_DISPLAY = {
      Running: 'Run',
      Cycle: 'Ride',
      Swimming: 'Swim',
      Rowing: 'Row',
      Hiking: 'Hike',
      'Strength Training': 'Strength',
      Weightlifting: 'Strength',
      Bodyweight: 'Strength',
      Circuit: 'Strength',
    };
    const rawType = challengerActivity?.type;
    const categoryFallback = {
      lifting: 'Strength',
      cardio: 'Cardio',
      recovery: 'Recovery',
    }[matchRule?.category] || 'Workout';
    const scope = SCOPE_DISPLAY[rawType] || rawType || categoryFallback;

    const emoji = type === 'group' ? '👊' : '⚡';
    const headline = `New Challenge: ${scope} ${emoji}`;

    await Promise.all(recipientUids.map(async (recipientUid) => {
      const prefs = await getUserPreferences(recipientUid);
      if (!prefs.challengeReceived) return;

      const target = type === 'group' ? 'the squad' : 'you';
      const otherCount = recipientUids.filter(u => u !== recipientUid).length;
      const groupSuffix = type === 'group' && otherCount > 0
        ? ` (you + ${otherCount} other${otherCount === 1 ? '' : 's'})`
        : '';

      // With the scope already in the headline, the body just needs WHO.
      // Title, when present, rides in the body for extra flavor.
      const body = title
        ? `${fromName} challenged ${target}: ${title}${groupSuffix}`
        : `${fromName} challenged ${target}${groupSuffix}`;

      await sendNotificationToUser(
        recipientUid,
        headline,
        body,
        {
          type: NotificationType.CHALLENGE_RECEIVED,
          fromUserId: challengerUid,
          challengeId: event.params.challengeId,
        }
      );
    }));
  }
);

/**
 * Multi-purpose lifecycle trigger. Fires on every challenge update and dispatches:
 *  - Acceptance: bumps accepted counter + notifies challenger ("Challenge Accepted")
 *  - Accept-window expiry: notifies challenger that no one took it
 *  - Cancel request lifecycle: notifies accepter on request, sender on response
 */
exports.onChallengeUpdated = onDocumentUpdated(
  'challenges/{challengeId}',
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (!before || !after) return;

    const { challengerUid } = after;
    if (!challengerUid) return;

    const challengeId = event.params.challengeId;

    // ---- 1. New acceptances ----
    const newAccepters = [];
    if (after.participants) {
      for (const [uid, p] of Object.entries(after.participants)) {
        const prevStatus = before.participants?.[uid]?.status;
        if (p.status === 'accepted' && prevStatus !== 'accepted') {
          newAccepters.push(uid);
        }
      }
    } else if (before.friendStatus !== 'accepted' && after.friendStatus === 'accepted' && after.friendUid) {
      newAccepters.push(after.friendUid);
    }

    if (newAccepters.length > 0) {
      // Bump `accepted` counter — denominator for completion rate (wins / accepted).
      // Only accepters score; challenger never gets credit for sending.
      await Promise.all(newAccepters.map(uid =>
        db.collection('users').doc(uid).set({
          challengeStats: { accepted: FieldValue.increment(1) },
        }, { merge: true }).catch(err =>
          console.error(`[onChallengeUpdated] failed to bump accepted for ${uid}:`, err)
        )
      ));

      const prefs = await getUserPreferences(challengerUid);
      if (prefs.challengeAccepted) {
        const windowH = after.windowHours || 24;
        const isGroup = after.type === 'group';

        await Promise.all(newAccepters.map(async (friendUid) => {
          const friendName = await getUserDisplayName(friendUid);
          await sendNotificationToUser(
            challengerUid,
            'Challenge Accepted! 🔥',
            isGroup
              ? `${friendName} joined the group challenge — ${windowH}h on the clock.`
              : `${friendName} took the bait — ${windowH}h on the clock.`,
            {
              type: NotificationType.CHALLENGE_ACCEPTED,
              fromUserId: friendUid,
              challengeId,
            }
          );
        }));
      }
    }

    // ---- 2. Accept window expired (no one accepted in time) ----
    if (before.status !== 'accept_expired' && after.status === 'accept_expired') {
      const prefs = await getUserPreferences(challengerUid);
      if (prefs.challengeAcceptExpired) {
        const isGroupExpiry = after.type === 'group';
        const recipientUid = after.friendUid || (after.participantUids || []).find(u => u !== challengerUid);
        const recipientName = recipientUid ? await getUserDisplayName(recipientUid) : 'Your friend';
        await sendNotificationToUser(
          challengerUid,
          'Challenge Expired ⌛',
          isGroupExpiry
            ? `Nobody accepted your group challenge in time.`
            : `${recipientName} didn't accept your challenge in time.`,
          {
            type: NotificationType.CHALLENGE_ACCEPT_EXPIRED,
            challengeId,
          }
        );
      }
    }

    // ---- 3. Cancel request flow (1v1 active only) ----
    const beforeCR = before.cancelRequest || null;
    const afterCR = after.cancelRequest || null;
    const beforeHadOpenRequest = beforeCR && !beforeCR.response;
    const afterHasOpenRequest = afterCR && !afterCR.response;

    // 3a. Sender just opened a cancel request → notify the accepter
    if (!beforeHadOpenRequest && afterHasOpenRequest) {
      const requesterUid = afterCR.requestedBy;
      const accepterUid = (after.participantUids || []).find(u => u !== requesterUid)
        || after.friendUid;
      if (accepterUid && accepterUid !== requesterUid) {
        const prefs = await getUserPreferences(accepterUid);
        if (prefs.challengeCancelRequest) {
          const requesterName = await getUserDisplayName(requesterUid);
          await sendNotificationToUser(
            accepterUid,
            'Cancel Requested 🤝',
            `${requesterName} wants to cancel your active challenge.`,
            {
              type: NotificationType.CHALLENGE_CANCEL_REQUESTED,
              fromUserId: requesterUid,
              challengeId,
            }
          );
        }
      }
    }

    // 3b. Accepter responded to an open request → notify the sender
    const responseJustSet = beforeHadOpenRequest && afterCR?.response && !beforeCR?.response;
    if (responseJustSet) {
      const requesterUid = afterCR.requestedBy;
      const responderUid = (after.participantUids || []).find(u => u !== requesterUid)
        || after.friendUid;
      const prefs = await getUserPreferences(requesterUid);
      if (prefs.challengeCancelRequest) {
        const responderName = responderUid ? await getUserDisplayName(responderUid) : 'Your friend';
        if (afterCR.response === 'accepted') {
          await sendNotificationToUser(
            requesterUid,
            'Challenge Cancelled ✅',
            `${responderName} agreed to cancel.`,
            {
              type: NotificationType.CHALLENGE_CANCEL_ACCEPTED,
              fromUserId: responderUid,
              challengeId,
            }
          );
        } else {
          await sendNotificationToUser(
            requesterUid,
            'Cancel Declined',
            `${responderName} wants to keep going — challenge continues.`,
            {
              type: NotificationType.CHALLENGE_CANCEL_DECLINED,
              fromUserId: responderUid,
              challengeId,
            }
          );
        }
      }
    }
  }
);

/**
 * On any user activity write, check their active challenges-as-recipient.
 * If a newly-logged activity satisfies the match rule, mark the challenge completed
 * and increment win counters on both users.
 *
 * Notes:
 *  - Only matches the recipient's challenges (the challenger has already done it by definition).
 *  - One activity can fulfill multiple challenges by design (see plan §3 — friends shouldn't be
 *    punished for genuinely doing the work).
 *  - Idempotent via challenge.status check inside the transaction.
 */
exports.onUserActivitiesUpdatedForChallenges = onDocumentUpdated(
  'users/{userId}',
  async (event) => {
    const userId = event.params.userId;
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (!after) return;

    const beforeActivities = before?.activities || [];
    const afterActivities = after?.activities || [];
    if (afterActivities.length <= beforeActivities.length) return;

    const beforeIds = new Set(beforeActivities.map(a => String(a.id)));
    const newActivities = afterActivities.filter(a => !beforeIds.has(String(a.id)));
    if (newActivities.length === 0) return;

    // Find this user's active incoming challenges (1v1 or group, this user is a recipient).
    const challengesSnap = await db.collection('challenges')
      .where('participantUids', 'array-contains', userId)
      .where('status', '==', 'active')
      .get();

    if (challengesSnap.empty) return;

    // Phase 1: collect all challenges where I'm an accepted participant.
    const acceptedChallenges = [];
    for (const challengeDoc of challengesSnap.docs) {
      const challenge = challengeDoc.data();
      let myStatus;
      if (challenge.participants && challenge.participants[userId]) {
        myStatus = challenge.participants[userId].status;
      } else if (challenge.friendUid === userId) {
        myStatus = challenge.friendStatus;
      } else {
        continue;
      }
      if (myStatus !== 'accepted') continue;
      acceptedChallenges.push({ challengeDoc, challenge });
    }

    // Phase 2: per activity, decide what to fulfill.
    //  - If the activity carries `intendedChallengeIds`, only those listed challenges fulfill.
    //  - If exactly one accepted challenge matches and no intent is set, auto-fulfill it.
    //  - If multiple match with no intent, defer and notify the user to pick — single activity
    //    no longer silently fulfills every active challenge of the same category.
    // Activities are processed oldest-first; once a challenge is claimed by an activity, subsequent
    // activities in the same trigger payload won't claim it again (transaction would no-op anyway).
    const completions = [];
    const photoNudges = [];
    const ambiguousByActivity = []; // { activity, candidates: [{ challengeDoc, challenge }] }
    const claimedChallengeIds = new Set();

    const sortedActivities = newActivities.slice().sort((a, b) => {
      const at = new Date(a.date || 0).getTime();
      const bt = new Date(b.date || 0).getTime();
      return at - bt;
    });

    for (const activity of sortedActivities) {
      const candidates = acceptedChallenges.filter(({ challengeDoc, challenge }) =>
        !claimedChallengeIds.has(challengeDoc.id)
        && activityMatchesRule(activity, challenge.matchRule)
      );
      if (candidates.length === 0) continue;

      // `intendedChallengeIds` semantics:
      //  - undefined / not an array  → "user didn't express intent" → auto-match (single) or defer (multi)
      //  - explicit array (incl. empty) → "user did express intent" → only fulfill listed; never defer
      // The "explicit empty" case is what the finish-workout modal sends when the user unchecks
      // every match, i.e. "don't apply this workout to any challenge."
      const hasIntent = Array.isArray(activity.intendedChallengeIds);
      const intentIds = hasIntent
        ? activity.intendedChallengeIds.map(String).filter(Boolean)
        : [];

      let toFulfill;
      if (hasIntent) {
        toFulfill = intentIds.length > 0
          ? candidates.filter(({ challengeDoc }) => intentIds.includes(challengeDoc.id))
          : [];
      } else if (candidates.length === 1) {
        toFulfill = candidates;
      } else {
        ambiguousByActivity.push({ activity, candidates });
        continue;
      }

      for (const { challengeDoc, challenge } of toFulfill) {
        if (challenge.requirePhoto && !activity.photoURL) {
          photoNudges.push({ challengeDoc, challenge });
          continue;
        }
        completions.push({ challengeDoc, challenge, matched: activity });
        claimedChallengeIds.add(challengeDoc.id);
      }
    }

    // Send "pick which challenge" notifications for ambiguous activities (one push per activity).
    await Promise.all(ambiguousByActivity.map(async ({ activity, candidates }) => {
      try {
        const prefs = await getUserPreferences(userId);
        if (!prefs.challengeCompleted) return;
        const typeLabel = activity.type || 'workout';
        await sendNotificationToUser(
          userId,
          'Pick a challenge to fulfill 🤔',
          `Your ${typeLabel} matches ${candidates.length} active challenges — tap to choose.`,
          {
            type: NotificationType.CHALLENGE_PICK_WHICH,
            activityId: String(activity.id || ''),
            challengeIds: candidates.map(c => c.challengeDoc.id).join(','),
          }
        );
      } catch (err) {
        console.error('[onUserActivitiesUpdatedForChallenges] pick-which notify failed:', err);
      }
    }));

    // Send photo nudges (outside the completion loop — fire-and-forget notifications)
    await Promise.all(photoNudges.map(async ({ challengeDoc, challenge }) => {
      try {
        const prefs = await getUserPreferences(userId);
        if (!prefs.challengeCompleted) return;
        const challengerName = challenge.challengerName || await getUserDisplayName(challenge.challengerUid);
        await sendNotificationToUser(
          userId,
          'Add a photo to finish! 📸',
          `Your workout matched ${challengerName}'s challenge — add a photo to the activity to lock it in.`,
          {
            type: NotificationType.CHALLENGE_COMPLETED,
            fromUserId: challenge.challengerUid,
            challengeId: challengeDoc.id,
          }
        );
      } catch (err) {
        console.error('[onUserActivitiesUpdatedForChallenges] photo nudge failed:', err);
      }
    }));

    if (completions.length === 0) return;

    await Promise.all(completions.map(async ({ challengeDoc, challenge, matched }) => {
      try {
        await fulfillChallengeForUser({
          userId,
          challengeDocRef: challengeDoc.ref,
          challenge,
          matched,
          // Accepter's optional trash-talk message — written into the saved activity by the
          // log-completed / finish-workout modal, read here so the trigger path surfaces it
          // in the challenger's push too (same field used by applyChallengeIntent).
          message: matched.challengeMessage || null,
        });
      } catch (err) {
        console.error('[onUserActivitiesUpdatedForChallenges] completion failed:', err);
      }
    }));
  }
);

/**
 * Cron: every 5 minutes, expire challenges past their deadline.
 *
 * Rules:
 *  - 1v1 pending past respondByAt → accept_expired (no penalty, challenger gets a notification)
 *  - 1v1 active past expiresAt → expired (loss to friend who accepted but didn't complete)
 *  - Group per-participant pending past respondByAt → cancelled for them (no penalty)
 *  - Group per-participant accepted past expiresAt → expired (loss for them)
 *  - Group overall flips to 'completed' (if any won) or 'expired' (none won) when all participants resolved
 */
exports.expireChallenges = onSchedule(
  { schedule: 'every 5 minutes', timeZone: 'UTC' },
  async () => {
    const now = new Date();
    const nowIso = now.toISOString();
    const nowMs = now.getTime();

    // Query all open challenges; per-participant expiry can be earlier OR later than overall.
    const openSnap = await db.collection('challenges')
      .where('status', 'in', ['pending', 'active'])
      .get();

    if (openSnap.empty) {
      console.log('[expireChallenges] nothing open');
      return;
    }

    await Promise.all(openSnap.docs.map(async (doc) => {
      try {
        await db.runTransaction(async (tx) => {
          const fresh = await tx.get(doc.ref);
          if (!fresh.exists) return;
          const data = fresh.data();
          if (data.status !== 'pending' && data.status !== 'active') return;

          const overallExpiredMs = data.expiresAt ? new Date(data.expiresAt).getTime() : 0;
          const overallExpired = overallExpiredMs && overallExpiredMs < nowMs;

          // Pending challenges have a hard accept window (respondByAt = createdAt + 8h).
          // Falls back to expiresAt for legacy challenges that don't have respondByAt.
          const respondByMs = data.respondByAt ? new Date(data.respondByAt).getTime() : overallExpiredMs;
          const respondByExpired = respondByMs && respondByMs < nowMs;

          // Legacy 1v1 path (no participants map)
          if (!data.participants) {
            if (data.status === 'pending') {
              if (!respondByExpired) return;
              tx.update(doc.ref, {
                status: 'accept_expired',
                friendStatus: 'accept_expired',
                resolvedAt: nowIso,
                expiredReason: 'accept_window_timeout',
              });
            } else {
              if (!overallExpired) return;
              tx.update(doc.ref, {
                status: 'expired',
                friendStatus: 'expired',
                resolvedAt: nowIso,
              });
              if (data.friendUid) {
                tx.set(db.collection('users').doc(data.friendUid), {
                  challengeStats: { losses: FieldValue.increment(1), currentWinStreak: 0 },
                }, { merge: true });
              }
            }
            return;
          }

          // Phase 3 path: iterate participants
          const participantUpdates = {};
          const lossUpdates = []; // {uid, isLoss}

          for (const [uid, p] of Object.entries(data.participants)) {
            if (p.status === 'pending' && respondByExpired) {
              participantUpdates[`participants.${uid}.status`] = 'cancelled';
              participantUpdates[`participants.${uid}.resolvedAt`] = nowIso;
            } else if (p.status === 'accepted' && overallExpired) {
              participantUpdates[`participants.${uid}.status`] = 'expired';
              participantUpdates[`participants.${uid}.resolvedAt`] = nowIso;
              lossUpdates.push({ uid, isLoss: true });
            }
          }

          // Decide overall status: all participants must be in a terminal state to flip overall.
          // Build a "what-will-it-be" view by overlaying participantUpdates onto current.
          const finalParticipantStatuses = {};
          for (const [uid, p] of Object.entries(data.participants)) {
            const overrideStatus = participantUpdates[`participants.${uid}.status`];
            finalParticipantStatuses[uid] = overrideStatus || p.status;
          }
          const stillOpen = Object.values(finalParticipantStatuses).some(s => s === 'pending' || s === 'accepted');
          const anyCompleted = Object.values(finalParticipantStatuses).some(s => s === 'completed');
          const anyAccepted = Object.values(finalParticipantStatuses).some(s => s === 'accepted' || s === 'completed' || s === 'expired');

          if (!stillOpen) {
            // Distinguish "no one ever accepted" (accept_expired — silent for accepters,
            // notify challenger) from "accepted but didn't finish" (expired — counts as loss).
            participantUpdates.status = anyCompleted
              ? 'completed'
              : (anyAccepted ? 'expired' : 'accept_expired');
            participantUpdates.resolvedAt = nowIso;
            // Mirror onto legacy friendStatus for 1v1 so client buckets reflect it.
            if (data.friendUid && participantUpdates[`participants.${data.friendUid}.status`]) {
              participantUpdates.friendStatus = participantUpdates[`participants.${data.friendUid}.status`];
            }
          }

          if (Object.keys(participantUpdates).length === 0 && lossUpdates.length === 0) return;

          if (Object.keys(participantUpdates).length > 0) {
            tx.update(doc.ref, participantUpdates);
          }

          // Apply per-participant losses (server-only counters)
          for (const { uid } of lossUpdates) {
            tx.set(db.collection('users').doc(uid), {
              challengeStats: { losses: FieldValue.increment(1), currentWinStreak: 0 },
            }, { merge: true });
          }
        });
      } catch (err) {
        console.error(`[expireChallenges] failed to expire ${doc.id}:`, err);
      }
    }));
  }
);

/**
 * Cron: every 30 minutes, ping participants when their personal challenge clock has
 * ~45-75 minutes left. Uses an `expiringSoonNotified` flag per-participant (groups)
 * or on the doc (legacy 1v1) to ensure exactly-once delivery.
 */
exports.challengeExpiringSoon = onSchedule(
  { schedule: 'every 30 minutes', timeZone: 'UTC' },
  async () => {
    const now = Date.now();
    const windowStartMs = now + 45 * 60 * 1000;
    const windowEndMs = now + 75 * 60 * 1000;

    const snap = await db.collection('challenges')
      .where('status', '==', 'active')
      .get();

    if (snap.empty) return;

    await Promise.all(snap.docs.map(async (doc) => {
      const data = doc.data();
      try {
        const challengerName = data.challengerName || await getUserDisplayName(data.challengerUid);

        // Phase 3 path: per-participant. Timer is now shared (overall expiresAt) so the
        // window-check is the same for everyone, but we still gate on per-participant
        // notification flag so each accepter gets their own ping (skipping decliners).
        if (data.participants) {
          const overallMs = data.expiresAt ? new Date(data.expiresAt).getTime() : 0;
          if (overallMs < windowStartMs || overallMs > windowEndMs) return;

          const updates = {};
          const recipientsToNotify = [];

          for (const [uid, p] of Object.entries(data.participants)) {
            if (p.status !== 'accepted') continue;
            if (p.expiringSoonNotified) continue;
            updates[`participants.${uid}.expiringSoonNotified`] = true;
            recipientsToNotify.push(uid);
          }

          if (recipientsToNotify.length === 0) return;

          await Promise.all(recipientsToNotify.map(async (uid) => {
            const prefs = await getUserPreferences(uid);
            if (!prefs.challengeExpiring) return;
            await sendNotificationToUser(
              uid,
              'Challenge Ending Soon ⏰',
              `~1h left on ${challengerName}'s challenge.`,
              {
                type: NotificationType.CHALLENGE_EXPIRING,
                fromUserId: data.challengerUid,
                challengeId: doc.id,
              }
            );
          }));

          await doc.ref.update(updates);
          return;
        }

        // Legacy 1v1 path
        if (data.expiringSoonNotified) return;
        const overallMs = data.expiresAt ? new Date(data.expiresAt).getTime() : 0;
        if (overallMs < windowStartMs || overallMs > windowEndMs) return;
        if (!data.friendUid) return;

        const prefs = await getUserPreferences(data.friendUid);
        if (!prefs.challengeExpiring) return;

        await sendNotificationToUser(
          data.friendUid,
          'Challenge Ending Soon ⏰',
          `~1h left on ${challengerName}'s challenge.`,
          {
            type: NotificationType.CHALLENGE_EXPIRING,
            fromUserId: data.challengerUid,
            challengeId: doc.id,
          }
        );

        await doc.ref.update({ expiringSoonNotified: true });
      } catch (err) {
        console.error(`[challengeExpiringSoon] failed for ${doc.id}:`, err);
      }
    }));
  }
);

/**
 * One-time migration: rebuilds `challengeStats` on every user doc from the authoritative
 * `challenges/*` collection, and strips the legacy `h2hRecords` field. Idempotent — safe
 * to run multiple times; always derives from challenge docs.
 *
 * New scoring model (applied here):
 *  - Only accepters score. Challenger never gets wins/losses for sending.
 *  - `accepted` = total challenges this user accepted (denominator for completion rate).
 *  - `wins` = accepted-and-completed.
 *  - `losses` = accepted-but-expired.
 *  - Streaks are recomputed chronologically from the same events.
 *
 * Gate: requires a Firebase Auth custom claim `admin: true` on the caller. Set via:
 *   admin.auth().setCustomUserClaims(<uid>, { admin: true })
 */
/**
 * Apply a user's choice of which challenge(s) to fulfill with a given activity.
 * Used by the chooser modal that's surfaced when an activity matched multiple
 * active challenges and the trigger deferred fulfillment.
 *
 * Validates that:
 *  - Caller owns the activity (it lives in their users/{uid} doc).
 *  - Each chosen challengeId is currently active and the caller's status is 'accepted'.
 *  - The activity actually matches that challenge's matchRule.
 *
 * Stamps `intendedChallengeIds` onto the activity (so the cloud function record stays consistent
 * for the badge/threading) and runs the same fulfillment transaction the trigger would have.
 */
exports.applyChallengeIntent = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign-in required.');
  }
  const userId = request.auth.uid;
  const { activityId, challengeIds, message } = request.data || {};
  if (!activityId || !Array.isArray(challengeIds) || challengeIds.length === 0) {
    throw new HttpsError('invalid-argument', 'activityId and non-empty challengeIds required.');
  }
  const wantedIds = challengeIds.map(String);
  // Caller's optional message (trimmed + capped by fulfillChallengeForUser too — belt + suspenders).
  const callerMessage = (typeof message === 'string' && message.trim())
    ? message.trim().slice(0, 140)
    : null;

  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new HttpsError('not-found', 'User doc missing.');
  }
  const activities = userSnap.data()?.activities || [];
  const activity = activities.find(a => String(a.id) === String(activityId));
  if (!activity) {
    throw new HttpsError('not-found', 'Activity not found on this user.');
  }

  // Stamp intendedChallengeIds on the activity (additive — preserves any prior intent)
  // so the friend feed badge logic and any future threading reads stay coherent.
  const existingIntent = Array.isArray(activity.intendedChallengeIds)
    ? activity.intendedChallengeIds.map(String)
    : [];
  const mergedIntent = Array.from(new Set([...existingIntent, ...wantedIds]));
  const updatedActivities = activities.map(a => (
    String(a.id) === String(activityId) ? { ...a, intendedChallengeIds: mergedIntent } : a
  ));
  await userRef.set({ activities: updatedActivities }, { merge: true });

  console.log('[applyChallengeIntent] start', {
    userId,
    activityId: String(activityId),
    activityType: activity.type,
    activityCategory: getActivityCategoryForGoals(activity),
    activityHasPhoto: !!activity.photoURL,
    challengeIds: wantedIds,
  });

  // Run fulfillment per chosen challenge, validating eligibility along the way.
  const results = [];
  for (const challengeId of wantedIds) {
    try {
      const challengeRef = db.collection('challenges').doc(challengeId);
      const challengeSnap = await challengeRef.get();
      if (!challengeSnap.exists) {
        console.warn('[applyChallengeIntent] not_found', { challengeId });
        results.push({ challengeId, fulfilled: false, reason: 'not_found' });
        continue;
      }
      const challenge = challengeSnap.data();
      if (challenge.status !== 'active') {
        console.warn('[applyChallengeIntent] not_active', { challengeId, status: challenge.status });
        results.push({ challengeId, fulfilled: false, reason: 'not_active' });
        continue;
      }
      const myStatus = challenge.participants?.[userId]?.status
        || (challenge.friendUid === userId ? challenge.friendStatus : null);
      if (myStatus !== 'accepted') {
        console.warn('[applyChallengeIntent] not_accepted', { challengeId, myStatus });
        results.push({ challengeId, fulfilled: false, reason: 'not_accepted' });
        continue;
      }
      if (!activityMatchesRule(activity, challenge.matchRule)) {
        console.warn('[applyChallengeIntent] no_match', {
          challengeId,
          matchRule: challenge.matchRule,
          activityCategory: getActivityCategoryForGoals(activity),
          activityType: activity.type,
          activityDuration: activity.duration,
          activityDistance: activity.distance,
        });
        results.push({ challengeId, fulfilled: false, reason: 'no_match' });
        continue;
      }

      const outcome = await fulfillChallengeForUser({
        userId,
        challengeDocRef: challengeRef,
        challenge,
        matched: activity,
        message: callerMessage || activity.challengeMessage || null,
      });
      console.log('[applyChallengeIntent] outcome', { challengeId, outcome });
      results.push({ challengeId, ...outcome });
    } catch (err) {
      console.error('[applyChallengeIntent] failed for', challengeId, err);
      results.push({ challengeId, fulfilled: false, reason: 'error' });
    }
  }

  return { results };
});

exports.backfillChallengeStats = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign-in required.');
  }
  if (!request.auth.token?.admin) {
    throw new HttpsError('permission-denied', 'Admin only.');
  }

  console.log('[backfillChallengeStats] started by', request.auth.uid);

  const challengesSnap = await db.collection('challenges').get();
  console.log(`[backfillChallengeStats] processing ${challengesSnap.size} challenges`);

  // Build per-user resolution events from challenge docs.
  const perUser = new Map(); // uid -> { accepted, events: [{type, at}] }
  const recordFor = (uid) => {
    if (!uid) return null;
    let rec = perUser.get(uid);
    if (!rec) { rec = { accepted: 0, events: [] }; perUser.set(uid, rec); }
    return rec;
  };

  // A participant counts as having accepted if their final status is one of these.
  // pending/declined/cancelled mean they never accepted.
  const ACCEPTED_STATUSES = new Set(['accepted', 'completed', 'expired']);

  for (const doc of challengesSnap.docs) {
    const c = doc.data();

    // Phase 3: participants map
    if (c.participants && typeof c.participants === 'object') {
      for (const [uid, p] of Object.entries(c.participants)) {
        if (!p || !ACCEPTED_STATUSES.has(p.status)) continue;
        const rec = recordFor(uid);
        rec.accepted += 1;
        if (p.status === 'completed') {
          const at = p.completedAt || p.resolvedAt || c.completedAt || c.resolvedAt || c.createdAt;
          rec.events.push({ type: 'win', at: at ? new Date(at) : new Date(0) });
        } else if (p.status === 'expired') {
          const at = p.resolvedAt || c.resolvedAt || c.expiresAt;
          rec.events.push({ type: 'loss', at: at ? new Date(at) : new Date(0) });
        }
      }
      continue;
    }

    // Legacy 1v1: friendUid + friendStatus
    if (c.friendUid && ACCEPTED_STATUSES.has(c.friendStatus)) {
      const rec = recordFor(c.friendUid);
      rec.accepted += 1;
      if (c.friendStatus === 'completed') {
        const at = c.completedAt || c.resolvedAt || c.createdAt;
        rec.events.push({ type: 'win', at: at ? new Date(at) : new Date(0) });
      } else if (c.friendStatus === 'expired') {
        const at = c.resolvedAt || c.expiresAt;
        rec.events.push({ type: 'loss', at: at ? new Date(at) : new Date(0) });
      }
    }
  }

  // Derive final stats per user (wins, losses, streaks).
  const finalStats = new Map();
  for (const [uid, rec] of perUser.entries()) {
    rec.events.sort((a, b) => a.at.getTime() - b.at.getTime());
    let wins = 0, losses = 0, currentWinStreak = 0, longestWinStreak = 0;
    for (const e of rec.events) {
      if (e.type === 'win') {
        wins += 1;
        currentWinStreak += 1;
        if (currentWinStreak > longestWinStreak) longestWinStreak = currentWinStreak;
      } else {
        losses += 1;
        currentWinStreak = 0;
      }
    }
    finalStats.set(uid, { accepted: rec.accepted, wins, losses, currentWinStreak, longestWinStreak });
  }

  // Write: one update per user doc. `update()` fully replaces `challengeStats` (no deep
  // merge) and deletes `h2hRecords`. Users with no challenge history get zeroed stats
  // so the schema is uniform across the collection.
  const usersSnap = await db.collection('users').get();
  const ZERO = { accepted: 0, wins: 0, losses: 0, currentWinStreak: 0, longestWinStreak: 0 };
  let batch = db.batch();
  let pending = 0;
  let written = 0;
  const MAX_BATCH = 400;

  for (const userDoc of usersSnap.docs) {
    const stats = finalStats.get(userDoc.id) || ZERO;
    batch.update(userDoc.ref, {
      challengeStats: stats,
      h2hRecords: FieldValue.delete(),
    });
    pending += 1;
    if (pending >= MAX_BATCH) {
      await batch.commit();
      written += pending;
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) {
    await batch.commit();
    written += pending;
  }

  const result = {
    success: true,
    challengesProcessed: challengesSnap.size,
    usersUpdated: written,
    usersWithChallengeHistory: perUser.size,
  };
  console.log('[backfillChallengeStats] done:', result);
  return result;
});
