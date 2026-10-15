/**
 * Remote-control key codes.
 *
 * LG remotes send standard DOM key codes for the D-pad and OK, plus webOS
 * specific codes for Back (461) and the media/colour keys. Keyboard
 * equivalents are mapped too so the app is usable in a desktop browser
 * during development (Escape/Backspace = Back, Space = Play/Pause).
 */
export const KEY = {
  LEFT: 37,
  UP: 38,
  RIGHT: 39,
  DOWN: 40,
  ENTER: 13,
  SPACE: 32,
  BACK: 461,
  ESC: 27,
  BACKSPACE: 8,
  PLAY: 415,
  PAUSE: 19,
  PLAY_PAUSE: 179,
  STOP: 413,
  FAST_FORWARD: 417,
  REWIND: 412,
  CHANNEL_UP: 33,
  CHANNEL_DOWN: 34,
  RED: 403,
  GREEN: 404,
  YELLOW: 405,
  BLUE: 406,
};

/** Direction names returned by {@link directionOf}. */
export const DIR = { LEFT: 'left', RIGHT: 'right', UP: 'up', DOWN: 'down' };

/**
 * Maps a keydown event to a D-pad direction.
 * @param {KeyboardEvent} e
 * @returns {'left'|'right'|'up'|'down'|null}
 */
export function directionOf(e) {
  switch (e.keyCode) {
    case KEY.LEFT: return DIR.LEFT;
    case KEY.RIGHT: return DIR.RIGHT;
    case KEY.UP: return DIR.UP;
    case KEY.DOWN: return DIR.DOWN;
    default: return null;
  }
}

/**
 * True when the event is a "go back" key. Backspace only counts when the user
 * is not typing in a text field, otherwise it would leave the screen while
 * deleting characters.
 * @param {KeyboardEvent} e
 */
export function isBack(e) {
  if (e.keyCode === KEY.BACK || e.keyCode === KEY.ESC) return true;
  if (e.keyCode === KEY.BACKSPACE) {
    const t = e.target;
    return !(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'));
  }
  return false;
}

/** True for OK / Enter. */
export function isEnter(e) {
  return e.keyCode === KEY.ENTER;
}

/**
 * Desktop stand-ins for the remote's colour buttons, so every feature can be
 * tried in a browser: R, G, Y and B (only while not typing in a field).
 */
const COLOR_ALIASES = { 82: 'red', 71: 'green', 89: 'yellow', 66: 'blue' };

/**
 * Maps a keydown event to a colour button.
 * The app uses Green for "favourite", Yellow for "filters" and Blue for
 * "stream info"; Red is left free.
 * @param {KeyboardEvent} e
 * @returns {'red'|'green'|'yellow'|'blue'|null}
 */
export function colorOf(e) {
  switch (e.keyCode) {
    case KEY.RED: return 'red';
    case KEY.GREEN: return 'green';
    case KEY.YELLOW: return 'yellow';
    case KEY.BLUE: return 'blue';
    default: break;
  }
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return null;
  return COLOR_ALIASES[e.keyCode] || null;
}
