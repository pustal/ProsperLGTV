/**
 * Small polyfills for the oldest supported engine (Chromium 53, webOS 4.x).
 *
 * esbuild lowers *syntax* (async/await, spread, optional chaining) but does
 * not add missing *library* functions, so the few we use are patched here.
 * Each one is only installed when the browser lacks it.
 */

if (!Object.entries) {
  Object.entries = (obj) => Object.keys(obj).map((k) => [k, obj[k]]);
}

if (!Object.values) {
  Object.values = (obj) => Object.keys(obj).map((k) => obj[k]);
}

if (!String.prototype.padStart) {
  // eslint-disable-next-line no-extend-native
  String.prototype.padStart = function padStart(len, fill) {
    let s = String(this);
    const f = fill === undefined ? ' ' : String(fill);
    while (s.length < len) s = f + s;
    return s.slice(-len);
  };
}

if (typeof Promise !== 'undefined' && !Promise.prototype.finally) {
  // eslint-disable-next-line no-extend-native
  Promise.prototype.finally = function promiseFinally(fn) {
    return this.then(
      (v) => Promise.resolve(fn()).then(() => v),
      (e) => Promise.resolve(fn()).then(() => { throw e; }),
    );
  };
}
