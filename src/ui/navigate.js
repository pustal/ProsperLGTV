/**
 * Indirection between screens: any screen can open "the detail screen for
 * this item" without importing every other screen (which would create
 * import cycles). main.js registers the factories at startup.
 */

/** @type {Record<string, (item: Object, extra?: Object) => import('./router.js').Screen>} */
const factories = {};
/** @type {import('./router.js').Router|null} */
let router = null;

/** Registers screen factories and the router. */
export function registerNavigation(r, f) {
  router = r;
  Object.assign(factories, f);
}

/**
 * Opens the detail screen for an item.
 * @param {'scene'|'performer'|'studio'|'tag'|'player'|'gallery'|'group'|'image'} kind
 * @param {Object} item
 * @param {Object} [extra] screen-specific options (e.g. start time)
 */
export function openItem(kind, item, extra) {
  const make = factories[kind];
  if (!make || !router) return;
  router.push(make(item, extra));
}

/** Opens a top-level section (sidebar), resetting the stack. */
export function openSection(name) {
  const make = factories[`section:${name}`];
  if (!make || !router) return;
  router.reset(make());
}

/**
 * Goes back one screen, e.g. after the item on screen was deleted. The
 * screen it returns to reloads its list when it can (`reload()`), so the
 * deleted item disappears from it.
 */
export function goBack() {
  if (!router) return;
  router.back();
  const top = router.top;
  if (top && typeof top.reload === 'function') top.reload();
}
