/**
 * Calls to Prosper LG TV's bundled webOS JS service (services/helper) over the
 * luna bus.
 *
 * The service exists for two jobs a web app can't do itself:
 * - downloading playlists from servers that don't send CORS headers
 *   (browsers refuse to let a web page read those; Node on the TV can);
 * - checking why a stream failed (HTTP status, content type, DRM markers),
 *   since the TV's <video> element only reports a generic error.
 *
 * In a desktop browser there is no luna bus; callers fall back to direct
 * requests and less detailed messages.
 */

export const SERVICE_ID = 'org.prosperlgtv.app.service';

/** True when running on webOS (the luna bus is available). */
export function hasLunaBus() {
  return typeof window !== 'undefined' && typeof window.PalmServiceBridge !== 'undefined';
}

/** Bridges kept alive until their call finishes, or they can be collected. */
const live = new Set();

/**
 * Calls a service method and resolves with its single response.
 * @param {string} method  e.g. 'probe'
 * @param {Object} params
 * @param {number} [timeoutMs]
 * @returns {Promise<Object>}
 */
export function lunaCall(method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    const bridge = new window.PalmServiceBridge();
    live.add(bridge);
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      live.delete(bridge);
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error('The helper service did not answer.')), timeoutMs || 30000);
    bridge.onservicecallback = (msg) => {
      try {
        finish(resolve, JSON.parse(msg));
      } catch (e) {
        finish(reject, new Error('The helper service gave an unreadable answer.'));
      }
    };
    bridge.call(`luna://${SERVICE_ID}/${method}`, JSON.stringify(params));
  });
}

/**
 * Calls a subscription method that answers several times. `onMessage` gets
 * every response; return true from it when the last one has arrived.
 * @param {string} method
 * @param {Object} params  `subscribe: true` is added
 * @param {(msg: Object) => boolean} onMessage
 * @param {number} [idleTimeoutMs] fail when nothing arrives for this long
 * @returns {Promise<void>}
 */
export function lunaSubscribe(method, params, onMessage, idleTimeoutMs) {
  return new Promise((resolve, reject) => {
    const bridge = new window.PalmServiceBridge();
    live.add(bridge);
    let settled = false;
    let timer = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      live.delete(bridge);
      try {
        bridge.cancel();
      } catch (e) { /* older bridges have no cancel */ }
      fn(value);
    };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(reject, new Error('The helper service stopped answering.')), idleTimeoutMs || 45000);
    };
    arm();
    bridge.onservicecallback = (msg) => {
      arm();
      let res;
      try {
        res = JSON.parse(msg);
      } catch (e) {
        finish(reject, new Error('The helper service gave an unreadable answer.'));
        return;
      }
      if (res.returnValue === false) {
        const err = new Error(res.errorText || 'The helper service failed.');
        err.code = res.errorCode;
        err.status = res.status || 0;
        finish(reject, err);
        return;
      }
      try {
        if (onMessage(res)) finish(resolve);
      } catch (e) {
        finish(reject, e);
      }
    };
    bridge.call(`luna://${SERVICE_ID}/${method}`, JSON.stringify(Object.assign({ subscribe: true }, params)));
  });
}
