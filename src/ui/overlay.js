/**
 * Modal choice menus, confirmation dialogs and toasts.
 */
import { h, icon } from '../util/dom.js';
import { focus as focusEl, pushLayer } from '../nav/focus.js';

/** Currently open modal close functions (top = last), for the Back key. */
const openModals = [];

/**
 * Closes the topmost modal.
 * @returns {boolean} true when a modal was open
 */
export function closeTopModal() {
  const close = openModals[openModals.length - 1];
  if (!close) return false;
  close();
  return true;
}

/** True while a modal is open. */
export function hasModal() {
  return openModals.length > 0;
}

/**
 * Opens a modal panel (exported for custom panels such as the editor).
 * The panel is focus-trapped until closed.
 * @param {HTMLElement} panel
 * @param {{side?: boolean, onDismiss?: () => void}} [opts]
 *   side=true slides in from the right; onDismiss runs when Back closes it
 * @returns {() => void} close function (does not call onDismiss)
 */
export function openModal(panel, opts) {
  const o = opts || {};
  const scrim = h('div', { class: 'modal-scrim no-scroll' + (o.side ? ' side' : '') }, panel);
  document.body.appendChild(scrim);
  let closed = false;
  let popLayer = null;
  const close = () => {
    if (closed) return;
    closed = true;
    const i = openModals.indexOf(dismiss);
    if (i >= 0) openModals.splice(i, 1);
    if (scrim.parentNode) scrim.parentNode.removeChild(scrim);
    if (popLayer) popLayer();
  };
  const dismiss = () => {
    close();
    if (o.onDismiss) o.onDismiss();
  };
  openModals.push(dismiss);
  popLayer = pushLayer(scrim);
  return close;
}

/**
 * Shows a list of options and resolves with the chosen value.
 * @param {Object} opts
 * @param {string} opts.title
 * @param {Array<{label: string, value: *, hint?: string}>} opts.options
 * @param {*} [opts.selected] value shown with a check mark (and focused)
 * @returns {Promise<*>} chosen value, or undefined when dismissed
 */
export function chooseOption(opts) {
  return new Promise((resolve) => {
    let close = null;
    const items = opts.options.map((o) => {
      const isSel = o.value === opts.selected;
      return h('div', {
        class: 'menu-item focusable' + (isSel ? ' selected' : ''),
        'data-autofocus': isSel || null,
        onSelect: () => {
          close();
          resolve(o.value);
        },
      }, [
        h('span', { class: 'menu-label' }, o.label),
        o.hint ? h('span', { class: 'menu-hint' }, o.hint) : null,
        isSel ? icon('check', 'menu-check') : null,
      ]);
    });
    const panel = h('div', { class: 'menu-panel' }, [
      h('h2', { class: 'menu-title' }, opts.title),
      h('div', { class: 'menu-list scroll-y' }, items),
    ]);
    close = openModal(panel, { side: true, onDismiss: () => resolve(undefined) });
  });
}

/**
 * Yes/no confirmation.
 * @param {{title: string, message?: string, confirm: string, cancel?: string, safe?: boolean}} opts
 *   safe=true highlights Cancel first, for actions that are annoying to trigger by accident
 * @returns {Promise<boolean>}
 */
export function confirmDialog(opts) {
  return new Promise((resolve) => {
    let close = null;
    const done = (v) => {
      close();
      resolve(v);
    };
    const panel = h('div', { class: 'dialog-panel' }, [
      h('h2', { class: 'dialog-title' }, opts.title),
      opts.message ? h('p', { class: 'dialog-message' }, opts.message) : null,
      h('div', { class: 'dialog-actions' }, [
        h('div', { class: 'button focusable', 'data-autofocus': opts.safe ? null : true, onSelect: () => done(true) }, opts.confirm),
        h('div', { class: 'button ghost focusable', 'data-autofocus': opts.safe ? true : null, onSelect: () => done(false) }, opts.cancel || 'Cancel'),
      ]),
    ]);
    close = openModal(panel, { onDismiss: () => resolve(false) });
  });
}

/**
 * Asks for a line of text. The TV keyboard opens straight away; OK saves,
 * Back cancels.
 * @param {{title: string, value?: string, placeholder?: string, confirm?: string,
 *   multiline?: boolean, type?: string}} opts  multiline: a text box for long
 *   text; type: input type, e.g. 'url'
 * @returns {Promise<string|undefined>} the text, or undefined when cancelled
 */
export function promptText(opts) {
  return new Promise((resolve) => {
    let close = null;
    // Long text (descriptions) gets a taller box; line breaks already in the
    // text are kept, OK still saves.
    const input = opts.multiline
      ? h('textarea', {
        class: 'field-input field-textarea focusable', rows: 6, placeholder: opts.placeholder || '',
        spellcheck: 'false', 'data-autofocus': true,
      })
      : h('input', {
        class: 'field-input focusable', type: opts.type || 'text', value: opts.value || '', placeholder: opts.placeholder || '',
        autocomplete: 'off', spellcheck: 'false', 'data-autofocus': true,
      });
    if (opts.multiline) input.value = opts.value || '';
    const done = (v) => {
      close();
      resolve(v);
    };
    input.addEventListener('keydown', (e) => {
      if (e.keyCode === 13) {
        e.preventDefault();
        e.stopPropagation();
        done(input.value);
      } else if (e.keyCode === 40 && (!opts.multiline || input.selectionStart >= input.value.length)) {
        // Down leaves the field for the buttons (in a text box, from the end).
        e.preventDefault();
        e.stopPropagation();
        input.blur();
        focusEl(saveButton);
      }
    });
    const saveButton = h('div', { class: 'button primary focusable', onSelect: () => done(input.value) }, opts.confirm || 'Save');
    const panel = h('div', { class: 'dialog-panel' }, [
      h('h2', { class: 'dialog-title' }, opts.title),
      h('div', { class: 'dialog-field' }, input),
      h('div', { class: 'dialog-actions' }, [
        saveButton,
        h('div', { class: 'button ghost focusable', onSelect: () => done(undefined) }, 'Cancel'),
      ]),
    ]);
    close = openModal(panel, { onDismiss: () => resolve(undefined) });
    input.focus();
    // Caret at the end, so Backspace edits the existing text.
    try {
      input.setSelectionRange(input.value.length, input.value.length);
    } catch (e) { /* not supported for this input type */ }
  });
}

/**
 * Search-as-you-type picker (tags, performers…).
 * @param {Object} opts
 * @param {string} opts.title
 * @param {(text: string) => Promise<Array<{label: string, value: *, hint?: string}>>} opts.search
 * @returns {Promise<*>} chosen value, or undefined when dismissed
 */
export function pickBySearch(opts) {
  return new Promise((resolve) => {
    let close = null;
    let timer = null;
    let gen = 0;
    const list = h('div', { class: 'menu-list scroll-y picker-list' });
    const note = h('p', { class: 'picker-note' }, 'Type to search.');
    const input = h('input', {
      class: 'field-input focusable', type: 'search', placeholder: 'Search', autocomplete: 'off', spellcheck: 'false',
    });
    const run = async () => {
      const text = input.value.trim();
      const mine = ++gen;
      if (!text) {
        list.innerHTML = '';
        note.textContent = 'Type to search.';
        return;
      }
      note.textContent = 'Searching…';
      let results;
      try {
        results = await opts.search(text);
      } catch (err) {
        if (mine === gen) note.textContent = `Couldn't search: ${err.message}`;
        return;
      }
      if (mine !== gen) return;
      list.innerHTML = '';
      note.textContent = results.length ? '' : `Nothing found for “${text}”.`;
      for (const r of results) {
        list.appendChild(h('div', {
          class: 'menu-item focusable',
          onSelect: () => {
            close();
            resolve(r.value);
          },
        }, [h('span', { class: 'menu-label' }, r.label), r.hint ? h('span', { class: 'menu-hint' }, r.hint) : null]));
      }
    };
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(run, 400);
    });
    input.addEventListener('keydown', (e) => {
      if (e.keyCode === 13 || e.keyCode === 40) {
        // OK closes the keyboard and searches now; Down goes to the results.
        e.preventDefault();
        e.stopPropagation();
        clearTimeout(timer);
        input.blur();
        run().then(() => {
          if (list.firstChild) focusEl(list.firstChild);
        });
      }
    });
    const panel = h('div', { class: 'menu-panel' }, [
      h('h2', { class: 'menu-title' }, opts.title),
      h('div', { class: 'picker-search' }, input),
      note,
      list,
    ]);
    close = openModal(panel, { side: true, onDismiss: () => resolve(undefined) });
    focusEl(input);
    input.focus();
  });
}

let toastTimer = null;

/**
 * Shows a short message at the bottom of the screen.
 * @param {string} message
 * @param {'info'|'error'} [kind]
 */
export function toast(message, kind) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', class: 'toast' });
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = 'toast visible' + (kind === 'error' ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = 'toast' + (kind === 'error' ? ' error' : '');
  }, kind === 'error' ? 5000 : 2800);
}
