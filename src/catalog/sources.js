/**
 * Channel sources: the M3U playlists the user adds. Only one is active at a
 * time. The app ships with no playlist of its own; until one is added, the
 * channel screens point to Sources.
 *
 * Kept in localStorage (a few hundred bytes). Each source's parsed channel
 * list is cached separately in IndexedDB (see catalog.js).
 *
 * Deliberately not ported from ProsperoTV: Xtream Codes accounts and
 * MAC-address portals (Stalker/Ministra). They are commonly used by
 * resellers whose rights to the channels are unclear, and MAC portals work
 * by presenting a set-top box's identity. Legitimate providers that offer a
 * plain M3U address are covered by playlist sources.
 */

const STORAGE_KEY = 'prosperlgtv.sources.v1';

/**
 * @typedef {Object} Source
 * @property {string} id
 * @property {'m3u'} kind
 * @property {string} name
 * @property {string} url
 */

function load() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && Array.isArray(parsed.list)) return parsed;
  } catch (e) { /* fall through */ }
  return { list: [], active: '' };
}

let state = load();
const listeners = [];

function save() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('could not save sources', e);
  }
  for (const fn of listeners.slice()) fn();
}

/** Subscribes to changes of the source list or the active source. */
export function onSourcesChange(fn) {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/** All sources, in the order they were added. @returns {Source[]} */
export function listSources() {
  return state.list.slice();
}

/** A source by id, or null. */
export function getSource(id) {
  return state.list.find((s) => s.id === id) || null;
}

/**
 * The active source: the one chosen last, else the first one added, else
 * null when no playlist has been added yet.
 * @returns {Source|null}
 */
export function activeSource() {
  return getSource(state.active) || state.list[0] || null;
}

/** Makes a source the active one. */
export function setActiveSource(id) {
  if (!getSource(id) || state.active === id) return;
  state.active = id;
  save();
}

/**
 * Checks and normalises a playlist address typed on the TV.
 * Adds "http://" when no scheme was typed.
 * @param {string} text
 * @returns {string} the URL
 * @throws {Error} with a message for the user
 */
export function normaliseUrl(text) {
  let url = (text || '').trim();
  if (!url) throw new Error('Enter the playlist’s address.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `http://${url}`;
  if (!/^https?:\/\//i.test(url)) throw new Error('Only http:// and https:// playlist addresses are supported.');
  try {
    // eslint-disable-next-line no-new
    new URL(url);
  } catch (e) {
    throw new Error('That doesn’t look like a web address.');
  }
  return url;
}

/** A readable default name for a playlist URL (its host name). */
export function defaultName(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || 'Playlist';
  } catch (e) {
    return 'Playlist';
  }
}

/**
 * Adds a playlist source.
 * @param {string} name
 * @param {string} url  already normalised
 * @returns {Source}
 */
export function addSource(name, url) {
  const src = {
    id: `m3u-${Date.now().toString(36)}`,
    kind: 'm3u',
    name: (name || '').trim() || defaultName(url),
    url,
  };
  state.list.push(src);
  // The first playlist becomes the active one.
  if (!getSource(state.active)) state.active = src.id;
  save();
  return src;
}

/** Changes a playlist's name and/or address. */
export function updateSource(id, patch) {
  const src = state.list.find((s) => s.id === id);
  if (!src) return;
  if (patch.name !== undefined) src.name = patch.name.trim() || defaultName(src.url);
  if (patch.url !== undefined) src.url = patch.url;
  save();
}

/** Removes a playlist source; the first remaining one (if any) becomes active. */
export function removeSource(id) {
  const before = state.list.length;
  state.list = state.list.filter((s) => s.id !== id);
  if (state.list.length === before) return;
  if (state.active === id) state.active = state.list.length ? state.list[0].id : '';
  save();
}

/** Forgets every playlist (used by "Reset app"). */
export function resetSources() {
  state = { list: [], active: '' };
  save();
}
