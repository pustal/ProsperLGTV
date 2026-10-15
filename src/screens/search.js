/**
 * Search: type part of a channel name, a country, language or category;
 * results appear in a channel grid below as you type.
 */
import { h, icon } from '../util/dom.js';
import { Screen } from '../ui/router.js';
import { ChannelGrid } from '../ui/channelGrid.js';
import { focus } from '../nav/focus.js';
import { KEY } from '../util/keys.js';
import { applyFilter } from '../catalog/model.js';
import { catalog, onCatalogChange } from '../catalog/catalog.js';
import { getSettings } from '../settings.js';
import { failedKeys, onUserDataChange } from '../userdata.js';
import {
  channelOptions, isFav, playChannel, toggleFav,
} from '../ui/channelActions.js';
import { openSection } from '../ui/navigate.js';

/** Last query, kept for the session. */
let lastQuery = '';

export class SearchScreen extends Screen {
  constructor() {
    super();
    this.section = 'search';
    this.el.className = 'screen channels-screen no-scroll';
    this.timer = null;
    this.unsubs = [];

    this.input = h('input', {
      class: 'field-input search-input focusable',
      type: 'search',
      placeholder: 'Channel, country, language or category',
      autocomplete: 'off',
      spellcheck: 'false',
      'data-autofocus': true,
    });
    this.input.value = lastQuery;
    this.countEl = h('span', { class: 'page-count' });
    this.grid = new ChannelGrid({
      onPlay: (list, i) => playChannel(list, i),
      onOptions: (ch, i) => channelOptions(ch, this.grid.items, i),
      onFavourite: (ch) => toggleFav(ch),
      isFavourite: (ch) => isFav(ch),
      empty: 'Type to search the channel list.',
    });

    this.el.appendChild(h('header', { class: 'page-header' }, [
      h('div', { class: 'page-heading' }, [h('h1', { class: 'page-title' }, 'Search'), this.countEl]),
    ]));
    this.el.appendChild(h('div', { class: 'search-bar' }, [icon('search', 'search-icon'), this.input]));
    this.el.appendChild(this.grid.el);

    this.input.addEventListener('input', () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.run(), 300);
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.keyCode === KEY.ENTER || e.keyCode === KEY.DOWN) {
        // OK closes the keyboard and searches now; Down goes to the results.
        e.preventDefault();
        e.stopPropagation();
        clearTimeout(this.timer);
        this.input.blur();
        this.run();
        if (this.grid.items.length) this.grid.focusIndex(0);
      }
    });
  }

  mount() {
    this.run();
    this.unsubs.push(onCatalogChange(() => this.run(true)));
    this.unsubs.push(onUserDataChange(() => this.grid.refresh()));
  }

  destroy() {
    clearTimeout(this.timer);
    for (const off of this.unsubs) off();
    this.grid.destroy();
    super.destroy();
  }

  /**
   * Runs the search.
   * @param {boolean} [keep] keep the highlighted result
   */
  run(keep) {
    const text = this.input.value.trim();
    lastQuery = this.input.value;
    const s = getSettings();
    const list = text ? applyFilter(catalog.channels, {
      text,
      hideGeo: s.hideGeo,
      hidePartTime: s.hidePartTime,
      hideHeaders: s.hideHeaders,
      hideKeys: s.hideFailed && catalog.source ? failedKeys(catalog.source.id) : null,
    }) : [];
    this.grid.opts.empty = text ? `Nothing found for “${text}”.` : 'Type to search the channel list.';
    const keepKey = keep && this.grid.current() ? this.grid.current().k : null;
    this.grid.setItems(list, { keepKey });
    this.countEl.textContent = text ? `${list.length.toLocaleString()} found` : '';
  }

  focusDefault() {
    focus(this.input);
  }

  onKey(e) {
    return this.grid.handleKeyDown(e);
  }

  onKeyUp(e) {
    return this.grid.handleKeyUp(e);
  }

  onBack() {
    openSection('live');
    return true;
  }
}
