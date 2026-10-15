/**
 * Channel model: turns parsed M3U entries into channels, and filters,
 * searches and summarises them for the UI.
 *
 * The rules follow ProsperoTV's catalog and browser (src/iptv_catalog.cpp,
 * src/iptv_app.cpp), adapted to what a webOS TV can play:
 *
 * - Quality is read from the "(720p)" style suffix many public playlists put in names and
 *   bucketed into SD / HD / Full HD / 4K, as ProsperoTV's quality filter does.
 * - "[Geo-blocked]" and "[Not 24/7]" markers become flags (badges, filters).
 * - Entries sharing a channel id (public playlists' "1Plus1.ua@SD" and
 *   "1Plus1.ua@HD") become one channel with several streams, so the player
 *   can fall back to another stream when one fails (ProsperoTV's "alternate
 *   URLs").
 * - Streams the TV's player cannot open at all (RTMP, SRT, UDP, RTP, MMS) and
 *   DRM-protected entries are dropped; a channel left without streams is
 *   dropped too and counted in `skipped`.
 *
 * Stored channel shape (also what IndexedDB holds; keep it small):
 *   { k: key, n: name, l: logo, c: [categories], co: [countries],
 *     la: [languages], s: [streams], q: best height, g: all streams geo-blocked,
 *     p: all streams part-time }
 * Stream shape: { u: url, h: height, g: geo-blocked, p: part-time,
 *     a: user agent, r: referrer }   (a/r only when set)
 *
 * No DOM dependencies, so it can be unit-tested in Node.
 */
import { COUNTRIES } from '../data/countries.js';

/** Protocols the webOS media pipeline can open from a web app. */
const PLAYABLE = /^https?:\/\//i;

/** Quality buckets, in filter order. `min` is the lowest height in the bucket. */
export const QUALITIES = [
  { id: 'sd', label: 'SD', min: 1 },
  { id: 'hd', label: 'HD 720p', min: 700 },
  { id: 'fhd', label: 'Full HD 1080p', min: 1000 },
  { id: 'uhd', label: '4K / 1440p+', min: 1400 },
];

/**
 * Quality bucket id for a picture height (0 = unknown → '').
 * @param {number} height
 */
export function qualityOf(height) {
  if (!height) return '';
  let id = '';
  for (const q of QUALITIES) if (height >= q.min) id = q.id;
  return id;
}

/**
 * Splits a raw channel title into its clean name and the common playlist markers.
 * "CNN International (1080p) [Geo-blocked]" →
 *   { name: "CNN International", height: 1080, geo: true, part: false }
 * @param {string} raw
 */
export function cleanName(raw) {
  let name = raw || '';
  let height = 0;
  let geo = false;
  let part = false;
  name = name.replace(/\[([^\]]*)\]/g, (m, inner) => {
    const t = inner.toLowerCase();
    if (t.indexOf('geo') >= 0) {
      geo = true;
      return ' ';
    }
    if (t.indexOf('24/7') >= 0) {
      part = true;
      return ' ';
    }
    return m;
  });
  name = name.replace(/\((\d{3,4})[pi]\)/i, (m, h) => {
    height = parseInt(h, 10) || 0;
    return ' ';
  });
  name = name.replace(/\s+/g, ' ').trim();
  return {
    name: name || raw || '', height, geo, part,
  };
}

/** Splits "a;b" / "a,b" lists, trimming and dropping empty / "Undefined". */
function splitList(value) {
  if (!value) return [];
  const out = [];
  for (const part of value.split(/[;,|]/)) {
    const v = part.trim();
    if (v && v.toLowerCase() !== 'undefined' && out.indexOf(v) < 0) out.push(v);
  }
  return out;
}

/** Turns country codes into names ("us" → "United States"); names are kept. */
function countryNames(values) {
  return values.map((v) => (v.length === 2 && COUNTRIES[v.toLowerCase()]) || v);
}

/**
 * The channel part of a "Name.cc@Feed" style id: "CNN.us@SD" → "CNN.us".
 * @param {string} id
 */
function baseId(id) {
  const at = id.indexOf('@');
  return at >= 0 ? id.slice(0, at) : id;
}

/** Country code at the end of a "Name.cc" channel id ("CNN.us" → "us"). */
function countryFromId(id) {
  const m = /\.([a-z]{2})$/i.exec(id);
  return m && COUNTRIES[m[1].toLowerCase()] ? m[1].toLowerCase() : '';
}

/** Ordering of a channel's streams: plain ones first, then by quality. */
function streamRank(s) {
  return (s.a || s.r ? 2 : 0) + (s.g ? 1 : 0);
}

/**
 * Builds channels from parsed entries.
 * @param {import('./m3u.js').M3uEntry[]} entries
 * @param {{languages?: Object<string,string[]>}} [opts]
 *   languages: stream URL → language names (from a language companion file)
 * @returns {{channels: Object[], skipped: number}}
 */
export function buildChannels(entries, opts) {
  const languages = (opts && opts.languages) || null;
  const byKey = new Map();
  const channels = [];
  let skipped = 0;

  for (const e of entries) {
    if (e.drm || !PLAYABLE.test(e.url)) {
      skipped += 1;
      continue;
    }
    const a = e.attrs || {};
    const id = a['tvg-id'] || '';
    const base = id ? baseId(id) : '';
    const info = cleanName(e.name);
    const stream = { u: e.url, h: info.height, g: info.geo, p: info.part };
    if (e.ua) stream.a = e.ua;
    if (e.referrer) stream.r = e.referrer;

    // One channel per id; entries without an id are channels of their own.
    const key = base ? `id:${base}` : `u:${e.url}`;
    let ch = byKey.get(key);
    if (!ch) {
      let co = splitList(a['tvg-country']);
      if (!co.length && base) {
        const code = countryFromId(base);
        if (code) co = [code];
      }
      ch = {
        k: key,
        n: info.name,
        l: a['tvg-logo'] || a.logo || '',
        c: splitList(a['group-title']),
        co: countryNames(co),
        la: splitList(a['tvg-language']),
        s: [],
        q: 0,
        g: true,
        p: true,
      };
      byKey.set(key, ch);
      channels.push(ch);
    } else {
      // Prefer the shortest clean name ("1+1 International" over "… HD").
      if (info.name && info.name.length < ch.n.length) ch.n = info.name;
      if (!ch.l && a['tvg-logo']) ch.l = a['tvg-logo'];
      for (const c of splitList(a['group-title'])) if (ch.c.indexOf(c) < 0) ch.c.push(c);
    }
    if (languages && languages[e.url]) {
      for (const l of languages[e.url]) if (ch.la.indexOf(l) < 0) ch.la.push(l);
    }
    // The same URL listed twice adds nothing.
    let dup = false;
    for (const s of ch.s) if (s.u === stream.u) dup = true;
    if (dup) continue;
    ch.s.push(stream);
    if (stream.h > ch.q) ch.q = stream.h;
    if (!stream.g) ch.g = false;
    if (!stream.p) ch.p = false;
  }

  for (const ch of channels) {
    ch.s.sort((x, y) => (streamRank(x) - streamRank(y)) || (y.h - x.h));
  }
  return { channels, skipped };
}

/**
 * Reads a language companion playlist (the same streams, grouped by
 * language) into a map of stream URL → language names.
 * @param {import('./m3u.js').M3uEntry[]} entries
 */
export function languageMap(entries) {
  const map = {};
  for (const e of entries) {
    const lang = (e.attrs && e.attrs['group-title']) || '';
    if (!lang || lang.toLowerCase() === 'undefined') continue;
    const list = map[e.url] || (map[e.url] = []);
    for (const l of splitList(lang)) if (list.indexOf(l) < 0) list.push(l);
  }
  return map;
}

/**
 * Address of the language-grouped companion of a playlist named
 * "index.m3u" ("…/index.language.m3u"), or null for other names. Some public
 * playlist collections publish one; catalog.js tries it once per refresh.
 * @param {string} url
 */
export function languageCompanionUrl(url) {
  const m = /^(.*\/)index\.m3u8?(\?.*)?$/i.exec(url || '');
  return m ? `${m[1]}index.language.m3u` : null;
}

// ---------------------------------------------------------------------------
// Runtime helpers (not stored)
// ---------------------------------------------------------------------------

/**
 * Adds the derived fields the UI needs (lower-case search text, quality
 * bucket, header flag). Called once after a catalog is loaded.
 * @param {Object[]} channels
 */
export function prepare(channels) {
  for (const ch of channels) {
    ch.$s = fold(ch.n);
    ch.$q = qualityOf(ch.q);
    // Needs request headers when every stream asks for them.
    ch.$h = ch.s.length > 0 && ch.s.every((s) => !!(s.a || s.r));
  }
  return channels;
}

/**
 * Lower-cases and strips accents for matching ("Télé" → "tele").
 * `normalize` exists from Chromium 34, so it is safe on webOS 4.
 * @param {string} text
 */
export function fold(text) {
  let t = (text || '').toLowerCase();
  if (t.normalize) t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return t;
}

/**
 * @typedef {Object} Filter
 * @property {string} [text]     search text (name, country, language, category)
 * @property {string} [category]
 * @property {string} [country]
 * @property {string} [language]
 * @property {string} [quality]  QUALITIES id
 * @property {boolean} [hideGeo]
 * @property {boolean} [hidePartTime]
 * @property {boolean} [hideHeaders] hide channels that need request headers
 * @property {Set<string>} [hideKeys] keys to hide (channels that failed)
 */

/**
 * Applies a filter and returns the matching channels (catalog order).
 * @param {Object[]} channels  prepared channels
 * @param {Filter} f
 */
export function applyFilter(channels, f) {
  const words = f.text ? fold(f.text).split(/\s+/).filter(Boolean) : [];
  const out = [];
  for (const ch of channels) {
    if (f.category && ch.c.indexOf(f.category) < 0) continue;
    if (f.country && ch.co.indexOf(f.country) < 0) continue;
    if (f.language && ch.la.indexOf(f.language) < 0) continue;
    if (f.quality && ch.$q !== f.quality) continue;
    if (f.hideGeo && ch.g) continue;
    if (f.hidePartTime && ch.p) continue;
    if (f.hideHeaders && ch.$h) continue;
    if (f.hideKeys && f.hideKeys.has(ch.k)) continue;
    if (words.length && !matchesWords(ch, words)) continue;
    out.push(ch);
  }
  return out;
}

/** Every word must appear in the name, a category, country or language. */
function matchesWords(ch, words) {
  for (const w of words) {
    if (ch.$s.indexOf(w) >= 0) continue;
    let found = false;
    const fields = [ch.c, ch.co, ch.la];
    for (let i = 0; i < fields.length && !found; i += 1) {
      for (const v of fields[i]) {
        if (fold(v).indexOf(w) === 0) {
          found = true;
          break;
        }
      }
    }
    if (!found) return false;
  }
  return true;
}

/**
 * Counts the values of each filterable field, most common first.
 * @param {Object[]} channels prepared channels
 * @returns {{categories: Array<[string, number]>, countries: Array<[string, number]>,
 *   languages: Array<[string, number]>, qualities: Array<[string, number]>}}
 */
export function facets(channels) {
  const cat = new Map();
  const co = new Map();
  const la = new Map();
  const q = new Map();
  const bump = (map, k) => map.set(k, (map.get(k) || 0) + 1);
  for (const ch of channels) {
    for (const v of ch.c) bump(cat, v);
    for (const v of ch.co) bump(co, v);
    for (const v of ch.la) bump(la, v);
    if (ch.$q) bump(q, ch.$q);
  }
  const sorted = (map) => Array.from(map.entries()).sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1));
  const byName = (map) => Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return {
    categories: sorted(cat),
    countries: byName(co),
    languages: sorted(la),
    qualities: QUALITIES.filter((x) => q.has(x.id)).map((x) => [x.id, q.get(x.id)]),
  };
}

/**
 * Sorts channels by name, ignoring case and accents (in place).
 * @param {Object[]} channels prepared channels
 */
export function sortByName(channels) {
  return channels.sort((a, b) => (a.$s < b.$s ? -1 : a.$s > b.$s ? 1 : 0));
}
