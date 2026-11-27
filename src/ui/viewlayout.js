// The wall's layout for the place being looked at: mosaic, grid or list. Each place (a collection, a tag, a type tab,
// «Все файлы»…) keeps the one chosen there (`perch.layoutBy`, the newest 300 places). A place without a choice opens as
// a list when most of its files are links (the «Ссылки» tab, a collection of 3D-model pages) — a page reads better as a
// row with its title and site; otherwise in the general layout (`settings.layout`: mosaic or grid, as before).
import { S } from '../state.js';
import { settings, setLayoutPrefs } from './settings.js';
import { readPref, writePref } from '../lib/prefs.js';
import { placeItems } from '../lib/filter.js';

const KEY = 'perch.layoutBy';
const MODES = ['masonry', 'grid', 'list'];
let by = null;
const chosen = () => by || (by = readPref(KEY, {}));

// search and colour do not make a place: the layout stays while one types
export const placeKey = (v = S.view) => `${v.type}:${v.id || ''}${v.kind ? '/' + v.kind : ''}`;

function mostlyLinks(v) {
  if (v.kind) return v.kind === 'link';
  if (v.type === 'kind') return v.id === 'link';
  if (v.type === 'all' || v.type === 'similar' || v.type === 'trash') return false; // the whole library: as chosen
  let n = 0, all = 0;
  for (const i of placeItems(v)) { all++; if (i.kind === 'link') n++; }
  return n > 0 && n * 2 > all;
}

export function layoutNow(v = S.view) {
  const m = chosen()[placeKey(v)];
  if (MODES.includes(m)) return m;
  if (mostlyLinks(v)) return 'list';
  return settings.layout === 'grid' ? 'grid' : 'masonry';
}

// a button of the dock (or the menu, the palette): this place keeps it; mosaic and grid also become the general one
export function chooseLayout(mode) {
  if (!MODES.includes(mode)) return;
  const all = { ...chosen() }, k = placeKey();
  delete all[k];
  all[k] = mode;
  const keys = Object.keys(all);
  for (const old of keys.slice(0, Math.max(0, keys.length - 300))) delete all[old];
  by = all;
  writePref(KEY, all);
  if (mode !== 'list' && settings.layout !== mode) setLayoutPrefs({ layout: mode });
}

export function syncLayoutBtns(mode = layoutNow()) {
  for (const [id, m] of [['lyM', 'masonry'], ['lyG', 'grid'], ['lyL', 'list']]) {
    const b = document.getElementById(id);
    if (!b) continue;
    b.classList.toggle('on', m === mode);
    b.setAttribute('aria-pressed', String(m === mode));
  }
  document.body.classList.toggle('ly-list', mode === 'list');
}
