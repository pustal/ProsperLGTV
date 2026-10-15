/**
 * Channel screens: Live TV (the whole list, with category chips and
 * filters), Favourites and Recent. All three are a header plus a
 * virtualised ChannelGrid.
 */
import { h, icon } from '../util/dom.js';
import { Screen } from '../ui/router.js';
import { ChannelGrid } from '../ui/channelGrid.js';
import { focus, focusFirst } from '../nav/focus.js';
import { colorOf } from '../util/keys.js';
import { applyFilter } from '../catalog/model.js';
import { catalog, onCatalogChange, refresh } from '../catalog/catalog.js';
import { getSettings, onSettingsChange } from '../settings.js';
import {
  clearRecent, failedKeys, favouritesOf, onUserDataChange, recentOf,
} from '../userdata.js';
import {
  channelOptions, isFav, lastPlayed, playChannel, toggleFav,
} from '../ui/channelActions.js';
import { filterSummary, openFilterPanel } from '../ui/filterPanel.js';
import { confirmDialog, hasModal, toast } from '../ui/overlay.js';
import { openSection } from '../ui/navigate.js';

/** Live TV filters, kept for the session so coming back restores them. */
const liveFilter = {
  category: '', country: '', language: '', quality: '',
};
/** Most categories shown as chips; the rest are in the Filters panel. */
const MAX_CHIPS = 14;

const TITLES = { live: 'Live TV', favourites: 'Favourites', recent: 'Recent' };

/** Formats a count ("1,234 channels"). */
function countText(n) {
  return `${n.toLocaleString()} channel${n === 1 ? '' : 's'}`;
}

export class ChannelsScreen extends Screen {
  /** @param {'live'|'favourites'|'recent'} mode */
  constructor(mode) {
    super();
    this.mode = mode;
    this.section = mode;
    this.el.className = 'screen channels-screen no-scroll';
    this.unsubs = [];

    this.countEl = h('span', { class: 'page-count' });
    this.statusEl = h('span', { class: 'page-status' });
    this.toolbar = h('div', { class: 'toolbar' });
    this.chipsTrack = h('div', { class: 'row-track nav-group' });
    this.chipsRow = h('div', { class: 'chips-row' }, h('div', { class: 'row-viewport' }, this.chipsTrack));
    this.summaryEl = h('div', { class: 'filter-summary' });
    this.hintEl = h('div', { class: 'hint-bar' });

    this.grid = new ChannelGrid({
      onPlay: (list, i) => playChannel(list, i),
      onOptions: (ch, i) => channelOptions(ch, this.grid.items, i),
      onFavourite: (ch) => toggleFav(ch),
      isFavourite: (ch) => isFav(ch),
      empty: this.emptyMessage(),
    });

    this.el.appendChild(h('header', { class: 'page-header' }, [
      h('div', { class: 'page-heading' }, [
        h('h1', { class: 'page-title' }, TITLES[mode]),
        this.countEl,
        this.statusEl,
      ]),
      this.toolbar,
    ]));
    if (mode === 'live') {
      this.el.appendChild(this.chipsRow);
      this.el.appendChild(this.summaryEl);
    }
    this.el.appendChild(this.grid.el);
    this.el.appendChild(this.hintEl);
  }

  /** What the grid shows when there is nothing to list. */
  emptyMessage() {
    if (this.mode === 'favourites') return 'No favourites yet. Highlight a channel and press the Green button (or hold OK) to add it.';
    if (this.mode === 'recent') return 'Channels you watch will appear here.';
    return 'No channels match these filters.';
  }

  mount() {
    this.buildToolbar();
    this.buildHints();
    this.reload();
    this.unsubs.push(onCatalogChange(() => {
      if (this.isTop()) this.reload(true);
      else this.dirty = true;
    }));
    this.unsubs.push(onSettingsChange((next, prev) => {
      const keys = ['hideGeo', 'hidePartTime', 'hideHeaders', 'hideFailed'];
      if (keys.some((k) => next[k] !== prev[k])) this.reload(true);
    }));
    this.unsubs.push(onUserDataChange(() => {
      if (this.mode === 'live') this.grid.refresh();
      else this.reload(true);
    }));
  }

  onShow() {
    // Favourites/recent may have changed while the player was open, and the
    // list may have been updated in the background.
    if (this.mode !== 'live' || this.dirty) this.reload(true);
    else this.grid.refresh();
    this.dirty = false;
    // After zapping in the player, land on the channel that was on screen.
    if (lastPlayed.key) {
      const i = this.grid.items.findIndex((ch) => ch.k === lastPlayed.key);
      if (i >= 0) this.grid.focusIndex(i);
      lastPlayed.key = '';
    }
  }

  destroy() {
    for (const off of this.unsubs) off();
    this.grid.destroy();
    super.destroy();
  }

  buildToolbar() {
    const t = this.toolbar;
    t.innerHTML = '';
    if (this.mode === 'live') {
      t.appendChild(h('div', { class: 'button focusable', onSelect: () => this.openFilters() }, [icon('filter'), 'Filters']));
      t.appendChild(h('div', {
        class: 'button ghost focusable',
        onSelect: () => this.refreshNow(),
      }, [icon('refresh'), 'Update list']));
    } else if (this.mode === 'recent') {
      t.appendChild(h('div', {
        class: 'button ghost focusable',
        onSelect: async () => {
          const ok = await confirmDialog({
            title: 'Clear watch history?', confirm: 'Clear', safe: true,
          });
          if (ok) clearRecent();
        },
      }, 'Clear history'));
    }
  }

  buildHints() {
    const parts = [
      ['ok', 'Play'],
      ['ok', 'Hold for options'],
      ['green', this.mode === 'favourites' ? 'Remove favourite' : 'Favourite'],
    ];
    if (this.mode === 'live') {
      parts.push(['yellow', 'Filters']);
      parts.push(['ch', 'Page up/down']);
    }
    this.hintEl.innerHTML = '';
    for (const [key, label] of parts) {
      this.hintEl.appendChild(h('span', { class: 'hint' }, [h('span', { class: `hint-key ${key}` }, key === 'ok' ? 'OK' : key === 'ch' ? 'CH' : ''), label]));
    }
  }

  /** Channels this screen lists, before Live TV's filters. */
  sourceList() {
    const src = catalog.source ? catalog.source.id : '';
    if (this.mode === 'favourites') return favouritesOf(src, catalog.byKey);
    if (this.mode === 'recent') return recentOf(src, catalog.byKey);
    return catalog.channels;
  }

  /** Builds the filter from Live TV's choices and the Settings toggles. */
  currentFilter() {
    const s = getSettings();
    const f = {
      hideGeo: s.hideGeo,
      hidePartTime: s.hidePartTime,
      hideHeaders: s.hideHeaders,
      hideKeys: s.hideFailed && catalog.source ? failedKeys(catalog.source.id) : null,
    };
    if (this.mode === 'live') Object.assign(f, liveFilter);
    return f;
  }

  /**
   * Recomputes the list.
   * @param {boolean} [keep] keep the highlighted channel if still listed
   */
  reload(keep) {
    const hadFocus = this.grid.hasFocus();
    const wasEmpty = this.grid.items.length === 0;
    const keepKey = keep && this.grid.current() ? this.grid.current().k : null;
    const base = this.sourceList();
    // Favourites and Recent show everything the user picked, hidden or not.
    const list = this.mode === 'live' ? applyFilter(base, this.currentFilter()) : base.slice();
    this.grid.setItems(list, { keepKey });
    this.countEl.textContent = this.mode === 'live' && list.length !== base.length
      ? `${list.length.toLocaleString()} of ${countText(base.length)}`
      : countText(list.length);
    this.updateStatus();
    if (this.mode === 'live') {
      this.buildChips();
      const summary = filterSummary(liveFilter, false);
      this.summaryEl.textContent = summary ? `Filtered by ${summary}` : '';
      this.summaryEl.style.display = summary ? '' : 'none';
    }
    // Keep the highlight in the grid; and when the first list arrives (first
    // launch), move it there from the header.
    if (hadFocus || (wasEmpty && list.length && this.isTop() && !hasModal())) this.grid.focusDefault();
  }

  /** Shows "Updating…", the last error, or the empty-catalog message. */
  updateStatus() {
    const src = catalog.source ? catalog.source.name : '';
    // Without a playlist there is nothing to filter, update or play.
    const hasSource = !!catalog.source;
    this.toolbar.style.display = hasSource || this.mode !== 'live' ? '' : 'none';
    this.hintEl.style.display = hasSource ? '' : 'none';
    this.chipsRow.style.display = hasSource ? '' : 'none';
    this.countEl.style.display = hasSource ? '' : 'none';
    if (catalog.refreshing) {
      this.statusEl.textContent = `Updating ${src}…`;
      this.statusEl.className = 'page-status busy';
    } else if (catalog.error) {
      this.statusEl.textContent = `Couldn’t update: ${catalog.error}`;
      this.statusEl.className = 'page-status error';
    } else {
      this.statusEl.textContent = src;
      this.statusEl.className = 'page-status';
    }
    if (!catalog.source) {
      // No playlist added yet (the app ships without one). Built once so a
      // highlighted button survives later updates.
      if (!this.noSourceEl) {
        this.noSourceEl = h('div', { class: 'no-source' }, [
          h('p', null, 'No playlist yet. Prosper LG TV doesn’t come with channels: add the address of an M3U playlist you are entitled to watch, for example one from your TV or internet provider.'),
          h('div', {
            class: 'button primary focusable', 'data-autofocus': true,
            onSelect: () => openSection('sources'),
          }, [icon('plus'), 'Add a playlist']),
        ]);
      }
      if (this.grid.opts.empty !== this.noSourceEl) {
        this.grid.opts.empty = this.noSourceEl;
        this.grid.updateEmpty();
      }
    } else if (this.mode === 'live' && catalog.state === 'empty') {
      this.grid.opts.empty = catalog.refreshing
        ? 'Downloading the channel list… This takes a moment the first time.'
        : `No channel list yet. ${catalog.error ? 'Check the TV’s internet connection, then choose Update list.' : 'Choose Update list to download it.'}`;
      this.grid.updateEmpty();
    } else {
      this.grid.opts.empty = this.emptyMessage();
      this.grid.updateEmpty();
    }
  }

  /** Category chips: "All" plus the most common categories. */
  buildChips() {
    const cats = catalog.facets.categories.slice(0, MAX_CHIPS).map((c) => c[0]);
    // Keep a category picked in the Filters panel visible as a chip too.
    if (liveFilter.category && cats.indexOf(liveFilter.category) < 0) cats.unshift(liveFilter.category);
    const values = [''].concat(cats);
    const focusedValue = this.chipsTrack.contains(document.querySelector('.focused'))
      ? document.querySelector('.focused').dataset.value : null;
    this.chipsTrack.innerHTML = '';
    this.chipsTrack.__x = 0;
    this.chipsTrack.style.transform = '';
    let toFocus = null;
    for (const v of values) {
      const chip = h('div', {
        class: 'chip focusable' + (v === liveFilter.category ? ' active' : ''),
        dataset: { value: v },
        onSelect: () => this.setFilter({ category: v }),
      }, v || 'All');
      if (focusedValue !== null && focusedValue === v) toFocus = chip;
      this.chipsTrack.appendChild(chip);
    }
    if (toFocus) focus(toFocus);
  }

  setFilter(patch) {
    Object.assign(liveFilter, patch);
    this.reload(false);
  }

  openFilters() {
    openFilterPanel(liveFilter, catalog.facets, (patch) => this.setFilter(patch));
  }

  async refreshNow() {
    if (!catalog.source) return;
    try {
      const r = await refresh(catalog.source.id);
      toast(`Channel list updated: ${countText(r.count)}${r.truncated ? ' (list was too long; the rest was left out)' : ''}`);
    } catch (e) {
      toast(`Couldn’t update the list: ${e.message}`, 'error');
    }
  }

  focusDefault() {
    if (this.grid.items.length) this.grid.focusDefault();
    else focusFirst(this.grid.el) || focusFirst(this.el);
  }

  onKey(e) {
    if (this.grid.handleKeyDown(e)) return true;
    const color = colorOf(e);
    if (color === 'yellow' && this.mode === 'live') {
      this.openFilters();
      return true;
    }
    return false;
  }

  onKeyUp(e) {
    return this.grid.handleKeyUp(e);
  }

  onBack() {
    // Back with filters on clears them first, like ProsperoTV's Circle.
    if (this.mode === 'live' && (liveFilter.category || liveFilter.country || liveFilter.language || liveFilter.quality)) {
      this.setFilter({
        category: '', country: '', language: '', quality: '',
      });
      this.grid.focusIndex(0);
      toast('Filters cleared');
      return true;
    }
    if (this.mode !== 'live') {
      openSection('live');
      return true;
    }
    return false;
  }
}
