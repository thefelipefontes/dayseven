import { doc, getDoc, getDocFromServer, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, writeBatch } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '../firebase';
import { Capacitor } from '@capacitor/core';
import { FirebaseFirestore } from '@capacitor-firebase/firestore';
import { FirebaseStorage } from '@capacitor-firebase/storage';
import { Filesystem, Directory } from '@capacitor/filesystem';

// Convert a Date to YYYY-MM-DD string in local timezone (avoids UTC date shifting)
const toLocalDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Check if running in native app
const isNative = Capacitor.isNativePlatform();

// Simple in-memory cache for frequently accessed data
const cache = {
  userProfiles: new Map(),
  userActivities: new Map(),
  userGoals: new Map(),
  customActivities: new Map(),
  cacheExpiry: 60000, // 1 minute cache expiry
  timestamps: new Map(),
};

// Check if cache is still valid
const isCacheValid = (key) => {
  const timestamp = cache.timestamps.get(key);
  if (!timestamp) return false;
  return Date.now() - timestamp < cache.cacheExpiry;
};

// Set cache with timestamp
const setCache = (cacheMap, key, value) => {
  cacheMap.set(key, value);
  cache.timestamps.set(`${cacheMap}_${key}`, Date.now());
};

// Clear cache for a specific user (call after updates)
export const clearUserCache = (uid) => {
  cache.userProfiles.delete(uid);
  cache.userActivities.delete(uid);
  cache.userGoals.delete(uid);
  cache.customActivities.delete(uid);
  // Also clear timestamps
  cache.timestamps.delete(`profile_${uid}`);
  cache.timestamps.delete(`activities_${uid}`);
  cache.timestamps.delete(`goals_${uid}`);
  cache.timestamps.delete(`customActivities_${uid}`);
};

// Helper function to add timeout to Firestore operations (for web SDK fallback)
const withTimeout = (promise, timeoutMs = 10000) => {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Firestore operation timed out')), timeoutMs)
    )
  ]);
};

// Retry wrapper for transient failures
const withRetry = async (fn, maxRetries = 2, delayMs = 500) => {
  let lastError;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < maxRetries) {
        // Only retry on network/timeout errors, not permission errors
        if (error.code === 'permission-denied' || error.code === 'not-found') {
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, delayMs * (i + 1)));
      }
    }
  }
  throw lastError;
};

// Firebase project ID for REST API calls
const FIREBASE_PROJECT_ID = 'dayseven-f1a89';

// Convert a JS value to Firestore REST API format
// Used for REST-based writes to bypass Firestore SDK's offline persistence queue
const jsToFirestoreValue = (value) => {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return value.length > 0
      ? { arrayValue: { values: value.map(jsToFirestoreValue) } }
      : { arrayValue: {} };
  }
  if (typeof value === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) fields[k] = jsToFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
};

// Track last known server activity count to guard against stale writes
let lastKnownServerActivityCount = 0;

export async function createUserProfile(user) {
  const path = `users/${user.uid}`;

  try {
    if (isNative) {
      // Use native Firestore
      const { snapshot } = await FirebaseFirestore.getDocument({ reference: path });

      if (!snapshot?.data) {
        // Use merge: true so we never wipe existing data (e.g. goals, hasCompletedOnboarding)
        // Only include safe profile metadata — onboarding fields are set by the onboarding flow itself
        await FirebaseFirestore.setDocument({
          reference: path,
          data: {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName || null,
            photoURL: user.photoURL || null,
            authProvider: user.authProvider || null,
            createdAt: new Date().toISOString()
          },
          merge: true
        });
      } else if (user.authProvider && !snapshot.data.authProvider) {
        // Update authProvider if it wasn't set before (for existing users)
        await FirebaseFirestore.setDocument({
          reference: path,
          data: { authProvider: user.authProvider },
          merge: true
        });
      }
    } else {
      // Use web Firestore
      const userRef = doc(db, 'users', user.uid);
      const userDoc = await withTimeout(getDoc(userRef));

      if (!userDoc.exists()) {
        // Use merge: true so we never wipe existing data (e.g. goals, hasCompletedOnboarding)
        // Only include safe profile metadata — onboarding fields are set by the onboarding flow itself
        await withTimeout(setDoc(userRef, {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName || null,
          photoURL: user.photoURL || null,
          authProvider: user.authProvider || null,
          createdAt: new Date().toISOString()
        }, { merge: true }));
      } else if (user.authProvider && !userDoc.data().authProvider) {
        // Update authProvider if it wasn't set before (for existing users)
        await withTimeout(setDoc(userRef, { authProvider: user.authProvider }, { merge: true }));
      }
    }
  } catch (error) {
    // Continue anyway - profile will be created later
  }

  return path;
}

export async function getUserProfile(uid, forceRefresh = false) {
  // Check cache first (unless force refresh)
  const cacheKey = `profile_${uid}`;
  if (!forceRefresh && cache.userProfiles.has(uid) && isCacheValid(cacheKey)) {
    return cache.userProfiles.get(uid);
  }

  const path = `users/${uid}`;

  try {
    let profile;
    if (isNative && forceRefresh) {
      // Bypass Capacitor Firestore SDK cache by calling REST API directly
      // This ensures we get fresh data (e.g., weekCelebrations set by watch)
      try {
        const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
        const { token } = await FirebaseAuthentication.getIdToken();
        const restUrl = `https://firestore.googleapis.com/v1/projects/dayseven-f1a89/databases/(default)/documents/users/${uid}`;
        const response = await fetch(restUrl, {
          headers: { 'Authorization': `Bearer ${token}` },
          cache: 'no-store'
        });
        const json = await response.json();
        const fields = json?.fields;
        if (fields) {
          profile = parseFirestoreFields(fields);
        } else {
          profile = null;
        }
      } catch (restErr) {
        console.warn('[getUserProfile] REST failed, using Capacitor:', restErr);
        const { snapshot } = await FirebaseFirestore.getDocument({ reference: path });
        profile = snapshot?.data || null;
      }
    } else if (isNative) {
      const { snapshot } = await FirebaseFirestore.getDocument({ reference: path });
      profile = snapshot?.data || null;
    } else {
      const userRef = doc(db, 'users', uid);
      const userDoc = await withTimeout(getDoc(userRef));
      profile = userDoc.exists() ? userDoc.data() : null;
    }

    // Cache the result
    if (profile) {
      cache.userProfiles.set(uid, profile);
      cache.timestamps.set(cacheKey, Date.now());
    }

    return profile;
  } catch (error) {
    // Return cached data if available, even if expired
    if (cache.userProfiles.has(uid)) {
      return cache.userProfiles.get(uid);
    }
    return null;
  }
}

// Parse Firestore REST API fields into plain JS objects
function parseFirestoreFields(fields) {
  const result = {};
  for (const [key, val] of Object.entries(fields)) {
    result[key] = parseFirestoreValue(val);
  }
  return result;
}

function parseFirestoreValue(val) {
  if (val.stringValue !== undefined) return val.stringValue;
  if (val.integerValue !== undefined) return parseInt(val.integerValue);
  if (val.doubleValue !== undefined) return val.doubleValue;
  if (val.booleanValue !== undefined) return val.booleanValue;
  if (val.nullValue !== undefined) return null;
  if (val.timestampValue !== undefined) return val.timestampValue;
  if (val.arrayValue) {
    return (val.arrayValue.values || []).map(v => parseFirestoreValue(v));
  }
  if (val.mapValue) {
    return parseFirestoreFields(val.mapValue.fields || {});
  }
  return null;
}

export async function updateUserProfile(uid, data) {
  const path = `users/${uid}`;

  // Optimistically update cache if we have it
  if (cache.userProfiles.has(uid)) {
    const current = cache.userProfiles.get(uid);
    cache.userProfiles.set(uid, { ...current, ...data });
    cache.timestamps.set(`profile_${uid}`, Date.now());
  }

  try {
    // Use setDocument with merge instead of updateDocument to prevent
    // Firestore SDK offline cache issues from wiping unrelated fields
    if (isNative) {
      await FirebaseFirestore.setDocument({
        reference: path,
        data: data,
        merge: true
      });
    } else {
      const userRef = doc(db, 'users', uid);
      await withTimeout(setDoc(userRef, data, { merge: true }));
    }
  } catch (error) {
    // Revert cache on error
    cache.userProfiles.delete(uid);
    throw error;
  }
}

export async function saveUserActivities(uid, activities, { allowDecrease = false } = {}) {
  const cleanedActivities = activities.map(activity => {
    return Object.fromEntries(
      Object.entries(activity).filter(([_, value]) => value !== undefined)
    );
  });

  // Guard against stale writes: never overwrite Firestore with fewer activities
  // unless explicitly allowed (e.g., user deleted an activity on the phone).
  // This catches race conditions from SDK offline queue replays, stale closures, etc.
  if (!allowDecrease && cleanedActivities.length < lastKnownServerActivityCount) {
    console.warn(`[saveUserActivities] BLOCKED stale write: tried to save ${cleanedActivities.length} but server has ${lastKnownServerActivityCount}`);
    return;
  }

  // Update cache immediately (optimistic update)
  cache.userActivities.set(uid, cleanedActivities);
  cache.timestamps.set(`activities_${uid}`, Date.now());
  lastKnownServerActivityCount = cleanedActivities.length;

  try {
    await withRetry(async () => {
      if (isNative) {
        // Use REST API for writes to bypass Firestore SDK's offline persistence queue.
        // The native SDK queues writes when the app is backgrounded and replays them
        // when the app is foregrounded. If the phone's JS was suspended with stale
        // React state, those queued writes overwrite watch-saved data with stale data.
        // REST writes go directly to the server with no local queue.
        const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
        const { token } = await FirebaseAuthentication.getIdToken();
        const restUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${uid}?updateMask.fieldPaths=activities`;

        const body = {
          fields: {
            activities: jsToFirestoreValue(cleanedActivities)
          }
        };

        const response = await fetch(restUrl, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body),
          cache: 'no-store'
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`REST save failed: ${response.status} ${text}`);
        }
        console.log('[saveUserActivities] REST save successful:', cleanedActivities.length, 'activities');
      } else {
        const userRef = doc(db, 'users', uid);
        await withTimeout(setDoc(userRef, { activities: cleanedActivities }, { merge: true }));
      }
    });
  } catch (error) {
    console.error('[saveUserActivities] Save failed:', error.message);
    // Cache is already updated, so user sees changes immediately
    // Error will be logged but won't block the UI
    // On next refresh, data will sync
  }
}

export async function getUserActivities(uid, forceRefresh = false) {
  // Check cache first (unless force refresh)
  if (!forceRefresh && cache.userActivities.has(uid) && isCacheValid(`activities_${uid}`)) {
    return cache.userActivities.get(uid);
  }

  const path = `users/${uid}`;

  try {
    let activities;
    if (isNative && forceRefresh) {
      // Bypass Capacitor Firestore cache by calling REST API directly
      try {
        const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
        const { token } = await FirebaseAuthentication.getIdToken();
        const restUrl = `https://firestore.googleapis.com/v1/projects/dayseven-f1a89/databases/(default)/documents/users/${uid}?mask.fieldPaths=activities`;
        console.log('[getUserActivities] REST fetch starting...');
        const response = await fetch(restUrl, {
          headers: { 'Authorization': `Bearer ${token}` },
          cache: 'no-store'
        });
        console.log('[getUserActivities] REST response status:', response.status);
        const json = await response.json();
        // Parse Firestore REST format
        const parseFirestoreValue = (val) => {
          if (val.stringValue !== undefined) return val.stringValue;
          if (val.integerValue !== undefined) return parseInt(val.integerValue);
          if (val.doubleValue !== undefined) return val.doubleValue;
          if (val.booleanValue !== undefined) return val.booleanValue;
          if (val.nullValue !== undefined) return null;
          if (val.arrayValue) return (val.arrayValue.values || []).map(parseFirestoreValue);
          if (val.mapValue) {
            const obj = {};
            for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
              obj[k] = parseFirestoreValue(v);
            }
            return obj;
          }
          return undefined;
        };
        const activitiesField = json?.fields?.activities;
        if (activitiesField?.arrayValue?.values) {
          activities = activitiesField.arrayValue.values.map(v => {
            const fields = v.mapValue?.fields || {};
            const parsed = {};
            for (const [key, val] of Object.entries(fields)) {
              const parsedVal = parseFirestoreValue(val);
              if (parsedVal !== undefined) parsed[key] = parsedVal;
            }
            return parsed;
          });
          console.log('[getUserActivities] REST got', activities.length, 'activities');
        } else {
          console.log('[getUserActivities] REST: no activities array in response, keys:', Object.keys(json?.fields || {}));
          activities = [];
        }
      } catch (restErr) {
        console.warn('[getUserActivities] REST failed, using Capacitor:', restErr);
        const { snapshot } = await FirebaseFirestore.getDocument({ reference: path });
        activities = snapshot?.data?.activities || [];
      }
    } else if (isNative) {
      const { snapshot } = await FirebaseFirestore.getDocument({ reference: path });
      activities = snapshot?.data?.activities || [];
    } else {
      const userRef = doc(db, 'users', uid);
      const userDoc = await withTimeout(getDoc(userRef));
      activities = userDoc.exists() ? (userDoc.data().activities || []) : [];
    }

    // Cache the result and update server count tracker
    cache.userActivities.set(uid, activities);
    cache.timestamps.set(`activities_${uid}`, Date.now());
    lastKnownServerActivityCount = Math.max(lastKnownServerActivityCount, activities.length);

    return activities;
  } catch (error) {
    // Return cached data if available, even if expired
    if (cache.userActivities.has(uid)) {
      return cache.userActivities.get(uid);
    }
    return [];
  }
}

export async function checkUsernameAvailable(username, currentUid = null) {
  const lowerUsername = username.toLowerCase();
  const path = `usernames/${lowerUsername}`;

  try {
    if (isNative) {
      // Check /usernames collection first
      const { snapshot } = await FirebaseFirestore.getDocument({ reference: path });
      if (snapshot?.data) {
        // Allow if it belongs to the current user (reclaiming their own username)
        if (currentUid && snapshot.data.uid === currentUid) return true;
        return false; // Reserved by someone else
      }

      // Also check /users collection for legacy users who don't have a /usernames doc
      const { snapshots } = await FirebaseFirestore.getCollection({
        reference: 'users',
        compositeFilter: {
          type: 'and',
          queryConstraints: [
            { type: 'where', fieldPath: 'username', opStr: '==', value: lowerUsername }
          ]
        }
      });
      if (snapshots?.length) {
        // Allow if the only match is the current user
        if (currentUid && snapshots.length === 1 && snapshots[0]?.id === currentUid) return true;
        return false;
      }
      return true;
    } else {
      // Check /usernames collection first
      const usernameRef = doc(db, 'usernames', lowerUsername);
      const usernameDoc = await getDoc(usernameRef);
      if (usernameDoc.exists()) {
        // Allow if it belongs to the current user
        if (currentUid && usernameDoc.data().uid === currentUid) return true;
        return false; // Reserved by someone else
      }

      // Also check /users collection for legacy users
      const usersQuery = query(collection(db, 'users'), where('username', '==', lowerUsername));
      const usersSnapshot = await getDocs(usersQuery);
      if (!usersSnapshot.empty) {
        if (currentUid && usersSnapshot.size === 1 && usersSnapshot.docs[0].id === currentUid) return true;
        return false;
      }
      return true;
    }
  } catch (error) {
    return true; // Assume available on error
  }
}

export async function saveUsername(uid, username) {
  const lowerUsername = username.toLowerCase();
  const userPath = `users/${uid}`;
  const usernamePath = `usernames/${lowerUsername}`;

  try {
    if (isNative) {
      await FirebaseFirestore.setDocument({
        reference: userPath,
        data: { username: lowerUsername },
        merge: true
      });
      await FirebaseFirestore.setDocument({
        reference: usernamePath,
        data: { uid }
      });
    } else {
      const userRef = doc(db, 'users', uid);
      await setDoc(userRef, { username: lowerUsername }, { merge: true });
      const usernameRef = doc(db, 'usernames', lowerUsername);
      await setDoc(usernameRef, { uid });
    }
  } catch (error) {
    throw error;
  }
}

export async function saveCustomActivities(uid, customActivities) {
  // Update cache immediately (optimistic update)
  cache.customActivities.set(uid, customActivities);
  cache.timestamps.set(`customActivities_${uid}`, Date.now());

  const path = `users/${uid}`;

  try {
    await withRetry(async () => {
      if (isNative) {
        await FirebaseFirestore.setDocument({
          reference: path,
          data: { customActivities },
          merge: true
        });
      } else {
        const userRef = doc(db, 'users', uid);
        await withTimeout(setDoc(userRef, { customActivities }, { merge: true }));
      }
    });
  } catch (error) {
    // Don't throw - optimistic update already applied
  }
}

export async function getCustomActivities(uid, forceRefresh = false) {
  // Check cache first
  if (!forceRefresh && cache.customActivities.has(uid) && isCacheValid(`customActivities_${uid}`)) {
    return cache.customActivities.get(uid);
  }

  const path = `users/${uid}`;

  try {
    let customActivities;
    if (isNative) {
      const { snapshot } = await FirebaseFirestore.getDocument({ reference: path });
      customActivities = snapshot?.data?.customActivities || [];
    } else {
      const userRef = doc(db, 'users', uid);
      const userDoc = await withTimeout(getDoc(userRef));
      customActivities = userDoc.exists() ? (userDoc.data().customActivities || []) : [];
    }

    // Cache the result
    cache.customActivities.set(uid, customActivities);
    cache.timestamps.set(`customActivities_${uid}`, Date.now());

    return customActivities;
  } catch (error) {
    // Return cached data if available
    if (cache.customActivities.has(uid)) {
      return cache.customActivities.get(uid);
    }
    return [];
  }
}

export async function saveUserGoals(uid, goals) {
  // Update cache immediately (optimistic update)
  cache.userGoals.set(uid, goals);
  cache.timestamps.set(`goals_${uid}`, Date.now());

  const path = `users/${uid}`;

  try {
    await withRetry(async () => {
      if (isNative) {
        await FirebaseFirestore.setDocument({
          reference: path,
          data: { goals },
          merge: true
        });
      } else {
        const userRef = doc(db, 'users', uid);
        await withTimeout(setDoc(userRef, { goals }, { merge: true }));
      }
    });
  } catch (error) {
    // Don't throw - optimistic update already applied
  }
}

export async function getUserGoals(uid, forceRefresh = false) {
  // Check cache first
  if (!forceRefresh && cache.userGoals.has(uid) && isCacheValid(`goals_${uid}`)) {
    return cache.userGoals.get(uid);
  }

  const path = `users/${uid}`;

  try {
    let goals;
    if (isNative) {
      const { snapshot } = await FirebaseFirestore.getDocument({ reference: path });
      goals = snapshot?.data?.goals || null;
    } else {
      const userRef = doc(db, 'users', uid);
      const userDoc = await withTimeout(getDoc(userRef));
      goals = userDoc.exists() ? (userDoc.data().goals || null) : null;
    }

    // Cache the result
    if (goals) {
      cache.userGoals.set(uid, goals);
      cache.timestamps.set(`goals_${uid}`, Date.now());
    }

    return goals;
  } catch (error) {
    // Return cached data if available
    if (cache.userGoals.has(uid)) {
      return cache.userGoals.get(uid);
    }
    return null;
  }
}

export async function setOnboardingComplete(uid) {
  const path = `users/${uid}`;

  try {
    if (isNative) {
      await FirebaseFirestore.setDocument({
        reference: path,
        data: { hasCompletedOnboarding: true },
        merge: true
      });
    } else {
      const userRef = doc(db, 'users', uid);
      await setDoc(userRef, { hasCompletedOnboarding: true }, { merge: true });
    }
  } catch (error) {
    throw error;
  }
}

export async function setTourComplete(uid) {
  const path = `users/${uid}`;

  try {
    if (isNative) {
      await FirebaseFirestore.setDocument({
        reference: path,
        data: { hasCompletedTour: true },
        merge: true
      });
    } else {
      const userRef = doc(db, 'users', uid);
      await setDoc(userRef, { hasCompletedTour: true }, { merge: true });
    }
  } catch (error) {
    throw error;
  }
}

export async function savePersonalRecords(uid, personalRecords) {
  const path = `users/${uid}`;

  try {
    await withRetry(async () => {
      if (isNative) {
        await FirebaseFirestore.setDocument({
          reference: path,
          data: { personalRecords },
          merge: true
        });
      } else {
        const userRef = doc(db, 'users', uid);
        await withTimeout(setDoc(userRef, { personalRecords }, { merge: true }));
      }
    });
  } catch (error) {
    // Don't throw - optimistic update already applied
  }
}

export async function getPersonalRecords(uid) {
  const path = `users/${uid}`;

  try {
    let personalRecords;
    if (isNative) {
      const { snapshot } = await FirebaseFirestore.getDocument({ reference: path });
      personalRecords = snapshot?.data?.personalRecords || null;
    } else {
      const userRef = doc(db, 'users', uid);
      const userDoc = await withTimeout(getDoc(userRef));
      personalRecords = userDoc.exists() ? (userDoc.data().personalRecords || null) : null;
    }

    return personalRecords;
  } catch (error) {
    return null;
  }
}

export async function uploadProfilePhoto(uid, file) {
  const storagePath = `profilePhotos/${uid}`;
  let downloadURL;

  if (isNative) {
    // Convert File/Blob to base64
    const base64 = await fileToBase64(file);

    // Save to temporary file
    const tempFileName = `temp_profile_${Date.now()}.jpg`;
    const writeResult = await Filesystem.writeFile({
      path: tempFileName,
      data: base64,
      directory: Directory.Cache
    });

    // Upload using native Firebase Storage
    await new Promise((resolve, reject) => {
      FirebaseStorage.uploadFile(
        {
          path: storagePath,
          uri: writeResult.uri
        },
        (event, error) => {
          if (error) {
            reject(error);
          } else if (event?.completed) {
            resolve();
          }
        }
      );
    });

    // Clean up temp file
    try {
      await Filesystem.deleteFile({
        path: tempFileName,
        directory: Directory.Cache
      });
    } catch (e) {
      // Ignore cleanup errors
    }

    // Get the download URL
    const result = await FirebaseStorage.getDownloadUrl({ path: storagePath });
    downloadURL = result.downloadUrl;
  } else {
    // Web SDK fallback
    const photoRef = ref(storage, storagePath);
    await uploadBytes(photoRef, file);
    downloadURL = await getDownloadURL(photoRef);
  }

  // Update the user's profile with the new photo URL
  await updateUserProfile(uid, { photoURL: downloadURL });

  return downloadURL;
}

// Helper function to convert File/Blob to base64
async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // Remove the data URL prefix (e.g., "data:image/jpeg;base64,")
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function uploadActivityPhoto(uid, activityId, file) {
  const timestamp = Date.now();
  const storagePath = `activityPhotos/${uid}/${activityId}/${timestamp}`;
  let downloadURL;

  if (isNative) {
    // Convert File/Blob to base64
    const base64 = await fileToBase64(file);

    // Save to temporary file
    const tempFileName = `temp_activity_${timestamp}.jpg`;
    const writeResult = await Filesystem.writeFile({
      path: tempFileName,
      data: base64,
      directory: Directory.Cache
    });

    // Upload using native Firebase Storage
    await new Promise((resolve, reject) => {
      FirebaseStorage.uploadFile(
        {
          path: storagePath,
          uri: writeResult.uri
        },
        (event, error) => {
          if (error) {
            reject(error);
          } else if (event?.completed) {
            resolve();
          }
        }
      );
    });

    // Clean up temp file
    try {
      await Filesystem.deleteFile({
        path: tempFileName,
        directory: Directory.Cache
      });
    } catch (e) {
      // Ignore cleanup errors
    }

    // Get the download URL
    const result = await FirebaseStorage.getDownloadUrl({ path: storagePath });
    downloadURL = result.downloadUrl;
  } else {
    // Web SDK fallback
    const photoRef = ref(storage, storagePath);
    await uploadBytes(photoRef, file);
    downloadURL = await getDownloadURL(photoRef);
  }

  return downloadURL;
}

export async function deleteActivityPhoto(photoURL) {
  if (!photoURL) return;

  try {
    if (isNative) {
      // Extract storage path from the Firebase Storage download URL
      // URLs contain the path encoded as: /o/path%2Fto%2Ffile?...
      const match = photoURL.match(/\/o\/(.+?)\?/);
      if (match) {
        const storagePath = decodeURIComponent(match[1]);
        await FirebaseStorage.deleteFile({ path: storagePath });
      }
    } else {
      // Web SDK ref() accepts full download URLs
      const photoRef = ref(storage, photoURL);
      await deleteObject(photoRef);
    }
  } catch (error) {
    console.warn('[Storage] Failed to delete activity photo:', error);
    // Don't throw — photo cleanup failure shouldn't block deletion
  }
}

export async function deleteUserAccount(uid, username) {
  try {
    if (isNative) {
      // Native: Delete username document
      if (username) {
        try {
          await FirebaseFirestore.deleteDocument({
            reference: `usernames/${username.toLowerCase()}`
          });
        } catch (e) {
          // username deletion failed
        }
      }

      // Native: Get and delete friends subcollection
      try {
        const { snapshots: friendSnapshots } = await FirebaseFirestore.getCollection({
          reference: `users/${uid}/friends`
        });
        if (friendSnapshots) {
          for (const snap of friendSnapshots) {
            // Remove this user from their friend's list
            try {
              await FirebaseFirestore.deleteDocument({
                reference: `users/${snap.data.friendUid}/friends/${uid}`
              });
            } catch (e) {
              // Friend may have already removed us
            }
            // Delete from our list
            await FirebaseFirestore.deleteDocument({
              reference: `users/${uid}/friends/${snap.id}`
            });
          }
        }
      } catch (e) {
        // friends deletion failed
      }

      // Native: Delete the user document
      await FirebaseFirestore.deleteDocument({
        reference: `users/${uid}`
      });

    } else {
      // Web SDK implementation
      const batch = writeBatch(db);

      // Delete username document
      if (username) {
        const usernameRef = doc(db, 'usernames', username.toLowerCase());
        batch.delete(usernameRef);
      }

      // Get and delete friends - also remove from their friend lists
      try {
        const friendsRef = collection(db, 'users', uid, 'friends');
        const friendsSnapshot = await getDocs(friendsRef);

        for (const friendDoc of friendsSnapshot.docs) {
          const friendData = friendDoc.data();
          // Remove this user from their friend's list
          const reverseFriendRef = doc(db, 'users', friendData.friendUid, 'friends', uid);
          batch.delete(reverseFriendRef);
          // Delete from our list
          batch.delete(friendDoc.ref);
        }
      } catch (e) {
        // friends processing failed
      }

      // Delete friend requests involving this user
      try {
        const sentRequestsQuery = query(collection(db, 'friendRequests'), where('fromUid', '==', uid));
        const sentSnapshot = await getDocs(sentRequestsQuery);
        sentSnapshot.docs.forEach(doc => batch.delete(doc.ref));

        const receivedRequestsQuery = query(collection(db, 'friendRequests'), where('toUid', '==', uid));
        const receivedSnapshot = await getDocs(receivedRequestsQuery);
        receivedSnapshot.docs.forEach(doc => batch.delete(doc.ref));
      } catch (e) {
        // friend requests deletion failed
      }

      // Delete the user document
      const userRef = doc(db, 'users', uid);
      batch.delete(userRef);

      // Commit all deletes
      await batch.commit();
    }

    // Clear all caches for this user
    clearUserCache(uid);

    return true;
  } catch (error) {
    throw error;
  }
}

// Daily Health Data - for syncing HealthKit data to Firestore for desktop access

// Cache for daily health data
const dailyHealthCache = new Map();

/**
 * Save daily health data (steps and calories) to Firestore
 * @param {string} uid - User ID
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {number} steps - Step count for the day
 * @param {number} calories - Calories burned for the day
 * @returns {Promise<boolean>} - True if saved successfully
 */
export async function saveDailyHealthData(uid, date, steps, calories) {
  const path = `users/${uid}/dailyHealth/${date}`;
  const data = {
    date,
    steps: steps || 0,
    calories: calories || 0,
    lastUpdated: new Date().toISOString()
  };

  // Update cache immediately (optimistic update)
  dailyHealthCache.set(`${uid}_${date}`, { ...data, _cachedAt: Date.now() });

  try {
    if (isNative) {
      await FirebaseFirestore.setDocument({
        reference: path,
        data: data,
        merge: true
      });
    } else {
      const docRef = doc(db, 'users', uid, 'dailyHealth', date);
      await withTimeout(setDoc(docRef, data, { merge: true }));
    }
    return true;
  } catch (error) {
    // Don't throw - optimistic update already applied
    return false;
  }
}

/**
 * Get daily health data for a specific date
 * @param {string} uid - User ID
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {Promise<{date: string, steps: number, calories: number, lastUpdated: string} | null>}
 */
export async function getDailyHealthData(uid, date) {
  // Check cache first
  const cacheKey = `${uid}_${date}`;
  const cached = dailyHealthCache.get(cacheKey);
  if (cached && (Date.now() - cached._cachedAt) < cache.cacheExpiry) {
    const { _cachedAt, ...data } = cached;
    return data;
  }

  const path = `users/${uid}/dailyHealth/${date}`;

  try {
    let data;
    if (isNative) {
      const { snapshot } = await FirebaseFirestore.getDocument({ reference: path });
      data = snapshot?.data || null;
    } else {
      const docRef = doc(db, 'users', uid, 'dailyHealth', date);
      const docSnap = await withTimeout(getDoc(docRef));
      data = docSnap.exists() ? docSnap.data() : null;
    }

    // Cache the result
    if (data) {
      dailyHealthCache.set(cacheKey, { ...data, _cachedAt: Date.now() });
    }

    return data;
  } catch (error) {
    // Return cached data if available
    if (cached) {
      const { _cachedAt, ...data } = cached;
      return data;
    }
    return null;
  }
}

/**
 * Get daily health history for a range of days
 * @param {string} uid - User ID
 * @param {number} days - Number of days of history to fetch (default 30)
 * @returns {Promise<Array<{date: string, steps: number, calories: number, lastUpdated: string}>>}
 */
export async function getDailyHealthHistory(uid, days = 30) {
  try {
    const results = [];
    const today = new Date();

    if (isNative) {
      // For native, we need to fetch the collection and filter
      const collectionPath = `users/${uid}/dailyHealth`;
      const { snapshots } = await FirebaseFirestore.getCollection({
        reference: collectionPath
      });

      if (snapshots) {
        // Calculate the cutoff date
        const cutoffDate = new Date(today);
        cutoffDate.setDate(cutoffDate.getDate() - days);
        const cutoffStr = toLocalDateStr(cutoffDate);

        for (const snap of snapshots) {
          if (snap.data && snap.data.date >= cutoffStr) {
            results.push(snap.data);
            // Update cache
            dailyHealthCache.set(`${uid}_${snap.data.date}`, { ...snap.data, _cachedAt: Date.now() });
          }
        }
      }
    } else {
      // For web, fetch documents for each day
      // This approach is simpler and avoids complex queries
      const promises = [];
      for (let i = 0; i < days; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = toLocalDateStr(date);
        promises.push(getDailyHealthData(uid, dateStr));
      }

      const dayResults = await Promise.all(promises);
      for (const data of dayResults) {
        if (data) {
          results.push(data);
        }
      }
    }

    // Sort by date descending (most recent first)
    results.sort((a, b) => b.date.localeCompare(a.date));

    return results;
  } catch (error) {
    return [];
  }
}
