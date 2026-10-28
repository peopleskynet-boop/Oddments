// «Разобрать» (#80): the files that are in no collection, each with the collection it looks like it belongs to. With
// AI the suggestion comes from the vectors (ai.js suggestFolders: close to a collection's mean as its own members are);
// without AI — a vote of its look-alike neighbours (palette, tags) that are in collections. One click files it there,
// «Другая» picks another, «Пропустить» hides it from this list (remembered); everything can be undone from the toast.
import './tidy.css';
import { S, ui, flatFolders } from '../state.js';
import { esc, plural } from '../util.js';
import { ic } from './icons.js';
import { assetUrl, saveIndex } from '../lib/library.js';
import { similarTo } from '../lib/similar.js';
import { toast } from './dialogs.js';
import { openPreview, isPreviewOpen } from './preview.js';
import { sfx } from './sound.js';
import { readPref, writePref } from '../lib/prefs.js';

const SKIP = 'perch.tidySkip';
let el = null, list = null, rows = [], shown = 0;
const skipped = () => new Set(readPref(SKIP, []));
const keepSkipped = (set) => writePref(SKIP, [...set].slice(-2000));

export const isTidyOpen = () => !!(el && !el.hidden);

function build() {
  el = document.createElement('section');
  el.className = 'tidy';
  el.hidden = true;
  el.setAttribute('aria-label', 'Разобрать');
  el.innerHTML = `<div class="orb-bar glass"><span class="orb-t">Разобрать</span><span class="td-sum cap-sm" aria-live="polite"></span>` +
    `<button type="button" class="ibtn pri" data-td="all" hidden></button>` +
    `<button type="button" class="ib" data-td="close" aria-label="Закрыть" title="Закрыть (Esc)">${ic('x')}</button></div>` +
    '<div class="td-list" tabindex="-1"></div>';
  document.getElementById('main').appendChild(el);
  list = el.querySelector('.td-list');
  el.addEventListener('click', onClick);
  el.addEventListener('change', (e) => {
    const s = e.target.closest('select[data-other]');
    if (s && s.value) file([s.dataset.other], s.value);
  });
  el.addEventListener('dblclick', (e) => { const c = e.target.closest('.td-c'); if (c) openPreview(c.dataset.id); });
  el.addEventListener('keydown', (e) => {
    if (isPreviewOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeTidy(); }
    else if (e.key !== 'Tab') e.stopPropagation(); // the grid's shortcuts stay off while the list is open
  });
  list.addEventListener('scroll', () => { if (list.scrollTop + list.clientHeight > list.scrollHeight - 600) more(); });
}

// without AI: the collections of its look-alikes vote, weighted by how alike; a suggestion needs two votes at least
function voteFolder(it, pool) {
  const near = similarTo(it, pool, 12);
  const w = new Map();
  near.forEach((x, i) => { for (const f of x.folders || []) w.set(f, (w.get(f) || 0) + (12 - i)); });
  const best = [...w].sort((a, b) => b[1] - a[1])[0];
  if (!best) return null;
  const votes = near.filter((x) => (x.folders || []).includes(best[0])).length;
  return votes >= 2 ? { folder: best[0], score: Math.min(1, votes / 6) } : null;
}

async function suggestions(items) {
  try {
    const ai = await import('../lib/ai.js');
    if (ai.aiReady()) { const m = ai.suggestFolders(items.map((x) => x.id)); if (m.size) return m; }
  } catch (e) { /* no AI */ }
  const pool = S.items.filter((x) => !x.trashed && x.folders && x.folders.length);
  const m = new Map();
  for (const it of items) { const s = voteFolder(it, pool); if (s) m.set(it.id, s); }
  return m;
}

export async function openTidy() {
  if (!el) build();
  sfx('orbit');
  el.hidden = false;
  document.body.classList.add('tidy-on');
  ui.renderSide();
  list.innerHTML = '<p class="td-empty">Смотрю, что куда…</p>';
  const skip = skipped();
  const loose = S.items.filter((x) => !x.trashed && (!x.folders || !x.folders.length) && !skip.has(x.id));
  const sug = await suggestions(loose);
  rows = loose.map((it) => ({ it, s: sug.get(it.id) || null }))
    .sort((a, b) => (b.s ? b.s.score : -1) - (a.s ? a.s.score : -1) || b.it.added - a.it.added);
  shown = 0;
  render();
  list.focus({ preventScroll: true });
}

export function closeTidy() {
  if (!el || el.hidden) return;
  el.hidden = true;
  document.body.classList.remove('tidy-on');
  sfx('close');
  ui.refresh();
}

const folderName = (id) => (S.folders.find((f) => f.id === id) || {}).name || '?';

function card(r) {
  const it = r.it;
  const opts = '<option value="">Другая…</option>' + flatFolders().map((x) => `<option value="${x.f.id}">${'— '.repeat(x.d)}${esc(x.f.name)}</option>`).join('');
  return `<div class="td-c" data-id="${it.id}" role="listitem">` +
    `<button class="td-ph" data-td="pv" title="${esc(it.name)}">${it.thumb ? `<img src="${assetUrl(it.thumb)}" alt="" loading="lazy" decoding="async">` : `<b>${esc((it.ext || it.kind).toUpperCase())}</b>`}</button>` +
    `<span class="td-n">${esc(it.name)}</span>` +
    `<div class="td-a">${r.s ? `<button class="pill pri td-go" data-td="go" title="Положить в «${esc(folderName(r.s.folder))}»">→ ${esc(folderName(r.s.folder))}</button>` : '<span class="td-none cap-sm">Нет подсказки</span>'}` +
    `<select data-other="${it.id}" aria-label="В другую подборку">${opts}</select>` +
    `<button class="ib td-skip" data-td="skip" aria-label="Пропустить" title="Пропустить — убрать из этого списка">${ic('x')}</button></div></div>`;
}

function more() {
  if (shown >= rows.length) return;
  const next = rows.slice(shown, shown + 120);
  list.querySelector('.td-grid').insertAdjacentHTML('beforeend', next.map(card).join(''));
  shown += next.length;
}

function summary() {
  const n = rows.length, k = rows.filter((r) => r.s).length;
  el.querySelector('.td-sum').textContent = n ? `${n} ${plural(n, ['файл', 'файла', 'файлов'])} без подборки · подсказок: ${k}` : '';
  const all = el.querySelector('[data-td="all"]');
  all.hidden = !k;
  all.textContent = `Принять все подсказки (${k})`;
}

function render() {
  summary();
  if (!S.folders.length) { list.innerHTML = '<div class="td-empty"><h2>Подборок пока нет</h2><p>Создайте подборку и положите в неё несколько файлов — Oddments начнёт подсказывать, куда класть остальные.</p></div>'; return; }
  if (!rows.length) { list.innerHTML = '<div class="td-empty"><h2>Всё разобрано</h2><p>Каждый файл лежит в какой-нибудь подборке.</p></div>'; return; }
  list.innerHTML = '<div class="td-grid" role="list"></div>';
  shown = 0;
  more();
}

// files them into a collection; undo from the toast
function file(ids, folder) {
  const done = [];
  for (const id of ids) {
    const it = S.byId.get(id);
    if (!it || (it.folders || []).includes(folder)) continue;
    it.folders = [...(it.folders || []), folder];
    done.push(it);
  }
  if (!done.length) return;
  saveIndex();
  sfx('add');
  drop(done.map((x) => x.id));
  toast(done.length === 1 ? `В «${folderName(folder)}»: ${done[0].name}` : `Разложено: ${done.length}`, 0, {
    fn: () => { for (const it of done) it.folders = it.folders.filter((f) => f !== folder); saveIndex(); openTidy(); },
  });
}

// cards leave the list (fade and fold), the rest close up
function drop(ids) {
  const set = new Set(ids);
  rows = rows.filter((r) => !set.has(r.it.id));
  shown = Math.max(0, shown - ids.length);
  for (const id of ids) {
    const c = list.querySelector(`.td-c[data-id="${CSS.escape(id)}"]`);
    if (!c) continue;
    if (document.body.classList.contains('motion')) { c.classList.add('gone'); setTimeout(() => c.remove(), 260); } else c.remove();
  }
  summary();
  ui.renderSide();
  if (!rows.length) setTimeout(render, 280);
}

function onClick(e) {
  const b = e.target.closest('[data-td]');
  if (!b) return;
  const a = b.dataset.td, c = b.closest('.td-c'), id = c && c.dataset.id;
  if (a === 'close') closeTidy();
  else if (a === 'all') {
    const by = new Map();
    for (const r of rows) if (r.s) { if (!by.has(r.s.folder)) by.set(r.s.folder, []); by.get(r.s.folder).push(r.it.id); }
    const done = [];
    for (const [f, ids] of by) for (const i of ids) { const it = S.byId.get(i); if (it && !(it.folders || []).includes(f)) { it.folders = [...(it.folders || []), f]; done.push([it, f]); } }
    if (!done.length) return;
    saveIndex(); sfx('add');
    drop(done.map((x) => x[0].id));
    toast(`Разложено по подсказкам: ${done.length}`, 0, { fn: () => { for (const [it, f] of done) it.folders = it.folders.filter((x) => x !== f); saveIndex(); openTidy(); } });
  } else if (a === 'go' && id) { const r = rows.find((x) => x.it.id === id); if (r && r.s) file([id], r.s.folder); }
  else if (a === 'skip' && id) {
    const s = skipped(); s.add(id); keepSkipped(s);
    drop([id]);
    toast('Пропущено', 0, { fn: () => { const s2 = skipped(); s2.delete(id); keepSkipped(s2); openTidy(); } });
  } else if (a === 'pv' && id) { S.sel = new Set([id]); S.last = id; ui.refresh(); }
}
