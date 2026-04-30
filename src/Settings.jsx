import React, { useState, useEffect, useRef } from 'react';
import { auth } from './firebase';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { checkUsernameAvailable } from './services/userService';

// Helper function for haptic feedback that works on iOS
const triggerHaptic = async (style = ImpactStyle.Medium) => {
  try {
    await Haptics.impact({ style });
  } catch (e) {
    // Fallback to vibrate API for web/Android
    if (navigator.vibrate) navigator.vibrate(10);
  }
};

// Duplicated from App.jsx — local date string helper
const toLocalDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Duplicated from App.jsx — week key helpers used by streak shield UI
const getCurrentWeekKey = () => {
  const today = new Date();
  const day = today.getDay(); // 0 = Sunday
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - day);
  return toLocalDateStr(sunday);
};

const getPreviousWeekKey = () => {
  const today = new Date();
  const day = today.getDay(); // 0 = Sunday
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - day - 7);
  return toLocalDateStr(sunday);
};

export default function SettingsPage({ user, userProfile, userData, onSignOut, onEditGoals, onUpdatePhoto, onShare, onStartTour, onUpdatePrivacy, onUpdateMaxHeartRate, onUpdateDisplayName, onUpdateUsername, onChangePassword, onResetPassword, onDeleteAccount, onNotificationSettings, isPro, onPresentPaywall, onPresentCustomerCenter, onRestorePurchases, onToggleVacationMode, onUseStreakShield, onClose }) {
  const [isEmailPasswordUser, setIsEmailPasswordUser] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [showVacationConfirm, setShowVacationConfirm] = useState(false);
  const [showVacationDeactivateConfirm, setShowVacationDeactivateConfirm] = useState(false);
  const [showShieldConfirmProfile, setShowShieldConfirmProfile] = useState(false);

  // Profile field edit modal — used for both display name and username.
  // editField is 'displayName' | 'username' | null.
  const [editField, setEditField] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [editError, setEditError] = useState('');
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [usernameTaken, setUsernameTaken] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const openEditField = (field) => {
    triggerHaptic(ImpactStyle.Light);
    if (field === 'displayName') {
      setEditValue(userProfile?.displayName || '');
    } else if (field === 'username') {
      setEditValue(userProfile?.username || '');
    }
    setEditError('');
    setUsernameTaken(false);
    setIsCheckingUsername(false);
    setEditField(field);
  };

  const closeEditField = () => {
    // Blur the input before unmount so iOS dismisses the keyboard cleanly.
    // Without this, the keyboard can stay momentarily wedged after the modal
    // closes (especially when dismissing via backdrop tap), leaving the
    // viewport in a state where Settings scroll feels locked.
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setEditField(null);
    setEditValue('');
    setEditError('');
    setUsernameTaken(false);
    setIsCheckingUsername(false);
    setIsSavingProfile(false);
  };

  // Debounced username availability check while typing in the edit modal.
  useEffect(() => {
    if (editField !== 'username') return;
    const lower = editValue.toLowerCase();
    if (!lower || lower === (userProfile?.username || '').toLowerCase()) {
      setUsernameTaken(false);
      setIsCheckingUsername(false);
      return;
    }
    if (!/^[a-z0-9_]{3,15}$/.test(lower)) {
      setUsernameTaken(false);
      setIsCheckingUsername(false);
      return;
    }
    setIsCheckingUsername(true);
    const t = setTimeout(async () => {
      try {
        const available = await checkUsernameAvailable(lower, user?.uid);
        setUsernameTaken(!available);
      } catch (e) {
        setUsernameTaken(false);
      }
      setIsCheckingUsername(false);
    }, 500);
    return () => clearTimeout(t);
  }, [editValue, editField, user?.uid, userProfile?.username]);

  const usernameValidationMessage = (() => {
    if (editField !== 'username') return null;
    const lower = editValue.toLowerCase();
    if (!lower) return null;
    if (lower === (userProfile?.username || '').toLowerCase()) return null;
    if (lower.length < 3) return { text: 'Must be at least 3 characters', isError: true };
    if (lower.length > 15) return { text: 'Must be 15 characters or less', isError: true };
    if (!/^[a-z0-9_]+$/.test(lower)) return { text: 'Letters, numbers, underscores only', isError: true };
    if (isCheckingUsername) return { text: 'Checking availability…', isError: false };
    if (usernameTaken) return { text: 'Username is already taken', isError: true };
    return { text: 'Username is available', isError: false };
  })();

  const canSaveProfile = (() => {
    if (isSavingProfile) return false;
    if (editField === 'displayName') {
      const trimmed = editValue.trim();
      return trimmed.length > 0 && trimmed !== (userProfile?.displayName || '').trim();
    }
    if (editField === 'username') {
      const lower = editValue.toLowerCase();
      if (!lower || lower === (userProfile?.username || '').toLowerCase()) return false;
      if (!/^[a-z0-9_]{3,15}$/.test(lower)) return false;
      if (isCheckingUsername || usernameTaken) return false;
      return true;
    }
    return false;
  })();

  const handleSaveProfileField = async () => {
    if (!canSaveProfile) return;
    setIsSavingProfile(true);
    setEditError('');
    try {
      if (editField === 'displayName') {
        await onUpdateDisplayName?.(editValue.trim());
      } else if (editField === 'username') {
        const lower = editValue.toLowerCase();
        // Re-check right before save to close the race window.
        const stillAvailable = await checkUsernameAvailable(lower, user?.uid);
        if (!stillAvailable) {
          setUsernameTaken(true);
          setIsSavingProfile(false);
          return;
        }
        await onUpdateUsername?.(lower);
      }
      triggerHaptic(ImpactStyle.Medium);
      closeEditField();
    } catch (e) {
      setEditError(e?.message || 'Could not save. Try again.');
      setIsSavingProfile(false);
    }
  };

  // Check if user signed in with email/password (not social login)
  useEffect(() => {
    const checkAuthProvider = async () => {
      // First try web Firebase auth
      if (auth.currentUser?.providerData?.some(p => p.providerId === 'password')) {
        setIsEmailPasswordUser(true);
        return;
      }
      // Then try prop
      if (user?.providerData?.some(p => p.providerId === 'password')) {
        setIsEmailPasswordUser(true);
        return;
      }
      // For native, use Capacitor plugin
      if (Capacitor.isNativePlatform()) {
        try {
          const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
          const result = await FirebaseAuthentication.getCurrentUser();
          if (result.user?.providerData?.some(p => p.providerId === 'password')) {
            setIsEmailPasswordUser(true);
          }
        } catch (e) {
          // Ignore errors
        }
      }
    };
    checkAuthProvider();
  }, [user]);
  const [showPhotoOptions, setShowPhotoOptions] = useState(false);
  const [showPhotoPreview, setShowPhotoPreview] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [capturedFile, setCapturedFile] = useState(null);
  const [imagePosition, setImagePosition] = useState({ x: 0, y: 0 });
  const [imageScale, setImageScale] = useState(1);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const cropContainerRef = useRef(null);

  // Privacy settings (default to true if not set)
  const showInActivityFeed = userProfile?.privacySettings?.showInActivityFeed !== false;
  const showOnLeaderboard = userProfile?.privacySettings?.showOnLeaderboard !== false;
  const smartSaveWalks = userProfile?.privacySettings?.smartSaveWalks !== false; // default true
  const [showSmartSaveInfo, setShowSmartSaveInfo] = useState(false);

  const handlePrivacyToggle = (setting, value) => {
    if (onUpdatePrivacy) {
      onUpdatePrivacy({
        ...userProfile?.privacySettings,
        [setting]: value
      });
    }
  };

  // Debounce timer ref for max HR input
  const maxHrTimerRef = useRef(null);
  const [localMaxHr, setLocalMaxHr] = useState(userProfile?.maxHeartRate || '');

  // Sync local input when profile value changes (e.g., auto-detected)
  useEffect(() => {
    if (userProfile?.maxHeartRate && !maxHrTimerRef.current) {
      setLocalMaxHr(userProfile.maxHeartRate);
    }
  }, [userProfile?.maxHeartRate]);

  const handleMaxHeartRateChange = (value) => {
    setLocalMaxHr(value);
    if (maxHrTimerRef.current) clearTimeout(maxHrTimerRef.current);
    maxHrTimerRef.current = setTimeout(() => {
      const hr = parseInt(value, 10);
      if (value === '' || value === undefined) {
        if (onUpdateMaxHeartRate) onUpdateMaxHeartRate(null);
      } else if (hr >= 100 && hr <= 220) {
        if (onUpdateMaxHeartRate) onUpdateMaxHeartRate(hr);
      }
    }, 800);
  };

  const goalLabels = {
    liftsPerWeek: { label: 'Strength', icon: '💪', suffix: '/week' },
    cardioPerWeek: { label: 'Cardio', icon: '❤️‍🔥', suffix: '/week' },
    recoveryPerWeek: { label: 'Recovery', icon: '🧊', suffix: '/week' },
    stepsPerDay: { label: 'Steps', icon: '👟', suffix: '/day', format: (v) => `${(v/1000).toFixed(0)}k` }
  };

  // Check if today is Sunday (0 = Sunday) - first day of the week
  const isSunday = new Date().getDay() === 0;
  const canEditGoals = isSunday;

  // Detect if user is on mobile device
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  const handlePhotoClick = () => {
    setShowPhotoOptions(true);
  };

  const handleChooseFromLibrary = async () => {
    setShowPhotoOptions(false);

    if (Capacitor.isNativePlatform()) {
      try {
        const image = await Camera.getPhoto({
          quality: 90,
          allowEditing: false,
          resultType: CameraResultType.DataUrl,
          source: CameraSource.Photos
        });

        if (image.dataUrl) {
          // Convert data URL to blob/file
          const response = await fetch(image.dataUrl);
          const blob = await response.blob();
          const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });

          setPreviewImage(image.dataUrl);
          setCapturedFile(file);
          setShowPhotoPreview(true);
        }
      } catch (error) {
        if (error.message !== 'User cancelled photos app') {
        }
      }
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleTakePhoto = async () => {
    setShowPhotoOptions(false);

    if (Capacitor.isNativePlatform()) {
      try {
        const image = await Camera.getPhoto({
          quality: 90,
          allowEditing: false,
          resultType: CameraResultType.DataUrl,
          source: CameraSource.Camera
        });

        if (image.dataUrl) {
          // Convert data URL to blob/file
          const response = await fetch(image.dataUrl);
          const blob = await response.blob();
          const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });

          setPreviewImage(image.dataUrl);
          setCapturedFile(file);
          setShowPhotoPreview(true);
        }
      } catch (error) {
        if (error.message !== 'User cancelled photos app') {
        }
      }
    } else {
      cameraInputRef.current?.click();
    }
  };

  const handleCameraCapture = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('Image must be less than 5MB');
      return;
    }

    // Create preview URL
    const imageUrl = URL.createObjectURL(file);
    setPreviewImage(imageUrl);
    setCapturedFile(file);
    setShowPhotoPreview(true);

    // Reset input for potential retake
    e.target.value = '';
  };

  const handleRetakePhoto = () => {
    // Clean up preview URL
    if (previewImage) {
      URL.revokeObjectURL(previewImage);
    }
    setPreviewImage(null);
    setCapturedFile(null);
    setShowPhotoPreview(false);
    setImagePosition({ x: 0, y: 0 });
    setImageScale(1);
    // Trigger camera again
    setTimeout(() => {
      cameraInputRef.current?.click();
    }, 100);
  };

  const handleChooseAnother = async () => {
    // Clean up preview URL
    if (previewImage) {
      URL.revokeObjectURL(previewImage);
    }
    setPreviewImage(null);
    setCapturedFile(null);
    setShowPhotoPreview(false);
    setImagePosition({ x: 0, y: 0 });
    setImageScale(1);
    // Open photo library
    setTimeout(() => {
      handleChooseFromLibrary();
    }, 100);
  };

  const handleSavePhoto = async () => {
    if (!capturedFile) return;

    setIsUploadingPhoto(true);
    try {
      // Crop the image based on user's position/zoom
      const croppedFile = await cropImage();
      await onUpdatePhoto(croppedFile);
      // Clean up
      if (previewImage) {
        URL.revokeObjectURL(previewImage);
      }
      setPreviewImage(null);
      setCapturedFile(null);
      setShowPhotoPreview(false);
      setImagePosition({ x: 0, y: 0 });
      setImageScale(1);
    } catch (error) {
      alert('Failed to upload photo. Please try again.');
    }
    setIsUploadingPhoto(false);
  };

  const handleCancelPreview = () => {
    // Clean up preview URL
    if (previewImage) {
      URL.revokeObjectURL(previewImage);
    }
    setPreviewImage(null);
    setCapturedFile(null);
    setShowPhotoPreview(false);
    setImagePosition({ x: 0, y: 0 });
    setImageScale(1);
  };

  // Refs for gesture tracking (more responsive than state)
  const gestureRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    initialDistance: 0,
    initialScale: 1
  });

  // Calculate the display size of the image to cover the container
  const getImageDisplaySize = () => {
    const containerSize = 256; // w-64 h-64 = 256px

    if (imageDimensions.width === 0 || imageDimensions.height === 0) {
      return { width: containerSize, height: containerSize };
    }

    const imgAspect = imageDimensions.width / imageDimensions.height;

    // To "cover" the container, we scale so the smaller dimension fits exactly
    if (imgAspect > 1) {
      // Landscape: height fits, width overflows
      return {
        width: containerSize * imgAspect,
        height: containerSize
      };
    } else {
      // Portrait/square: width fits, height overflows
      return {
        width: containerSize,
        height: containerSize / imgAspect
      };
    }
  };

  // Calculate max drag bounds based on image dimensions and scale
  const getMaxOffset = (scale) => {
    const containerSize = 256;
    const { width, height } = getImageDisplaySize();

    // Apply scale
    const scaledWidth = width * scale;
    const scaledHeight = height * scale;

    // Max offset is how much the scaled image extends beyond the container on each side
    const maxX = Math.max(0, (scaledWidth - containerSize) / 2);
    const maxY = Math.max(0, (scaledHeight - containerSize) / 2);

    return { maxX, maxY };
  };

  // Touch handlers for drag and pinch-to-zoom
  const handleTouchStart = (e) => {
    e.preventDefault();
    const gesture = gestureRef.current;

    if (e.touches.length === 1) {
      gesture.isDragging = true;
      gesture.startX = e.touches[0].clientX - imagePosition.x;
      gesture.startY = e.touches[0].clientY - imagePosition.y;
    } else if (e.touches.length === 2) {
      gesture.isDragging = false;
      gesture.initialDistance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      gesture.initialScale = imageScale;
    }
  };

  const handleTouchMove = (e) => {
    e.preventDefault();
    const gesture = gestureRef.current;

    if (e.touches.length === 1 && gesture.isDragging) {
      const newX = e.touches[0].clientX - gesture.startX;
      const newY = e.touches[0].clientY - gesture.startY;

      // Limit drag bounds based on image dimensions and scale
      const { maxX, maxY } = getMaxOffset(imageScale);
      const boundedX = Math.max(-maxX, Math.min(maxX, newX));
      const boundedY = Math.max(-maxY, Math.min(maxY, newY));

      setImagePosition({ x: boundedX, y: boundedY });
    } else if (e.touches.length === 2 && gesture.initialDistance > 0) {
      const currentDistance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const newScale = Math.min(Math.max((currentDistance / gesture.initialDistance) * gesture.initialScale, 1), 4);
      setImageScale(newScale);

      // Adjust position when zooming out to keep image in bounds
      const { maxX, maxY } = getMaxOffset(newScale);
      setImagePosition(prev => ({
        x: Math.max(-maxX, Math.min(maxX, prev.x)),
        y: Math.max(-maxY, Math.min(maxY, prev.y))
      }));
    }
  };

  const handleTouchEnd = (e) => {
    e.preventDefault();
    const gesture = gestureRef.current;
    gesture.isDragging = false;
    gesture.initialDistance = 0;
  };

  // Load image dimensions when preview image changes
  useEffect(() => {
    if (previewImage) {
      const img = new Image();
      img.onload = () => {
        setImageDimensions({ width: img.width, height: img.height });
      };
      img.src = previewImage;
    } else {
      setImageDimensions({ width: 0, height: 0 });
    }
  }, [previewImage]);

  // Crop the image based on position and scale before upload
  const cropImage = () => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Output size (square for profile picture)
        const outputSize = 512;
        canvas.width = outputSize;
        canvas.height = outputSize;

        // Container size in CSS pixels (matches w-64 h-64 = 256px)
        const containerSize = 256;

        // The image fills the container with object-fit: cover
        // So we need to figure out how it's being displayed
        const imgAspect = img.width / img.height;
        let coverWidth, coverHeight;

        if (imgAspect > 1) {
          // Landscape: height fits, width overflows
          coverHeight = containerSize;
          coverWidth = containerSize * imgAspect;
        } else {
          // Portrait/square: width fits, height overflows
          coverWidth = containerSize;
          coverHeight = containerSize / imgAspect;
        }

        // Apply scale
        const scaledWidth = coverWidth * imageScale;
        const scaledHeight = coverHeight * imageScale;

        // Calculate how position translates to source coordinates
        // Position offset in pixels -> offset in image coordinates
        const pixelToImageX = img.width / scaledWidth;
        const pixelToImageY = img.height / scaledHeight;

        // Center of visible area in image coordinates
        // (accounting for the translate offset and scale transform origin at center)
        const centerX = img.width / 2 - imagePosition.x * pixelToImageX;
        const centerY = img.height / 2 - imagePosition.y * pixelToImageY;

        // Size of visible square in image coordinates
        const visibleSizeInImage = (containerSize / scaledWidth) * img.width;

        // Source rectangle
        const sourceX = centerX - visibleSizeInImage / 2;
        const sourceY = centerY - visibleSizeInImage / 2;

        // Clamp to image bounds
        const clampedX = Math.max(0, Math.min(img.width - visibleSizeInImage, sourceX));
        const clampedY = Math.max(0, Math.min(img.height - visibleSizeInImage, sourceY));

        // Draw the cropped region
        ctx.drawImage(
          img,
          clampedX, clampedY, visibleSizeInImage, visibleSizeInImage,
          0, 0, outputSize, outputSize
        );

        canvas.toBlob((blob) => {
          const croppedFile = new File([blob], 'profile.jpg', { type: 'image/jpeg' });
          resolve(croppedFile);
        }, 'image/jpeg', 0.9);
      };
      img.src = previewImage;
    });
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('Image must be less than 5MB');
      return;
    }

    setIsUploadingPhoto(true);
    try {
      await onUpdatePhoto(file);
    } catch (error) {
      alert('Failed to upload photo. Please try again.');
    }
    setIsUploadingPhoto(false);

    // Reset input
    e.target.value = '';
  };

  return (
    <div className="overflow-y-auto h-full" style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}>
      {/* Floating sticky back button — overlays the page and stays pinned at
          top-left while the rest of the header scrolls away. Wrapper has
          height:0 so it doesn't push content down; the button itself is
          absolutely positioned and aligns with the spacer in the header below. */}
      {onClose && (
        <div className="sticky top-0 z-20" style={{ height: 0 }}>
          <button
            onClick={() => { triggerHaptic(ImpactStyle.Light); onClose(); }}
            aria-label="Close settings"
            className="absolute top-2 left-4 w-9 h-9 rounded-full flex items-center justify-center active:scale-95 transition-transform"
            style={{
              backgroundColor: 'rgba(20,20,20,0.75)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </div>
      )}

      {/* Header — title + subtitle. Back-button slot is an empty spacer because
          the sticky button above floats over this area on initial render. */}
      <div className="px-4 pt-2 pb-4 flex items-start gap-3">
        {onClose && <div className="w-9 h-9 flex-shrink-0" aria-hidden="true" />}
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-white">Settings</h1>
          <p className="text-sm text-gray-500">Set your standards. Earn your streaks.</p>
        </div>
      </div>

      <div className="px-4">
        {/* Profile Section */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">PROFILE</h3>
          <div className="rounded-2xl p-4" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
            {/* Hidden file inputs */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/*"
              className="hidden"
            />
            <input
              type="file"
              ref={cameraInputRef}
              onChange={handleCameraCapture}
              accept="image/*;capture=camera"
              capture
              className="hidden"
            />

            {/* Profile Photo & Name */}
            <div className="flex items-center gap-4 mb-4">
              <button
                onClick={handlePhotoClick}
                disabled={isUploadingPhoto}
                className="relative w-16 h-16 rounded-full bg-zinc-700 flex items-center justify-center overflow-hidden group transition-all duration-150 active:scale-95"
              >
                {userProfile?.photoURL ? (
                  <img src={userProfile.photoURL} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-2xl text-white">
                    {userProfile?.displayName?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?'}
                  </span>
                )}
                {/* Camera overlay — only show during upload. iOS WebKit's sticky :hover
                    after a tap-then-navigate from Profile was making this appear unprompted. */}
                <div
                  className="absolute inset-0 bg-black/50 flex items-center justify-center transition-opacity"
                  style={{ opacity: isUploadingPhoto ? 1 : 0, pointerEvents: 'none' }}
                >
                  {isUploadingPhoto ? (
                    <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                  )}
                </div>
              </button>
              <div className="flex-1">
                <div className="text-lg font-semibold text-white">
                  {userProfile?.displayName || 'User'}
                </div>
                {userProfile?.username && (
                  <div className="text-sm text-gray-400">@{userProfile.username}</div>
                )}
              </div>
            </div>

            {/* Profile Details */}
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => openEditField('displayName')}
                className="w-full flex items-center justify-between py-2 border-t border-zinc-700/50 active:opacity-60 transition-opacity"
              >
                <span className="text-sm text-gray-400">Display name</span>
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm text-white truncate">{userProfile?.displayName || 'Not set'}</span>
                  <svg className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
                  </svg>
                </span>
              </button>
              <div className="flex items-center justify-between py-2 border-t border-zinc-700/50">
                <span className="text-sm text-gray-400">Email</span>
                <span className="text-sm text-white">{user?.email || 'Not set'}</span>
              </div>
              <button
                type="button"
                onClick={() => openEditField('username')}
                className="w-full flex items-center justify-between py-2 border-t border-zinc-700/50 active:opacity-60 transition-opacity"
              >
                <span className="text-sm text-gray-400">Username</span>
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm text-white truncate">@{userProfile?.username || 'Not set'}</span>
                  <svg className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
                  </svg>
                </span>
              </button>
              <div className="flex items-center justify-between py-2 border-t border-zinc-700/50">
                <span className="text-sm text-gray-400">Member since</span>
                <span className="text-sm text-white">
                  {(() => {
                    const creationDate = user?.metadata?.creationTime || userProfile?.createdAt;
                    if (creationDate) {
                      return new Date(creationDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                    }
                    return 'Unknown';
                  })()}
                </span>
              </div>
              <div className="flex items-center justify-between py-2 border-t border-zinc-700/50">
                <span className="text-sm text-gray-400">Sign-in method</span>
                <span className="text-sm text-white flex items-center gap-1.5">
                  {(() => {
                    // First check userProfile.authProvider (most reliable for native)
                    const storedProvider = userProfile?.authProvider;
                    // Fallback to providerData for web
                    const currentUser = auth.currentUser;
                    const providers = currentUser?.providerData || user?.providerData || [];
                    const hasGoogle = storedProvider === 'google' || providers.some(p => p.providerId === 'google.com');
                    const hasApple = storedProvider === 'apple' || providers.some(p => p.providerId === 'apple.com');
                    const hasPassword = storedProvider === 'email' || providers.some(p => p.providerId === 'password');

                    if (hasGoogle) {
                      return (
                        <>
                          <svg className="w-4 h-4" viewBox="0 0 24 24">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                          </svg>
                          Google
                        </>
                      );
                    } else if (hasApple) {
                      return (
                        <>
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="white">
                            <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                          </svg>
                          Apple
                        </>
                      );
                    } else if (hasPassword) {
                      return (
                        <>
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                          </svg>
                          Email
                        </>
                      );
                    }
                    return 'Unknown';
                  })()}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Share Your Wins Section */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">CELEBRATE</h3>
          <button
            onClick={onShare}
            className="w-full rounded-2xl p-4 transition-all duration-150"
            style={{
              background: 'linear-gradient(135deg, rgba(0,255,148,0.1) 0%, rgba(0,209,255,0.1) 100%)',
              border: '1px solid rgba(0,255,148,0.2)',
              transform: 'scale(1)'
            }}
            onTouchStart={(e) => {
              e.currentTarget.style.transform = 'scale(0.98)';
              e.currentTarget.style.borderColor = 'rgba(0,255,148,0.4)';
            }}
            onTouchEnd={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.borderColor = 'rgba(0,255,148,0.2)';
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'scale(0.98)';
              e.currentTarget.style.borderColor = 'rgba(0,255,148,0.4)';
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.borderColor = 'rgba(0,255,148,0.2)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.borderColor = 'rgba(0,255,148,0.2)';
            }}
          >
            <div className="flex items-center gap-4">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: 'rgba(0,255,148,0.15)' }}
              >
                <span className="text-2xl">🏆</span>
              </div>
              <div className="flex-1 text-left">
                <div className="text-white font-semibold mb-0.5">Share Your Wins</div>
                <div className="text-gray-400 text-sm">Create a card to show off your streaks</div>
              </div>
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#00FF94"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
            </div>
          </button>
        </div>

        {/* Goals Section */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-gray-400">WEEKLY GOALS</h3>
            {canEditGoals ? (
              <button
                onClick={onEditGoals}
                className="text-sm font-medium px-3 py-1 rounded-full transition-all duration-150"
                style={{ color: '#00FF94', backgroundColor: 'rgba(0,255,148,0.1)', transform: 'scale(1)' }}
                onTouchStart={(e) => {
                  e.currentTarget.style.transform = 'scale(0.92)';
                  e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.2)';
                }}
                onTouchEnd={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.1)';
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = 'scale(0.92)';
                  e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.2)';
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'rgba(0,255,148,0.1)';
                }}
              >
                Edit
              </button>
            ) : (
              <span
                className="text-xs font-medium px-3 py-1 rounded-full flex items-center gap-1"
                style={{ color: 'rgba(255,255,255,0.4)', backgroundColor: 'rgba(255,255,255,0.05)' }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Sundays only
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-500 mb-3">Goals can only be edited on Sundays to keep your streaks honest</p>
          <div className="rounded-2xl p-4" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(goalLabels).map(([key, { label, icon, suffix, format }]) => (
                <div key={key} className="bg-zinc-700/30 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span>{icon}</span>
                    <span className="text-xs text-gray-400">{label}</span>
                  </div>
                  <div className="text-lg font-bold text-white">
                    {format ? format(userData?.goals?.[key] || 0) : userData?.goals?.[key] || 0}
                    <span className="text-xs text-gray-500 font-normal ml-1">{suffix}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Privacy Section */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">PRIVACY</h3>
          <div className="rounded-2xl p-4" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
            {/* Activity Feed Toggle */}
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(0,209,255,0.1)' }}>
                  <svg className="w-4 h-4" fill="none" stroke="#00D1FF" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
                  </svg>
                </div>
                <div>
                  <span className="text-sm text-white">Show in Activity Feed</span>
                  <p className="text-[11px] text-gray-500">Friends can see your workouts</p>
                </div>
              </div>
              <button
                onClick={() => {
                  triggerHaptic(ImpactStyle.Light);
                  handlePrivacyToggle('showInActivityFeed', !showInActivityFeed);
                }}
                className="w-12 h-7 rounded-full transition-all duration-200 relative"
                style={{
                  backgroundColor: showInActivityFeed ? '#00FF94' : 'rgba(255,255,255,0.2)'
                }}
              >
                <div
                  className="absolute top-1 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-200"
                  style={{
                    left: showInActivityFeed ? '26px' : '4px'
                  }}
                />
              </button>
            </div>

            {/* Leaderboard Toggle */}
            <div className="flex items-center justify-between py-2 border-t border-zinc-700/50 mt-2 pt-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(255,149,0,0.1)' }}>
                  <svg className="w-4 h-4" fill="none" stroke="#FF9500" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 0 1-.982-3.172M9.497 14.25a7.454 7.454 0 0 0 .981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 0 0 7.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 0 0 2.748 1.35m8.272-6.842V4.5c0 2.108-.966 3.99-2.48 5.228m2.48-5.492a46.32 46.32 0 0 1 2.916.52 6.003 6.003 0 0 1-5.395 4.972m0 0a6.726 6.726 0 0 1-2.749 1.35m0 0a6.772 6.772 0 0 1-2.992 0" />
                  </svg>
                </div>
                <div>
                  <span className="text-sm text-white">Appear on Leaderboards</span>
                  <p className="text-[11px] text-gray-500">Compete with friends</p>
                </div>
              </div>
              <button
                onClick={() => {
                  triggerHaptic(ImpactStyle.Light);
                  handlePrivacyToggle('showOnLeaderboard', !showOnLeaderboard);
                }}
                className="w-12 h-7 rounded-full transition-all duration-200 relative"
                style={{
                  backgroundColor: showOnLeaderboard ? '#00FF94' : 'rgba(255,255,255,0.2)'
                }}
              >
                <div
                  className="absolute top-1 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-200"
                  style={{
                    left: showOnLeaderboard ? '26px' : '4px'
                  }}
                />
              </button>
            </div>

          </div>
        </div>

        {/* Vacation Mode Section */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">VACATION MODE</h3>
          <div className="rounded-2xl p-4" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(0,209,255,0.1)' }}>
                  <span className="text-base">✈️</span>
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-white">Vacation Mode</span>
                    {!isPro && <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(255,149,0,0.15)', color: '#FF9500' }}>PRO</span>}
                  </div>
                  <p className="text-[11px] text-gray-500">Freeze streaks while you're away</p>
                </div>
              </div>
              <button
                onClick={() => {
                  triggerHaptic(ImpactStyle.Light);
                  if (!isPro) {
                    onPresentPaywall?.();
                    return;
                  }
                  if (userData.vacationMode?.isActive) {
                    setShowVacationDeactivateConfirm(true);
                  } else {
                    setShowVacationConfirm(true);
                  }
                }}
                className="w-12 h-7 rounded-full transition-all duration-200 relative"
                style={{
                  backgroundColor: userData.vacationMode?.isActive ? '#00D1FF' : 'rgba(255,255,255,0.2)'
                }}
              >
                <div
                  className="absolute top-1 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-200"
                  style={{
                    left: userData.vacationMode?.isActive ? '26px' : '4px'
                  }}
                />
              </button>
            </div>

            {/* Active state info */}
            {userData.vacationMode?.isActive && userData.vacationMode?.startDate && (
              <div className="mt-3 pt-3 border-t border-zinc-700/50">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#00D1FF' }} />
                  <span className="text-xs text-gray-300">
                    Active since {new Date(userData.vacationMode.startDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 ml-4">
                  {(() => {
                    const start = new Date(userData.vacationMode.startDate + 'T12:00:00');
                    const now = new Date();
                    const daysUsed = Math.floor((now - start) / (24 * 60 * 60 * 1000));
                    const daysRemaining = Math.max(0, 14 - daysUsed);
                    return `${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining · Auto-deactivates after 2 weeks`;
                  })()}
                </p>
              </div>
            )}

            {/* Inactive state info */}
            {!userData.vacationMode?.isActive && (
              <div className="mt-3 pt-3 border-t border-zinc-700/50">
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="none" stroke="#00D1FF" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                    <p className="text-[11px] text-gray-400">Streaks stay frozen — no progress lost</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="none" stroke="#00D1FF" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                    </svg>
                    <p className="text-[11px] text-gray-400">Max 2 weeks per activation, 3× per year</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="none" stroke="#FF9500" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                    </svg>
                    <p className="text-[11px] text-gray-400">
                      {(() => {
                        const vm = userData.vacationMode || {};
                        const currentYear = new Date().getFullYear();
                        const used = vm.activationYear === currentYear ? (vm.activationsThisYear || 0) : 0;
                        const remaining = Math.max(0, 3 - used);
                        return `${remaining} of 3 activation${remaining !== 1 ? 's' : ''} remaining this year`;
                      })()}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Streak Shield Section */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">STREAK SHIELD</h3>
          <div className="rounded-2xl p-4" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
            <div className="flex items-center gap-3 py-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(0,209,255,0.1)' }}>
                <span className="text-base">🛡️</span>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-white">Streak Shield</span>
                  {!isPro && <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(255,149,0,0.15)', color: '#FF9500' }}>PRO</span>}
                </div>
                <p className="text-[11px] text-gray-500">Protect your streaks when you miss a week</p>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-zinc-700/50">
              {(() => {
                const SHIELD_COOLDOWN_WEEKS = 6;
                const lastUsedWeek = userData.streakShield?.lastUsedWeek;
                const currentWeek = getCurrentWeekKey();
                const previousWeek = getPreviousWeekKey();
                const isShieldedCurrent = lastUsedWeek === currentWeek;
                const isShieldedPrevious = lastUsedWeek === previousWeek;
                const today = new Date();
                const isRetroWindow = today.getDay() <= 1; // Sunday or Monday

                // Already used this week or last week (retroactive)
                if (isShieldedCurrent || (isShieldedPrevious && isRetroWindow)) {
                  return (
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#00FF94' }} />
                      <span className="text-xs font-semibold" style={{ color: '#00FF94' }}>{isShieldedCurrent ? 'Active this week' : 'Active for last week'}</span>
                    </div>
                  );
                }

                let onCooldown = false;
                let weeksRemaining = 0;
                let availableDate = null;

                if (lastUsedWeek) {
                  const lastUsedDate = new Date(lastUsedWeek + 'T12:00:00');
                  const currentWeekDate = new Date(currentWeek + 'T12:00:00');
                  const weeksSinceUsed = Math.floor((currentWeekDate - lastUsedDate) / (7 * 24 * 60 * 60 * 1000));
                  if (weeksSinceUsed < SHIELD_COOLDOWN_WEEKS) {
                    onCooldown = true;
                    weeksRemaining = SHIELD_COOLDOWN_WEEKS - weeksSinceUsed;
                    availableDate = new Date(lastUsedDate);
                    availableDate.setDate(availableDate.getDate() + SHIELD_COOLDOWN_WEEKS * 7);
                  }
                }

                const shieldAvailable = !onCooldown;

                return (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: shieldAvailable ? '#00FF94' : '#FF9500' }} />
                        <span className="text-xs font-semibold" style={{ color: shieldAvailable ? '#00FF94' : '#FF9500' }}>
                          {shieldAvailable ? 'Available' : 'On cooldown'}
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          if (!isPro) { onPresentPaywall?.(); return; }
                          if (shieldAvailable) {
                            triggerHaptic(ImpactStyle.Medium);
                            setShowShieldConfirmProfile(true);
                          }
                        }}
                        className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-150"
                        style={{
                          backgroundColor: shieldAvailable ? 'rgba(0,209,255,0.15)' : 'rgba(255,255,255,0.05)',
                          color: shieldAvailable ? '#00D1FF' : '#555',
                          opacity: shieldAvailable ? 1 : 0.6,
                        }}
                        disabled={!shieldAvailable && isPro}
                      >
                        {!isPro ? 'Upgrade to Pro' : shieldAvailable ? 'Use Now' : 'On Cooldown'}
                      </button>
                    </div>
                    {lastUsedWeek && (
                      <p className="text-[11px] text-gray-500 ml-4">
                        Last used: week of {new Date(lastUsedWeek + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </p>
                    )}
                    {onCooldown && availableDate && (
                      <p className="text-[11px] text-gray-500 ml-4">
                        Available again: {availableDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ({weeksRemaining} week{weeksRemaining !== 1 ? 's' : ''} remaining)
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Streak Shield Confirmation Modal (Profile) */}
        {showShieldConfirmProfile && (() => {
          const currentWeek = getCurrentWeekKey();
          return (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={() => setShowShieldConfirmProfile(false)}>
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
              <div
                className="relative w-[85%] max-w-sm rounded-2xl p-6"
                style={{ backgroundColor: '#1a1a1a' }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex flex-col items-center text-center mb-5">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3" style={{ backgroundColor: 'rgba(0,209,255,0.1)' }}>
                    <span className="text-3xl">🛡️</span>
                  </div>
                  <h3 className="text-white font-semibold text-lg">Use Streak Shield?</h3>
                  <p className="text-gray-400 text-sm mt-2 leading-relaxed">
                    This will protect all your current streaks for this week, even if you don't complete your goals.
                  </p>
                </div>

                <div className="rounded-xl p-3 mb-5" style={{ backgroundColor: 'rgba(255,149,0,0.08)', border: '1px solid rgba(255,149,0,0.15)' }}>
                  <div className="flex items-start gap-2">
                    <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="#FF9500" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                    </svg>
                    <p className="text-xs leading-relaxed" style={{ color: '#FF9500' }}>
                      You only get <span className="font-semibold">1 streak shield every 6 weeks</span>. Once used, you won't be able to use another one until the cooldown resets.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setShowShieldConfirmProfile(false)}
                    className="flex-1 py-3 rounded-xl text-sm font-semibold text-white"
                    style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setShowShieldConfirmProfile(false);
                      triggerHaptic(ImpactStyle.Heavy);
                      onUseStreakShield?.(currentWeek);
                    }}
                    className="flex-1 py-3 rounded-xl text-sm font-semibold text-white"
                    style={{ backgroundColor: '#00D1FF' }}
                  >
                    Activate Shield
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Challenges Section */}
        {(() => {
          const stats = userProfile?.challengeStats || {};
          const wins = stats.wins || 0;
          const losses = stats.losses || 0;
          const currentStreak = stats.currentWinStreak || 0;
          const longestStreak = stats.longestWinStreak || 0;
          if (wins === 0 && losses === 0) return null;

          return (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-400 mb-3">CHALLENGES</h3>
              <div className="rounded-2xl p-4" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'rgba(255,214,10,0.08)' }}>
                    <p className="text-2xl font-bold" style={{ color: '#FFD60A' }}>{wins}</p>
                    <p className="text-gray-500 text-[11px] uppercase tracking-wider mt-1">Wins</p>
                  </div>
                  <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    <p className="text-2xl font-bold text-white">{currentStreak}</p>
                    <p className="text-gray-500 text-[11px] uppercase tracking-wider mt-1">Win Streak</p>
                  </div>
                  <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    <p className="text-2xl font-bold text-white">{longestStreak}</p>
                    <p className="text-gray-500 text-[11px] uppercase tracking-wider mt-1">Longest</p>
                  </div>
                </div>
                {losses > 0 && (
                  <p className="text-center text-xs text-gray-500 mt-3">
                    {wins}W &middot; {losses}L all-time
                  </p>
                )}
              </div>
            </div>
          );
        })()}

        {/* Notifications Section - Only on native */}
        {Capacitor.isNativePlatform() && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-400 mb-3">NOTIFICATIONS</h3>
            <div className="rounded-2xl p-4" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
              <button
                onClick={onNotificationSettings}
                className="w-full flex items-center justify-between py-2 transition-all duration-150"
                onTouchStart={(e) => e.currentTarget.style.opacity = '0.7'}
                onTouchEnd={(e) => e.currentTarget.style.opacity = '1'}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(0,209,255,0.1)' }}>
                    <svg className="w-4 h-4" fill="none" stroke="#00D1FF" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <span className="text-sm text-white block">Notification Preferences</span>
                    <p className="text-[11px] text-gray-500">Manage what notifications you receive</p>
                  </div>
                </div>
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Subscription Section - Only on native */}
        {Capacitor.isNativePlatform() && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-400 mb-3">SUBSCRIPTION</h3>
            <div className="rounded-2xl p-4" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
              {/* Status indicator */}
              <div className="flex items-center justify-between py-2 mb-1">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: isPro ? 'rgba(0,255,148,0.1)' : 'rgba(255,149,0,0.1)' }}>
                    <svg className="w-4 h-4" fill="none" stroke={isPro ? '#00FF94' : '#FF9500'} viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
                    </svg>
                  </div>
                  <div>
                    <span className="text-sm text-white block">{isPro ? 'DaySeven Pro' : 'DaySeven'}</span>
                    <p className="text-[11px]" style={{ color: isPro ? '#00FF94' : '#9ca3af' }}>
                      {isPro ? 'Active' : 'Free plan'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Action button: Upgrade or Manage */}
              <button
                onClick={isPro ? onPresentCustomerCenter : onPresentPaywall}
                className="w-full flex items-center justify-between py-2 border-t border-zinc-700/50 mt-1 pt-3 transition-all duration-150"
                onTouchStart={(e) => e.currentTarget.style.opacity = '0.7'}
                onTouchEnd={(e) => e.currentTarget.style.opacity = '1'}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: isPro ? 'rgba(0,209,255,0.1)' : 'rgba(255,149,0,0.1)' }}>
                    {isPro ? (
                      <svg className="w-4 h-4" fill="none" stroke="#00D1FF" viewBox="0 0 24 24" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 0 1 1.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 0 1-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 0 1-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 0 1 .12-1.45l.773-.773a1.125 1.125 0 0 1 1.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="#FF9500" viewBox="0 0 24 24" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
                      </svg>
                    )}
                  </div>
                  <span className="text-sm text-white">{isPro ? 'Manage Subscription' : 'Upgrade to Pro'}</span>
                </div>
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                </svg>
              </button>

              {/* Restore Purchases - only for non-pro users */}
              {!isPro && (
                <button
                  onClick={onRestorePurchases}
                  className="w-full flex items-center justify-between py-2 border-t border-zinc-700/50 mt-1 pt-3 transition-all duration-150"
                  onTouchStart={(e) => e.currentTarget.style.opacity = '0.7'}
                  onTouchEnd={(e) => e.currentTarget.style.opacity = '1'}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                      <svg className="w-4 h-4" fill="none" stroke="#9ca3af" viewBox="0 0 24 24" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
                      </svg>
                    </div>
                    <span className="text-sm text-gray-400">Restore Purchases</span>
                  </div>
                  <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Health Section */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">HEALTH</h3>
          <div className="rounded-2xl p-4" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
            {/* Smart Save Toggle */}
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(0,255,148,0.1)' }}>
                  <svg className="w-4 h-4" fill="none" stroke="#00FF94" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                </div>
                <div className="flex items-center gap-1.5">
                  <div>
                    <span className="text-sm text-white">Smart Save Walks</span>
                    <p className="text-[11px] text-gray-500">Auto-save low-intensity walks as non-cardio</p>
                  </div>
                  <button
                    onClick={() => {
                      triggerHaptic(ImpactStyle.Light);
                      setShowSmartSaveInfo(prev => !prev);
                    }}
                    className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center mr-3"
                    style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
                  >
                    <span className="text-[10px] text-gray-400 font-semibold">i</span>
                  </button>
                </div>
              </div>
              <button
                onClick={() => {
                  if (!userProfile?.maxHeartRate) return;
                  triggerHaptic(ImpactStyle.Light);
                  handlePrivacyToggle('smartSaveWalks', !smartSaveWalks);
                }}
                className="w-12 h-7 rounded-full transition-all duration-200 relative flex-shrink-0"
                style={{
                  backgroundColor: smartSaveWalks && userProfile?.maxHeartRate ? '#00FF94' : 'rgba(255,255,255,0.2)',
                  opacity: userProfile?.maxHeartRate ? 1 : 0.4
                }}
              >
                <div
                  className="absolute top-1 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-200"
                  style={{
                    left: smartSaveWalks && userProfile?.maxHeartRate ? '26px' : '4px'
                  }}
                />
              </button>
            </div>
            {showSmartSaveInfo && (
              <div className="mt-2 mb-1 p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
                <p className="text-[11px] text-gray-400 mb-2">
                  Walks are automatically saved without a notification when they meet any of these criteria:
                </p>
                <ul className="text-[11px] text-gray-400 space-y-1.5">
                  <li className="flex items-start gap-2">
                    <span className="text-gray-500 mt-px">•</span>
                    <span><span className="text-gray-300">Zone 1</span> — Heart rate below 60% of your max (any duration)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-gray-500 mt-px">•</span>
                    <span><span className="text-gray-300">Zone 2</span> — Heart rate 60-70% of your max, under 40 min</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-gray-500 mt-px">•</span>
                    <span><span className="text-gray-300">Zone 3</span> — Heart rate 70-80% of your max, under 15 min</span>
                  </li>
                </ul>
                {userProfile?.maxHeartRate && (
                  <p className="text-[10px] text-gray-500 mt-2">
                    Your max HR: {userProfile.maxHeartRate} bpm — Z1: &lt;{Math.floor(userProfile.maxHeartRate * 0.6)}, Z2: {Math.floor(userProfile.maxHeartRate * 0.6)}-{Math.floor(userProfile.maxHeartRate * 0.7)}, Z3: {Math.floor(userProfile.maxHeartRate * 0.7)}-{Math.floor(userProfile.maxHeartRate * 0.8)} bpm
                  </p>
                )}
              </div>
            )}

            {/* Max Heart Rate */}
            <div className="flex items-center justify-between py-2 border-t border-zinc-700/50 mt-2 pt-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(255,59,48,0.1)' }}>
                  <svg className="w-4 h-4" fill="none" stroke="#FF3B30" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
                  </svg>
                </div>
                <div>
                  <span className="text-sm text-white">Max Heart Rate</span>
                  <p className="text-[11px] text-gray-500">Used for Smart Save zones</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  value={localMaxHr}
                  placeholder="e.g. 190"
                  onChange={(e) => handleMaxHeartRateChange(e.target.value)}
                  className="w-20 px-3 py-1.5 rounded-lg text-white text-sm text-right outline-none"
                  style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
                  min="100"
                  max="220"
                />
                <span className="text-xs text-gray-400">bpm</span>
              </div>
            </div>
            {!userProfile?.maxHeartRate && (
              <p className="text-[10px] text-amber-500 mt-2 ml-11">
                Set your max HR to enable Smart Save for walks
              </p>
            )}
          </div>
        </div>

        {/* Password & Security Section - Only shown for email/password users */}
        {isEmailPasswordUser && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-400 mb-3">SECURITY</h3>
            <div className="rounded-2xl p-4" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
              {/* Change Password */}
              <button
                onClick={onChangePassword}
                className="w-full flex items-center justify-between py-2 transition-all duration-150"
                style={{ transform: 'scale(1)' }}
                onTouchStart={(e) => e.currentTarget.style.opacity = '0.7'}
                onTouchEnd={(e) => e.currentTarget.style.opacity = '1'}
                onMouseDown={(e) => e.currentTarget.style.opacity = '0.7'}
                onMouseUp={(e) => e.currentTarget.style.opacity = '1'}
                onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(0,255,148,0.1)' }}>
                    <svg className="w-4 h-4" fill="none" stroke="#00FF94" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <span className="text-sm text-white block">Change Password</span>
                    <p className="text-[11px] text-gray-500">Update your account password</p>
                  </div>
                </div>
                <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>

              {/* Reset Password */}
              <button
                onClick={onResetPassword}
                className="w-full flex items-center justify-between py-2 border-t border-zinc-700/50 mt-2 pt-4 transition-all duration-150"
                style={{ transform: 'scale(1)' }}
                onTouchStart={(e) => e.currentTarget.style.opacity = '0.7'}
                onTouchEnd={(e) => e.currentTarget.style.opacity = '1'}
                onMouseDown={(e) => e.currentTarget.style.opacity = '0.7'}
                onMouseUp={(e) => e.currentTarget.style.opacity = '1'}
                onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(255,149,0,0.1)' }}>
                    <svg className="w-4 h-4" fill="none" stroke="#FF9500" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <span className="text-sm text-white block">Reset Password via Email</span>
                    <p className="text-[11px] text-gray-500">Send a password reset link</p>
                  </div>
                </div>
                <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* App Info Section */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">APP</h3>
          <div className="rounded-2xl p-4" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
            <button
              onClick={onStartTour}
              className="w-full flex items-center justify-between py-2 transition-all duration-150"
              style={{ transform: 'scale(1)' }}
              onTouchStart={(e) => e.currentTarget.style.opacity = '0.7'}
              onTouchEnd={(e) => e.currentTarget.style.opacity = '1'}
              onMouseDown={(e) => e.currentTarget.style.opacity = '0.7'}
              onMouseUp={(e) => e.currentTarget.style.opacity = '1'}
              onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(0,255,148,0.1)' }}>
                  <span className="text-base">🎯</span>
                </div>
                <span className="text-sm text-white">Take the Tour</span>
              </div>
              <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
            <div className="flex items-center justify-between py-2 border-t border-zinc-700/50 mt-2">
              <span className="text-sm text-gray-400">Version</span>
              <span className="text-sm text-white">1.0.0</span>
            </div>
          </div>
        </div>

        {/* Sign Out Button */}
        <button
          className="w-full py-4 rounded-xl font-semibold text-red-500 transition-all duration-150"
          style={{ backgroundColor: 'rgba(255,69,58,0.1)', transform: 'scale(1)' }}
          onTouchStart={(e) => {
            e.currentTarget.style.transform = 'scale(0.98)';
            e.currentTarget.style.backgroundColor = 'rgba(255,69,58,0.2)';
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.backgroundColor = 'rgba(255,69,58,0.1)';
            triggerHaptic(ImpactStyle.Medium);
            onSignOut();
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = 'scale(0.98)';
            e.currentTarget.style.backgroundColor = 'rgba(255,69,58,0.2)';
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.backgroundColor = 'rgba(255,69,58,0.1)';
            onSignOut();
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.backgroundColor = 'rgba(255,69,58,0.1)';
          }}
        >
          Sign Out
        </button>

        {/* Delete Account Button */}
        <button
          className="w-full py-4 rounded-xl font-semibold text-gray-500 transition-all duration-150 mt-3"
          style={{ backgroundColor: 'transparent', transform: 'scale(1)' }}
          onTouchStart={(e) => {
            e.currentTarget.style.transform = 'scale(0.98)';
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            e.currentTarget.style.transform = 'scale(1)';
            triggerHaptic(ImpactStyle.Light);
            onDeleteAccount();
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = 'scale(0.98)';
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            onDeleteAccount();
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          Delete Account
        </button>
      </div>

      {/* Photo Options Popup */}
      {showPhotoOptions && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => setShowPhotoOptions(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />

          {/* Modal */}
          <div
            className="relative w-full max-w-sm mx-6 rounded-3xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: '#1C1C1E',
              border: '1px solid rgba(255,255,255,0.1)'
            }}
          >
            {/* Header */}
            <div className="px-6 pt-6 pb-4 text-center border-b border-zinc-800">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(0,255,148,0.15)' }}>
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="#00FF94" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white">Change Profile Picture</h3>
              <p className="text-sm text-gray-500 mt-1">
                {isMobile ? 'Choose how to update your photo' : 'Select a photo from your files, or use the mobile app to take one'}
              </p>
            </div>

            {/* Options */}
            <div className="p-4 space-y-2">
              {isMobile && (
                <button
                  className="w-full py-3.5 px-4 rounded-xl flex items-center gap-3 transition-all duration-150"
                  style={{ backgroundColor: 'rgba(255,255,255,0.05)', transform: 'scale(1)' }}
                  onTouchStart={(e) => {
                    e.currentTarget.style.transform = 'scale(0.98)';
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                  }}
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                    triggerHaptic(ImpactStyle.Light);
                    handleTakePhoto();
                  }}
                  onMouseDown={(e) => {
                    e.currentTarget.style.transform = 'scale(0.98)';
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                  }}
                  onMouseUp={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                    handleTakePhoto();
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                  }}
                >
                  <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(0,255,148,0.1)' }}>
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="#00FF94" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-white font-medium">Take Photo</div>
                    <div className="text-xs text-gray-500">Use your camera</div>
                  </div>
                  <svg className="w-5 h-5 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              )}

              <button
                className="w-full py-3.5 px-4 rounded-xl flex items-center gap-3 transition-all duration-150"
                style={{ backgroundColor: 'rgba(255,255,255,0.05)', transform: 'scale(1)' }}
                onTouchStart={(e) => {
                  e.currentTarget.style.transform = 'scale(0.98)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                  triggerHaptic(ImpactStyle.Light);
                  handleChooseFromLibrary();
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = 'scale(0.98)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                  handleChooseFromLibrary();
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                }}
              >
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(255,149,0,0.1)' }}>
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="#FF9500" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                </div>
                <div className="flex-1 text-left">
                  <div className="text-white font-medium">Choose from Library</div>
                  <div className="text-xs text-gray-500">Select an existing photo</div>
                </div>
                <svg className="w-5 h-5 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>

            {/* Cancel */}
            <div className="px-4 pb-4">
              <button
                className="w-full py-3 rounded-xl text-gray-400 font-medium transition-all duration-150"
                style={{ backgroundColor: 'rgba(255,255,255,0.03)', transform: 'scale(1)' }}
                onTouchStart={(e) => {
                  e.currentTarget.style.transform = 'scale(0.98)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)';
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)';
                  setShowPhotoOptions(false);
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = 'scale(0.98)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)';
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)';
                  setShowPhotoOptions(false);
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)';
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Photo Preview Modal */}
      {showPhotoPreview && previewImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
          {/* Preview Image */}
          <div className="relative w-full h-full flex flex-col">
            {/* Header - pushed down to avoid Dynamic Island */}
            <div className="absolute top-0 left-0 right-0 z-10 px-4 flex items-center justify-between" style={{ paddingTop: 'calc(env(safe-area-inset-top, 20px) + 10px)', background: 'linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, transparent 100%)', paddingBottom: '20px' }}>
              <button
                onClick={handleCancelPreview}
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
              >
                <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
              <span className="text-white font-semibold text-lg">Preview</span>
              <div className="w-10" />
            </div>

            {/* Image Container with touch handlers */}
            <div className="flex-1 flex items-center justify-center p-4">
              <div
                ref={cropContainerRef}
                className="relative w-64 h-64 rounded-full overflow-hidden border-4 border-white/20"
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                style={{ touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}
              >
                {imageDimensions.width > 0 && imageDimensions.height > 0 ? (() => {
                  const aspect = imageDimensions.width / imageDimensions.height;
                  const isLandscape = aspect > 1;
                  const imgWidth = isLandscape ? Math.round(256 * aspect) : 256;
                  const imgHeight = isLandscape ? 256 : Math.round(256 / aspect);
                  return (
                    <img
                      src={previewImage}
                      alt="Preview"
                      draggable={false}
                      style={{
                        position: 'absolute',
                        width: `${imgWidth}px`,
                        height: `${imgHeight}px`,
                        maxWidth: 'none',
                        maxHeight: 'none',
                        objectFit: 'fill',
                        left: '50%',
                        top: '50%',
                        transform: `translate(calc(-50% + ${imagePosition.x}px), calc(-50% + ${imagePosition.y}px)) scale(${imageScale})`,
                        transformOrigin: 'center center',
                        pointerEvents: 'none',
                        userSelect: 'none'
                      }}
                    />
                  );
                })() : (
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  </div>
                )}
              </div>
            </div>

            {/* Hint text */}
            <div className="absolute left-0 right-0 z-10 text-center" style={{ top: 'calc(50% + 160px)' }}>
              <p className="text-gray-500 text-xs">Drag to reposition • Pinch to zoom</p>
            </div>

            {/* Action Buttons */}
            <div className="absolute bottom-0 left-0 right-0 z-10 px-6 pb-10 pt-6" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 100%)' }}>
              <p className="text-center text-gray-400 text-sm mb-4">This is how your profile picture will look</p>

              <div className="flex gap-3">
                <button
                  onClick={handleChooseAnother}
                  disabled={isUploadingPhoto}
                  className="flex-1 py-3.5 rounded-xl font-semibold transition-all duration-150 active:scale-98"
                  style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: 'white' }}
                >
                  Choose Another
                </button>
                <button
                  onClick={handleSavePhoto}
                  disabled={isUploadingPhoto}
                  className="flex-1 py-3.5 rounded-xl font-semibold transition-all duration-150 active:scale-98 flex items-center justify-center gap-2"
                  style={{ backgroundColor: '#00FF94', color: 'black' }}
                >
                  {isUploadingPhoto ? (
                    <>
                      <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Use Photo'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Vacation Mode Confirmation Modal */}
      {showVacationConfirm && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={() => setShowVacationConfirm(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-[85%] max-w-sm rounded-2xl p-6"
            style={{ backgroundColor: '#1a1a1a' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col items-center text-center mb-5">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3" style={{ backgroundColor: 'rgba(0,209,255,0.1)' }}>
                <span className="text-3xl">✈️</span>
              </div>
              <h3 className="text-white font-semibold text-lg">Activate Vacation Mode?</h3>
              <p className="text-gray-400 text-sm mt-2 leading-relaxed">
                Your streaks will be frozen while vacation mode is active. They won't increase, but they won't break either.
              </p>
            </div>

            <div className="space-y-2 mb-5">
              <div className="flex items-start gap-2.5 rounded-xl p-2.5" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="#00D1FF" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
                <p className="text-xs text-gray-300">Auto-deactivates after <span className="text-white font-medium">2 weeks</span></p>
              </div>
              <div className="flex items-start gap-2.5 rounded-xl p-2.5" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="#FF9500" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                </svg>
                <p className="text-xs text-gray-300">
                  {(() => {
                    const vm = userData.vacationMode || {};
                    const currentYear = new Date().getFullYear();
                    const used = vm.activationYear === currentYear ? (vm.activationsThisYear || 0) : 0;
                    const remaining = Math.max(0, 3 - used);
                    return <><span className="text-white font-medium">{remaining} of 3</span> activation{remaining !== 1 ? 's' : ''} remaining this year</>;
                  })()}
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowVacationConfirm(false)}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-white"
                style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowVacationConfirm(false);
                  triggerHaptic(ImpactStyle.Heavy);
                  onToggleVacationMode?.();
                }}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-white"
                style={{ backgroundColor: '#00D1FF' }}
              >
                Activate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vacation Mode Deactivation Confirmation Modal */}
      {showVacationDeactivateConfirm && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={() => setShowVacationDeactivateConfirm(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-[85%] max-w-sm rounded-2xl p-6"
            style={{ backgroundColor: '#1a1a1a' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col items-center text-center mb-5">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3" style={{ backgroundColor: 'rgba(255,149,0,0.1)' }}>
                <span className="text-3xl">✈️</span>
              </div>
              <h3 className="text-white font-semibold text-lg">Deactivate Vacation Mode?</h3>
              <p className="text-gray-400 text-sm mt-2 leading-relaxed">
                Your streaks will no longer be frozen. You'll need to complete your weekly goals to keep them going.
              </p>
            </div>

            <div className="rounded-xl p-3 mb-5" style={{ backgroundColor: 'rgba(255,149,0,0.08)', border: '1px solid rgba(255,149,0,0.15)' }}>
              <div className="flex items-start gap-2">
                <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="#FF9500" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                </svg>
                <p className="text-xs leading-relaxed" style={{ color: '#FF9500' }}>
                  This uses one of your activations. You won't get it back if you turn it off early.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowVacationDeactivateConfirm(false)}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-white"
                style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
              >
                Keep Active
              </button>
              <button
                onClick={() => {
                  setShowVacationDeactivateConfirm(false);
                  triggerHaptic(ImpactStyle.Medium);
                  onToggleVacationMode?.();
                }}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-white"
                style={{ backgroundColor: '#FF9500' }}
              >
                Deactivate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit profile field modal — handles both display name and username. */}
      {editField && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center px-6"
          onClick={() => { if (!isSavingProfile) closeEditField(); }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-sm rounded-2xl p-6"
            style={{ backgroundColor: '#1a1a1a' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-white font-semibold text-lg mb-1">
              {editField === 'displayName' ? 'Edit display name' : 'Edit username'}
            </h3>
            <p className="text-gray-400 text-sm mb-4">
              {editField === 'displayName'
                ? 'This is the name your friends see.'
                : 'Your unique handle. 3–15 chars, letters, numbers, underscores.'}
            </p>

            <div className="relative mb-2">
              {editField === 'username' && (
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">@</span>
              )}
              <input
                type="text"
                value={editValue}
                onChange={(e) => {
                  if (editField === 'username') {
                    setEditValue(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''));
                  } else {
                    setEditValue(e.target.value);
                  }
                  setEditError('');
                }}
                placeholder={editField === 'username' ? 'username' : 'Your name'}
                maxLength={editField === 'username' ? 15 : 40}
                autoFocus
                autoCapitalize={editField === 'username' ? 'none' : 'words'}
                autoCorrect="off"
                spellCheck={false}
                className={`w-full bg-zinc-900 text-white py-3 rounded-xl border border-zinc-800 focus:border-green-500 focus:outline-none transition-colors ${editField === 'username' ? 'pl-10 pr-4' : 'px-4'}`}
              />
            </div>

            <div className="min-h-[20px] mb-4">
              {usernameValidationMessage && (
                <p className={`text-xs ${usernameValidationMessage.isError ? 'text-red-400' : 'text-green-400'}`}>
                  {usernameValidationMessage.text}
                </p>
              )}
              {editError && (
                <p className="text-xs text-red-400">{editError}</p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={closeEditField}
                disabled={isSavingProfile}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveProfileField}
                disabled={!canSaveProfile}
                className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-colors ${canSaveProfile ? 'bg-white text-black active:scale-95' : 'bg-zinc-800 text-zinc-500'}`}
              >
                {isSavingProfile ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin" />
                    Saving…
                  </span>
                ) : (
                  'Save'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
