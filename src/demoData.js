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
  const username = userProfile?.username?.toLowerCase();
  const email = user?.email?.toLowerCase();
  return username === 'appreview' ||
         email === 'appreview@dayseven.app' ||
         email === 'reviewer@dayseven.app';
};

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

  // Generate 3-6 activities per week for past 12 weeks (skip current week)
  for (let week = 1; week <= 12; week++) {
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

export const getDemoUserData = () => ({
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
});

export const getDemoHealthKitData = () => ({
  isConnected: true,
  todaySteps: 2367,
  todayCalories: 441,
  todayDistance: 3.8,
  todayFlights: 6
});

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
