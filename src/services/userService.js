import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import { Capacitor } from '@capacitor/core';
import { FirebaseFirestore } from '@capacitor-firebase/firestore';

// Check if running in native app
const isNative = Capacitor.isNativePlatform();

// Helper function to add timeout to Firestore operations (for web SDK fallback)
const withTimeout = (promise, timeoutMs = 8000) => {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Firestore operation timed out')), timeoutMs)
    )
  ]);
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
    console.error('createUserProfile error:', error);
    // Continue anyway - profile will be created later
  }

  return path;
}

export async function getUserProfile(uid) {
  const path = `users/${uid}`;

  try {
    if (isNative) {
      const { snapshot } = await FirebaseFirestore.getDocument({ reference: path });
      return snapshot?.data || null;
    } else {
      const userRef = doc(db, 'users', uid);
      const userDoc = await withTimeout(getDoc(userRef));
      return userDoc.exists() ? userDoc.data() : null;
    }
  } catch (error) {
    console.error('getUserProfile error:', error);
    return null;
  }
}

export async function updateUserProfile(uid, data) {
  const path = `users/${uid}`;

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
    console.error('updateUserProfile error:', error);
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

  const path = `users/${uid}`;

  try {
    if (isNative) {
      await FirebaseFirestore.updateDocument({
        reference: path,
        data: { activities: cleanedActivities }
      });
    } else {
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, { activities: cleanedActivities });
    }
  } catch (error) {
    console.error('saveUserActivities error:', error);
    throw error;
  }
}

export async function getUserActivities(uid) {
  const path = `users/${uid}`;

  try {
    if (isNative) {
      const { snapshot } = await FirebaseFirestore.getDocument({ reference: path });
      return snapshot?.data?.activities || [];
    } else {
      const userRef = doc(db, 'users', uid);
      const userDoc = await getDoc(userRef);
      return userDoc.exists() ? (userDoc.data().activities || []) : [];
    }
  } catch (error) {
    console.error('getUserActivities error:', error);
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
    console.error('checkUsernameAvailable error:', error);
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
    console.error('saveUsername error:', error);
    throw error;
  }
}

export async function saveCustomActivities(uid, customActivities) {
  const path = `users/${uid}`;

  try {
    if (isNative) {
      await FirebaseFirestore.updateDocument({
        reference: path,
        data: { customActivities }
      });
    } else {
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, { customActivities });
    }
  } catch (error) {
    console.error('saveCustomActivities error:', error);
    throw error;
  }
}

export async function getCustomActivities(uid) {
  const path = `users/${uid}`;

  try {
    if (isNative) {
      const { snapshot } = await FirebaseFirestore.getDocument({ reference: path });
      return snapshot?.data?.customActivities || [];
    } else {
      const userRef = doc(db, 'users', uid);
      const userDoc = await getDoc(userRef);
      return userDoc.exists() ? (userDoc.data().customActivities || []) : [];
    }
  } catch (error) {
    console.error('getCustomActivities error:', error);
    return [];
  }
}

export async function saveUserGoals(uid, goals) {
  const path = `users/${uid}`;

  try {
    if (isNative) {
      await FirebaseFirestore.updateDocument({
        reference: path,
        data: { goals }
      });
    } else {
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, { goals });
    }
  } catch (error) {
    console.error('saveUserGoals error:', error);
    throw error;
  }
}

export async function getUserGoals(uid) {
  const path = `users/${uid}`;

  try {
    if (isNative) {
      const { snapshot } = await FirebaseFirestore.getDocument({ reference: path });
      return snapshot?.data?.goals || null;
    } else {
      const userRef = doc(db, 'users', uid);
      const userDoc = await getDoc(userRef);
      return userDoc.exists() ? (userDoc.data().goals || null) : null;
    }
  } catch (error) {
    console.error('getUserGoals error:', error);
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
    console.error('setOnboardingComplete error:', error);
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
    console.error('setTourComplete error:', error);
    throw error;
  }
}

export async function uploadProfilePhoto(uid, file) {
  // Create a reference to the profile photo location
  const photoRef = ref(storage, `profilePhotos/${uid}`);

  // Upload the file
  await uploadBytes(photoRef, file);

  // Get the download URL
  const downloadURL = await getDownloadURL(photoRef);

  // Update the user's profile with the new photo URL
  await updateUserProfile(uid, { photoURL: downloadURL });

  return downloadURL;
}

export async function uploadActivityPhoto(uid, activityId, file) {
  // Create a unique filename with timestamp
  const timestamp = Date.now();
  const photoRef = ref(storage, `activityPhotos/${uid}/${activityId}/${timestamp}`);

  // Upload the file
  await uploadBytes(photoRef, file);

  // Get the download URL
  const downloadURL = await getDownloadURL(photoRef);

  return downloadURL;
}
