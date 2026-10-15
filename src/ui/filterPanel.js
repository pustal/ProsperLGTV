/**
 * Filters panel (Yellow button in Live TV): category, country, language and
 * quality, like ProsperoTV's advanced search. Each row opens a list of the
 * values present in the current channel list, with how many channels have
 * each.
 */
import { h, icon } from '../util/dom.js';
import { QUALITIES } from '../catalog/model.js';
import { chooseOption, openModal } from './overlay.js';
import { focus } from '../nav/focus.js';

/** The filter fields shown in the panel. */
const FIELDS = [
  { key: 'category', label: 'Category', facet: 'categories', all: 'All categories' },
  { key: 'country', label: 'Country', facet: 'countries', all: 'All countries' },
  { key: 'language', label: 'Language', facet: 'languages', all: 'All languages' },
  { key: 'quality', label: 'Quality', facet: 'qualities', all: 'Any quality' },
];

/** Display text of a filter value. */
function valueLabel(field, value) {
  if (!value) return field.all;
  if (field.key === 'quality') {
    const q = QUALITIES.find((x) => x.id === value);
    return q ? q.label : value;
  }
  return value;
}

/**
 * Short summary of the active filters ("Portugal · Portuguese"), or ''.
 * @param {Object} filter
 * @param {boolean} [withCategory] include the category (shown as chips elsewhere)
 */
export function filterSummary(filter, withCategory) {
  const parts = [];
  for (const f of FIELDS) {
    if (f.key === 'category' && !withCategory) continue;
    if (filter[f.key]) parts.push(valueLabel(f, filter[f.key]));
  }
  return parts.join(' · ');
}

/**
 * Opens the panel. Changes apply as soon as a value is chosen.
 * @param {Object} filter      current filter (category/country/language/quality)
 * @param {Object} facetData   catalog.facets
 * @param {(patch: Object) => void} onChange
 */
export function openFilterPanel(filter, facetData, onChange) {
  const state = Object.assign({}, filter);
  const rows = {};

  const choose = async (field) => {
    const values = facetData[field.facet] || [];
    const options = [{ label: field.all, value: '' }].concat(values.map(([v, n]) => ({
      label: valueLabel(field, v),
      value: v,
      hint: n.toLocaleString(),
    })));
    const picked = await chooseOption({ title: field.label, options, selected: state[field.key] || '' });
    if (picked === undefined) return;
    state[field.key] = picked;
    rows[field.key].querySelector('.setting-value').textContent = valueLabel(field, picked);
    onChange({ [field.key]: picked });
    focus(rows[field.key]);
  };

  const list = FIELDS.map((f) => {
    const row = h('div', { class: 'setting-row focusable', onSelect: () => choose(f) }, [
      h('span', { class: 'setting-label' }, f.label),
      h('span', { class: 'setting-value' }, valueLabel(f, state[f.key])),
    ]);
    rows[f.key] = row;
    return row;
  });

  const clear = h('div', {
    class: 'button ghost focusable',
    onSelect: () => {
      const patch = {};
      for (const f of FIELDS) {
        state[f.key] = '';
        patch[f.key] = '';
        rows[f.key].querySelector('.setting-value').textContent = f.all;
      }
      onChange(patch);
    },
  }, [icon('close'), 'Clear filters']);

  const panel = h('div', { class: 'menu-panel' }, [
    h('h2', { class: 'menu-title' }, 'Filters'),
    h('div', { class: 'menu-list scroll-y' }, list),
    h('div', { class: 'panel-actions' }, clear),
  ]);
  openModal(panel, { side: true });
}
