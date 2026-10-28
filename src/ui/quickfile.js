// "Where should it go?" pill after adding files (idea from Memotron's "link to curate"):
// a glass bar at the bottom for ~6 s — put the new files into a collection, tag them, or undo.
// Stays while hovered or focused; Esc closes it.
import { canonical } from '../lib/glossary.js';
import { glossary } from '../lib/teamconf.js';
import { S, ui, flatFolders, folderById, activeItems } from '../state.js';
import { esc, plural, uid } from '../util.js';
import { ic } from './icons.js';
import { assetUrl, saveIndex, trashItems } from '../lib/library.js';
import { ask, toast } from './dialogs.js';
import { sfx } from './sound.js';

const LIFE = 6000;
let el = null, items = [], timer = null, done = []; // done: what was applied, shown in the label

export const isQuickOpen = () => !!(el && el.classList.contains('on'));

function root() {
  if (el) return el;
  el = document.createElement('div');
  el.className = 'qf glass';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Только что добавлено');
  document.getElementById('app').appendChild(el);
  // hover or keyboard focus keeps it open
  el.addEventListener('pointerenter', hold);
  el.addEventListener('pointerleave', () => { if (!el.contains(document.activeElement)) arm(); });
  el.addEventListener('focusin', hold);
  el.addEventListener('focusout', (e) => { if (!el.contains(e.relatedTarget) && !el.matches(':hover')) arm(); });
  el.addEventListener('click', onClick);
  el.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', (e) => { if (isQuickOpen() && !e.target.closest('.qf')) closeMenu(); });
  return el;
}

function hold() { clearTimeout(timer); }
function arm(ms = LIFE) { clearTimeout(timer); timer = setTimeout(closeQuick, ms); }

export function showQuickFile(added) {
  const list = (added || []).filter(Boolean);
  if (!list.length) return;
  sfx('add');
  root();
  items = list;
  done = [];
  draw();
  el.hidden = false;
  el.classList.remove('on');
  void el.offsetWidth; // restart the entrance animation
  el.classList.add('on');
  if (!el.matches(':hover') && !el.contains(document.activeElement)) arm();
}

export function closeQuick() {
  clearTimeout(timer);
  if (!el || !isQuickOpen()) return;
  const hadFocus = el.contains(document.activeElement);
  el.classList.remove('on');
  setTimeout(() => { if (!isQuickOpen()) el.hidden = true; }, 250);
  if (hadFocus) document.getElementById('grid').focus({ preventScroll: true });
}

function draw() {
  const n = items.length;
  const thumbs = items.slice(0, 3).map((it) => it.thumb ? `<img src="${assetUrl(it.thumb)}" alt="">` : `<i>${esc((it.ext || '?').slice(0, 4))}</i>`).join('');
  const label = `Добавлено ${n}` + (done.length ? ` · ${done.map(esc).join(', ')}` : '');
  // added while a search, colour filter or another section hides them: say so and offer to show them
  const vis = new Set(S.vis), hidden = items.some((it) => !vis.has(it));
  el.innerHTML = `<span class="qf-th" aria-hidden="true">${thumbs}</span><span class="qf-n" aria-live="polite">${label}</span>` +
    (hidden ? `<button type="button" class="qf-b" data-qf="show" title="${S.q || S.color ? 'Скрыто фильтром' : 'Не входит в этот раздел'}">Показать</button>` : '') +
    `<span class="qf-sep" aria-hidden="true"></span>` +
    `<div class="qf-dd"><button type="button" class="qf-b" data-qf="folder" aria-haspopup="menu" aria-expanded="false">В подборку${ic('chev')}</button></div>` +
    `<button type="button" class="qf-b" data-qf="tag">${ic('plus')}тег</button>` +
    `<button type="button" class="qf-b warn" data-qf="undo">Отменить</button>` +
    `<button type="button" class="qf-x" data-qf="close" aria-label="Закрыть" title="Закрыть (Esc)">${ic('x')}</button>`;
}

function onClick(e) {
  const b = e.target.closest('[data-qf], [data-fid]');
  if (!b) return;
  if (b.dataset.fid != null) return pickFolder(b.dataset.fid);
  const a = b.dataset.qf;
  if (a === 'folder') toggleMenu(b);
  else if (a === 'tag') tagInput(b);
  else if (a === 'undo') undo();
  else if (a === 'show') showAdded();
  else if (a === 'close') closeQuick();
}

// reset the search and filters, open «Все файлы» and select what was just added
function showAdded() {
  S.q = ''; S.color = null;
  const q = document.getElementById('q'); if (q) q.value = '';
  S.view = { type: 'all', id: null };
  S.sel = new Set(items.map((it) => it.id));
  S.last = items[0].id;
  ui.refresh();
  draw();
}

/* ---------- collections menu ---------- */
function toggleMenu(btn) {
  const dd = btn.parentElement, open = dd.querySelector('.qf-menu');
  if (open) return closeMenu(true);
  const fl = flatFolders();
  const rows = fl.map((x) => {
    const on = items.every((it) => it.folders.includes(x.f.id));
    return `<button type="button" role="menuitemcheckbox" aria-checked="${on}" class="mi" data-fid="${x.f.id}" style="padding-left:${12 + x.d * 14}px"><span>${esc(x.f.name)}</span>${on ? '✓' : ''}</button>`;
  }).join('');
  dd.insertAdjacentHTML('beforeend', `<div class="qf-menu glass" role="menu" aria-label="Подборки">${rows}<button type="button" role="menuitem" class="mi" data-fid="">${ic('plus')}<span>Новая подборка…</span></button></div>`);
  btn.setAttribute('aria-expanded', 'true');
  const first = dd.querySelector('.qf-menu .mi');
  if (first) first.focus();
}

function closeMenu(refocus) {
  const m = el && el.querySelector('.qf-menu');
  if (!m) return false;
  m.remove();
  const b = el.querySelector('[data-qf="folder"]');
  b.setAttribute('aria-expanded', 'false');
  if (refocus) b.focus();
  return true;
}

async function pickFolder(fid) {
  if (!fid) {
    closeMenu();
    hold();
    const name = await ask('Новая подборка');
    if (!name) { arm(); return; }
    fid = uid();
    S.folders.push({ id: fid, name, parent: null, open: true });
  }
  const f = folderById(fid);
  const on = !items.every((it) => it.folders.includes(fid));
  items.forEach((it) => {
    const i = it.folders.indexOf(fid);
    if (on && i < 0) it.folders.push(fid);
    if (!on && i >= 0) it.folders.splice(i, 1);
  });
  saveIndex();
  ui.refresh();
  const tag = '«' + (f ? f.name : '') + '»';
  done = on ? [...done.filter((d) => d !== tag), tag] : done.filter((d) => d !== tag);
  draw();
  el.querySelector('[data-qf="folder"]').focus();
}

/* ---------- tags ---------- */
function tagInput(btn) {
  const known = new Map();
  activeItems().forEach((i) => i.tags.forEach((t) => known.set(t, (known.get(t) || 0) + 1)));
  const opts = Array.from(known.entries()).sort((a, b) => b[1] - a[1]).slice(0, 60).map((t) => `<option value="${esc(t[0])}">`).join('');
  btn.outerHTML = `<input class="qf-in" id="qfTag" type="text" placeholder="Тег и Enter" list="qfTags" autocomplete="off" aria-label="Тег для добавленных файлов"><datalist id="qfTags">${opts}</datalist>`;
  el.querySelector('#qfTag').focus();
}

function applyTags(raw) {
  const tags = raw.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
  if (!tags.length) return;
  const g = glossary(); // the team's dictionary form of each tag (glossary.js)
  items.forEach((it) => tags.map((t) => canonical(t, g)).filter(Boolean).forEach((t) => { if (!it.tags.includes(t)) it.tags.push(t); }));
  saveIndex();
  ui.refresh();
  tags.forEach((t) => { const d = '#' + t; if (!done.includes(d)) done.push(d); });
}

/* ---------- undo ---------- */
function undo() {
  const list = items.filter((it) => !it.trashed);
  trashItems(list);
  list.forEach((it) => S.sel.delete(it.id));
  ui.refresh();
  closeQuick();
  toast('Отменено: ' + list.length + ' ' + plural(list.length, ['файл', 'файла', 'файлов']) + ' в корзине');
}

/* ---------- keyboard ---------- */
function onKey(e) {
  const t = e.target;
  if (t.id === 'qfTag') {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (t.value.trim()) { applyTags(t.value); draw(); el.querySelector('[data-qf="tag"]').focus(); }
    } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); draw(); el.querySelector('[data-qf="tag"]').focus(); }
    return;
  }
  const menu = t.closest('.qf-menu');
  if (menu && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End')) {
    e.preventDefault();
    const list = Array.from(menu.querySelectorAll('.mi')), i = list.indexOf(t);
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
    list[j].focus();
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault(); e.stopPropagation();
    if (!closeMenu(true)) closeQuick();
    return;
  }
  // left/right walk the pill's buttons like a toolbar
  if (!menu && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    const list = Array.from(el.querySelectorAll(':scope > button, :scope > .qf-dd > button'));
    const i = list.indexOf(t);
    if (i < 0) return;
    e.preventDefault();
    list[(i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length].focus();
  }
  e.stopPropagation(); // keep grid shortcuts (Delete, arrows, Space) away while working in the pill
}
