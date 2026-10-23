// "Duplicates" view: groups of exact copies and of similar pictures (lib/dupes.js). In each group you pick
// the file to keep (the best one is suggested); the rest go to the trash — never deleted for good — and their
// tags, collections, favourite mark, note and link move to the kept file. «Отменить» puts everything back.
import './dupes.css';
import { S, ui } from '../state.js';
import { esc, fmtSize, plural } from '../util.js';
import { ic } from './icons.js';
import { assetUrl, saveIndex, trashItems, restoreItems } from '../lib/library.js';
import { findDuplicates, suggestKeep } from '../lib/dupes.js';
import { toast } from './dialogs.js';
import { openPreview, isPreviewOpen } from './preview.js';
import { sfx } from './sound.js';

let el = null, list = null, groups = [], undoStack = [], running = false, confirming = false;
const dateFmt = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', year: 'numeric' });

export const isDupesOpen = () => !!(el && !el.hidden);

export function initDupes() {
  el = document.createElement('section');
  el.className = 'dupes';
  el.hidden = true;
  el.setAttribute('aria-label', 'Дубликаты');
  // the bar carries everything about the whole list: summary, search progress, the bulk action and its
  // confirmation (asked in place, not in a modal: the list stays visible while you decide)
  el.innerHTML = `<div class="orb-bar glass"><span class="orb-t">Дубликаты</span>` +
    `<span class="dp-norm"><span class="dp-sum cap-sm" aria-live="polite"></span>` +
    `<button type="button" class="ibtn flat" data-dp="undo" hidden>${ic('restore')}Отменить</button>` +
    `<button type="button" class="ibtn" data-dp="all" hidden>Убрать все лишние</button></span>` +
    `<span class="dp-conf" role="alertdialog" aria-labelledby="dpQ" hidden><span class="dp-q" id="dpQ"></span>` +
    `<button type="button" class="ibtn flat" data-dp="no">Не сейчас</button>` +
    `<button type="button" class="ibtn pri" data-dp="yes"></button></span>` +
    `<button type="button" class="ib" data-dp="close" aria-label="Закрыть дубликаты" title="Закрыть (Esc)">${ic('x')}</button>` +
    `<i class="dp-prog" hidden aria-hidden="true"><b></b></i></div>` +
    '<div class="dp-list" tabindex="-1"></div>';
  document.getElementById('main').appendChild(el);
  list = el.querySelector('.dp-list');
  el.addEventListener('click', onClick);
  el.addEventListener('change', (e) => { if (e.target.matches('input[type=radio]')) mark(e.target.closest('.dg')); });
  // the inspector follows the card you are looking at (focus or click), so you can compare tags and size
  el.addEventListener('focusin', (e) => { const c = e.target.closest('.dc'); if (c) inspect(c.dataset.id); });
  el.addEventListener('dblclick', (e) => { const c = e.target.closest('.dc'); if (c) openPreview(c.dataset.id); });
  el.addEventListener('keydown', (e) => {
    if (isPreviewOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (confirming) { askAll(false); el.querySelector('[data-dp="all"]').focus(); } else closeDupes(); }
    else if (e.key !== 'Tab') e.stopPropagation(); // grid shortcuts stay off while the list is open
  });
}

export async function openDupes() {
  if (running) return;
  sfx('orbit');
  el.hidden = false;
  document.body.classList.add('dupes-on');
  ui.renderSide();
  askAll(false);
  list.innerHTML = '<p class="dp-empty">Ищу дубликаты…</p>';
  el.querySelector('[data-dp="all"]').hidden = true;
  el.querySelector('[data-dp="undo"]').hidden = true;
  running = true;
  progress('Ищу дубликаты…', 0);
  let failed = false;
  try {
    const r = await findDuplicates((d, n, stage) => progress(stage === 'exact' ? `Сравниваю файлы: ${d} из ${n}` : `Сравниваю картинки: ${d} из ${n}`, d / Math.max(1, n)));
    groups = [
      ...r.exact.map((g) => ({ exact: true, items: g, keep: suggestKeep(g, true).id })),
      ...r.similar.map((g) => ({ exact: false, items: g, keep: suggestKeep(g, false).id })),
    ];
    if (r.skipped) toast(`Не проверено файлов: ${r.skipped} — больше 300 МБ или не читаются. Остальные проверены.`, 5000);
  } catch (e) {
    console.warn(e);
    groups = [];
    failed = true;
  }
  running = false;
  progress(null);
  if (failed) {
    list.innerHTML = '<div class="dp-empty"><h2>Не получилось проверить</h2><p>Файлы не тронуты. Попробуйте ещё раз; если повторится — перезапустите Oddments.</p>' +
      '<button type="button" class="ibtn" data-dp="retry">Проверить ещё раз</button></div>';
    sfx('error');
    return;
  }
  if (isDupesOpen()) render();
}

export function closeDupes() {
  if (!isDupesOpen()) return;
  sfx('close');
  el.hidden = true;
  document.body.classList.remove('dupes-on');
  groups = [];
  list.innerHTML = '';
  ui.renderSide();
  ui.refresh();
  document.getElementById('grid').focus({ preventScroll: true });
}

// search progress lives in the bar (a thin line along its bottom), not in a separate pill on top of it
function progress(text, frac) {
  const bar = el.querySelector('.dp-prog');
  bar.hidden = text == null;
  if (text == null) return;
  el.querySelector('.dp-sum').textContent = text;
  bar.firstChild.style.width = Math.round(Math.max(0.03, Math.min(1, frac)) * 100) + '%';
}

// shows one file in the inspector without touching the grid underneath
function inspect(id) {
  if (!S.byId.get(id) || (S.sel.size === 1 && S.sel.has(id))) return;
  S.sel = new Set([id]); S.last = id;
  ui.renderInsp();
}

function extra(g) {
  return g.items.filter((x) => x.id !== g.keep && !x.trashed);
}

function render() {
  const live = groups.filter((g) => !g.done && extra(g).length);
  const nExtra = live.reduce((n, g) => n + extra(g).length, 0);
  const bytes = live.reduce((n, g) => n + (g.exact ? extra(g).reduce((s, x) => s + x.size, 0) : 0), 0);
  el.querySelector('.dp-sum').textContent = live.length
    ? `${live.length} ${plural(live.length, ['группа', 'группы', 'групп'])} · лишних ${nExtra}` + (bytes ? ` · ${fmtSize(bytes)}` : '')
    : '';
  const all = el.querySelector('[data-dp="all"]');
  all.hidden = !live.length;
  all.textContent = `Убрать все лишние (${nExtra})`;
  el.querySelector('[data-dp="undo"]').hidden = !undoStack.length;
  if (confirming && !live.length) askAll(false);
  // the inspector starts on the file suggested for keeping in the first group, not on the view behind
  const ids = new Set(live.flatMap((g) => g.items.map((x) => x.id)));
  if (live.length && !Array.from(S.sel).some((id) => ids.has(id))) inspect(live[0].keep);
  if (!live.length) {
    list.innerHTML = `<div class="dp-empty"><h2>${groups.length ? 'Готово' : 'Дубликатов не нашлось'}</h2><p>${groups.length
      ? 'Лишние копии в корзине, теги и подборки перенесены на оставленные файлы.'
      : 'Точных копий и очень похожих картинок в библиотеке нет.'}</p></div>`;
    return;
  }
  list.innerHTML = live.map((g) => {
    const i = groups.indexOf(g);
    const ex = extra(g);
    const head = g.exact
      ? `<b>Точные копии</b><span>${g.items.length} ${plural(g.items.length, ['файл', 'файла', 'файлов'])} · лишние ${fmtSize(ex.reduce((s, x) => s + x.size, 0))}</span>`
      : `<b>Похожие</b><span>${g.items.length} ${plural(g.items.length, ['картинка', 'картинки', 'картинок'])} · почти одинаковые на вид</span>`;
    return `<section class="dg" data-g="${i}"><header>${head}<span class="sp"></span>` +
      `<button type="button" class="ibtn flat" data-dp="skip">Пропустить</button>` +
      `<button type="button" class="ibtn" data-dp="apply">${ic('trash')}В корзину: ${ex.length}</button></header>` +
      `<div class="dg-row" role="radiogroup" aria-label="Какой файл оставить">${g.items.map((x) => card(x, i, x.id === g.keep)).join('')}</div></section>`;
  }).join('');
}

function card(x, gi, keep) {
  const meta = [x.w ? `${Math.round(x.w)}×${Math.round(x.h)}` : '', fmtSize(x.size), dateFmt.format(x.added)].filter(Boolean).join(' · ');
  const where = [...x.folders.map((f) => { const fo = S.folders.find((y) => y.id === f); return fo ? fo.name : ''; }).filter(Boolean), ...x.tags.map((t) => '#' + t)].join(' · ');
  return `<label class="dc${keep ? ' keep' : ''}" data-id="${esc(x.id)}">` +
    `<input type="radio" name="dg${gi}" value="${esc(x.id)}"${keep ? ' checked' : ''} aria-label="Оставить «${esc(x.name)}», ${esc(meta)}">` +
    `<span class="dc-img">${x.thumb ? `<img src="${assetUrl(x.thumb)}" alt="" decoding="async" draggable="false">` : `<b>${esc((x.ext || '').toUpperCase())}</b>`}` +
    `<span class="dc-st" aria-hidden="true">${ic('check')}</span></span>` +
    `<span class="dc-s" aria-hidden="true">${keep ? 'Оставить' : ic('trash') + 'В корзину'}</span>` +
    `<span class="dc-n" title="${esc(x.name)}.${esc(x.ext)}">${esc(x.name)}.${esc(x.ext)}</span><span class="dc-m">${esc(meta)}</span>` +
    (where ? `<span class="dc-f">${esc(where)}</span>` : '') +
    `<button type="button" class="dc-pv" data-dp="pv" aria-label="Открыть «${esc(x.name)}»" title="Открыть">${ic('zoom')}</button></label>`;
}

// the chosen card in a group: re-render and put focus back on the same radio
function mark(sec) {
  const g = groups[+sec.dataset.g], r = sec.querySelector('input:checked');
  if (!g || !r) return;
  g.keep = r.value;
  render();
  const again = list.querySelector(`.dg[data-g="${sec.dataset.g}"] input[value="${CSS.escape(g.keep)}"]`);
  if (again) again.focus();
}

function onClick(e) {
  const b = e.target.closest('[data-dp]');
  if (!b) return;
  const a = b.dataset.dp, sec = b.closest('.dg'), g = sec ? groups[+sec.dataset.g] : null;
  if (a === 'close') closeDupes();
  else if (a === 'pv') { e.preventDefault(); openPreview(b.closest('.dc').dataset.id); }
  else if (a === 'skip' && g) { g.done = true; render(); }
  else if (a === 'apply' && g) apply([g]);
  else if (a === 'all') askAll(true);
  else if (a === 'no') { askAll(false); el.querySelector('[data-dp="all"]').focus(); }
  else if (a === 'yes') { askAll(false); apply(groups.filter((x) => !x.done && extra(x).length)); }
  else if (a === 'undo') undo();
  else if (a === 'retry') openDupes();
}

// «Убрать все лишние» is the riskiest batch action in Oddments: say exactly what will happen and ask once
function askAll(on) {
  const live = groups.filter((g) => !g.done && extra(g).length);
  confirming = !!on && live.length > 0;
  el.querySelector('.dp-norm').hidden = confirming;
  el.querySelector('.dp-conf').hidden = !confirming;
  if (!confirming) return;
  const n = live.reduce((s, g) => s + extra(g).length, 0);
  const sim = live.filter((g) => !g.exact).length;
  const q = el.querySelector('#dpQ');
  q.textContent = q.title = `${n} ${plural(n, ['файл', 'файла', 'файлов'])} из ${live.length} ${plural(live.length, ['группы', 'групп', 'групп'])} уйдут в корзину` +
    (sim ? `, в ${sim} ${plural(sim, ['группе', 'группах', 'группах'])} не точные копии, а похожие` : '') + '. Теги и подборки — на оставленные.';
  const yes = el.querySelector('[data-dp="yes"]');
  yes.textContent = `В корзину: ${n}`;
  yes.focus();
}

// keep one file per group, move the rest to the trash and their metadata to the kept file
function apply(list) {
  const step = [];
  let n = 0, nTags = 0, nFolders = 0;
  for (const g of list) {
    const keep = S.byId.get(g.keep), rest = extra(g);
    if (!keep || !rest.length) continue;
    step.push({ g, keep, before: { tags: keep.tags.slice(), folders: keep.folders.slice(), fav: keep.fav, note: keep.note, url: keep.url }, rest });
    for (const x of rest) {
      x.tags.forEach((t) => { if (!keep.tags.includes(t)) { keep.tags.push(t); nTags++; } });
      x.folders.forEach((f) => { if (!keep.folders.includes(f)) { keep.folders.push(f); nFolders++; } });
      keep.fav = keep.fav || x.fav;
      if (!keep.note && x.note) keep.note = x.note;
      if (!keep.url && x.url) keep.url = x.url;
    }
    trashItems(rest);
    rest.forEach((x) => S.sel.delete(x.id));
    g.done = true;
    n += rest.length;
  }
  if (!step.length) return;
  undoStack.push(step);
  saveIndex();
  ui.renderSide();
  render();
  ui.renderInsp();
  // the end of the flow says what happened to the tags and collections too, and can be taken back right here
  const moved = [nTags && `${nTags} ${plural(nTags, ['тег', 'тега', 'тегов'])}`, nFolders && `${nFolders} ${plural(nFolders, ['подборка', 'подборки', 'подборок'])}`].filter(Boolean);
  toast(`В корзину: ${n} ${plural(n, ['файл', 'файла', 'файлов'])}` + (moved.length ? ` · перенесено: ${moved.join(' и ')}` : ''), 6000, { fn: undo });
}

function undo() {
  const step = undoStack.pop();
  if (!step) return;
  for (const s of step) {
    Object.assign(s.keep, s.before);
    restoreItems(s.rest);
    s.g.done = false;
  }
  saveIndex();
  ui.renderSide();
  render();
  ui.renderInsp();
  toast('Возвращено из корзины');
}
