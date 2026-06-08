// Reverse geocoding for activity GPS routes → { city, state, country }.
//
// We only ever geocode coordinates that already exist on a workout's HealthKit
// route (no live device GPS, no location permission). Uses BigDataCloud's free
// client-side endpoint (no API key, CORS-enabled). Results are cached in memory
// and localStorage keyed by rounded coordinates so we don't re-hit the network
// for the same spot.

const memCache = new Map();
const LS_KEY = 'geocodeCache_v1';

const roundKey = (lat, lng) => `${lat.toFixed(3)},${lng.toFixed(3)}`;

const loadLsCache = () => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
};

const saveLsEntry = (key, value) => {
  try {
    const cache = loadLsCache();
    cache[key] = value;
    // Keep the cache from growing unbounded — cap at ~300 entries.
    const keys = Object.keys(cache);
    if (keys.length > 300) {
      delete cache[keys[0]];
    }
    localStorage.setItem(LS_KEY, JSON.stringify(cache));
  } catch {
    /* ignore quota / serialization errors */
  }
};

/**
 * Reverse geocode a coordinate to a coarse place.
 * @returns {Promise<{city:string,state:string,country:string,countryCode:string}|null>}
 */
export async function reverseGeocode(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number' || Number.isNaN(lat) || Number.isNaN(lng)) {
    return null;
  }
  const key = roundKey(lat, lng);
  if (memCache.has(key)) return memCache.get(key);

  const ls = loadLsCache();
  if (ls[key]) {
    memCache.set(key, ls[key]);
    return ls[key];
  }

  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = await res.json();
    const loc = {
      city: d.city || d.locality || '',
      state: d.principalSubdivision || '',
      country: d.countryName || '',
      countryCode: d.countryCode || '',
    };
    if (!loc.city && !loc.state && !loc.country) return null;
    memCache.set(key, loc);
    saveLsEntry(key, loc);
    return loc;
  } catch {
    return null;
  }
}

/**
 * Format a stored location object for display.
 * @param {object} loc - { city, state, country }
 * @param {object} [opts]
 * @param {boolean} [opts.short] - city + state only (drops country)
 */
export function formatLocation(loc, opts = {}) {
  if (!loc) return '';
  const parts = opts.short ? [loc.city, loc.state] : [loc.city, loc.state, loc.country];
  return parts.filter(Boolean).join(', ');
}
