import React, { useEffect, useRef, useState } from 'react';

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;

/**
 * Pinch-zoomable photo for in-app lightboxes. Pure-CSS transforms driven by raw
 * touch events — no library, no page-zoom (the app's viewport disables that).
 *
 * Behavior:
 *  - 2-finger pinch scales between 1× and 4×.
 *  - 1-finger drag pans while zoomed (no-op at 1×, so the parent's tap-to-close
 *    handler still fires on a plain tap).
 *  - Double-tap toggles 1× ⟷ 2.5× centered on the tap point.
 *  - Release at scale ≤ 1.05× snaps back to 1× and recenters.
 *  - Calls `onSingleTap` for plain taps that didn't pan/zoom — wire to "close lightbox."
 */
export default function ZoomablePhoto({ src, alt = '', className = '', style = {}, onSingleTap }) {
  const containerRef = useRef(null);
  const [transform, setTransform] = useState({ scale: 1, tx: 0, ty: 0 });
  // Refs mirror state so touch handlers (which capture closures) always see current values.
  const transformRef = useRef(transform);
  useEffect(() => { transformRef.current = transform; }, [transform]);

  // Gesture session state — pinch start distance/scale, pan start point, etc.
  const sessionRef = useRef({
    pinchStartDist: null,
    pinchStartScale: 1,
    panStartX: null,
    panStartY: null,
    panOriginTx: 0,
    panOriginTy: 0,
    didMove: false,
    lastTapAt: 0,
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const distance = (touches) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    };

    const onTouchStart = (e) => {
      const s = sessionRef.current;
      s.didMove = false;
      if (e.touches.length === 2) {
        s.pinchStartDist = distance(e.touches);
        s.pinchStartScale = transformRef.current.scale;
      } else if (e.touches.length === 1) {
        const t = e.touches[0];
        s.panStartX = t.clientX;
        s.panStartY = t.clientY;
        s.panOriginTx = transformRef.current.tx;
        s.panOriginTy = transformRef.current.ty;
      }
    };

    const onTouchMove = (e) => {
      const s = sessionRef.current;
      if (e.touches.length === 2 && s.pinchStartDist) {
        e.preventDefault();
        const d = distance(e.touches);
        const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s.pinchStartScale * (d / s.pinchStartDist)));
        s.didMove = true;
        setTransform((t) => ({ ...t, scale: next }));
      } else if (e.touches.length === 1 && transformRef.current.scale > 1.02 && s.panStartX !== null) {
        // Pan-while-zoomed.
        e.preventDefault();
        const t = e.touches[0];
        s.didMove = true;
        setTransform((cur) => ({
          ...cur,
          tx: s.panOriginTx + (t.clientX - s.panStartX),
          ty: s.panOriginTy + (t.clientY - s.panStartY),
        }));
      } else if (e.touches.length === 1 && s.panStartX !== null) {
        // At 1× we don't pan, but we still need to consume the touch so vertical swipes
        // don't (a) accidentally fire onSingleTap on release and (b) bubble out to the
        // WebView's rubber-band scroll. preventDefault + mark didMove if the move was
        // meaningful (>10px in either axis — same threshold TouchButton uses).
        e.preventDefault();
        const t = e.touches[0];
        const dx = Math.abs(t.clientX - s.panStartX);
        const dy = Math.abs(t.clientY - s.panStartY);
        if (dx > 10 || dy > 10) s.didMove = true;
      }
    };

    const onTouchEnd = (e) => {
      const s = sessionRef.current;
      // Snap back to 1× + center when zoomed nearly all the way out.
      const cur = transformRef.current;
      if (cur.scale <= 1.05) {
        setTransform({ scale: 1, tx: 0, ty: 0 });
      }
      // Plain tap detection (no pinch, no pan, single touch). Includes double-tap zoom.
      if (e.touches.length === 0 && !s.didMove && e.changedTouches.length === 1) {
        const now = Date.now();
        const isDoubleTap = now - s.lastTapAt < 280;
        s.lastTapAt = now;
        if (isDoubleTap) {
          // Toggle zoom — center-anchored on tap point isn't worth the math when
          // 2.5× from center already feels right for hand-held viewing.
          setTransform((t) => t.scale > 1.05
            ? { scale: 1, tx: 0, ty: 0 }
            : { scale: DOUBLE_TAP_SCALE, tx: 0, ty: 0 }
          );
        } else if (cur.scale <= 1.05) {
          // Single tap at 1× falls through to the parent's onSingleTap (e.g., close).
          onSingleTap?.();
        }
      }
      s.pinchStartDist = null;
      s.panStartX = null;
      s.panStartY = null;
    };

    // passive: false on touchmove so preventDefault works (stops page scroll while pinching/panning).
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [onSingleTap]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        overflow: 'hidden',
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        ...style,
      }}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        style={{
          maxWidth: '100%',
          maxHeight: '85vh',
          objectFit: 'contain',
          display: 'block',
          margin: '0 auto',
          transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})`,
          transformOrigin: 'center center',
          transition: sessionRef.current.pinchStartDist === null && sessionRef.current.panStartX === null
            ? 'transform 0.18s ease-out'
            : 'none',
          willChange: 'transform',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
