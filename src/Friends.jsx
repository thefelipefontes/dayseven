import React, { useState, useEffect } from 'react';
import {
  searchUsers,
  sendFriendRequest,
  getFriendRequests,
  getSentRequests,
  acceptFriendRequest,
  declineFriendRequest,
  getFriends,
  removeFriend
} from './services/friendService';

const Friends = ({ user, userProfile, onClose }) => {
  const [activeTab, setActiveTab] = useState('friends');
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState([]);
  const [sentRequests, setSentRequests] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [sendingTo, setSendingTo] = useState(null); // Track which user we're sending request to
  const [justSent, setJustSent] = useState(new Set()); // Track recently sent requests for animation
  const [isClosing, setIsClosing] = useState(false); // Track closing animation

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 250); // Match animation duration
  };

  // Load friends and requests on mount
  useEffect(() => {
    loadData();
  }, [user.uid]);

  const loadData = async () => {
    console.log('Loading friends data for uid:', user.uid);
    setIsLoading(true);
    try {
      const [friendsList, requestsList, sentList] = await Promise.all([
        getFriends(user.uid),
        getFriendRequests(user.uid),
        getSentRequests(user.uid)
      ]);
      console.log('Friends loaded:', friendsList);
      console.log('Friend requests received:', requestsList);
      console.log('Sent requests:', sentList);
      setFriends(friendsList);
      setRequests(requestsList);
      setSentRequests(sentList);
    } catch (error) {
      console.error('Error loading friends data:', error);
    }
    setIsLoading(false);
  };

  // Search users with debounce
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const timeoutId = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await searchUsers(searchQuery, user.uid);
        setSearchResults(results);
      } catch (error) {
        console.error('Error searching users:', error);
      }
      setIsSearching(false);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchQuery, user.uid]);

  const handleSendRequest = async (toUid) => {
    console.log('Add friend clicked', toUid);
    console.log('From user:', user.uid);
    setSendingTo(toUid);
    try {
      const result = await sendFriendRequest(user.uid, toUid);
      console.log('Friend request result:', result);

      if (result.success) {
        // Show success animation
        setJustSent(prev => new Set(prev).add(toUid));
        // Refresh sent requests
        const sentList = await getSentRequests(user.uid);
        console.log('Updated sent requests:', sentList);
        setSentRequests(sentList);
      } else if (result.error === 'request_already_received') {
        // They already sent us a request, refresh to show Accept button
        await loadData();
      }
    } catch (error) {
      console.error('Error sending friend request:', error);
    }
    setSendingTo(null);
  };

  const handleAcceptRequest = async (request) => {
    try {
      await acceptFriendRequest(request.id, request.fromUid, request.toUid);
      await loadData();
    } catch (error) {
      console.error('Error accepting friend request:', error);
    }
  };

  const handleDeclineRequest = async (requestId) => {
    try {
      await declineFriendRequest(requestId);
      setRequests(requests.filter(r => r.id !== requestId));
    } catch (error) {
      console.error('Error declining friend request:', error);
    }
  };

  const handleCancelRequest = async (requestId) => {
    try {
      await declineFriendRequest(requestId);
      setSentRequests(sentRequests.filter(r => r.id !== requestId));
    } catch (error) {
      console.error('Error canceling friend request:', error);
    }
  };

  const handleRemoveFriend = async (friendUid) => {
    try {
      await removeFriend(user.uid, friendUid);
      setFriends(friends.filter(f => f.uid !== friendUid));
    } catch (error) {
      console.error('Error removing friend:', error);
    }
  };

  const isFriend = (uid) => friends.some(f => f.uid === uid);
  const hasSentRequest = (uid) => sentRequests.some(r => r.toUid === uid) || justSent.has(uid);
  const hasReceivedRequest = (uid) => requests.some(r => r.fromUid === uid);

  const getButtonState = (uid) => {
    if (isFriend(uid)) return 'friends';
    if (hasSentRequest(uid)) return 'pending';
    if (hasReceivedRequest(uid)) return 'received';
    return 'add';
  };

  // Haptic button press handlers
  const handlePressIn = (e) => {
    e.currentTarget.style.transform = 'scale(0.95)';
  };

  const handlePressOut = (e) => {
    e.currentTarget.style.transform = 'scale(1)';
  };

  const ProfilePhoto = ({ photoURL, displayName, size = 48 }) => (
    <div
      className="rounded-full bg-zinc-700 flex items-center justify-center overflow-hidden"
      style={{ width: size, height: size }}
    >
      {photoURL ? (
        <img src={photoURL} alt={displayName} className="w-full h-full object-cover" />
      ) : (
        <span className="text-white text-lg">{displayName?.[0]?.toUpperCase() || '?'}</span>
      )}
    </div>
  );

  const UserRow = ({ userData, rightContent }) => (
    <div className="flex items-center justify-between py-3 px-4">
      <div className="flex items-center gap-3">
        <ProfilePhoto photoURL={userData.photoURL} displayName={userData.displayName} />
        <div>
          <p className="text-white font-medium">{userData.displayName || userData.username}</p>
          <p className="text-gray-400 text-sm">@{userData.username}</p>
        </div>
      </div>
      {rightContent}
    </div>
  );

  // Reusable button component with haptic feedback
  const ActionButton = ({ onClick, className, children, disabled = false }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`transition-all duration-150 ${className}`}
      style={{ transform: 'scale(1)' }}
      onTouchStart={handlePressIn}
      onTouchEnd={handlePressOut}
      onMouseDown={handlePressIn}
      onMouseUp={handlePressOut}
      onMouseLeave={handlePressOut}
    >
      {children}
    </button>
  );

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end justify-center transition-all duration-250 ${isClosing ? 'bg-black/0' : 'bg-black/80'}`}
      onClick={handleClose}
    >
      <div
        className={`w-full bg-zinc-900 rounded-t-3xl flex flex-col ${isClosing ? 'animate-slide-down' : 'animate-slide-up'}`}
        style={{ height: '50vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 bg-zinc-700 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-3">
          <div className="w-10" />
          <h1 className="text-white text-lg font-semibold">Add Friends</h1>
          <ActionButton
            onClick={handleClose}
            className="text-gray-400 p-2 -mr-2"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </ActionButton>
        </div>

        {/* Tab Navigation */}
        <div className="relative flex gap-2 p-1 rounded-xl mx-4 mb-4" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
          {/* Sliding pill indicator */}
          <div
            className="absolute top-1 bottom-1 rounded-lg transition-all duration-300 ease-out"
            style={{
              backgroundColor: 'rgba(255,255,255,0.1)',
              width: 'calc((100% - 8px) / 3)',
              left: activeTab === 'friends'
                ? '4px'
                : activeTab === 'requests'
                  ? 'calc(4px + (100% - 8px) / 3)'
                  : 'calc(4px + 2 * (100% - 8px) / 3)'
            }}
          />
          {[
            { key: 'friends', label: 'Friends' },
            { key: 'requests', label: 'Requests' },
            { key: 'add', label: 'Add Friends' }
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors duration-200 relative z-10"
              style={{
                color: activeTab === tab.key ? 'white' : 'rgba(255,255,255,0.5)'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto pb-8">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Friends Tab */}
              {activeTab === 'friends' && (
                <div>
                  {friends.length === 0 ? (
                    <div className="text-center py-12">
                      <p className="text-gray-400 mb-2">No friends yet</p>
                      <ActionButton
                        onClick={() => setActiveTab('add')}
                        className="text-green-400 font-medium"
                      >
                        Add some!
                      </ActionButton>
                    </div>
                  ) : (
                    <div className="divide-y divide-zinc-800">
                      {friends.map((friend) => (
                        <UserRow
                          key={friend.uid}
                          userData={friend}
                          rightContent={
                            <ActionButton
                              onClick={() => handleRemoveFriend(friend.uid)}
                              className="text-red-400 text-sm px-3 py-1 rounded-full hover:bg-red-400/10"
                            >
                              Remove
                            </ActionButton>
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Requests Tab */}
              {activeTab === 'requests' && (
                <div>
                  {/* Received Requests */}
                  <div className="px-4 py-3 bg-zinc-800/50 rounded-lg mx-4">
                    <p className="text-gray-400 text-sm font-medium">Received Requests</p>
                  </div>
                  {requests.length === 0 ? (
                    <p className="text-gray-500 text-center py-6">No pending requests</p>
                  ) : (
                    <div className="divide-y divide-zinc-800">
                      {requests.map((request) => (
                        <UserRow
                          key={request.id}
                          userData={request.fromUser}
                          rightContent={
                            <div className="flex gap-2">
                              <ActionButton
                                onClick={() => handleAcceptRequest(request)}
                                className="bg-green-500 text-black text-sm font-medium px-4 py-1.5 rounded-full hover:bg-green-400 active:bg-green-600"
                              >
                                Accept
                              </ActionButton>
                              <ActionButton
                                onClick={() => handleDeclineRequest(request.id)}
                                className="bg-zinc-700 text-white text-sm font-medium px-4 py-1.5 rounded-full hover:bg-zinc-600 active:opacity-70"
                              >
                                Decline
                              </ActionButton>
                            </div>
                          }
                        />
                      ))}
                    </div>
                  )}

                  {/* Sent Requests */}
                  <div className="px-4 py-3 bg-zinc-800/50 rounded-lg mx-4 mt-4">
                    <p className="text-gray-400 text-sm font-medium">Sent Requests</p>
                  </div>
                  {sentRequests.length === 0 ? (
                    <p className="text-gray-500 text-center py-6">No sent requests</p>
                  ) : (
                    <div className="divide-y divide-zinc-800">
                      {sentRequests.map((request) => (
                        <UserRow
                          key={request.id}
                          userData={request.toUser}
                          rightContent={
                            <ActionButton
                              onClick={() => handleCancelRequest(request.id)}
                              className="text-gray-400 text-sm px-3 py-1 rounded-full hover:bg-zinc-800"
                            >
                              Cancel
                            </ActionButton>
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Add Friends Tab */}
              {activeTab === 'add' && (
                <div>
                  {/* Search Input */}
                  <div className="p-4">
                    <div className="relative">
                      <svg
                        className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                        />
                      </svg>
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search by username"
                        className="w-full bg-zinc-800 text-white pl-10 pr-4 py-3 rounded-xl border border-zinc-700 focus:border-zinc-600 focus:outline-none transition-colors"
                      />
                    </div>
                  </div>

                  {/* Search Results */}
                  {isSearching ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : searchQuery && searchResults.length === 0 ? (
                    <p className="text-gray-500 text-center py-8">No users found</p>
                  ) : (
                    <div className="divide-y divide-zinc-800">
                      {searchResults.map((result) => {
                        const buttonState = getButtonState(result.uid);
                        const isSending = sendingTo === result.uid;
                        const wasSent = justSent.has(result.uid);

                        return (
                          <UserRow
                            key={result.uid}
                            userData={result}
                            rightContent={
                              buttonState === 'friends' ? (
                                <span className="text-green-400 text-sm flex items-center gap-1">
                                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                  Friends
                                </span>
                              ) : buttonState === 'pending' ? (
                                <span className={`text-sm flex items-center gap-1 transition-all duration-300 ${wasSent ? 'text-green-400' : 'text-gray-400'}`}>
                                  {wasSent ? (
                                    <>
                                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                      </svg>
                                      Sent
                                    </>
                                  ) : (
                                    'Pending'
                                  )}
                                </span>
                              ) : buttonState === 'received' ? (
                                <ActionButton
                                  onClick={() => {
                                    const request = requests.find(r => r.fromUid === result.uid);
                                    if (request) handleAcceptRequest(request);
                                  }}
                                  className="bg-green-500 text-black text-sm font-medium px-4 py-1.5 rounded-full hover:bg-green-400"
                                >
                                  Accept
                                </ActionButton>
                              ) : (
                                <ActionButton
                                  onClick={() => handleSendRequest(result.uid)}
                                  disabled={isSending}
                                  className={`text-sm font-medium px-4 py-1.5 rounded-full ${
                                    isSending
                                      ? 'bg-zinc-700 text-zinc-400'
                                      : 'bg-white text-black hover:bg-gray-100 active:bg-gray-200'
                                  }`}
                                >
                                  {isSending ? (
                                    <span className="flex items-center gap-2">
                                      <div className="w-3 h-3 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
                                      Adding...
                                    </span>
                                  ) : (
                                    'Add Friend'
                                  )}
                                </ActionButton>
                              )
                            }
                          />
                        );
                      })}
                    </div>
                  )}

                  {!searchQuery && (
                    <p className="text-gray-500 text-center py-8">
                      Search for friends by their username
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Animation styles */}
        <style>{`
          @keyframes slide-up {
            from {
              transform: translateY(100%);
            }
            to {
              transform: translateY(0);
            }
          }
          @keyframes slide-down {
            from {
              transform: translateY(0);
            }
            to {
              transform: translateY(100%);
            }
          }
          .animate-slide-up {
            animation: slide-up 0.3s ease-out forwards;
          }
          .animate-slide-down {
            animation: slide-down 0.25s ease-in forwards;
          }
        `}</style>
      </div>
    </div>
  );
};

export default Friends;
