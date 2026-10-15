/**
 * Settings: channel list behaviour, what to hide, playback, storage (with
 * sizes and Clear buttons for everything Prosper LG TV stores), and About.
 */
import { h } from '../util/dom.js';
import { Screen } from '../ui/router.js';
import { focus } from '../nav/focus.js';
import {
  LOGO_BUDGETS_MB, REFRESH_POLICIES, START_MODES, TUNE_TIMEOUTS,
  getSettings, resetSettings, updateSettings,
} from '../settings.js';
import {
  catalog, catalogBytes, catalogCount, clearCatalogs, refresh,
} from '../catalog/catalog.js';
import { resetSources } from '../catalog/sources.js';
import {
  clearFailed, clearRecent, failedCount, favouriteCount, recentCount, resetUserData,
} from '../userdata.js';
import { clearLogoCache, logoStats } from '../cache/logoCache.js';
import {
  chooseOption, confirmDialog, openModal, toast,
} from '../ui/overlay.js';
import { formatBytes, plural } from '../util/format.js';
import { openSection } from '../ui/navigate.js';
import {
  KOFI, PROJECT, UPSTREAM, aboutContent,
} from './about.js';
import { showLink } from '../ui/linkDialog.js';

export class SettingsScreen extends Screen {
  constructor() {
    super();
    this.section = 'settings';
    this.el.className = 'screen list-screen no-scroll';
    this.listEl = h('div', { class: 'settings-list scroll-y nav-group' });
    this.el.appendChild(h('header', { class: 'page-header' }, [
      h('div', { class: 'page-heading' }, [h('h1', { class: 'page-title' }, 'Settings')]),
    ]));
    this.el.appendChild(this.listEl);
  }

  mount() {
    this.render();
  }

  onShow() {
    this.render();
  }

  /** A row showing a value; OK runs `onSelect`. */
  row(id, label, value, onSelect, hint) {
    return h('div', { class: 'setting-row focusable', dataset: { id }, onSelect }, [
      h('div', { class: 'setting-text' }, [
        h('span', { class: 'setting-label' }, label),
        hint ? h('span', { class: 'setting-hint' }, hint) : null,
      ]),
      h('span', { class: 'setting-value' }, value),
    ]);
  }

  /** An on/off row for a boolean setting. */
  toggle(key, label, hint) {
    const on = !!getSettings()[key];
    return this.row(key, label, on ? 'On' : 'Off', () => {
      updateSettings({ [key]: !getSettings()[key] });
      this.render();
    }, hint);
  }

  /** A row that picks one of several values. */
  picker(key, label, options, hint) {
    const current = getSettings()[key];
    const opt = options.find((o) => o.value === current);
    return this.row(key, label, opt ? opt.label : String(current), async () => {
      const v = await chooseOption({ title: label, options, selected: current });
      if (v === undefined) return;
      // main.js applies cache-related changes (onSettingsChange).
      updateSettings({ [key]: v });
      setTimeout(() => this.render(), 50);
    }, hint);
  }

  render() {
    const focused = this.listEl.querySelector('.focused');
    const focusedId = focused ? focused.dataset.id : null;
    const scroll = this.listEl.scrollTop;
    const s = getSettings();
    const logos = logoStats();
    const items = [];
    const section = (title) => items.push(h('h2', { class: 'settings-section' }, title));

    section('Channel list');
    items.push(this.picker('refresh', 'Update the list', Object.keys(REFRESH_POLICIES).map((k) => ({ label: REFRESH_POLICIES[k].label, value: k }))));
    items.push(this.row('refreshNow', 'Update now', catalog.source ? catalog.source.name : '', async () => {
      if (!catalog.source) return;
      toast('Updating…');
      try {
        const r = await refresh(catalog.source.id);
        toast(`Channel list updated: ${plural(r.count)}`);
      } catch (e) {
        toast(`Couldn’t update: ${e.message}`, 'error');
      }
      this.render();
    }));

    section('Hide channels');
    items.push(this.toggle('hideGeo', 'Geo-blocked channels', 'Listed as only available in some countries'));
    items.push(this.toggle('hidePartTime', 'Part-time channels', 'Listed as not on air 24/7'));
    items.push(this.toggle('hideHeaders', 'Channels needing special headers', 'Their streams ask for request headers the TV’s player can’t send'));
    items.push(this.toggle('hideFailed', 'Channels that didn’t play last time', `${plural(failedCount())} marked`));

    section('Playback');
    items.push(this.picker('tuneTimeout', 'Give up on a stream after', TUNE_TIMEOUTS.map((n) => ({ label: `${n} seconds`, value: n }))));
    items.push(this.picker('startWith', 'At launch, open', Object.keys(START_MODES).map((k) => ({ label: START_MODES[k], value: k }))));

    section('Storage');
    items.push(h('p', { class: 'settings-note' }, 'Everything Prosper LG TV keeps on the TV is listed here. Video is never stored.'));
    items.push(this.row('catalogs', 'Stored channel lists', `${formatBytes(catalogBytes())} · ${plural(catalogCount(), 'list')}`, async () => {
      const ok = await confirmDialog({
        title: 'Delete stored channel lists?',
        message: 'The list on screen keeps working; it will be downloaded again the next time the app starts.',
        confirm: 'Delete',
        safe: true,
      });
      if (!ok) return;
      await clearCatalogs();
      toast('Stored channel lists deleted');
      this.render();
    }, 'Kept so the app opens instantly and works when a refresh fails. OK to delete.'));
    items.push(this.toggle('logos', 'Channel logos', 'Off: shows initials, downloads and stores no logos'));
    items.push(this.picker('logoBudgetMB', 'Logo cache limit', LOGO_BUDGETS_MB.map((n) => ({ label: n === 0 ? 'Don’t store (memory only)' : `${n} MB`, value: n })),
      'Logos are shrunk to a few KB each before they are stored'));
    items.push(this.row('logoClear', 'Stored logos', `${formatBytes(logos.storedBytes)} of ${formatBytes(logos.budgetBytes)}`, async () => {
      await clearLogoCache();
      toast('Logo cache cleared');
      this.render();
    }, 'OK to delete'));
    items.push(this.row('recent', 'Watch history', plural(recentCount()), async () => {
      clearRecent();
      clearFailed();
      toast('Watch history cleared');
      this.render();
    }, 'OK to clear recent channels and failed-channel marks'));
    items.push(this.row('reset', 'Reset Prosper LG TV', `${plural(favouriteCount(), 'favourite')}`, async () => {
      const ok = await confirmDialog({
        title: 'Reset everything?',
        message: 'Deletes all stored lists and logos, your playlists, favourites, history and settings. The app starts as if newly installed.',
        confirm: 'Reset',
        safe: true,
      });
      if (!ok) return;
      await clearCatalogs();
      await clearLogoCache();
      resetUserData();
      resetSources();
      resetSettings();
      window.location.reload();
    }, 'Erases everything Prosper LG TV stores'));

    section('About');
    items.push(this.row('about', 'About Prosper LG TV', `Version ${__APP_VERSION__}`, () => {
      let close = null;
      const panel = h('div', { class: 'dialog-panel about-panel' }, [
        aboutContent(),
        h('div', { class: 'dialog-actions' }, [
          h('div', { class: 'button focusable', 'data-autofocus': true, onSelect: () => close() }, 'Close'),
        ]),
      ]);
      close = openModal(panel);
    }, 'Credits, licence and where channels come from'));
    // Links open a QR code (and, on the TV, the browser): see ui/linkDialog.js.
    items.push(this.row('github', 'Source code on GitHub', 'github.com/pustal/ProsperLGTV', () => showLink({
      title: 'Prosper LG TV on GitHub',
      text: 'Source code, releases and issues.',
      url: PROJECT,
    })));
    items.push(this.row('upstream', 'ProsperoTV, the original', 'github.com/blackbearreloaded', () => showLink({
      title: 'ProsperoTV',
      text: 'The PlayStation 5 IPTV client by blackbearreloaded that Prosper LG TV is adapted from.',
      url: UPSTREAM,
    })));
    items.push(this.row('kofi', 'Please consider buying me a Ko-fi', 'ko-fi.com/pustal', () => showLink({
      title: 'Buy me a Ko-fi',
      text: 'If you enjoy this app, a Ko-fi helps keep it going. Thank you!',
      url: KOFI,
    })));

    this.listEl.innerHTML = '';
    let toFocus = null;
    for (const el of items) {
      this.listEl.appendChild(el);
      if (focusedId && el.dataset && el.dataset.id === focusedId) toFocus = el;
    }
    this.listEl.scrollTop = scroll;
    if (toFocus) focus(toFocus);
  }

  onBack() {
    openSection('live');
    return true;
  }
}
