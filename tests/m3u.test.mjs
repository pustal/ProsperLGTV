/**
 * Unit tests for the playlist parser and channel model (no TV or browser
 * needed): `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAttributes, parseM3U, splitExtinf, splitKodiHeaders,
} from '../src/catalog/m3u.js';
import {
  applyFilter, buildChannels, cleanName, facets, languageCompanionUrl, languageMap, prepare, qualityOf,
} from '../src/catalog/model.js';

const SAMPLE = `﻿#EXTM3U x-tvg-url="https://example.com/guide.xml"
#EXTINF:-1 tvg-id="CNN.us@SD" tvg-logo="https://i.imgur.com/a.png" group-title="News",CNN (720p)
https://example.com/cnn.m3u8
#EXTINF:-1 tvg-id="CNN.us@HD" group-title="News;General",CNN HD (1080p) [Geo-blocked]
https://example.com/cnn-hd.m3u8
#EXTINF:-1 tvg-id="RTP1.pt" group-title="General",RTP 1, Lisboa (576p) [Not 24/7]
#EXTVLCOPT:http-user-agent=Mozilla/5.0
#EXTVLCOPT:http-referrer=https://rtp.pt/
http://example.com/rtp1.m3u8
#EXTINF:-1 group-title="Kids",Kodi Style
http://example.com/kids.m3u8|User-Agent=Foo%20Bar&Referer=http://ref.example
#EXTINF:-1 group-title="Undefined",RTMP channel
rtmp://example.com/live
#EXTINF:-1,DRM channel
#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha
https://example.com/drm.mpd
#EXTGRP:Music
#EXTINF:-1,Grouped
https://example.com/music.m3u8
`;

test('attributes, quoted and unquoted', () => {
  assert.deepEqual(parseAttributes(' tvg-id="a.b" tvg-chno=5 group-title="X, Y"'), { 'tvg-id': 'a.b', 'tvg-chno': '5', 'group-title': 'X, Y' });
});

test('title starts after the first unquoted comma', () => {
  const r = splitExtinf('-1 group-title="A, B",Name, with comma');
  assert.equal(r.title, 'Name, with comma');
  assert.match(r.attrText, /A, B/);
});

test('kodi header suffix', () => {
  assert.deepEqual(splitKodiHeaders('http://x/a.m3u8|User-Agent=Foo%20Bar&Referer=http://y'), { url: 'http://x/a.m3u8', ua: 'Foo Bar', referrer: 'http://y' });
});

test('parses a playlist', () => {
  const r = parseM3U(SAMPLE);
  assert.equal(r.isM3u, true);
  assert.equal(r.epgUrl, 'https://example.com/guide.xml');
  assert.equal(r.entries.length, 7);
  const rtp = r.entries[2];
  assert.equal(rtp.name, 'RTP 1, Lisboa (576p) [Not 24/7]');
  assert.equal(rtp.ua, 'Mozilla/5.0');
  assert.equal(rtp.referrer, 'https://rtp.pt/');
  assert.equal(r.entries[3].ua, 'Foo Bar');
  assert.equal(r.entries[5].drm, true);
  assert.equal(r.entries[6].attrs['group-title'], 'Music');
});

test('maxEntries truncates', () => {
  const r = parseM3U(SAMPLE, { maxEntries: 2 });
  assert.equal(r.entries.length, 2);
  assert.equal(r.truncated, true);
});

test('not a playlist', () => {
  assert.equal(parseM3U('<!doctype html><html></html>').isM3u, false);
});

test('clean names and markers', () => {
  assert.deepEqual(cleanName('CNN HD (1080p) [Geo-blocked]'), {
    name: 'CNN HD', height: 1080, geo: true, part: false,
  });
  assert.deepEqual(cleanName('Foo [Not 24/7]'), {
    name: 'Foo', height: 0, geo: false, part: true,
  });
  assert.equal(qualityOf(576), 'sd');
  assert.equal(qualityOf(720), 'hd');
  assert.equal(qualityOf(1080), 'fhd');
  assert.equal(qualityOf(2160), 'uhd');
  assert.equal(qualityOf(0), '');
});

test('builds channels: merges feeds, drops unplayable and DRM', () => {
  const { channels, skipped } = buildChannels(parseM3U(SAMPLE).entries);
  assert.equal(skipped, 2); // rtmp + drm
  assert.equal(channels.length, 4);
  const cnn = channels[0];
  assert.equal(cnn.n, 'CNN');
  assert.equal(cnn.s.length, 2);
  assert.deepEqual(cnn.c, ['News', 'General']);
  assert.deepEqual(cnn.co, ['United States']);
  assert.equal(cnn.q, 1080);
  assert.equal(cnn.g, false, 'one stream is not geo-blocked');
  assert.equal(cnn.s[0].u, 'https://example.com/cnn.m3u8', 'non-geo stream first');
  const rtp = channels[1];
  assert.deepEqual(rtp.co, ['Portugal']);
  assert.equal(rtp.p, true);
  assert.equal(rtp.s[0].a, 'Mozilla/5.0');
});

test('language enrichment, filters and facets', () => {
  const entries = parseM3U(SAMPLE).entries;
  const langs = languageMap(parseM3U('#EXTM3U\n#EXTINF:-1 group-title="Portuguese",RTP\nhttp://example.com/rtp1.m3u8\n').entries);
  const channels = prepare(buildChannels(entries, { languages: langs }).channels);
  assert.deepEqual(channels[1].la, ['Portuguese']);
  assert.equal(channels[1].$h, true);
  assert.equal(applyFilter(channels, { text: 'lisboa' }).length, 1);
  assert.equal(applyFilter(channels, { text: 'portug' }).length, 1, 'matches country/language prefixes');
  assert.equal(applyFilter(channels, { country: 'United States' }).length, 1);
  assert.equal(applyFilter(channels, { hidePartTime: true }).length, 3);
  assert.equal(applyFilter(channels, { hideHeaders: true }).length, 2);
  assert.equal(applyFilter(channels, { quality: 'fhd' }).length, 1);
  const f = facets(channels);
  assert.equal(f.categories[0][0], 'General');
  assert.deepEqual(f.qualities.map((q) => q[0]), ['sd', 'fhd']);
});

test('language companion address', () => {
  assert.equal(languageCompanionUrl('https://example.com/lists/index.m3u'), 'https://example.com/lists/index.language.m3u');
  assert.equal(languageCompanionUrl('https://example.com/lists/index.m3u8?x=1'), 'https://example.com/lists/index.language.m3u');
  assert.equal(languageCompanionUrl('https://example.com/my-provider.m3u'), null);
});
