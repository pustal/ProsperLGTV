/**
 * Full-screen live player.
 *
 * Where ProsperoTV demuxes MPEG-TS and drives the PS5's hardware decoders
 * itself (src/iptv_player.cpp, src/iptv_stream.cpp, src/iptv_native_backend.c),
 * a webOS app hands the stream address to an HTML <video> element and the
 * TV's own media pipeline does the rest: HLS, MPEG-TS and DASH, with
 * hardware H.264/HEVC (and VP9/AV1 on newer sets) decoding.
 *
 * What this screen adds on top, following ProsperoTV's behaviour:
 * - a tuning screen until the first picture, and a timeout;
 * - automatic fallback to the channel's other streams when one fails;
 * - recovery from stalled live streams (reload once before giving up);
 * - zapping with Up/Down and CH+/CH- through the list it was opened from;
 * - a banner with the channel's name and details when it opens;
 * - a statistics overlay (Blue), favourites (Green), a stream picker;
 * - a specific reason when a channel can't be played (see diagnose()).
 *
 * Not possible with <video> on webOS, so not ported: custom request headers
 * per stream, audio/subtitle track menus for all stream types, timeshift,
 * recording, multiview, and codec/bitrate statistics.
 */
import { h, icon } from '../util/dom.js';
import { Screen } from '../ui/router.js';
import { focus, pushLayer } from '../nav/focus.js';
import { KEY, colorOf, directionOf, isEnter } from '../util/keys.js';
import { bindLogo } from '../cache/logoCache.js';
import { catalog } from '../catalog/catalog.js';
import { getSettings } from '../settings.js';
import { addRecent, setFailed } from '../userdata.js';
import { probe, describeStatus } from '../net/http.js';
import { initials, qualityLabel } from '../ui/channelGrid.js';
import {
  describeStream, hostOf, isFav, lastPlayed, showChannelInfo, toggleFav,
} from '../ui/channelActions.js';
import { chooseOption, toast } from '../ui/overlay.js';

/** How long the channel banner stays up (ms). */
const BANNER_MS = 5000;
/** A playing stream that buffers this long (ms) is reloaded once. */
const STALL_MS = 15000;
/** Zapping waits this long (ms) after the last key so quick presses skip channels. */
const ZAP_DELAY_MS = 450;

/** Stream that worked last for each channel this session (key → index). */
const workingStream = new Map();

export class PlayerScreen extends Screen {
  /**
   * @param {{list: Object[], index: number}} item  the list to zap through
   * @param {{stream?: number}} [extra]  start with this stream
   */
  constructor(item, extra) {
    super();
    this.fullscreen = true;
    this.el.className = 'screen player-screen no-scroll';
    this.list = item.list && item.list.length ? item.list : [];
    this.index = Math.max(0, Math.min(item.index || 0, this.list.length - 1));
    this.forcedStream = extra && typeof extra.stream === 'number' ? extra.stream : null;
    /** Generation counter: events from an older tune are ignored. */
    this.gen = 0;
    this.timers = {};
    this.showStats = false;
    this.popControls = null;
    this.popError = null;

    this.video = h('video', { class: 'player-video', autoplay: true, preload: 'auto' });
    this.tuneEl = h('div', { class: 'tune-overlay' });
    this.bufferEl = h('div', { class: 'buffering' }, h('div', { class: 'spinner' }));
    this.bannerEl = h('div', { class: 'banner' });
    this.statsEl = h('div', { class: 'stats-overlay' });
    this.controlsEl = h('div', { class: 'player-controls no-scroll' });
    this.errorEl = h('div', { class: 'player-error no-scroll' });
    for (const el of [this.video, this.tuneEl, this.bufferEl, this.bannerEl, this.statsEl, this.controlsEl, this.errorEl]) {
      this.el.appendChild(el);
    }
    this.bindVideoEvents();
  }

  /** The channel on screen. */
  channel() {
    return this.list[this.index] || null;
  }

  mount() {
    this.tuneChannel();
  }

  focusDefault() { /* nothing focusable until a panel opens */ }

  destroy() {
    this.gen += 1;
    for (const k of Object.keys(this.timers)) clearTimeout(this.timers[k]);
    clearInterval(this.statsTimer);
    this.stopVideo();
    if (this.popControls) this.popControls();
    if (this.popError) this.popError();
    super.destroy();
  }

  // -------------------------------------------------------------------------
  // Video element
  // -------------------------------------------------------------------------

  /** Releases the TV's decoder (removing src and calling load() does that). */
  stopVideo() {
    try {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
    } catch (e) { /* already stopped */ }
  }

  bindVideoEvents() {
    const v = this.video;
    v.addEventListener('playing', () => this.onPlaying());
    v.addEventListener('waiting', () => this.onWaiting());
    v.addEventListener('stalled', () => this.onWaiting());
    v.addEventListener('timeupdate', () => this.onProgress());
    v.addEventListener('error', () => {
      if (!v.getAttribute('src')) return; // our own stopVideo()
      const code = v.error ? v.error.code : 0;
      this.fail(code === 3 ? 'decode' : code === 4 ? 'unsupported' : 'network', code);
    });
    v.addEventListener('ended', () => {
      // A live stream should never end: reload once, then give up.
      if (this.tuned) this.recover('ended');
    });
  }

  setTimer(name, ms, fn) {
    clearTimeout(this.timers[name]);
    this.timers[name] = setTimeout(fn, ms);
  }

  clearTimer(name) {
    clearTimeout(this.timers[name]);
    this.timers[name] = null;
  }

  // -------------------------------------------------------------------------
  // Tuning
  // -------------------------------------------------------------------------

  /** Starts the current channel from its preferred stream. */
  tuneChannel() {
    const ch = this.channel();
    if (!ch) return;
    lastPlayed.key = ch.k;
    this.hideError();
    this.attempts = [];
    this.tried = new Set();
    let first = 0;
    if (this.forcedStream !== null && ch.s[this.forcedStream]) first = this.forcedStream;
    else if (workingStream.has(ch.k) && ch.s[workingStream.get(ch.k)]) first = workingStream.get(ch.k);
    this.forcedStream = null;
    this.showBanner();
    this.tuneStream(first);
  }

  /** Opens one stream of the current channel. */
  tuneStream(i) {
    const ch = this.channel();
    const stream = ch.s[i];
    this.gen += 1;
    this.streamIndex = i;
    this.tried.add(i);
    this.tuned = false;
    this.recovered = false;
    this.clearTimer('stall');
    this.showTuning(true);
    this.bufferEl.classList.remove('visible');
    try {
      this.video.src = stream.u;
      this.video.load();
      const p = this.video.play();
      if (p && p.catch) p.catch(() => { /* errors arrive as 'error' events */ });
    } catch (e) {
      this.fail('unsupported', 0);
      return;
    }
    const gen = this.gen;
    const seconds = getSettings().tuneTimeout || 15;
    this.setTimer('tune', seconds * 1000, () => {
      if (gen === this.gen && !this.tuned) this.fail('timeout', 0);
    });
  }

  onPlaying() {
    this.clearTimer('stall');
    this.bufferEl.classList.remove('visible');
    if (this.tuned) return;
    this.tuned = true;
    this.clearTimer('tune');
    this.showTuning(false);
    const ch = this.channel();
    const src = catalog.source ? catalog.source.id : '';
    workingStream.set(ch.k, this.streamIndex);
    addRecent(src, ch);
    setFailed(src, ch.k, false);
    this.updateStats();
  }

  onWaiting() {
    if (!this.tuned) return;
    this.bufferEl.classList.add('visible');
    const gen = this.gen;
    if (!this.timers.stall) {
      this.setTimer('stall', STALL_MS, () => {
        this.timers.stall = null;
        if (gen === this.gen) this.recover('stall');
      });
    }
  }

  onProgress() {
    if (this.timers.stall && !this.video.paused) {
      // Moving again: cancel the stall check.
      this.clearTimer('stall');
      this.bufferEl.classList.remove('visible');
    }
  }

  /**
   * Live streams sometimes stall on stale segments; ProsperoTV recovers
   * "without discarding the channel immediately". Reload the same stream
   * once, then treat it as failed.
   */
  recover(reason) {
    if (this.recovered) {
      this.fail(reason, 0);
      return;
    }
    const i = this.streamIndex;
    this.tuneStream(i);
    this.recovered = true;
  }

  /**
   * Records a failed stream and moves on to the next untried one, or shows
   * the error panel when none is left.
   * @param {string} reason 'timeout' | 'network' | 'decode' | 'unsupported' | 'stall' | 'ended'
   * @param {number} code   MediaError code, if any
   */
  fail(reason, code) {
    const ch = this.channel();
    if (!ch || this.errorShown) return;
    this.clearTimer('tune');
    this.clearTimer('stall');
    this.attempts.push({ stream: this.streamIndex, reason, code });
    let next = -1;
    for (let i = 0; i < ch.s.length; i += 1) {
      if (!this.tried.has(i)) {
        next = i;
        break;
      }
    }
    if (next >= 0) {
      toast(`Stream ${this.streamIndex + 1} didn’t play. Trying stream ${next + 1} of ${ch.s.length}…`);
      this.tuneStream(next);
      return;
    }
    this.gen += 1;
    this.stopVideo();
    this.showTuning(false);
    this.bufferEl.classList.remove('visible');
    setFailed(catalog.source ? catalog.source.id : '', ch.k, true);
    this.showError();
  }

  // -------------------------------------------------------------------------
  // Zapping
  // -------------------------------------------------------------------------

  /** Moves to the next (+1) or previous (-1) channel of the list. */
  zap(delta) {
    if (this.list.length < 2) return;
    this.index = (this.index + delta + this.list.length) % this.list.length;
    this.gen += 1;
    this.streamIndex = 0;
    this.hideError();
    this.stopVideo();
    this.showBanner();
    this.showTuning(true);
    // Wait for the last of a quick series of presses before tuning.
    this.setTimer('zap', ZAP_DELAY_MS, () => this.tuneChannel());
  }

  // -------------------------------------------------------------------------
  // Overlays
  // -------------------------------------------------------------------------

  /** Logo box with initials underneath (the logo covers them when it loads). */
  logoBox(ch, cls) {
    const img = h('img', { class: 'tile-logo', alt: '' });
    const box = h('div', { class: `tile-plate ${cls || ''}` }, [h('span', { class: 'tile-initials' }, initials(ch.n)), img]);
    bindLogo(img, ch.l);
    return box;
  }

  showTuning(on) {
    const ch = this.channel();
    this.tuneEl.innerHTML = '';
    this.tuneEl.classList.toggle('visible', !!on);
    if (!on || !ch) return;
    const streamNote = ch.s.length > 1 ? `Stream ${(this.streamIndex || 0) + 1} of ${ch.s.length}` : '';
    this.tuneEl.appendChild(h('div', { class: 'tune-card' }, [
      this.logoBox(ch, 'tune-logo'),
      h('div', { class: 'spinner' }),
      h('p', { class: 'tune-title' }, `Tuning ${ch.n}…`),
      streamNote ? h('p', { class: 'tune-note' }, streamNote) : null,
    ]));
  }

  showBanner() {
    const ch = this.channel();
    if (!ch) return;
    const meta = [ch.c.join(', '), ch.co.join(', '), ch.la.join(', ')].filter(Boolean).join(' · ');
    const badges = [];
    if (ch.q) badges.push(h('span', { class: 'badge' }, qualityLabel(ch.q)));
    if (ch.g) badges.push(h('span', { class: 'badge warn' }, 'Geo-blocked'));
    if (ch.p) badges.push(h('span', { class: 'badge' }, 'Part-time'));
    if (isFav(ch)) badges.push(h('span', { class: 'badge fav' }, '♥ Favourite'));
    this.bannerEl.innerHTML = '';
    this.bannerEl.appendChild(this.logoBox(ch, 'banner-logo'));
    this.bannerEl.appendChild(h('div', { class: 'banner-text' }, [
      h('div', { class: 'banner-position' }, this.list.length > 1 ? `${this.index + 1} / ${this.list.length}` : ''),
      h('div', { class: 'banner-name' }, ch.n),
      meta ? h('div', { class: 'banner-meta' }, meta) : null,
      h('div', { class: 'banner-badges' }, badges),
      h('div', { class: 'banner-hint' }, 'OK menu · ▲▼ channels · Green favourite · Blue stats · Back to list'),
    ]));
    this.bannerEl.classList.add('visible');
    this.setTimer('banner', BANNER_MS, () => this.bannerEl.classList.remove('visible'));
  }

  /** Statistics overlay (Blue): resolution, stream, buffer, dropped frames. */
  updateStats() {
    this.statsEl.classList.toggle('visible', this.showStats);
    clearInterval(this.statsTimer);
    if (!this.showStats) return;
    const draw = () => {
      const ch = this.channel();
      const v = this.video;
      if (!ch) return;
      const s = ch.s[this.streamIndex] || {};
      let ahead = 0;
      try {
        if (v.buffered.length) ahead = Math.max(0, v.buffered.end(v.buffered.length - 1) - v.currentTime);
      } catch (e) { /* no buffer yet */ }
      const rows = [
        ['Picture', v.videoWidth ? `${v.videoWidth}×${v.videoHeight}` : '—'],
        ['Listed', qualityLabel(s.h) || '—'],
        ['Stream', `${(this.streamIndex || 0) + 1} of ${ch.s.length}`],
        ['Server', hostOf(s.u) || '—'],
        ['Buffered', `${ahead.toFixed(1)} s`],
      ];
      if (typeof v.webkitDroppedFrameCount === 'number') {
        rows.push(['Dropped', `${v.webkitDroppedFrameCount} of ${v.webkitDecodedFrameCount || 0} frames`]);
      }
      this.statsEl.innerHTML = '';
      for (const [k, val] of rows) this.statsEl.appendChild(h('div', { class: 'stats-row' }, [h('span', null, k), h('span', null, val)]));
    };
    draw();
    this.statsTimer = setInterval(draw, 1000);
  }

  /** Bottom menu (OK): favourite, stream choice, statistics, details. */
  openControls() {
    if (this.popControls) return;
    const ch = this.channel();
    if (!ch) return;
    const fav = isFav(ch);
    const buttons = [
      h('div', {
        class: 'button focusable', 'data-autofocus': true,
        onSelect: () => {
          toggleFav(ch);
          this.closeControls();
          this.showBanner();
        },
      }, [icon(fav ? 'heartFilled' : 'heart'), fav ? 'Remove favourite' : 'Favourite']),
    ];
    if (ch.s.length > 1) {
      buttons.push(h('div', {
        class: 'button focusable',
        onSelect: async () => {
          this.closeControls();
          const choice = await chooseOption({
            title: 'Choose a stream',
            options: ch.s.map((s, i) => ({ label: describeStream(s, i), value: i })),
            selected: this.streamIndex,
          });
          if (choice !== undefined) {
            this.hideError();
            this.attempts = [];
            this.tried = new Set();
            this.tuneStream(choice);
          }
        },
      }, [icon('stream'), `Stream ${this.streamIndex + 1} of ${ch.s.length}`]));
    }
    buttons.push(h('div', {
      class: 'button focusable',
      onSelect: () => {
        this.showStats = !this.showStats;
        this.updateStats();
        this.closeControls();
      },
    }, [icon('info'), this.showStats ? 'Hide statistics' : 'Statistics']));
    buttons.push(h('div', {
      class: 'button ghost focusable',
      onSelect: () => {
        this.closeControls();
        showChannelInfo(ch);
      },
    }, 'Channel details'));
    this.controlsEl.innerHTML = '';
    this.controlsEl.appendChild(h('div', { class: 'controls-bar' }, buttons));
    this.controlsEl.classList.add('visible');
    this.showBanner();
    this.clearTimer('banner'); // keep the banner while the menu is open
    this.popControls = pushLayer(this.controlsEl);
  }

  closeControls() {
    if (!this.popControls) return;
    const pop = this.popControls;
    this.popControls = null;
    this.controlsEl.classList.remove('visible');
    pop();
    this.setTimer('banner', 1500, () => this.bannerEl.classList.remove('visible'));
  }

  /** Error panel with the most specific reason found. */
  showError() {
    const ch = this.channel();
    this.errorShown = true;
    const msg = h('p', { class: 'error-message' }, 'Checking why…');
    const notes = h('div', { class: 'error-notes' });
    const actions = h('div', { class: 'dialog-actions' }, [
      h('div', {
        class: 'button focusable', 'data-autofocus': true,
        onSelect: () => this.tuneChannel(),
      }, [icon('refresh'), 'Try again']),
      this.list.length > 1 ? h('div', { class: 'button focusable', onSelect: () => this.zap(1) }, 'Next channel') : null,
      h('div', { class: 'button ghost focusable', onSelect: () => this.router.back() }, 'Back to list'),
    ]);
    this.errorEl.innerHTML = '';
    this.errorEl.appendChild(h('div', { class: 'dialog-panel error-panel' }, [
      h('div', { class: 'error-icon' }, icon('warning')),
      h('h2', { class: 'dialog-title' }, `${ch.n} can’t be played right now`),
      msg,
      notes,
      actions,
    ]));
    this.errorEl.classList.add('visible');
    this.bannerEl.classList.remove('visible');
    if (this.popError) this.popError();
    this.popError = pushLayer(this.errorEl);

    const gen = this.gen;
    this.diagnose(ch).then((result) => {
      if (gen !== this.gen || !this.errorShown) return;
      msg.textContent = result.message;
      notes.innerHTML = '';
      for (const n of result.notes) notes.appendChild(h('p', null, n));
    });
  }

  hideError() {
    if (!this.errorShown) return;
    this.errorShown = false;
    this.errorEl.classList.remove('visible');
    if (this.popError) {
      const pop = this.popError;
      this.popError = null;
      pop();
    }
  }

  /**
   * Works out why the channel failed: the <video> error, the channel's flags
   * and, on the TV, what the stream address actually returns (via the
   * helper service).
   * @returns {Promise<{message: string, notes: string[]}>}
   */
  async diagnose(ch) {
    const notes = [];
    const last = this.attempts[this.attempts.length - 1] || {};
    const firstStream = ch.s[(this.attempts[0] && this.attempts[0].stream) || 0];
    if (ch.s.length > 1) notes.push(`All ${ch.s.length} of its streams were tried.`);
    if (ch.p) notes.push('It’s listed as not 24/7, so it may simply be off air right now.');

    const info = firstStream ? await probe(firstStream) : null;
    let message = '';
    if (info) {
      if (info.drm) message = 'This channel is DRM-protected. Prosper LG TV doesn’t support DRM.';
      else if (info.status === 401 || info.status === 403 || info.status === 451) {
        if (ch.g) message = `The provider refused the connection (HTTP ${info.status}). The channel is listed as geo-blocked, so it’s probably not available in your country.`;
        else if (ch.$h) message = `The provider refused the connection (HTTP ${info.status}). This channel asks for request headers the TV’s player can’t send.`;
        else message = describeStatus(info.status);
      } else if (info.status === 404 || info.status === 410) {
        message = `The stream is offline (HTTP ${info.status}). Channels in public lists come and go; updating the list may help.`;
      } else if (info.status >= 400) {
        message = describeStatus(info.status);
      } else if (info.html) {
        message = 'The address returned a web page instead of a video stream.';
      } else if (info.status >= 200 && info.status < 300) {
        message = last.reason === 'timeout' || last.reason === 'stall'
          ? 'The stream is online but no picture arrived in time. It may be overloaded or too slow for your connection.'
          : 'The stream is online, but the TV couldn’t play its format.';
      }
    } else if (firstStream && window.PalmServiceBridge) {
      // The helper answered with a network error, or not at all.
      message = 'The stream’s server didn’t respond. It may be offline.';
    }
    if (!message) {
      if (last.reason === 'timeout') message = `The stream didn’t start within ${getSettings().tuneTimeout || 15} seconds.`;
      else if (last.reason === 'decode') message = 'The TV couldn’t decode this stream.';
      else message = 'The stream couldn’t be opened. It may be offline, blocked in your region, or in a format the TV can’t play.';
      if (ch.g) notes.push('It’s listed as geo-blocked, so it may not be available in your country.');
      if (ch.$h) notes.push('It asks for request headers the TV’s player can’t send.');
    }
    return { message, notes };
  }

  // -------------------------------------------------------------------------
  // Keys
  // -------------------------------------------------------------------------

  onKey(e) {
    // With a panel open, the focus engine handles arrows and OK.
    if (this.popControls || this.errorShown) return false;
    const dir = directionOf(e);
    if (e.keyCode === KEY.CHANNEL_UP || dir === 'up') {
      this.zap(1);
      return true;
    }
    if (e.keyCode === KEY.CHANNEL_DOWN || dir === 'down') {
      this.zap(-1);
      return true;
    }
    if (dir === 'left' || dir === 'right') {
      this.showBanner();
      return true;
    }
    if (isEnter(e)) {
      this.openControls();
      return true;
    }
    const color = colorOf(e);
    if (color === 'green') {
      const ch = this.channel();
      if (ch) {
        toggleFav(ch);
        this.showBanner();
      }
      return true;
    }
    if (color === 'blue') {
      this.showStats = !this.showStats;
      this.updateStats();
      return true;
    }
    if (e.keyCode === KEY.PLAY_PAUSE || e.keyCode === KEY.PAUSE || e.keyCode === KEY.PLAY) {
      // Live TV can't pause on webOS without timeshift; show where we are.
      this.showBanner();
      return true;
    }
    if (e.keyCode === KEY.STOP) {
      this.router.back();
      return true;
    }
    return false;
  }

  onBack() {
    if (this.popControls) {
      this.closeControls();
      return true;
    }
    return false; // leave the player (the error panel included)
  }
}
