import React, { useEffect } from 'react';

// The launch loader: the D7 logo drawing itself (the D, then the 7). Its styles and
// keyframes live in index.html, so the very first paint has them.
//
// index.html paints #initial-loader as an overlay above the app before any JS runs. Every
// screen that is still loading renders <LaunchLoader />, which keeps that overlay up; once
// none is mounted, the overlay fades out and is removed. So from the first frame to Home
// it is one element and the drawing never restarts at the hand-off. After that (a later
// sign-in, say), <LaunchLoader /> draws the same logo itself.

const D_PATH = 'M250 160 L250 864 L500 864 C740 864 820 680 820 512 C820 344 740 160 500 160 L250 160';
const SEVEN_PATH = 'M400 330 L600 330 L460 694';

let loadersMounted = 0;
let hideTimer = null;

export const hideLaunchOverlay = () => {
  const el = document.getElementById('initial-loader');
  if (!el) return;
  el.style.transition = 'opacity 200ms ease-out';
  el.style.opacity = '0';
  el.style.pointerEvents = 'none';
  setTimeout(() => el.remove(), 250);
};

// For the app's first render: if no screen is loading (the welcome screen, say), drop the
// overlay. Children's effects run first, so a mounted <LaunchLoader /> has counted itself.
export const releaseLaunchOverlay = () => {
  if (loadersMounted > 0) return;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideLaunchOverlay, 0);
};

export const D7LoaderMark = () => (
  <svg className="d7-loader" viewBox="0 0 1024 1024" aria-hidden="true">
    <path className="d7-loader-d" d={D_PATH} pathLength="100" />
    <path className="d7-loader-7" d={SEVEN_PATH} pathLength="100" />
  </svg>
);

export default function LaunchLoader() {
  useEffect(() => {
    loadersMounted += 1;
    clearTimeout(hideTimer);
    return () => {
      loadersMounted -= 1;
      // A moment's grace: one loading screen handing over to another keeps the overlay.
      if (loadersMounted === 0) hideTimer = setTimeout(hideLaunchOverlay, 50);
    };
  }, []);

  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <D7LoaderMark />
    </div>
  );
}
