/**
 * Left navigation rail. Collapsed to icons; widens to show labels while the
 * highlight is inside it.
 */
import { brandMark, h, icon } from '../util/dom.js';
import { onFocusChange } from '../nav/focus.js';
import { openSection } from './navigate.js';

const SECTIONS = [
  { id: 'live', label: 'Live TV', icon: 'tv' },
  { id: 'favourites', label: 'Favourites', icon: 'heart' },
  { id: 'recent', label: 'Recent', icon: 'clock' },
  { id: 'search', label: 'Search', icon: 'search' },
  { id: 'sources', label: 'Sources', icon: 'list' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export class Sidebar {
  constructor() {
    this.items = {};
    const list = SECTIONS.map((s) => {
      const item = h('div', {
        class: 'nav-item focusable',
        dataset: { section: s.id },
        onSelect: () => openSection(s.id),
      }, [icon(s.icon), h('span', { class: 'nav-label' }, s.label)]);
      this.items[s.id] = item;
      return item;
    });
    this.el = h('nav', { class: 'sidebar nav-group nav-zone no-scroll' }, [
      h('div', { class: 'brand' }, [brandMark(), h('span', { class: 'brand-word' }, 'Prosper LG TV')]),
      h('div', { class: 'nav-list' }, list),
    ]);
    onFocusChange((el) => {
      this.el.classList.toggle('expanded', this.el.contains(el));
    });
  }

  /** Marks a section as active; entering the rail lands on it. */
  setActive(sectionId) {
    for (const id of Object.keys(this.items)) {
      this.items[id].classList.toggle('active', id === sectionId);
    }
    if (this.items[sectionId]) this.el.__last = this.items[sectionId];
  }

  /** Shows or hides the rail (hidden in the player). */
  setVisible(visible) {
    this.el.style.display = visible ? '' : 'none';
    document.body.classList.toggle('no-sidebar', !visible);
  }
}
