import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { updateUserProfile, checkUsernameAvailable } from './services/userService';
import { Capacitor } from '@capacitor/core';
import { FirebaseFirestore } from '@capacitor-firebase/firestore';

const isNative = Capacitor.isNativePlatform();

const UsernameSetup = ({ user, onComplete }) => {
  const [username, setUsername] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [isTaken, setIsTaken] = useState(false);
  const [isValid, setIsValid] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const validateUsername = (value) => {
    const regex = /^[a-z0-9_]{3,15}$/;
    return regex.test(value);
  };

  const handleUsernameChange = (e) => {
    const value = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
    setUsername(value);
    setIsValid(validateUsername(value));
    setIsTaken(false);
  };

  // Check if username is taken (debounced)
  useEffect(() => {
    if (!username || !isValid) {
      setIsTaken(false);
      return;
    }

    const checkUsername = async () => {
      setIsChecking(true);
      try {
        if (isNative) {
          // Use native Firestore to check username
          const { snapshot } = await FirebaseFirestore.getDocument({
            reference: `usernames/${username.toLowerCase()}`
          });
          setIsTaken(!!snapshot?.data);
        } else {
          // Use web Firestore
          const usersRef = collection(db, 'users');
          const q = query(usersRef, where('username', '==', username));
          const querySnapshot = await getDocs(q);
          setIsTaken(!querySnapshot.empty);
        }
      } catch (error) {
        console.error('Error checking username:', error);
        // On error, assume username is available to let user proceed
        setIsTaken(false);
      }
      setIsChecking(false);
    };

    const timeoutId = setTimeout(checkUsername, 500);
    return () => clearTimeout(timeoutId);
  }, [username, isValid]);

  const handleSubmit = async () => {
    if (!isValid || isTaken || isChecking) return;

    setIsSaving(true);
    try {
      await updateUserProfile(user.uid, { username: username.toLowerCase() });
      onComplete(username);
    } catch (error) {
      console.error('Error saving username:', error);
      // Still proceed on error - will sync later
      onComplete(username);
    }
    setIsSaving(false);
  };

  const getValidationMessage = () => {
    if (!username) return null;
    if (username.length < 3) return { text: 'Must be at least 3 characters', isError: true };
    if (username.length > 15) return { text: 'Must be 15 characters or less', isError: true };
    if (isChecking) return { text: 'Checking availability...', isError: false };
    if (isTaken) return { text: 'Username is already taken', isError: true };
    if (isValid) return { text: 'Username is available', isError: false };
    return null;
  };

  const validation = getValidationMessage();
  const canSubmit = isValid && !isTaken && !isChecking && !isSaving;

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white mb-2">Choose your username</h1>
          <p className="text-gray-400">This is how others will find you</p>
        </div>

        {/* Username input */}
        <div className="mb-4">
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">@</span>
            <input
              type="text"
              value={username}
              onChange={handleUsernameChange}
              placeholder="username"
              maxLength={15}
              autoFocus
              className="w-full bg-zinc-900 text-white pl-10 pr-4 py-4 rounded-xl border border-zinc-800 focus:border-green-500 focus:outline-none transition-colors"
            />
          </div>

          {/* Validation message */}
          {validation && (
            <p className={`mt-2 text-sm ${validation.isError ? 'text-red-400' : 'text-green-400'}`}>
              {validation.text}
            </p>
          )}

          {/* Character count */}
          <p className="mt-2 text-xs text-gray-500 text-right">
            {username.length}/15
          </p>
        </div>

        {/* Rules */}
        <div className="mb-6 text-xs text-gray-500">
          <p>• Letters, numbers, and underscores only</p>
          <p>• 3-15 characters</p>
        </div>

        {/* Submit button */}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`w-full py-4 rounded-xl font-semibold transition-all duration-200 ${
            canSubmit
              ? 'bg-white text-black active:scale-95'
              : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
          }`}
        >
          {isSaving ? (
            <span className="flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin" />
              Saving...
            </span>
          ) : (
            'Continue'
          )}
        </button>
      </div>
    </div>
  );
};

export default UsernameSetup;
