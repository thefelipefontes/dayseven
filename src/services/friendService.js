import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp
} from 'firebase/firestore';
import { db } from '../firebase';

export async function searchUsers(searchQuery, currentUid) {
  if (!searchQuery || searchQuery.length < 1) return [];

  const lowerQuery = searchQuery.toLowerCase();
  const usersRef = collection(db, 'users');

  // Query for usernames that start with the search query
  const q = query(
    usersRef,
    where('username', '>=', lowerQuery),
    where('username', '<=', lowerQuery + '\uf8ff'),
    limit(10)
  );

  const querySnapshot = await getDocs(q);
  const users = [];

  querySnapshot.forEach((doc) => {
    const userData = doc.data();
    // Don't include current user in results
    if (userData.uid !== currentUid) {
      users.push({
        uid: userData.uid,
        username: userData.username,
        displayName: userData.displayName,
        photoURL: userData.photoURL
      });
    }
  });

  return users;
}

export async function sendFriendRequest(fromUid, toUid) {
  // Check if they're already friends
  const friendRef = doc(db, 'users', fromUid, 'friends', toUid);
  const friendDoc = await getDoc(friendRef);
  if (friendDoc.exists()) {
    console.log('Already friends');
    return { error: 'already_friends' };
  }

  // Check if a pending request already exists (in either direction)
  const requestsRef = collection(db, 'friendRequests');

  // Check for request from current user to target
  const existingToQuery = query(
    requestsRef,
    where('fromUid', '==', fromUid),
    where('toUid', '==', toUid),
    where('status', '==', 'pending')
  );
  const existingToSnapshot = await getDocs(existingToQuery);
  if (!existingToSnapshot.empty) {
    console.log('Request already sent');
    return { error: 'request_already_sent' };
  }

  // Check for request from target to current user
  const existingFromQuery = query(
    requestsRef,
    where('fromUid', '==', toUid),
    where('toUid', '==', fromUid),
    where('status', '==', 'pending')
  );
  const existingFromSnapshot = await getDocs(existingFromQuery);
  if (!existingFromSnapshot.empty) {
    console.log('Request already received from this user');
    return { error: 'request_already_received' };
  }

  // Create new request
  const requestRef = doc(collection(db, 'friendRequests'));
  await setDoc(requestRef, {
    id: requestRef.id,
    fromUid,
    toUid,
    status: 'pending',
    createdAt: serverTimestamp()
  });
  return { success: true, requestId: requestRef.id };
}

export async function getFriendRequests(uid) {
  console.log('getFriendRequests called for uid:', uid);
  const requestsRef = collection(db, 'friendRequests');
  const q = query(
    requestsRef,
    where('toUid', '==', uid),
    where('status', '==', 'pending'),
    orderBy('createdAt', 'desc')
  );
  console.log('Query: toUid ==', uid, ', status == pending');

  const querySnapshot = await getDocs(q);
  console.log('Query returned', querySnapshot.docs.length, 'documents');
  const requests = [];

  for (const docSnapshot of querySnapshot.docs) {
    const requestData = docSnapshot.data();
    // Fetch the sender's profile
    const senderRef = doc(db, 'users', requestData.fromUid);
    const senderDoc = await getDoc(senderRef);
    const senderData = senderDoc.exists() ? senderDoc.data() : {};

    requests.push({
      id: docSnapshot.id,
      ...requestData,
      fromUser: {
        uid: requestData.fromUid,
        username: senderData.username,
        displayName: senderData.displayName,
        photoURL: senderData.photoURL
      }
    });
  }

  return requests;
}

export async function getSentRequests(uid) {
  const requestsRef = collection(db, 'friendRequests');
  const q = query(
    requestsRef,
    where('fromUid', '==', uid),
    where('status', '==', 'pending'),
    orderBy('createdAt', 'desc')
  );

  const querySnapshot = await getDocs(q);
  const requests = [];

  for (const docSnapshot of querySnapshot.docs) {
    const requestData = docSnapshot.data();
    // Fetch the recipient's profile
    const recipientRef = doc(db, 'users', requestData.toUid);
    const recipientDoc = await getDoc(recipientRef);
    const recipientData = recipientDoc.exists() ? recipientDoc.data() : {};

    requests.push({
      id: docSnapshot.id,
      ...requestData,
      toUser: {
        uid: requestData.toUid,
        username: recipientData.username,
        displayName: recipientData.displayName,
        photoURL: recipientData.photoURL
      }
    });
  }

  return requests;
}

export async function acceptFriendRequest(requestId, fromUid, toUid) {
  // Update request status
  const requestRef = doc(db, 'friendRequests', requestId);
  await setDoc(requestRef, { status: 'accepted' }, { merge: true });

  // Add to both users' friends subcollections
  const fromFriendRef = doc(db, 'users', fromUid, 'friends', toUid);
  const toFriendRef = doc(db, 'users', toUid, 'friends', fromUid);

  await setDoc(fromFriendRef, {
    friendUid: toUid,
    addedAt: serverTimestamp()
  });

  await setDoc(toFriendRef, {
    friendUid: fromUid,
    addedAt: serverTimestamp()
  });
}

export async function declineFriendRequest(requestId) {
  const requestRef = doc(db, 'friendRequests', requestId);
  await deleteDoc(requestRef);
}

export async function getFriends(uid) {
  const friendsRef = collection(db, 'users', uid, 'friends');
  const querySnapshot = await getDocs(friendsRef);
  const friends = [];

  for (const docSnapshot of querySnapshot.docs) {
    const friendData = docSnapshot.data();
    // Fetch the friend's profile
    const friendProfileRef = doc(db, 'users', friendData.friendUid);
    const friendProfileDoc = await getDoc(friendProfileRef);
    const friendProfile = friendProfileDoc.exists() ? friendProfileDoc.data() : {};

    friends.push({
      uid: friendData.friendUid,
      username: friendProfile.username,
      displayName: friendProfile.displayName,
      photoURL: friendProfile.photoURL,
      addedAt: friendData.addedAt
    });
  }

  return friends;
}

export async function removeFriend(uid, friendUid) {
  // Remove from both users' friends subcollections
  const userFriendRef = doc(db, 'users', uid, 'friends', friendUid);
  const friendFriendRef = doc(db, 'users', friendUid, 'friends', uid);

  await deleteDoc(userFriendRef);
  await deleteDoc(friendFriendRef);
}

export async function addReaction(activityId, activityOwnerUid, reactorUid, reactorName, reactorPhoto, reactionType) {
  // Use reactorUid as the document ID so each user can only have one reaction per activity
  // Convert activityId to string since Firestore doc IDs must be strings
  const activityIdStr = String(activityId);
  const path = `users/${activityOwnerUid}/activityReactions/${activityIdStr}/reactions/${reactorUid}`;
  console.log('addReaction: Writing to path:', path);

  const reactionRef = doc(db, 'users', activityOwnerUid, 'activityReactions', activityIdStr, 'reactions', reactorUid);

  try {
    await setDoc(reactionRef, {
      reactorUid,
      reactorName,
      reactorPhoto,
      reactionType,
      createdAt: serverTimestamp()
    });
    console.log('addReaction: Successfully wrote to Firestore');
    return reactionRef.id;
  } catch (error) {
    console.error('addReaction: Error writing to Firestore:', error);
    console.error('addReaction: Error code:', error.code, 'Error message:', error.message);
    throw error;
  }
}

export async function getReactions(ownerUid, activityId) {
  const activityIdStr = String(activityId);
  const reactionsRef = collection(db, 'users', ownerUid, 'activityReactions', activityIdStr, 'reactions');
  const snapshot = await getDocs(reactionsRef);

  if (snapshot.empty) {
    return [];
  }

  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
}

export async function removeReaction(ownerUid, activityId, reactorUid) {
  const activityIdStr = String(activityId);
  const reactionRef = doc(db, 'users', ownerUid, 'activityReactions', activityIdStr, 'reactions', reactorUid);
  await deleteDoc(reactionRef);
}
