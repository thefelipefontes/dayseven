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
import { Capacitor } from '@capacitor/core';
import { FirebaseFirestore } from '@capacitor-firebase/firestore';

// Check if running in native app
const isNative = Capacitor.isNativePlatform();

// Simple in-memory cache for friend data
const friendCache = {
  friends: new Map(),
  requests: new Map(),
  cacheExpiry: 30000, // 30 second cache for social data (shorter for real-time feel)
  timestamps: new Map(),
};

// Check if cache is valid
const isCacheValid = (key) => {
  const timestamp = friendCache.timestamps.get(key);
  if (!timestamp) return false;
  return Date.now() - timestamp < friendCache.cacheExpiry;
};

// Clear friend cache for a user
export const clearFriendCache = (uid) => {
  friendCache.friends.delete(uid);
  friendCache.requests.delete(uid);
  friendCache.requests.delete(`sent_${uid}`);
  // Also clear timestamps
  friendCache.timestamps.delete(`friends_${uid}`);
  friendCache.timestamps.delete(`requests_${uid}`);
  friendCache.timestamps.delete(`sentRequests_${uid}`);
};

// Helper function to add timeout to Firestore operations (for web SDK)
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
      if (i < maxRetries && !error.code?.includes('permission')) {
        await new Promise(resolve => setTimeout(resolve, delayMs * (i + 1)));
      }
    }
  }
  throw lastError;
};

export async function searchUsers(searchQuery, currentUid) {
  if (!searchQuery || searchQuery.length < 1) return [];

  const lowerQuery = searchQuery.toLowerCase();

  try {
    if (isNative) {
      // Use native Firestore with composite query
      const { snapshots } = await FirebaseFirestore.getCollection({
        reference: 'users',
        compositeFilter: {
          type: 'and',
          queryConstraints: [
            { type: 'where', fieldPath: 'username', opStr: '>=', value: lowerQuery },
            { type: 'where', fieldPath: 'username', opStr: '<=', value: lowerQuery + '\uf8ff' }
          ]
        },
        queryConstraints: [
          { type: 'limit', limit: 10 }
        ]
      });

      const users = [];
      for (const snap of snapshots) {
        const userData = snap.data;
        if (userData && userData.uid !== currentUid) {
          users.push({
            uid: userData.uid,
            username: userData.username,
            displayName: userData.displayName,
            photoURL: userData.photoURL
          });
        }
      }
      return users;
    } else {
      // Use web Firestore
      const usersRef = collection(db, 'users');
      const q = query(
        usersRef,
        where('username', '>=', lowerQuery),
        where('username', '<=', lowerQuery + '\uf8ff'),
        limit(10)
      );

      const querySnapshot = await withTimeout(getDocs(q));
      const users = [];

      querySnapshot.forEach((doc) => {
        const userData = doc.data();
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
  } catch (error) {
    return [];
  }
}

export async function sendFriendRequest(fromUid, toUid) {
  try {
    if (isNative) {
      // Check if they're already friends
      const friendPath = `users/${fromUid}/friends/${toUid}`;
      const { snapshot: friendSnapshot } = await FirebaseFirestore.getDocument({ reference: friendPath });
      if (friendSnapshot?.data) {
        return { error: 'already_friends' };
      }

      // Check for existing requests - get all pending requests and filter
      const { snapshots: allRequests } = await FirebaseFirestore.getCollection({
        reference: 'friendRequests',
        compositeFilter: {
          type: 'and',
          queryConstraints: [
            { type: 'where', fieldPath: 'status', opStr: '==', value: 'pending' }
          ]
        }
      });

      // Check for request from current user to target
      const existingTo = allRequests?.find(s => s.data?.fromUid === fromUid && s.data?.toUid === toUid);
      if (existingTo) {
        return { error: 'request_already_sent' };
      }

      // Check for request from target to current user
      const existingFrom = allRequests?.find(s => s.data?.fromUid === toUid && s.data?.toUid === fromUid);
      if (existingFrom) {
        return { error: 'request_already_received' };
      }

      // Create new request with auto-generated ID
      const requestId = `${fromUid}_${toUid}_${Date.now()}`;
      await FirebaseFirestore.setDocument({
        reference: `friendRequests/${requestId}`,
        data: {
          id: requestId,
          fromUid,
          toUid,
          status: 'pending',
          createdAt: new Date().toISOString()
        }
      });

      // Clear cache for both users
      clearFriendCache(fromUid);
      clearFriendCache(toUid);

      return { success: true, requestId };
    } else {
      // Web Firestore
      const friendRef = doc(db, 'users', fromUid, 'friends', toUid);
      const friendDoc = await withTimeout(getDoc(friendRef));
      if (friendDoc.exists()) {
        return { error: 'already_friends' };
      }

      const requestsRef = collection(db, 'friendRequests');

      const existingToQuery = query(
        requestsRef,
        where('fromUid', '==', fromUid),
        where('toUid', '==', toUid),
        where('status', '==', 'pending')
      );
      const existingToSnapshot = await withTimeout(getDocs(existingToQuery));
      if (!existingToSnapshot.empty) {
        return { error: 'request_already_sent' };
      }

      const existingFromQuery = query(
        requestsRef,
        where('fromUid', '==', toUid),
        where('toUid', '==', fromUid),
        where('status', '==', 'pending')
      );
      const existingFromSnapshot = await withTimeout(getDocs(existingFromQuery));
      if (!existingFromSnapshot.empty) {
        return { error: 'request_already_received' };
      }

      const requestRef = doc(collection(db, 'friendRequests'));
      await withTimeout(setDoc(requestRef, {
        id: requestRef.id,
        fromUid,
        toUid,
        status: 'pending',
        createdAt: serverTimestamp()
      }));

      // Clear cache for both users
      clearFriendCache(fromUid);
      clearFriendCache(toUid);

      return { success: true, requestId: requestRef.id };
    }
  } catch (error) {
    throw error;
  }
}

export async function getFriendRequests(uid, forceRefresh = false) {
  // Check cache first (unless force refresh)
  const cacheKey = `requests_${uid}`;
  if (!forceRefresh && friendCache.requests.has(uid) && isCacheValid(cacheKey)) {
    return friendCache.requests.get(uid);
  }

  try {
    let requests = [];

    if (isNative) {
      // Use native Firestore
      const { snapshots } = await FirebaseFirestore.getCollection({
        reference: 'friendRequests',
        compositeFilter: {
          type: 'and',
          queryConstraints: [
            { type: 'where', fieldPath: 'toUid', opStr: '==', value: uid },
            { type: 'where', fieldPath: 'status', opStr: '==', value: 'pending' }
          ]
        }
      });

      // Batch fetch all sender profiles in parallel for speed
      const requestPromises = (snapshots || []).map(async (snap) => {
        const requestData = snap.data;
        if (!requestData) return null;

        const { snapshot: senderSnapshot } = await FirebaseFirestore.getDocument({
          reference: `users/${requestData.fromUid}`
        });
        const senderData = senderSnapshot?.data || {};

        return {
          id: snap.id,
          ...requestData,
          fromUser: {
            uid: requestData.fromUid,
            username: senderData.username,
            displayName: senderData.displayName,
            photoURL: senderData.photoURL
          }
        };
      });

      requests = (await Promise.all(requestPromises)).filter(Boolean);
    } else {
      // Web Firestore
      const requestsRef = collection(db, 'friendRequests');
      const q = query(
        requestsRef,
        where('toUid', '==', uid),
        where('status', '==', 'pending'),
        orderBy('createdAt', 'desc')
      );

      const querySnapshot = await withTimeout(getDocs(q));

      // Batch fetch all sender profiles in parallel for speed
      const requestPromises = querySnapshot.docs.map(async (docSnapshot) => {
        const requestData = docSnapshot.data();
        const senderRef = doc(db, 'users', requestData.fromUid);
        const senderDoc = await withTimeout(getDoc(senderRef));
        const senderData = senderDoc.exists() ? senderDoc.data() : {};

        return {
          id: docSnapshot.id,
          ...requestData,
          fromUser: {
            uid: requestData.fromUid,
            username: senderData.username,
            displayName: senderData.displayName,
            photoURL: senderData.photoURL
          }
        };
      });

      requests = await Promise.all(requestPromises);
    }

    // Cache the result
    friendCache.requests.set(uid, requests);
    friendCache.timestamps.set(cacheKey, Date.now());

    return requests;
  } catch (error) {
    // Return cached data if available, even if expired
    if (friendCache.requests.has(uid)) {
      return friendCache.requests.get(uid);
    }
    return [];
  }
}

export async function getSentRequests(uid, forceRefresh = false) {
  // Check cache first (unless force refresh) - use separate cache key for sent requests
  const cacheKey = `sentRequests_${uid}`;
  if (!forceRefresh && friendCache.timestamps.has(cacheKey) && isCacheValid(cacheKey)) {
    return friendCache.requests.get(`sent_${uid}`) || [];
  }

  try {
    let requests = [];

    if (isNative) {
      const { snapshots } = await FirebaseFirestore.getCollection({
        reference: 'friendRequests',
        compositeFilter: {
          type: 'and',
          queryConstraints: [
            { type: 'where', fieldPath: 'fromUid', opStr: '==', value: uid },
            { type: 'where', fieldPath: 'status', opStr: '==', value: 'pending' }
          ]
        }
      });

      // Batch fetch all recipient profiles in parallel for speed
      const requestPromises = (snapshots || []).map(async (snap) => {
        const requestData = snap.data;
        if (!requestData) return null;

        const { snapshot: recipientSnapshot } = await FirebaseFirestore.getDocument({
          reference: `users/${requestData.toUid}`
        });
        const recipientData = recipientSnapshot?.data || {};

        return {
          id: snap.id,
          ...requestData,
          toUser: {
            uid: requestData.toUid,
            username: recipientData.username,
            displayName: recipientData.displayName,
            photoURL: recipientData.photoURL
          }
        };
      });

      requests = (await Promise.all(requestPromises)).filter(Boolean);
    } else {
      const requestsRef = collection(db, 'friendRequests');
      const q = query(
        requestsRef,
        where('fromUid', '==', uid),
        where('status', '==', 'pending'),
        orderBy('createdAt', 'desc')
      );

      const querySnapshot = await withTimeout(getDocs(q));

      // Batch fetch all recipient profiles in parallel for speed
      const requestPromises = querySnapshot.docs.map(async (docSnapshot) => {
        const requestData = docSnapshot.data();
        const recipientRef = doc(db, 'users', requestData.toUid);
        const recipientDoc = await withTimeout(getDoc(recipientRef));
        const recipientData = recipientDoc.exists() ? recipientDoc.data() : {};

        return {
          id: docSnapshot.id,
          ...requestData,
          toUser: {
            uid: requestData.toUid,
            username: recipientData.username,
            displayName: recipientData.displayName,
            photoURL: recipientData.photoURL
          }
        };
      });

      requests = await Promise.all(requestPromises);
    }

    // Cache the result
    friendCache.requests.set(`sent_${uid}`, requests);
    friendCache.timestamps.set(cacheKey, Date.now());

    return requests;
  } catch (error) {
    // Return cached data if available, even if expired
    const cached = friendCache.requests.get(`sent_${uid}`);
    if (cached) {
      return cached;
    }
    return [];
  }
}

export async function acceptFriendRequest(requestId, fromUid, toUid) {
  try {
    if (isNative) {
      // Update request status
      await FirebaseFirestore.updateDocument({
        reference: `friendRequests/${requestId}`,
        data: { status: 'accepted' }
      });

      // Add to both users' friends subcollections
      await FirebaseFirestore.setDocument({
        reference: `users/${fromUid}/friends/${toUid}`,
        data: {
          friendUid: toUid,
          addedAt: new Date().toISOString()
        }
      });

      await FirebaseFirestore.setDocument({
        reference: `users/${toUid}/friends/${fromUid}`,
        data: {
          friendUid: fromUid,
          addedAt: new Date().toISOString()
        }
      });
    } else {
      const requestRef = doc(db, 'friendRequests', requestId);
      await withTimeout(setDoc(requestRef, { status: 'accepted' }, { merge: true }));

      const fromFriendRef = doc(db, 'users', fromUid, 'friends', toUid);
      const toFriendRef = doc(db, 'users', toUid, 'friends', fromUid);

      await withTimeout(setDoc(fromFriendRef, {
        friendUid: toUid,
        addedAt: serverTimestamp()
      }));

      await withTimeout(setDoc(toFriendRef, {
        friendUid: fromUid,
        addedAt: serverTimestamp()
      }));
    }

    // Clear cache for both users so fresh data is fetched
    clearFriendCache(fromUid);
    clearFriendCache(toUid);
  } catch (error) {
    throw error;
  }
}

export async function declineFriendRequest(requestId, currentUid) {
  try {
    if (isNative) {
      await FirebaseFirestore.deleteDocument({
        reference: `friendRequests/${requestId}`
      });
    } else {
      const requestRef = doc(db, 'friendRequests', requestId);
      await withTimeout(deleteDoc(requestRef));
    }

    // Clear cache so fresh data is fetched
    if (currentUid) {
      clearFriendCache(currentUid);
    }
  } catch (error) {
    throw error;
  }
}

export async function getFriends(uid, forceRefresh = false) {
  // Check cache first (unless force refresh)
  const cacheKey = `friends_${uid}`;
  if (!forceRefresh && friendCache.friends.has(uid) && isCacheValid(cacheKey)) {
    return friendCache.friends.get(uid);
  }

  try {
    let friends = [];

    if (isNative) {
      const { snapshots } = await FirebaseFirestore.getCollection({
        reference: `users/${uid}/friends`
      });

      // Batch fetch all friend profiles in parallel for speed
      const friendPromises = (snapshots || []).map(async (snap) => {
        const friendData = snap.data;
        if (!friendData) return null;

        const { snapshot: profileSnapshot } = await FirebaseFirestore.getDocument({
          reference: `users/${friendData.friendUid}`
        });
        const friendProfile = profileSnapshot?.data || {};

        return {
          uid: friendData.friendUid,
          username: friendProfile.username,
          displayName: friendProfile.displayName,
          photoURL: friendProfile.photoURL,
          addedAt: friendData.addedAt
        };
      });

      friends = (await Promise.all(friendPromises)).filter(Boolean);
    } else {
      const friendsRef = collection(db, 'users', uid, 'friends');
      const querySnapshot = await withTimeout(getDocs(friendsRef));

      // Batch fetch all friend profiles in parallel for speed
      const friendPromises = querySnapshot.docs.map(async (docSnapshot) => {
        const friendData = docSnapshot.data();
        const friendProfileRef = doc(db, 'users', friendData.friendUid);
        const friendProfileDoc = await withTimeout(getDoc(friendProfileRef));
        const friendProfile = friendProfileDoc.exists() ? friendProfileDoc.data() : {};

        return {
          uid: friendData.friendUid,
          username: friendProfile.username,
          displayName: friendProfile.displayName,
          photoURL: friendProfile.photoURL,
          addedAt: friendData.addedAt
        };
      });

      friends = await Promise.all(friendPromises);
    }

    // Cache the result
    friendCache.friends.set(uid, friends);
    friendCache.timestamps.set(cacheKey, Date.now());

    return friends;
  } catch (error) {
    // Return cached data if available, even if expired
    if (friendCache.friends.has(uid)) {
      return friendCache.friends.get(uid);
    }
    return [];
  }
}

export async function removeFriend(uid, friendUid) {
  try {
    if (isNative) {
      await FirebaseFirestore.deleteDocument({
        reference: `users/${uid}/friends/${friendUid}`
      });
      await FirebaseFirestore.deleteDocument({
        reference: `users/${friendUid}/friends/${uid}`
      });
    } else {
      const userFriendRef = doc(db, 'users', uid, 'friends', friendUid);
      const friendFriendRef = doc(db, 'users', friendUid, 'friends', uid);

      await withTimeout(deleteDoc(userFriendRef));
      await withTimeout(deleteDoc(friendFriendRef));
    }

    // Clear cache for both users so fresh data is fetched
    clearFriendCache(uid);
    clearFriendCache(friendUid);
  } catch (error) {
    throw error;
  }
}

export async function addReaction(activityId, activityOwnerUid, reactorUid, reactorName, reactorPhoto, reactionType) {
  const activityIdStr = String(activityId);
  const path = `users/${activityOwnerUid}/activityReactions/${activityIdStr}/reactions/${reactorUid}`;

  try {
    if (isNative) {
      await FirebaseFirestore.setDocument({
        reference: path,
        data: {
          reactorUid,
          reactorName,
          reactorPhoto,
          reactionType,
          createdAt: new Date().toISOString()
        }
      });
      return reactorUid;
    } else {
      const reactionRef = doc(db, 'users', activityOwnerUid, 'activityReactions', activityIdStr, 'reactions', reactorUid);

      await withTimeout(setDoc(reactionRef, {
        reactorUid,
        reactorName,
        reactorPhoto,
        reactionType,
        createdAt: serverTimestamp()
      }));
      return reactionRef.id;
    }
  } catch (error) {
    throw error;
  }
}

export async function getReactions(ownerUid, activityId) {
  const activityIdStr = String(activityId);

  try {
    if (isNative) {
      const { snapshots } = await FirebaseFirestore.getCollection({
        reference: `users/${ownerUid}/activityReactions/${activityIdStr}/reactions`
      });

      if (!snapshots || snapshots.length === 0) {
        return [];
      }

      return snapshots.map(snap => ({
        id: snap.id,
        ...snap.data
      }));
    } else {
      const reactionsRef = collection(db, 'users', ownerUid, 'activityReactions', activityIdStr, 'reactions');
      const snapshot = await withTimeout(getDocs(reactionsRef));

      if (snapshot.empty) {
        return [];
      }

      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    }
  } catch (error) {
    return [];
  }
}

export async function removeReaction(ownerUid, activityId, reactorUid) {
  const activityIdStr = String(activityId);

  try {
    if (isNative) {
      await FirebaseFirestore.deleteDocument({
        reference: `users/${ownerUid}/activityReactions/${activityIdStr}/reactions/${reactorUid}`
      });
    } else {
      const reactionRef = doc(db, 'users', ownerUid, 'activityReactions', activityIdStr, 'reactions', reactorUid);
      await withTimeout(deleteDoc(reactionRef));
    }
  } catch (error) {
    throw error;
  }
}

// Comments functions
export async function addComment(activityId, ownerUid, commenterUid, commenterName, commenterPhoto, text) {
  const activityIdStr = String(activityId);

  try {
    if (isNative) {
      const commentId = `${commenterUid}_${Date.now()}`;
      await FirebaseFirestore.setDocument({
        reference: `users/${ownerUid}/activityComments/${activityIdStr}/comments/${commentId}`,
        data: {
          id: commentId,
          commenterUid,
          commenterName,
          commenterPhoto,
          text,
          createdAt: new Date().toISOString()
        }
      });
      return commentId;
    } else {
      const commentsRef = collection(db, 'users', ownerUid, 'activityComments', activityIdStr, 'comments');
      const commentRef = doc(commentsRef);

      await withTimeout(setDoc(commentRef, {
        id: commentRef.id,
        commenterUid,
        commenterName,
        commenterPhoto,
        text,
        createdAt: serverTimestamp()
      }));
      return commentRef.id;
    }
  } catch (error) {
    throw error;
  }
}

export async function getComments(ownerUid, activityId) {
  const activityIdStr = String(activityId);

  try {
    if (isNative) {
      const { snapshots } = await FirebaseFirestore.getCollection({
        reference: `users/${ownerUid}/activityComments/${activityIdStr}/comments`
      });

      if (!snapshots || snapshots.length === 0) {
        return [];
      }

      // Sort by createdAt since we can't use orderBy with native plugin easily
      const comments = snapshots.map(snap => ({
        id: snap.id,
        ...snap.data
      }));

      return comments.sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return aTime - bTime;
      });
    } else {
      const commentsRef = collection(db, 'users', ownerUid, 'activityComments', activityIdStr, 'comments');
      const q = query(commentsRef, orderBy('createdAt', 'asc'));

      try {
        const snapshot = await withTimeout(getDocs(q));

        if (snapshot.empty) {
          return [];
        }

        return snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
      } catch (error) {
        const fallbackSnapshot = await withTimeout(getDocs(commentsRef));
        return fallbackSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
      }
    }
  } catch (error) {
    return [];
  }
}

export async function deleteComment(ownerUid, activityId, commentId) {
  const activityIdStr = String(activityId);

  try {
    if (isNative) {
      await FirebaseFirestore.deleteDocument({
        reference: `users/${ownerUid}/activityComments/${activityIdStr}/comments/${commentId}`
      });
    } else {
      const commentRef = doc(db, 'users', ownerUid, 'activityComments', activityIdStr, 'comments', commentId);
      await withTimeout(deleteDoc(commentRef));
    }
  } catch (error) {
    throw error;
  }
}

// Reply functions - one reply thread per comment
export async function addReply(ownerUid, activityId, commentId, replierUid, replierName, replierPhoto, text) {
  const activityIdStr = String(activityId);

  try {
    if (isNative) {
      const replyId = `${replierUid}_${Date.now()}`;
      await FirebaseFirestore.setDocument({
        reference: `users/${ownerUid}/activityComments/${activityIdStr}/comments/${commentId}/replies/${replyId}`,
        data: {
          id: replyId,
          replierUid,
          replierName,
          replierPhoto,
          text,
          createdAt: new Date().toISOString()
        }
      });
      return replyId;
    } else {
      const repliesRef = collection(db, 'users', ownerUid, 'activityComments', activityIdStr, 'comments', commentId, 'replies');
      const replyRef = doc(repliesRef);

      await withTimeout(setDoc(replyRef, {
        id: replyRef.id,
        replierUid,
        replierName,
        replierPhoto,
        text,
        createdAt: serverTimestamp()
      }));
      return replyRef.id;
    }
  } catch (error) {
    throw error;
  }
}

export async function getReplies(ownerUid, activityId, commentId) {
  const activityIdStr = String(activityId);

  try {
    if (isNative) {
      const { snapshots } = await FirebaseFirestore.getCollection({
        reference: `users/${ownerUid}/activityComments/${activityIdStr}/comments/${commentId}/replies`
      });

      if (!snapshots || snapshots.length === 0) {
        return [];
      }

      const replies = snapshots.map(snap => ({
        id: snap.id,
        ...snap.data
      }));

      return replies.sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return aTime - bTime;
      });
    } else {
      const repliesRef = collection(db, 'users', ownerUid, 'activityComments', activityIdStr, 'comments', commentId, 'replies');
      const q = query(repliesRef, orderBy('createdAt', 'asc'));

      try {
        const snapshot = await withTimeout(getDocs(q));

        if (snapshot.empty) {
          return [];
        }

        return snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
      } catch (error) {
        const fallbackSnapshot = await withTimeout(getDocs(repliesRef));
        return fallbackSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
      }
    }
  } catch (error) {
    return [];
  }
}

export async function deleteReply(ownerUid, activityId, commentId, replyId) {
  const activityIdStr = String(activityId);

  try {
    if (isNative) {
      await FirebaseFirestore.deleteDocument({
        reference: `users/${ownerUid}/activityComments/${activityIdStr}/comments/${commentId}/replies/${replyId}`
      });
    } else {
      const replyRef = doc(db, 'users', ownerUid, 'activityComments', activityIdStr, 'comments', commentId, 'replies', replyId);
      await withTimeout(deleteDoc(replyRef));
    }
  } catch (error) {
    throw error;
  }
}
