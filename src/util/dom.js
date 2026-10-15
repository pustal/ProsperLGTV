/**
 * Tiny DOM helpers. The app deliberately avoids a UI framework: TVs have slow
 * CPUs and little RAM, and a few hundred lines of direct DOM code keeps the
 * bundle small and the frame rate predictable.
 */

/**
 * Creates an element.
 *
 * @example h('div', { class: 'card focusable', onSelect: fn }, [h('span', null, 'Hi')])
 *
 * @param {string} tag            Tag name, e.g. 'div'.
 * @param {Object|null} [attrs]   Attributes. Special keys:
 *   - `class`: className string
 *   - `style`: object of style properties
 *   - `on<Event>`: DOM event listener (e.g. `onClick`)
 *   - `onSelect`: called when the element is activated with OK or a click
 *     (see nav/focus.js)
 *   - `dataset`: object merged into element.dataset
 *   - anything else is set with setAttribute (null/false are skipped)
 * @param {Array|Node|string|number|null} [children]
 * @returns {HTMLElement}
 */
export function h(tag, attrs, children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const key of Object.keys(attrs)) {
      const val = attrs[key];
      if (val === null || val === undefined || val === false) continue;
      if (key === 'class') el.className = val;
      else if (key === 'style') Object.assign(el.style, val);
      else if (key === 'dataset') Object.assign(el.dataset, val);
      else if (key === 'onSelect') el.__onSelect = val;
      else if (key === 'onFocus') el.__onFocus = val;
      else if (key.length > 2 && key.slice(0, 2) === 'on') el.addEventListener(key.slice(2).toLowerCase(), val);
      else if (key === 'text') el.textContent = val;
      else if (key === 'html') el.innerHTML = val;
      else el.setAttribute(key, val === true ? '' : val);
    }
  }
  append(el, children);
  return el;
}

/**
 * Appends children (nested arrays, nodes, strings; null is ignored).
 * @param {Node} parent
 * @param {*} children
 */
export function append(parent, children) {
  if (children === null || children === undefined || children === false) return;
  if (Array.isArray(children)) {
    for (const c of children) append(parent, c);
  } else if (children instanceof Node) {
    parent.appendChild(children);
  } else {
    parent.appendChild(document.createTextNode(String(children)));
  }
}

/** Removes all children of an element. */
export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Inline SVG icon set (stroke icons, 24x24 viewBox, currentColor). */
const ICONS = {
  tv: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 3l4 4 4-4"/>',
  heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  heartFilled: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" fill="currentColor"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  stream: '<path d="M4 7h16M4 12h10M4 17h6"/>',
  play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  warning: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
};

/**
 * Returns an inline SVG icon element.
 * @param {keyof ICONS} name
 * @param {string} [cls] extra class names
 */
export function icon(name, cls) {
  const span = document.createElement('span');
  span.className = 'icon' + (cls ? ' ' + cls : '');
  span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + (ICONS[name] || '') + '</svg>';
  return span;
}

/**
 * The Prosper LG TV mark used in the sidebar: the same image as the launcher
 * icon (dist/icons/largeIcon.png, made by scripts/make-icons.py), so the app
 * and its icon always match.
 */
export function brandMark() {
  return h('img', { class: 'brand-mark', src: 'icons/largeIcon.png', alt: 'Prosper LG TV' });
}
