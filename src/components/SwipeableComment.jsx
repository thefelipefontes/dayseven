import React, { createContext, useContext, useEffect, useState } from 'react';

// Context for swipeable comments
export const SwipeableCommentContext = createContext({ openId: null, setOpenId: () => {} });

// Swipeable Comment Component for swipe-to-delete
const SwipeableComment = ({ children, commentId, onDelete, canDelete }) => {
  const { openId, setOpenId } = useContext(SwipeableCommentContext);
  const [swipeX, setSwipeX] = useState(0);
  const [startX, setStartX] = useState(null);
  const [startSwipeX, setStartSwipeX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const deleteButtonWidth = 70;
  const snapThreshold = 30;

  // Close this item if another one becomes open
  useEffect(() => {
    if (openId !== commentId && swipeX !== 0) {
      setSwipeX(0);
    }
  }, [openId, commentId, swipeX]);

  const handleTouchStart = (e) => {
    if (!canDelete) return;
    setStartX(e.touches[0].clientX);
    setStartSwipeX(swipeX);
    setIsSwiping(true);
  };

  const handleTouchMove = (e) => {
    if (!canDelete || startX === null) return;
    const currentX = e.touches[0].clientX;
    const diff = currentX - startX;

    if (diff < 0) {
      setOpenId(commentId);
    }

    const newSwipeX = Math.max(-deleteButtonWidth - 20, Math.min(0, startSwipeX + diff));
    setSwipeX(newSwipeX);
  };

  const handleTouchEnd = () => {
    if (!canDelete) return;
    setIsSwiping(false);
    setStartX(null);

    if (swipeX < -snapThreshold) {
      setSwipeX(-deleteButtonWidth);
      setOpenId(commentId);
    } else {
      setSwipeX(0);
      if (openId === commentId) {
        setOpenId(null);
      }
    }
  };

  const handleDelete = (e) => {
    e.stopPropagation();
    setSwipeX(0);
    setOpenId(null);
    onDelete();
  };

  if (!canDelete) {
    return <div>{children}</div>;
  }

  // The red button fills only the gap the swipe opens, less a small gutter, so it never
  // sits under the comment: reply bubbles are see-through and showed it as a dark red patch.
  const revealed = Math.max(0, -swipeX - 6);

  return (
    <div className="relative overflow-hidden rounded-lg">
      {/* Delete button - positioned on the right, only visible when swiping */}
      <button
        onClick={handleDelete}
        aria-label="Delete comment"
        className="absolute inset-y-0 right-0 flex items-center justify-center rounded-2xl overflow-hidden"
        style={{
          width: revealed,
          backgroundColor: '#FF453A',
          opacity: revealed > 0 ? 1 : 0,
          pointerEvents: revealed > 0 ? 'auto' : 'none',
          transition: isSwiping ? 'none' : 'width 0.3s ease-out, opacity 0.3s ease-out',
        }}
      >
        <svg className="w-5 h-5 text-white flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>

      {/* Content: its right edge pulls in to make room for the button, rather than the
          whole comment sliding left and getting cut off at the edge of an indented reply. */}
      <div
        className="relative"
        style={{
          marginRight: -swipeX,
          transition: isSwiping ? 'none' : 'margin-right 0.3s ease-out'
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>
    </div>
  );
};

export default SwipeableComment;
