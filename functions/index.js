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
const { getPlannedCategoriesForToday, buildPlannedReminderMessage } = require("./plannerReminders");
const { resolveUid, isStale, subscriptionFromEvent, transferUpdates } = require("./subscriptionEvents");

// Initialize Firebase Admin
initializeApp();

const db = getFirestore();
const messaging = getMessaging();

// Shared secret guarding the RevenueCat webhook. Set it with:
//   firebase functions:secrets:set REVENUECAT_WEBHOOK_SECRET
const revenueCatWebhookSecret = defineSecret("REVENUECAT_WEBHOOK_SECRET");

// APNs auth key (.p8 contents) and its key ID, for Live Activity pushes. They used to be a
// .p8 file committed under functions/apns/, which a public repo exposes. Set them with:
//   firebase functions:secrets:set APNS_AUTH_KEY --data-file AuthKey_<KEYID>.p8
//   firebase functions:secrets:set APNS_KEY_ID
const apnsAuthKey = defineSecret("APNS_AUTH_KEY");
const apnsKeyId = defineSecret("APNS_KEY_ID");

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

// APNs configuration (the key and key ID come from Secret Manager, see apnsAuthKey above)
const APNS_TEAM_ID = "J4CL5KMB23";
const APNS_TOPIC = "app.dayseven.fitness.push-type.liveactivity";

// Cache the APNs key and JWT
let apnsKeyCache = null;
let apnsJwtCache = null;
let apnsJwtExpiry = 0;

function getApnsKey() {
  if (!apnsKeyCache) {
    apnsKeyCache = apnsAuthKey.value();
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
    header: { alg: "ES256", kid: apnsKeyId.value().trim() },
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
exports.startLiveActivityPush = onRequest({ secrets: [apnsAuthKey, apnsKeyId] }, async (req, res) => {
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
  PLAN_WEEK_REMINDER: 'plan_week_reminder',
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
  // The small mirrored profile first: the user doc carries the whole activity history.
  const pub = await db.collection('publicProfiles').doc(userId).get();
  const profile = pub.exists ? pub.data() : (await db.collection('users').doc(userId).get()).data();
  const name = profile?.displayName || profile?.username || 'Someone';
  return String(name).slice(0, 40); // push text; Settings caps names at 40
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
  // Keep this table in sync with src/utils/activityCategory.js (the client's single source
  // of truth). Note Circuit resolves to 'lifting' here but 'lifting+cardio' on the client.
  if (['Strength Training', 'Weightlifting', 'Bodyweight', 'Circuit'].includes(type)) return 'lifting';
  if (['Running', 'Cycle', 'Sports', 'Stair Climbing', 'Elliptical', 'Ski Trainer'].includes(type)) return 'cardio';
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
  if (['Pilates', 'Stretching', 'Foam Rolling', 'Cold Plunge', 'Sauna', 'Contrast Therapy',
    'Massage', 'Chiropractic', 'Tai Chi', 'Cooldown'].includes(type)) return 'recovery';
  if (['Swimming', 'Rowing', 'Hiking', 'Dance'].includes(type)) return 'cardio';
  return null;
}

// ==========================================
// WEEK RULE — mirrors src/utils/weekGoals.js (keep in sync)
// ==========================================
//
// The Winning Streak rule is per user and per week:
//   • before the user's `winningRuleFrom` week (or with no such field — an app version
//     that predates the steps rule): Strength + Cardio + Recovery
//   • from that week on: Strength + Cardio + weekly Steps (stepsPerDay × 7), or Strength +
//     Cardio when the user has no step data in the last four weeks (no Apple Health).
// Daily steps come from users/{uid}/dailyHealth, which the app backfills from HealthKit
// for this week and last week whenever it opens.

const addDaysToDateStr = (dateStr, days) => {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
};

/** Goal-slot counts; a Circuit / 'lifting+cardio' session fills both, as on the client. */
function countWeekForGoals(activities) {
  const counts = { lifts: 0, cardio: 0, recovery: 0 };
  (activities || []).forEach((a) => {
    const dual = a.countToward === 'lifting+cardio' || a.customActivityCategory === 'lifting+cardio' ||
      (!a.countToward && !a.customActivityCategory && a.type === 'Circuit');
    if (dual) { counts.lifts++; counts.cardio++; return; }
    const cat = getActivityCategoryForGoals(a);
    if (cat === 'lifting') counts.lifts++;
    else if (cat === 'cardio') counts.cardio++;
    else if (cat === 'recovery') counts.recovery++;
  });
  return counts;
}

/**
 * Judge the week starting `weekStartStr` (a Sunday, 'YYYY-MM-DD') for a user.
 * @returns {{ counts, steps, stepsGoal, goals, stepsRule, required: string[],
 *             met: {lifts,cardio,recovery,steps}, all: boolean }}
 */
async function judgeUserWeek(userId, userData, weekStartStr) {
  const g = userData.goals || {};
  const goals = {
    lifts: g.liftsPerWeek ?? 3,
    cardio: g.cardioPerWeek ?? 2,
    recovery: g.recoveryPerWeek ?? 2,
    stepsPerDay: g.stepsPerDay ?? 10000,
  };
  const weekEndStr = addDaysToDateStr(weekStartStr, 6);
  const counts = countWeekForGoals((userData.activities || []).filter((a) => a.date >= weekStartStr && a.date <= weekEndStr));
  const stepsRule = !!userData.winningRuleFrom && weekStartStr >= userData.winningRuleFrom;

  let steps = 0;
  let stepsTracked = false;
  if (stepsRule) {
    const snap = await db.collection('users').doc(userId).collection('dailyHealth')
      .where('date', '>=', addDaysToDateStr(weekEndStr, -27)).get();
    snap.forEach((doc) => {
      const d = doc.data() || {};
      if (!d.date || d.date > weekEndStr) return;
      if ((d.steps || 0) > 0) stepsTracked = true;
      if (d.date >= weekStartStr) steps += d.steps || 0;
    });
  }

  const stepsGoal = goals.stepsPerDay * 7;
  const met = {
    lifts: counts.lifts >= goals.lifts,
    cardio: counts.cardio >= goals.cardio,
    recovery: counts.recovery >= goals.recovery,
    steps: steps >= stepsGoal,
  };
  const required = !stepsRule ? ['lifts', 'cardio', 'recovery'] : stepsTracked ? ['lifts', 'cardio', 'steps'] : ['lifts', 'cardio'];
  return { counts, steps, stepsGoal, goals, stepsRule, required, met, all: required.every((c) => met[c]) };
}

const formatStepsK = (n) => `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;

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
    // Off unless saved: accounts created from Oct 2026 get `dailyReminders: true` written at
    // creation (protectUserFields); older accounts that never chose stay off.
    dailyReminders: false,
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

    // A deleted account's tokens can outlive it (and the device may now belong to a new
    // account). Never push for an account that no longer exists; drop its tokens instead.
    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      await db.collection('userTokens').doc(userId).delete().catch(() => {});
      return { success: false, reason: 'no_user' };
    }
    const preferences = { ...getDefaultPreferences(), ...(userSnap.data().notificationPreferences || {}) };

    // Check quiet hours
    if (isQuietHours(preferences) && !options.ignoreQuietHours) {
      return { success: false, reason: 'quiet_hours' };
    }

    // Increment unread badge count in Firestore for accurate app icon badge.
    // If this is a social notification, also increment unreadFeedCount (for in-app red dot).
    // update(), not a merge set: a merge set would recreate the doc if the account was
    // deleted a moment ago.
    const socialTypes = ['reaction', 'comment', 'reply', 'friend_request', 'friend_accepted', 'friend_workout'];
    await userRef.update({
      unreadBadgeCount: FieldValue.increment(1),
      ...(socialTypes.includes(data.type) ? { unreadFeedCount: FieldValue.increment(1) } : {}),
    });

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

// How long after a friend request is accepted its friend docs may still appear. The app
// writes them right after accepting; the window allows for a slow network.
const FRIEND_DOC_WINDOW_MS = 15 * 60 * 1000;

/**
 * Whether an accepted friend request between the pair backs a friend doc created at
 * `createdMs` (a minute of slack for a request accepted in the same instant).
 */
function friendDocIsBacked(requests, createdMs) {
  return requests.some((r) => r.status === 'accepted'
    && r.updatedMs <= createdMs + 60 * 1000
    && createdMs - r.updatedMs <= FRIEND_DOC_WINDOW_MS);
}

/**
 * Remove friend docs that no friend request backs, so a friends list only ever holds
 * friendships someone accepted. App versions up to 1.8.3 write the two friend docs one at
 * a time after accepting, which the transitional rules can't tie to a request; this checks
 * them after the fact. The strict rules only allow friend docs written in the accepting
 * batch, so under them this never finds anything to remove.
 *
 * A friend doc is kept when a request between the two users was accepted within
 * FRIEND_DOC_WINDOW_MS of the doc's creation, so an old accepted request can't back a
 * friend doc written long after a friendship ended.
 */
exports.validateFriendDoc = onDocumentCreated(
  'users/{userId}/friends/{friendId}',
  async (event) => {
    const { userId, friendId } = event.params;
    const createdMs = new Date(event.data.createTime?.toDate?.() || event.time).getTime();
    const between = (from, to) => db.collection('friendRequests')
      .where('fromUid', '==', from).where('toUid', '==', to).get();
    const [a, b] = await Promise.all([between(userId, friendId), between(friendId, userId)]);
    const requests = [...a.docs, ...b.docs].map((d) => ({
      status: d.data().status,
      updatedMs: d.updateTime.toDate().getTime(),
    }));
    if (friendDocIsBacked(requests, createdMs)) return;

    console.warn(`[validateFriendDoc] removing unbacked friend doc users/${userId}/friends/${friendId}`);
    await event.data.ref.delete();
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

    // Reactions are keyed by the reactor's uid (the rules enforce it for new writes).
    if (!reactorId || reactorId !== event.params.reactionId) return;

    // Don't notify yourself
    if (ownerId === reactorId) return;

    const prefs = await getUserPreferences(ownerId);
    if (!prefs.reactions) return;

    // The name comes from the reactor's profile, never from the client-written reaction.
    const reactorName = await getUserDisplayName(reactorId);

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

    // The name comes from the commenter's profile, never from the client-written comment.
    const commenterName = await getUserDisplayName(commenterId);
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

    // The name comes from the replier's profile, never from the client-written reply.
    const replierName = await getUserDisplayName(replierId);
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

// Fields every hourly users-scan reads to decide who is due. The rest of a user doc — mostly
// the activity history — is read only for the few users who pass those checks.
const ACCESS_FIELDS = ['subscriptionRequired', 'forceProTier', 'subscription', 'notificationPreferences'];

// Schedule options for the hourly users-scans (the 60 s / 256 MiB default doesn't scale).
const HOURLY_USER_SCAN = { schedule: '0 * * * *', timeZone: 'UTC', timeoutSeconds: 540, memory: '512MiB' };

/** Notification preferences from an already-read user doc (same result as getUserPreferences). */
function prefsOf(userData) {
  return { ...getDefaultPreferences(), ...(userData.notificationPreferences || {}) };
}

/** The whole user doc, for a user who passed a job's cheap checks. */
async function readFullUser(userId) {
  const snap = await db.collection('users').doc(userId).get();
  return snap.exists ? snap.data() : null;
}

/**
 * Run `fn(doc)` over `docs`, `limit` at a time. One user's failure is logged and the rest
 * carry on (a single throw used to end the whole run).
 */
async function forEachLimited(docs, label, fn, limit = 10) {
  let next = 0;
  const worker = async () => {
    while (next < docs.length) {
      const doc = docs[next++];
      try {
        await fn(doc);
      } catch (err) {
        console.error(`[${label}] failed for ${doc.id}:`, err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, docs.length) }, worker));
}

/** 'YYYY-MM-01' of the month before the one containing `dateStr` ('YYYY-MM-DD'). */
const monthStartBefore = (dateStr) => {
  const [y, m] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().split('T')[0];
};


/**
 * Streak reminder - runs every day at 8 PM
 * Only reminds users who haven't logged activity in 48+ hours
 * Activities are stored as arrays in users/{uid} documents
 */
exports.sendStreakReminders = onSchedule(
  HOURLY_USER_SCAN, // hourly; fires at 8 PM in each user's local timezone
  async () => {

    // Get users with active streaks who want reminders
    const usersSnapshot = await db.collection('users')
      .where('streaks.master', '>', 0)
      .select(...ACCESS_FIELDS, 'streaks', 'vacationMode', 'injuryMode')
      .get();

    await forEachLimited(usersSnapshot.docs, 'sendStreakReminders', async (userDoc) => {
      const userId = userDoc.id;
      const userData = userDoc.data();

      // No app access (locked out / lapsed) → win-back owns them; stay silent here.
      if (!hasAppAccess(userData)) return;

      // Fire at 8 PM in the USER's local timezone (hourly job, gated per user).
      const { time: localTime, dateStr: localToday } = getUserLocalTime(userData.notificationPreferences?.timezone);
      if (localTime !== '20:00') return;

      // Skip users on vacation or injury mode (streak is frozen — don't nag)
      if (userData.vacationMode?.isActive) return;
      if (userData.injuryMode?.isActive) return;

      if (!prefsOf(userData).streakReminders) return;

      // Check if they've logged any activity in the last 48 hours (their local dates)
      // Activities are stored as an array in the user document
      const twoDaysAgoStr = addDaysToDateStr(localToday, -2);
      const activities = (await readFullUser(userId))?.activities || [];
      const hasRecentActivity = activities.some(a => a.date >= twoDaysAgoStr);

      if (hasRecentActivity) return; // Has recent activity, skip

      await sendNotificationToUser(
        userId,
        'Missing You! 👋',
        `It's been a couple days. Your ${userData.streaks.master}-week Winning Streak is waiting for you!`,
        {
          type: NotificationType.STREAK_REMINDER,
          streak: userData.streaks.master.toString(),
        }
      );
    });
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
  HOURLY_USER_SCAN, // Every hour on the hour
  async () => {

    // Get all users and check their notificationPreferences field
    const usersSnapshot = await db.collection('users')
      .select(...ACCESS_FIELDS, 'injuryMode', 'goals', 'weeklyPlan')
      .get();

    await forEachLimited(usersSnapshot.docs, 'sendDailyReminders', async (userDoc) => {
      const userId = userDoc.id;
      const userData = userDoc.data();
      const prefs = userData.notificationPreferences;

      // No app access (locked out / lapsed) → win-back owns them; stay silent here.
      if (!hasAppAccess(userData)) return;

      // Skip users healing — injury mode softens the "time to move" nudge
      if (userData.injuryMode?.isActive) return;

      // Only users with daily reminders saved on: their own choice, or switched on when the
      // account was created (protectUserFields, from Oct 2026). Older accounts that never
      // chose stay off.
      if (!prefs || !prefs.dailyReminders) return;

      const reminderTime = prefs.dailyReminderTime || '09:00';
      const { time: userLocalTime, dateStr: userToday, dayOfWeek } = getUserLocalTime(prefs.timezone);

      if (reminderTime !== userLocalTime) return;

      // Sunday: nudge users who haven't planned this week to set it up. Fires at
      // the user's normal reminder time (so it never double-sends alongside the
      // daily nudge) and takes priority over it. Skips users whose plan repeats
      // weekly or who already planned this week, and users with no goals set.
      if (dayOfWeek === 0) {
        const g = userData.goals || {};
        const totalGoal = (g.liftsPerWeek || 0) + (g.cardioPerWeek || 0) + (g.recoveryPerWeek || 0);
        const wp = userData.weeklyPlan;
        // On Sunday, the current week's key IS today's date.
        const alreadyPlanned = !!(wp && (wp.repeatWeekly || (wp.weeks && wp.weeks[userToday])));
        if (totalGoal > 0 && !alreadyPlanned) {
          await sendNotificationToUser(
            userId,
            'Plan your week 🗓️',
            "Drop your sessions on the days you'll train and we'll keep you on track.",
            { type: NotificationType.PLAN_WEEK_REMINDER }
          );
          return;
        }
      }

      // Categories already satisfied today (in the user's timezone).
      // Activities are stored as an array in the user document.
      const activities = (await readFullUser(userId))?.activities || [];
      const doneToday = { strength: 0, cardio: 0, recovery: 0 };
      let loggedAnythingToday = false;
      for (const a of activities) {
        if (a.date !== userToday) continue;
        loggedAnythingToday = true;
        const c = getActivityCategoryForGoals(a);
        if (c === 'lifting') doneToday.strength++;
        else if (c === 'cardio') doneToday.cardio++;
        else if (c === 'recovery') doneToday.recovery++;
      }

      // If the user has a weekly plan, make the nudge specific to today's plan.
      const todayPlan = getPlannedCategoriesForToday(userData.weeklyPlan, userToday, dayOfWeek);
      if (todayPlan) {
        if (todayPlan.length === 0) return; // planned rest day — respect it, no nudge

        // Collect each planned session's type per category (keeps duplicates,
        // so two cardio sessions are counted as two).
        const byCat = { strength: [], cardio: [], recovery: [] };
        for (const p of todayPlan) {
          if (byCat[p.cat]) byCat[p.cat].push(p.type || null);
        }
        const anyUnmet = ['strength', 'cardio', 'recovery']
          .some((c) => byCat[c].length > (doneToday[c] || 0));
        if (!anyUnmet) return; // everything planned for today is already done

        const msg = buildPlannedReminderMessage(byCat, doneToday);
        if (!msg) return;
        await sendNotificationToUser(userId, msg.title, msg.body, { type: NotificationType.DAILY_REMINDER });
        return;
      }

      // No plan this week → generic nudge, only if nothing logged yet today.
      if (loggedAnythingToday) return;

      await sendNotificationToUser(
        userId,
        'Time to Move!',
        'Ready for today\'s workout? Your body will thank you.',
        {
          type: NotificationType.DAILY_REMINDER,
        }
      );
    });
  }
);

/**
 * End of week goal reminder - runs every hour, sends at 8 AM Thursday in each user's timezone
 * Reminds users what they need to hit their weekly goals
 * Activities are stored as arrays in users/{uid} documents
 * Uses the 'countToward' field for category (strength/cardio/recovery)
 */
exports.sendGoalReminder = onSchedule(
  HOURLY_USER_SCAN, // Every hour on the hour
  async () => {

    const usersSnapshot = await db.collection('users')
      .select(...ACCESS_FIELDS, 'vacationMode', 'injuryMode')
      .get();

    await forEachLimited(usersSnapshot.docs, 'sendGoalReminder', async (userDoc) => {
      const userId = userDoc.id;
      const userData = userDoc.data();

      // No app access (locked out / lapsed) → win-back owns them; stay silent here.
      if (!hasAppAccess(userData)) return;

      // Skip users on vacation or injury mode (streak is frozen — don't nag)
      if (userData.vacationMode?.isActive) return;
      if (userData.injuryMode?.isActive) return;

      const prefs = prefsOf(userData);
      if (!prefs.goalReminders) return;

      // Check if it's 8 AM Thursday in the user's timezone
      const { time: userLocalTime, dateStr: userToday, dayOfWeek } = getUserLocalTime(prefs.timezone);
      if (dayOfWeek !== 4 || userLocalTime !== '08:00') return;

      // Start of the current week (Sunday) in the user's local timezone
      const weekStartStr = addDaysToDateStr(userToday, -dayOfWeek);

      // This week so far, judged by the user's Winning Streak rule (judgeUserWeek).
      const fullData = await readFullUser(userId);
      if (!fullData) return;
      const week = await judgeUserWeek(userId, fullData, weekStartStr);
      const { counts, goals } = week;
      const daysLeft = 7 - dayOfWeek; // Days until end of week (Saturday)

      if (week.all) {
        await sendNotificationToUser(
          userId,
          'Week Won Early! 🏆',
          week.stepsRule
            ? `Strength, cardio and steps are done with ${daysLeft} days to spare. Everything from here is extra.`
            : `You've hit all your goals this week with ${daysLeft} days to spare. Amazing!`,
          {
            type: NotificationType.GOAL_REMINDER,
            allGoalsMet: 'true',
          }
        );
        return;
      }

      // What's left for the Winning Streak (recovery only under the original rule)
      const remainingFor = {
        lifts: Math.max(0, goals.lifts - counts.lifts),
        cardio: Math.max(0, goals.cardio - counts.cardio),
        recovery: Math.max(0, goals.recovery - counts.recovery),
        steps: Math.max(0, week.stepsGoal - week.steps),
      };
      const label = { lifts: 'strength', cardio: 'cardio', recovery: 'recovery' };

      // By Thursday the steps goal is almost never met yet, so "0/3 goals" undersells the
      // week. Count sessions instead (capped per category, so extra cardio can't stand in
      // for a missing lift) and turn the step gap into a per-day pace for Thu–Sat.
      const sessionCats = week.required.filter((c) => c !== 'steps');
      const sessionsGoal = sessionCats.reduce((n, c) => n + goals[c], 0);
      const sessionsDone = sessionCats.reduce((n, c) => n + Math.min(counts[c], goals[c]), 0);
      const sessionsLeft = sessionCats
        .filter((c) => !week.met[c])
        .map((c) => `${remainingFor[c]} ${label[c]}`)
        .join(' + ');
      const stepsLeft = week.required.includes('steps') && !week.met.steps;
      const stepsPerDay = Math.ceil(remainingFor.steps / daysLeft / 100) * 100;
      const stepsStr = `${formatStepsK(stepsPerDay)} steps a day`;

      let body;
      if (sessionsLeft && stepsLeft) {
        body = `Still need ${sessionsLeft}, plus ${stepsStr} through Saturday to win the week. 💪`;
      } else if (stepsLeft) {
        body = `Workouts are done — just ${stepsStr} through Saturday to win the week. 👟`;
      } else if (week.required.includes('steps')) {
        body = `Steps are covered — still need ${sessionsLeft} to win the week. ${daysLeft} days left! 💪`;
      } else {
        body = `Still need ${sessionsLeft} to win the week — ${daysLeft} days left! 💪`;
      }

      await sendNotificationToUser(
        userId,
        `${sessionsDone}/${sessionsGoal} Workouts Done — ${daysLeft} Days Left`,
        body,
        {
          type: NotificationType.GOAL_REMINDER,
          strengthRemaining: remainingFor.lifts.toString(),
          cardioRemaining: remainingFor.cardio.toString(),
          recoveryRemaining: (week.stepsRule ? 0 : remainingFor.recovery).toString(),
          stepsRemaining: (week.stepsRule ? remainingFor.steps : 0).toString(),
          daysLeft: daysLeft.toString(),
        }
      );
    });
  }
);


/**
 * Weekly summary - runs every Sunday at 10 AM
 * Shows "You crushed your week!" if all category goals were met
 * Activities are stored as arrays in users/{uid} documents
 */
exports.sendWeeklySummary = onSchedule(
  HOURLY_USER_SCAN, // hourly; fires Sunday 10 AM in each user's local timezone
  async () => {

    const usersSnapshot = await db.collection('users')
      .select(...ACCESS_FIELDS, 'injuryMode')
      .get();

    await forEachLimited(usersSnapshot.docs, 'sendWeeklySummary', async (userDoc) => {
      const userId = userDoc.id;
      const gate = userDoc.data();

      // No app access (locked out / lapsed) → win-back owns them; stay silent here.
      if (!hasAppAccess(gate)) return;

      // Fire Sunday 10 AM in the USER's local timezone (hourly job, gated per user).
      const { time: localTime, dayOfWeek, dateStr: localToday } = getUserLocalTime(gate.notificationPreferences?.timezone);
      if (dayOfWeek !== 0 || localTime !== '10:00') return;

      // Skip recap while healing — a "you crushed it / nothing logged" summary
      // lands wrong during an injury pause.
      if (gate.injuryMode?.isActive) return;

      if (!prefsOf(gate).weeklySummary) return;

      const userData = await readFullUser(userId);
      if (!userData) return;

      // The week that just ended (last Sunday → yesterday) in the user's own dates, by
      // category, from the user's activities array
      const weekStartStr = addDaysToDateStr(localToday, -7);
      const weekEndStr = addDaysToDateStr(localToday, -1);
      const activities = userData.activities || [];
      const thisWeekActivities = activities.filter(a => a.date >= weekStartStr && a.date <= weekEndStr);

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

      // The week that just ended (last Sunday → yesterday), judged by the user's Winning
      // Streak rule (judgeUserWeek) — steps from their start week, recovery before it.
      const lastWeek = await judgeUserWeek(userId, userData, weekStartStr);
      const allGoalsMet = lastWeek.all;
      const caloriesLabel = totalCalories >= 1000 ? `${(totalCalories / 1000).toFixed(1)}k` : totalCalories.toString();
      const weekLine = lastWeek.stepsRule
        ? `${workouts} workouts, ${formatStepsK(lastWeek.steps)} steps, ${caloriesLabel} cal.`
        : `${workouts} workouts, ${recovery} recovery sessions, ${caloriesLabel} cal.`;

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
        await sendNotificationToUser(
          userId,
          'You Won the Week! 🔥',
          `${weekLine} Tap to share with friends!`,
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
        await sendNotificationToUser(
          userId,
          'Your Week in Review',
          `${weekLine} Tap to share with friends!`,
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
    });
  }
);

/**
 * Monthly summary - runs on the 1st of each month at 10 AM
 * Includes social sharing prompt and month-over-month comparison
 * Activities are stored as arrays in users/{uid} documents
 */
exports.sendMonthlySummary = onSchedule(
  HOURLY_USER_SCAN, // hourly; fires the 1st at 10 AM in each user's local timezone
  async () => {

    const usersSnapshot = await db.collection('users')
      .select(...ACCESS_FIELDS, 'injuryMode')
      .get();

    await forEachLimited(usersSnapshot.docs, 'sendMonthlySummary', async (userDoc) => {
      const userId = userDoc.id;
      const gate = userDoc.data();

      // No app access (locked out / lapsed) → win-back owns them; stay silent here.
      if (!hasAppAccess(gate)) return;

      // Fire the 1st at 10 AM in the USER's local timezone (hourly job, gated per user).
      const { time: localTime, dateStr } = getUserLocalTime(gate.notificationPreferences?.timezone);
      if (!dateStr.endsWith('-01') || localTime !== '10:00') return;

      // Skip recap while healing (see weekly summary).
      if (gate.injuryMode?.isActive) return;

      if (!prefsOf(gate).monthlySummary) return;

      const userData = await readFullUser(userId);
      if (!userData) return;

      // Last month and the one before, in the user's own dates. (From the server's UTC
      // clock, users east of UTC got the month before last: their 10 AM on the 1st is
      // still the previous day in UTC.)
      const lastMonthStartStr = monthStartBefore(dateStr);
      const lastMonthEndStr = addDaysToDateStr(dateStr, -1);
      const prevMonthStartStr = monthStartBefore(lastMonthStartStr);
      const prevMonthEndStr = addDaysToDateStr(lastMonthStartStr, -1);
      const monthName = new Date(`${lastMonthStartStr}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });

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

      const currentStreak = userData.streaks?.master || 0;

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
    });
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

    try {
      // TRANSFER names the accounts on both sides and has no app_user_id of its own.
      if (event.type === 'TRANSFER') {
        const uids = [...(event.transferred_to || []), ...(event.transferred_from || [])];
        const prevByUid = {};
        await Promise.all(uids.map(async (id) => {
          if (!id || String(id).startsWith('$RCAnonymousID:')) return;
          const snap = await db.collection('users').doc(String(id)).get();
          prevByUid[id] = snap.data()?.subscription || null;
        }));
        const results = await Promise.all(transferUpdates(event, prevByUid).map(({ uid, subscription }) =>
          applySubscriptionUpdate(uid, event, subscription)));
        console.log(`[revenueCatWebhook] TRANSFER from=${JSON.stringify(event.transferred_from)} to=${JSON.stringify(event.transferred_to)} results=${results.join(',')}`);
        res.status(200).json({ ok: true });
        return;
      }

      const uid = resolveUid(event);
      if (!uid) {
        res.status(200).json({ ok: true, skipped: 'anonymous_only' });
        return;
      }

      const subscription = subscriptionFromEvent(event);
      if (!subscription) {
        res.status(200).json({ ok: true, skipped: 'no_entitlement_change' });
        return;
      }

      const result = await applySubscriptionUpdate(uid, event, subscription);
      console.log(`[revenueCatWebhook] ${event.type}/${subscription.periodType} uid=${uid} active=${subscription.entitlementActive} expiresAt=${subscription.expiresAt} → ${result}`);
      res.status(200).json({ ok: true, result });
    } catch (err) {
      console.error('[revenueCatWebhook] Error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * Store one webhook result on users/{uid}, in a transaction so two deliveries for the same
 * user can't interleave. Skips events older than the last one applied, and never recreates
 * the doc of a deleted account (a merge write would bring back a stub that the hourly jobs
 * then treat as a grandfathered user). Returns 'applied' | 'stale' | 'no_account'.
 */
async function applySubscriptionUpdate(uid, event, subscription) {
  const userRef = db.collection('users').doc(uid);
  // A purchase can beat the app's first profile write; create the doc only for a live account.
  const authUserExists = async () => {
    try {
      await getAuth().getUser(uid);
      return true;
    } catch (err) {
      if (err.code === 'auth/user-not-found') return false;
      throw err;
    }
  };

  const snap = await userRef.get();
  if (!snap.exists && !(await authUserExists())) return 'no_account';

  return db.runTransaction(async (tx) => {
    const fresh = await tx.get(userRef);
    const prev = fresh.data()?.subscription;
    if (isStale(event, prev)) return 'stale';

    const update = { subscription };
    // Converting clears/re-arms the lifecycle nudges so a re-subscribe gets a
    // fresh trial-end reminder and stops any in-flight win-back sequence.
    if (subscription.entitlementActive) {
      update.winbackStage = FieldValue.delete();
      update.winbackLastSentAt = FieldValue.delete();
      if (subscription.status === 'trial' && event.type === 'INITIAL_PURCHASE') {
        update.trialEndingNotified = FieldValue.delete();
        update.trialFinalNotified = FieldValue.delete();
      }
    }
    tx.set(userRef, update, { merge: true });
    return 'applied';
  });
}

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
 * Helper: count this-week (last 7 days, the user's local dates) workouts + recovery for a
 * value recap.
 */
function weekRecap(userData) {
  const { dateStr: localToday } = getUserLocalTime(userData.notificationPreferences?.timezone);
  const weekAgoStr = addDaysToDateStr(localToday, -7);
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
  HOURLY_USER_SCAN, // every hour
  async () => {
    const snap = await db.collection('users')
      .where('subscription.status', '==', 'trial')
      .select('subscription', 'trialEndingNotified', 'trialFinalNotified', 'streaks', 'notificationPreferences')
      .get();

    const now = Date.now();
    await forEachLimited(snap.docs, 'sendTrialEndingReminders', async (userDoc) => {
      const userId = userDoc.id;
      const userData = userDoc.data();
      const sub = userData.subscription || {};
      if (!sub.entitlementActive || !sub.trialEndsAt) return;
      // Only nudge CANCELLED trials (auto-renew off). A trial set to convert
      // needs no action — and reminding it the trial is ending just invites a
      // cancel-before-billing, which raises churn. Skip unless willRenew===false.
      if (sub.willRenew !== false) return;

      const hoursLeft = (new Date(sub.trialEndsAt).getTime() - now) / (60 * 60 * 1000);
      if (hoursLeft <= 0) return;

      // Day-before nudge (~24h), once.
      if (hoursLeft >= 22 && hoursLeft < 26 && !userData.trialEndingNotified) {
        // Recovery is a bonus now, so the recap sticks to workouts and the Winning Streak.
        const fullData = await readFullUser(userId);
        if (!fullData) return;
        const { workouts } = weekRecap(fullData);
        const streak = userData.streaks?.master || 0;
        const built = workouts > 0 || streak > 0;
        const recapStr = built
          ? `Your week: ${workouts} workout${workouts === 1 ? '' : 's'}` +
            (streak > 0 ? `, a ${streak}-week Winning Streak` : '') + '.'
          : 'Keep your plan, streaks, and challenges.';
        await sendNotificationToUser(
          userId,
          'Your free week ends tomorrow ⏳',
          `${recapStr} Tap to keep it going.`,
          { type: NotificationType.TRIAL_ENDING },
          { ignoreQuietHours: true }
        );
        await db.collection('users').doc(userId).update({ trialEndingNotified: true });
        return;
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
        await db.collection('users').doc(userId).update({ trialFinalNotified: true });
      }
    });
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
  HOURLY_USER_SCAN, // hourly; fires at 6 PM in each user's local timezone
  async () => {
    // Dormant until explicitly enabled (see isWinbackEnabled). Guards against
    // nagging real subscribers before the RevenueCat webhook is populating state.
    if (!(await isWinbackEnabled())) {
      console.log('[sendWinbackReminders] disabled (config/lifecycleNotifications.winbackEnabled !== true) — skipping');
      return;
    }

    const snap = await db.collection('users')
      .where('subscriptionRequired', '==', true)
      .select(...ACCESS_FIELDS, 'username', 'demoMode', 'winbackStage', 'streaks', 'createdAt')
      .get();

    // Three copy variants, same day 1/3/7 cadence, picked per user:
    //  • never subscribed     → offer the free trial
    //  • lapsed, has progress → resubscribe, lean on their stats
    //  • lapsed, no progress  → resubscribe, lean on their plan (no false "stats" claim)
    const NEVER_SUBSCRIBED = [
      { stage: 1, minDays: 1, title: 'Your free week is waiting 🎁', body: 'You built your plan — start your 7-day free trial and put it to work.' },
      { stage: 2, minDays: 3, title: 'Your goals are ready 💪', body: 'Start your free trial and pick up where you left off.' },
      { stage: 3, minDays: 7, title: 'Last call 👋', body: 'Your DaySeven plan is still here. Tap to start your free 7-day trial.' },
    ];
    const LAPSED_WITH_PROGRESS = [
      { stage: 1, minDays: 1, title: 'We saved your spot 👋', body: 'Your streak and stats are still here — resubscribe to pick up where you left off.' },
      { stage: 2, minDays: 3, title: "Don't lose your progress 💪", body: 'Your history is waiting. Resubscribe any time to keep it going.' },
      { stage: 3, minDays: 7, title: 'Last call 👋', body: 'Your progress is still here — resubscribe to keep it.' },
    ];
    const LAPSED_NO_PROGRESS = [
      { stage: 1, minDays: 1, title: 'Your plan is still here 🎯', body: 'Resubscribe and give your first week a real shot.' },
      { stage: 2, minDays: 3, title: 'Ready when you are 💪', body: 'Your goals are set up — resubscribe and put them to work.' },
      { stage: 3, minDays: 7, title: 'Last call 👋', body: 'Your DaySeven plan is saved. Resubscribe to pick it back up.' },
    ];

    await forEachLimited(snap.docs, 'sendWinbackReminders', async (userDoc) => {
      const userId = userDoc.id;
      const userData = userDoc.data();

      if (hasAppAccess(userData)) return;       // subscribed/comped — not a target
      if (!userData.username) return;            // still mid-onboarding
      if (userData.demoMode === true) return;

      // Fire at 6 PM in the USER's local timezone (hourly job, gated per user).
      const { time: localTime } = getUserLocalTime(userData.notificationPreferences?.timezone);
      if (localTime !== '18:00') return;

      const sentStage = userData.winbackStage || 0;
      if (sentStage >= 3) return;                // sequence complete (3 stages)

      // Pick the copy variant. A win-back target WITH a subscription record has
      // already used their trial (entitlement inactive) → resubscribe, no trial
      // offer; split by whether they built anything worth keeping.
      const sub = userData.subscription;
      let stages;
      if (!sub) {
        stages = NEVER_SUBSCRIBED;
      } else {
        const activities = (await readFullUser(userId))?.activities || [];
        const realActivities = activities.filter((a) => a.source !== 'onboarding_credit');
        const hasProgress = (userData.streaks?.master || 0) > 0 || realActivities.length > 0;
        stages = hasProgress ? LAPSED_WITH_PROGRESS : LAPSED_NO_PROGRESS;
      }

      // Highest stage now due beyond what we last sent. One message per run.
      // Stage clock starts when they LOST access (lapsed subs/trials) — not raw
      // account age — so a lapsed trial gets the full day 1/3/7 sequence from the
      // lapse. Never-subscribed users have no expiry, so they fall back to signup.
      const clockStart = (sub && sub.entitlementActive === false && sub.expiresAt) ? sub.expiresAt : userData.createdAt;
      const age = daysSince(clockStart);
      const due = [...stages].reverse().find((s) => age >= s.minDays && s.stage > sentStage);
      if (!due) return;

      const result = await sendNotificationToUser(
        userId, due.title, due.body,
        { type: NotificationType.WINBACK, stage: String(due.stage) }
      );
      if (result.success) {
        await db.collection('users').doc(userId).update({
          winbackStage: due.stage,
          winbackLastSentAt: new Date().toISOString(),
        });
      }
    });
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
  HOURLY_USER_SCAN, // hourly; fires at 5 PM in each user's local timezone
  async () => {
    const snap = await db.collection('users')
      .where('subscriptionRequired', '==', true)
      .select(...ACCESS_FIELDS, 'username', 'demoMode', 'injuryMode', 'vacationMode', 'streaks', 'createdAt',
        'activationFirstNudge', 'activationWeekNudge')
      .get();

    await forEachLimited(snap.docs, 'sendActivationReminders', async (userDoc) => {
      const userId = userDoc.id;
      const gate = userDoc.data();

      if (!hasAppAccess(gate)) return;       // locked out → win-back handles them
      if (!gate.username) return;             // still mid-onboarding
      if (gate.demoMode === true) return;
      if (gate.injuryMode?.isActive || gate.vacationMode?.isActive) return;
      if ((gate.streaks?.master || 0) > 0) return;     // past their first completed week
      if (daysSince(gate.createdAt) >= 7) return; // week-one only

      // Fire at 5 PM in the USER's local timezone (hourly job, gated per user).
      const { time: localTime, dateStr: localToday, dayOfWeek } = getUserLocalTime(gate.notificationPreferences?.timezone);
      if (localTime !== '17:00') return;

      if (!prefsOf(gate).streakReminders) return;

      const userData = await readFullUser(userId);
      if (!userData) return;
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
          await db.collection('users').doc(userId).update({ activationFirstNudge: true });
        }
        return;
      }

      // Finish-the-week nudge — once, from ~day 3, when started but goals unmet.
      if (age >= 3 && !userData.activationWeekNudge) {
        // This calendar week (Sunday start, the user's local dates), judged by the user's
        // Winning Streak rule.
        const weekStartStr = addDaysToDateStr(localToday, -dayOfWeek);
        const week = await judgeUserWeek(userId, userData, weekStartStr);
        if (!week.all) {
          // Workouts = strength + cardio sessions; recovery is a bonus, not a workout toward the week.
          const completed = week.counts.lifts + week.counts.cardio;
          await sendNotificationToUser(
            userId,
            "You're building something 💪",
            `${completed} workout${completed === 1 ? '' : 's'} down this week. Finish your goals before Sunday to lock in week one!`,
            { type: NotificationType.ACTIVATION, stage: 'week' }
          );
          await db.collection('users').doc(userId).update({ activationWeekNudge: true });
        }
      }
    });
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
    const oldStreak = before.streaks?.master || 0;
    const newStreak = after.streaks?.master || 0;

    // Highest milestone (weeks) crossed by this write — a recalculation can jump
    // several at once, and we only want to celebrate the top one.
    const milestones = [5, 10, 25, 52, 78, 104];
    const hitMilestone = milestones.filter(m => newStreak >= m && oldStreak < m).pop();

    if (!hitMilestone) return;

    // Don't fire celebratory milestones while the streak is paused for injury.
    if (after.injuryMode?.isActive) return;

    // streaks.master is written by both the phone and the Watch and gets
    // recalculated (e.g. goal-history fixes), so it can dip and recover. A
    // genuine repeat of an N-week milestone needs at least N weeks of a fresh
    // streak, so anything sooner is a flip-flop — don't send it twice.
    const lastSentAt = after.streakMilestoneNotifiedAt?.[hitMilestone];
    if (lastSentAt && Date.now() - new Date(lastSentAt).getTime() < hitMilestone * 7 * 24 * 60 * 60 * 1000) return;

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
      5: '5-Week Winning Streak! 💪',
      10: '10-Week Winning Streak! 🔥',
      25: '25-Week Winning Streak! 🏆',
      52: '1 Year Winning Streak! 👑',
      78: '1.5 Year Winning Streak! 🌟',
      104: '2 Year Winning Streak! 🎉',
    };

    const result = await sendNotificationToUser(
      userId,
      titles[hitMilestone],
      messages[hitMilestone],
      {
        type: NotificationType.STREAK_MILESTONE,
        milestone: hitMilestone.toString(),
        streak: newStreak.toString(),
      }
    );
    if (result.success) {
      await db.collection('users').doc(userId).set({
        streakMilestoneNotifiedAt: { [hitMilestone]: new Date().toISOString() },
      }, { merge: true });
    }
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
 * Notify user when the week is won — weekCelebrations.master, set by the phone under the
 * user's Winning Streak rule (Strength + Cardio + Steps from their winningRuleFrom week;
 * Strength + Cardio + Recovery on app versions before it).
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

    // The phone sets weekCelebrations.master when the week is won under the user's rule
    // (steps from their winningRuleFrom week; recovery on app versions before it).
    await sendNotificationToUser(
      userId,
      'Week Won! 🏆',
      after.winningRuleFrom
        ? 'Strength, cardio and steps — done. Your winning streak just grew.'
        : 'You\'ve hit all your strength, cardio, and recovery goals this week!',
      {
        type: NotificationType.GOAL_ACHIEVED,
      }
    );
  }
);

// ==========================================
// FIELD PROTECTION: Prevent goals/profile wipe
// ==========================================

// The fields anyone signed in may see (search, friend requests). The rules keep the rest of
// users/{uid} to the owner and their friends.
const PUBLIC_PROFILE_FIELDS = ['username', 'displayName', 'photoURL'];

/**
 * Monitors writes to user documents and automatically restores critical fields
 * (goals, hasCompletedOnboarding, username) if they get wiped.
 * Also logs what changed for debugging.
 *
 * It also keeps the server-owned companions of the user doc in step, since it already runs
 * on every write:
 *  - publicProfiles/{uid}: mirrors PUBLIC_PROFILE_FIELDS (clients can't write it).
 *  - a new account gets subscriptionRequired: true (the paywall cutover) and daily
 *    reminders switched on, unless the creating write set them.
 *  - a deleted account loses its public profile and its push tokens, so old devices stop
 *    getting its notifications.
 */
exports.protectUserFields = onDocumentWritten(
  { document: "users/{userId}" },
  async (event) => {
    const userId = event.params.userId;
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    if (!after) {
      await Promise.all([
        db.collection('publicProfiles').doc(userId).delete(),
        db.collection('userTokens').doc(userId).delete(),
      ]).catch((err) => console.error(`[protectUserFields] cleanup after delete failed for ${userId}:`, err));
      return;
    }

    if (PUBLIC_PROFILE_FIELDS.some((k) => (before?.[k] ?? null) !== (after[k] ?? null)) || !before) {
      const profile = { uid: userId };
      for (const k of PUBLIC_PROFILE_FIELDS) profile[k] = after[k] ?? null;
      await db.collection('publicProfiles').doc(userId).set(profile)
        .catch((err) => console.error(`[protectUserFields] publicProfiles sync failed for ${userId}:`, err));
    }

    if (!before) {
      const stamp = {};
      if (after.subscriptionRequired === undefined) stamp.subscriptionRequired = true;
      if (!after.createdAt) stamp.createdAt = new Date().toISOString();
      if (after.notificationPreferences?.dailyReminders === undefined) stamp['notificationPreferences.dailyReminders'] = true;
      if (Object.keys(stamp).length > 0) {
        await event.data.after.ref.update(stamp)
          .catch((err) => console.error(`[protectUserFields] new-account stamp failed for ${userId}:`, err));
      }
    }

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
    if (friendSnap.exists) {
      tx.set(friendRef, {
        challengeStats: {
          wins: FieldValue.increment(1),
          currentWinStreak: friendNewStreak,
          longestWinStreak: Math.max(friendStats.longestWinStreak || 0, friendNewStreak),
        },
      }, { merge: true });
    }

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
    const { challengerUid, matchRule, type, participants, title, challengerActivity } = challenge;
    if (!challengerUid) return;

    // Recipient list: participants map keys (preferred) OR legacy friendUid (Phase 1 1v1)
    const recipientUids = participants
      ? Object.keys(participants)
      : (challenge.friendUid ? [challenge.friendUid] : []);
    if (recipientUids.length === 0) return;

    // The challenger's name comes from their profile, not the client-written challenge.
    const fromName = await getUserDisplayName(challengerUid);

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
      // update(), not a merge set, so a deleted account's doc isn't recreated.
      await Promise.all(newAccepters.map(uid =>
        db.collection('users').doc(uid).update({
          'challengeStats.accepted': FieldValue.increment(1),
        }).catch(err =>
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
        const challengerName = await getUserDisplayName(challenge.challengerUid);
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

          // Losses go only to accounts that still exist (a merge set would recreate a
          // deleted one). Transactions need every read before the first write.
          const recordLosses = async (uids) => {
            const refs = uids.map((uid) => db.collection('users').doc(uid));
            const snaps = refs.length ? await tx.getAll(...refs) : [];
            return () => snaps.forEach((snap) => {
              if (!snap.exists) return;
              tx.update(snap.ref, {
                'challengeStats.losses': FieldValue.increment(1),
                'challengeStats.currentWinStreak': 0,
              });
            });
          };

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
              const writeLosses = await recordLosses(data.friendUid ? [data.friendUid] : []);
              tx.update(doc.ref, {
                status: 'expired',
                friendStatus: 'expired',
                resolvedAt: nowIso,
              });
              writeLosses();
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
              // Only someone who accepted it (the app stamps acceptedAt) can lose it.
              if (p.acceptedAt) lossUpdates.push({ uid, isLoss: true });
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

          const writeLosses = await recordLosses(lossUpdates.map(({ uid }) => uid));
          if (Object.keys(participantUpdates).length > 0) {
            tx.update(doc.ref, participantUpdates);
          }

          // Apply per-participant losses (server-only counters)
          writeLosses();
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
        // Looked up only for challenges in the window: this runs for every active challenge.
        const challengerName = () => getUserDisplayName(data.challengerUid);

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

          const name = await challengerName();
          await Promise.all(recipientsToNotify.map(async (uid) => {
            const prefs = await getUserPreferences(uid);
            if (!prefs.challengeExpiring) return;
            await sendNotificationToUser(
              uid,
              'Challenge Ending Soon ⏰',
              `~1h left on ${name}'s challenge.`,
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
          `~1h left on ${await challengerName()}'s challenge.`,
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

  // Stamp intendedChallengeIds on the activity (additive — preserves any prior intent)
  // so the friend feed badge logic and any future threading reads stay coherent.
  // In a transaction: the phone and the Watch rewrite the whole activities array, so a
  // plain read-then-write here could put back a list from before their latest save.
  const activity = await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) {
      throw new HttpsError('not-found', 'User doc missing.');
    }
    const activities = userSnap.data()?.activities || [];
    const found = activities.find(a => String(a.id) === String(activityId));
    if (!found) {
      throw new HttpsError('not-found', 'Activity not found on this user.');
    }
    const existingIntent = Array.isArray(found.intendedChallengeIds)
      ? found.intendedChallengeIds.map(String)
      : [];
    const mergedIntent = Array.from(new Set([...existingIntent, ...wantedIds]));
    tx.update(userRef, {
      activities: activities.map(a => (
        String(a.id) === String(activityId) ? { ...a, intendedChallengeIds: mergedIntent } : a
      )),
    });
    return found;
  });

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
