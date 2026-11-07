import React, { useEffect } from 'react';

// The launch loader: the D7 logo drawing itself (the D, then the 7). Its styles and
// keyframes live in index.html, so the very first paint has them.
//
// index.html paints #initial-loader as an overlay above the app before any JS runs. Every
// screen that is still loading renders <LaunchLoader />, which keeps that overlay up; once
// none is mounted, the overlay fades out and is removed. So from the first frame to Home
// it is one element and the drawing never restarts at the hand-off. After that (a later
// sign-in, say), <LaunchLoader /> draws the same logo itself.

// Traced from the app icon (public/icon.png) in its 1024 grid: the open D with round
// caps, the grey bar on its left, and the solid 7, which a thick stroke through its middle
// reveals as it draws.
const D_PATH = 'M352 312.1 L352 305.2 A43.2 43.2 0 0 1 395.2 262 L561.1 262 C693.7 262 762.5 353 762.5 511.5 C762.5 670 693.7 762 561.1 762 L395.2 762 A43.2 43.2 0 0 1 352 718.8 L352 711.9';
const BAR_PATH = 'M352 312.1 L352 711.9';
const SEVEN_PATH = 'M452.3 399.7 L588.6 399.7 L588.6 427.4 L517.85 582.5 L471.85 582.5 L539.85 433.8 L452.3 433.8 Z';
const SEVEN_TRACE_PATH = 'M452.3 416.75 L570.65 416.75 L494.85 582.5';

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
    <defs>
      <mask id="d7-loader-7-mask-app" maskUnits="userSpaceOnUse">
        <path className="d7-loader-7-trace" d={SEVEN_TRACE_PATH} pathLength="100" />
      </mask>
    </defs>
    <path className="d7-loader-bar" d={BAR_PATH} />
    <path className="d7-loader-d" d={D_PATH} pathLength="100" />
    <path className="d7-loader-7" d={SEVEN_PATH} mask="url(#d7-loader-7-mask-app)" />
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
