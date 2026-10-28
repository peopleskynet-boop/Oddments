// The properties panel's heavier blocks (inspector.js leaves slots for them): «Экран приложения» (scrfields.js, with the
// guessing word lists of screens.js) and «Бренд» (brand.js). Loaded with the first selection, not at start.
import { esc } from '../util.js';
import { scrBlock, bindScr } from './scrfields.js';
import { checkPalette, checkModelRules } from '../lib/brand.js';
import { brandRules, rulesSource } from '../lib/brandrules.js';

// «Бренд»: the palette against the team's colours, a model against its limits (brand.js); folded, the summary says it
// a reference from elsewhere is not on our brand by definition: the check shows by itself only for the team's own work
// (a team file, or tagged «наше» / «бренд»); for the rest it is one link away
const OWN_TAGS = /^(наше|наш|бренд|brand)$/i;
let brandFor = null;
export const brandOpen = (id) => { brandFor = id; };
function brandBlock(it) {
  if (it.trashed || !(it.kind === 'image' || it.kind === 'psd' || it.kind === 'model')) return '';
  if (!it.team && !it.tags.some((t) => OWN_TAGS.test(t)) && brandFor !== it.id) return `<button class="lnk brand-ask" data-act="brandcheck" title="Палитра и фирменный цвет по правилам команды; для своих работ — тег «наше»">Проверить по бренду</button>`;
  const r = brandRules();
  const list = it.kind === 'model' ? (it.tris ? checkModelRules({ tris: it.tris }, r.model) : []) : checkPalette(it.colors, it.shares, r);
  if (!list.length) return '';
  const bad = list.filter((x) => x.level !== 'ok').length, err = list.some((x) => x.level === 'err');
  return `<details class="brand-blk${err ? ' err' : bad ? ' warn' : ''}"><summary><span>Бренд</span><em>${bad ? `замечаний: ${bad}` : 'по правилам'}</em></summary>` +
    `<ul>${list.map((x) => `<li class="${x.level}"><span>${esc(x.text)}</span>${x.how ? `<small>${esc(x.how)}</small>` : ''}</li>`).join('')}</ul>` +
    `<small class="hint">Правила: ${esc(rulesSource())}${it.kind === 'model' ? ' · полная проверка — в просмотре модели' : ''} · <button class="lnk" data-act="brandset">Настроить</button></small></details>`;
}


let bound = false;
export function fill(el, items, rerender) {
  if (!bound) { bound = true; bindScr(el, () => bindItems.current, rerender); }
  bindItems.current = items;
  const s = el.querySelector('[data-slot="scr"]'), b = el.querySelector('[data-slot="brand"]');
  if (s) s.outerHTML = scrBlock(items);
  if (b) b.outerHTML = items.length === 1 ? brandBlock(items[0]) : '';
}
const bindItems = { current: [] };
