/**
 * Bounded cache for channel logos.
 *
 * Why this exists
 * ---------------
 * LG TVs share a few GB of flash among all apps. A channel list points at
 * ~10,000 logos on many hosts, often full-size PNGs of 50–500 KB. Letting
 * Chromium cache them as-is would quietly fill the TV. Instead (the same
 * approach as Stash for webOS's image cache):
 *
 * 1. Logos are fetched with `cache: 'no-store'`, so Chromium's HTTP disk
 *    cache never keeps them.
 * 2. Each logo is redrawn on a canvas at the size it is shown at (a tile is
 *    ~180 px wide) and re-encoded, typically 3–10 KB.
 * 3. Only that small copy is stored, in IndexedDB, under a hard byte budget
 *    (Settings → Storage → Logo cache). Least-recently-used logos are
 *    deleted first; one logo can never take more than 1/20 of the budget.
 *    Budget 0 keeps logos in RAM only.
 * 4. "Last used" times are rewritten at most every few hours per logo, so
 *    browsing doesn't become a stream of flash writes.
 * 5. Logos on servers that don't allow apps to read them (no CORS headers)
 *    can't be shrunk; they are not shown (the tile shows the channel's
 *    initials) rather than being cached by the browser at full size.
 * 6. Failures are remembered for the session so they aren't retried on
 *    every scroll.
 *
 * The RAM tier is a small LRU of object URLs, also bounded in bytes.
 */
import { request, walk } from '../store/db.js';

/** Width logos are stored at (px). Tiles show them at ~180 px on a 1080p UI. */
const LOGO_WIDTH = 200;
/** Max decoded-blob bytes kept as object URLs in RAM. */
const MEMORY_BUDGET = 6 * 1024 * 1024;
/** Max simultaneous logo downloads (TV Wi-Fi and CPU are both limited). */
const MAX_CONCURRENT = 4;
/** Only rewrite an entry's last-used time when it is older than this. */
const TOUCH_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** When evicting, go this far below the budget so we don't evict on every write. */
const EVICT_TARGET = 0.85;
/** Logos bigger than this are not downloaded at all (bytes). */
const MAX_DOWNLOAD = 2 * 1024 * 1024;
/** Time allowed for one logo download. */
const TIMEOUT_MS = 12000;

let enabled = true;
let budgetBytes = 10 * 1024 * 1024;
let storedBytes = 0;
let ready = null;

/** RAM tier: url → { url: objectUrl, bytes }. Map order = LRU order. */
const memory = new Map();
let memoryBytes = 0;
/** URLs that failed this session. */
const failed = new Set();
/** Downloads in progress, so duplicates share one request. */
const inflight = new Map();
/** <img> elements waiting for a download slot (LIFO: newest is on screen). */
const queue = [];
let active = 0;

let webpSupported = null;

// ---------------------------------------------------------------------------
// Setup and maintenance
// ---------------------------------------------------------------------------

/**
 * Sets the cache up (safe to call again when settings change).
 * @param {{enabled: boolean, budgetBytes: number}} opts
 */
export function initLogoCache(opts) {
  enabled = !!opts.enabled;
  budgetBytes = Math.max(0, opts.budgetBytes || 0);
  if (!ready) ready = scanSize();
  return ready.then(() => (budgetBytes === 0 ? clearLogoCache(true) : evictIfNeeded()));
}

/** Sums stored bytes once at startup. */
function scanSize() {
  storedBytes = 0;
  return walk('logos', 'readonly', (v) => {
    storedBytes += v.bytes || 0;
  });
}

/** Usage numbers for the Settings screen. */
export function logoStats() {
  return {
    storedBytes, budgetBytes, memoryBytes, enabled,
  };
}

/**
 * Deletes every stored logo.
 * @param {boolean} [keepMemory] keep the RAM tier (budget set to 0)
 */
export function clearLogoCache(keepMemory) {
  if (!keepMemory) {
    memory.forEach((e) => URL.revokeObjectURL(e.url));
    memory.clear();
    memoryBytes = 0;
    failed.clear();
  }
  return request('logos', 'readwrite', (s) => s.clear()).then(() => {
    storedBytes = 0;
  });
}

/** Deletes least-recently-used logos until under the budget. */
function evictIfNeeded() {
  if (storedBytes <= budgetBytes) return Promise.resolve();
  const target = budgetBytes * EVICT_TARGET;
  return walk('logos', 'readwrite', (v, cur) => {
    if (storedBytes <= target) return false;
    storedBytes -= v.bytes || 0;
    cur.delete();
    return true;
  }, 'used').then(() => {
    storedBytes = Math.max(0, storedBytes);
  });
}

// ---------------------------------------------------------------------------
// RAM tier
// ---------------------------------------------------------------------------

function memoryGet(url) {
  const e = memory.get(url);
  if (!e) return null;
  memory.delete(url);
  memory.set(url, e);
  return e.url;
}

function memoryPut(url, blob) {
  const old = memory.get(url);
  if (old) {
    URL.revokeObjectURL(old.url);
    memoryBytes -= old.bytes;
    memory.delete(url);
  }
  const objectUrl = URL.createObjectURL(blob);
  memory.set(url, { url: objectUrl, bytes: blob.size });
  memoryBytes += blob.size;
  while (memoryBytes > MEMORY_BUDGET && memory.size > 1) {
    const oldestKey = memory.keys().next().value;
    const oldest = memory.get(oldestKey);
    // Logos already decoded on screen keep showing after the URL is revoked.
    URL.revokeObjectURL(oldest.url);
    memoryBytes -= oldest.bytes;
    memory.delete(oldestKey);
  }
  return objectUrl;
}

// ---------------------------------------------------------------------------
// Download and shrink
// ---------------------------------------------------------------------------

function supportsWebp() {
  if (webpSupported === null) {
    try {
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = 1;
      webpSupported = c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    } catch (e) {
      webpSupported = false;
    }
  }
  return webpSupported;
}

/** Decodes a blob into an <img>. */
function decode(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode failed'));
    };
    img.src = url;
  });
}

/** Redraws a logo at LOGO_WIDTH (keeping transparency) and re-encodes it. */
async function shrink(blob) {
  if (/svg/.test(blob.type) && blob.size < 64 * 1024) return blob;
  const img = await decode(blob);
  const w = img.naturalWidth || img.width;
  const hgt = img.naturalHeight || img.height;
  if (!w || !hgt) throw new Error('empty image');
  const scale = Math.min(1, LOGO_WIDTH / w, (LOGO_WIDTH * 0.75) / hgt);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(hgt * scale));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const type = supportsWebp() ? 'image/webp' : 'image/png';
  const out = await new Promise((resolve) => {
    if (canvas.toBlob) canvas.toBlob(resolve, type, 0.8);
    else resolve(null);
  });
  // Free the canvas backing store right away (matters on low-RAM TVs).
  canvas.width = 0;
  canvas.height = 0;
  if (!out) throw new Error('encode failed');
  return out.size < blob.size ? out : blob;
}

function timeout(promise) {
  let t;
  return Promise.race([promise, new Promise((resolve, reject) => {
    t = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
  })]).then((v) => {
    clearTimeout(t);
    return v;
  }, (e) => {
    clearTimeout(t);
    throw e;
  });
}

/**
 * Resolves a logo URL to an object URL: RAM → IndexedDB → network.
 * @param {string} url
 * @returns {Promise<string>}
 */
function resolveLogo(url) {
  const hit = memoryGet(url);
  if (hit) return Promise.resolve(hit);
  if (failed.has(url)) return Promise.reject(new Error('failed before'));
  if (inflight.has(url)) return inflight.get(url);

  const job = (async () => {
    const persist = budgetBytes > 0;
    if (persist) {
      const rec = await request('logos', 'readonly', (s) => s.get(url));
      if (rec && rec.blob) {
        if (Date.now() - rec.used > TOUCH_INTERVAL_MS) {
          rec.used = Date.now();
          request('logos', 'readwrite', (s) => s.put(rec));
        }
        return memoryPut(url, rec.blob);
      }
    }
    // mode 'cors' (the default for fetch) is what lets us read and redraw it.
    const res = await timeout(fetch(url, { cache: 'no-store', credentials: 'omit' }));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get('Content-Type') || '';
    if (type && type.indexOf('image/') !== 0) throw new Error('not an image');
    const len = parseInt(res.headers.get('Content-Length') || '0', 10);
    if (len > MAX_DOWNLOAD) throw new Error('too large');
    const original = await timeout(res.blob());
    if (original.size > MAX_DOWNLOAD) throw new Error('too large');
    const small = await shrink(original);
    if (persist && small.size <= budgetBytes / 20) {
      const rec = {
        key: url, blob: small, bytes: small.size, used: Date.now(),
      };
      request('logos', 'readwrite', (s) => s.put(rec)).then((r) => {
        if (r !== null) {
          storedBytes += rec.bytes;
          evictIfNeeded();
        }
      });
    }
    return memoryPut(url, small);
  })();

  inflight.set(url, job);
  job.then(() => inflight.delete(url), () => {
    inflight.delete(url);
    failed.add(url);
  });
  return job;
}

// ---------------------------------------------------------------------------
// <img> binding
// ---------------------------------------------------------------------------

function pump() {
  while (active < MAX_CONCURRENT && queue.length) {
    const img = queue.pop();
    // Skip images whose tile was recycled or removed meanwhile.
    if (!img.__logo || !document.documentElement.contains(img)) continue;
    active += 1;
    const url = img.__logo;
    resolveLogo(url)
      .then((objectUrl) => {
        if (img.__logo !== url) return;
        img.onload = () => {
          img.classList.add('loaded');
          if (img.parentNode) img.parentNode.classList.add('has-logo');
        };
        img.src = objectUrl;
      })
      .catch(() => { /* the tile keeps showing initials */ })
      .then(() => {
        active -= 1;
        pump();
      });
  }
}

/**
 * Binds an <img> to a logo URL. The logo appears (with the `loaded` class)
 * when ready; until then, or if it fails, the tile's initials show.
 * @param {HTMLImageElement} img
 * @param {string} url
 */
export function bindLogo(img, url) {
  if (!enabled || !url || failed.has(url)) return;
  img.__logo = url;
  const hit = memoryGet(url);
  if (hit) {
    img.onload = () => {
      img.classList.add('loaded');
      if (img.parentNode) img.parentNode.classList.add('has-logo');
    };
    img.src = hit;
    return;
  }
  queue.push(img);
  // Deferred so an image created and appended in the same task is in the
  // document by the time the queue runs.
  Promise.resolve().then(pump);
}

/** Cancels pending logo loads inside a removed subtree. */
export function releaseLogos(root) {
  const imgs = root.querySelectorAll('img');
  for (let i = 0; i < imgs.length; i += 1) imgs[i].__logo = null;
}
