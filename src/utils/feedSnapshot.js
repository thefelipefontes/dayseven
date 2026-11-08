// The last feed this device showed, kept across launches so the first Friends tap of a session
// paints immediately while loadFeed fetches the fresh one. Costs no Firestore reads.

const KEY = 'dayseven_feed_snapshot_v1';
const MAX_CHARS = 1500000; // localStorage is ~5MB and shared with the rest of the app
const SAVE_DELAY_MS = 1500;

let saveTimer = null;

export const readFeedSnapshot = (uid) => {
  if (!uid) return null;
  try {
    const snapshot = JSON.parse(localStorage.getItem(KEY));
    return snapshot?.uid === uid && Array.isArray(snapshot.activities) ? snapshot : null;
  } catch {
    return null;
  }
};

// Reactions and comments arrive one post at a time, so wait for them to settle: serializing the
// whole feed on every update would block the UI thread.
export const scheduleFeedSnapshotSave = (feedCacheRef) => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const snapshot = feedCacheRef.current;
    if (!snapshot?.uid || snapshot.activities.length === 0) return;
    try {
      const json = JSON.stringify(snapshot);
      if (json.length <= MAX_CHARS) localStorage.setItem(KEY, json);
      else localStorage.removeItem(KEY);
    } catch {
      // Storage full or unavailable: the next launch just shows the spinner.
    }
  }, SAVE_DELAY_MS);
};

export const clearFeedSnapshot = () => {
  clearTimeout(saveTimer);
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
};
