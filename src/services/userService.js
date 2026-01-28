import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';

export async function createUserProfile(user) {
  const userRef = doc(db, 'users', user.uid);
  const userDoc = await getDoc(userRef);

  if (!userDoc.exists()) {
    await setDoc(userRef, {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      createdAt: new Date().toISOString(),
      hasCompletedOnboarding: false,
      goals: null
    });
  }

  return userRef;
}

export async function getUserProfile(uid) {
  const userRef = doc(db, 'users', uid);
  const userDoc = await getDoc(userRef);

  if (userDoc.exists()) {
    return userDoc.data();
  }

  return null;
}

export async function updateUserProfile(uid, data) {
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, data);
}

export async function saveUserActivities(uid, activities) {
  const cleanedActivities = activities.map(activity => {
    return Object.fromEntries(
      Object.entries(activity).filter(([_, value]) => value !== undefined)
    );
  });

  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, { activities: cleanedActivities });
}

export async function getUserActivities(uid) {
  const userRef = doc(db, 'users', uid);
  const userDoc = await getDoc(userRef);

  if (userDoc.exists()) {
    return userDoc.data().activities || [];
  }

  return [];
}

export async function checkUsernameAvailable(username) {
  const usernameRef = doc(db, 'usernames', username.toLowerCase());
  const usernameDoc = await getDoc(usernameRef);
  return !usernameDoc.exists();
}

export async function saveUsername(uid, username) {
  const lowerUsername = username.toLowerCase();

  // Update user's profile with username
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, { username: lowerUsername });

  // Create username document for fast lookups
  const usernameRef = doc(db, 'usernames', lowerUsername);
  await setDoc(usernameRef, { uid });
}

export async function saveCustomActivities(uid, customActivities) {
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, { customActivities });
}

export async function getCustomActivities(uid) {
  const userRef = doc(db, 'users', uid);
  const userDoc = await getDoc(userRef);

  if (userDoc.exists()) {
    return userDoc.data().customActivities || [];
  }

  return [];
}

export async function saveUserGoals(uid, goals) {
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, { goals });
}

export async function getUserGoals(uid) {
  const userRef = doc(db, 'users', uid);
  const userDoc = await getDoc(userRef);

  if (userDoc.exists()) {
    return userDoc.data().goals || null;
  }

  return null;
}

export async function setOnboardingComplete(uid) {
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, { hasCompletedOnboarding: true });
}

export async function uploadProfilePhoto(uid, file) {
  // Create a reference to the profile photo location
  const photoRef = ref(storage, `profilePhotos/${uid}`);

  // Upload the file
  await uploadBytes(photoRef, file);

  // Get the download URL
  const downloadURL = await getDownloadURL(photoRef);

  // Update the user's profile with the new photo URL
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, { photoURL: downloadURL });

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
