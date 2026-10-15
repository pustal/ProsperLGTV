/**
 * Sources: the user's M3U playlists. The app ships with none; the first
 * one added becomes the active list. OK on a source opens its menu (use, update, rename, change
 * address, clear its cached list, remove).
 */
import { h, icon } from '../util/dom.js';
import { Screen } from '../ui/router.js';
import { focus, focusFirst } from '../nav/focus.js';
import {
  activeSource, addSource, defaultName, listSources, normaliseUrl,
  onSourcesChange, removeSource, setActiveSource, updateSource,
} from '../catalog/sources.js';
import {
  catalogMeta, deleteCatalog, isRefreshing, onCatalogChange, refresh, reloadActive,
} from '../catalog/catalog.js';
import { forgetSource } from '../userdata.js';
import {
  chooseOption, confirmDialog, promptText, toast,
} from '../ui/overlay.js';
import { formatAgo, formatBytes, plural } from '../util/format.js';
import { openSection } from '../ui/navigate.js';

export class SourcesScreen extends Screen {
  constructor() {
    super();
    this.section = 'sources';
    this.el.className = 'screen list-screen no-scroll';
    this.unsubs = [];
    this.listEl = h('div', { class: 'source-list scroll-y nav-group' });
    this.el.appendChild(h('header', { class: 'page-header' }, [
      h('div', { class: 'page-heading' }, [h('h1', { class: 'page-title' }, 'Sources')]),
      h('div', { class: 'toolbar' }, [
        h('div', { class: 'button focusable', onSelect: () => this.add() }, [icon('plus'), 'Add playlist']),
      ]),
    ]));
    this.el.appendChild(h('p', { class: 'page-intro' }, 'Prosper LG TV doesn’t host or provide any channels and comes with no playlist. Add the address of an M3U playlist you are entitled to watch, for example one from your TV or internet provider.'));
    this.el.appendChild(this.listEl);
  }

  mount() {
    this.render();
    this.unsubs.push(onSourcesChange(() => this.render()));
    this.unsubs.push(onCatalogChange(() => this.render()));
  }

  destroy() {
    for (const off of this.unsubs) off();
    super.destroy();
  }

  /** Redraws the list, keeping the highlight on the same source. */
  render() {
    const focused = this.listEl.querySelector('.focused');
    const focusedId = focused ? focused.dataset.id : null;
    this.listEl.innerHTML = '';
    const active = activeSource();
    const activeId = active ? active.id : '';
    let toFocus = null;
    if (!listSources().length) {
      this.listEl.appendChild(h('div', { class: 'source-empty' }, [
        h('p', null, 'No playlist yet. Choose Add playlist and type its address with the remote.'),
        h('p', null, 'M3U and M3U8 playlists over http:// or https:// are supported.'),
      ]));
    }
    for (const src of listSources()) {
      const meta = catalogMeta(src.id);
      const status = isRefreshing(src.id)
        ? 'Updating…'
        : meta ? `${plural(meta.count)} · updated ${formatAgo(meta.fetchedAt)} · ${formatBytes(meta.bytes)} stored` : 'Not downloaded yet';
      const row = h('div', {
        class: 'source-row focusable' + (src.id === activeId ? ' active' : ''),
        dataset: { id: src.id },
        onSelect: () => this.menu(src),
      }, [
        h('div', { class: 'source-main' }, [
          h('div', { class: 'source-name' }, [
            src.name,
            src.id === activeId ? h('span', { class: 'badge on' }, 'In use') : null,
          ]),
          h('div', { class: 'source-url' }, src.url),
          h('div', { class: 'source-status' }, status),
          meta && meta.truncated ? h('div', { class: 'source-status warn' }, 'The playlist was too long for the TV; only the first part is kept.') : null,
        ]),
      ]);
      if (src.id === focusedId) toFocus = row;
      this.listEl.appendChild(row);
    }
    if (toFocus) focus(toFocus);
  }

  /** Menu for one source. */
  async menu(src) {
    const current = activeSource();
    const isActive = !!current && src.id === current.id;
    const options = [];
    if (!isActive) options.push({ label: 'Use this list', value: 'use' });
    options.push({ label: 'Update now', value: 'refresh' });
    if (src.kind === 'm3u') {
      options.push({ label: 'Rename', value: 'rename' });
      options.push({ label: 'Change address', value: 'url' });
    }
    if (catalogMeta(src.id) && !isActive) options.push({ label: 'Delete its stored copy', value: 'clear', hint: formatBytes(catalogMeta(src.id).bytes) });
    if (src.kind === 'm3u') options.push({ label: 'Remove playlist', value: 'remove' });
    const choice = await chooseOption({ title: src.name, options });
    if (choice === 'use') this.use(src);
    else if (choice === 'refresh') this.update(src);
    else if (choice === 'rename') this.rename(src);
    else if (choice === 'url') this.changeUrl(src);
    else if (choice === 'clear') {
      await deleteCatalog(src.id);
      toast('Stored copy deleted');
      this.render();
    } else if (choice === 'remove') this.remove(src);
  }

  use(src) {
    setActiveSource(src.id);
    reloadActive();
    toast(`Now using ${src.name}`);
    openSection('live');
  }

  async update(src) {
    try {
      const r = await refresh(src.id);
      toast(`${src.name}: ${plural(r.count)}${r.skipped ? ` (${plural(r.skipped, 'entry')} the TV can’t play left out)` : ''}`);
    } catch (e) {
      toast(`${src.name}: ${e.message}`, 'error');
    }
    this.render();
  }

  async add() {
    const raw = await promptText({
      title: 'Playlist address',
      placeholder: 'https://example.com/playlist.m3u',
      type: 'url',
      confirm: 'Next',
    });
    if (raw === undefined) return;
    let url;
    try {
      url = normaliseUrl(raw);
    } catch (e) {
      toast(e.message, 'error');
      return;
    }
    const name = await promptText({ title: 'Name for this playlist', value: defaultName(url), confirm: 'Add' });
    if (name === undefined) return;
    const ok = await confirmDialog({
      title: 'Only add playlists you may watch',
      message: 'Prosper LG TV plays whatever the playlist points to. Make sure you have the right to watch its channels, for example a playlist from your own TV or internet provider. Don’t use playlists that re-stream paid channels without permission.',
      confirm: 'I understand, add it',
      cancel: 'Cancel',
      safe: true,
    });
    if (!ok) return;
    const src = addSource(name, url);
    // The first playlist becomes the active list straight away.
    const first = activeSource() && activeSource().id === src.id;
    if (first) reloadActive();
    toast(`Downloading ${src.name}…`);
    try {
      const r = await refresh(src.id);
      if (first) {
        toast(`${src.name}: ${plural(r.count)}`);
        openSection('live');
        return;
      }
      const use = await confirmDialog({
        title: `${src.name} is ready`,
        message: `${plural(r.count)} found${r.truncated ? ' (the list was too long; only the first part is kept)' : ''}. Switch to it now?`,
        confirm: 'Use it now',
        cancel: 'Later',
      });
      if (use) this.use(src);
    } catch (e) {
      toast(`${src.name}: ${e.message}`, 'error');
    }
    this.render();
  }

  async rename(src) {
    const name = await promptText({ title: 'Rename playlist', value: src.name });
    if (name !== undefined) updateSource(src.id, { name });
  }

  async changeUrl(src) {
    const raw = await promptText({ title: 'Playlist address', value: src.url, type: 'url' });
    if (raw === undefined) return;
    try {
      updateSource(src.id, { url: normaliseUrl(raw) });
      this.update(src);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async remove(src) {
    const ok = await confirmDialog({
      title: `Remove ${src.name}?`,
      message: 'Its stored channel list, favourites and history are deleted too.',
      confirm: 'Remove',
      safe: true,
    });
    if (!ok) return;
    const wasActive = !!activeSource() && src.id === activeSource().id;
    removeSource(src.id);
    forgetSource(src.id);
    await deleteCatalog(src.id);
    if (wasActive) reloadActive();
    toast(`${src.name} removed`);
    focusFirst(this.listEl);
  }

  onBack() {
    openSection('live');
    return true;
  }
}
