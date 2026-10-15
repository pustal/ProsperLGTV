/**
 * The app's one IndexedDB database, "prosperlgtv".
 *
 * Everything Prosper LG TV keeps on the TV's flash besides its small settings
 * lives here, in two stores, so it is easy to measure and to clear:
 *
 * - `catalogs`: the last channel list that loaded successfully, one record
 *   per source ({ id, json, bytes, count, fetchedAt, … }). A failed refresh
 *   never overwrites it (ProsperoTV's "last good catalog").
 * - `logos`: channel logos, shrunk and size-capped (see cache/logoCache.js).
 *
 * Settings, sources, favourites and recent channels are a few KB in
 * localStorage (see settings.js and userdata.js).
 */

const DB_NAME = 'prosperlgtv';
const DB_VERSION = 1;

/** @type {Promise<IDBDatabase|null>|null} */
let opening = null;

/**
 * Opens (once) and returns the database, or null when IndexedDB is
 * unavailable (the app then keeps everything in memory for the session).
 * @returns {Promise<IDBDatabase|null>}
 */
export function openDb() {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('catalogs')) db.createObjectStore('catalogs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('logos')) {
        const logos = db.createObjectStore('logos', { keyPath: 'key' });
        logos.createIndex('used', 'used');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      console.warn('IndexedDB unavailable; nothing will be stored', req.error);
      resolve(null);
    };
  });
  return opening;
}

/**
 * Runs one request in its own transaction and resolves with its result
 * (null on any error, so callers never have to handle storage failures).
 * @param {string} store
 * @param {'readonly'|'readwrite'} mode
 * @param {(s: IDBObjectStore) => IDBRequest} fn
 * @returns {Promise<*>}
 */
export async function request(store, mode, fn) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    let tx;
    try {
      tx = db.transaction(store, mode);
    } catch (e) {
      resolve(null);
      return;
    }
    let result = null;
    const req = fn(tx.objectStore(store));
    req.onsuccess = () => {
      result = req.result;
    };
    tx.oncomplete = () => resolve(result === undefined ? null : result);
    tx.onerror = () => resolve(null);
    tx.onabort = () => resolve(null);
  });
}

/**
 * Walks a store with a cursor, calling `fn(value, cursor)` for each record.
 * @param {string} store
 * @param {'readonly'|'readwrite'} mode
 * @param {(value: *, cursor: IDBCursorWithValue) => (boolean|void)} fn
 *   return false to stop early
 * @param {string} [index] index name to walk instead of the primary key
 */
export async function walk(store, mode, fn, index) {
  const db = await openDb();
  if (!db) return;
  await new Promise((resolve) => {
    let tx;
    try {
      tx = db.transaction(store, mode);
    } catch (e) {
      resolve();
      return;
    }
    const s = tx.objectStore(store);
    const req = (index ? s.index(index) : s).openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return;
      if (fn(cur.value, cur) === false) return;
      cur.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}
