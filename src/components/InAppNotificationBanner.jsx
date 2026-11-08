import React, { useEffect, useRef, useState } from 'react';
import { triggerHaptic, ImpactStyle } from '../utils/haptics';

// How long a banner stays up, and how long its slide in or out takes.
const VISIBLE_MS = 5000;
const SLIDE_MS = 250;
// Swiping up further than this dismisses it.
const DISMISS_DRAG_PX = 36;

// A push that arrives while the app is open, shown at the top like an iOS banner (the
// iOS one is switched off in the foreground; see capacitor.config.json). The caller
// keys it by push, so a newer push replaces the one showing. A tap opens wherever the
// push itself would; swiping up or waiting dismisses it. `model` comes from
// describeInAppNotification.
export default function InAppNotificationBanner({ model, photoURL, personName, onTap, onDone }) {
  const [entered, setEntered] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [dragY, setDragY] = useState(0);
  const rootRef = useRef(null);
  const dragRef = useRef({ startY: null, y: 0, moved: false });
  const touchingRef = useRef(false);
  const timersRef = useRef([]);
  // The parent passes fresh arrows on every render; keep the timers off them.
  const onTapRef = useRef(onTap);
  const onDoneRef = useRef(onDone);
  onTapRef.current = onTap;
  onDoneRef.current = onDone;

  const leavingRef = useRef(false);
  const leaveRef = useRef(() => {});
  leaveRef.current = () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    timersRef.current.push(setTimeout(() => onDoneRef.current?.(), SLIDE_MS));
  };

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    // Hold off while a finger is on it, so it can't vanish mid-swipe.
    const schedule = (ms) => {
      timersRef.current.push(setTimeout(() => {
        if (touchingRef.current) schedule(1500);
        else leaveRef.current();
      }, ms));
    };
    schedule(VISIBLE_MS);
    return () => {
      cancelAnimationFrame(frame);
      timersRef.current.forEach(clearTimeout);
    };
  }, []);

  // Native listeners: React's touchmove is passive, and a swipe up has to stop the page
  // scrolling underneath.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const start = (e) => {
      touchingRef.current = true;
      dragRef.current = { startY: e.touches[0].clientY, y: 0, moved: false };
    };
    const move = (e) => {
      const drag = dragRef.current;
      if (drag.startY === null) return;
      const diff = e.touches[0].clientY - drag.startY;
      // A finger drifts a few points on a tap; only more than that counts as a swipe.
      if (Math.abs(diff) > 10) drag.moved = true;
      if (diff < 0) {
        e.preventDefault();
        drag.y = Math.max(diff, -160);
        setDragY(drag.y);
      }
    };
    const end = () => {
      touchingRef.current = false;
      const drag = dragRef.current;
      if (drag.y < -DISMISS_DRAG_PX) {
        triggerHaptic(ImpactStyle.Light);
        leaveRef.current();
      } else {
        setDragY(0);
      }
      drag.startY = null;
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end, { passive: true });
    el.addEventListener('touchcancel', end, { passive: true });
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, []);

  const handleClick = () => {
    if (dragRef.current.moved || leavingRef.current) return;
    triggerHaptic(ImpactStyle.Light);
    onTapRef.current?.();
    leaveRef.current();
  };

  const dragging = dragRef.current.startY !== null && dragY !== 0;
  const hidden = !entered || leaving;

  return (
    <div
      ref={rootRef}
      role="button"
      aria-label={[model.name, model.action, model.detail].filter(Boolean).join(' ')}
      onClick={handleClick}
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 8px)',
        left: 10,
        right: 10,
        zIndex: 10000,
        transform: hidden ? 'translateY(calc(-100% - 80px))' : `translateY(${dragY}px)`,
        opacity: leaving ? 0 : Math.max(0, 1 + dragY / 200),
        transition: dragging ? 'none' : `transform ${SLIDE_MS}ms ease-out, opacity ${SLIDE_MS}ms ease-out`,
        WebkitUserSelect: 'none',
        userSelect: 'none',
        WebkitTouchCallout: 'none',
      }}
    >
      <div
        className="flex items-center gap-3"
        style={{
          padding: '11px 14px',
          borderRadius: 20,
          background: 'rgba(28,28,30,0.94)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
        }}
      >
        {model.avatar ? (
          <div className="relative flex-shrink-0" style={{ width: 38, height: 38 }}>
            <div className="w-full h-full rounded-full bg-zinc-700 flex items-center justify-center overflow-hidden">
              {photoURL ? (
                <img src={photoURL} alt="" className="w-full h-full object-cover" draggable={false} style={{ pointerEvents: 'none' }} />
              ) : (
                <span className="text-white text-sm font-semibold">{personName?.[0]?.toUpperCase() || '?'}</span>
              )}
            </div>
            <div
              className="absolute flex items-center justify-center rounded-full"
              style={{ right: -4, bottom: -4, width: 20, height: 20, background: '#2c2c2e', border: '2px solid #1c1c1e', fontSize: 10, lineHeight: 1 }}
            >
              {model.emoji}
            </div>
          </div>
        ) : (
          <div
            className="flex-shrink-0 flex items-center justify-center"
            style={{ width: 38, height: 38, borderRadius: 11, background: '#2c2c2e', fontSize: 19, lineHeight: 1 }}
          >
            {model.emoji}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="truncate" style={{ fontSize: 14 }}>
            <span className="font-semibold text-white">{model.name}</span>
            {model.action && <span style={{ color: '#d1d1d6' }}> {model.action}</span>}
          </div>
          {model.detail && (
            <div className="truncate" style={{ fontSize: 13, color: '#a1a1aa' }}>{model.detail}</div>
          )}
        </div>
        <span aria-hidden="true" style={{ color: '#636366', fontSize: 20, lineHeight: 1 }}>›</span>
      </div>
    </div>
  );
}
