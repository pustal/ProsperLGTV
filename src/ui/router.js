/**
 * Screen stack.
 *
 * Screens are kept alive while covered (hidden with display:none) so going
 * back is instant and restores the highlight and scroll position. To bound
 * memory on the TV, the stack is capped; the oldest screens above the
 * section root are destroyed first.
 */
import { focus, focusFirst, getFocused } from '../nav/focus.js';
import { releaseLogos } from '../cache/logoCache.js';

/** Max screens alive at once (section root + 5 levels of drill-down). */
const MAX_DEPTH = 6;

/**
 * Base class for screens. Subclasses build `this.el` in their constructor
 * and override the hooks they need.
 */
export class Screen {
  constructor() {
    /** Root element of the screen. */
    this.el = document.createElement('div');
    this.el.className = 'screen';
    /** Sidebar section this screen belongs to (highlights the nav item). */
    this.section = null;
    /** Hide the sidebar (player, setup). */
    this.fullscreen = false;
    /** @type {Router|null} set by the router */
    this.router = null;
  }

  /** Called once after the element is attached. Load data here. */
  mount() {}

  /** True while this screen is the visible one. */
  isTop() {
    return !!this.router && this.router.top === this;
  }

  /** Called when the screen becomes the top of the stack. */
  onShow() {}

  /** Called when another screen covers this one, or before destroy. */
  onHide() {}

  /**
   * Handles a key before default navigation.
   * @param {KeyboardEvent} e
   * @returns {boolean} true when handled
   */
  onKey(e) { // eslint-disable-line no-unused-vars
    return false;
  }

  /** Called when Back is pressed; return true to stay (e.g. close a panel). */
  onBack() {
    return false;
  }

  /** Puts the highlight on the screen's main element. */
  focusDefault() {
    focusFirst(this.el);
  }

  /** Frees resources. */
  destroy() {
    releaseLogos(this.el);
    if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
  }
}

export class Router {
  /**
   * @param {HTMLElement} container  element screens are appended to
   * @param {{onChange?: (screen: Screen) => void}} [hooks]
   */
  constructor(container, hooks) {
    this.container = container;
    this.hooks = hooks || {};
    /** @type {Array<{screen: Screen, focus: HTMLElement|null, scrollY: number}>} */
    this.stack = [];
  }

  /** The visible screen. */
  get top() {
    const e = this.stack[this.stack.length - 1];
    return e ? e.screen : null;
  }

  /** Opens a screen on top of the current one. */
  push(screen) {
    this.coverTop();
    this.stack.push({ screen, focus: null, scrollY: 0 });
    // Trim: keep the section root (index 0) and the newest screens.
    while (this.stack.length > MAX_DEPTH) {
      const dropped = this.stack.splice(1, 1)[0];
      dropped.screen.onHide();
      dropped.screen.destroy();
    }
    this.attach(screen);
  }

  /**
   * Swaps the top screen for another without going back (e.g. the player
   * moving on to the next scene in a queue).
   */
  replaceTop(screen) {
    const e = this.stack.pop();
    if (e) {
      e.screen.onHide();
      e.screen.destroy();
    }
    this.stack.push({ screen, focus: null, scrollY: 0 });
    this.attach(screen);
  }

  /** Replaces the whole stack with a single screen (sidebar sections). */
  reset(screen) {
    while (this.stack.length) {
      const e = this.stack.pop();
      e.screen.onHide();
      e.screen.destroy();
    }
    this.stack.push({ screen, focus: null, scrollY: 0 });
    this.attach(screen);
  }

  /**
   * Goes back one screen.
   * @returns {boolean} false when already at the root
   */
  back() {
    if (this.stack.length <= 1) return false;
    const e = this.stack.pop();
    e.screen.onHide();
    e.screen.destroy();
    const prev = this.stack[this.stack.length - 1];
    prev.screen.el.style.display = '';
    window.scrollTo(0, prev.scrollY);
    if (prev.focus && document.documentElement.contains(prev.focus)) focus(prev.focus, { scroll: false });
    else prev.screen.focusDefault();
    prev.screen.onShow();
    if (this.hooks.onChange) this.hooks.onChange(prev.screen);
    return true;
  }

  /** Hides the current top screen, remembering highlight and scroll. */
  coverTop() {
    const e = this.stack[this.stack.length - 1];
    if (!e) return;
    e.focus = getFocused();
    e.scrollY = window.pageYOffset;
    e.screen.onHide();
    e.screen.el.style.display = 'none';
  }

  attach(screen) {
    screen.router = this;
    this.container.appendChild(screen.el);
    window.scrollTo(0, 0);
    if (this.hooks.onChange) this.hooks.onChange(screen);
    screen.mount();
    screen.focusDefault();
    screen.onShow();
  }
}
