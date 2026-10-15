/**
 * Favourites, recent channels and channels that failed to play.
 *
 * All three are small, capped lists in localStorage. Each item keeps a
 * snapshot of the channel (name, logo, streams) so Favourites and Recent
 * still show — and still play — when the channel list is being refreshed or
 * has changed. Items are scoped to the source they came from.
 */

const KEY_FAV = 'prosperlgtv.favourites.v1';
const KEY_RECENT = 'prosperlgtv.recent.v1';
const KEY_FAILED = 'prosperlgtv.failed.v1';

/** Caps keep localStorage use in the tens of KB. */
const MAX_FAVOURITES = 500;
const MAX_RECENT = 40;
const MAX_FAILED = 2000;

function read(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('could not save', key, e);
  }
}

/**
 * The part of a channel worth keeping in a favourite/recent snapshot.
 * Streams keep only url/height/flags; derived `$` fields are dropped.
 * @param {Object} ch  channel (see catalog/model.js)
 */
function snapshot(ch) {
  return {
    k: ch.k, n: ch.n, l: ch.l, c: ch.c, co: ch.co, la: ch.la, s: ch.s, q: ch.q, g: ch.g, p: ch.p,
  };
}

/** Item id: source + channel key, so two lists can't clash. */
function itemId(sourceId, key) {
  return `${sourceId}|${key}`;
}

let favourites = read(KEY_FAV, []);
let recent = read(KEY_RECENT, []);
let failed = new Set(read(KEY_FAILED, []));
const listeners = [];

function changed() {
  for (const fn of listeners.slice()) fn();
}

/** Subscribes to changes of favourites or recent channels. */
export function onUserDataChange(fn) {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

// ---------------------------------------------------------------------------
// Favourites
// ---------------------------------------------------------------------------

/** True when the channel is a favourite in that source. */
export function isFavourite(sourceId, key) {
  const id = itemId(sourceId, key);
  return favourites.some((f) => f.id === id);
}

/**
 * Adds or removes a favourite.
 * @returns {boolean} true when it is now a favourite
 */
export function toggleFavourite(sourceId, ch) {
  const id = itemId(sourceId, ch.k);
  const i = favourites.findIndex((f) => f.id === id);
  if (i >= 0) {
    favourites.splice(i, 1);
    write(KEY_FAV, favourites);
    changed();
    return false;
  }
  if (favourites.length >= MAX_FAVOURITES) favourites.pop();
  favourites.unshift({ id, src: sourceId, ch: snapshot(ch) });
  write(KEY_FAV, favourites);
  changed();
  return true;
}

/**
 * Favourite channels of a source, newest first. When `current` (the
 * loaded catalog's channels by key) is given, the live channel replaces the
 * snapshot so its streams are up to date.
 * @param {string} sourceId
 * @param {Map<string, Object>} [current]
 */
export function favouritesOf(sourceId, current) {
  return favourites.filter((f) => f.src === sourceId).map((f) => (current && current.get(f.ch.k)) || f.ch);
}

/** Number of favourites across all sources. */
export function favouriteCount() {
  return favourites.length;
}

// ---------------------------------------------------------------------------
// Recent
// ---------------------------------------------------------------------------

/** Records a channel as just watched (moves it to the front). */
export function addRecent(sourceId, ch) {
  const id = itemId(sourceId, ch.k);
  recent = recent.filter((r) => r.id !== id);
  recent.unshift({ id, src: sourceId, ch: snapshot(ch), at: Date.now() });
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  write(KEY_RECENT, recent);
  changed();
}

/** Recent channels of a source, most recent first (see favouritesOf). */
export function recentOf(sourceId, current) {
  return recent.filter((r) => r.src === sourceId).map((r) => (current && current.get(r.ch.k)) || r.ch);
}

/** The last channel watched in a source, or null. */
export function lastWatched(sourceId, current) {
  const list = recentOf(sourceId, current);
  return list.length ? list[0] : null;
}

/** Number of recent entries across all sources. */
export function recentCount() {
  return recent.length;
}

/** Forgets the watch history. */
export function clearRecent() {
  recent = [];
  write(KEY_RECENT, recent);
  changed();
}

// ---------------------------------------------------------------------------
// Failed channels (for Settings → Hide channels that didn't play)
// ---------------------------------------------------------------------------

/** Marks a channel as failed (true) or working (false). */
export function setFailed(sourceId, key, isFailed) {
  const id = itemId(sourceId, key);
  if (isFailed === failed.has(id)) return;
  if (isFailed) {
    failed.add(id);
    if (failed.size > MAX_FAILED) failed.delete(failed.values().next().value);
  } else {
    failed.delete(id);
  }
  write(KEY_FAILED, Array.from(failed));
}

/** Channel keys of a source that failed last time. */
export function failedKeys(sourceId) {
  const prefix = `${sourceId}|`;
  const out = new Set();
  failed.forEach((id) => {
    if (id.indexOf(prefix) === 0) out.add(id.slice(prefix.length));
  });
  return out;
}

/** Number of channels marked as failed. */
export function failedCount() {
  return failed.size;
}

/** Forgets which channels failed. */
export function clearFailed() {
  failed = new Set();
  write(KEY_FAILED, []);
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/** Removes everything stored for a source (when the source is deleted). */
export function forgetSource(sourceId) {
  favourites = favourites.filter((f) => f.src !== sourceId);
  recent = recent.filter((r) => r.src !== sourceId);
  failedKeys(sourceId).forEach((k) => failed.delete(itemId(sourceId, k)));
  write(KEY_FAV, favourites);
  write(KEY_RECENT, recent);
  write(KEY_FAILED, Array.from(failed));
  changed();
}

/** Erases favourites, history and failures (used by "Reset app"). */
export function resetUserData() {
  favourites = [];
  recent = [];
  failed = new Set();
  for (const k of [KEY_FAV, KEY_RECENT, KEY_FAILED]) {
    try {
      window.localStorage.removeItem(k);
    } catch (e) { /* ignore */ }
  }
  changed();
}
