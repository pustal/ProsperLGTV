/**
 * Prosper LG TV: entry point.
 *
 * Wires the router, sidebar, focus engine, logo cache and catalog together,
 * routes remote-control keys, shows the one-time welcome notice and opens
 * Live TV (or the last channel, per Settings).
 */
import './polyfills.js';
import { h } from './util/dom.js';
import { KEY, directionOf, isBack } from './util/keys.js';
import {
  focusFirst, getFocused, initFocus, move, select,
} from './nav/focus.js';
import { Router } from './ui/router.js';
import { Sidebar } from './ui/sidebar.js';
import { registerNavigation, openSection, openItem } from './ui/navigate.js';
import { closeTopModal, confirmDialog, hasModal } from './ui/overlay.js';
import { initLogoCache } from './cache/logoCache.js';
import { getSettings, onSettingsChange, updateSettings } from './settings.js';
import { catalog, loadActive } from './catalog/catalog.js';
import { lastWatched } from './userdata.js';

import { ChannelsScreen } from './screens/live.js';
import { SearchScreen } from './screens/search.js';
import { SourcesScreen } from './screens/sources.js';
import { SettingsScreen } from './screens/settings.js';
import { PlayerScreen } from './screens/player.js';
import { welcomeNotice } from './screens/about.js';

const appRoot = document.getElementById('app');
const sidebar = new Sidebar();
const content = h('main', { class: 'content nav-zone' });
appRoot.appendChild(sidebar.el);
appRoot.appendChild(content);
initFocus(appRoot);

const router = new Router(content, {
  onChange(screen) {
    sidebar.setVisible(!screen.fullscreen);
    if (screen.section) sidebar.setActive(screen.section);
  },
});

registerNavigation(router, {
  player: (item, extra) => new PlayerScreen(item, extra),
  'section:live': () => new ChannelsScreen('live'),
  'section:favourites': () => new ChannelsScreen('favourites'),
  'section:recent': () => new ChannelsScreen('recent'),
  'section:search': () => new SearchScreen(),
  'section:sources': () => new SourcesScreen(),
  'section:settings': () => new SettingsScreen(),
});

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

let exitPromptOpen = false;

/** Back at the root of Live TV asks before closing the app. */
async function askExit() {
  if (exitPromptOpen) return;
  exitPromptOpen = true;
  const ok = await confirmDialog({
    title: 'Close Prosper LG TV?', confirm: 'Close', cancel: 'Stay', safe: true,
  });
  exitPromptOpen = false;
  if (ok) {
    // webOS closes the app; in a desktop browser this is a no-op.
    window.close();
  }
}

function handleBack() {
  if (closeTopModal()) return;
  const top = router.top;
  if (top && top.onBack()) return;
  if (router.back()) return;
  askExit();
}

document.addEventListener('keydown', (e) => {
  const typing = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
  const top = router.top;

  // Screens get first pick (grid navigation, player keys) unless a modal is open.
  if (!hasModal() && top && top.onKey(e)) {
    if (!typing) e.preventDefault();
    return;
  }
  if (isBack(e)) {
    e.preventDefault();
    handleBack();
    return;
  }
  if (typing) return; // let the field handle everything else

  const dir = directionOf(e);
  if (dir) {
    e.preventDefault();
    if (!getFocused() || !document.documentElement.contains(getFocused())) focusFirst();
    else move(dir);
    return;
  }
  if (e.keyCode === KEY.ENTER) {
    e.preventDefault();
    if (!e.repeat) select();
  }
});

// Key-up matters only for "hold OK" on channel tiles.
document.addEventListener('keyup', (e) => {
  const top = router.top;
  if (!hasModal() && top && typeof top.onKeyUp === 'function' && top.onKeyUp(e)) e.preventDefault();
});

// ---------------------------------------------------------------------------
// Settings that affect running services
// ---------------------------------------------------------------------------

/** Applies the logo settings to the cache. */
function applyLogoSettings() {
  const s = getSettings();
  return initLogoCache({ enabled: s.logos, budgetBytes: s.logos ? s.logoBudgetMB * 1024 * 1024 : 0 });
}

onSettingsChange((next, prev) => {
  if (next.logos !== prev.logos || next.logoBudgetMB !== prev.logoBudgetMB) applyLogoSettings();
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function start() {
  document.body.classList.toggle('dev', __DEV__);
  await applyLogoSettings();
  await loadActive();
  openSection('live');

  if (!getSettings().noticeSeen) {
    await welcomeNotice();
    updateSettings({ noticeSeen: true });
    if (router.top) router.top.focusDefault();
    return;
  }
  if (getSettings().startWith === 'last' && catalog.source) {
    const ch = lastWatched(catalog.source.id, catalog.byKey);
    if (ch) {
      // Zap through the whole list when the channel is still in it.
      const i = catalog.channels.findIndex((c) => c.k === ch.k);
      openItem('player', i >= 0 ? { list: catalog.channels, index: i } : { list: [ch], index: 0 });
    }
  }
}

start();
