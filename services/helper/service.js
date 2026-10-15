/**
 * webOS JS service entry point: Prosper LG TV's network helper, on the luna bus
 * as luna://org.prosperlgtv.app.service/<method>.
 *
 * Methods
 * -------
 * fetchText  { url, maxBytes?, subscribe: true }
 *            Downloads a playlist from a server that doesn't send CORS
 *            headers (which a web app may not read). Answers several times:
 *              { returnValue: true, chunk: "<text>", seq: n }
 *              { returnValue: true, done: true, seq: n }
 *            or { returnValue: false, errorCode, errorText, status }.
 *            Chunks keep each luna message small.
 *
 * probe      { url, userAgent? }
 *            Reports what a stream address returns, so the app can explain a
 *            failed channel: { returnValue: true, status, type, html, drm }
 *            or { returnValue: false, errorCode, errorText }.
 *
 * The web app calls these from src/net/http.js. Nothing is written to disk.
 */
'use strict';

var Service = require('webos-service');
var pkg = require('./package.json');
var net = require('./net');

var service = new Service(pkg.name);

/** Sends an error response in the shape the web app expects. */
function fail(message, err) {
  message.respond({
    returnValue: false,
    errorCode: err.code || 'error',
    errorText: err.message || String(err),
    status: err.status || 0,
  });
}

service.register('fetchText', function (message) {
  var p = message.payload || {};
  if (!p.url) {
    message.respond({ returnValue: false, errorCode: 'params', errorText: 'An address is required.' });
    return;
  }
  // The call is a subscription (subscribe: true), which also keeps the
  // service from idling out while the download runs.
  var seq = 0;
  net.fetchText(p.url, { maxBytes: p.maxBytes }, function (chunk) {
    seq += 1;
    message.respond({ returnValue: true, chunk: chunk, seq: seq });
  }, function (err) {
    if (err) {
      fail(message, err);
      return;
    }
    seq += 1;
    message.respond({ returnValue: true, done: true, seq: seq });
  });
});

service.register('probe', function (message) {
  var p = message.payload || {};
  if (!p.url) {
    message.respond({ returnValue: false, errorCode: 'params', errorText: 'An address is required.' });
    return;
  }
  net.probe(p.url, { userAgent: p.userAgent }, function (err, result) {
    if (err) {
      fail(message, err);
      return;
    }
    result.returnValue = true;
    message.respond(result);
  });
});
