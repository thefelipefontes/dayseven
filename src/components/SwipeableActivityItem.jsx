import React, { useState, useEffect, useRef, useContext, useCallback, createContext } from 'react';
import { triggerHaptic, ImpactStyle } from '../utils/haptics';
import LongPressMenu from './LongPressMenu';

// Global ref to track if user is currently pulling to refresh (for blocking taps during pull)
export const globalIsPulling = { current: false };

// Context to track which swipeable item is currently open
export const SwipeableContext = createContext({ openId: null, setOpenId: () => {}, closeAll: () => {} });

// Provider component to wrap lists of swipeable items
export const SwipeableProvider = ({ children }) => {
  const [openId, setOpenId] = useState(null);
  const closeAll = useCallback(() => {
    setOpenId(null);
  }, []);
  return (
    <SwipeableContext.Provider value={{ openId, setOpenId, closeAll }}>
      {/* Invisible overlay to catch taps outside swiped item */}
      {openId !== null && (
        <div
          className="fixed inset-0"
          style={{ zIndex: 9998 }}
          onClick={closeAll}
          onTouchEnd={(e) => {
            e.preventDefault();
            closeAll();
          }}
        />
      )}
      {children}
    </SwipeableContext.Provider>
  );
};

// Swipeable Activity Item Component for swipe-to-delete with long-press menu
export const SwipeableActivityItem = ({ children, onDelete, activity, onTap, onEdit }) => {
  const { openId, setOpenId } = useContext(SwipeableContext);
  const [swipeX, setSwipeX] = useState(0);
  const [isBouncing, setIsBouncing] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [longPressMenu, setLongPressMenu] = useState({ show: false, x: 0, y: 0 });
  const longPressTimer = useRef(null);

  // Use refs for touch tracking to avoid stale closure issues
  const swipeRef = useRef(null);
  const swipeXRef = useRef(0); // Track current swipeX value
  const touchState = useRef({
    startX: null,
    startY: null,
    startSwipeX: 0,
    hasMoved: false,
    startTime: 0
  });

  // Keep swipeXRef in sync with swipeX state
  useEffect(() => {
    swipeXRef.current = swipeX;
  }, [swipeX]);

  // Keep longPressMenu ref in sync to avoid stale closure
  const longPressMenuRef = useRef(longPressMenu);
  useEffect(() => {
    longPressMenuRef.current = longPressMenu;
  }, [longPressMenu]);

  const deleteButtonWidth = 100;
  const snapThreshold = 40;
  const moveThreshold = 10; // Increased threshold for iOS
  const itemId = activity.id;

  // Close this item if another one becomes the open one, or if closeAll is triggered (openId becomes null)
  useEffect(() => {
    if (openId !== itemId && swipeX !== 0) {
      setSwipeX(0);
      setIsBouncing(false);
    }
  }, [openId, itemId, swipeX]);

  // Attach touch event listeners with { passive: false } for iOS
  useEffect(() => {
    const element = swipeRef.current;
    if (!element) return;

    const handleTouchStart = (e) => {
      const touch = e.touches[0];
      touchState.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        startSwipeX: swipeXRef.current,
        hasMoved: false,
        startTime: Date.now()
      };
      setIsBouncing(false);
      // Only show press effect if card is closed
      if (swipeXRef.current === 0) {
        setIsPressed(true);
      }

      // Start long-press timer (500ms)
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      longPressTimer.current = setTimeout(() => {
        if (!touchState.current.hasMoved && swipeXRef.current === 0) {
          triggerHaptic(ImpactStyle.Heavy);
          setLongPressMenu({ show: true, x: touch.clientX, y: touch.clientY });
          setIsPressed(false);
        }
      }, 500);
    };

    const handleTouchMove = (e) => {
      const { startX, startY, startSwipeX, hasMoved } = touchState.current;
      if (startX === null) return;

      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      const diffX = currentX - startX;
      const diffY = currentY - startY;

      // Cancel long-press if user moves significantly (15px to allow for finger micro-movements)
      if (Math.abs(diffX) > 15 || Math.abs(diffY) > 15) {
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
      }

      // Once we've started swiping, continue updating position
      if (hasMoved) {
        e.preventDefault(); // Prevent scrolling while swiping
        const newSwipeX = Math.max(-deleteButtonWidth - 30, Math.min(0, startSwipeX + diffX));
        setSwipeX(newSwipeX);
        return;
      }

      // Detect if this is a vertical scroll (should cancel tap)
      if (Math.abs(diffY) > moveThreshold) {
        touchState.current.hasMoved = true; // Mark as moved to prevent tap
        setIsPressed(false);
        return; // Let scroll happen naturally
      }

      // Detect if this is a horizontal swipe (not vertical scroll)
      if (Math.abs(diffX) > moveThreshold && Math.abs(diffX) > Math.abs(diffY)) {
        touchState.current.hasMoved = true;
        setIsPressed(false);
        e.preventDefault(); // Prevent scrolling when swiping horizontally
        // Notify context that this item is being swiped (close others)
        if (diffX < 0) {
          setOpenId(itemId);
        }
        const newSwipeX = Math.max(-deleteButtonWidth - 30, Math.min(0, startSwipeX + diffX));
        setSwipeX(newSwipeX);
      }
    };

    const handleTouchEnd = (e) => {
      // Clear long-press timer
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }

      const { hasMoved, startTime } = touchState.current;
      const touchDuration = Date.now() - startTime;
      const currentSwipeX = swipeXRef.current; // Use ref for current value
      const wasTap = !hasMoved && touchDuration < 300 && currentSwipeX === 0;

      setIsPressed(false);

      // If long-press menu is showing, don't do anything else
      if (longPressMenuRef.current.show) {
        touchState.current = { startX: null, startY: null, startSwipeX: 0, hasMoved: false, startTime: 0 };
        return;
      }

      if (wasTap && !globalIsPulling.current) {
        // This was a tap, not a swipe, and we're not pulling to refresh - trigger click on target
        const target = e.target;
        if (target && typeof target.click === 'function') {
          setTimeout(() => target.click(), 10);
        }
        touchState.current = { startX: null, startY: null, startSwipeX: 0, hasMoved: false, startTime: 0 };
        return;
      }

      // Check swipe position and snap accordingly
      if (currentSwipeX < -snapThreshold) {
        setIsBouncing(true);
        setSwipeX(-deleteButtonWidth);
        setOpenId(itemId);
        setTimeout(() => setIsBouncing(false), 500);
      } else {
        setSwipeX(0);
        setOpenId(null);
      }

      touchState.current = { startX: null, startY: null, startSwipeX: 0, hasMoved: false, startTime: 0 };
    };

    // Add event listeners with passive: false to allow preventDefault
    element.addEventListener('touchstart', handleTouchStart, { passive: true });
    element.addEventListener('touchmove', handleTouchMove, { passive: false });
    element.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }, [itemId, setOpenId]); // Only re-attach if itemId or setOpenId changes

  const handleDeleteClick = (e) => {
    e.stopPropagation();
    triggerHaptic(ImpactStyle.Medium);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    setShowDeleteConfirm(false);
    setSwipeX(0);
    setOpenId(null);
    onDelete(activity);
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirm(false);
    setSwipeX(0);
    setOpenId(null);
  };

  const resetSwipe = () => {
    setSwipeX(0);
    setOpenId(null);
  };

  // Get transition style based on state
  const getTransition = () => {
    if (touchState.current.hasMoved) return 'none'; // No transition while actively swiping
    if (isBouncing) return 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)'; // Stronger bounce easing
    return 'transform 0.3s ease-out';
  };

  // Only show delete button when actually swiped left
  const showDeleteButton = swipeX < 0;

  return (
    <>
      <div
        className="relative overflow-hidden rounded-xl"
        style={{
          backgroundColor: showDeleteButton ? '#FF453A' : 'transparent',
          zIndex: showDeleteButton ? 9999 : 'auto',
          position: showDeleteButton ? 'relative' : 'static'
        }}
      >
        {/* Delete button - positioned on right, only visible when swiping */}
        {showDeleteButton && (
          <div
            className="absolute right-0 top-0 bottom-0 flex items-center justify-center"
            style={{ width: deleteButtonWidth }}
          >
          <button
            onClick={handleDeleteClick}
            className="h-full w-full flex items-center justify-center gap-2 text-white font-medium transition-transform duration-150"
            onTouchEnd={(e) => {
              e.stopPropagation();
            }}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
        )}

        {/* Main content with swipe */}
        <div
          ref={swipeRef}
          className="relative bg-zinc-900 swipeable-item"
          style={{
            transform: `translateX(${swipeX}px)${isPressed ? ' scale(0.98)' : ''}`,
            transition: getTransition()
          }}
        >
          {children}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.8)' }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              handleCancelDelete();
            }
          }}
          onTouchStart={(e) => {
            if (e.target === e.currentTarget) {
              e.preventDefault();
              handleCancelDelete();
            }
          }}
        >
          <div
            className="w-full max-w-xs bg-zinc-900 rounded-2xl overflow-hidden"
            onMouseDown={e => e.stopPropagation()}
            onTouchStart={e => e.stopPropagation()}
          >
            <div className="p-6 text-center">
              <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <h3 className="text-white font-bold text-lg mb-2">Delete Activity?</h3>
              <p className="text-gray-400 text-sm mb-1">
                {activity.type === 'Other' ? (activity.subtype || 'Other') : (activity.type + (activity.subtype ? ` • ${activity.subtype}` : ''))}
              </p>
              <p className="text-gray-500 text-xs">
                This action cannot be undone.
              </p>
            </div>
            <div className="flex border-t border-zinc-800">
              <button
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.currentTarget.style.transform = 'scale(0.95)';
                  e.currentTarget.style.backgroundColor = 'rgba(39, 39, 42, 1)';
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = '';
                  handleCancelDelete();
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = '';
                }}
                onTouchStart={(e) => {
                  e.stopPropagation();
                  e.currentTarget.style.transform = 'scale(0.95)';
                  e.currentTarget.style.backgroundColor = 'rgba(39, 39, 42, 1)';
                }}
                onTouchEnd={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = '';
                  handleCancelDelete();
                }}
                className="flex-1 py-4 text-white font-medium border-r border-zinc-800 transition-all duration-150"
              >
                Cancel
              </button>
              <button
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.currentTarget.style.transform = 'scale(0.95)';
                  e.currentTarget.style.backgroundColor = 'rgba(39, 39, 42, 1)';
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = '';
                  triggerHaptic(ImpactStyle.Heavy);
                  handleConfirmDelete();
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = '';
                }}
                onTouchStart={(e) => {
                  e.stopPropagation();
                  e.currentTarget.style.transform = 'scale(0.95)';
                  e.currentTarget.style.backgroundColor = 'rgba(39, 39, 42, 1)';
                }}
                onTouchEnd={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = '';
                  triggerHaptic(ImpactStyle.Heavy);
                  handleConfirmDelete();
                }}
                className="flex-1 py-4 text-red-500 font-medium transition-all duration-150"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Long Press Context Menu */}
      <LongPressMenu
        show={longPressMenu.show}
        position={{ x: longPressMenu.x, y: longPressMenu.y }}
        onClose={() => setLongPressMenu({ show: false, x: 0, y: 0 })}
        onEdit={() => {
          if (onEdit) onEdit(activity);
        }}
        onDelete={() => {
          setShowDeleteConfirm(true);
        }}
      />
    </>
  );
};
