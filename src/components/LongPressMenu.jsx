import React from 'react';
import { triggerHaptic, ImpactStyle } from '../utils/haptics';

const LongPressMenu = ({ show, position, onClose, onEdit, onDelete, onShare }) => {
  if (!show) return null;

  // Position menu above the touch point with arrow pointing down
  const menuWidth = 200;
  const menuHeight = 130;
  const arrowSize = 12;
  const offsetAbove = 20; // Gap between arrow and touch point
  const screenWidth = window.innerWidth;

  // Calculate position - prefer above the finger
  let menuTop = position.y - menuHeight - arrowSize - offsetAbove;
  let menuLeft = position.x - menuWidth / 2;
  let showAbove = true;

  // If menu would go above screen, show below finger instead
  if (menuTop < 60) {
    menuTop = position.y + offsetAbove + arrowSize;
    showAbove = false;
  }

  // Keep menu within horizontal bounds
  menuLeft = Math.max(16, Math.min(menuLeft, screenWidth - menuWidth - 16));

  // Calculate arrow position relative to menu (pointing at touch x position)
  const arrowLeft = Math.max(20, Math.min(position.x - menuLeft, menuWidth - 20));

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[60] bg-black/40"
        onClick={onClose}
        onTouchEnd={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      {/* Menu with arrow */}
      <div
        className="fixed z-[61]"
        style={{
          top: menuTop,
          left: menuLeft,
          width: `${menuWidth}px`,
          animation: 'scaleIn 150ms ease-out',
        }}
      >
        {/* Arrow pointing up (when menu is below) */}
        {!showAbove && (
          <div
            style={{
              position: 'absolute',
              top: -arrowSize + 1,
              left: arrowLeft - arrowSize,
              width: 0,
              height: 0,
              borderLeft: `${arrowSize}px solid transparent`,
              borderRight: `${arrowSize}px solid transparent`,
              borderBottom: `${arrowSize}px solid rgba(38, 38, 38, 0.98)`,
            }}
          />
        )}
        {/* Menu content */}
        <div
          className="rounded-2xl overflow-hidden shadow-2xl"
          style={{
            backgroundColor: 'rgba(38, 38, 38, 0.98)',
            backdropFilter: 'blur(20px)',
          }}
        >
          <button
            className="w-full px-5 py-4 flex items-center gap-4 text-white text-base font-medium active:bg-white/10"
            onClick={() => { onEdit(); onClose(); }}
            onTouchEnd={(e) => { e.stopPropagation(); triggerHaptic(ImpactStyle.Light); onEdit(); onClose(); }}
          >
            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
            </svg>
            Edit Activity
          </button>
          <div className="h-px bg-white/10 mx-4" />
          <button
            className="w-full px-5 py-4 flex items-center gap-4 text-red-400 text-base font-medium active:bg-white/10"
            onClick={() => { onDelete(); onClose(); }}
            onTouchEnd={(e) => { e.stopPropagation(); triggerHaptic(ImpactStyle.Medium); onDelete(); onClose(); }}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
            </svg>
            Delete Activity
          </button>
        </div>
        {/* Arrow pointing down (when menu is above) */}
        {showAbove && (
          <div
            style={{
              position: 'absolute',
              bottom: -arrowSize + 1,
              left: arrowLeft - arrowSize,
              width: 0,
              height: 0,
              borderLeft: `${arrowSize}px solid transparent`,
              borderRight: `${arrowSize}px solid transparent`,
              borderTop: `${arrowSize}px solid rgba(38, 38, 38, 0.98)`,
            }}
          />
        )}
      </div>
      <style>{`
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.9); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </>
  );
};

export default LongPressMenu;
