import { Capacitor, registerPlugin } from '@capacitor/core';
import { Health } from '@capgo/capacitor-health';

// Register the local HealthKitWriter plugin for writing workouts
const HealthKitWriter = registerPlugin('HealthKitWriter');
export { HealthKitWriter };

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
  if (!Capacitor.isNativePlatform()) {
    return false;
  }

  try {
    const result = await withTimeout(
      Health.isAvailable(),
      5000,
      'isAvailable timed out'
    );
    return result.available;
  } catch (error) {
    return false;
  }
}

// Request authorization for reading workout data (including heart rate)
export async function requestHealthKitAuthorization() {
  if (!Capacitor.isNativePlatform()) return false;

  try {
    await Health.requestAuthorization({
      read: ['steps', 'calories', 'workouts', 'heartRate'],
      write: []
    });
    return true;
  } catch (error) {
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

// Map HKWorkoutActivityType raw values to our camelCase keys
// Used as fallback when the plugin's WorkoutType enum doesn't cover a type and returns "other"
// Raw values from Apple's HKWorkoutActivityType enum
const hkRawTypeMap = {
  1: 'americanFootball',
  4: 'badminton',
  5: 'baseball',
  6: 'basketball',
  8: 'boxing',
  11: 'crossTraining',
  13: 'cycling',
  14: 'dance',
  16: 'elliptical',
  20: 'functionalStrengthTraining',
  21: 'golf',
  24: 'hiking',
  28: 'martialArts',
  29: 'mindAndBody',
  35: 'rowing',
  37: 'running',
  41: 'soccer',
  44: 'stairClimbing',
  46: 'swimming',
  48: 'tennis',
  50: 'traditionalStrengthTraining',
  52: 'walking',
  57: 'yoga',
  59: 'coreTraining',
  62: 'flexibility',
  63: 'highIntensityIntervalTraining',
  66: 'pilates',
  80: 'cooldown',
};

// Convert HealthKit workout to our activity format
function convertWorkoutToActivity(workout) {
  let workoutType = workout.workoutActivityType || workout.workoutType || 'HKWorkoutActivityTypeOther';

  // If the plugin returned "other" but we have the raw HK type number,
  // try to recover the actual workout type (plugin has limited enum coverage)
  if (workoutType === 'other' && workout.workoutActivityTypeRaw !== undefined) {
    const recovered = hkRawTypeMap[workout.workoutActivityTypeRaw];
    if (recovered) {
      workoutType = recovered;
    }
  }

  const mapped = workoutTypeMap[workoutType] || { type: 'Other', subtype: 'Workout', icon: '💪' };
  const appleWorkoutName = appleWorkoutNameMap[workoutType] || 'Workout';

  // Parse date (use local time, not UTC, to avoid date shifting for evening workouts)
  const startDate = new Date(workout.startDate);
  const dateStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
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
  } else {
    // Fallback: calculate from start/end dates
    const endDate = new Date(workout.endDate);
    const durationMs = endDate - startDate;
    durationMinutes = Math.round(durationMs / (1000 * 60));
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
  // The plugin doesn't return a unique workout UUID, only sourceId (which is the device ID)
  // So we create a unique ID from startDate + duration + workoutType to distinguish workouts
  const workoutSignature = `${workout.startDate}_${workout.duration || durationMinutes}_${workout.workoutType || 'other'}`;
  const uniqueId = workout.uuid || workoutSignature;

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

// Query heart rate samples from HealthKit for a specific time range
// Uses the native HealthKitWriter plugin to access HR data
export async function queryHeartRateForTimeRange(startDate, endDate) {
  if (!Capacitor.isNativePlatform()) return null;

  try {
    const result = await HealthKitWriter.queryHeartRate({
      startDate: typeof startDate === 'string' ? startDate : startDate.toISOString(),
      endDate: typeof endDate === 'string' ? endDate : endDate.toISOString()
    });
    return result.hasData ? { avgHr: result.avgHr, maxHr: result.maxHr } : null;
  } catch (error) {
    return null;
  }
}

// Query the highest recorded heart rate from HealthKit over a time range
// Used to auto-detect the user's max heart rate for Smart Save zones
export async function queryMaxHeartRateFromHealthKit(days = 90) {
  if (!Capacitor.isNativePlatform()) return null;

  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const result = await HealthKitWriter.queryHeartRate({
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString()
    });

    return result.hasData ? result.maxHr : null;
  } catch (error) {
    return null;
  }
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

    // Convert HealthKit workouts to our format, filter, and fetch heart rate data
    const filteredWorkouts = result.workouts.filter(workout => {
      // Exclude workouts created by DaySeven
      const sourceName = (workout.sourceName || '').toLowerCase();
      return !sourceName.includes('dayseven');
    });

    // Convert workouts and fetch heart rate for each
    const activities = await Promise.all(
      filteredWorkouts.map(async (workout) => {
        const activity = convertWorkoutToActivity(workout);

        // If no heart rate data from the workout object, query it separately
        // Use timeout to prevent blocking if HR permission dialog is pending
        if (!activity.avgHr && !activity.maxHr) {
          try {
            const hrData = await withTimeout(
              queryHeartRateForTimeRange(workout.startDate, workout.endDate),
              5000,
              'HR query timed out'
            );
            if (hrData) {
              activity.avgHr = hrData.avgHr;
              activity.maxHr = hrData.maxHr;
            }
          } catch {
            // HR query timed out or failed - continue without HR data
          }
        }

        return activity;
      })
    );

    // Sort by date (most recent first)
    activities.sort((a, b) => {
      const dateA = new Date(a.date + 'T' + (a.time || '00:00'));
      const dateB = new Date(b.date + 'T' + (b.time || '00:00'));
      return dateB - dateA;
    });

    return activities;
  } catch (error) {
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

    // Filter workouts and convert
    const filteredWorkouts = result.workouts
      .filter(workout => {
        // Exclude workouts created by DaySeven
        const sourceName = (workout.sourceName || '').toLowerCase();
        return !sourceName.includes('dayseven');
      });

    // Convert workouts and fetch heart rate for each
    const activities = await Promise.all(
      filteredWorkouts.map(async (workout) => {
        const activity = convertWorkoutToActivity(workout);

        // If no heart rate data from the workout object, query it separately
        // Use timeout to prevent blocking if HR permission dialog is pending
        if (!activity.avgHr && !activity.maxHr) {
          try {
            const hrData = await withTimeout(
              queryHeartRateForTimeRange(workout.startDate, workout.endDate),
              5000,
              'HR query timed out'
            );
            if (hrData) {
              activity.avgHr = hrData.avgHr;
              activity.maxHr = hrData.maxHr;
            }
          } catch {
            // HR query timed out or failed - continue without HR data
          }
        }

        return activity;
      })
    );

    // Filter out already linked workouts
    const unlinkedActivities = activities.filter(
      activity => !linkedWorkoutIds.includes(activity.healthKitUUID)
    );

    // Sort by time (most recent first)
    unlinkedActivities.sort((a, b) => {
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

    return unlinkedActivities;
  } catch (error) {
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

    // Use queryAggregated - HealthKit's HKStatisticsQuery should handle
    // de-duplication automatically when using cumulativeSum
    const result = await Health.queryAggregated({
      dataType: 'steps',
      startDate: today.toISOString(),
      endDate: now.toISOString()
    });

    // The result should have a single aggregated value
    if (result.samples && result.samples.length > 0) {
      // Sum all daily buckets (should typically be just one for today)
      const total = result.samples.reduce((sum, s) => sum + (s.value || 0), 0);
      return Math.round(total);
    } else if (result.value !== undefined) {
      return Math.round(result.value);
    }
    return 0;
  } catch (error) {
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

    // Use queryAggregated - HealthKit's HKStatisticsQuery should handle
    // de-duplication automatically when using cumulativeSum
    const result = await Health.queryAggregated({
      dataType: 'calories',
      startDate: today.toISOString(),
      endDate: now.toISOString()
    });

    // The result should have a single aggregated value
    if (result.samples && result.samples.length > 0) {
      // If there's only one sample, use it directly
      if (result.samples.length === 1) {
        return Math.round(result.samples[0].value || 0);
      }

      // If multiple samples, they might be hourly buckets - sum them
      const total = result.samples.reduce((sum, s) => sum + (s.value || 0), 0);
      return Math.round(total);
    } else if (result.value !== undefined) {
      return Math.round(result.value);
    }
    return 0;
  } catch (error) {
    return null;
  }
}

// Main function to sync HealthKit data
export async function syncHealthKitData() {
  // Check availability
  const available = await isHealthKitAvailable();
  if (!available) {
    return { success: false, reason: 'not_available' };
  }

  // Request authorization
  const authorized = await requestHealthKitAuthorization();
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
    'Cold Plunge': 'Cold Plunge',
    'Sauna': 'Sauna',
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
      if (caloriesResult.value !== undefined && caloriesResult.value > 0) {
        metrics.calories = Math.round(caloriesResult.value);
      } else if (caloriesResult.samples && caloriesResult.samples.length > 0) {
        const total = caloriesResult.samples.reduce((sum, sample) => sum + (sample.value || 0), 0);
        if (total > 0) {
          metrics.calories = Math.round(total);
        }
      }
    } catch (error) {
      // calories fetch failed
    }

    // Note: Heart rate querying via Health.query({ dataType: 'heartRate' }) is not
    // supported by the @capgo/capacitor-health plugin. HR data is available directly
    // from workout objects when using queryWorkouts(). For live workouts, HR comes
    // from the native HealthKitWriter plugin's observer queries.

    const hasData = metrics.calories || metrics.avgHr || metrics.maxHr;

    return {
      success: true,
      hasData,
      metrics
    };
  } catch (error) {
    return { success: false, reason: 'error', error: error.message };
  }
}

// Save a workout to HealthKit
// Note: We intentionally do NOT write calories for manually logged workouts.
// If users have a tracker (Apple Watch, Whoop, etc.), those devices already record
// active calories to HealthKit. Writing manually entered calories would cause
// double-counting when we read back the daily total from HealthKit.
export async function saveWorkoutToHealthKit(activity) {
  if (!Capacitor.isNativePlatform()) {
    return { success: false, reason: 'not_native' };
  }

  try {
    // Check authorization first
    let authorized = await checkHealthKitWriteAuthorization();
    if (!authorized) {
      // Try to request authorization
      authorized = await requestHealthKitWriteAuthorization();
      if (!authorized) {
        return { success: false, reason: 'not_authorized' };
      }
    }

    // Get HealthKit activity type
    const activityType = getHealthKitActivityType(activity);

    // Calculate dates
    const { startDate, endDate } = calculateWorkoutDates(activity);

    // Build workout data - only include type and dates, NOT calories
    // Calories are tracked by the user's devices (Apple Watch, Whoop, etc.)
    // and writing them here would cause double-counting
    const workoutData = {
      activityType,
      startDate,
      endDate,
    };

    // Add distance if available (this doesn't cause double-counting issues)
    if (activity.distance && activity.distance > 0) {
      // Convert miles to meters (HealthKit uses meters)
      workoutData.distance = activity.distance * 1609.34;
    }

    const result = await HealthKitWriter.saveWorkout(workoutData);

    return { success: true, workoutUUID: result.workoutUUID };

  } catch (error) {
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
    return { success: false, reason: 'not_native' };
  }

  try {
    const result = await HealthKitWriter.startLiveWorkout({ activityType });
    return {
      success: true,
      startDate: result.startDate,
      activityType: result.activityType
    };
  } catch (error) {
    return { success: false, reason: 'error', error: error.message };
  }
}

// End a live workout session - saves the workout to HealthKit with all collected metrics
// Returns the final metrics and workout UUID
// Note: We do NOT write calories to HealthKit here - they're already tracked by the user's
// Apple Watch/device during the workout. Writing them would cause double-counting.
export async function endLiveWorkout(options = {}) {
  if (!Capacitor.isNativePlatform()) {
    return { success: false, reason: 'not_native' };
  }

  try {
    const params = {};
    // Only pass distance - calories are already in HealthKit from the user's device
    if (options.distance) params.distance = options.distance * 1609.34; // Convert miles to meters

    const result = await HealthKitWriter.endLiveWorkout(params);
    return {
      success: true,
      workoutUUID: result.workoutUUID,
      duration: result.duration,
      calories: result.calories, // This is read from HealthKit, not written
      avgHr: result.avgHr,
      maxHr: result.maxHr,
      sampleCount: result.sampleCount
    };
  } catch (error) {
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
    return { success: true };
  } catch (error) {
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
    return { success: false, reason: 'not_native' };
  }

  try {
    const result = await HealthKitWriter.startObservingMetrics();
    return { success: true, startDate: result.startDate, isLiveWorkout: result.isLiveWorkout };
  } catch (error) {
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
    return {
      success: true,
      calories: result.calories,
      avgHr: result.avgHr,
      maxHr: result.maxHr,
      sampleCount: result.sampleCount
    };
  } catch (error) {
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
    callback(data);
  });

  // Return function to remove listener
  return () => {
    handle.then(h => h.remove());
  };
}

// =============================================
// WATCH WORKOUT CONTROL (via WatchConnectivity)
// =============================================

// Check if Apple Watch is reachable
export async function isWatchReachable() {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const result = await HealthKitWriter.isWatchReachable();
    return result.reachable;
  } catch {
    return false;
  }
}

// Start a workout on the Apple Watch
export async function startWatchWorkout(activityType, strengthType = null, subtype = null, focusAreas = null) {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Not available on web');
  }
  const params = { activityType };
  if (strengthType) params.strengthType = strengthType;
  if (subtype) params.subtype = subtype;
  if (focusAreas) params.focusAreas = focusAreas;
  // Also send first element as focusArea for backward compat
  if (focusAreas && focusAreas.length > 0) params.focusArea = focusAreas[0];
  return await HealthKitWriter.startWatchWorkout(params);
}

// End the active workout on the Apple Watch — returns final metrics
export async function endWatchWorkout() {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Not available on web');
  }
  return await HealthKitWriter.endWatchWorkout();
}

// Pause the active workout on the Apple Watch
export async function pauseWatchWorkout() {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Not available on web');
  }
  return await HealthKitWriter.pauseWatchWorkout();
}

// Resume the active workout on the Apple Watch
export async function resumeWatchWorkout() {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Not available on web');
  }
  return await HealthKitWriter.resumeWatchWorkout();
}

// Get current metrics from the active workout on the Apple Watch
export async function getWatchWorkoutMetrics() {
  if (!Capacitor.isNativePlatform()) {
    return { isActive: false };
  }
  try {
    return await HealthKitWriter.getWatchWorkoutMetrics();
  } catch {
    return { isActive: false };
  }
}

// Cancel/discard the active workout on the Apple Watch
export async function cancelWatchWorkout() {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Not available on web');
  }
  return await HealthKitWriter.cancelWatchWorkout();
}

// Listen for watch workout started (when user starts workout directly on watch)
// Returns a function to remove the listener
export function addWatchWorkoutStartedListener(callback) {
  if (!Capacitor.isNativePlatform()) {
    return () => {};
  }
  const handle = HealthKitWriter.addListener('watchWorkoutStarted', (data) => {
    callback(data);
  });
  return () => {
    handle.then(h => h.remove());
  };
}

// Listen for watch workout ended (when user ends/discards workout on watch)
// Returns a function to remove the listener
export function addWatchWorkoutEndedListener(callback) {
  if (!Capacitor.isNativePlatform()) {
    return () => {};
  }
  const handle = HealthKitWriter.addListener('watchWorkoutEnded', (data) => {
    callback(data);
  });
  return () => {
    handle.then(h => h.remove());
  };
}

// Notify the watch that phone data changed (e.g., activity deleted)
// so the watch reloads from Firestore and doesn't operate on stale state
export async function notifyWatchDataChanged() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await HealthKitWriter.notifyWatchDataChanged();
  } catch (e) {
    // Non-critical — watch will eventually refresh on its own
  }
}

// Listen for watch activity saved (when watch saves an activity to Firestore)
// Used to trigger celebration checks on the phone when goals are met on watch
export function addWatchActivitySavedListener(callback) {
  if (!Capacitor.isNativePlatform()) {
    return () => {};
  }
  const handle = HealthKitWriter.addListener('watchActivitySaved', (data) => {
    callback(data);
  });
  return () => {
    handle.then(h => h.remove());
  };
}
