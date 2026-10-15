/**
 * Network helpers: downloading playlists and diagnosing failed streams.
 *
 * Playlists are fetched with `cache: 'no-store'` so Chromium never keeps a
 * second copy in its HTTP disk cache: the parsed list is stored once, in
 * IndexedDB, under a size the Settings screen shows and can clear.
 */
import { hasLunaBus, lunaCall, lunaSubscribe } from './luna.js';

/** Biggest playlist accepted, so a wrong URL can't exhaust the TV's RAM. */
export const MAX_PLAYLIST_BYTES = 40 * 1024 * 1024;
/** Time allowed for a playlist download. */
const PLAYLIST_TIMEOUT_MS = 90000;

/** Error with a short machine code and a message fit for the user. */
export class NetError extends Error {
  /**
   * @param {string} code  'http' | 'network' | 'cors' | 'timeout' | 'too-big' | 'service'
   * @param {string} message
   * @param {number} [status]
   */
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status || 0;
  }
}

/** Rejects after `ms` (Chromium 53 has no AbortController). */
function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new NetError('timeout', 'The server took too long to answer.')), ms);
    }),
  ]).then((v) => {
    clearTimeout(timer);
    return v;
  }, (e) => {
    clearTimeout(timer);
    throw e;
  });
}

/** Plain-language text for an HTTP status. */
export function describeStatus(status) {
  if (status === 401 || status === 403) return `The server refused access (HTTP ${status}). It may be restricted to some countries or need a login.`;
  if (status === 404 || status === 410) return `Nothing was found at that address (HTTP ${status}).`;
  if (status === 451) return 'The server says this content isn’t available in your region (HTTP 451).';
  if (status === 429) return 'The server is limiting requests right now (HTTP 429). Try again later.';
  if (status >= 500) return `The server had a problem (HTTP ${status}). Try again later.`;
  return `The server answered with HTTP ${status}.`;
}

/**
 * Downloads a text file directly from the web app.
 * @param {string} url
 * @returns {Promise<string>}
 */
async function fetchDirect(url) {
  let res;
  try {
    res = await withTimeout(fetch(url, { cache: 'no-store', credentials: 'omit' }), PLAYLIST_TIMEOUT_MS);
  } catch (e) {
    if (e instanceof NetError) throw e;
    // A TypeError here means the request never produced a readable response:
    // offline, DNS failure, or (most often for playlists) missing CORS headers.
    throw new NetError('cors', 'The server could not be reached from the app.');
  }
  if (!res.ok) throw new NetError('http', describeStatus(res.status), res.status);
  const len = parseInt(res.headers.get('Content-Length') || '0', 10);
  if (len > MAX_PLAYLIST_BYTES) throw new NetError('too-big', 'This playlist is too large for the TV.');
  const text = await withTimeout(res.text(), PLAYLIST_TIMEOUT_MS);
  if (text.length > MAX_PLAYLIST_BYTES) throw new NetError('too-big', 'This playlist is too large for the TV.');
  return text;
}

/**
 * Downloads a text file through the helper service, which sends it back in
 * chunks (the luna bus limits the size of one message).
 * @param {string} url
 * @returns {Promise<string>}
 */
async function fetchViaService(url) {
  const parts = [];
  let size = 0;
  try {
    await lunaSubscribe('fetchText', { url, maxBytes: MAX_PLAYLIST_BYTES }, (msg) => {
      if (typeof msg.chunk === 'string') {
        parts.push(msg.chunk);
        size += msg.chunk.length;
      }
      return !!msg.done;
    }, 60000);
  } catch (e) {
    if (e.code === 'http') throw new NetError('http', describeStatus(e.status || 0), e.status);
    if (e.code === 'too-big') throw new NetError('too-big', 'This playlist is too large for the TV.');
    if (e.code === 'timeout') throw new NetError('timeout', 'The server took too long to answer.');
    if (e.code === 'network') throw new NetError('network', `The server could not be reached (${e.message}).`);
    throw new NetError('service', e.message || 'The helper service failed.');
  }
  if (size === 0) throw new NetError('http', 'The server sent an empty file.');
  return parts.join('');
}

/**
 * Downloads a playlist (or any text file).
 * Tries a direct request first; when the server blocks web apps (no CORS
 * headers), retries through the helper service on the TV.
 * @param {string} url
 * @returns {Promise<string>}
 */
export async function fetchText(url) {
  try {
    return await fetchDirect(url);
  } catch (e) {
    if (e.code !== 'cors') throw e;
    if (!hasLunaBus()) {
      throw new NetError('cors', 'The server could not be reached, or it doesn’t let web apps read it. On the TV, Prosper LG TV’s helper service handles such servers.');
    }
    return fetchViaService(url);
  }
}

/**
 * @typedef {Object} ProbeResult
 * @property {boolean} ok        the request itself worked
 * @property {number} status     final HTTP status (0 when unknown)
 * @property {string} type       Content-Type
 * @property {string} [error]    network error code ('timeout', 'ENOTFOUND', …)
 * @property {boolean} [drm]     an HLS playlist using DRM key formats
 * @property {boolean} [html]    the address returned a web page
 */

/**
 * Asks the helper service what a stream address returns. Resolves null when
 * that's not possible (desktop browser, service missing).
 *
 * The request is made the way the TV's player makes it: with the TV's own
 * user agent and no extra headers, so the answer explains what the player
 * saw (a channel that needs special headers shows up as refused).
 * @param {{u: string}} stream
 * @returns {Promise<ProbeResult|null>}
 */
export async function probe(stream) {
  if (!hasLunaBus()) return null;
  try {
    const res = await lunaCall('probe', { url: stream.u, userAgent: navigator.userAgent }, 20000);
    return res.returnValue ? res : null;
  } catch (e) {
    return null;
  }
}
