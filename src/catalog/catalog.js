/**
 * The loaded channel list of the active source, its cache and refreshes.
 *
 * Offline-first, like ProsperoTV: at launch the last list that loaded
 * successfully opens straight from IndexedDB while a refresh (if due) runs in
 * the background. A failed refresh leaves the cached list untouched.
 *
 * Storage: one IndexedDB record per source holding the channels as a JSON
 * string (~3 MB for a list of ~10,000 channels).
 * A JSON string is smaller on flash than a structured-clone of 10,000
 * objects, and its size is known exactly for the Settings screen. Small
 * metadata (count, size, date) is mirrored in localStorage so the Sources
 * and Settings screens never have to read the big records.
 */
import { openDb, request } from '../store/db.js';
import { fetchText } from '../net/http.js';
import { parseM3U } from './m3u.js';
import {
  buildChannels, facets, languageCompanionUrl, languageMap, prepare,
} from './model.js';
import { activeSource, getSource } from './sources.js';
import { REFRESH_POLICIES, getSettings } from '../settings.js';

/** Most channels kept from one playlist; more would strain the TV's RAM. */
export const MAX_CHANNELS = 60000;
/** Bump when the stored channel shape changes; older records are refetched. */
const FORMAT = 1;
const META_KEY = 'prosperlgtv.catalogMeta.v1';

/**
 * @typedef {Object} CatalogMeta
 * @property {number} count      channels kept
 * @property {number} bytes      size of the stored record
 * @property {number} fetchedAt  ms since epoch
 * @property {number} skipped    entries dropped (unplayable/DRM)
 * @property {boolean} truncated more than MAX_CHANNELS were offered
 */

/** Live state of the active catalog. Treat as read-only outside this module. */
export const catalog = {
  /** @type {import('./sources.js').Source|null} */
  source: null,
  /** Prepared channels, in playlist order. */
  channels: [],
  /** @type {Map<string, Object>} channel key → channel */
  byKey: new Map(),
  /** @type {ReturnType<typeof facets>} */
  facets: {
    categories: [], countries: [], languages: [], qualities: [],
  },
  /** 'empty' (nothing cached yet) | 'ready' */
  state: 'empty',
  /** A refresh of the active source is running. */
  refreshing: false,
  /** Message of the last failed refresh of the active source, or ''. */
  error: '',
};

const listeners = [];

/** Subscribes to catalog changes (list replaced, refresh started/failed). */
export function onCatalogChange(fn) {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

function emit() {
  for (const fn of listeners.slice()) {
    try {
      fn(catalog);
    } catch (e) {
      console.error(e);
    }
  }
}

// ---------------------------------------------------------------------------
// Metadata (localStorage)
// ---------------------------------------------------------------------------

function readMeta() {
  try {
    return JSON.parse(window.localStorage.getItem(META_KEY) || '{}') || {};
  } catch (e) {
    return {};
  }
}

function writeMeta(all) {
  try {
    window.localStorage.setItem(META_KEY, JSON.stringify(all));
  } catch (e) { /* ignore */ }
}

/** Cached-list metadata for a source, or null when nothing is cached. @returns {CatalogMeta|null} */
export function catalogMeta(sourceId) {
  return readMeta()[sourceId] || null;
}

/** Total bytes of all cached channel lists. */
export function catalogBytes() {
  const all = readMeta();
  return Object.keys(all).reduce((sum, k) => sum + (all[k].bytes || 0), 0);
}

/** Number of cached channel lists. */
export function catalogCount() {
  return Object.keys(readMeta()).length;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** Makes `channels` the active list. */
function install(source, channels) {
  prepare(channels);
  catalog.source = source;
  catalog.channels = channels;
  catalog.byKey = new Map(channels.map((ch) => [ch.k, ch]));
  catalog.facets = facets(channels);
  catalog.state = channels.length ? 'ready' : 'empty';
}

/**
 * Loads the active source's cached list (fast), then refreshes it in the
 * background when the refresh policy says it's due or nothing is cached.
 * @returns {Promise<void>} resolves once the cached list (if any) is shown
 */
export async function loadActive() {
  const source = activeSource();
  catalog.source = source;
  catalog.error = '';
  if (!source) {
    // No playlist added yet: the channel screens point to Sources.
    install(null, []);
    emit();
    return;
  }
  const rec = await request('catalogs', 'readonly', (s) => s.get(source.id));
  let loaded = false;
  if (rec && rec.format === FORMAT && rec.json) {
    try {
      install(source, JSON.parse(rec.json));
      loaded = true;
    } catch (e) {
      console.warn('cached list unreadable; downloading again', e);
    }
  }
  if (!loaded) install(source, []);
  emit();

  const meta = catalogMeta(source.id);
  const policy = REFRESH_POLICIES[getSettings().refresh] || REFRESH_POLICIES.week;
  const due = !loaded || !meta || Date.now() - meta.fetchedAt > policy.maxAgeMs;
  if (due) refresh(source.id).catch(() => { /* reported through catalog.error */ });
}

/** Refreshes running, by source id, so a second request joins the first. */
const running = new Map();

/**
 * Downloads, parses and caches a source's list. If it is the active source,
 * the new list replaces the one on screen.
 * @param {string} sourceId
 * @returns {Promise<{count: number, skipped: number, truncated: boolean}>}
 */
export function refresh(sourceId) {
  if (running.has(sourceId)) return running.get(sourceId);
  const job = doRefresh(sourceId);
  running.set(sourceId, job);
  const done = () => {
    running.delete(sourceId);
    if (catalog.source && catalog.source.id === sourceId) {
      catalog.refreshing = false;
      emit();
    }
  };
  job.then(done, done);
  return job;
}

/** True while a source is refreshing. */
export function isRefreshing(sourceId) {
  return running.has(sourceId);
}

async function doRefresh(sourceId) {
  const source = getSource(sourceId);
  if (!source) throw new Error('That source no longer exists.');
  const isActive = () => catalog.source && catalog.source.id === sourceId;
  if (isActive()) {
    catalog.refreshing = true;
    catalog.error = '';
    emit();
  }
  try {
    const text = await fetchText(source.url);
    const parsed = parseM3U(text, { maxEntries: MAX_CHANNELS * 2 });
    if (!parsed.isM3u) throw new Error('That address didn’t return an M3U playlist.');

    // Some public playlist collections publish the same streams grouped by
    // language in a companion file next to the main one
    // (".../index.m3u" → ".../index.language.m3u"). When it exists it fills
    // the Language filter; when it doesn't, nothing changes.
    let languages = null;
    const companion = languageCompanionUrl(source.url);
    if (companion && !parsed.entries.some((e) => e.attrs && e.attrs['tvg-language'])) {
      try {
        languages = languageMap(parseM3U(await fetchText(companion)).entries);
      } catch (e) {
        // No companion file (the usual case): the list works without it.
      }
    }

    const built = buildChannels(parsed.entries, { languages });
    let channels = built.channels;
    const truncated = parsed.truncated || channels.length > MAX_CHANNELS;
    if (channels.length > MAX_CHANNELS) channels = channels.slice(0, MAX_CHANNELS);
    if (!channels.length) throw new Error('The playlist has no channels the TV can play.');

    const json = JSON.stringify(channels);
    const fetchedAt = Date.now();
    // Last good list: only replaced once the new one is complete.
    const db = await openDb();
    if (db) {
      await request('catalogs', 'readwrite', (s) => s.put({
        id: sourceId, format: FORMAT, json, fetchedAt,
      }));
    }
    const all = readMeta();
    all[sourceId] = {
      count: channels.length,
      bytes: db ? json.length : 0,
      fetchedAt,
      skipped: built.skipped,
      truncated,
    };
    writeMeta(all);

    if (isActive()) {
      install(source, channels);
      catalog.error = '';
    }
    return { count: channels.length, skipped: built.skipped, truncated };
  } catch (e) {
    if (isActive()) catalog.error = e.message || 'The list could not be updated.';
    throw e;
  }
}

/**
 * Switches to the active source set in sources.js and loads its list.
 * Call after setActiveSource().
 */
export function reloadActive() {
  return loadActive();
}

// ---------------------------------------------------------------------------
// Clearing
// ---------------------------------------------------------------------------

/** Deletes one source's cached list. */
export async function deleteCatalog(sourceId) {
  await request('catalogs', 'readwrite', (s) => s.delete(sourceId));
  const all = readMeta();
  delete all[sourceId];
  writeMeta(all);
}

/**
 * Deletes every cached channel list. The list on screen stays usable for
 * this session; it is downloaded again at the next launch.
 */
export async function clearCatalogs() {
  await request('catalogs', 'readwrite', (s) => s.clear());
  writeMeta({});
}
