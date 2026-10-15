/**
 * Showing a web link on a TV, where it can't simply be clicked: a QR code
 * to scan with a phone, the address in text, and (on webOS) a button that
 * opens it in the TV's own web browser. Used by Settings → About for the
 * project page, ProsperoTV and Ko-fi.
 *
 * From Stash for webOS (same author), with the layout adapted to avoid
 * flexbox `gap`, which Chromium 53 (webOS 4) doesn't support.
 */
import qrcode from 'qrcode-generator';
import { h } from '../util/dom.js';
import { focus } from '../nav/focus.js';
import { openModal, toast } from './overlay.js';
import { hasLunaBus } from '../net/luna.js';

/**
 * Opens a web page in the TV's browser (webOS application manager).
 * @param {string} url
 * @returns {Promise<void>}
 */
function openInTvBrowser(url) {
  return new Promise((resolve, reject) => {
    const bridge = new window.PalmServiceBridge();
    bridge.onservicecallback = (msg) => {
      let res = {};
      try {
        res = JSON.parse(msg);
      } catch (e) { /* treated as a failure below */ }
      if (res.returnValue) resolve();
      else reject(new Error(res.errorText || 'the browser could not be opened'));
    };
    bridge.call('luna://com.webos.applicationManager/launch',
      JSON.stringify({ id: 'com.webos.app.browser', params: { target: url } }));
  });
}

/**
 * A QR code for a text, as an inline SVG (dark on white with a quiet zone,
 * so phones read it reliably from across the room).
 * @param {string} text
 */
function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const box = h('div', { class: 'qr-code' });
  // createSvgTag builds the markup from the QR matrix only (no user text).
  box.innerHTML = qr.createSvgTag({ cellSize: 8, margin: 4, scalable: true });
  return box;
}

/**
 * Shows a link with its QR code.
 * @param {Object} opts
 * @param {string} opts.title  e.g. "Buy me a Ko-fi"
 * @param {string} opts.url
 * @param {string} [opts.text] a line under the title
 */
export function showLink(opts) {
  let close = null;
  const buttons = [];
  if (hasLunaBus()) {
    buttons.push(h('div', {
      class: 'button primary focusable',
      onSelect: () => openInTvBrowser(opts.url).then(() => close(), (err) => toast(`Couldn’t open the browser: ${err.message}`, 'error')),
    }, 'Open in the TV’s browser'));
  }
  buttons.push(h('div', { class: 'button ghost focusable', onSelect: () => close() }, 'Close'));
  const panel = h('div', { class: 'dialog-panel link-dialog' }, [
    h('h2', { class: 'dialog-title' }, opts.title),
    opts.text ? h('p', { class: 'dialog-message' }, opts.text) : null,
    h('div', { class: 'link-body' }, [
      qrSvg(opts.url),
      h('div', { class: 'link-side' }, [
        h('p', { class: 'link-hint' }, 'Scan with your phone, or go to:'),
        h('p', { class: 'link-url' }, opts.url.replace(/^https?:\/\//, '')),
      ]),
    ]),
    h('div', { class: 'dialog-actions' }, buttons),
  ]);
  close = openModal(panel);
  focus(buttons[0]);
}
