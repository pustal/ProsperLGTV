/**
 * About text: credits to ProsperoTV, licence, and the legal
 * notice about where channels come from. Shown from Settings → About and,
 * in short form, once at first launch (see welcomeNotice()).
 */
import { h } from '../util/dom.js';
import { openModal } from '../ui/overlay.js';

/** Upstream project this app adapts. */
export const UPSTREAM = 'https://github.com/blackbearreloaded/ProsperoTV';
export const PROJECT = 'https://github.com/pustal/ProsperLGTV';
/** Where people can support the app's author. */
export const KOFI = 'https://ko-fi.com/pustal';

/** Body of the About dialog. */
export function aboutContent() {
  return h('div', { class: 'about-body scroll-y' }, [
    h('h2', { class: 'dialog-title' }, `Prosper LG TV ${__APP_VERSION__}`),
    h('p', null, 'An IPTV client for LG webOS TVs.'),
    h('h3', null, 'Based on ProsperoTV'),
    h('p', null, `Prosper LG TV is an unofficial webOS adaptation of ProsperoTV by blackbearreloaded, a native IPTV client for PlayStation 5 homebrew (${UPSTREAM}). It follows ProsperoTV’s design and behaviour — the offline-first catalog, filters, favourites, stream fallback and failure messages — rebuilt for the TV’s web runtime. Prosper LG TV is not affiliated with or endorsed by ProsperoTV’s authors.`),
    h('h3', null, 'Channels'),
    h('p', null, 'Prosper LG TV is a player only. It doesn’t host, provide or re-stream any channels, and it comes with no playlist: you add the playlists you want to watch. Streams belong to their broadcasters and can stop working, move, or be limited to some countries at any time. Channel names and logos come from your playlists, are shown only to identify channels, and belong to their owners.'),
    h('p', null, 'Only add playlists you have the right to watch, for example one from your TV or internet provider. DRM-protected streams are not supported.'),
    h('h3', null, 'Licence'),
    h('p', null, `GNU General Public License v3.0 or later, the same licence as ProsperoTV. This program comes with ABSOLUTELY NO WARRANTY; you are welcome to redistribute it under its terms. Source code: ${PROJECT}`),
    h('p', null, 'QR codes: qrcode-generator by Kazuhiko Arase (MIT License).'),
    h('p', null, 'Fonts: Barlow and Barlow Condensed, © The Barlow Project Authors (SIL Open Font License 1.1).'),
    h('p', null, 'LG and webOS are trademarks of LG Electronics. PlayStation is a trademark of Sony Interactive Entertainment. This app is not affiliated with either.'),
  ]);
}

/**
 * One-time notice at first launch about where channels come from.
 * @returns {Promise<void>} resolves when dismissed
 */
export function welcomeNotice() {
  return new Promise((resolve) => {
    let close = null;
    const done = () => {
      close();
      resolve();
    };
    const panel = h('div', { class: 'dialog-panel welcome-panel' }, [
      h('h2', { class: 'dialog-title' }, 'Welcome to Prosper LG TV'),
      h('p', { class: 'dialog-message' }, 'Prosper LG TV plays the M3U playlists you add. It doesn’t come with any channels and doesn’t host or provide any: add a playlist you are entitled to watch, for example one from your TV or internet provider, in Sources.'),
      h('p', { class: 'dialog-message' }, `It is an unofficial webOS adaptation of ProsperoTV for PlayStation 5 (${UPSTREAM}).`),
      h('div', { class: 'dialog-actions' }, [
        h('div', { class: 'button primary focusable', 'data-autofocus': true, onSelect: done }, 'Continue'),
      ]),
    ]);
    close = openModal(panel, { onDismiss: resolve });
  });
}
