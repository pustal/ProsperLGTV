/**
 * HTTP(S) helpers for the Prosper LG TV service. Runs in Node.js on the TV, not
 * in the web app.
 *
 * Written for old Node versions (webOS 4 ships Node 8): callbacks, no fetch,
 * no async/await, no optional chaining.
 *
 * Nothing here is written to disk: downloads are kept in memory and handed
 * to the web app, which stores the parsed result in its own bounded cache.
 */
'use strict';

var http = require('http');
var https = require('https');
var urlLib = require('url');
var zlib = require('zlib');

/** Maximum redirects followed for one request. */
var MAX_REDIRECTS = 5;

/**
 * Error with a code the web app understands: 'http', 'network', 'timeout',
 * 'too-big', 'params'.
 */
function netError(code, message, status) {
  var err = new Error(message);
  err.code = code;
  err.status = status || 0;
  return err;
}

/**
 * Opens a GET request, following redirects, and calls back with the
 * response stream (already decompressed) once headers arrive.
 * @param {string} url
 * @param {Object} headers
 * @param {number} timeoutMs  applies to connecting and to each pause in data
 * @param {function(Error|null, Object=)} cb  cb(null, {status, headers, stream, url, abort})
 * @param {number} [redirects]
 */
function open(url, headers, timeoutMs, cb, redirects) {
  var u;
  try {
    u = urlLib.parse(url);
  } catch (e) {
    cb(netError('params', 'That address is not valid.'));
    return;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    cb(netError('params', 'Only http and https addresses are supported.'));
    return;
  }
  var lib = u.protocol === 'https:' ? https : http;
  var done = false;
  var req = lib.request({
    method: 'GET',
    hostname: u.hostname,
    port: u.port,
    path: u.path,
    headers: headers,
    // Many IPTV servers use self-signed or expired certificates; this only
    // reads public data, never sends credentials.
    rejectUnauthorized: false,
  }, function (res) {
    if (done) return;
    var status = res.statusCode;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      if ((redirects || 0) >= MAX_REDIRECTS) {
        done = true;
        cb(netError('http', 'Too many redirects.', status));
        return;
      }
      done = true;
      open(urlLib.resolve(url, res.headers.location), headers, timeoutMs, cb, (redirects || 0) + 1);
      return;
    }
    var stream = res;
    var enc = (res.headers['content-encoding'] || '').toLowerCase();
    if (enc === 'gzip' || enc === 'deflate') {
      stream = res.pipe(enc === 'gzip' ? zlib.createGunzip() : zlib.createInflate());
    }
    done = true;
    cb(null, {
      status: status,
      headers: res.headers,
      stream: stream,
      url: url,
      abort: function () { req.abort(); },
    });
  });
  req.on('error', function (err) {
    if (done) return;
    done = true;
    cb(netError('network', err.code || err.message));
  });
  req.setTimeout(timeoutMs, function () {
    req.abort();
    if (done) return;
    done = true;
    cb(netError('timeout', 'The server took too long to answer.'));
  });
  req.end();
}

/**
 * Downloads a text file and calls `onChunk(text)` with pieces of at most
 * `chunkChars` characters, then `cb(null)` when finished.
 * @param {string} url
 * @param {{userAgent?: string, maxBytes?: number, chunkChars?: number}} opts
 * @param {function(string)} onChunk
 * @param {function(Error|null)} cb
 */
function fetchText(url, opts, onChunk, cb) {
  var maxBytes = opts.maxBytes || 40 * 1024 * 1024;
  var chunkChars = opts.chunkChars || 256 * 1024;
  var headers = {
    'User-Agent': opts.userAgent || 'ProsperLGTV (webOS)',
    'Accept': '*/*',
    'Accept-Encoding': 'gzip, deflate',
  };
  open(url, headers, 30000, function (err, res) {
    if (err) {
      cb(err);
      return;
    }
    if (res.status < 200 || res.status >= 300) {
      res.stream.resume();
      cb(netError('http', 'HTTP ' + res.status, res.status));
      return;
    }
    var StringDecoder = require('string_decoder').StringDecoder;
    var decoder = new StringDecoder('utf8');
    var bytes = 0;
    var buffer = '';
    var finished = false;
    var finish = function (e) {
      if (finished) return;
      finished = true;
      cb(e || null);
    };
    res.stream.on('data', function (data) {
      if (finished) return;
      bytes += data.length;
      if (bytes > maxBytes) {
        res.abort();
        finish(netError('too-big', 'The file is too large.'));
        return;
      }
      buffer += decoder.write(data);
      while (buffer.length >= chunkChars) {
        onChunk(buffer.slice(0, chunkChars));
        buffer = buffer.slice(chunkChars);
      }
    });
    res.stream.on('end', function () {
      if (finished) return;
      buffer += decoder.end();
      if (buffer) onChunk(buffer);
      finish(null);
    });
    res.stream.on('error', function (e) {
      finish(netError('network', e.code || e.message));
    });
  });
}

/**
 * Looks at what a stream address returns, to explain a playback failure.
 * Reads at most 64 KB.
 * @param {string} url
 * @param {{userAgent?: string}} opts
 * @param {function(Error|null, Object=)} cb  result: {status, type, drm, html, finalUrl}
 */
function probe(url, opts, cb) {
  var headers = {
    'User-Agent': opts.userAgent || 'ProsperLGTV (webOS)',
    'Accept': '*/*',
  };
  open(url, headers, 15000, function (err, res) {
    if (err) {
      cb(err);
      return;
    }
    var type = String(res.headers['content-type'] || '');
    var chunks = [];
    var size = 0;
    var ended = false;
    var end = function () {
      if (ended) return;
      ended = true;
      res.abort();
      var head = Buffer.concat(chunks).toString('utf8');
      cb(null, {
        status: res.status,
        type: type,
        finalUrl: res.url,
        html: /text\/html/i.test(type) || /^\s*<(!doctype|html)/i.test(head),
        // HLS key formats used by DRM systems (FairPlay, Widevine, PlayReady)
        // or SAMPLE-AES; plain AES-128 is fine for the TV's player.
        drm: /#EXT-X-(SESSION-)?KEY:[^\n]*(SAMPLE-AES|KEYFORMAT="(com\.apple|urn:uuid))/i.test(head),
      });
    };
    res.stream.on('data', function (d) {
      chunks.push(d);
      size += d.length;
      if (size >= 64 * 1024) end();
    });
    res.stream.on('end', end);
    res.stream.on('error', end);
    // Live MPEG-TS never ends: stop after a short look.
    setTimeout(end, 4000);
  });
}

module.exports = {
  fetchText: fetchText,
  probe: probe,
};
