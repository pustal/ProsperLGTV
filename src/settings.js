/**
 * User settings, persisted in localStorage.
 *
 * localStorage is fine here: the whole object is a few hundred bytes. Large
 * data (channel lists, logos) never goes in localStorage — see store/db.js.
 */

const STORAGE_KEY = 'prosperlgtv.settings.v1';

/** When the channel list refreshes by itself. */
export const REFRESH_POLICIES = {
  day: { label: 'At launch, if older than a day', maxAgeMs: 24 * 60 * 60 * 1000 },
  week: { label: 'At launch, if older than a week', maxAgeMs: 7 * 24 * 60 * 60 * 1000 },
  manual: { label: 'Only when I ask', maxAgeMs: Infinity },
};

/** Logo cache size choices, in MB. 0 = logos in RAM only (nothing stored). */
export const LOGO_BUDGETS_MB = [0, 5, 10, 25];

/** Seconds to wait for a stream to start before trying the next one. */
export const TUNE_TIMEOUTS = [10, 15, 20, 30];

/** What the app opens at launch. */
export const START_MODES = {
  live: 'Live TV',
  last: 'The channel I watched last',
};

/** Default values for every setting. */
export const DEFAULTS = {
  /** Key of REFRESH_POLICIES. */
  refresh: 'week',
  /** Show channel logos at all. Off stores nothing and downloads nothing. */
  logos: true,
  /** Persistent logo cache size in MB (see LOGO_BUDGETS_MB). */
  logoBudgetMB: 10,
  /** Hide channels whose every stream is marked [Geo-blocked]. */
  hideGeo: false,
  /** Hide channels whose every stream is marked [Not 24/7]. */
  hidePartTime: false,
  /** Hide channels that need request headers the TV's player can't send. */
  hideHeaders: false,
  /** Hide channels that failed to play the last time they were tried. */
  hideFailed: false,
  /** Seconds before a stream that hasn't started counts as failed. */
  tuneTimeout: 15,
  /** Key of START_MODES. */
  startWith: 'live',
  /** The one-time notice about where channels come from was acknowledged. */
  noticeSeen: false,
};

let current = load();
const listeners = [];

/** Reads settings from storage, falling back to defaults for missing keys. */
function load() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return Object.assign({}, DEFAULTS, parsed);
  } catch (e) {
    return Object.assign({}, DEFAULTS);
  }
}

/** Returns the current settings object (treat as read-only). */
export function getSettings() {
  return current;
}

/**
 * Updates some settings, persists them and notifies listeners.
 * @param {Partial<typeof DEFAULTS>} patch
 */
export function updateSettings(patch) {
  const prev = current;
  current = Object.assign({}, current, patch);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch (e) {
    console.warn('could not persist settings', e);
  }
  for (const fn of listeners.slice()) fn(current, prev);
}

/** Restores every setting to its default (used by "Reset app"). */
export function resetSettings() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (e) { /* ignore */ }
  updateSettings(Object.assign({}, DEFAULTS));
}

/**
 * Subscribes to settings changes. Returns a function that unsubscribes.
 * @param {(next: typeof DEFAULTS, prev: typeof DEFAULTS) => void} fn
 */
export function onSettingsChange(fn) {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}
