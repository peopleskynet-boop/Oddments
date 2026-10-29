// Right-click menus, all in one look: on cards (also the Menu key / Shift+F10 on the focused card), on the
// empty wall (adding, the view) and in the full-screen preview (copy the picture, the colour under the cursor,
// keep a video frame). The webview's own menu (Back / Refresh / Print / Save image as) never shows, except in
// text fields. Glass, v3 style; arrows move, → / Enter open a submenu, ← / Esc go back, click outside closes.
import { S, ui, flatFolders, folderById, isSplatItem, isPic } from '../state.js';
import { esc, isMac } from '../util.js';
import { ic } from './icons.js';
import { saveIndex, trashItems, restoreItems, absPath } from '../lib/library.js';
import { setView } from '../lib/filter.js';
import { openPreview } from './preview.js';
import { syncCard } from './grid.js';
import { toast } from './dialogs.js';
import { openRename } from './lazy.js';
import { revealItemInDir, openPath, openUrl } from '@tauri-apps/plugin-opener';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { sfx } from './sound.js';
import { t } from '../lib/i18n.js';

let menu = null, sub = null, back = null, onSel = () => {};
// mode: 'card' (the selection), 'space' (the empty wall), 'preview' (the open file, forced); at: where in the
// picture the click was (fractions) and the video time, for the preview
let mode = 'card', forced = null, at = null;
const selItems = () => forced || Array.from(S.sel).map((id) => S.byId.get(id)).filter(Boolean);
const typing = (t) => t.closest && t.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
export const isMenuOpen = () => !!menu;

export function initContextMenu(selectionChanged) {
  onSel = selectionChanged;
  const grid = document.getElementById('grid');
  grid.addEventListener('contextmenu', (e) => {
    const c = e.target.closest('.card');
    if (!c) return;
    e.preventDefault();
    if (!S.sel.has(c.dataset.id)) { S.sel = new Set([c.dataset.id]); S.last = c.dataset.id; onSel(); }
    mode = 'card'; forced = null;
    openMenu(e.clientX, e.clientY);
  });
  // everywhere else: our menu where there is something to offer, never the webview's
  document.addEventListener('contextmenu', (e) => {
    if (e.defaultPrevented || typing(e.target)) return;
    e.preventDefault();
    const t = e.target;
    if (t.closest('.ctx')) return;
    const pv = t.closest('#pv');
    if (pv && S.previewId) {
      const it = S.byId.get(S.previewId), media = pv.querySelector('.zi, .pv-hold video');
      let fx = null, fy = null;
      if (media && (media === t || media.contains(t))) {
        const r = media.getBoundingClientRect();
        fx = (e.clientX - r.left) / r.width; fy = (e.clientY - r.top) / r.height;
      }
      const time = media && media.tagName === 'VIDEO' ? media.currentTime : 0;
      if (it) { mode = 'preview'; forced = [it]; at = { fx, fy, time }; openMenu(e.clientX, e.clientY); }
      return;
    }
    // the empty wall: anywhere in the scrolling area that is not a card or a row of controls
    if (t.closest('#scroll') && !t.closest('.card, .tabrow, .head, .covers, .newbar')) { mode = 'space'; forced = null; openMenu(e.clientX, e.clientY); }
  });
  // keyboard: Menu key or Shift+F10 opens it for the keyboard cursor
  document.addEventListener('keydown', (e) => {
    if (!(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) || !S.sel.size || menu) return;
    const t = e.target;
    if (t.closest && t.closest('input, textarea, select, [contenteditable], .pv.on, .insp, .side, .qf')) return;
    e.preventDefault();
    const cur = grid.querySelector('.card.cur') || grid.querySelector('.card.sel');
    const r = cur ? cur.getBoundingClientRect() : grid.getBoundingClientRect();
    mode = 'card'; forced = null;
    openMenu(r.left + Math.min(40, r.width / 2), r.top + Math.min(40, r.height / 2));
  });
  document.addEventListener('pointerdown', (e) => { if (menu && !(e.target.closest && e.target.closest('.ctx'))) closeMenu(); }, true);
  // Esc closes the menu wherever the focus is: a menu opened with the mouse leaves the focus where it was (the search
  // box, a card), and its own key handler never heard the Esc. It closes only the menu, not the preview under it.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !menu || (e.target.closest && e.target.closest('.ctx'))) return;
    e.preventDefault(); e.stopImmediatePropagation();
    closeMenu();
  }, true);
  window.addEventListener('blur', () => closeMenu());
  document.getElementById('scroll').addEventListener('scroll', () => closeMenu(), { passive: true });
  window.addEventListener('resize', () => closeMenu());
}

// the program the file belongs to: named where it is obvious, otherwise "the program" set in Windows
const APPS = { psd: 'Photoshop', psb: 'Photoshop', ai: 'Illustrator', blend: 'Blender', abc: 'Blender', fig: 'Figma' };
export function appLabel(it) {
  if (it.kind === 'link') return /figma\.com/.test(it.url || '') ? 'Открыть в Figma' : 'Открыть ссылку';
  return APPS[it.ext] ? 'Открыть в ' + APPS[it.ext] : 'Открыть в программе';
}

// a link card opens only a web address, never the .url file itself: Windows would hand any protocol inside it
// (search-ms:, file://server/…) to its handler (audit #39)
export const webUrl = (u) => /^https?:\/\//i.test(String(u || '').trim());
export async function openInApp(it) {
  try {
    if (it.kind === 'link') {
      let url = it.url;
      if (!webUrl(url)) { try { const { urlFromShortcut } = await import('../lib/figma.js'); url = urlFromShortcut(new TextDecoder().decode(await (await import('@tauri-apps/plugin-fs')).readFile(absPath(it.file)))); } catch (e) { url = ''; } }
      if (webUrl(url)) await openUrl(url); else toast('Эта ссылка ведёт не на веб-страницу (не http/https) — Oddments её не открывает.');
    } else await openPath(absPath(it.file));
  } catch (err) { toast('Не удалось открыть: для этого типа файлов в Windows не выбрана программа. Выберите её в «Открыть с помощью» в Проводнике.'); }
}

function rows() {
  if (mode === 'space') return spaceRows();
  if (mode === 'preview') return previewRows();
  return cardRows();
}

function spaceRows() {
  const grid = document.getElementById('lyG').classList.contains('on');
  return [
    { id: 'sp-paste', icon: 'paste', label: 'Вставить', key: 'Ctrl V' },
    { id: 'sp-add', icon: 'plus', label: 'Добавить файлы…' },
    { id: 'sp-dir', icon: 'folderplus', label: 'Добавить папку…' },
    { id: 'sp-folder', icon: 'folder', label: 'Новая подборка' },
    { id: 'sp-svg', icon: 'cube', label: 'SVG в 3D…' },
    { id: 'sp-mat', icon: 'sphere', label: 'Материал из текстур…' },
    { sep: true },
    { id: grid ? 'sp-masonry' : 'sp-grid', icon: grid ? 'masonry' : 'grid', label: grid ? 'Мозаика' : 'Сетка' },
    { id: 'sp-all', icon: 'all', label: 'Выделить всё', key: 'Ctrl A' },
    { id: 'sp-clean', icon: 'sideL', label: document.body.classList.contains('clean') ? 'Обычный вид' : 'Чистый экран', key: '\\' },
    { sep: true },
    { id: 'sp-cmd', icon: 'search', label: 'Команды', key: isMac ? '⌘ K' : 'Ctrl Space' },
    { id: 'sp-set', icon: 'gear', label: 'Настройки' },
  ];
}

// the open file: what only the preview can do first (it knows the point and the frame), then the card's own
function previewRows() {
  const it = forced[0], r = [];
  const pic = it.kind === 'image' || it.kind === 'gif' || (it.kind === 'psd' && it.preview);
  if (pic) r.push({ id: 'pv-copy', icon: 'copy', label: 'Копировать картинку' });
  if (pic && at && at.fx != null) r.push({ id: 'pv-hex', icon: 'palette', label: 'Копировать цвет под курсором' });
  if (it.kind === 'video') {
    r.push({ id: 'pv-frame', icon: 'image', label: 'Кадр — в библиотеку' });
    r.push({ id: 'pv-fcopy', icon: 'copy', label: 'Копировать кадр' });
  }
  if (r.length) r.push({ sep: true });
  const card = cardRows().filter((x) => !['open', 'rename', 'trash', 'similar'].includes(x.id))
    .filter((x, i, a) => !(x.sep && (i === 0 || a[i - 1].sep))); // no line at the top or two in a row
  while (card.length && card[card.length - 1].sep) card.pop();
  return r.concat(card);
}

// the rows of the «Копировать» and «Ещё» submenus, filled by cardRows
let lists = { copy: [], more: [] };

function cardRows() {
  const items = selItems(), one = items.length === 1 ? items[0] : null;
  const trash = items.every((i) => i.trashed);
  const allFav = items.every((i) => i.fav);
  // in groups with lines between them: open · organise · make · copy, the rest, name · delete. What is used rarely sits
  // in «Ещё», the copies in «Копировать» (audit 29.10: one picture's menu had 18 rows)
  const open = [], keep = [], make = [], out = [], more = [], copy = [];
  if (one) open.push({ id: 'open', icon: 'zoom', label: 'Просмотр', key: 'Пробел' });
  if (one) open.push({ id: 'app', icon: 'external', label: appLabel(one), key: 'Ctrl Enter' });
  if (one) open.push({ id: 'reveal', icon: 'folder', label: 'Показать в папке' });
  if (trash) return [...open, ...(open.length ? [{ sep: true }] : []), { id: 'restore', icon: 'restore', label: items.length > 1 ? `Вернуть (${items.length})` : 'Вернуть' }];
  keep.push({ id: 'fav', icon: allFav ? 'heartOn' : 'heart', label: allFav ? 'Убрать из избранного' : 'В избранное', key: 'F' });
  keep.push({ id: 'folder', icon: 'folderplus', label: 'В подборку', sub: true });
  if (one) keep.push({ id: 'similar', icon: 'scan', label: 'Похожие' });
  const pics = items.filter(isPic);
  if (pics.length) make.push({ id: 'cutout', icon: 'scissors', label: pics.length > 1 ? `Убрать фон (${pics.length})…` : 'Убрать фон…', key: 'B' });
  if (one && isPic(one) && one.ext !== 'svg') make.push({ id: 'upscale', icon: 'sparkle', label: 'Увеличить ×2 / ×4…', key: 'U' });
  if (one && one.ext === 'svg') { make.push({ id: 's3d', icon: 'cube', label: 'Сделать 3D…' }); more.push({ id: 'ik', icon: 'grid', label: 'Открыть в конструкторе иконок' }); }
  if (one && one.kind === 'model' && !['blend', 'abc'].includes(one.ext) && !isSplatItem(one) && !isMac) make.push({ id: 's3d', icon: 'cube', label: 'Ремеш…' }); // AutoRemesher: Windows only
  if (one && one.kind === 'model' && !isSplatItem(one) && (!['blend', 'abc'].includes(one.ext) || one.glb)) make.push({ id: 'splatmk', icon: 'splat', label: 'Сделать сплат…' });
  if (one && one.kind === 'video') make.push({ id: 'flow', icon: 'flow', label: 'Нарезать на экраны…' });
  const svgs = items.filter((i) => i.ext === 'svg');
  if (svgs.length) make.push({ id: 'svgfix', icon: 'bezier', label: svgs.length > 1 ? `Исправить SVG (${svgs.length})…` : 'Исправить SVG…' });
  if (svgs.length > 1) make.push({ id: 's3dset', icon: 'cube', label: `Набор в 3D → Blender (${svgs.length})` });
  if (items.some((i) => i.kind === 'model' || i.kind === 'material')) make.push({ id: 'blender', icon: 'external', label: items.length > 1 ? `В Blender (${items.length})` : 'В Blender' });
  if (one && one.ocr) copy.push({ id: 'ocrcopy', icon: 'copy', label: 'Текст с картинки' });
  if (one && (one.kind === 'image' || one.kind === 'psd' || one.kind === 'gif' || one.thumb)) more.push({ id: 'notes', icon: 'chat', label: one.notes && one.notes.length ? `Комментарии (${one.notes.length})…` : 'Комментировать…' });
  if (pics.length) more.push({ id: 'mask', icon: 'shield', label: pics.length > 1 ? `Скрыть личные данные (${pics.length})…` : 'Скрыть личные данные…' });
  // the team's own work is checked by itself in the panel; anything else on request (it was a link under every file)
  if (one && !one.team && ['image', 'psd', 'model'].includes(one.kind) && !one.tags.some((t) => /^(наше|наш|бренд|brand)$/i.test(t))) more.push({ id: 'brand', icon: 'palette', label: 'Проверить по бренду' });
  // the team library (team.js): one's files go to the team; a team file comes into one's own library
  if (items.every((i) => i.team)) more.push({ id: 'teamtake', icon: 'download', label: 'В мою библиотеку' });
  else if (items.every((i) => !i.team)) more.push({ id: 'toteam', icon: 'team', label: (S.teams || []).length ? 'В команду…' : 'В команду: подключить папку…' });
  if (items.length > 1) more.push({ id: 'show', icon: 'present', label: `Показ: ${items.length}` });
  more.push({ id: 'export', icon: 'download', label: items.length > 1 ? `Экспорт в папку (${items.length})…` : 'Экспорт в папку…' }, { id: 'exportzip', icon: 'download', label: 'Экспорт в zip…' });
  lists = { copy, more };
  if (copy.length || (one && one.colors.length)) out.push({ id: 'copy', icon: 'copy', label: 'Копировать', sub: true });
  out.push({ id: 'more', icon: 'more', label: 'Ещё', sub: true });
  out.push({ id: 'rename', icon: 'edit', label: items.length > 1 ? `Переименовать (${items.length})…` : 'Переименовать…', key: 'F2' });
  const del = [{ id: 'trash', icon: 'trash', label: items.length > 1 ? `В корзину (${items.length})` : 'В корзину', key: 'Del', danger: true }];
  return [open, keep, make, out, del].filter((g) => g.length).flatMap((g, k) => (k ? [{ sep: true }, ...g] : g));
}

const rowHTML = (x) => x.sep ? '<div class="ctx-sep" role="separator"></div>'
  : `<button type="button" class="mi${x.danger ? ' danger' : ''}" role="menuitem" data-c="${x.id}"${x.sub ? ' aria-haspopup="menu" aria-expanded="false"' : ''}>${ic(x.icon)}<span>${esc(x.label)}</span>${x.sub ? `<b class="ctx-chev">${ic('chev')}</b>` : x.key ? `<kbd>${x.key}</kbd>` : ''}</button>`;

function openMenu(x, y) {
  const keep = forced; // closing a previous menu clears the preview's file
  closeMenu();
  forced = keep;
  back = document.activeElement;
  menu = document.createElement('div');
  menu.className = 'ctx glass';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', mode === 'space' ? 'Действия' : 'Действия с файлом');
  menu.innerHTML = rows().map(rowHTML).join('');
  document.body.appendChild(menu);
  place(menu, x, y);
  menu.addEventListener('click', onClick);
  menu.addEventListener('keydown', onKey);
  menu.addEventListener('pointerover', (e) => {
    const b = e.target.closest('.mi');
    if (!b || b.closest('.ctx-sub')) return;
    if (b.getAttribute('aria-haspopup')) openSub(b, false); else closeSub();
  });
  focusFirst(menu);
}

export function closeMenu() {
  if (!menu) return;
  forced = null;
  if (sub) sub.remove();
  menu.remove(); menu = null; sub = null;
  if (back && back.isConnected) back.focus({ preventScroll: true });
  back = null;
}

// the menu stays off the properties panel when that is out: two glass layers over each other read as a mess
function rightEdge(w) {
  const m = 8, insp = document.getElementById('insp');
  if (!S.previewId && insp && document.body.classList.contains('has-sel') && !document.body.classList.contains('insp-off')) {
    const ir = insp.getBoundingClientRect();
    if (ir.width && ir.left - w - m > m) return ir.left - m;
  }
  return innerWidth - m;
}
function place(el, x, y, flip = true) {
  const w = el.offsetWidth, h = el.offsetHeight, m = 8, right = rightEdge(w);
  if (flip && x + w > right) x = Math.min(x - w, right - w); // open to the left of the cursor rather than over the panel
  el.style.left = Math.max(m, Math.min(x, right - w)) + 'px';
  el.style.top = Math.max(m, Math.min(y, innerHeight - h - m)) + 'px';
}

const itemsOf = (el) => Array.from(el.querySelectorAll(':scope > .mi'));
function focusFirst(el) { const f = itemsOf(el)[0]; if (f) f.focus(); }

function subRows(kind) {
  if (kind === 'folder') {
    const items = selItems();
    const fl = flatFolders();
    if (!fl.length) return '<div class="ctx-none">Подборок пока нет</div>';
    return fl.map((x) => {
      const on = items.every((i) => i.folders.includes(x.f.id));
      return `<button type="button" class="mi" role="menuitemcheckbox" aria-checked="${on}" data-fid="${x.f.id}" style="padding-left:${12 + x.d * 14}px"><span>${esc(x.f.name)}</span>${on ? '✓' : ''}</button>`;
    }).join('');
  }
  if (kind === 'more') return lists.more.map(rowHTML).join('');
  // «Копировать»: the text on the picture, then its colours as HEX
  const it = selItems().length === 1 ? selItems()[0] : null;
  const cols = (it ? it.colors : []).map((c) => `<button type="button" class="mi" role="menuitem" data-hex="${c}"><i class="ctx-sw" style="background:${c}"></i><span class="hex">${c.toUpperCase()}</span></button>`);
  return lists.copy.map(rowHTML).concat(lists.copy.length && cols.length ? [rowHTML({ sep: true })] : [], cols).join('');
}

function openSub(btn, focus) {
  if (sub && sub.dataset.for === btn.dataset.c) { if (focus) focusFirst(sub); return; }
  closeSub();
  sub = document.createElement('div');
  sub.className = 'ctx ctx-sub glass';
  sub.setAttribute('role', 'menu');
  sub.dataset.for = btn.dataset.c;
  sub.innerHTML = subRows(btn.dataset.c);
  document.body.appendChild(sub); // not inside the menu: its backdrop-filter would anchor position:fixed
  sub.addEventListener('click', onClick);
  sub.addEventListener('keydown', onKey);
  btn.setAttribute('aria-expanded', 'true');
  const r = btn.getBoundingClientRect(), w = sub.offsetWidth;
  const right = r.right + 4 + w < rightEdge(w);
  place(sub, right ? r.right + 4 : r.left - w - 4, r.top - 6, false);
  if (focus) focusFirst(sub);
}

function closeSub() {
  if (!sub) return;
  const b = menu.querySelector(`[data-c="${sub.dataset.for}"]`);
  if (b) b.setAttribute('aria-expanded', 'false');
  sub.remove(); sub = null;
}

async function onClick(e) {
  const b = e.target.closest('.mi');
  if (!b) return;
  e.stopPropagation();
  if (b.dataset.fid) return toggleFolder(b.dataset.fid);
  if (b.dataset.hex) {
    const hx = b.dataset.hex;
    closeMenu();
    try { await writeText(hx); toast('Скопировано ' + hx.toUpperCase()); } catch (err) { toast(hx); }
    return;
  }
  const a = b.dataset.c;
  if (b.getAttribute('aria-haspopup')) return openSub(b, true);
  const items = selItems(), spot = at;
  closeMenu();
  if (a.startsWith('sp-')) return spaceAction(a);
  if (a.startsWith('pv-')) return previewAction(a, items[0], spot);
  return cardAction(a, items);
}

// the same actions for the selection bar (selbar.js); the bar can also open this menu above itself
export function openCardMenu(x, bottom, subId) {
  mode = 'card'; forced = null;
  openMenu(x, bottom);
  if (menu) place(menu, x, bottom - menu.offsetHeight); // grows up from the bar
  const b = subId && menu && menu.querySelector(`[data-c="${subId}"]`);
  if (b) openSub(b, true);
}
export async function cardAction(a, items = selItems()) {
  if (a === 'open' && items[0]) openPreview(items[0].id);
  else if (a === 'app' && items[0]) openInApp(items[0]);
  else if (a === 'reveal' && items[0]) { try { await revealItemInDir(absPath(items[0].file)); } catch (err) { toast('Не удалось показать файл в папке: его могли переместить или удалить не через Oddments.'); } }
  else if (a === 'fav') {
    const on = !items.every((i) => i.fav);
    items.forEach((i) => { i.fav = on; syncCard(i.id); });
    sfx(on ? 'fav' : 'unfav');
    saveIndex();
    toast(on ? 'В избранном: ' + items.length : 'Убрано из избранного: ' + items.length);
    if (S.view.type === 'fav') ui.refresh(); else { ui.renderSide(); ui.renderInsp(); }
  } else if (a === 'similar' && items[0]) setView('similar', items[0].id);
  else if (a === 'ocrcopy' && items[0]) { try { await writeText(items[0].ocr); toast('Текст скопирован'); } catch (err) { toast('Не удалось скопировать текст.'); } }
  else if (a === 'rename') openRename(items);
  else if (a === 'mask') import('./mask.js').then((m) => m.openMask(items));
  else if (a === 'brand' && items[0]) {
    const id = items[0].id;
    if (!(S.sel.size === 1 && S.sel.has(id))) { S.sel.clear(); S.sel.add(id); S.last = id; ui.refresh(); }
    import('./inspextra.js').then((m) => { m.brandOpen(id); ui.renderInsp(); setTimeout(() => { const d = document.querySelector('.brand-blk'); if (d) { d.open = true; d.scrollIntoView({ block: 'nearest' }); } }); });
  }
  else if (a === 'upscale' && items[0]) import('./upscale.js').then((m) => m.openUpscale(items[0]));
  else if (a === 'cutout') import('./cutout.js').then((m) => m.openCutout(items));
  else if (a === 'notes' && items[0]) import('./notes.js').then((m) => m.openNotes(items[0]));
  else if (a === 'show') import('./show.js').then((m) => m.openShow(S.vis.filter((i) => items.includes(i)).concat(items.filter((i) => !S.vis.includes(i))), 'Выбранное'));
  else if (a === 'toteam') import('./teamui.js').then((m) => m.sendFlow(items));
  else if (a === 'teamtake') import('./teamui.js').then((m) => m.takeFlow(items));
  else if (a === 'export' || a === 'exportzip') {
    const f = S.view.type === 'folder' && S.folders.find((x) => x.id === S.view.id);
    import('../lib/exporter.js').then((m) => m.runExport(items, f ? f.name : (items.length === 1 ? items[0].name : `Oddments · ${t(`${items.length} файлов`)}`), a === 'exportzip'));
  }
  else if (a === 'blender') {
    const send = items.filter((i) => i.kind === 'model' || i.kind === 'material');
    import('./toblender.js').then((m) => m.itemsToBlender(send));
  } else if (a === 's3dset') {
    const f = S.view.type === 'folder' && S.folders.find((x) => x.id === S.view.id);
    import('./toblender.js').then((m) => m.iconSetToBlender(items, f ? f.name : null));
  } else if (a === 'svgfix') import('./svgfix.js').then((m) => m.openSvgFix(items));
  else if (a === 's3d' && items[0]) import('./svg3d.js').then((m) => m.openFromItem(items[0]));
  else if (a === 'splatmk' && items[0]) import('./splatmaker.js').then((m) => m.openSplatMaker(items[0]));
  else if (a === 'flow' && items[0]) {
    import('./preview.js').then((pv) => { if (pv.isPreviewOpen()) pv.closePreview(true); });
    import('./flows.js').then((m) => m.flowFromItem(items[0]));
  } else if (a === 'ik' && items[0]) import('./iconkit.js').then((m) => m.openIconKit(items[0]));
  else if (a === 'trash') { trashItems(items); S.sel.clear(); ui.refresh(); toast('В корзину: ' + items.length, 0, { fn: () => { restoreItems(items); ui.refresh(); } }); }
  else if (a === 'restore') { restoreItems(items); S.sel.clear(); ui.refresh(); toast('Возвращено: ' + items.length); }
}

function spaceAction(a) {
  const click = (id) => { const b = document.getElementById(id); if (b) b.click(); };
  if (a === 'sp-paste') click('pasteBtn');
  else if (a === 'sp-add') click('addBtn');
  else if (a === 'sp-dir') click('addDirBtn');
  else if (a === 'sp-svg') import('./svg3d.js').then((m) => m.pickSvgFor3d());
  else if (a === 'sp-mat') click('matBtn');
  else if (a === 'sp-folder') import('./sidebar.js').then((m) => m.newFolder());
  else if (a === 'sp-grid') click('lyG');
  else if (a === 'sp-masonry') click('lyM');
  else if (a === 'sp-all') { S.sel = new Set(S.vis.map((i) => i.id)); onSel(); }
  else if (a === 'sp-clean') import('./clean.js').then((m) => m.setClean(!m.cleanOn()));
  else if (a === 'sp-cmd') import('./palette.js').then((m) => m.openPalette());
  else if (a === 'sp-set') import('./settings.js').then((m) => m.openSettings());
}

async function previewAction(a, it, spot) {
  if (!it) return;
  const m = await import('./media.js');
  try {
    if (a === 'pv-copy') { await m.copyImage(it); toast('Картинка скопирована'); }
    else if (a === 'pv-hex') { const hx = (await m.colorAt(it, spot.fx, spot.fy)).toUpperCase(); await writeText(hx); toast('Скопировано ' + hx); }
    else if (a === 'pv-frame') { const n = await m.saveFrame(it, spot.time); ui.refresh(); if (n.length) toast('Кадр сохранён: ' + n[0].name); }
    else if (a === 'pv-fcopy') { await m.copyFrame(it, spot.time); toast('Кадр скопирован'); }
  } catch (err) {
    toast({ 'pv-copy': 'Не удалось скопировать картинку.', 'pv-hex': 'Не удалось прочитать цвет.', 'pv-frame': 'Не удалось сохранить кадр.', 'pv-fcopy': 'Не удалось скопировать кадр.' }[a]);
  }
}

function toggleFolder(fid) {
  const items = selItems(), on = !items.every((i) => i.folders.includes(fid));
  items.forEach((i) => {
    const k = i.folders.indexOf(fid);
    if (on && k < 0) i.folders.push(fid);
    if (!on && k >= 0) i.folders.splice(k, 1);
  });
  saveIndex();
  const f = folderById(fid);
  closeMenu();
  ui.refresh();
  toast((on ? 'В подборку «' : 'Убрано из «') + (f ? f.name : '') + '»: ' + items.length);
}

function onKey(e) {
  const t = e.target, inSub = !!t.closest('.ctx-sub');
  const host = inSub ? sub : menu, list = itemsOf(host), i = list.indexOf(t);
  const k = e.key;
  e.stopPropagation(); // the grid's own keys must not fire behind the menu
  if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Home' || k === 'End') {
    e.preventDefault();
    const j = k === 'Home' ? 0 : k === 'End' ? list.length - 1 : (i + (k === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
    if (list[j]) list[j].focus();
    if (!inSub) closeSub();
  } else if (k === 'ArrowRight' && !inSub && t.getAttribute('aria-haspopup')) { e.preventDefault(); openSub(t, true); }
  else if ((k === 'ArrowLeft' || k === 'Escape') && inSub) {
    e.preventDefault();
    const b = menu.querySelector(`[data-c="${sub.dataset.for}"]`);
    closeSub();
    if (b) b.focus();
  } else if (k === 'Escape') { e.preventDefault(); closeMenu(); }
  else if (k === 'Tab') { e.preventDefault(); closeMenu(); }
}
