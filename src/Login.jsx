import React, { useState, useEffect } from 'react';
import { signInWithPopup, signInWithCredential, OAuthProvider, GoogleAuthProvider, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, sendPasswordResetEmail } from 'firebase/auth';
import { auth, googleProvider, appleProvider } from './firebase';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';

const Login = ({ onLogin }) => {
  const [authMode, setAuthMode] = useState('main'); // 'main', 'email-signin', 'email-signup', 'forgot-password'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);

  // Check if running in Capacitor (native app)
  const isNative = Capacitor.isNativePlatform();

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setError('');
    try {
      if (isNative) {
        // Use native Google Sign In through Capacitor plugin
        const result = await FirebaseAuthentication.signInWithGoogle();
        // console.log('Google Sign In result:', result);

        // The plugin signs the user into Firebase natively
        // Pass the user info directly to trigger state update
        if (result.user) {
          const user = {
            uid: result.user.uid,
            email: result.user.email,
            displayName: result.user.displayName,
            photoURL: result.user.photoUrl,
          };
          // Don't set isLoading to false - let the parent handle the transition
          await onLogin(user);
          return; // Exit early, parent will handle state
        }
      } else {
        // Use popup for web
        const result = await signInWithPopup(auth, googleProvider);
        onLogin(result.user);
      }
    } catch (error) {
      // console.error('Error signing in with Google:', error);
      setError('Failed to sign in with Google. Please try again.');
      setIsLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    setIsLoading(true);
    setError('');
    try {
      if (isNative) {
        // Use native Apple Sign In through Capacitor plugin
        // The plugin handles Firebase authentication internally
        const result = await FirebaseAuthentication.signInWithApple();
        // console.log('Apple Sign In result:', result);

        // The plugin already signs the user into Firebase natively
        // Just pass the user info to the app - auth state listener will sync
        if (result.user) {
          const user = {
            uid: result.user.uid,
            email: result.user.email,
            displayName: result.user.displayName,
            photoURL: result.user.photoUrl,
          };
          onLogin(user);
        }
      } else {
        // Use popup for web
        await signInWithPopup(auth, appleProvider);
        // onLogin not needed - onAuthStateChanged in App.jsx will handle it
      }
    } catch (error) {
      // console.error('Error signing in with Apple:', error);
      // console.error('Error code:', error.code);
      // User cancelled is not an error we need to show
      if (error.code === 'ERROR_CANCELED' || error.message?.includes('cancel')) {
        setError('');
      } else {
        setError('Failed to sign in with Apple: ' + error.message);
      }
    }
    setIsLoading(false);
  };

  const handleEmailSignUp = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    if (!displayName.trim()) {
      setError('Please enter your name');
      return;
    }

    setIsLoading(true);
    try {
      // console.log('Creating account with email:', email);
      if (isNative) {
        // Use native Firebase SDK via Capacitor plugin
        const result = await FirebaseAuthentication.createUserWithEmailAndPassword({
          email,
          password,
        });
        // console.log('Native account created:', result.user?.uid);
        // Update display name
        if (result.user) {
          await FirebaseAuthentication.updateProfile({
            displayName: displayName.trim(),
          });
          // Pass the native user to the app
          const user = {
            uid: result.user.uid,
            email: result.user.email,
            displayName: displayName.trim(),
            photoURL: result.user.photoUrl,
          };
          onLogin(user);
        }
      } else {
        // Use web Firebase SDK
        const result = await createUserWithEmailAndPassword(auth, email, password);
        // console.log('Account created, updating profile...');
        await updateProfile(result.user, { displayName: displayName.trim() });
        // console.log('Profile updated');
        // onAuthStateChanged will handle it
      }
    } catch (error) {
      // console.error('Error signing up:', error);
      // console.error('Error code:', error.code);
      // console.error('Error message:', error.message);
      if (error.code === 'auth/email-already-in-use') {
        setError('An account with this email already exists');
      } else if (error.code === 'auth/invalid-email') {
        setError('Please enter a valid email address');
      } else {
        setError('Failed to create account: ' + error.message);
      }
    }
    setIsLoading(false);
  };

  const handleEmailSignIn = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      // console.log('Signing in with email:', email);
      if (isNative) {
        // Use native Firebase SDK via Capacitor plugin
        const result = await FirebaseAuthentication.signInWithEmailAndPassword({
          email,
          password,
        });
        // console.log('Native sign in successful:', result.user?.uid);
        // Pass the native user to the app
        if (result.user) {
          const user = {
            uid: result.user.uid,
            email: result.user.email,
            displayName: result.user.displayName,
            photoURL: result.user.photoUrl,
          };
          onLogin(user);
        }
      } else {
        // Use web Firebase SDK directly
        const result = await signInWithEmailAndPassword(auth, email, password);
        // console.log('Sign in successful:', result.user?.uid);
        // onAuthStateChanged will handle the rest
      }
    } catch (error) {
      // console.error('Error signing in:', error);
      // console.error('Error code:', error.code);
      if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        setError('Invalid email or password');
      } else if (error.code === 'auth/invalid-email') {
        setError('Please enter a valid email address');
      } else {
        setError('Failed to sign in: ' + error.message);
      }
    }
    setIsLoading(false);
  };

  const resetForm = () => {
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setDisplayName('');
    setError('');
    setResetEmailSent(false);
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setError('');

    if (!email.trim()) {
      setError('Please enter your email address');
      return;
    }

    setIsLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setResetEmailSent(true);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        setError('No account found with this email address');
      } else if (error.code === 'auth/invalid-email') {
        setError('Please enter a valid email address');
      } else {
        setError('Failed to send reset email. Please try again.');
      }
    }
    setIsLoading(false);
  };

  // Main login screen with social buttons
  if (authMode === 'main') {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6">
        {/* Logo/Wordmark */}
        <div className="mb-12 text-center">
          <img
            src="/wordmark.png"
            alt="Day Seven"
            className="h-10 mx-auto mb-4"
          />
          <p className="text-gray-400 text-lg">Set Your Standards. Earn Your Streaks.</p>
        </div>

        {/* Sign in buttons */}
        <div className="w-full max-w-sm space-y-3">
          {/* Apple Sign In */}
          <button
            onClick={handleAppleSignIn}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-3 bg-white text-black font-semibold py-3 px-6 rounded-full hover:bg-gray-100 active:scale-95 transition-all duration-200 disabled:opacity-50"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
            </svg>
            Continue with Apple
          </button>

          {/* Google Sign In */}
          <button
            onClick={handleGoogleSignIn}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-3 bg-white text-black font-semibold py-3 px-6 rounded-full hover:bg-gray-100 active:scale-95 transition-all duration-200 disabled:opacity-50"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Continue with Google
          </button>

          {/* Divider */}
          <div className="flex items-center gap-4 py-2">
            <div className="flex-1 h-px bg-gray-700" />
            <span className="text-gray-500 text-sm">or</span>
            <div className="flex-1 h-px bg-gray-700" />
          </div>

          {/* Email Sign In */}
          <button
            onClick={() => { resetForm(); setAuthMode('email-signin'); }}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-3 bg-zinc-800 text-white font-semibold py-3 px-6 rounded-full hover:bg-zinc-700 active:scale-95 transition-all duration-200 disabled:opacity-50"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
            Continue with Email
          </button>

          {/* Create Account Link */}
          <p className="text-center text-gray-500 text-sm pt-2">
            Don't have an account?{' '}
            <button
              onClick={() => { resetForm(); setAuthMode('email-signup'); }}
              className="text-green-400 font-medium hover:underline"
            >
              Sign up
            </button>
          </p>
        </div>

        {/* Error message */}
        {error && (
          <p className="mt-4 text-red-400 text-sm text-center">{error}</p>
        )}

        {/* Footer */}
        <p className="absolute bottom-8 text-gray-600 text-sm">
          Your data stays on your device
        </p>
      </div>
    );
  }

  // Email Sign In form
  if (authMode === 'email-signin') {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6 pt-safe">
        {/* Back button */}
        <button
          onClick={() => { resetForm(); setAuthMode('main'); }}
          className="absolute left-6 text-gray-400 hover:text-white transition-colors flex items-center gap-2"
          style={{ top: 'max(env(safe-area-inset-top, 20px), 50px)' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        {/* Title */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-white mb-2">Welcome back</h1>
          <p className="text-gray-400">Sign in to your account</p>
        </div>

        {/* Form */}
        <form onSubmit={handleEmailSignIn} className="w-full max-w-sm space-y-4">
          <div>
            <label className="block text-gray-400 text-sm mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full bg-zinc-800 text-white rounded-xl px-4 py-3 border border-zinc-700 focus:border-green-500 focus:outline-none transition-colors"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-gray-400 text-sm">Password</label>
              <button
                type="button"
                onClick={() => { setError(''); setAuthMode('forgot-password'); }}
                className="text-green-400 text-sm font-medium hover:underline"
              >
                Forgot password?
              </button>
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
              className="w-full bg-zinc-800 text-white rounded-xl px-4 py-3 border border-zinc-700 focus:border-green-500 focus:outline-none transition-colors"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 rounded-full font-semibold text-black transition-all duration-200 active:scale-95 disabled:opacity-50"
            style={{ backgroundColor: '#00FF94' }}
          >
            {isLoading ? 'Signing in...' : 'Sign In'}
          </button>

          <p className="text-center text-gray-500 text-sm pt-2">
            Don't have an account?{' '}
            <button
              type="button"
              onClick={() => { resetForm(); setAuthMode('email-signup'); }}
              className="text-green-400 font-medium hover:underline"
            >
              Sign up
            </button>
          </p>
        </form>
      </div>
    );
  }

  // Email Sign Up form
  if (authMode === 'email-signup') {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6 pt-safe">
        {/* Back button */}
        <button
          onClick={() => { resetForm(); setAuthMode('main'); }}
          className="absolute left-6 text-gray-400 hover:text-white transition-colors flex items-center gap-2"
          style={{ top: 'max(env(safe-area-inset-top, 20px), 50px)' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        {/* Title */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-white mb-2">Create account</h1>
          <p className="text-gray-400">Start tracking your streaks</p>
        </div>

        {/* Form */}
        <form onSubmit={handleEmailSignUp} className="w-full max-w-sm space-y-4">
          <div>
            <label className="block text-gray-400 text-sm mb-2">Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              required
              className="w-full bg-zinc-800 text-white rounded-xl px-4 py-3 border border-zinc-700 focus:border-green-500 focus:outline-none transition-colors"
            />
          </div>

          <div>
            <label className="block text-gray-400 text-sm mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full bg-zinc-800 text-white rounded-xl px-4 py-3 border border-zinc-700 focus:border-green-500 focus:outline-none transition-colors"
            />
          </div>

          <div>
            <label className="block text-gray-400 text-sm mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              required
              className="w-full bg-zinc-800 text-white rounded-xl px-4 py-3 border border-zinc-700 focus:border-green-500 focus:outline-none transition-colors"
            />
          </div>

          <div>
            <label className="block text-gray-400 text-sm mb-2">Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm your password"
              required
              className="w-full bg-zinc-800 text-white rounded-xl px-4 py-3 border border-zinc-700 focus:border-green-500 focus:outline-none transition-colors"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 rounded-full font-semibold text-black transition-all duration-200 active:scale-95 disabled:opacity-50"
            style={{ backgroundColor: '#00FF94' }}
          >
            {isLoading ? 'Creating account...' : 'Create Account'}
          </button>

          <p className="text-center text-gray-500 text-sm pt-2">
            Already have an account?{' '}
            <button
              type="button"
              onClick={() => { resetForm(); setAuthMode('email-signin'); }}
              className="text-green-400 font-medium hover:underline"
            >
              Sign in
            </button>
          </p>
        </form>
      </div>
    );
  }

  // Forgot Password form
  if (authMode === 'forgot-password') {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6 pt-safe">
        {/* Back button */}
        <button
          onClick={() => { resetForm(); setAuthMode('email-signin'); }}
          className="absolute left-6 text-gray-400 hover:text-white transition-colors flex items-center gap-2"
          style={{ top: 'max(env(safe-area-inset-top, 20px), 50px)' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        {/* Title */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-white mb-2">Reset password</h1>
          <p className="text-gray-400">We'll send you a reset link</p>
        </div>

        {resetEmailSent ? (
          <div className="w-full max-w-sm text-center">
            <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">Check your email</h2>
            <p className="text-gray-400 mb-6">
              We've sent a password reset link to <span className="text-white">{email}</span>
            </p>
            <button
              onClick={() => { resetForm(); setAuthMode('email-signin'); }}
              className="w-full py-3 rounded-full font-semibold text-black transition-all duration-200 active:scale-95"
              style={{ backgroundColor: '#00FF94' }}
            >
              Back to Sign In
            </button>
          </div>
        ) : (
          <form onSubmit={handleForgotPassword} className="w-full max-w-sm space-y-4">
            <div>
              <label className="block text-gray-400 text-sm mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full bg-zinc-800 text-white rounded-xl px-4 py-3 border border-zinc-700 focus:border-green-500 focus:outline-none transition-colors"
              />
            </div>

            {error && (
              <p className="text-red-400 text-sm">{error}</p>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 rounded-full font-semibold text-black transition-all duration-200 active:scale-95 disabled:opacity-50"
              style={{ backgroundColor: '#00FF94' }}
            >
              {isLoading ? 'Sending...' : 'Send Reset Link'}
            </button>

            <p className="text-center text-gray-500 text-sm pt-2">
              Remember your password?{' '}
              <button
                type="button"
                onClick={() => { resetForm(); setAuthMode('email-signin'); }}
                className="text-green-400 font-medium hover:underline"
              >
                Sign in
              </button>
            </p>
          </form>
        )}
      </div>
    );
  }

  return null;
};

export default Login;
