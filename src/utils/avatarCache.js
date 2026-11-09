// Small copies of profile photos, kept on the device so an avatar can paint on the first frame.
// Firebase serves the photos with max-age=0, so without this every appearance waits on the
// network. Keyed by the photo's URL: a new photo gets a new URL, so a stale copy is never shown.

const KEY = 'dayseven_avatar_thumbs_v1';
const MAX_ENTRIES = 60;
const THUMB_PX = 128;
const SAVE_DELAY_MS = 1000;

let thumbs = null;
let saveTimer = null;
const attempted = new Set(); // one try per URL per session, so a failing host isn't re-fetched
const warmed = new Map(); // Image objects held so WebKit keeps the copies decoded in memory

const store = () => {
  if (thumbs) return thumbs;
  try {
    thumbs = new Map(JSON.parse(localStorage.getItem(KEY)) || []);
  } catch {
    thumbs = new Map();
  }
  return thumbs;
};

const save = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify([...store()]));
    } catch {
      // Storage full or unavailable: avatars just load from the network.
    }
  }, SAVE_DELAY_MS);
};

// WebKit misses the first frame the first time it sees a given data URL and is synchronous after
// that (measured in the iOS Simulator), so each copy is loaded once before any avatar needs it.
const warm = (url, thumb) => {
  const img = new Image();
  img.src = thumb;
  warmed.set(url, img);
};

export const getAvatarThumb = (url) => (url ? store().get(url) || null : null);

// Saves a copy of a photo that isn't stored yet. Uses its own CORS-enabled request because a
// canvas can't export an image loaded without one.
export const rememberAvatar = (url) => {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return;
  const map = store();
  if (map.has(url)) {
    // Most recently used goes last, so the eviction below drops the oldest.
    const thumb = map.get(url);
    map.delete(url);
    map.set(url, thumb);
    return;
  }
  if (attempted.has(url)) return;
  attempted.add(url);

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      if (!side) return;
      const canvas = document.createElement('canvas');
      canvas.width = THUMB_PX;
      canvas.height = THUMB_PX;
      // Centre square, matching the object-cover crop the avatar circles use.
      canvas.getContext('2d').drawImage(
        img,
        (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side,
        0, 0, THUMB_PX, THUMB_PX,
      );
      const thumb = canvas.toDataURL('image/jpeg', 0.75);
      map.set(url, thumb);
      warm(url, thumb);
      while (map.size > MAX_ENTRIES) {
        const oldest = map.keys().next().value;
        map.delete(oldest);
        warmed.delete(oldest);
      }
      save();
    } catch {
      // The host didn't allow the export: this avatar just loads from the network.
    }
  };
  img.src = url;
};

export const clearAvatarCache = () => {
  clearTimeout(saveTimer);
  thumbs = new Map();
  attempted.clear();
  warmed.clear();
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
};

// At startup, ahead of the first screen that shows an avatar. No network involved.
setTimeout(() => store().forEach((thumb, url) => warm(url, thumb)), 0);
