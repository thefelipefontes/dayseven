/**
 * Seed script for App Reviewer account
 *
 * Creates 60 days of realistic workout history, friend accounts with activities,
 * friend relationships, and progress photos for the reviewer@dayseven.app account.
 *
 * Usage: node scripts/seed-reviewer.mjs
 * Requires: GOOGLE_APPLICATION_CREDENTIALS env var pointing to a service account key,
 *           OR run after `firebase login` with `firebase-admin` defaulting to project.
 */

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { createCanvas } from 'canvas';
import { writeFileSync, unlinkSync, existsSync } from 'fs';

// Initialize Firebase Admin
const app = initializeApp({
  projectId: 'dayseven-f1a89',
  storageBucket: 'dayseven-f1a89.firebasestorage.app',
});

const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);
const bucket = storage.bucket();

// ============================================================
// Configuration
// ============================================================

const REVIEWER_EMAIL = 'reviewer@dayseven.app';

const REVIEWER_GOALS = {
  liftsPerWeek: 4,
  cardioPerWeek: 3,
  recoveryPerWeek: 2,
  stepsPerDay: 10000,
  caloriesPerDay: 500,
};

// Friend profiles
const FRIENDS = [
  {
    email: 'alex.fitness@dayseven.app',
    username: 'alexfitness',
    displayName: 'Alex Thompson',
    goals: { liftsPerWeek: 5, cardioPerWeek: 2, recoveryPerWeek: 1 },
  },
  {
    email: 'sarah.runs@dayseven.app',
    username: 'sarahruns',
    displayName: 'Sarah Chen',
    goals: { liftsPerWeek: 3, cardioPerWeek: 4, recoveryPerWeek: 2 },
  },
  {
    email: 'mike.lifts@dayseven.app',
    username: 'mikelifts',
    displayName: 'Mike Rodriguez',
    goals: { liftsPerWeek: 5, cardioPerWeek: 2, recoveryPerWeek: 2 },
  },
];

// Activity templates
const STRENGTH_TYPES = [
  { focusAreas: ['Chest'], strengthType: 'Weightlifting' },
  { focusAreas: ['Legs'], strengthType: 'Weightlifting' },
  { focusAreas: ['Back', 'Legs'], strengthType: 'Weightlifting' },
  { focusAreas: ['Shoulders'], strengthType: 'Weightlifting' },
  { focusAreas: ['Back', 'Biceps'], strengthType: 'Bodyweight' },
  { focusAreas: ['Legs'], strengthType: 'Weightlifting' },
  { focusAreas: ['Biceps', 'Triceps'], strengthType: 'Weightlifting' },
  { focusAreas: ['Full Body'], strengthType: 'Circuit' },
  { focusAreas: ['Upper'], strengthType: 'Weightlifting' },
  { focusAreas: ['Lower'], strengthType: 'Weightlifting' },
];

const CARDIO_TYPES = [
  { type: 'Running', subtype: '', distanceRange: [2.0, 6.0], durationRange: [20, 55] },
  { type: 'Cycle', subtype: '', distanceRange: [8.0, 25.0], durationRange: [30, 75] },
  { type: 'Basketball', subtype: '', sportEmoji: '🏀', countToward: 'cardio', distanceRange: null, durationRange: [45, 90] },
  { type: 'Soccer', subtype: '', sportEmoji: '⚽', countToward: 'cardio', distanceRange: null, durationRange: [60, 90] },
  { type: 'Tennis', subtype: '', sportEmoji: '🎾', countToward: 'cardio', distanceRange: null, durationRange: [45, 75] },
  { type: 'Running', subtype: '', distanceRange: [3.0, 8.0], durationRange: [25, 60] },
];

const RECOVERY_TYPES = [
  { type: 'Cold Plunge', durationRange: [3, 12] },
  { type: 'Sauna', durationRange: [15, 30] },
  { type: 'Yoga', durationRange: [30, 60] },
  { type: 'Pilates', durationRange: [30, 45] },
];

// ============================================================
// Helpers
// ============================================================

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min, max, decimals = 1) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function dateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function timeStr(hour) {
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${h}:${String(rand(0, 59)).padStart(2, '0')} ${ampm}`;
}

function getWeekStart(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

// ============================================================
// Activity Generation
// ============================================================

function generateStrengthActivity(date, id) {
  const template = pick(STRENGTH_TYPES);
  const duration = rand(35, 75);
  // Match app format: subtype = "Weightlifting - Chest, Back" and no countToward
  const subtype = `${template.strengthType} - ${template.focusAreas.join(', ')}`;
  return {
    id,
    date: dateStr(date),
    time: timeStr(rand(6, 19)),
    type: 'Strength Training',
    subtype,
    strengthType: template.strengthType,
    focusAreas: template.focusAreas,
    focusArea: template.focusAreas[0],
    duration,
    calories: rand(200, 500),
    avgHr: rand(110, 145),
    maxHr: rand(155, 185),
    source: 'manual',
    notes: '',
  };
}

function generateCardioActivity(date, id) {
  const template = pick(CARDIO_TYPES);
  const duration = rand(template.durationRange[0], template.durationRange[1]);
  const activity = {
    id,
    date: dateStr(date),
    time: timeStr(rand(6, 19)),
    type: template.type,
    subtype: template.subtype,
    duration,
    calories: rand(250, 650),
    avgHr: rand(130, 165),
    maxHr: rand(170, 195),
    source: 'manual',
    notes: '',
  };
  if (template.countToward) activity.countToward = template.countToward;
  if (template.sportEmoji) activity.sportEmoji = template.sportEmoji;
  if (template.distanceRange) {
    activity.distance = randFloat(template.distanceRange[0], template.distanceRange[1]);
  }
  return activity;
}

function generateRecoveryActivity(date, id) {
  const template = pick(RECOVERY_TYPES);
  const duration = rand(template.durationRange[0], template.durationRange[1]);
  return {
    id,
    date: dateStr(date),
    time: timeStr(rand(7, 20)),
    type: template.type,
    subtype: null,
    duration,
    calories: rand(30, 150),
    source: 'manual',
    notes: '',
  };
}

/**
 * Generate activities for a user covering the last `days` days.
 * Ensures weekly goals are met for streak continuity.
 */
function generateActivities(goals, days, options = {}) {
  const { photoChance = 0, streakBreakWeek = -1 } = options;
  const activities = [];
  let activityId = Date.now() - days * 86400000;
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  // Generate week by week
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - days);

  // Align to start of week (Sunday)
  const firstSunday = new Date(startDate);
  firstSunday.setDate(firstSunday.getDate() - firstSunday.getDay());

  const lastDay = new Date(today);
  let weekIndex = 0;

  for (let weekStart = new Date(firstSunday); weekStart <= lastDay; weekStart.setDate(weekStart.getDate() + 7)) {
    weekIndex++;
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    // Skip intentional streak break week
    if (weekIndex === streakBreakWeek) continue;

    // Determine how many of each to do this week (meet or slightly exceed goals)
    const liftCount = goals.liftsPerWeek + (Math.random() > 0.7 ? 1 : 0);
    const cardioCount = goals.cardioPerWeek + (Math.random() > 0.7 ? 1 : 0);
    const recoveryCount = goals.recoveryPerWeek + (Math.random() > 0.8 ? 1 : 0);

    // Distribute across the week
    const daysInWeek = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(weekStart);
      day.setDate(day.getDate() + d);
      if (day > lastDay) break;
      if (day < startDate) continue;
      daysInWeek.push(day);
    }

    // Skip weeks with fewer than 4 days (can't reliably meet goals)
    if (daysInWeek.length < 4) continue;

    // Assign lifts to random days
    const usedDays = new Set();
    for (let i = 0; i < liftCount; i++) {
      const dayIdx = rand(0, daysInWeek.length - 1);
      const day = daysInWeek[dayIdx];
      const act = generateStrengthActivity(day, activityId++);
      if (photoChance > 0 && Math.random() < photoChance) {
        act._needsPhoto = true;
      }
      activities.push(act);
    }

    for (let i = 0; i < cardioCount; i++) {
      const dayIdx = rand(0, daysInWeek.length - 1);
      const day = daysInWeek[dayIdx];
      activities.push(generateCardioActivity(day, activityId++));
    }

    for (let i = 0; i < recoveryCount; i++) {
      const dayIdx = rand(0, daysInWeek.length - 1);
      const day = daysInWeek[dayIdx];
      activities.push(generateRecoveryActivity(day, activityId++));
    }
  }

  // Sort by date
  activities.sort((a, b) => a.date.localeCompare(b.date));
  return activities;
}

// ============================================================
// Daily Health Data Generation
// ============================================================

function generateDailyHealth(days) {
  const healthDocs = {};
  const today = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = dateStr(d);
    healthDocs[key] = {
      date: key,
      steps: rand(6000, 16000),
      calories: rand(300, 800),
      lastUpdated: d.toISOString(),
    };
  }
  return healthDocs;
}

// ============================================================
// Progress Photo Generation (placeholder images)
// ============================================================

async function generateAndUploadPhoto(uid, activityId, category) {
  const colors = {
    strength: '#00FF94',
    cardio: '#FF9500',
    recovery: '#00D1FF',
  };
  const color = colors[category] || '#FFFFFF';
  const week = Math.floor(Math.random() * 8) + 1;

  // Create a simple placeholder image using canvas
  const canvas = createCanvas(400, 600);
  const ctx = canvas.getContext('2d');

  // Dark background with gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, 600);
  gradient.addColorStop(0, '#1a1a1a');
  gradient.addColorStop(1, '#0a0a0a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 400, 600);

  // Category color accent bar
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 400, 4);

  // Silhouette circle
  ctx.beginPath();
  ctx.arc(200, 250, 100, 0, Math.PI * 2);
  ctx.fillStyle = `${color}22`;
  ctx.fill();
  ctx.strokeStyle = `${color}66`;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Category icon text
  ctx.fillStyle = color;
  ctx.font = 'bold 48px sans-serif';
  ctx.textAlign = 'center';
  const icons = { strength: '💪', cardio: '🏃', recovery: '🧘' };
  ctx.fillText(icons[category] || '📸', 200, 265);

  // Week label
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText(`Week ${week}`, 200, 420);

  // Category label
  ctx.fillStyle = color;
  ctx.font = '16px sans-serif';
  ctx.fillText(category.toUpperCase(), 200, 460);

  // Save to temp file and upload
  const buffer = canvas.toBuffer('image/jpeg', { quality: 0.8 });
  const filePath = `activityPhotos/${uid}/${activityId}/${Date.now()}.jpg`;

  const file = bucket.file(filePath);
  await file.save(buffer, {
    metadata: {
      contentType: 'image/jpeg',
      metadata: {
        firebaseStorageDownloadTokens: activityId.toString(),
      },
    },
  });

  // Use Firebase Storage download URL format (works with uniform bucket-level access)
  const encodedPath = encodeURIComponent(filePath);
  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${activityId}`;
  return downloadUrl;
}

// ============================================================
// User Account Management
// ============================================================

async function getOrCreateUser(email, displayName, username) {
  let uid;
  try {
    const user = await auth.getUserByEmail(email);
    uid = user.uid;
    console.log(`  Found existing user: ${email} (${uid})`);
  } catch (e) {
    if (e.code === 'auth/user-not-found') {
      const user = await auth.createUser({
        email,
        displayName,
        password: 'DaySeven2026!',
        emailVerified: true,
      });
      uid = user.uid;
      console.log(`  Created new user: ${email} (${uid})`);
    } else {
      throw e;
    }
  }

  // Ensure username mapping exists
  const usernameDoc = await db.collection('usernames').doc(username.toLowerCase()).get();
  if (!usernameDoc.exists) {
    await db.collection('usernames').doc(username.toLowerCase()).set({ uid });
  }

  return uid;
}

// ============================================================
// Main Seed Function
// ============================================================

async function seed() {
  console.log('🌱 Starting DaySeven seed script...\n');

  // 1. Get or verify reviewer account
  console.log('👤 Setting up reviewer account...');
  const reviewerUid = await getOrCreateUser(REVIEWER_EMAIL, 'App Reviewer', 'appreviewer');

  // 2. Generate reviewer activities (60 days, all goals met each week for strong streaks)
  console.log('🏋️ Generating 60 days of reviewer activities...');
  const reviewerActivities = generateActivities(REVIEWER_GOALS, 90, { photoChance: 0.15 });
  console.log(`  Generated ${reviewerActivities.length} activities`);

  // 3. Upload progress photos for marked activities
  console.log('📸 Uploading progress photos...');
  let photoCount = 0;
  for (const act of reviewerActivities) {
    if (act._needsPhoto) {
      try {
        const cat = getActivityCategory(act);
        const category = cat === 'lifting' ? 'strength' : cat;
        const url = await generateAndUploadPhoto(reviewerUid, act.id, category);
        act.photoURL = url;
        photoCount++;
        process.stdout.write(`  Uploaded ${photoCount} photos\r`);
      } catch (e) {
        console.warn(`  Warning: Failed to upload photo for activity ${act.id}:`, e.message);
      }
      delete act._needsPhoto;
    }
  }
  console.log(`  Uploaded ${photoCount} progress photos`);

  // 4. Calculate streaks from activities
  const streaks = calculateStreaks(reviewerActivities, REVIEWER_GOALS);
  console.log(`  Streaks — Master: ${streaks.master}, Strength: ${streaks.lifts}, Cardio: ${streaks.cardio}, Recovery: ${streaks.recovery}`);

  // 5. Generate daily health data
  const dailyHealth = generateDailyHealth(90);

  // 6. Write reviewer data to Firestore
  console.log('💾 Writing reviewer data to Firestore...');
  await db.collection('users').doc(reviewerUid).set({
    uid: reviewerUid,
    email: REVIEWER_EMAIL,
    username: 'appreviewer',
    displayName: 'App Reviewer',
    authProvider: 'email',
    hasCompletedOnboarding: true,
    hasCompletedTour: true,
    goals: REVIEWER_GOALS,
    activities: reviewerActivities,
    streaks,
    weekCelebrations: { master: false, strength: false, cardio: false, recovery: false },
    personalRecords: {
      longestMasterStreak: streaks.master,
      longestStrengthStreak: streaks.lifts,
      longestCardioStreak: streaks.cardio,
      longestRecoveryStreak: streaks.recovery,
    },
    notificationPreferences: {
      friendRequests: true,
      reactions: true,
      comments: true,
      friendActivity: false,
      streakReminders: true,
      goalReminders: true,
      dailyReminders: true,
      dailyReminderTime: '08:00',
      streakMilestones: true,
      goalAchievements: true,
      weeklySummary: true,
      monthlySummary: true,
      newActivityDetected: true,
      timezone: 'America/New_York',
    },
    createdAt: new Date(Date.now() - 90 * 86400000).toISOString(),
  }, { merge: true });

  // Write daily health subcollection
  const healthBatch = db.batch();
  for (const [dateKey, data] of Object.entries(dailyHealth)) {
    healthBatch.set(db.collection('users').doc(reviewerUid).collection('dailyHealth').doc(dateKey), data);
  }
  await healthBatch.commit();
  console.log(`  Wrote ${Object.keys(dailyHealth).length} daily health records`);

  // 7. Set up friend accounts
  console.log('\n👥 Setting up friend accounts...');
  const friendUids = [];

  for (const friend of FRIENDS) {
    console.log(`\n  Setting up ${friend.displayName}...`);
    const friendUid = await getOrCreateUser(friend.email, friend.displayName, friend.username);
    friendUids.push(friendUid);

    // Generate friend activities (60 days, slightly varied)
    const friendActivities = generateActivities(friend.goals, 90);
    const friendStreaks = calculateStreaks(friendActivities, friend.goals);
    console.log(`  Generated ${friendActivities.length} activities, Master streak: ${friendStreaks.master}`);

    const friendDailyHealth = generateDailyHealth(90);

    await db.collection('users').doc(friendUid).set({
      uid: friendUid,
      email: friend.email,
      username: friend.username,
      displayName: friend.displayName,
      authProvider: 'email',
      hasCompletedOnboarding: true,
      hasCompletedTour: true,
      goals: { ...friend.goals, stepsPerDay: 10000, caloriesPerDay: 500 },
      activities: friendActivities,
      streaks: friendStreaks,
      weekCelebrations: { master: false, strength: false, cardio: false, recovery: false },
      personalRecords: {
        longestMasterStreak: friendStreaks.master,
        longestStrengthStreak: friendStreaks.lifts,
        longestCardioStreak: friendStreaks.cardio,
        longestRecoveryStreak: friendStreaks.recovery,
      },
      notificationPreferences: {
        friendRequests: true,
        reactions: true,
        comments: true,
        friendActivity: true,
        streakReminders: true,
        goalReminders: true,
        timezone: 'America/New_York',
      },
      createdAt: new Date(Date.now() - 120 * 86400000).toISOString(),
    }, { merge: true });

    // Write friend daily health
    const fhBatch = db.batch();
    for (const [dateKey, data] of Object.entries(friendDailyHealth)) {
      fhBatch.set(db.collection('users').doc(friendUid).collection('dailyHealth').doc(dateKey), data);
    }
    await fhBatch.commit();
  }

  // 8. Set up friend relationships (bidirectional)
  console.log('\n🤝 Setting up friend relationships...');
  for (const friendUid of friendUids) {
    // Reviewer -> Friend
    await db.collection('users').doc(reviewerUid).collection('friends').doc(friendUid).set({
      friendUid,
      addedAt: new Date(Date.now() - 30 * 86400000).toISOString(),
    });
    // Friend -> Reviewer
    await db.collection('users').doc(friendUid).collection('friends').doc(reviewerUid).set({
      friendUid: reviewerUid,
      addedAt: new Date(Date.now() - 30 * 86400000).toISOString(),
    });

    // Also make friends with each other
    for (const otherUid of friendUids) {
      if (otherUid !== friendUid) {
        await db.collection('users').doc(friendUid).collection('friends').doc(otherUid).set({
          friendUid: otherUid,
          addedAt: new Date(Date.now() - 25 * 86400000).toISOString(),
        });
      }
    }
  }

  // 9. Add some reactions and comments on reviewer's recent activities
  console.log('💬 Adding reactions and comments...');
  const recentActivities = reviewerActivities.filter(a => {
    const d = new Date(a.date);
    const now = new Date();
    return (now - d) / 86400000 < 14; // Last 2 weeks
  });

  const reactions = ['🔥', '💪', '⚡', '👏', '🙌'];
  const comments = [
    'Great workout!',
    'Beast mode! 💪',
    'Keep it up!',
    'Impressive!',
    'That\'s a solid session',
    'You\'re on fire!',
    'Love the consistency',
    'Goals! 🎯',
  ];

  let reactionCount = 0;
  let commentCount = 0;

  for (const activity of recentActivities.slice(0, 8)) {
    // Add 1-2 reactions from random friends
    const reactorCount = rand(1, 2);
    for (let i = 0; i < reactorCount; i++) {
      const friendIdx = rand(0, FRIENDS.length - 1);
      const friendUid = friendUids[friendIdx];
      const friend = FRIENDS[friendIdx];

      await db.collection('users').doc(reviewerUid)
        .collection('activityReactions').doc(String(activity.id))
        .collection('reactions').doc(friendUid)
        .set({
          reactorUid: friendUid,
          reactorName: friend.displayName,
          reactorPhoto: '',
          reactionType: pick(reactions),
          createdAt: new Date(activity.date + 'T18:00:00').toISOString(),
        });
      reactionCount++;
    }

    // Add 0-1 comments
    if (Math.random() > 0.4) {
      const friendIdx = rand(0, FRIENDS.length - 1);
      const friendUid = friendUids[friendIdx];
      const friend = FRIENDS[friendIdx];
      const commentId = `comment_${Date.now()}_${rand(1000, 9999)}`;

      await db.collection('users').doc(reviewerUid)
        .collection('activityComments').doc(String(activity.id))
        .collection('comments').doc(commentId)
        .set({
          id: commentId,
          commenterUid: friendUid,
          commenterName: friend.displayName,
          commenterPhoto: '',
          text: pick(comments),
          createdAt: new Date(activity.date + 'T19:00:00').toISOString(),
        });
      commentCount++;
    }
  }
  console.log(`  Added ${reactionCount} reactions and ${commentCount} comments`);

  // Summary
  console.log('\n✅ Seed complete!');
  console.log(`  Reviewer: ${REVIEWER_EMAIL} (${reviewerUid})`);
  console.log(`  Activities: ${reviewerActivities.length}`);
  console.log(`  Progress photos: ${photoCount}`);
  console.log(`  Friends: ${FRIENDS.map(f => f.displayName).join(', ')}`);
  console.log(`  Streaks — Master: ${streaks.master}, Strength: ${streaks.lifts}, Cardio: ${streaks.cardio}, Recovery: ${streaks.recovery}`);
  console.log(`\n  Password for all accounts: DaySeven2026!`);
}

// ============================================================
// Streak Calculator (mirrors app logic)
// ============================================================

function getActivityCategory(a) {
  if (a.countToward) {
    if (a.countToward === 'strength' || a.countToward === 'lifting') return 'lifting';
    return a.countToward;
  }
  if (a.type === 'Strength Training') return 'lifting';
  if (['Running', 'Cycle', 'Sports', 'Stair Climbing', 'Elliptical'].includes(a.type)) return 'cardio';
  if (['Basketball', 'Soccer', 'Football', 'Tennis', 'Golf', 'Badminton', 'Boxing',
       'Baseball', 'Volleyball', 'Hockey', 'Pickleball'].includes(a.type)) return 'cardio';
  if (['Cold Plunge', 'Sauna', 'Yoga', 'Pilates'].includes(a.type)) return 'recovery';
  return 'other';
}

function calculateStreaks(activities, goals) {
  const today = new Date();
  const currentWeekStart = new Date(today);
  currentWeekStart.setDate(today.getDate() - today.getDay());
  currentWeekStart.setHours(0, 0, 0, 0);

  let streaks = { master: 0, lifts: 0, cardio: 0, recovery: 0 };
  let liftsAlive = true, cardioAlive = true, recoveryAlive = true;

  for (let weekOffset = 1; weekOffset <= 12; weekOffset++) {
    const weekStart = new Date(currentWeekStart);
    weekStart.setDate(weekStart.getDate() - (weekOffset * 7));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const weekStartStr = dateStr(weekStart);
    const weekEndStr = dateStr(weekEnd);

    const weekActivities = activities.filter(a => a.date >= weekStartStr && a.date <= weekEndStr);
    const liftsCount = weekActivities.filter(a => getActivityCategory(a) === 'lifting').length;
    const cardioCount = weekActivities.filter(a => getActivityCategory(a) === 'cardio').length;
    const recoveryCount = weekActivities.filter(a => getActivityCategory(a) === 'recovery').length;

    console.log(`    Week ${weekOffset}: ${weekStartStr} → ${weekEndStr} | lifts=${liftsCount}/${goals.liftsPerWeek} cardio=${cardioCount}/${goals.cardioPerWeek} recovery=${recoveryCount}/${goals.recoveryPerWeek} | activities=${weekActivities.length}`);

    if (liftsAlive && liftsCount >= goals.liftsPerWeek) streaks.lifts++;
    else liftsAlive = false;

    if (cardioAlive && cardioCount >= goals.cardioPerWeek) streaks.cardio++;
    else cardioAlive = false;

    if (recoveryAlive && recoveryCount >= goals.recoveryPerWeek) streaks.recovery++;
    else recoveryAlive = false;

    if (liftsAlive && cardioAlive && recoveryAlive) streaks.master++;

    if (!liftsAlive && !cardioAlive && !recoveryAlive) break;
  }

  // Current week
  const cwEnd = new Date(currentWeekStart);
  cwEnd.setDate(cwEnd.getDate() + 6);
  const cwActivities = activities.filter(a => a.date >= dateStr(currentWeekStart) && a.date <= dateStr(cwEnd));
  const cwLifts = cwActivities.filter(a => getActivityCategory(a) === 'lifting').length;
  const cwCardio = cwActivities.filter(a => getActivityCategory(a) === 'cardio').length;
  const cwRecovery = cwActivities.filter(a => getActivityCategory(a) === 'recovery').length;

  if (cwLifts >= goals.liftsPerWeek) streaks.lifts = liftsAlive ? streaks.lifts + 1 : 1;
  if (cwCardio >= goals.cardioPerWeek) streaks.cardio = cardioAlive ? streaks.cardio + 1 : 1;
  if (cwRecovery >= goals.recoveryPerWeek) streaks.recovery = recoveryAlive ? streaks.recovery + 1 : 1;

  const allCurrentMet = cwLifts >= goals.liftsPerWeek && cwCardio >= goals.cardioPerWeek && cwRecovery >= goals.recoveryPerWeek;
  if (allCurrentMet) {
    streaks.master = (liftsAlive && cardioAlive && recoveryAlive) ? streaks.master + 1 : 1;
  }

  return streaks;
}

// Run
seed().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
