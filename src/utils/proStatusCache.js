// The last subscription answer RevenueCat gave for an account on this device. On the next
// cold start the app checks it before RevenueCat answers again, so a subscriber goes
// straight in instead of seeing the lock screen flash. A stale "yes" lasts only until
// RevenueCat replies. Per device, like the rest of localStorage.

const keyFor = (uid) => `proStatus:${uid}`;

export const lastKnownPro = (uid) => {
  if (!uid) return false;
  try {
    return localStorage.getItem(keyFor(uid)) === '1';
  } catch {
    return false;
  }
};

export const rememberPro = (uid, isPro) => {
  if (!uid) return;
  try {
    localStorage.setItem(keyFor(uid), isPro ? '1' : '0');
  } catch {
    // Storage unavailable: the next launch just waits for RevenueCat.
  }
};
