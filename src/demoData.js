// Demo data module for marketing screen recordings
// Log into appreview@dayseven.app to see polished mock data across all screens

const formatDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

export const isDemoAccount = (userProfile, user) => {
  if (userProfile?.demoMode === true) return true;
  const username = userProfile?.username?.toLowerCase();
  const email = user?.email?.toLowerCase();
  return username === 'appreview' ||
         email === 'appreview@dayseven.app' ||
         email === 'reviewer@dayseven.app';
};

// Mock W-L counters for the demo account so the Challenges-tab profile card and
// ChallengeDetailModal don't read 0-0 against the 10 completed mock challenges.
// The cloud function never writes challengeStats for demo accounts (their
// challenges aren't real Firestore docs), so this is the only sensible source.
// Numbers chosen to read as a "good but not flawless" record — 7-3 with a current
// 3-game streak — instead of a zero stat line that looks broken in screenshots.
export const getDemoChallengeStats = () => ({
  accepted: 10,
  wins: 7,
  losses: 3,
  currentWinStreak: 3,
  longestWinStreak: 5,
});

// Generate activities for the current week + historical data for heatmap
export const getDemoActivities = () => {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=Sun

  // --- Current week scenario: Monday ---
  // Monday (today-ish): Lower body workout, no calves
  // Sunday: Full upper body + walk
  // No cardio or recovery yet this week

  const thisWeek = [];
  let idCounter = 1;

  // Today — Lower body (no calves), 54 min, 413 cal, HR 168/127
  thisWeek.push({
    id: `demo-${idCounter++}`,
    date: formatDate(daysAgo(0)),
    type: 'Strength Training', subtype: 'Weightlifting - Legs', strengthType: 'Weightlifting',
    time: '7:05 AM', duration: 54, calories: 413,
    focusAreas: ['Quads', 'Hamstrings', 'Glutes', 'Adductors'],
    maxHr: 168, avgHr: 127
  });

  // Yesterday — Full upper body
  thisWeek.push({
    id: `demo-${idCounter++}`,
    date: formatDate(daysAgo(1)),
    type: 'Strength Training', subtype: 'Weightlifting - Upper Body', strengthType: 'Weightlifting',
    time: '7:00 AM', duration: 65, calories: 327,
    focusAreas: ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps'],
    maxHr: 155, avgHr: 118,
    notes: 'Bench 225x5, barbell rows 185x8, OHP 135x6, curls, tricep pushdowns'
  });

  // Yesterday — 43 min walk
  thisWeek.push({
    id: `demo-${idCounter++}`,
    date: formatDate(daysAgo(1)),
    type: 'Walking',
    time: '5:45 PM', duration: 43, calories: 195,
    distance: 2.1, avgHr: 102
  });

  // Historical activities — past 12 weeks for heatmap density
  const historical = [];
  const activityTemplates = [
    { type: 'Strength Training', subtype: 'Weightlifting - Chest', strengthType: 'Weightlifting', time: '6:30 AM', duration: 60, calories: 400, focusAreas: ['Chest', 'Triceps'] },
    { type: 'Strength Training', subtype: 'Weightlifting - Back', strengthType: 'Weightlifting', time: '7:00 AM', duration: 55, calories: 380, focusAreas: ['Back', 'Biceps'] },
    { type: 'Strength Training', subtype: 'Weightlifting - Legs', strengthType: 'Weightlifting', time: '6:45 AM', duration: 65, calories: 440, focusAreas: ['Quads', 'Hamstrings', 'Glutes'] },
    { type: 'Strength Training', subtype: 'Weightlifting - Shoulders', strengthType: 'Weightlifting', time: '7:15 AM', duration: 50, calories: 350, focusAreas: ['Shoulders', 'Triceps'] },
    { type: 'Running', time: '6:00 AM', duration: 40, calories: 450, distance: 5.0, pace: '8:00' },
    { type: 'Running', time: '5:45 AM', duration: 32, calories: 360, distance: 3.8, pace: '8:25' },
    { type: 'Cycle', time: '6:15 AM', duration: 50, calories: 400, distance: 16.0 },
    { type: 'Cold Plunge', time: '8:00 AM', duration: 5 },
    { type: 'Sauna', time: '8:30 AM', duration: 20 },
    { type: 'Yoga', time: '7:00 AM', duration: 45, calories: 180 },
  ];

  // Generate 3-6 activities per week for past N weeks (skip current week).
  // Set to 32 so personas can carry streaks up to ~32 weeks without the
  // profile heatmap / past-N-months charts looking thin behind the streak number.
  for (let week = 1; week <= 32; week++) {
    const weekStart = 7 * week + dayOfWeek; // days ago for Sunday of that week
    // Pick 4-5 activities per week for a consistent pattern
    const weekActivities = [0, 1, 2, 4, 7]; // chest, back, legs, run, cold plunge
    // Add variety: extra activities some weeks
    if (week % 2 === 0) weekActivities.push(6, 8); // cycle + sauna
    if (week % 3 === 0) weekActivities.push(5, 9); // second run + yoga

    weekActivities.forEach((templateIdx, i) => {
      const dayOffset = Math.min(i, 6); // spread across the week (Mon-Sat)
      const daysFromToday = weekStart - dayOffset - 1;
      if (daysFromToday > 0) {
        historical.push({
          id: `demo-hist-${week}-${i}`,
          date: formatDate(daysAgo(daysFromToday)),
          ...activityTemplates[templateIdx]
        });
      }
    });
  }

  return [...thisWeek, ...historical];
};

// Per-username deep overrides on top of the base demo profile. Use this to
// give individual demo personas distinct goals/streaks/PRs without forking
// getDemoUserData(). Only fields you specify get overridden; everything else
// inherits from the base. Sub-objects (goals, streaks, personalRecords) merge
// field-by-field — partial overrides are fine.
const DEMO_USER_OVERRIDES = {
  // Mila — consistent, balanced persona. Lower lifting volume, deeper
  // cardio + recovery streaks. Realistic "well-rounded athlete" story.
  milahart: {
    goals: { liftsPerWeek: 3 },
    streaks: { master: 8, lifts: 12, cardio: 9, recovery: 8 },
    personalRecords: {
      longestStrength: { value: 70, activityType: 'Strength Training' },
      mostWorkoutsWeek: 7,
      mostCaloriesWeek: 2900,
      longestStrengthStreak: 14,
      longestCardioStreak: 11,
      longestRecoveryStreak: 8,
    },
  },
  // Jace — strength-focused, heavier persona. Higher lifting volume, stronger
  // PRs, longer master+strength streaks but lighter cardio/recovery cadence.
  jacemiller: {
    goals: { liftsPerWeek: 4 },
    streaks: { master: 14, lifts: 14, cardio: 6, recovery: 4 },
    personalRecords: {
      highestCalories: { value: 740, activityType: 'Running' },
      longestStrength: { value: 105, activityType: 'Strength Training' },
      mostWorkoutsWeek: 10,
      mostCaloriesWeek: 3800,
      mostMilesWeek: 18.5,
      longestMasterStreak: 14,
      longestStrengthStreak: 18,
      longestCardioStreak: 7,
      longestRecoveryStreak: 5,
    },
  },
};

export const getDemoUserData = (username) => {
  const base = {
    name: 'DaySeven',
    goals: {
      liftsPerWeek: 4,
      cardioPerWeek: 2,
      recoveryPerWeek: 2,
      stepsPerDay: 10000,
      caloriesPerDay: 500
    },
    streaks: {
      master: 12,
      lifts: 12,
      cardio: 8,
      recovery: 5,
      stepsGoal: 3
    },
    streakShield: {
      lastUsedWeek: null,
      shieldedWeeks: []
    },
    vacationMode: {
      isActive: false,
      startDate: null,
      activationsThisYear: 0,
      activationYear: null,
      vacationWeeks: []
    },
    customActivities: [],
    personalRecords: {
      highestCalories: { value: 680, activityType: 'Running' },
      longestStrength: { value: 85, activityType: 'Strength Training' },
      longestCardio: { value: 62, activityType: 'Running' },
      longestDistance: { value: 8.2, activityType: 'Running' },
      fastestPace: { value: 7.15, activityType: 'Running' },
      fastestCyclingPace: { value: 3.8, activityType: 'Cycle' },
      mostWorkoutsWeek: 8,
      mostCaloriesWeek: 3200,
      mostMilesWeek: 22.5,
      longestMasterStreak: 12,
      longestStrengthStreak: 12,
      longestCardioStreak: 10,
      longestRecoveryStreak: 7
    }
  };

  const override = DEMO_USER_OVERRIDES[(username || '').toLowerCase()];
  if (!override) return base;

  return {
    ...base,
    ...override,
    goals: { ...base.goals, ...(override.goals || {}) },
    streaks: { ...base.streaks, ...(override.streaks || {}) },
    personalRecords: { ...base.personalRecords, ...(override.personalRecords || {}) },
  };
};

// Deterministic per-day mock totals so demo HealthKit data shifts each calendar
// day (and ramps up across the day) without any backend or Firestore writes.
const seededDailyValue = (seed, min, max) => {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  const norm = ((h >>> 0) % 1000) / 1000;
  return min + norm * (max - min);
};

const seededDailyTotals = (dateStr) => ({
  steps:    Math.round(seededDailyValue(dateStr + 's', 6500, 13500)),
  calories: Math.round(seededDailyValue(dateStr + 'c', 380, 720)),
  distance: +seededDailyValue(dateStr + 'd', 2.8, 7.8).toFixed(1),
  flights:  Math.round(seededDailyValue(dateStr + 'f', 4, 18)),
});

export const getDemoHealthKitData = () => {
  const now = new Date();
  const dateStr = formatDate(now);
  // Saturate around 10pm so late-evening opens still show "full day" totals.
  const hourFrac = Math.min(1, (now.getHours() + now.getMinutes() / 60) / 22);
  const t = seededDailyTotals(dateStr);

  return {
    isConnected: true,
    todaySteps:    Math.round(t.steps * hourFrac),
    todayCalories: Math.round(t.calories * hourFrac),
    todayDistance: +(t.distance * hourFrac).toFixed(1),
    todayFlights:  Math.round(t.flights * hourFrac),
  };
};

// Past-N-days history with the same seeded totals, matching the Firestore
// dailyHealth shape: { date, steps, calories, lastUpdated }. Skips today —
// today's live values come from getDemoHealthKitData(). Sorted descending.
export const getDemoHealthHistory = (days = 365) => {
  const out = [];
  for (let i = 1; i <= days; i++) {
    const date = formatDate(daysAgo(i));
    const t = seededDailyTotals(date);
    out.push({
      date,
      steps: t.steps,
      calories: t.calories,
      lastUpdated: new Date().toISOString(),
    });
  }
  return out;
};

// Friends list for demo mode. Uids/usernames intentionally match the dummyFriends
// in ActivityFeed.jsx so the leaderboard and feed badges reference the same people.
// Photos: randomuser.me/api/portraits/{men|women}/{0-99}.jpg — modern stable
// portraits keyed per index, free to hotlink, no auth, no API limit.
//
// Each record carries top-level streak counts + challengeStats so when the
// FriendProfileCard opens for a dummy uid (whose Firestore doc returns null),
// the component's friend-level fallbacks render real numbers instead of zeros.
// FriendProfileCard reads these as: friend?.masterStreak / strengthStreak /
// cardioStreak / recoveryStreak / longestMasterStreak / challengeStats.
export const getDemoFriends = () => {
  const addedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return [
    {
      uid: 'dummy1', username: 'alex_fitness', displayName: 'Alex Thompson',
      photoURL: 'https://randomuser.me/api/portraits/men/32.jpg', addedAt,
      masterStreak: 8, strengthStreak: 8, cardioStreak: 6, recoveryStreak: 4, longestMasterStreak: 12,
      challengeStats: { accepted: 16, wins: 12, losses: 4, currentWinStreak: 2, longestWinStreak: 5 },
    },
    {
      uid: 'dummy2', username: 'sarah_runs', displayName: 'Sarah Chen',
      photoURL: 'https://randomuser.me/api/portraits/women/44.jpg', addedAt,
      masterStreak: 5, strengthStreak: 4, cardioStreak: 9, recoveryStreak: 3, longestMasterStreak: 7,
      challengeStats: { accepted: 11, wins: 9, losses: 2, currentWinStreak: 4, longestWinStreak: 4 },
    },
    {
      uid: 'dummy3', username: 'mike_lifts', displayName: 'Mike Johnson',
      photoURL: 'https://randomuser.me/api/portraits/men/68.jpg', addedAt,
      masterStreak: 14, strengthStreak: 14, cardioStreak: 5, recoveryStreak: 6, longestMasterStreak: 18,
      challengeStats: { accepted: 22, wins: 15, losses: 7, currentWinStreak: 1, longestWinStreak: 6 },
    },
    {
      uid: 'dummy4', username: 'emma_yoga', displayName: 'Emma Williams',
      photoURL: 'https://randomuser.me/api/portraits/women/68.jpg', addedAt,
      masterStreak: 3, strengthStreak: 2, cardioStreak: 5, recoveryStreak: 7, longestMasterStreak: 6,
      challengeStats: { accepted: 9, wins: 6, losses: 3, currentWinStreak: 2, longestWinStreak: 3 },
    },
    {
      uid: 'dummy5', username: 'jake_athlete', displayName: 'Jake Martinez',
      photoURL: 'https://randomuser.me/api/portraits/men/53.jpg', addedAt,
      masterStreak: 9, strengthStreak: 7, cardioStreak: 7, recoveryStreak: 5, longestMasterStreak: 11,
      challengeStats: { accepted: 16, wins: 11, losses: 5, currentWinStreak: 3, longestWinStreak: 4 },
    },
    {
      uid: 'dummy6', username: 'lisa_cardio', displayName: 'Lisa Park',
      photoURL: 'https://randomuser.me/api/portraits/women/22.jpg', addedAt,
      masterStreak: 6, strengthStreak: 5, cardioStreak: 11, recoveryStreak: 4, longestMasterStreak: 9,
      challengeStats: { accepted: 12, wins: 8, losses: 4, currentWinStreak: 1, longestWinStreak: 4 },
    },
  ];
};

// Mock incoming friend requests for the Friends modal. Same shape as getFriendRequests().
// `fromUser` carries the same friend-level stat fields as getDemoFriends so a tap
// on the request opens a populated FriendProfileCard, not a stat-zero one.
export const getDemoFriendRequests = () => {
  const createdAt = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  return [
    {
      id: 'demo-req-1',
      fromUid: 'dummy7', toUid: 'demo-uid', status: 'pending', createdAt,
      fromUser: {
        uid: 'dummy7', username: 'noah_climbs', displayName: 'Noah Reyes',
        photoURL: 'https://randomuser.me/api/portraits/men/72.jpg',
        masterStreak: 4, strengthStreak: 3, cardioStreak: 4, recoveryStreak: 2, longestMasterStreak: 5,
        challengeStats: { accepted: 6, wins: 4, losses: 2, currentWinStreak: 2, longestWinStreak: 3 },
      },
    },
    {
      id: 'demo-req-2',
      fromUid: 'dummy8', toUid: 'demo-uid', status: 'pending', createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      fromUser: {
        uid: 'dummy8', username: 'maya_lifts', displayName: 'Maya Patel',
        photoURL: 'https://randomuser.me/api/portraits/women/79.jpg',
        masterStreak: 6, strengthStreak: 5, cardioStreak: 6, recoveryStreak: 3, longestMasterStreak: 8,
        challengeStats: { accepted: 10, wins: 7, losses: 3, currentWinStreak: 1, longestWinStreak: 3 },
      },
    },
  ];
};

// Mock outgoing friend requests for the Friends modal. Same shape as getSentRequests().
export const getDemoSentRequests = () => {
  return [
    {
      id: 'demo-sent-1',
      fromUid: 'demo-uid', toUid: 'dummy9', status: 'pending',
      createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
      toUser: {
        uid: 'dummy9', username: 'leo_runner', displayName: 'Leo Hernandez',
        photoURL: 'https://randomuser.me/api/portraits/men/15.jpg',
        masterStreak: 4, strengthStreak: 4, cardioStreak: 5, recoveryStreak: 2, longestMasterStreak: 6,
        challengeStats: { accepted: 9, wins: 5, losses: 4, currentWinStreak: 1, longestWinStreak: 2 },
      },
    },
  ];
};

// Mock challenges for the Challenges tab. Generates a realistic spread across all
// segments: 2 pending (1 received + 1 sent), 10 active (5 received + 5 sent), 10
// completed (3 received-won + 2 received-lost + 3 sent-won + 2 sent-lost). Uses the
// same dummy uids as getDemoFriends so avatars/names resolve via friendsByUid.
export const getDemoChallenges = (currentUid, currentName = 'You') => {
  if (!currentUid) return [];

  const friends = [
    { uid: 'dummy1', name: 'Alex Thompson' },
    { uid: 'dummy2', name: 'Sarah Chen' },
    { uid: 'dummy3', name: 'Mike Johnson' },
    { uid: 'dummy4', name: 'Emma Williams' },
    { uid: 'dummy5', name: 'Jake Martinez' },
    { uid: 'dummy6', name: 'Lisa Park' },
  ];

  const today = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  const HOUR = 60 * 60 * 1000;

  // Activity snapshots — what the challenger logged.
  const A = {
    run5: { activityId: 'a-run5', type: 'Running', subtype: '', duration: 42, distance: 5, calories: 480, countToward: 'cardio', date: today },
    run3: { activityId: 'a-run3', type: 'Running', subtype: '', duration: 25, distance: 3, calories: 285, countToward: 'cardio', date: today },
    runHalf: { activityId: 'a-runhalf', type: 'Running', subtype: '', duration: 90, distance: 13.1, calories: 1100, countToward: 'cardio', date: today },
    cycle10: { activityId: 'a-cyc10', type: 'Cycle', subtype: '', duration: 30, distance: 10, calories: 300, countToward: 'cardio', date: today },
    cycle20: { activityId: 'a-cyc20', type: 'Cycle', subtype: '', duration: 60, distance: 20, calories: 550, countToward: 'cardio', date: today },
    legs60: { activityId: 'a-legs', type: 'Strength Training', subtype: 'Weightlifting - Legs', duration: 60, distance: 0, calories: 420, countToward: 'lifting', date: today },
    upper45: { activityId: 'a-upper', type: 'Strength Training', subtype: 'Weightlifting - Upper Body', duration: 45, distance: 0, calories: 300, countToward: 'lifting', date: today },
    full75: { activityId: 'a-full', type: 'Strength Training', subtype: 'Weightlifting - Full Body', duration: 75, distance: 0, calories: 520, countToward: 'lifting', date: today },
    yoga45: { activityId: 'a-yoga', type: 'Yoga', subtype: 'Vinyasa', duration: 45, distance: 0, calories: 180, countToward: 'cardio', date: today },
    plunge5: { activityId: 'a-plunge', type: 'Cold Plunge', subtype: '', duration: 5, distance: 0, calories: 0, countToward: 'recovery', date: today },
    sauna20: { activityId: 'a-sauna', type: 'Sauna', subtype: '', duration: 20, distance: 0, calories: 0, countToward: 'recovery', date: today },
    stretch15: { activityId: 'a-stretch', type: 'Stretching', subtype: '', duration: 15, distance: 0, calories: 0, countToward: 'recovery', date: today },
  };

  // Match rules — what the recipient must do to fulfill.
  const R = {
    run5: { category: 'cardio', activityType: 'Running', distanceMin: 5 },
    run3: { category: 'cardio', activityType: 'Running', distanceMin: 3 },
    runHalf: { category: 'cardio', activityType: 'Running', distanceMin: 13.1 },
    cycle10: { category: 'cardio', activityType: 'Cycle', distanceMin: 10 },
    cycle20: { category: 'cardio', activityType: 'Cycle', distanceMin: 20 },
    legs60: { category: 'lifting', durationMin: 60 },
    upper45: { category: 'lifting', durationMin: 45 },
    full75: { category: 'lifting', durationMin: 75 },
    yoga45: { category: 'cardio', durationMin: 45 },
    plunge5: { category: 'recovery', durationMin: 5 },
    sauna20: { category: 'recovery', durationMin: 20 },
    stretch15: { category: 'recovery', durationMin: 15 },
  };

  // Recipient-perspective challenge (friend is the challenger, demo user is recipient).
  const received = ({ id, friend, key, myStatus, overallStatus, windowHours = 24, requirePhoto = false, createdHoursAgo, acceptedHoursAgo, title = '' }) => {
    const createdAtMs = Date.now() - createdHoursAgo * HOUR;
    const acceptedAtMs = acceptedHoursAgo != null ? Date.now() - acceptedHoursAgo * HOUR : null;
    const respondByMs = createdAtMs + 8 * HOUR;
    const expiresAtMs = acceptedAtMs ? acceptedAtMs + windowHours * HOUR : respondByMs;
    return {
      id, type: '1v1', mode: 'all_complete',
      challengerUid: friend.uid, challengerName: friend.name,
      title,
      participantUids: [friend.uid, currentUid],
      participants: { [currentUid]: { status: myStatus, ...(acceptedAtMs ? { acceptedAt: new Date(acceptedAtMs).toISOString() } : {}) } },
      challengerActivity: A[key],
      matchRule: R[key],
      windowHours, requirePhoto,
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      respondByAt: new Date(respondByMs).toISOString(),
      status: overallStatus,
      friendUid: currentUid,
      friendStatus: myStatus,
    };
  };

  // Sender-perspective challenge (demo user is the challenger).
  const sent = ({ id, friend, key, friendStatus, overallStatus, windowHours = 24, requirePhoto = false, createdHoursAgo, acceptedHoursAgo, title = '' }) => {
    const createdAtMs = Date.now() - createdHoursAgo * HOUR;
    const acceptedAtMs = acceptedHoursAgo != null ? Date.now() - acceptedHoursAgo * HOUR : null;
    const respondByMs = createdAtMs + 8 * HOUR;
    const expiresAtMs = acceptedAtMs ? acceptedAtMs + windowHours * HOUR : respondByMs;
    return {
      id, type: '1v1', mode: 'all_complete',
      challengerUid: currentUid, challengerName: currentName,
      title,
      participantUids: [currentUid, friend.uid],
      participants: { [friend.uid]: { status: friendStatus, ...(acceptedAtMs ? { acceptedAt: new Date(acceptedAtMs).toISOString() } : {}) } },
      challengerActivity: A[key],
      matchRule: R[key],
      windowHours, requirePhoto,
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      respondByAt: new Date(respondByMs).toISOString(),
      status: overallStatus,
      friendUid: friend.uid,
      friendStatus,
    };
  };

  return [
    // === 2 pending ===
    received({ id: 'demo-c-pr1', friend: friends[0], key: 'run5', myStatus: 'pending', overallStatus: 'pending', createdHoursAgo: 1.5 }),
    sent({ id: 'demo-c-ps1', friend: friends[1], key: 'legs60', friendStatus: 'pending', overallStatus: 'pending', createdHoursAgo: 0.5 }),

    // === 10 active ===
    // Received (I accepted, must complete)
    received({ id: 'demo-c-a1', friend: friends[2], key: 'cycle10', myStatus: 'accepted', overallStatus: 'active', windowHours: 24, createdHoursAgo: 6, acceptedHoursAgo: 4 }),
    received({ id: 'demo-c-a2', friend: friends[3], key: 'sauna20', myStatus: 'accepted', overallStatus: 'active', windowHours: 48, createdHoursAgo: 10, acceptedHoursAgo: 8, requirePhoto: true }),
    received({ id: 'demo-c-a3', friend: friends[4], key: 'run3', myStatus: 'accepted', overallStatus: 'active', windowHours: 24, createdHoursAgo: 18, acceptedHoursAgo: 17 }),
    received({ id: 'demo-c-a4', friend: friends[0], key: 'upper45', myStatus: 'accepted', overallStatus: 'active', windowHours: 48, createdHoursAgo: 30, acceptedHoursAgo: 28 }),
    received({ id: 'demo-c-a5', friend: friends[5], key: 'plunge5', myStatus: 'accepted', overallStatus: 'active', windowHours: 24, createdHoursAgo: 5, acceptedHoursAgo: 5, requirePhoto: true }),
    // Sent (friend accepted, both racing)
    sent({ id: 'demo-c-a6', friend: friends[1], key: 'cycle20', friendStatus: 'accepted', overallStatus: 'active', windowHours: 48, createdHoursAgo: 12, acceptedHoursAgo: 10 }),
    sent({ id: 'demo-c-a7', friend: friends[2], key: 'yoga45', friendStatus: 'accepted', overallStatus: 'active', windowHours: 24, createdHoursAgo: 8, acceptedHoursAgo: 6 }),
    sent({ id: 'demo-c-a8', friend: friends[3], key: 'full75', friendStatus: 'accepted', overallStatus: 'active', windowHours: 72, createdHoursAgo: 24, acceptedHoursAgo: 22, title: 'Friday push' }),
    sent({ id: 'demo-c-a9', friend: friends[4], key: 'stretch15', friendStatus: 'accepted', overallStatus: 'active', windowHours: 24, createdHoursAgo: 14, acceptedHoursAgo: 12 }),
    sent({ id: 'demo-c-a10', friend: friends[5], key: 'run5', friendStatus: 'accepted', overallStatus: 'active', windowHours: 48, createdHoursAgo: 36, acceptedHoursAgo: 33 }),

    // === 10 completed ===
    // Received-won
    received({ id: 'demo-c-c1', friend: friends[0], key: 'run3', myStatus: 'completed', overallStatus: 'completed', windowHours: 24, createdHoursAgo: 96, acceptedHoursAgo: 95 }),
    received({ id: 'demo-c-c2', friend: friends[2], key: 'legs60', myStatus: 'completed', overallStatus: 'completed', windowHours: 48, createdHoursAgo: 168, acceptedHoursAgo: 167 }),
    received({ id: 'demo-c-c3', friend: friends[4], key: 'cycle10', myStatus: 'completed', overallStatus: 'completed', windowHours: 24, createdHoursAgo: 200, acceptedHoursAgo: 199 }),
    // Received-lost
    received({ id: 'demo-c-c4', friend: friends[1], key: 'runHalf', myStatus: 'expired', overallStatus: 'expired', windowHours: 24, createdHoursAgo: 240, acceptedHoursAgo: 240 }),
    received({ id: 'demo-c-c5', friend: friends[5], key: 'sauna20', myStatus: 'expired', overallStatus: 'expired', windowHours: 24, createdHoursAgo: 360, acceptedHoursAgo: 360 }),
    // Sent-won (friend completed)
    sent({ id: 'demo-c-c6', friend: friends[3], key: 'upper45', friendStatus: 'completed', overallStatus: 'completed', windowHours: 48, createdHoursAgo: 120, acceptedHoursAgo: 118 }),
    sent({ id: 'demo-c-c7', friend: friends[0], key: 'cycle20', friendStatus: 'completed', overallStatus: 'completed', windowHours: 24, createdHoursAgo: 192, acceptedHoursAgo: 191 }),
    sent({ id: 'demo-c-c8', friend: friends[1], key: 'plunge5', friendStatus: 'completed', overallStatus: 'completed', windowHours: 24, createdHoursAgo: 264, acceptedHoursAgo: 263 }),
    // Sent-lost (friend didn't finish)
    sent({ id: 'demo-c-c9', friend: friends[2], key: 'run5', friendStatus: 'expired', overallStatus: 'expired', windowHours: 24, createdHoursAgo: 312, acceptedHoursAgo: 312 }),
    sent({ id: 'demo-c-c10', friend: friends[4], key: 'stretch15', friendStatus: 'expired', overallStatus: 'expired', windowHours: 24, createdHoursAgo: 480, acceptedHoursAgo: 480 }),
  ];
};

// Build calendar data from demo activities (same logic as real app)
export const getDemoCalendarData = (activities) => {
  const calendarMap = {};
  activities.forEach(activity => {
    if (activity.date) {
      if (!calendarMap[activity.date]) {
        calendarMap[activity.date] = [];
      }
      calendarMap[activity.date].push({
        type: activity.type,
        subtype: activity.subtype,
        duration: activity.duration,
        distance: activity.distance,
        calories: activity.calories,
        avgHr: activity.avgHr,
        maxHr: activity.maxHr
      });
    }
  });
  return calendarMap;
};
