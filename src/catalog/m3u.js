/**
 * Extended M3U playlist parser.
 *
 * Reads the playlist format used by public playlist collections and most IPTV providers:
 *
 *   #EXTM3U x-tvg-url="https://…/guide.xml"
 *   #EXTINF:-1 tvg-id="CNN.us@SD" tvg-logo="https://…" group-title="News",CNN (720p)
 *   #EXTVLCOPT:http-user-agent=Mozilla/5.0 …
 *   https://example.com/cnn/index.m3u8
 *
 * Supported extras, as in ProsperoTV's catalog parser (src/iptv_catalog.cpp):
 * - `#EXTVLCOPT:http-user-agent=` / `http-referrer=` (and the same names as
 *   #EXTINF attributes), recorded so the app can tell the user that a
 *   channel needs request headers the TV's player cannot send;
 * - `#EXTGRP:` as a fallback group;
 * - Kodi-style `url|User-Agent=…&Referer=…` suffixes on stream lines.
 *
 * DRM-protected entries (`#KODIPROP:inputstream.adaptive.license_*`) are
 * flagged so they can be skipped: Prosper LG TV, like ProsperoTV, intentionally
 * does not support DRM or encrypted-key schemes.
 *
 * This module has no DOM dependencies so it can be unit-tested in Node
 * (see tests/m3u.test.mjs).
 */

/**
 * @typedef {Object} M3uEntry
 * @property {string} name      title after the comma in #EXTINF
 * @property {string} url       stream address (Kodi header suffix removed)
 * @property {Object<string,string>} attrs  #EXTINF attributes (lower-case keys)
 * @property {string} ua        user agent the stream asks for ('' if none)
 * @property {string} referrer  referrer the stream asks for ('' if none)
 * @property {boolean} drm      the entry declares a DRM licence
 */

/**
 * @typedef {Object} M3uResult
 * @property {M3uEntry[]} entries
 * @property {string} epgUrl     guide address from the header, if any
 * @property {boolean} truncated stopped early at `maxEntries`
 * @property {boolean} isM3u     the text looked like an M3U playlist
 */

/**
 * Parses `key="value"` pairs (values may also be unquoted).
 * @param {string} text  the part of an #EXTINF/#EXTM3U line holding attributes
 * @returns {Object<string,string>}
 */
export function parseAttributes(text) {
  const attrs = {};
  const re = /([A-Za-z0-9_.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))/g;
  let m = re.exec(text);
  while (m) {
    const value = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4]);
    attrs[m[1].toLowerCase()] = value.trim();
    m = re.exec(text);
  }
  return attrs;
}

/**
 * Splits an #EXTINF payload ("-1 a="b",Title") into attributes and title.
 * The title starts after the first comma that is not inside quotes.
 * @param {string} payload  text after "#EXTINF:"
 */
export function splitExtinf(payload) {
  let inQuote = false;
  for (let i = 0; i < payload.length; i += 1) {
    const c = payload.charCodeAt(i);
    if (c === 34) inQuote = !inQuote; // "
    else if (c === 44 && !inQuote) { // ,
      return { attrText: payload.slice(0, i), title: payload.slice(i + 1).trim() };
    }
  }
  return { attrText: payload, title: '' };
}

/**
 * Removes a Kodi-style header suffix from a stream line.
 * "http://x/a.m3u8|User-Agent=Foo&Referer=http://y" → url + headers.
 * @param {string} line
 */
export function splitKodiHeaders(line) {
  const bar = line.indexOf('|');
  if (bar < 0) return { url: line, ua: '', referrer: '' };
  const url = line.slice(0, bar).trim();
  let ua = '';
  let referrer = '';
  const parts = line.slice(bar + 1).split('&');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    let value = part.slice(eq + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch (e) { /* keep as written */ }
    if (key === 'user-agent') ua = value;
    else if (key === 'referer' || key === 'referrer') referrer = value;
  }
  return { url, ua, referrer };
}

/**
 * Parses an M3U playlist.
 * @param {string} text
 * @param {{maxEntries?: number}} [opts] maxEntries caps memory use on the TV
 * @returns {M3uResult}
 */
export function parseM3U(text, opts) {
  const maxEntries = (opts && opts.maxEntries) || Infinity;
  const entries = [];
  let epgUrl = '';
  let truncated = false;
  // Strip a UTF-8 byte-order mark, which some providers send.
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const isM3u = /^\s*#EXTM3U/i.test(body) || body.indexOf('#EXTINF') >= 0;

  /** Entry being built from the # lines before its stream line. */
  let pending = null;
  let pendingGroup = '';

  let pos = 0;
  const len = body.length;
  while (pos < len) {
    let end = body.indexOf('\n', pos);
    if (end < 0) end = len;
    let line = body.slice(pos, end);
    pos = end + 1;
    if (line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1); // \r
    line = line.trim();
    if (!line) continue;

    if (line.charCodeAt(0) === 35) { // '#'
      const upper = line.slice(0, 12).toUpperCase();
      if (upper.indexOf('#EXTM3U') === 0) {
        const h = parseAttributes(line.slice(7));
        epgUrl = h['x-tvg-url'] || h['url-tvg'] || h['tvg-url'] || epgUrl;
      } else if (upper.indexOf('#EXTINF:') === 0) {
        const { attrText, title } = splitExtinf(line.slice(8));
        const attrs = parseAttributes(attrText);
        pending = {
          name: title || attrs['tvg-name'] || '',
          url: '',
          attrs,
          ua: attrs['http-user-agent'] || attrs['user-agent'] || '',
          referrer: attrs['http-referrer'] || attrs['http-referer'] || attrs.referrer || '',
          drm: false,
        };
        if (!attrs['group-title'] && pendingGroup) attrs['group-title'] = pendingGroup;
      } else if (upper.indexOf('#EXTVLCOPT:') === 0) {
        if (!pending) continue;
        const opt = line.slice(11);
        const eq = opt.indexOf('=');
        if (eq < 0) continue;
        const key = opt.slice(0, eq).trim().toLowerCase();
        const value = opt.slice(eq + 1).trim();
        if (key === 'http-user-agent') pending.ua = value;
        else if (key === 'http-referrer' || key === 'http-referer') pending.referrer = value;
      } else if (upper.indexOf('#EXTGRP:') === 0) {
        pendingGroup = line.slice(8).trim();
        if (pending && !pending.attrs['group-title']) pending.attrs['group-title'] = pendingGroup;
      } else if (upper.indexOf('#KODIPROP:') === 0) {
        if (pending && /inputstream\.adaptive\.(license_type|license_key|drm)/i.test(line)) pending.drm = true;
      }
      continue;
    }

    // A stream line closes the entry (a bare URL without #EXTINF is allowed too).
    const split = splitKodiHeaders(line);
    const entry = pending || {
      name: '', url: '', attrs: pendingGroup ? { 'group-title': pendingGroup } : {}, ua: '', referrer: '', drm: false,
    };
    entry.url = split.url;
    if (split.ua && !entry.ua) entry.ua = split.ua;
    if (split.referrer && !entry.referrer) entry.referrer = split.referrer;
    if (!entry.name) entry.name = entry.url;
    pending = null;
    if (entry.url) {
      if (entries.length >= maxEntries) {
        truncated = true;
        break;
      }
      entries.push(entry);
    }
  }
  return {
    entries, epgUrl, truncated, isM3u,
  };
}
