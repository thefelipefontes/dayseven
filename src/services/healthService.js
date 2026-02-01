import { Capacitor } from '@capacitor/core';
import { Health } from '@capgo/capacitor-health';

// Helper to add timeout to promises
const withTimeout = (promise, ms, errorMsg) => {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(errorMsg || 'Timeout')), ms)
    )
  ]);
};

// Check if HealthKit is available
export async function isHealthKitAvailable() {
  console.log('isHealthKitAvailable() - isNative:', Capacitor.isNativePlatform());
  if (!Capacitor.isNativePlatform()) {
    return false;
  }

  try {
    console.log('Calling Health.isAvailable()...');
    const result = await withTimeout(
      Health.isAvailable(),
      5000,
      'isAvailable timed out'
    );
    console.log('isAvailable result:', JSON.stringify(result));
    return result.available;
  } catch (error) {
    console.log('isHealthKitAvailable error:', error.message || error);
    return false;
  }
}

// Request authorization for reading workout data
export async function requestHealthKitAuthorization() {
  if (!Capacitor.isNativePlatform()) return false;

  try {
    console.log('Requesting HealthKit authorization...');
    const result = await Health.requestAuthorization({
      read: ['steps', 'calories', 'workouts'],
      write: []
    });
    console.log('HealthKit authorization result:', result);
    return true;
  } catch (error) {
    console.error('HealthKit authorization failed:', error);
    return false;
  }
}

// Map HealthKit workout types to our app's activity types
const workoutTypeMap = {
  'HKWorkoutActivityTypeRunning': { type: 'Running', icon: '🏃' },
  'HKWorkoutActivityTypeCycling': { type: 'Cycle', icon: '🚴' },
  'HKWorkoutActivityTypeSwimming': { type: 'Other', subtype: 'Swimming', icon: '🏊' },
  'HKWorkoutActivityTypeYoga': { type: 'Yoga', icon: '🧘' },
  'HKWorkoutActivityTypePilates': { type: 'Pilates', icon: '🤸' },
  'HKWorkoutActivityTypeTraditionalStrengthTraining': { type: 'Strength Training', subtype: 'Lifting', strengthType: 'Lifting', icon: '🏋️' },
  'HKWorkoutActivityTypeFunctionalStrengthTraining': { type: 'Strength Training', subtype: 'Bodyweight', strengthType: 'Bodyweight', icon: '💪' },
  'HKWorkoutActivityTypeHighIntensityIntervalTraining': { type: 'Strength Training', subtype: 'HIIT', strengthType: 'Lifting', icon: '🔥' },
  'HKWorkoutActivityTypeCrossTraining': { type: 'Strength Training', subtype: 'Cross Training', strengthType: 'Lifting', icon: '💪' },
  'HKWorkoutActivityTypeWalking': { type: 'Other', subtype: 'Walking', icon: '🚶' },
  'HKWorkoutActivityTypeHiking': { type: 'Other', subtype: 'Hiking', icon: '🥾' },
  'HKWorkoutActivityTypeElliptical': { type: 'Other', subtype: 'Elliptical', icon: '🏃' },
  'HKWorkoutActivityTypeRowing': { type: 'Other', subtype: 'Rowing', icon: '🚣' },
  'HKWorkoutActivityTypeStairClimbing': { type: 'Other', subtype: 'Stair Climbing', icon: '🪜' },
  'HKWorkoutActivityTypeTennis': { type: 'Sports', subtype: 'Tennis', sportEmoji: '🎾', icon: '🎾' },
  'HKWorkoutActivityTypeBasketball': { type: 'Sports', subtype: 'Basketball', sportEmoji: '🏀', icon: '🏀' },
  'HKWorkoutActivityTypeSoccer': { type: 'Sports', subtype: 'Soccer', sportEmoji: '⚽', icon: '⚽' },
  'HKWorkoutActivityTypeAmericanFootball': { type: 'Sports', subtype: 'Football', sportEmoji: '🏈', icon: '🏈' },
  'HKWorkoutActivityTypeBaseball': { type: 'Sports', subtype: 'Baseball', sportEmoji: '⚾', icon: '⚾' },
  'HKWorkoutActivityTypeGolf': { type: 'Sports', subtype: 'Golf', sportEmoji: '⛳', icon: '⛳' },
  'HKWorkoutActivityTypeBadminton': { type: 'Sports', subtype: 'Badminton', sportEmoji: '🏸', icon: '🏸' },
  'HKWorkoutActivityTypeBoxing': { type: 'Sports', subtype: 'Boxing', sportEmoji: '🥊', icon: '🥊' },
  'HKWorkoutActivityTypeMartialArts': { type: 'Sports', subtype: 'Martial Arts', sportEmoji: '🥋', icon: '🥋' },
  'HKWorkoutActivityTypeDance': { type: 'Other', subtype: 'Dance', icon: '💃' },
  'HKWorkoutActivityTypeMindAndBody': { type: 'Yoga', icon: '🧘' },
  'HKWorkoutActivityTypeCoreTraining': { type: 'Strength Training', subtype: 'Core', strengthType: 'Bodyweight', icon: '💪' },
  'HKWorkoutActivityTypeFlexibility': { type: 'Yoga', icon: '🧘' },
  'HKWorkoutActivityTypeCooldown': { type: 'Other', subtype: 'Cooldown', icon: '🧊' },
};

// Convert HealthKit workout to our activity format
function convertWorkoutToActivity(workout) {
  const workoutType = workout.workoutActivityType || workout.workoutType || 'HKWorkoutActivityTypeOther';
  const mapped = workoutTypeMap[workoutType] || { type: 'Other', subtype: 'Workout', icon: '💪' };

  // Parse date
  const startDate = new Date(workout.startDate);
  const dateStr = startDate.toISOString().split('T')[0]; // YYYY-MM-DD
  const timeStr = startDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  // Calculate duration in minutes
  const endDate = new Date(workout.endDate);
  const durationMs = endDate - startDate;
  const durationMinutes = Math.round(durationMs / (1000 * 60));

  // Get calories (active energy burned)
  const calories = workout.totalEnergyBurned
    ? Math.round(parseFloat(workout.totalEnergyBurned))
    : null;

  // Get distance in miles (if applicable)
  let distance = null;
  if (workout.totalDistance) {
    // Convert meters to miles
    const meters = parseFloat(workout.totalDistance);
    distance = parseFloat((meters / 1609.34).toFixed(2));
  }

  // Calculate pace for running/cycling (minutes per mile)
  let pace = null;
  if (distance && distance > 0 && durationMinutes > 0) {
    const paceMinutes = durationMinutes / distance;
    const paceMin = Math.floor(paceMinutes);
    const paceSec = Math.round((paceMinutes - paceMin) * 60);
    pace = `${paceMin}:${paceSec.toString().padStart(2, '0')}`;
  }

  // Create activity object
  const activity = {
    id: `hk_${workout.uuid || startDate.getTime()}`,
    type: mapped.type,
    date: dateStr,
    time: timeStr,
    duration: durationMinutes,
    source: 'healthkit',
    sourceDevice: workout.sourceName || 'Apple Health',
    healthKitUUID: workout.uuid,
    ...mapped // includes subtype, strengthType, sportEmoji, etc.
  };

  // Add optional fields
  if (calories) activity.calories = calories;
  if (distance) activity.distance = distance;
  if (pace && (mapped.type === 'Running' || mapped.type === 'Cycle')) {
    activity.pace = pace;
  }

  // Add heart rate data if available
  if (workout.averageHeartRate) {
    activity.avgHr = Math.round(parseFloat(workout.averageHeartRate));
  }
  if (workout.maxHeartRate) {
    activity.maxHr = Math.round(parseFloat(workout.maxHeartRate));
  }

  return activity;
}

// Fetch workouts from HealthKit
export async function fetchHealthKitWorkouts(days = 7) {
  if (!Capacitor.isNativePlatform()) return [];

  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const result = await Health.queryWorkouts({
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      limit: 100
    });

    if (!result.workouts || result.workouts.length === 0) {
      return [];
    }

    // Convert HealthKit workouts to our format
    const activities = result.workouts.map(convertWorkoutToActivity);

    // Sort by date (most recent first)
    activities.sort((a, b) => {
      const dateA = new Date(a.date + 'T' + (a.time || '00:00'));
      const dateB = new Date(b.date + 'T' + (b.time || '00:00'));
      return dateB - dateA;
    });

    return activities;
  } catch (error) {
    console.error('Error fetching HealthKit workouts:', error);
    return [];
  }
}

// Fetch today's steps from HealthKit
export async function fetchTodaySteps() {
  if (!Capacitor.isNativePlatform()) return null;

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const now = new Date();

    const result = await Health.queryAggregated({
      dataType: 'steps',
      startDate: today.toISOString(),
      endDate: now.toISOString()
    });

    // Handle both formats: direct value or samples array
    if (result.value !== undefined) {
      return Math.round(result.value);
    } else if (result.samples && result.samples.length > 0) {
      const total = result.samples.reduce((sum, sample) => sum + (sample.value || 0), 0);
      return Math.round(total);
    }
    return 0;
  } catch (error) {
    console.log('Error fetching steps:', error);
    return null;
  }
}

// Fetch today's active calories from HealthKit
export async function fetchTodayCalories() {
  if (!Capacitor.isNativePlatform()) return null;

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const now = new Date();

    console.log('Fetching calories from', today.toISOString(), 'to', now.toISOString());
    const result = await Health.queryAggregated({
      dataType: 'calories',
      startDate: today.toISOString(),
      endDate: now.toISOString()
    });
    console.log('Calories result:', JSON.stringify(result));

    // Handle both formats: direct value or samples array
    if (result.value !== undefined) {
      return Math.round(result.value);
    } else if (result.samples && result.samples.length > 0) {
      // Sum up all samples
      const total = result.samples.reduce((sum, sample) => sum + (sample.value || 0), 0);
      console.log('Calories total from samples:', total);
      return Math.round(total);
    }
    return 0;
  } catch (error) {
    console.log('Error fetching calories:', error);
    return null;
  }
}

// Main function to sync HealthKit data
export async function syncHealthKitData() {
  console.log('Starting HealthKit sync...');

  // Check availability
  const available = await isHealthKitAvailable();
  console.log('HealthKit available:', available);
  if (!available) {
    return { success: false, reason: 'not_available' };
  }

  // Request authorization
  const authorized = await requestHealthKitAuthorization();
  console.log('HealthKit authorized:', authorized);
  if (!authorized) {
    return { success: false, reason: 'not_authorized' };
  }

  // Fetch data
  const [workouts, steps, calories] = await Promise.all([
    fetchHealthKitWorkouts(30), // Last 30 days
    fetchTodaySteps(),
    fetchTodayCalories()
  ]);

  return {
    success: true,
    workouts,
    todaySteps: steps,
    todayCalories: calories
  };
}
