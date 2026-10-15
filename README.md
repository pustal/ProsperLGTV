# Prosper LG TV

An IPTV player for LG webOS TVs. It plays the M3U playlists you add, is built for the remote, and is careful with the TV's small storage.

If you enjoy it, please consider [buying me a Ko-fi](https://ko-fi.com/pustal).

> [!IMPORTANT]
> **Prosper LG TV is a webOS adaptation of [ProsperoTV](https://github.com/blackbearreloaded/ProsperoTV)** by [blackbearreloaded](https://github.com/blackbearreloaded), a native IPTV client for PlayStation 5 homebrew. Prosper LG TV follows ProsperoTV's design and behaviour: the offline-first catalog, the filters, favourites and recent channels, falling back to a channel's other streams, and explaining why a channel won't play. It rebuilds all of that for the TV's web runtime. ProsperoTV's PS5-specific work (its own demuxer, hardware decoder and renderer) isn't needed on webOS, where the TV's media pipeline plays the streams. Prosper LG TV is an independent project and is not affiliated with or endorsed by ProsperoTV's authors. Both projects are GPL-3.0-or-later.

> [!NOTE]
> **Prosper LG TV is a player only.** It doesn't host, provide or re-stream any channels, and it comes with no playlist: you add the M3U playlists you want to watch. Only add playlists you are entitled to watch, for example one from your TV or internet provider. See [Content and legal notes](#content-and-legal-notes).

## Features

- **Live TV**: the channels of your playlist (tens of thousands are fine) in a grid built for the remote. Category chips run along the top (News, Sports, Kids…). **Filters** (Yellow button) narrow the list by country, language, category and quality (SD, HD 720p, Full HD 1080p, 4K). Back clears the filters.
- **Offline first**: the last list that loaded successfully opens straight away from the TV's storage, while an update runs in the background (at launch if the list is older than a day or a week, or only when you ask). A failed update keeps the old list.
- **Several streams per channel**: feeds of the same channel id (`Name.cc@SD`, `Name.cc@HD`) are merged into one channel. If a stream fails, the next one is tried automatically, and you can pick one yourself.
- **Player**:
  - A tuning screen until the picture starts, and a time limit for streams that never start.
  - Live streams that stall are reloaded once before the player moves on.
  - Up/Down and CH+/CH- zap through the list you came from. Quick presses skip channels without loading each one.
  - A banner with the channel's name, categories, country, language and quality.
  - OK opens the player menu (favourite, stream choice, statistics, channel details). Blue shows statistics: picture size, stream, server, buffer and dropped frames.
  - When a channel won't play, the player says why as specifically as it can: refused (geo-blocked or needs headers), offline (404), not a video stream, DRM-protected, too slow, or a format the TV can't decode. On the TV, the bundled helper service checks the stream address to tell these apart.
  - Back returns to the list on the channel you were last watching.
- **Favourites** (Green button, or hold OK for the channel menu), **Recent** channels, and **Search** by name, country, language or category.
- **Sources**: any number of M3U/M3U8 playlist addresses, one active at a time. The app starts with none; the first one you add becomes the active list. Each source can be updated, renamed, re-addressed or removed, and its stored copy deleted.
- **Playlist conventions understood**: `tvg-id`, `tvg-name`, `tvg-logo`, `tvg-country`, `tvg-language`, `group-title` (several categories separated by `;`), `#EXTGRP`, `#EXTVLCOPT` and Kodi-style `|User-Agent=` headers, quality in names (`(720p)`), `[Geo-blocked]` and `[Not 24/7]` markers, and countries from channel ids (`CNN.us@SD`). For a playlist named `index.m3u`, a companion `index.language.m3u` next to it (the same streams grouped by language) fills the Language filter when it exists.
- **Badges** for quality, geo-blocked, part-time (not 24/7), channels needing special request headers, and channels with several streams. Settings can hide each kind, and channels that failed last time.
- **Magic Remote**: point and click works alongside the D-pad. The wheel scrolls the grid.

### Remote keys

| Key | Channel lists | Player |
| --- | --- | --- |
| Arrows | Move | Up/Down: next/previous channel; Left/Right: show the banner |
| OK | Play (hold: channel menu) | Player menu |
| CH+ / CH- | Page down/up | Next/previous channel |
| Green | Add/remove favourite | Add/remove favourite |
| Yellow | Filters (Live TV) | |
| Blue | | Statistics |
| Back | Clear filters, then back | Back to the list |

In a desktop browser: Escape or Backspace = Back, PageUp/PageDown = CH+/CH-, and R/G/Y/B = the colour buttons.

## What was ported, and what wasn't

| ProsperoTV (PS5) | Prosper LG TV (webOS) |
| --- | --- |
| Native C++ app, RmlUi/OpenGL interface | HTML/CSS/JS app, no framework, transpiled for Chromium 53 (webOS 4) |
| Own MPEG-TS demuxer, HLS client, PS5 hardware decode | The TV's `<video>` pipeline (HLS, MPEG-TS, DASH; hardware H.264/HEVC, and VP9/AV1 on newer TVs) |
| SQLite last-good catalog | IndexedDB last-good catalog, one record per source |
| Built-in public catalog, custom M3U | Custom M3U playlists only: no catalog is built in (the parser still understands the same playlist conventions) |
| Search; country, language, category and quality filters | ✓ the same (country from `tvg-country` or channel ids, language from `tvg-language` or a language companion playlist) |
| Favourites, recent, return to the last channel | ✓ (favourites in one list, no folders) |
| Alternate streams, stale-segment recovery, failure reasons | ✓ adapted: fallback between streams, reload once on stall, reasons from `<video>` errors plus a helper-service probe |
| Statistics overlay | Partly: picture size, buffer, dropped frames. The TV doesn't report codec or bitrate to web apps |
| Per-stream user agent / referrer headers | ✗ `<video>` can't send custom headers. Such channels are badged and can be hidden |
| Xtream Codes accounts, MAC (Stalker/Ministra) portals | ✗ deliberately left out (see below) |
| Programme guide (EPG), catch-up, timeshift, recording, multiview | ✗ not in this version. EPG files are large XML downloads, and the rest needs player control the TV doesn't give web apps |
| Parental PIN, kids mode, profiles, phone remote, console sharing, USB backup, in-app updates | ✗ not in this version (updates come from the Homebrew Channel) |

## Storage

LG TVs share a few GB of storage among all apps, so Prosper LG TV keeps what it stores small, bounded and visible. **Settings → Storage** lists everything it stores and can delete any of it.

| What | Where | Size | Clear it from |
| --- | --- | --- | --- |
| Channel lists (the last good list per source) | IndexedDB | ~3 MB for a 10,000-channel list | Settings → Storage → Stored channel lists, or per source in Sources |
| Channel logos, shrunk to ~200 px and re-encoded (a few KB each) | IndexedDB | Hard limit: 0 / 5 / **10** / 25 MB; least recently used are deleted first | Settings → Storage → Stored logos |
| Settings, sources, favourites, recent, failed channels | localStorage | A few KB to tens of KB (capped lists) | Settings → Storage → Watch history / Reset Prosper LG TV |
| Video | Never stored | — | — |

Details (see [`src/cache/logoCache.js`](src/cache/logoCache.js) and [`src/catalog/catalog.js`](src/catalog/catalog.js)):

- Playlists and logos are fetched with `cache: 'no-store'`, so the browser's own HTTP disk cache doesn't keep a second, uncontrolled copy.
- Logos from servers that don't let apps read them (no CORS headers) can't be shrunk. They aren't shown; the tile shows the channel's initials instead of the browser caching the full-size image.
- A logo's "last used" time is rewritten at most every few hours, to spare the TV's flash.
- Turning **Channel logos** off downloads and stores no logos at all. A limit of 0 keeps logos in memory only.
- Playlists are capped at 40 MB and 60,000 channels so a wrong address can't exhaust the TV's memory.
- **Reset Prosper LG TV** deletes everything and starts as if newly installed.

## Content and legal notes

- **No content is hosted, provided or linked.** Prosper LG TV is a player. It ships with no playlist and no channel addresses; everything it plays comes from playlists the user adds.
- **Your own playlists are your responsibility.** When you add one, the app asks you to confirm that you are entitled to watch its channels (for example, a playlist from your TV or internet provider).
- **No DRM circumvention.** DRM-protected entries (`#KODIPROP` licence entries, and HLS SAMPLE-AES/FairPlay/Widevine/PlayReady key formats) are skipped or reported as unsupported. ProsperoTV takes the same stance.
- **Left out on purpose:** Xtream Codes and MAC-address portals. They are commonly used by resellers whose rights to the channels are unclear, and MAC portals work by presenting a set-top box's identity. Legitimate providers that offer an M3U address work through playlist sources.
- **No impersonation.** ProsperoTV offers user-agent presets that mimic other players. Prosper LG TV doesn't: the TV's player uses the TV's own identity, and the helper service identifies itself as Prosper LG TV or uses the TV's user agent.
- **Trademarks.** Channel names and logos are shown only to identify channels and belong to their owners. LG and webOS are trademarks of LG Electronics; PlayStation is a trademark of Sony Interactive Entertainment. Prosper LG TV is not affiliated with either, nor with ProsperoTV.
- Nothing about you is collected or sent anywhere. The only network requests go to the playlist addresses, the logo addresses in them, and the streams you play.

## Requirements

- An LG TV on **webOS 4.0 (2018) or newer**. The bundle is transpiled for Chromium 53.
- Node.js 20 or newer on your computer (`.nvmrc` pins 22; with nvm, run `nvm install && nvm use` in the project folder). `npm install` and `npm run build` stop with a clear message on older versions.

## Install on the TV

1. **Turn on Developer Mode on the TV.** Install the *Developer Mode* app from the LG Content Store, sign in with an LG developer account, and turn on *Dev Mode Status* and *Key Server*. The TV restarts. (Developer Mode expires after 50 hours unless you extend it in the app.)
2. **Install dependencies** (this includes the webOS CLI, `ares-*`):
   ```sh
   npm install
   ```
3. **Register the TV once**, naming it `tv` (the npm scripts use that name):
   ```sh
   npx ares-setup-device        # add: name "tv", IP of the TV, port 9922, user "prisoner"
   npx ares-novacom --device tv --getkey   # enter the passphrase shown in the Developer Mode app
   ```
4. **Build, package, install and launch:**
   ```sh
   npm run tv:deploy
   ```
   Or one step at a time: `npm run package`, `npm run tv:install`, `npm run tv:launch`.

To debug on the TV, `npm run tv:inspect` opens Chrome DevTools for the running app. The `tv:*` scripts read the app id and version from `appinfo.json`; set `TV_DEVICE` to use a device name other than `tv`.

### Rooted TVs

With root access you don't need Developer Mode. Build the package with `npm run package`, then either register the TV with `npx ares-setup-device` using port `22`, user `root` and your SSH key (after that the `tv:*` scripts work), or install over SSH:

```sh
scp out/org.prosperlgtv.app_1.0.0_all.ipk root@<TV_IP>:/tmp/prosperlgtv.ipk
ssh root@<TV_IP> "luna-send -i -f luna://com.webos.appInstallService/dev/install '{\"id\":\"com.ares.defaultName\",\"ipkUrl\":\"/tmp/prosperlgtv.ipk\",\"subscribe\":true}'"
```

### The helper service

The `.ipk` includes a small webOS JS service ([`services/helper`](services/helper)), written for the Node.js 8 that webOS 4 ships. The web app uses it for two things it can't do itself:

1. **Downloading playlists from servers without CORS headers.** Browsers won't let a web page read those; Node on the TV can. The app tries a direct download first and only falls back to the service. The file is passed back in chunks and never written to disk.
2. **Explaining failed channels.** The TV's `<video>` element only reports a generic error. The service requests the stream address the way the player does and reports the HTTP status, content type and DRM markers.

## Develop in a desktop browser

```sh
npm run watch    # rebuilds dist/ on every change
npm run serve    # http://localhost:8080
```

Chrome or Chromium is closest to the TV. The keyboard maps to the remote as listed under [Remote keys](#remote-keys). Many desktop browsers can't play HLS natively, so channels may show the error screen there; test playback on the TV. There is no helper service in a browser, so playlists from servers without CORS headers can only be added on the TV.

`npm test` runs the playlist parser and channel model tests (no TV or browser needed).

### Project layout

```
src/main.js                  entry point: router, keys, start-up
src/catalog/m3u.js           extended M3U parser
src/catalog/model.js         channels, quality buckets, filters, search, facets
src/catalog/catalog.js       active list, last-good cache, refreshes
src/catalog/sources.js       the user's playlists
src/cache/logoCache.js       bounded, shrinking logo cache
src/store/db.js              the app's IndexedDB database
src/net/http.js, luna.js     downloads, helper-service calls, stream probes
src/screens/                 Live TV/Favourites/Recent, Search, Sources, Settings, Player, About
src/ui/                      virtualised channel grid, sidebar, dialogs, filters panel
src/nav/focus.js             spatial navigation for the remote
src/data/countries.js        country names (generated from Unicode CLDR by scripts/make-countries.mjs)
services/helper/             webOS JS service (playlist download, stream probe)
scripts/                     icons, country table, Homebrew Channel manifest, TV helpers
homebrew/                    webOS Homebrew Channel listing
tests/                       parser and model tests
```

## Homebrew Channel

`npm run package` also writes `out/org.prosperlgtv.app.manifest.json`. Upload it to each GitHub release together with the `.ipk`. The app is listed in [pustal/webos-repo](https://github.com/pustal/webos-repo) (add `https://pustal.github.io/webos-repo/api/apps.json` in the Homebrew Channel under Settings → Add repository), which always points at the latest release here. [`homebrew/org.prosperlgtv.app.yml`](homebrew/org.prosperlgtv.app.yml) is the same listing, in the format of the official [webOS Homebrew Channel apps-repo](https://github.com/webosbrew/apps-repo).

## Credits

- [ProsperoTV](https://github.com/blackbearreloaded/ProsperoTV) by blackbearreloaded: the app this one adapts. Its feature set, catalog rules (quality buckets, geo-blocked/part-time markers, merged feeds), browsing model and failure reporting are the basis of Prosper LG TV. ProsperoTV is GPL-3.0-or-later.
- [Stash for webOS](https://github.com/pustal/StashWebOS): the spatial navigation, screen router, dialogs and bounded-cache approach come from the same author's earlier webOS app.
- [Barlow and Barlow Condensed](https://github.com/jpt/barlow), © The Barlow Project Authors, SIL Open Font License 1.1 (via [Fontsource](https://fontsource.org)).
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) by Kazuhiko Arase (MIT), for the QR codes in Settings → About.

See [NOTICE.md](NOTICE.md) for details.

## Licence

Prosper LG TV uses the same licence as ProsperoTV: the GNU General Public License, version 3 or (at your option) any later version. See [LICENSE](LICENSE), which is the same file ProsperoTV ships.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

Bundled third-party components keep their own licences: Barlow fonts (SIL OFL 1.1) and qrcode-generator (MIT). See [NOTICE.md](NOTICE.md).
