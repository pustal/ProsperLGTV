/**
 * Actions shared by every screen that shows channels: play, favourite,
 * the options menu (OK held) and the channel details dialog.
 */
import { h } from '../util/dom.js';
import { catalog } from '../catalog/catalog.js';
import { isFavourite, toggleFavourite } from '../userdata.js';
import { chooseOption, openModal, toast } from './overlay.js';
import { openItem } from './navigate.js';
import { qualityLabel } from './channelGrid.js';

/** Id of the source the channels on screen belong to. */
function sourceId() {
  return catalog.source ? catalog.source.id : '';
}

/**
 * Opens the player on a channel of a list (zapping moves through the list).
 * @param {Object[]} list
 * @param {number} index
 * @param {{stream?: number}} [extra] start with a particular stream
 */
export function playChannel(list, index, extra) {
  openItem('player', { list, index }, extra);
}

/** True when the channel is a favourite of the active source. */
export function isFav(ch) {
  return isFavourite(sourceId(), ch.k);
}

/** Adds or removes a favourite and says which. */
export function toggleFav(ch) {
  const now = toggleFavourite(sourceId(), ch);
  toast(now ? `${ch.n} added to Favourites` : `${ch.n} removed from Favourites`);
  return now;
}

/** Host name of a stream, for showing which server a stream comes from. */
export function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return '';
  }
}

/** One line describing a stream ("1080p · example.com · Geo-blocked"). */
export function describeStream(s, i) {
  const parts = [`Stream ${i + 1}`];
  if (s.h) parts.push(qualityLabel(s.h));
  const host = hostOf(s.u);
  if (host) parts.push(host);
  if (s.g) parts.push('Geo-blocked');
  if (s.p) parts.push('Part-time');
  if (s.a || s.r) parts.push('Needs headers');
  return parts.join(' · ');
}

/** Shows what is known about a channel. */
export function showChannelInfo(ch) {
  const rows = [
    ['Categories', ch.c.join(', ') || '—'],
    ['Countries', ch.co.join(', ') || '—'],
    ['Languages', ch.la.join(', ') || '—'],
    ['Best quality', qualityLabel(ch.q) || 'Not listed'],
  ];
  const notes = [];
  if (ch.g) notes.push('Listed as geo-blocked: it may only play in some countries.');
  if (ch.p) notes.push('Listed as not 24/7: it may be off air at times.');
  if (ch.$h) notes.push('Its streams ask for request headers the TV’s player can’t send, so it may not play.');
  let close = null;
  const panel = h('div', { class: 'dialog-panel info-panel' }, [
    h('h2', { class: 'dialog-title' }, ch.n),
    h('dl', { class: 'info-list' }, rows.map((r) => [h('dt', null, r[0]), h('dd', null, r[1])])),
    h('div', { class: 'info-streams' }, ch.s.map((s, i) => h('p', null, describeStream(s, i)))),
    notes.length ? h('div', { class: 'info-notes' }, notes.map((n) => h('p', null, n))) : null,
    h('div', { class: 'dialog-actions' }, [
      h('div', { class: 'button focusable', 'data-autofocus': true, onSelect: () => close() }, 'Close'),
    ]),
  ]);
  close = openModal(panel);
}

/**
 * Options menu for a channel (OK held on a tile).
 * @param {Object} ch
 * @param {Object[]} list  the list it was chosen from (for zapping)
 * @param {number} index
 */
export async function channelOptions(ch, list, index) {
  const fav = isFav(ch);
  const options = [
    { label: 'Play', value: 'play' },
    { label: fav ? 'Remove from Favourites' : 'Add to Favourites', value: 'fav' },
  ];
  if (ch.s.length > 1) options.push({ label: 'Play a specific stream…', value: 'stream', hint: `${ch.s.length} streams` });
  options.push({ label: 'Channel details', value: 'info' });
  const choice = await chooseOption({ title: ch.n, options });
  if (choice === 'play') playChannel(list, index);
  else if (choice === 'fav') toggleFav(ch);
  else if (choice === 'info') showChannelInfo(ch);
  else if (choice === 'stream') {
    const s = await chooseOption({
      title: 'Choose a stream',
      options: ch.s.map((st, i) => ({ label: describeStream(st, i), value: i })),
    });
    if (s !== undefined) playChannel(list, index, { stream: s });
  }
}

/**
 * The channel the player showed last. Channel screens highlight it when the
 * player closes, so after zapping you land on the channel you were watching
 * (ProsperoTV returns to "the same screen, group, page, and channel").
 */
export const lastPlayed = { key: '' };
