import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, writeBatch } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import { Capacitor } from '@capacitor/core';
import { FirebaseFirestore } from '@capacitor-firebase/firestore';
import { FirebaseStorage } from '@capacitor-firebase/storage';
import { Filesystem, Directory } from '@capacitor/filesystem';

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

export async function createUserProfile(user) {
  const path = `users/${user.uid}`;

  try {
    if (isNative) {
      // Use native Firestore
      const { snapshot } = await FirebaseFirestore.getDocument({ reference: path });

      if (!snapshot?.data) {
        await FirebaseFirestore.setDocument({
          reference: path,
          data: {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            createdAt: new Date().toISOString(),
            hasCompletedOnboarding: false,
            goals: null
          }
        });
      }
    } else {
      // Use web Firestore
      const userRef = doc(db, 'users', user.uid);
      const userDoc = await withTimeout(getDoc(userRef));

      if (!userDoc.exists()) {
        await withTimeout(setDoc(userRef, {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          createdAt: new Date().toISOString(),
          hasCompletedOnboarding: false,
          goals: null
        }));
      }
    }
  } catch (error) {
    // console.error('createUserProfile error:', error);
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
    if (isNative) {
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
    // console.error('getUserProfile error:', error);
    // Return cached data if available, even if expired
    if (cache.userProfiles.has(uid)) {
      return cache.userProfiles.get(uid);
    }
    return null;
  }
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
    if (isNative) {
      await FirebaseFirestore.updateDocument({
        reference: path,
        data: data
      });
    } else {
      const userRef = doc(db, 'users', uid);
      await withTimeout(updateDoc(userRef, data));
    }
  } catch (error) {
    // console.error('updateUserProfile error:', error);
    // If doc doesn't exist, try to create it
    if (error.message?.includes('No document') || error.message?.includes('not-found') || error.code === 'not-found') {
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
    } else {
      // Revert cache on error
      cache.userProfiles.delete(uid);
      throw error;
    }
  }
}

export async function saveUserActivities(uid, activities) {
  const cleanedActivities = activities.map(activity => {
    return Object.fromEntries(
      Object.entries(activity).filter(([_, value]) => value !== undefined)
    );
  });

  // Update cache immediately (optimistic update)
  cache.userActivities.set(uid, cleanedActivities);
  cache.timestamps.set(`activities_${uid}`, Date.now());

  const path = `users/${uid}`;

  try {
    await withRetry(async () => {
      if (isNative) {
        await FirebaseFirestore.updateDocument({
          reference: path,
          data: { activities: cleanedActivities }
        });
      } else {
        const userRef = doc(db, 'users', uid);
        await withTimeout(updateDoc(userRef, { activities: cleanedActivities }));
      }
    });
  } catch (error) {
    // console.error('saveUserActivities error:', error);
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
    if (isNative) {
      const { snapshot } = await FirebaseFirestore.getDocument({ reference: path });
      activities = snapshot?.data?.activities || [];
    } else {
      const userRef = doc(db, 'users', uid);
      const userDoc = await withTimeout(getDoc(userRef));
      activities = userDoc.exists() ? (userDoc.data().activities || []) : [];
    }

    // Cache the result
    cache.userActivities.set(uid, activities);
    cache.timestamps.set(`activities_${uid}`, Date.now());

    return activities;
  } catch (error) {
    // console.error('getUserActivities error:', error);
    // Return cached data if available, even if expired
    if (cache.userActivities.has(uid)) {
      return cache.userActivities.get(uid);
    }
    return [];
  }
}

export async function checkUsernameAvailable(username) {
  const path = `usernames/${username.toLowerCase()}`;

  try {
    if (isNative) {
      const { snapshot } = await FirebaseFirestore.getDocument({ reference: path });
      return !snapshot?.data;
    } else {
      const usernameRef = doc(db, 'usernames', username.toLowerCase());
      const usernameDoc = await getDoc(usernameRef);
      return !usernameDoc.exists();
    }
  } catch (error) {
    // console.error('checkUsernameAvailable error:', error);
    return true; // Assume available on error
  }
}

export async function saveUsername(uid, username) {
  const lowerUsername = username.toLowerCase();
  const userPath = `users/${uid}`;
  const usernamePath = `usernames/${lowerUsername}`;

  try {
    if (isNative) {
      await FirebaseFirestore.updateDocument({
        reference: userPath,
        data: { username: lowerUsername }
      });
      await FirebaseFirestore.setDocument({
        reference: usernamePath,
        data: { uid }
      });
    } else {
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, { username: lowerUsername });
      const usernameRef = doc(db, 'usernames', lowerUsername);
      await setDoc(usernameRef, { uid });
    }
  } catch (error) {
    // console.error('saveUsername error:', error);
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
        await FirebaseFirestore.updateDocument({
          reference: path,
          data: { customActivities }
        });
      } else {
        const userRef = doc(db, 'users', uid);
        await withTimeout(updateDoc(userRef, { customActivities }));
      }
    });
  } catch (error) {
    // console.error('saveCustomActivities error:', error);
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
    // console.error('getCustomActivities error:', error);
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
        await FirebaseFirestore.updateDocument({
          reference: path,
          data: { goals }
        });
      } else {
        const userRef = doc(db, 'users', uid);
        await withTimeout(updateDoc(userRef, { goals }));
      }
    });
  } catch (error) {
    // console.error('saveUserGoals error:', error);
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
    // console.error('getUserGoals error:', error);
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
      await FirebaseFirestore.updateDocument({
        reference: path,
        data: { hasCompletedOnboarding: true }
      });
    } else {
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, { hasCompletedOnboarding: true });
    }
  } catch (error) {
    // console.error('setOnboardingComplete error:', error);
    throw error;
  }
}

export async function setTourComplete(uid) {
  const path = `users/${uid}`;

  try {
    if (isNative) {
      await FirebaseFirestore.updateDocument({
        reference: path,
        data: { hasCompletedTour: true }
      });
    } else {
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, { hasCompletedTour: true });
    }
  } catch (error) {
    // console.error('setTourComplete error:', error);
    throw error;
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
          console.error('Error deleting username:', e);
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
        console.error('Error deleting friends:', e);
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
        console.error('Error processing friends:', e);
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
        console.error('Error deleting friend requests:', e);
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
    console.error('deleteUserAccount error:', error);
    throw error;
  }
}
