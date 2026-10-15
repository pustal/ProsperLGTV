/**
 * Spatial navigation for the TV remote.
 *
 * Every navigable element carries the `focusable` class. Arrow keys move the
 * highlight to the nearest focusable element in that direction, measured
 * from on-screen rectangles. The highlight is a CSS class (`focused`), not
 * DOM focus, so it never triggers the browser's own scrolling; DOM focus is
 * only given to text inputs while the user is typing.
 *
 * Concepts
 * - Layers: modal dialogs push a layer; only elements inside the top layer
 *   can be reached, and popping restores the previous highlight.
 * - Groups (`nav-group` class): remember their last highlighted child. When
 *   the highlight enters a group from outside it lands on that child, so
 *   moving down into a row returns to where you left it.
 * - Scrolling: horizontal rows (`row-track`) slide with a CSS transform;
 *   vertical scrolling is done on the window, using the `data-scroll` hints
 *   of the screen (see {@link ensureVisible}).
 * - Zones (`nav-zone` class): Up/Down stay inside the current zone, so the
 *   sidebar and the content area are only crossed with Left/Right. Within
 *   a zone, Left/Right only reach elements on the same line.
 * - Up/Down go to the nearest row first, then the best-aligned element in it.
 * - `__onSelect` (set via h(..., { onSelect })) runs on OK / click.
 * - `__onFocus` runs whenever the element gains the highlight.
 */

/** Stack of layer root elements; index 0 is the app root. */
const layers = [];
/** Highlight to restore when each layer above is popped. */
const savedFocus = [];
/** @type {HTMLElement|null} */
let current = null;
/** Counts user navigation (moves and selections); see {@link userActions}. */
let actionCount = 0;

/**
 * Number of navigation actions the user has taken so far. Screens that load
 * asynchronously compare it before/after loading to decide whether they may
 * still move the highlight (they must not if the user already moved it).
 */
export function userActions() {
  return actionCount;
}
const focusListeners = [];

/** Sets the base layer (the app root). */
export function initFocus(root) {
  layers.length = 0;
  layers.push(root);
  document.addEventListener('mouseover', onPointerOver);
  document.addEventListener('click', onPointerClick);
}

/** The element that currently has the highlight. */
export function getFocused() {
  return current;
}

/** Subscribes to highlight changes. */
export function onFocusChange(fn) {
  focusListeners.push(fn);
}

/** Pushes a modal layer; returns a function that pops it. */
export function pushLayer(root) {
  savedFocus.push(current);
  layers.push(root);
  focusFirst(root);
  return () => popLayer(root);
}

/** Pops a modal layer and restores the previous highlight. */
export function popLayer(root) {
  const i = layers.lastIndexOf(root);
  if (i <= 0) return;
  layers.splice(i, 1);
  const prev = savedFocus.splice(i - 1, 1)[0];
  if (prev && isUsable(prev)) focus(prev);
}

function topLayer() {
  return layers[layers.length - 1];
}

/** True when the element is attached, visible and not disabled. */
function isUsable(el) {
  if (!el || !document.documentElement.contains(el)) return false;
  if (el.classList.contains('disabled')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** All reachable focusables in the top layer. */
function candidates() {
  const list = topLayer().querySelectorAll('.focusable');
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    if (isUsable(list[i])) out.push(list[i]);
  }
  return out;
}

/**
 * Highlights an element.
 * @param {HTMLElement} el
 * @param {{scroll?: boolean}} [opts] scroll=false when the pointer did it
 */
export function focus(el, opts) {
  if (!el) return;
  const scroll = !opts || opts.scroll !== false;
  if (current && current !== el) {
    current.classList.remove('focused');
    if (document.activeElement === current) current.blur();
  }
  current = el;
  el.classList.add('focused');

  // Remember this element in every enclosing group.
  let p = el.parentElement;
  while (p) {
    if (p.classList && p.classList.contains('nav-group')) p.__last = el;
    p = p.parentElement;
  }
  if (scroll) ensureVisible(el);
  if (el.__onFocus) el.__onFocus(el);
  for (const fn of focusListeners) fn(el);
}

/**
 * Highlights the preferred element inside a container: an element marked
 * `data-autofocus`, else the group's remembered child, else the first one.
 * @returns {boolean} whether something was focused
 */
export function focusFirst(container) {
  const root = container || topLayer();
  if (root.__last && isUsable(root.__last)) {
    focus(root.__last);
    return true;
  }
  const preferred = root.querySelector('.focusable[data-autofocus]');
  if (preferred && isUsable(preferred)) {
    focus(preferred);
    return true;
  }
  const list = root.querySelectorAll('.focusable');
  for (let i = 0; i < list.length; i += 1) {
    if (isUsable(list[i])) {
      focus(list[i]);
      return true;
    }
  }
  return false;
}

/** Centre point and edges of an element. */
function box(el) {
  const r = el.getBoundingClientRect();
  return {
    left: r.left, right: r.right, top: r.top, bottom: r.bottom,
    cx: r.left + r.width / 2, cy: r.top + r.height / 2,
  };
}

/**
 * Scores a candidate for a move; lower is better, Infinity = not in that direction.
 * Distance along the move counts once, misalignment across it counts double,
 * so the highlight prefers to travel in straight lines.
 */
function score(from, to, dir) {
  let primary;
  let gapAcross;
  if (dir === 'right' || dir === 'left') {
    const forward = dir === 'right' ? to.cx - from.cx : from.cx - to.cx;
    if (forward <= 1) return Infinity;
    primary = dir === 'right' ? Math.max(0, to.left - from.right) : Math.max(0, from.left - to.right);
    gapAcross = Math.max(0, Math.max(from.top, to.top) - Math.min(from.bottom, to.bottom));
    return primary + gapAcross * 2 + Math.abs(to.cy - from.cy) * 0.3;
  }
  const forward = dir === 'down' ? to.cy - from.cy : from.cy - to.cy;
  if (forward <= 1) return Infinity;
  primary = dir === 'down' ? Math.max(0, to.top - from.bottom) : Math.max(0, from.top - to.bottom);
  gapAcross = Math.max(0, Math.max(from.left, to.left) - Math.min(from.right, to.right));
  return primary + gapAcross * 2 + Math.abs(to.cx - from.cx) * 0.3;
}

/** Distance (px) between rows that still counts as "the same row". */
const ROW_TOLERANCE = 24;

/** Vertical overlap (px) of two boxes; <= 0 when they don't share a line. */
function overlapY(a, b) {
  return Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
}

/** Empty space between two boxes along the direction of travel. */
function edgeGap(from, to, dir) {
  switch (dir) {
    case 'down': return Math.max(0, to.top - from.bottom);
    case 'up': return Math.max(0, from.top - to.bottom);
    case 'right': return Math.max(0, to.left - from.right);
    default: return Math.max(0, from.left - to.right);
  }
}

/** Innermost nav-group of `el` that does not contain `from`. */
function enteredGroup(el, from) {
  let p = el.parentElement;
  let found = null;
  while (p && p !== topLayer().parentElement) {
    if (p.classList && p.classList.contains('nav-group')) {
      if (from && p.contains(from)) break;
      found = p;
    }
    p = p.parentElement;
  }
  return found;
}

/**
 * Moves the highlight in a direction.
 * @param {'left'|'right'|'up'|'down'} dir
 * @returns {boolean} false when there is nothing in that direction
 */
export function move(dir) {
  actionCount += 1;
  if (!current || !isUsable(current) || !topLayer().contains(current)) {
    return focusFirst();
  }
  const from = box(current);
  // Up/Down never leave the current zone (e.g. from the content into the
  // sidebar); only Left/Right cross between zones.
  const currentZone = current.closest('.nav-zone');
  const zone = dir === 'up' || dir === 'down' ? currentZone : null;
  const scored = [];
  for (const el of candidates()) {
    if (el === current) continue;
    if (zone && !zone.contains(el)) continue;
    const to = box(el);
    // Left/Right stay on the same line within a zone: a one-card row must
    // not jump into the next row. Crossing into another zone (the sidebar)
    // is allowed from any height.
    if ((dir === 'left' || dir === 'right') && overlapY(from, to) <= 0 && currentZone && currentZone.contains(el)) continue;
    const s = score(from, to, dir);
    if (s !== Infinity) scored.push({ el, s, gap: edgeGap(from, to, dir) });
  }
  if (!scored.length) return false;

  // Up/Down: only consider the nearest row first, then pick the best aligned
  // element in it. Without this, a far-away element that happens to be in
  // line wins over the row right below (e.g. a button in a header column
  // skipping a left-aligned chip row).
  let pool = scored;
  if (dir === 'up' || dir === 'down') {
    let minGap = Infinity;
    for (const c of scored) minGap = Math.min(minGap, c.gap);
    pool = scored.filter((c) => c.gap <= minGap + ROW_TOLERANCE);
  }
  let best = null;
  let bestScore = Infinity;
  for (const c of pool) {
    if (c.s < bestScore) {
      bestScore = c.s;
      best = c.el;
    }
  }
  if (!best) return false;

  // Entering a group: go back to the child it remembers, if still there.
  const group = enteredGroup(best, current);
  if (group && group.__last && group.__last !== best && isUsable(group.__last) && !group.hasAttribute('data-no-memory')) {
    best = group.__last;
  }
  focus(best);
  return true;
}

/** Activates the highlighted element (OK button). */
export function select() {
  actionCount += 1;
  const el = current;
  if (!el) return false;
  if (el.tagName === 'INPUT') {
    el.focus(); // opens the TV's on-screen keyboard
    return true;
  }
  if (el.__onSelect) {
    el.__onSelect(el);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Scrolling
// ---------------------------------------------------------------------------

/**
 * Brings the highlighted element into view.
 *
 * - Inside a `.row-track`, the track slides so the element sits at the row's
 *   left edge (the row never slides past its last card).
 * - Vertically, the nearest ancestor with `data-scroll="align"` is scrolled so
 *   its top lines up with the screen's `data-scroll-top` offset (fraction of
 *   the viewport height, default 0.12); `data-scroll="nearest"` (the default)
 *   only scrolls when the element is outside the visible band.
 */
export function ensureVisible(el) {
  const track = el.closest('.row-track');
  if (track) {
    const viewport = track.parentElement;
    const maxShift = Math.max(0, track.scrollWidth - viewport.clientWidth);
    const x = Math.min(maxShift, Math.max(0, el.offsetLeft - (track.__pad || 0)));
    if (track.__x !== x) {
      track.__x = x;
      track.style.transform = `translate3d(${-x}px,0,0)`;
    }
  }

  // Scrollable lists inside dialogs (`scroll-y`): keep the item in view.
  const list = el.closest('.scroll-y');
  if (list) {
    const top = el.offsetTop - list.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + el.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top + el.offsetHeight - list.clientHeight;
    }
  }

  // Fixed-position layers (dialogs, player overlay) never scroll the page.
  if (el.closest('.no-scroll')) return;

  const screenEl = el.closest('[data-scroll-top]');
  const vh = window.innerHeight;
  const topOffset = vh * (screenEl ? parseFloat(screenEl.getAttribute('data-scroll-top')) : 0.12);
  const anchor = el.closest('[data-scroll="align"]');
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    window.scrollTo(0, Math.max(0, window.pageYOffset + r.top - topOffset));
    return;
  }
  const r = el.getBoundingClientRect();
  const bottomLimit = vh - vh * 0.06;
  if (r.top < topOffset) {
    window.scrollTo(0, Math.max(0, window.pageYOffset + r.top - topOffset));
  } else if (r.bottom > bottomLimit) {
    window.scrollTo(0, window.pageYOffset + (r.bottom - bottomLimit));
  }
}

// ---------------------------------------------------------------------------
// Magic Remote / mouse pointer
// ---------------------------------------------------------------------------

function onPointerOver(e) {
  const el = e.target.closest ? e.target.closest('.focusable') : null;
  if (el && el !== current && topLayer().contains(el) && isUsable(el)) focus(el, { scroll: false });
}

function onPointerClick(e) {
  const el = e.target.closest ? e.target.closest('.focusable') : null;
  if (!el || !topLayer().contains(el)) return;
  focus(el, { scroll: false });
  select();
}
