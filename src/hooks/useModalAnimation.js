import { useEffect, useState } from 'react';

/**
 * Drives a unified open/close fade-and-scale animation for confirm-style dialogs.
 *
 * Pass the parent-owned `isOpen` flag and its setter; the hook returns:
 *  - `isAnimating` — bind to inline style props so the dialog scales/fades in on open
 *    and out on close. The overlay's bg should also bind to this so the backdrop fades.
 *  - `close(cb?)` — call from any close trigger (X button, Cancel, backdrop tap, action
 *    buttons). Plays the exit animation, then flips `isOpen` to false and runs `cb`.
 *
 * Why this exists: most confirm dialogs were unmounting instantly, while a few used a
 * hand-rolled isAnimating+setTimeout pattern. This keeps the close feel identical
 * everywhere, regardless of which trigger fired.
 */
export function useModalAnimation(isOpen, setOpen, { duration = 250 } = {}) {
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => setIsAnimating(true), 10);
      return () => clearTimeout(t);
    }
    setIsAnimating(false);
  }, [isOpen]);

  const close = (cb) => {
    setIsAnimating(false);
    setTimeout(() => {
      setOpen(false);
      if (typeof cb === 'function') cb();
    }, duration);
  };

  return { isAnimating, close };
}
