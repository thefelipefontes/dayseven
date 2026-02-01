import { Capacitor, registerPlugin } from '@capacitor/core';
import { Health } from '@capgo/capacitor-health';

// Register the local HealthKitWriter plugin for writing workouts
const HealthKitWriter = registerPlugin('HealthKitWriter');

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
// Plugin returns lowercase camelCase (e.g., "walking", "running", "strengthTraining")
const workoutTypeMap = {
  // Lowercase versions from @capgo/capacitor-health plugin
  'running': { type: 'Running', icon: '🏃' },
  'cycling': { type: 'Cycle', icon: '🚴' },
  'swimming': { type: 'Other', subtype: 'Swimming', icon: '🏊' },
  'yoga': { type: 'Yoga', icon: '🧘' },
  'pilates': { type: 'Pilates', icon: '🤸' },
  'traditionalStrengthTraining': { type: 'Strength Training', subtype: 'Lifting', strengthType: 'Lifting', icon: '🏋️' },
  'strengthTraining': { type: 'Strength Training', subtype: 'Lifting', strengthType: 'Lifting', icon: '🏋️' },
  'functionalStrengthTraining': { type: 'Strength Training', subtype: 'Bodyweight', strengthType: 'Bodyweight', icon: '💪' },
  'highIntensityIntervalTraining': { type: 'Strength Training', subtype: 'HIIT', strengthType: 'Lifting', icon: '🔥' },
  'crossTraining': { type: 'Strength Training', subtype: 'Cross Training', strengthType: 'Lifting', icon: '💪' },
  'walking': { type: 'Walking', icon: '🚶' },
  'hiking': { type: 'Other', subtype: 'Hiking', icon: '🥾' },
  'elliptical': { type: 'Other', subtype: 'Elliptical', icon: '🏃' },
  'rowing': { type: 'Other', subtype: 'Rowing', icon: '🚣' },
  'stairClimbing': { type: 'Other', subtype: 'Stair Climbing', icon: '🪜' },
  'tennis': { type: 'Sports', subtype: 'Tennis', sportEmoji: '🎾', icon: '🎾' },
  'basketball': { type: 'Sports', subtype: 'Basketball', sportEmoji: '🏀', icon: '🏀' },
  'soccer': { type: 'Sports', subtype: 'Soccer', sportEmoji: '⚽', icon: '⚽' },
  'americanFootball': { type: 'Sports', subtype: 'Football', sportEmoji: '🏈', icon: '🏈' },
  'baseball': { type: 'Sports', subtype: 'Baseball', sportEmoji: '⚾', icon: '⚾' },
  'golf': { type: 'Sports', subtype: 'Golf', sportEmoji: '⛳', icon: '⛳' },
  'badminton': { type: 'Sports', subtype: 'Badminton', sportEmoji: '🏸', icon: '🏸' },
  'boxing': { type: 'Sports', subtype: 'Boxing', sportEmoji: '🥊', icon: '🥊' },
  'martialArts': { type: 'Sports', subtype: 'Martial Arts', sportEmoji: '🥋', icon: '🥋' },
  'dance': { type: 'Other', subtype: 'Dance', icon: '💃' },
  'mindAndBody': { type: 'Yoga', icon: '🧘' },
  'coreTraining': { type: 'Strength Training', subtype: 'Core', strengthType: 'Bodyweight', icon: '💪' },
  'flexibility': { type: 'Yoga', icon: '🧘' },
  'cooldown': { type: 'Other', subtype: 'Cooldown', icon: '🧊' },
  'other': { type: 'Other', subtype: 'Workout', icon: '💪' },
};

// Map HealthKit workout type to human-readable Apple name
// Plugin returns lowercase camelCase (e.g., "walking", "running", "strengthTraining")
const appleWorkoutNameMap = {
  'running': 'Running',
  'cycling': 'Cycling',
  'swimming': 'Swimming',
  'yoga': 'Yoga',
  'pilates': 'Pilates',
  'traditionalStrengthTraining': 'Strength Training',
  'strengthTraining': 'Strength Training',
  'functionalStrengthTraining': 'Functional Training',
  'highIntensityIntervalTraining': 'HIIT',
  'crossTraining': 'Cross Training',
  'walking': 'Walking',
  'hiking': 'Hiking',
  'elliptical': 'Elliptical',
  'rowing': 'Rowing',
  'stairClimbing': 'Stair Climbing',
  'tennis': 'Tennis',
  'basketball': 'Basketball',
  'soccer': 'Soccer',
  'americanFootball': 'Football',
  'baseball': 'Baseball',
  'golf': 'Golf',
  'badminton': 'Badminton',
  'boxing': 'Boxing',
  'martialArts': 'Martial Arts',
  'dance': 'Dance',
  'mindAndBody': 'Mind & Body',
  'coreTraining': 'Core Training',
  'flexibility': 'Flexibility',
  'cooldown': 'Cooldown',
  'other': 'Other Workout',
};

// Convert HealthKit workout to our activity format
function convertWorkoutToActivity(workout) {
  console.log('Raw HealthKit workout:', JSON.stringify(workout, null, 2));

  const workoutType = workout.workoutActivityType || workout.workoutType || 'HKWorkoutActivityTypeOther';
  const mapped = workoutTypeMap[workoutType] || { type: 'Other', subtype: 'Workout', icon: '💪' };
  const appleWorkoutName = appleWorkoutNameMap[workoutType] || 'Workout';

  // Parse date
  const startDate = new Date(workout.startDate);
  const dateStr = startDate.toISOString().split('T')[0]; // YYYY-MM-DD
  const timeStr = startDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  // Calculate duration in minutes
  // Check if workout already has a duration field (in seconds from HealthKit)
  let durationMinutes;
  if (workout.duration !== undefined && workout.duration !== null) {
    // Duration from HealthKit is typically in seconds
    durationMinutes = Math.round(workout.duration / 60);
    console.log('Using workout.duration (seconds):', workout.duration, '-> minutes:', durationMinutes);
  } else {
    // Fallback: calculate from start/end dates
    const endDate = new Date(workout.endDate);
    const durationMs = endDate - startDate;
    durationMinutes = Math.round(durationMs / (1000 * 60));
    console.log('Calculated duration from dates:', workout.startDate, 'to', workout.endDate, '-> minutes:', durationMinutes);
  }

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

  // Create a unique identifier for this workout
  // Use uuid if available, otherwise create from sourceId or timestamp
  const uniqueId = workout.uuid || workout.sourceId || `${startDate.getTime()}_${durationMinutes}`;

  // Create activity object
  const activity = {
    id: `hk_${uniqueId}`,
    type: mapped.type,
    date: dateStr,
    time: timeStr,
    duration: durationMinutes,
    source: 'healthkit',
    sourceDevice: workout.sourceName || 'Apple Health',
    healthKitUUID: uniqueId, // Unique identifier for linking
    appleWorkoutName, // Human-readable name from Apple (e.g., "Walking", "Running")
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

    // Convert HealthKit workouts to our format and filter out DaySeven-created workouts
    const activities = result.workouts
      .map(convertWorkoutToActivity)
      .filter(activity => {
        // Exclude workouts created by DaySeven
        const sourceName = (activity.sourceDevice || '').toLowerCase();
        return !sourceName.includes('dayseven');
      });

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

// Fetch workouts from HealthKit for a specific date that can be linked to a DaySeven activity
// Excludes workouts that were created by DaySeven (source contains 'dayseven')
export async function fetchLinkableWorkouts(date, linkedWorkoutIds = []) {
  if (!Capacitor.isNativePlatform()) return [];

  try {
    // Create date range for the entire day
    const startDate = new Date(date + 'T00:00:00');
    const endDate = new Date(date + 'T23:59:59');

    const result = await Health.queryWorkouts({
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      limit: 50
    });

    if (!result.workouts || result.workouts.length === 0) {
      return [];
    }

    // Convert and filter workouts
    const activities = result.workouts
      .map(convertWorkoutToActivity)
      .filter(activity => {
        // Exclude workouts created by DaySeven
        const sourceName = (activity.sourceDevice || '').toLowerCase();
        if (sourceName.includes('dayseven')) return false;

        // Exclude already linked workouts
        if (linkedWorkoutIds.includes(activity.healthKitUUID)) return false;

        return true;
      });

    // Sort by time (most recent first)
    activities.sort((a, b) => {
      const timeA = a.time || '00:00 AM';
      const timeB = b.time || '00:00 AM';
      // Parse 12-hour time to comparable format
      const parseTime = (t) => {
        const match = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
        if (!match) return 0;
        let hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const period = match[3]?.toUpperCase();
        if (period === 'PM' && hours !== 12) hours += 12;
        if (period === 'AM' && hours === 12) hours = 0;
        return hours * 60 + minutes;
      };
      return parseTime(timeB) - parseTime(timeA);
    });

    return activities;
  } catch (error) {
    console.error('Error fetching linkable workouts:', error);
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

// ============================================================
// HealthKit WRITE functions (for saving workouts to Apple Health)
// ============================================================

// Request HealthKit write authorization for workouts
export async function requestHealthKitWriteAuthorization() {
  if (!Capacitor.isNativePlatform()) return false;

  try {
    const result = await HealthKitWriter.requestWriteAuthorization();
    return result.authorized;
  } catch (error) {
    console.error('HealthKit write authorization failed:', error);
    return false;
  }
}

// Check if we have write authorization for workouts
export async function checkHealthKitWriteAuthorization() {
  if (!Capacitor.isNativePlatform()) return false;

  try {
    const result = await HealthKitWriter.checkWriteAuthorization();
    return result.authorized;
  } catch (error) {
    console.error('Check write authorization failed:', error);
    return false;
  }
}

// Map DaySeven activity to HealthKit workout type string
export function getHealthKitActivityType(activity) {
  const { type, subtype, strengthType } = activity;

  // Strength Training variations
  if (type === 'Strength Training') {
    if (subtype === 'HIIT') return 'hiit';
    if (subtype === 'Cross Training') return 'cross training';
    if (subtype === 'Core') return 'core training';
    return strengthType?.toLowerCase() || 'strength training';
  }

  // Sports - use subtype for specific sport
  if (type === 'Sports') {
    const sportMap = {
      'Basketball': 'basketball',
      'Soccer': 'soccer',
      'Football': 'football',
      'Tennis': 'tennis',
      'Golf': 'golf',
      'Baseball': 'baseball',
      'Boxing': 'boxing',
      'Martial Arts': 'martial arts',
      'Badminton': 'badminton',
      'Volleyball': 'volleyball',
      'Hockey': 'hockey',
      'Lacrosse': 'lacrosse',
      'Rugby': 'rugby',
      'Softball': 'softball',
      'Squash': 'squash',
      'Table Tennis': 'table tennis',
      'Racquetball': 'racquetball',
      'Handball': 'handball',
      'Cricket': 'cricket',
    };
    return sportMap[subtype] || 'other';
  }

  // "Other" activities - use subtype
  if (type === 'Other') {
    const otherMap = {
      'Swimming': 'swimming',
      'Walking': 'walking',
      'Hiking': 'hiking',
      'Rowing': 'rowing',
      'Elliptical': 'elliptical',
      'Stair Climbing': 'stair climbing',
      'Dance': 'dance',
      'Cooldown': 'cooldown',
    };
    return otherMap[subtype] || 'other';
  }

  // Direct type mappings
  const typeMap = {
    'Running': 'running',
    'Cycle': 'cycle',
    'Yoga': 'yoga',
    'Pilates': 'pilates',
    'Cold Plunge': 'other',
    'Sauna': 'other',
  };

  return typeMap[type] || 'other';
}

// Convert 12-hour time string to 24-hour format for ISO date
function convertTo24Hour(time) {
  if (!time) return '12:00:00';

  const match = time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!match) return '12:00:00';

  let hours = parseInt(match[1]);
  const minutes = match[2];
  const period = match[3]?.toUpperCase();

  if (period === 'PM' && hours < 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;

  return `${hours.toString().padStart(2, '0')}:${minutes}:00`;
}

// Calculate workout start/end dates from activity data
function calculateWorkoutDates(activity) {
  const { date, time, duration, startTime, endTime } = activity;

  // If we have exact startTime/endTime (from "Start Workout" flow), use those
  if (startTime && endTime) {
    return {
      startDate: startTime,
      endDate: endTime
    };
  }

  // If we only have startTime (from "Start Workout" flow, with calculated duration)
  if (startTime) {
    const endDate = new Date(startTime);
    endDate.setMinutes(endDate.getMinutes() + (duration || 60));
    return {
      startDate: startTime,
      endDate: endDate.toISOString()
    };
  }

  // Otherwise, calculate from date + time (legacy "Log Completed" flow)
  let startDate;
  if (time) {
    const time24 = convertTo24Hour(time);
    startDate = new Date(`${date}T${time24}`);
  } else {
    // Default to current time minus duration
    startDate = new Date();
    startDate.setMinutes(startDate.getMinutes() - (duration || 60));
  }

  // Calculate end date based on duration
  const endDate = new Date(startDate);
  endDate.setMinutes(endDate.getMinutes() + (duration || 60));

  return {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString()
  };
}

// Fetch workout metrics (calories and heart rate) for a specific time range
// Used when finishing an active workout to auto-populate metrics from Apple Watch/Whoop
export async function fetchWorkoutMetricsForTimeRange(startTime, endTime) {
  if (!Capacitor.isNativePlatform()) {
    console.log('Not on native platform, cannot fetch workout metrics');
    return { success: false, reason: 'not_native' };
  }

  try {
    // Ensure authorization
    const authorized = await requestHealthKitAuthorization();
    if (!authorized) {
      return { success: false, reason: 'not_authorized' };
    }

    const metrics = {
      calories: null,
      avgHr: null,
      maxHr: null,
    };

    // Fetch active calories for the time range
    try {
      const caloriesResult = await Health.queryAggregated({
        dataType: 'calories',
        startDate: startTime,
        endDate: endTime
      });
      console.log('Calories for workout:', JSON.stringify(caloriesResult));

      if (caloriesResult.value !== undefined && caloriesResult.value > 0) {
        metrics.calories = Math.round(caloriesResult.value);
      } else if (caloriesResult.samples && caloriesResult.samples.length > 0) {
        const total = caloriesResult.samples.reduce((sum, sample) => sum + (sample.value || 0), 0);
        if (total > 0) {
          metrics.calories = Math.round(total);
        }
      }
    } catch (error) {
      console.log('Error fetching calories for workout:', error);
    }

    // Fetch heart rate samples for the time range
    try {
      const hrResult = await Health.query({
        dataType: 'heartRate',
        startDate: startTime,
        endDate: endTime,
        limit: 1000 // Get enough samples for good avg/max calculation
      });
      console.log('Heart rate samples for workout:', hrResult?.samples?.length || 0);

      if (hrResult.samples && hrResult.samples.length > 0) {
        const hrValues = hrResult.samples
          .map(s => parseFloat(s.value))
          .filter(v => !isNaN(v) && v > 0);

        if (hrValues.length > 0) {
          // Calculate average and max HR
          const sum = hrValues.reduce((a, b) => a + b, 0);
          metrics.avgHr = Math.round(sum / hrValues.length);
          metrics.maxHr = Math.round(Math.max(...hrValues));
        }
      }
    } catch (error) {
      console.log('Error fetching heart rate for workout:', error);
    }

    const hasData = metrics.calories || metrics.avgHr || metrics.maxHr;

    return {
      success: true,
      hasData,
      metrics
    };
  } catch (error) {
    console.error('Error fetching workout metrics:', error);
    return { success: false, reason: 'error', error: error.message };
  }
}

// Save a workout to HealthKit
export async function saveWorkoutToHealthKit(activity) {
  if (!Capacitor.isNativePlatform()) {
    console.log('Not on native platform, skipping HealthKit write');
    return { success: false, reason: 'not_native' };
  }

  try {
    // Check authorization first
    let authorized = await checkHealthKitWriteAuthorization();
    if (!authorized) {
      // Try to request authorization
      authorized = await requestHealthKitWriteAuthorization();
      if (!authorized) {
        console.log('HealthKit write not authorized');
        return { success: false, reason: 'not_authorized' };
      }
    }

    // Get HealthKit activity type
    const activityType = getHealthKitActivityType(activity);

    // Calculate dates
    const { startDate, endDate } = calculateWorkoutDates(activity);

    // Build workout data
    const workoutData = {
      activityType,
      startDate,
      endDate,
    };

    // Add optional data if available
    if (activity.calories && activity.calories > 0) {
      workoutData.calories = activity.calories;
    }

    if (activity.distance && activity.distance > 0) {
      // Convert miles to meters (HealthKit uses meters)
      workoutData.distance = activity.distance * 1609.34;
    }

    console.log('Saving workout to HealthKit:', workoutData);

    const result = await HealthKitWriter.saveWorkout(workoutData);

    console.log('HealthKit save result:', result);
    return { success: true, workoutUUID: result.workoutUUID };

  } catch (error) {
    console.error('Failed to save workout to HealthKit:', error);
    return { success: false, reason: 'error', error: error.message };
  }
}

// ============================================================
// Live Workout Session (creates actual HealthKit workout)
// ============================================================

// Start a live workout session - this creates an actual workout in HealthKit
// and will collect metrics in real-time. No need to start on Apple Watch separately.
export async function startLiveWorkout(activityType) {
  if (!Capacitor.isNativePlatform()) {
    console.log('Not on native platform, cannot start live workout');
    return { success: false, reason: 'not_native' };
  }

  try {
    const result = await HealthKitWriter.startLiveWorkout({ activityType });
    console.log('Started live workout:', result);
    return {
      success: true,
      startDate: result.startDate,
      activityType: result.activityType
    };
  } catch (error) {
    console.error('Failed to start live workout:', error);
    return { success: false, reason: 'error', error: error.message };
  }
}

// End a live workout session - saves the workout to HealthKit with all collected metrics
// Returns the final metrics and workout UUID
export async function endLiveWorkout(options = {}) {
  if (!Capacitor.isNativePlatform()) {
    return { success: false, reason: 'not_native' };
  }

  try {
    const params = {};
    // Allow user to override/provide metrics
    if (options.calories) params.calories = options.calories;
    if (options.distance) params.distance = options.distance * 1609.34; // Convert miles to meters

    const result = await HealthKitWriter.endLiveWorkout(params);
    console.log('Ended live workout:', result);
    return {
      success: true,
      workoutUUID: result.workoutUUID,
      duration: result.duration,
      calories: result.calories,
      avgHr: result.avgHr,
      maxHr: result.maxHr,
      sampleCount: result.sampleCount
    };
  } catch (error) {
    console.error('Failed to end live workout:', error);
    return { success: false, reason: 'error', error: error.message };
  }
}

// Cancel a live workout without saving
export async function cancelLiveWorkout() {
  if (!Capacitor.isNativePlatform()) {
    return { success: false, reason: 'not_native' };
  }

  try {
    const result = await HealthKitWriter.cancelLiveWorkout();
    console.log('Cancelled live workout:', result);
    return { success: true };
  } catch (error) {
    console.error('Failed to cancel live workout:', error);
    return { success: false, reason: 'error', error: error.message };
  }
}

// Get current metrics from live workout
export async function getLiveWorkoutMetrics() {
  if (!Capacitor.isNativePlatform()) {
    return { success: false, reason: 'not_native', isActive: false };
  }

  try {
    const result = await HealthKitWriter.getLiveWorkoutMetrics();
    return {
      success: true,
      isActive: result.isActive,
      elapsed: result.elapsed,
      calories: result.calories,
      avgHr: result.avgHr,
      maxHr: result.maxHr,
      lastHr: result.lastHr,
      sampleCount: result.sampleCount
    };
  } catch (error) {
    console.error('Failed to get live workout metrics:', error);
    return { success: false, reason: 'error', error: error.message, isActive: false };
  }
}

// ============================================================
// Legacy Observer Methods (backward compatibility)
// ============================================================

// Start observing HealthKit metrics in real-time
// Call this when starting a workout to begin capturing HR and calories
export async function startObservingWorkoutMetrics() {
  if (!Capacitor.isNativePlatform()) {
    console.log('Not on native platform, cannot observe metrics');
    return { success: false, reason: 'not_native' };
  }

  try {
    const result = await HealthKitWriter.startObservingMetrics();
    console.log('Started observing HealthKit metrics:', result);
    return { success: true, startDate: result.startDate, isLiveWorkout: result.isLiveWorkout };
  } catch (error) {
    console.error('Failed to start observing metrics:', error);
    return { success: false, reason: 'error', error: error.message };
  }
}

// Stop observing HealthKit metrics
// Call this when finishing a workout to get final accumulated metrics
export async function stopObservingWorkoutMetrics() {
  if (!Capacitor.isNativePlatform()) {
    return { success: false, reason: 'not_native' };
  }

  try {
    const result = await HealthKitWriter.stopObservingMetrics();
    console.log('Stopped observing HealthKit metrics:', result);
    return {
      success: true,
      calories: result.calories,
      avgHr: result.avgHr,
      maxHr: result.maxHr,
      sampleCount: result.sampleCount
    };
  } catch (error) {
    console.error('Failed to stop observing metrics:', error);
    return { success: false, reason: 'error', error: error.message };
  }
}

// Get the latest accumulated metrics without stopping observation
export async function getLatestWorkoutMetrics() {
  if (!Capacitor.isNativePlatform()) {
    return { success: false, reason: 'not_native' };
  }

  try {
    const result = await HealthKitWriter.getLatestMetrics();
    return {
      success: true,
      calories: result.calories,
      avgHr: result.avgHr,
      maxHr: result.maxHr,
      lastHr: result.lastHr,
      sampleCount: result.sampleCount,
      isObserving: result.isObserving
    };
  } catch (error) {
    console.error('Failed to get latest metrics:', error);
    return { success: false, reason: 'error', error: error.message };
  }
}

// Add listener for real-time metric updates
// Returns a function to remove the listener
export function addMetricsUpdateListener(callback) {
  if (!Capacitor.isNativePlatform()) {
    return () => {}; // No-op remove function
  }

  const handle = HealthKitWriter.addListener('metricsUpdated', (data) => {
    console.log('HealthKit metrics updated:', data);
    callback(data);
  });

  // Return function to remove listener
  return () => {
    handle.then(h => h.remove());
  };
}
