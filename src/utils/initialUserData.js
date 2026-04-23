// Initial user data - zeroed out
export const initialUserData = {
  name: '',
  goals: {
    liftsPerWeek: 4,
    cardioPerWeek: 3,
    recoveryPerWeek: 2,
    stepsPerDay: 10000,
    caloriesPerDay: 500
  },
  streaks: {
    master: 0,
    lifts: 0,
    cardio: 0,
    recovery: 0,
    stepsGoal: 0
  },
  streakShield: {
    lastUsedWeek: null,    // Week key when shield was last used (e.g., "2026-03-02")
    shieldedWeeks: []      // Array of week keys where shield was activated
    // Shield cooldown: 1 use per 6 weeks, starting from user's first full week after sign-up
  },
  vacationMode: {
    isActive: false,
    startDate: null,         // "YYYY-MM-DD" when activated
    activationsThisYear: 0,  // Max 3 per year
    activationYear: null,    // Year to track resets (e.g., 2026)
    vacationWeeks: []        // Week keys where vacation was active (streaks freeze, don't increment)
  },
  customActivities: [], // User-saved custom activity types
  personalRecords: {
    // Single workout records (with activity type that achieved it)
    highestCalories: { value: 0, activityType: null },
    longestStrength: { value: 0, activityType: null }, // Strength training specifically
    longestCardio: { value: 0, activityType: null }, // Any cardio
    longestDistance: { value: 0, activityType: null },
    fastestPace: { value: null, activityType: null }, // minutes per mile (running)
    fastestCyclingPace: { value: null, activityType: null }, // minutes per mile (cycling)
    // Weekly records
    mostWorkoutsWeek: 0,
    mostCaloriesWeek: 0,
    mostMilesWeek: 0,
    // Streak records (these get updated automatically)
    longestMasterStreak: 0,
    longestStrengthStreak: 0,
    longestCardioStreak: 0,
    longestRecoveryStreak: 0
  }
};
