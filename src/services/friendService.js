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

// Helper function to add timeout to Firestore operations (for web SDK)
const withTimeout = (promise, timeoutMs = 8000) => {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Firestore operation timed out')), timeoutMs)
    )
  ]);
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
    console.error('searchUsers error:', error);
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
        console.log('Already friends');
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
        console.log('Request already sent');
        return { error: 'request_already_sent' };
      }

      // Check for request from target to current user
      const existingFrom = allRequests?.find(s => s.data?.fromUid === toUid && s.data?.toUid === fromUid);
      if (existingFrom) {
        console.log('Request already received from this user');
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
      return { success: true, requestId };
    } else {
      // Web Firestore
      const friendRef = doc(db, 'users', fromUid, 'friends', toUid);
      const friendDoc = await withTimeout(getDoc(friendRef));
      if (friendDoc.exists()) {
        console.log('Already friends');
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
        console.log('Request already sent');
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
        console.log('Request already received from this user');
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
      return { success: true, requestId: requestRef.id };
    }
  } catch (error) {
    console.error('sendFriendRequest error:', error);
    throw error;
  }
}

export async function getFriendRequests(uid) {
  console.log('getFriendRequests called for uid:', uid);

  try {
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

      console.log('Query returned', snapshots?.length || 0, 'documents');
      const requests = [];

      for (const snap of (snapshots || [])) {
        const requestData = snap.data;
        if (!requestData) continue;

        // Fetch the sender's profile
        const { snapshot: senderSnapshot } = await FirebaseFirestore.getDocument({
          reference: `users/${requestData.fromUid}`
        });
        const senderData = senderSnapshot?.data || {};

        requests.push({
          id: snap.id,
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
    } else {
      // Web Firestore
      const requestsRef = collection(db, 'friendRequests');
      const q = query(
        requestsRef,
        where('toUid', '==', uid),
        where('status', '==', 'pending'),
        orderBy('createdAt', 'desc')
      );
      console.log('Query: toUid ==', uid, ', status == pending');

      const querySnapshot = await withTimeout(getDocs(q));
      console.log('Query returned', querySnapshot.docs.length, 'documents');
      const requests = [];

      for (const docSnapshot of querySnapshot.docs) {
        const requestData = docSnapshot.data();
        const senderRef = doc(db, 'users', requestData.fromUid);
        const senderDoc = await withTimeout(getDoc(senderRef));
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
  } catch (error) {
    console.error('getFriendRequests error:', error);
    return [];
  }
}

export async function getSentRequests(uid) {
  try {
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

      const requests = [];

      for (const snap of (snapshots || [])) {
        const requestData = snap.data;
        if (!requestData) continue;

        const { snapshot: recipientSnapshot } = await FirebaseFirestore.getDocument({
          reference: `users/${requestData.toUid}`
        });
        const recipientData = recipientSnapshot?.data || {};

        requests.push({
          id: snap.id,
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
    } else {
      const requestsRef = collection(db, 'friendRequests');
      const q = query(
        requestsRef,
        where('fromUid', '==', uid),
        where('status', '==', 'pending'),
        orderBy('createdAt', 'desc')
      );

      const querySnapshot = await withTimeout(getDocs(q));
      const requests = [];

      for (const docSnapshot of querySnapshot.docs) {
        const requestData = docSnapshot.data();
        const recipientRef = doc(db, 'users', requestData.toUid);
        const recipientDoc = await withTimeout(getDoc(recipientRef));
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
  } catch (error) {
    console.error('getSentRequests error:', error);
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
  } catch (error) {
    console.error('acceptFriendRequest error:', error);
    throw error;
  }
}

export async function declineFriendRequest(requestId) {
  try {
    if (isNative) {
      await FirebaseFirestore.deleteDocument({
        reference: `friendRequests/${requestId}`
      });
    } else {
      const requestRef = doc(db, 'friendRequests', requestId);
      await withTimeout(deleteDoc(requestRef));
    }
  } catch (error) {
    console.error('declineFriendRequest error:', error);
    throw error;
  }
}

export async function getFriends(uid) {
  try {
    if (isNative) {
      const { snapshots } = await FirebaseFirestore.getCollection({
        reference: `users/${uid}/friends`
      });

      const friends = [];

      for (const snap of (snapshots || [])) {
        const friendData = snap.data;
        if (!friendData) continue;

        const { snapshot: profileSnapshot } = await FirebaseFirestore.getDocument({
          reference: `users/${friendData.friendUid}`
        });
        const friendProfile = profileSnapshot?.data || {};

        friends.push({
          uid: friendData.friendUid,
          username: friendProfile.username,
          displayName: friendProfile.displayName,
          photoURL: friendProfile.photoURL,
          addedAt: friendData.addedAt
        });
      }

      return friends;
    } else {
      const friendsRef = collection(db, 'users', uid, 'friends');
      const querySnapshot = await withTimeout(getDocs(friendsRef));
      const friends = [];

      for (const docSnapshot of querySnapshot.docs) {
        const friendData = docSnapshot.data();
        const friendProfileRef = doc(db, 'users', friendData.friendUid);
        const friendProfileDoc = await withTimeout(getDoc(friendProfileRef));
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
  } catch (error) {
    console.error('getFriends error:', error);
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
  } catch (error) {
    console.error('removeFriend error:', error);
    throw error;
  }
}

export async function addReaction(activityId, activityOwnerUid, reactorUid, reactorName, reactorPhoto, reactionType) {
  const activityIdStr = String(activityId);
  const path = `users/${activityOwnerUid}/activityReactions/${activityIdStr}/reactions/${reactorUid}`;
  console.log('addReaction: Writing to path:', path);

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
      console.log('addReaction: Successfully wrote to Firestore');
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
      console.log('addReaction: Successfully wrote to Firestore');
      return reactionRef.id;
    }
  } catch (error) {
    console.error('addReaction: Error writing to Firestore:', error);
    console.error('addReaction: Error code:', error.code, 'Error message:', error.message);
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
    console.error('getReactions error:', error);
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
    console.error('removeReaction error:', error);
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
    console.error('addComment: Error writing to Firestore:', error);
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
        console.warn('getComments: Ordered query failed, falling back to unordered:', error);
        const fallbackSnapshot = await withTimeout(getDocs(commentsRef));
        return fallbackSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
      }
    }
  } catch (error) {
    console.error('getComments error:', error);
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
    console.error('deleteComment error:', error);
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
    console.error('addReply: Error writing to Firestore:', error);
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
        console.warn('getReplies: Ordered query failed, falling back to unordered:', error);
        const fallbackSnapshot = await withTimeout(getDocs(repliesRef));
        return fallbackSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
      }
    }
  } catch (error) {
    console.error('getReplies error:', error);
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
    console.error('deleteReply error:', error);
    throw error;
  }
}
