/**
 * Virtualised channel grid.
 *
 * A channel list can hold 10,000+ channels; creating a DOM node for each
 * would exhaust a TV's RAM and make every focus move slow. This grid keeps
 * only the rows on screen (plus one above and below) in the DOM and moves
 * the highlight itself, by index, instead of through the spatial focus
 * engine. It hands control back to the engine at its edges: Up from the
 * first row (to the chips above) and Left from the first column (to the
 * sidebar).
 *
 * Keys handled while a tile is highlighted:
 *   arrows          move
 *   CH+/CH-         page up/down (PageUp/PageDown on a keyboard)
 *   OK (short)      play
 *   OK (held)       options menu
 *   Green           add/remove favourite
 * Magic Remote: pointing highlights, clicking plays, the wheel scrolls.
 */
import { h } from '../util/dom.js';
import { focus, getFocused } from '../nav/focus.js';
import { KEY, colorOf, directionOf } from '../util/keys.js';
import { bindLogo } from '../cache/logoCache.js';

/** Columns at 1920×1080 (the layout scales with the screen). */
const COLUMNS = 6;
/** Hold OK this long (ms) for the options menu. */
const LONG_PRESS_MS = 650;

/**
 * Up to two initials for the placeholder shown until (or instead of) a logo.
 * Uses the first letters of the first two words, keeping non-Latin scripts.
 * @param {string} name
 */
export function initials(name) {
  // (Unicode property escapes need Chromium 64, so punctuation is listed.)
  const words = (name || '?').replace(/[()[\]{}.,:;!?'"«»\-_+&/\\|#*@~^=<>]/g, ' ').trim().split(/\s+/);
  const first = words[0] ? Array.from(words[0])[0] : '?';
  const second = words[1] ? Array.from(words[1])[0] : '';
  return (first + second).toUpperCase();
}

/** Short quality label from a picture height ("1080p"). */
export function qualityLabel(height) {
  if (!height) return '';
  if (height >= 2160) return '4K';
  return `${height}p`;
}

export class ChannelGrid {
  /**
   * @param {Object} opts
   * @param {(list: Object[], index: number) => void} opts.onPlay
   * @param {(ch: Object, index: number) => void} [opts.onOptions]  OK held
   * @param {(ch: Object) => void} [opts.onFavourite]  Green pressed
   * @param {(ch: Object) => boolean} [opts.isFavourite]
   * @param {string|HTMLElement} [opts.empty]  shown when the list is empty
   */
  constructor(opts) {
    this.opts = opts;
    /** @type {Object[]} */
    this.items = [];
    /** Index of the highlighted channel. */
    this.index = 0;
    /** First row scrolled into view. */
    this.firstRow = 0;
    /** index → tile element currently in the DOM. */
    this.tiles = new Map();
    this.metrics = null;
    this.pressTimer = null;
    this.pressIndex = -1;

    this.inner = h('div', { class: 'grid-inner' });
    this.emptyEl = h('div', { class: 'grid-empty' });
    this.el = h('div', { class: 'grid-viewport nav-group' }, [this.inner, this.emptyEl]);
    this.el.addEventListener('wheel', (e) => this.onWheel(e), { passive: true });
    this.onResize = () => {
      this.metrics = null;
      this.render();
    };
    window.addEventListener('resize', this.onResize);
  }

  /** Stops listening for window events (call from the screen's destroy). */
  destroy() {
    window.removeEventListener('resize', this.onResize);
    clearTimeout(this.pressTimer);
  }

  /**
   * Replaces the channels shown.
   * @param {Object[]} items
   * @param {{keepKey?: string}} [opts] keep the highlight on this channel if present
   */
  setItems(items, opts) {
    const keepKey = opts && opts.keepKey;
    this.items = items;
    let index = 0;
    if (keepKey) {
      const i = items.findIndex((ch) => ch.k === keepKey);
      if (i >= 0) index = i;
    }
    this.index = Math.min(index, Math.max(0, items.length - 1));
    for (const t of this.tiles.values()) t.remove();
    this.tiles.clear();
    this.firstRow = 0;
    this.metrics = null;
    this.render();
    this.scrollToIndex(this.index, false);
    this.updateEmpty();
  }

  updateEmpty() {
    const empty = this.items.length === 0;
    this.emptyEl.style.display = empty ? '' : 'none';
    if (empty) {
      const msg = this.opts.empty;
      this.emptyEl.innerHTML = '';
      if (msg instanceof Node) this.emptyEl.appendChild(msg);
      else this.emptyEl.textContent = msg || 'Nothing here.';
    }
  }

  /** The highlighted channel, or null. */
  current() {
    return this.items[this.index] || null;
  }

  /** True when the highlight is on one of this grid's tiles. */
  hasFocus() {
    const f = getFocused();
    return !!f && this.el.contains(f);
  }

  // -------------------------------------------------------------------------
  // Geometry
  // -------------------------------------------------------------------------

  /** Measures the viewport and derives tile sizes (px). */
  measure() {
    if (this.metrics && this.metrics.width > 0) return this.metrics;
    // clientWidth/Height include the padding that leaves room for the
    // highlight ring; tiles are laid out inside it.
    const cs = window.getComputedStyle(this.el);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const width = this.el.clientWidth - padX;
    const height = this.el.clientHeight - padY;
    const rem = window.innerWidth / 120; // matches html { font-size } in app.css
    const gap = 1.25 * rem;
    const tileW = (width - gap * (COLUMNS - 1)) / COLUMNS;
    const plateH = tileW * 0.5625;
    const tileH = plateH + 4.6 * rem; // plate + name + badge line
    const rowH = tileH + gap;
    const visibleRows = Math.max(1, Math.floor((height + gap) / rowH));
    this.metrics = {
      width, height, gap, tileW, tileH, rowH, plateH, visibleRows,
    };
    return this.metrics;
  }

  rows() {
    return Math.ceil(this.items.length / COLUMNS);
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  /** Builds one tile. */
  buildTile(ch, i) {
    const m = this.metrics;
    const img = h('img', { class: 'tile-logo', alt: '' });
    const plate = h('div', { class: 'tile-plate', style: { height: `${m.plateH}px` } }, [
      h('span', { class: 'tile-initials' }, initials(ch.n)),
      img,
    ]);
    const badges = [];
    const q = qualityLabel(ch.q);
    if (q) badges.push(h('span', { class: 'badge' }, q));
    if (ch.g) badges.push(h('span', { class: 'badge warn' }, 'Geo'));
    if (ch.$h) badges.push(h('span', { class: 'badge warn' }, 'Headers'));
    if (ch.p) badges.push(h('span', { class: 'badge' }, 'Part-time'));
    if (ch.s && ch.s.length > 1) badges.push(h('span', { class: 'badge' }, `${ch.s.length} streams`));
    // Three fit on a tile; the rest are in Channel details.
    badges.length = Math.min(badges.length, 3);
    const fav = this.opts.isFavourite && this.opts.isFavourite(ch);
    const tile = h('div', {
      class: 'tile focusable' + (fav ? ' fav' : ''),
      dataset: { i: String(i) },
      style: {
        width: `${m.tileW}px`,
        height: `${m.tileH}px`,
        left: `${(i % COLUMNS) * (m.tileW + m.gap)}px`,
        top: `${Math.floor(i / COLUMNS) * m.rowH}px`,
      },
      onSelect: () => this.opts.onPlay(this.items, i),
      onFocus: () => {
        this.index = i;
        this.scrollToIndex(i, true);
      },
    }, [
      plate,
      h('div', { class: 'tile-name' }, ch.n),
      h('div', { class: 'tile-meta' }, [h('span', { class: 'tile-fav' }, '♥')].concat(badges)),
    ]);
    bindLogo(img, ch.l);
    return tile;
  }

  /** Adds tiles that came into range and removes those that left it. */
  render() {
    if (!this.el.parentNode) return;
    const m = this.measure();
    if (m.width <= 0) return;
    const rows = this.rows();
    this.inner.style.height = `${rows * m.rowH}px`;
    const from = Math.max(0, (this.firstRow - 1) * COLUMNS);
    const to = Math.min(this.items.length, (this.firstRow + m.visibleRows + 2) * COLUMNS);
    for (const [i, t] of this.tiles) {
      if (i < from || i >= to) {
        t.remove();
        this.tiles.delete(i);
      }
    }
    for (let i = from; i < to; i += 1) {
      if (!this.tiles.has(i)) {
        const t = this.buildTile(this.items[i], i);
        this.tiles.set(i, t);
        this.inner.appendChild(t);
      }
    }
    this.inner.style.transform = `translate3d(0,${-this.firstRow * m.rowH}px,0)`;
  }

  /** Re-renders the visible tiles (e.g. after favourites changed). */
  refresh() {
    const focusedIndex = this.hasFocus() ? this.index : -1;
    for (const t of this.tiles.values()) t.remove();
    this.tiles.clear();
    this.render();
    if (focusedIndex >= 0) this.focusIndex(focusedIndex);
  }

  /**
   * Scrolls so the row of `i` is fully visible.
   * @param {number} i
   * @param {boolean} [renderNow] re-render if the scroll position changed
   */
  scrollToIndex(i, renderNow) {
    const m = this.measure();
    if (m.width <= 0) return;
    const row = Math.floor(i / COLUMNS);
    let first = this.firstRow;
    if (row < first) first = row;
    else if (row > first + m.visibleRows - 1) first = row - m.visibleRows + 1;
    first = Math.max(0, Math.min(first, Math.max(0, this.rows() - m.visibleRows)));
    if (first !== this.firstRow) {
      this.firstRow = first;
      if (renderNow !== false) this.render();
    }
  }

  /** Highlights the tile at `i`, scrolling and rendering as needed. */
  focusIndex(i) {
    if (!this.items.length) return false;
    const idx = Math.max(0, Math.min(i, this.items.length - 1));
    this.index = idx;
    this.scrollToIndex(idx, true);
    this.render();
    const tile = this.tiles.get(idx);
    if (tile) focus(tile, { scroll: false });
    return !!tile;
  }

  /** Highlights the remembered tile (used when the screen shows). */
  focusDefault() {
    return this.focusIndex(this.index);
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  /**
   * Handles a keydown while a tile is highlighted.
   * @param {KeyboardEvent} e
   * @returns {boolean} true when handled
   */
  handleKeyDown(e) {
    if (!this.hasFocus() || !this.items.length) return false;
    const col = this.index % COLUMNS;
    const n = this.items.length;
    const dir = directionOf(e);
    if (dir) {
      if (dir === 'left') {
        if (col === 0) return false; // to the sidebar
        this.focusIndex(this.index - 1);
        return true;
      }
      if (dir === 'right') {
        if (col < COLUMNS - 1 && this.index + 1 < n) this.focusIndex(this.index + 1);
        return true;
      }
      if (dir === 'up') {
        if (this.index < COLUMNS) return false; // to the chips above
        this.focusIndex(this.index - COLUMNS);
        return true;
      }
      // down
      const next = this.index + COLUMNS;
      if (next < n) this.focusIndex(next);
      else if (Math.floor(this.index / COLUMNS) < this.rows() - 1) this.focusIndex(n - 1);
      return true;
    }
    if (e.keyCode === KEY.CHANNEL_UP || e.keyCode === KEY.CHANNEL_DOWN) {
      const page = this.measure().visibleRows * COLUMNS;
      this.focusIndex(this.index + (e.keyCode === KEY.CHANNEL_DOWN ? page : -page));
      return true;
    }
    if (e.keyCode === KEY.ENTER) {
      // Short press plays (on key up); held, it opens the options menu.
      if (!e.repeat && this.pressIndex < 0) {
        this.pressIndex = this.index;
        clearTimeout(this.pressTimer);
        this.pressTimer = setTimeout(() => {
          const i = this.pressIndex;
          this.pressIndex = -1;
          if (i >= 0 && this.opts.onOptions) this.opts.onOptions(this.items[i], i);
        }, LONG_PRESS_MS);
      }
      return true;
    }
    if (colorOf(e) === 'green' && this.opts.onFavourite) {
      this.opts.onFavourite(this.items[this.index]);
      return true;
    }
    return false;
  }

  /**
   * Handles a keyup (finishes a short OK press).
   * @param {KeyboardEvent} e
   * @returns {boolean}
   */
  handleKeyUp(e) {
    if (e.keyCode !== KEY.ENTER || this.pressIndex < 0) return false;
    clearTimeout(this.pressTimer);
    const i = this.pressIndex;
    this.pressIndex = -1;
    this.opts.onPlay(this.items, i);
    return true;
  }

  /** Magic Remote wheel: scroll a row per notch, moving the highlight along. */
  onWheel(e) {
    if (!this.items.length) return;
    const step = e.deltaY > 0 ? COLUMNS : -COLUMNS;
    const target = this.index + step;
    if (target < 0 || target >= this.items.length) return;
    this.focusIndex(target);
  }
}
