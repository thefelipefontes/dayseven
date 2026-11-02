// The app's version and build, baked in at build time from the Xcode project (vite.config.js),
// so a bundle knows which release it belongs to without a native plugin. Null outside a Vite
// build.
/* global __APP_VERSION__, __APP_BUILD__ */
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : null;
export const APP_BUILD = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : null;

export const APP_STORE_URL = 'https://apps.apple.com/app/id6758960555';

/** Is dotted version `version` older than `minimum`? '1.8.5' vs '1.9' compares as 1.9.0. */
export const isVersionBelow = (version, minimum) => {
  const parts = (v) => String(v).split('.').map((n) => parseInt(n, 10) || 0);
  const a = parts(version);
  const b = parts(minimum);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff < 0;
  }
  return false;
};

const MIN_VERSION_URL = 'https://firestore.googleapis.com/v1/projects/dayseven-f1a89/databases/(default)/documents/config/minAppVersion';
const MIN_VERSION_TIMEOUT_MS = 5000;

/**
 * The oldest version allowed to run (config/minAppVersion, field minVersion), or null when it
 * isn't set or can't be read. Plain REST with no sign-in: it runs at launch, before anyone may
 * be signed in, and a failure must never lock anyone out.
 */
export const fetchMinAppVersion = async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MIN_VERSION_TIMEOUT_MS);
  try {
    const response = await fetch(MIN_VERSION_URL, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) return null;
    const json = await response.json();
    return json?.fields?.minVersion?.stringValue || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};
