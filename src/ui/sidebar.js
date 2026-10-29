// The left panel: places (all files, recent, favourites, app screens, trash), the collection tree (drag files onto it,
// F2 / Delete / Insert on a row), tags, and the folding groups «Новости», «3D» and «Инструменты». One Tab stop for the
// whole list (roving tabindex), the sliding highlight follows the open view.
import { S, ui, folderById, descend, flatFolders, recentSet } from '../state.js';
import { $, esc, uid, plural, isMac } from '../util.js';
import { ic } from './icons.js';
import { slideIndicator, motionOn } from './motion.js';
import { reglide } from './glide.js';
import { saveIndex, trashItems, restoreItems } from '../lib/library.js';
import { setView } from '../lib/filter.js';
import { ask, toast } from './dialogs.js';
import { closeOverlays, isOverlayOpen, isTidyOpen, openTidy, openFeed, openNews } from './lazy.js';
const pickSvgFor3d = () => import('./svg3d.js').then((m) => m.pickSvgFor3d());
const remeshSelected = () => import('./svg3d.js').then((m) => m.remeshSelected());

function counts() {
  const c = { all: 0, nofolder: 0, notag: 0, trash: 0, recent: 0, fresh: 0, fav: 0, kind: {}, folder: {}, tag: new Map(), aitag: new Map(), swatch: {} };
  const parent = new Map(S.folders.map((f) => [f.id, f.parent || null]));
  const recent = recentSet();
  for (const it of S.items) {
    if (it.trashed) { c.trash++; continue; }
    c.all++;
    if (!it.folders.length) c.nofolder++;
    if (!it.tags.length && !(it.aiTags && it.aiTags.length)) c.notag++; // no own and no AI tag (bug #91)
    if (recent.has(it.id)) c.recent++;
    if (it.fresh) c.fresh++;
    if (it.fav) c.fav++;
    c.kind[it.kind] = (c.kind[it.kind] || 0) + 1;
    const fset = new Set();
    for (const f of it.folders) { let p = f; while (p && !fset.has(p)) { fset.add(p); p = parent.get(p); } }
    fset.forEach((f) => { c.folder[f] = (c.folder[f] || 0) + 1; if (!c.swatch[f] && it.colors.length) c.swatch[f] = vivid(it.colors); });
    for (const t of it.tags) c.tag.set(t, (c.tag.get(t) || 0) + 1);
    for (const t of it.aiTags || []) if (!it.tags.includes(t)) c.aitag.set(t, (c.aitag.get(t) || 0) + 1);
  }
  return c;
}

// the most saturated colour of a file, used as a folder's swatch
function vivid(cols) {
  let best = cols[0], bs = -1;
  for (const h of cols) { const n = parseInt(h.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255; const s = Math.max(r, g, b) - Math.min(r, g, b); if (s > bs) { bs = s; best = h; } }
  return best;
}

function row(vt, id, label, icon, count, o = {}) {
  // while the duplicates or «Разобрать» cover the grid, that screen is the one marked in the list
  const on = !isOverlayOpen() && S.view.type === vt && (S.view.id || null) === (id == null ? null : id);
  // the screen reader hears «Подборка, 12 файлов» — not the label glued to a bare number and a nested button
  const say = esc(label) + (o.badge ? `, новых: ${o.badge}` : count !== '' && count != null ? `, ${count} ${plural(+count || 0, ['файл', 'файла', 'файлов'])}` : '');
  return `<div class="nav${on ? ' on' : ''}" role="button" tabindex="0" aria-label="${say}"${o.title ? ` title="${esc(o.title)}"` : ''}${on ? ' aria-current="page"' : ''}${o.expanded != null ? ` aria-expanded="${o.expanded}"` : ''} data-vt="${vt}"${id != null ? ` data-id="${esc(id)}"` : ''}${o.drop ? ` data-drop="${o.drop}"` : ''} style="padding-left:${8 + (o.depth || 0) * 14}px">${o.pre || ''}${icon === 'dot' ? '<span class="tagdot"></span>' : icon && icon[0] === '#' ? `<span class="sw" style="background:${icon}"></span>` : ic(icon)}<span class="lb">${esc(label)}</span>${o.badge ? `<span class="badge" title="Новые файлы">${o.badge}</span>` : `<span class="ct">${count}</span>`}${o.acts || ''}</div>`;
}

let groups = (() => { try { return JSON.parse(localStorage.getItem('perch.sideGroups') || '{}'); } catch (e) { return {}; } })();
let tagsOpen = (() => { try { return !!localStorage.getItem('perch.tagsOpen'); } catch (e) { return false; } })();

export function renderSide() {
  const c = counts();
  let h = '';
  h += row('all', null, 'Все файлы', 'all', c.all);
  h += row('recent', null, 'Недавние', 'clock', c.recent, { badge: c.fresh });
  h += row('fav', null, 'Избранное', 'heart', c.fav);
  // app screens (screens.js): the product designer's daily «how do others do it» — by app, kind, pattern; flows side by side
  // names a newcomer understands without the manual (audit 29.10: «Экраны», «Разобрать», «Ремеш» meant nothing to them)
  h += row('tool-screens', null, 'Экраны приложений', 'phone', S.items.filter((i) => i.scr && !i.trashed).length || '', { title: 'Скриншоты и записи экранов приложений — по приложению, типу экрана и паттерну; сценарии рядом' });
  // duplicates are found from the trash (that is where the extra copies go)
  h += row('trash', null, 'Корзина', 'trash', c.trash, { drop: 'trash' });
  // connected team libraries (team.js): each its own place, next to one's own
  for (const t of S.teams || []) h += row('team', t.id, t.name, 'team', S.teamItems.filter((i) => i.team === t.id && !i.trashed).length);

  // file types live in the tabs above the grid; the sidebar keeps places and collections

  h += `<div class="grp" role="heading" aria-level="2">Подборки<button data-act="newroot" aria-label="Новая подборка" title="Новая подборка">${ic('plus')}</button></div>`;
  (function walk(parent, depth) {
    S.folders.filter((f) => (f.parent || null) === parent).forEach((f) => {
      const kids = S.folders.some((x) => x.parent === f.id);
      const pre = `<span class="chev${kids ? (f.open ? ' open' : '') : ' none'}" data-act="tog">${ic('chev')}</span>`;
      // one quiet «⋯» instead of four buttons side by side (delete sat next to export — easy to misclick, bug #90)
      const acts = `<span class="acts"><button data-act="more" aria-hidden="true" tabindex="-1" title="Действия с подборкой (Shift+F10)">${ic('more')}</button></span>`;
      h += row('folder', f.id, f.name, c.swatch[f.id] || 'folder', c.folder[f.id] || 0, { pre, acts, depth, drop: 'folder', expanded: kids ? !!f.open : null });
      if (kids && f.open) walk(f.id, depth + 1);
    });
  })(null, 0);
  if (!S.folders.length) h += '<div class="nav idle">Подборок пока нет</div>';
  // «what is not sorted yet» lives at the end of its own section, not in the top block
  if (S.folders.length && c.nofolder) h += row('nofolder', null, 'Без подборки', 'nofolder', c.nofolder);
  // «Разобрать» (#80): the same files with suggested collections
  if (S.folders.length && c.nofolder) h += `<div class="nav${isTidyOpen() ? ' on' : ''}" role="button" tabindex="0" data-vt="tidy" title="Файлы без подборки — Oddments подскажет, в какие подборки их разложить по похожести" style="padding-left:8px">${ic('sparkle')}<span class="lb">Разложить по подборкам</span><span class="ct"></span></div>`;

  h += '<!--tags-->';
  // tags: one's own first, then the AI's (✦, local model words or Claude's tags — bug #91); the group folds like
  // «Новости» (bug #92), open by default; the most used of each kind, the rest behind «Ещё N»
  const byCount = (m) => Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'));
  const tags = byCount(c.tag), aitags = byCount(c.aitag);
  const TOP = 6, allTags = tagsOpen || tags.length + aitags.length <= TOP * 2 + 2;
  let tg = '';
  tags.slice(0, allTags ? 80 : TOP).forEach(([t, n]) => { tg += row('tag', t, t, 'dot', n); });
  if (aitags.length) {
    tg += '<div class="grp sub">✦ ИИ-теги</div>';
    aitags.slice(0, allTags ? 80 : TOP).forEach(([t, n]) => { tg += row('tag', t, t, 'sparkle', n); });
  }
  const shownTags = new Set([...tags.slice(0, allTags ? 80 : TOP), ...aitags.slice(0, allTags ? 80 : TOP)].map(([t]) => t));
  if (S.view.type === 'tag' && !shownTags.has(S.view.id)) tg += row('tag', S.view.id, S.view.id, 'dot', (c.tag.get(S.view.id) || 0) + (c.aitag.get(S.view.id) || 0));
  const hidden = allTags ? 0 : Math.max(0, tags.length - TOP) + Math.max(0, aitags.length - TOP);
  if (allTags && tags.length + aitags.length > TOP * 2 + 2) tg += `<div class="nav more" role="button" tabindex="0" data-act="moretags" aria-expanded="true" style="padding-left:8px">${ic('arrowu')}<span class="lb">Свернуть</span><span class="ct"></span></div>`;
  else if (hidden) tg += `<div class="nav more" role="button" tabindex="0" data-act="moretags" aria-expanded="false" style="padding-left:8px">${ic('chev')}<span class="lb">Ещё ${hidden} ${plural(hidden, ['тег', 'тега', 'тегов'])}</span><span class="ct"></span></div>`;
  if (!tags.length && !aitags.length) tg += '<div class="nav idle">Тегов пока нет</div>';
  else if (c.notag) tg += row('notag', null, 'Без тегов', 'notag', c.notag);
  // news: the reels feed of design sites, the daily digest of AI and design, saved articles to read here
  const newsRow = (vt, icon, label, hint) => `<div class="nav" role="button" tabindex="0" data-vt="${vt}" title="${hint}" style="padding-left:8px">${ic(icon)}<span class="lb">${label}</span><span class="ct"></span></div>`;
  let news = '';
  news += newsRow('feed', 'play', 'Лента', 'Свежие проекты и статьи о дизайне, 3D и моушне — листаются как рилсы');
  news += newsRow('digest', 'sparkle', 'Сводка дня', 'Главное за сутки в ИИ и в дизайне');
  news += newsRow('saved', 'bookmark', 'Сохранённое', 'Статьи, которые читаются здесь');

  // «3D» — one section for everything 3D (audit 24.10: the same models were «Модели», the tab «3D» and a collection):
  // the models, the materials, and what makes or reworks them; «Инструменты» — the rest of the studio
  const tool = (vt, icon, label, hint) => `<div class="nav" role="button" tabindex="0" data-vt="${vt}" title="${hint}" style="padding-left:8px">${ic(icon)}<span class="lb">${label}</span><span class="ct"></span></div>`;
  let d3 = '';
  d3 += c.kind.model ? row('kind', 'model', '3D-модели', 'cube', c.kind.model) : tool('tool-add3d', 'cube', '3D-модели', 'GLB, OBJ, FBX, STL, .blend… — перетащите в окно или «Добавить»; из Blender — аддоном Oddments');
  if (c.kind.material) d3 += row('kind', 'material', 'Материалы', 'sphere', c.kind.material);
  else d3 += tool('tool-material', 'sphere', 'Материалы', 'Материал из набора текстур (Poly Haven, ambientCG, Substance) или из Blender');
  d3 += tool('tool-svg3d', 'plus', 'SVG в 3D', 'Иконка или логотип из SVG — в 3D-модель с чистой сеткой');
  if (!isMac) d3 += tool('tool-remesh', 'wire', 'Ремеш в квады', 'Новая сетка из четырёхугольников для выбранной модели (AutoRemesher)'); // AutoRemesher: Windows only
  d3 += tool('tool-splat', 'splat', 'Сплат из модели', 'Выбранная модель — в гауссовы сплаты: свет из 3D-просмотра запекается');
  d3 += tool('tool-blender', 'plugs', 'Связь с Blender', 'Аддон Oddments: браузер библиотеки в Blender, модели в Asset Browser, проверка модели, умная UV-развёртка');
  let tools = '';
  // the icon constructor was only in «Добавить ▾» and the palette — the user could not find it (bug #58)
  tools += tool('tool-iconkit', 'grid', 'Конструктор иконок', 'Иконки по правилам: фигуры, проверка, все размеры, генерация по описанию');
  tools += tool('tool-flow', 'flow', 'Сценарий из записи', 'Запись экрана → экраны по шагам → сценарий и CJM');
  tools += tool('tool-team', 'team', (S.teams || []).length ? 'Подключить ещё команду' : 'Общая папка команды', 'Общая папка команды: сетевой диск, OneDrive, Яндекс Диск — общие референсы без сервера');
  tools += tool('tool-plugins', 'puzzle', 'Плагины', 'Blender, Figma, Chrome и Edge, Safari, Claude (MCP): установка и статус');

  // «Новости» and «Инструменты» fold away at the end (closed by default, remembered): collections and tags — the library
  // itself — come first. A group holding the view that is open now stays open. A closed group's rows are there too,
  // folded to no height (and inert): opening and closing slides the height instead of the list jumping (user, 28.10).
  const fold = (g, label, body, active, byDefault = false) => {
    const open = (groups[g] ?? byDefault) || active;
    return `<div role="heading" aria-level="2" class="grp-h"><button type="button" class="grp fold" data-act="fold" data-g="${g}" aria-expanded="${open}">${label}<span class="fold-ch">${ic('chev')}</span></button></div>` +
      `<div class="fold-b${open ? ' open' : ''}" data-g="${g}"${open ? '' : ' inert'}><div class="fold-in">${body}</div></div>`;
  };
  const inTools = S.view.type === 'kind' && (S.view.id === 'model' || S.view.id === 'material');
  // tags sit right after the collections (as before), folding like the groups below
  h = h.replace('<!--tags-->', fold('tags', 'Теги', tg, S.view.type === 'tag' || S.view.type === 'notag', true));
  h += fold('news', 'Новости', news, false);
  h += fold('d3', '3D', d3, inTools, true);
  h += fold('tools', 'Инструменты', tools, false);

  const sc = $('#sideScroll'), top = sc.scrollTop;
  const f = document.activeElement && sc.contains(document.activeElement) && document.activeElement.closest('.nav');
  const key = f ? f.dataset.vt + '|' + (f.dataset.id || '') : null;
  sc.innerHTML = h;
  sc.scrollTop = top;
  reglide(sc); // the hover highlight stays on the row under the pointer (it blinked out and popped back in)
  slideIndicator(sc, '.nav.on', 'nav-ind');
  // one Tab stop for the whole list (roving tabindex): ↑/↓ move between rows, the row buttons are reached by
  // keys (F2, Delete, Insert), so Tab no longer walks through every row and its three hidden buttons
  const navs = rows(sc);
  const home = navs.find((x) => x.classList.contains('on')) || navs[0];
  navs.forEach((x) => { x.tabIndex = x === home ? 0 : -1; });
  sc.querySelectorAll('.nav .acts button').forEach((b) => { b.tabIndex = -1; });
  sc.querySelectorAll('.nav[data-vt="folder"]').forEach((x) => x.setAttribute('aria-keyshortcuts', 'F2 Delete Insert Shift+F10'));
  if (key) { const n = navs.find((x) => x.dataset.vt + '|' + (x.dataset.id || '') === key); if (n) { home.tabIndex = -1; n.tabIndex = 0; n.focus(); } }
}

// A group opens and closes in place: the rows below slide by its height (transform) while its own rows unroll from the
// top (clip-path) — FLIP, so nothing animates the layout itself (code rules). Without animations it just switches.
const FOLD_MS = 240, FOLD_EASE = 'cubic-bezier(.2, .8, .2, 1)';
function foldGroup(sc, body, open) {
  body.getAnimations().forEach((a) => a.finish()); // a quick second click finishes the first fold
  if (!motionOn()) {
    body.classList.toggle('open', open); body.inert = !open;
    slideIndicator(sc, '.nav.on', 'nav-ind');
    return;
  }
  const after = [];
  for (let n = body.nextElementSibling; n; n = n.nextElementSibling) after.push(n);
  const opt = { duration: FOLD_MS, easing: FOLD_EASE, fill: 'forwards' };
  if (open) {
    body.classList.add('open'); body.inert = false;
    const h = body.offsetHeight;
    const anims = after.map((n) => n.animate([{ transform: `translateY(${-h}px)` }, { transform: 'none' }], opt));
    anims.push(body.animate([{ clipPath: 'inset(0 0 100% 0)', opacity: 0 }, { clipPath: 'inset(0 0 0 0)', opacity: 1 }], opt));
    slideIndicator(sc, '.nav.on', 'nav-ind');
    Promise.all(anims.map((a) => a.finished)).then(() => anims.forEach((a) => a.cancel())).catch(() => {});
  } else {
    const h = body.offsetHeight;
    body.inert = true;
    const anims = after.map((n) => n.animate([{ transform: 'none' }, { transform: `translateY(${-h}px)` }], opt));
    anims.push(body.animate([{ clipPath: 'inset(0 0 0 0)', opacity: 1 }, { clipPath: 'inset(0 0 100% 0)', opacity: 0 }], opt));
    // the height goes at the very end, in the same frame the slides are dropped: no jump
    Promise.all(anims.map((a) => a.finished)).then(() => {
      body.classList.remove('open');
      anims.forEach((a) => a.cancel());
      slideIndicator(sc, '.nav.on', 'nav-ind');
    }).catch(() => {});
  }
}

// the rows one can reach: not those of a folded group
const rows = (sc) => Array.from(sc.querySelectorAll('.nav')).filter((x) => !x.closest('.fold-b:not(.open)'));

function roveTo(from, to) {
  if (!to) return;
  from.tabIndex = -1; to.tabIndex = 0; to.focus();
}

export async function newFolder() {
  const n = await ask('Новая подборка');
  if (n) { S.folders.push({ id: uid(), name: n, parent: null, open: true }); saveIndex(); ui.refresh(); }
}

export function initSidebar() {
  const side = $('#sideScroll');
  side.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'), rowEl = e.target.closest('.nav');
    if (b && b.dataset.act === 'newroot') { newFolder(); return; }
    if (b && b.dataset.act === 'fold') {
      const g = b.dataset.g, open = b.getAttribute('aria-expanded') !== 'true', body = side.querySelector(`.fold-b[data-g="${g}"]`);
      groups = { ...groups, [g]: open };
      try { localStorage.setItem('perch.sideGroups', JSON.stringify(groups)); } catch (err) { /* ignore */ }
      if (!body || (!open && body.querySelector('.nav.on'))) { renderSide(); return; } // the open view's group stays open
      b.setAttribute('aria-expanded', String(open));
      foldGroup(side, body, open);
      return;
    }
    if (b && b.dataset.act === 'moretags') { tagsOpen = !tagsOpen; try { localStorage.setItem('perch.tagsOpen', tagsOpen ? '1' : ''); } catch (err) { /* ignore */ } renderSide(); return; }
    if (b && rowEl) {
      e.stopPropagation();
      if (b.dataset.act === 'more') { rowMenu(b, rowEl.dataset.id); return; }
      folderAct(b.dataset.act, rowEl.dataset.id, e.shiftKey);
      return;
    }
    if (rowEl && rowEl.dataset.vt === 'feed') { openFeed(); document.body.classList.remove('nav-open'); return; }
    if (rowEl && (rowEl.dataset.vt === 'digest' || rowEl.dataset.vt === 'saved')) { openNews(rowEl.dataset.vt); document.body.classList.remove('nav-open'); return; }
    if (rowEl && rowEl.dataset.vt === 'tidy') { if (isTidyOpen()) closeOverlays(); else { closeOverlays(); openTidy(); } document.body.classList.remove('nav-open'); return; }
    if (rowEl && rowEl.dataset.vt === 'tool-svg3d') { document.body.classList.remove('nav-open'); pickSvgFor3d(); return; }
    if (rowEl && rowEl.dataset.vt === 'tool-plugins') { document.body.classList.remove('nav-open'); import('./plugins.js').then((m) => m.openPlugins()); return; }
    if (rowEl && rowEl.dataset.vt === 'tool-iconkit') { document.body.classList.remove('nav-open'); import('./iconkit.js').then((m) => m.openIconKit()); return; }
    if (rowEl && rowEl.dataset.vt === 'tool-remesh') { document.body.classList.remove('nav-open'); remeshSelected(); return; }
    if (rowEl && rowEl.dataset.vt === 'tool-splat') { document.body.classList.remove('nav-open'); import('./splatmaker.js').then((m) => m.splatSelected()); return; }
    if (rowEl && rowEl.dataset.vt === 'tool-team') { document.body.classList.remove('nav-open'); import('./teamui.js').then((m) => m.connectFlow()); return; }
    if (rowEl && rowEl.dataset.vt === 'tool-screens') { document.body.classList.remove('nav-open'); import('./screens.js').then((m) => m.openScreens()); return; }
    if (rowEl && rowEl.dataset.vt === 'tool-flow') { document.body.classList.remove('nav-open'); import('./flows.js').then((m) => m.flowFromDisk()); return; }
    if (rowEl && rowEl.dataset.vt === 'tool-blender') { document.body.classList.remove('nav-open'); import('./plugins.js').then((m) => m.openPlugins()); return; }
    if (rowEl && rowEl.dataset.vt === 'tool-add3d') { document.body.classList.remove('nav-open'); document.getElementById('addBtn').click(); return; }
    if (rowEl && rowEl.dataset.vt === 'tool-material') { document.body.classList.remove('nav-open'); import('./materials.js').then((m) => m.pickTextures()); return; }
    if (rowEl && !rowEl.classList.contains('idle')) { closeOverlays(); setView(rowEl.dataset.vt, rowEl.dataset.id); }
  });

  // rows are role=button: Enter / Space open them like a click
  side.addEventListener('keydown', (e) => {
    const nav = e.target.classList && e.target.classList.contains('nav') ? e.target : null;
    if (nav && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault(); e.stopPropagation();
      const all = rows(side), i = all.indexOf(nav);
      roveTo(nav, e.key === 'Home' ? all[0] : e.key === 'End' ? all[all.length - 1] : all[i + (e.key === 'ArrowDown' ? 1 : -1)]);
      return;
    }
    // collection row: F2 rename, Delete remove, Insert add a sub-collection (the same as its «⋯» menu)
    // its «⋯» menu from the keyboard: Shift+F10 or the menu key (the button itself is out of the Tab order)
    if (nav && nav.dataset.vt === 'folder' && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) {
      e.preventDefault(); e.stopPropagation();
      const b = nav.querySelector('[data-act="more"]');
      if (b) rowMenu(b, nav.dataset.id);
      return;
    }
    const rowAct = { F2: 'ren', Delete: 'del', Insert: 'sub' }[e.key];
    if (nav && rowAct && nav.dataset.vt === 'folder') { e.preventDefault(); e.stopPropagation(); folderAct(rowAct, nav.dataset.id, false); return; }
    if ((e.key === 'Enter' || e.key === ' ') && nav) { e.preventDefault(); e.stopPropagation(); nav.click(); }
    // → / ← open and close a collection with sub-collections, like a tree
    else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && e.target.matches('.nav[aria-expanded]')) {
      e.preventDefault(); e.stopPropagation();
      const f = folderById(e.target.dataset.id), open = e.key === 'ArrowRight';
      if (f && !!f.open !== open) { f.open = open; saveIndex(); renderSide(); }
    }
  });

  // Drop files from the grid onto folders / trash.
  const has = (e) => Array.from(e.dataTransfer.types).includes('text/x-perch');
  side.addEventListener('dragover', (e) => {
    const r = e.target.closest('[data-drop]');
    if (!r || !has(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    side.querySelectorAll('.drop').forEach((x) => { if (x !== r) x.classList.remove('drop'); });
    r.classList.add('drop');
  });
  side.addEventListener('dragleave', (e) => {
    const r = e.target.closest('[data-drop]');
    if (r && !r.contains(e.relatedTarget)) r.classList.remove('drop');
  });
  side.addEventListener('drop', (e) => {
    const r = e.target.closest('[data-drop]');
    side.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop'));
    if (!r || !has(e)) return;
    e.preventDefault(); e.stopPropagation();
    const items = JSON.parse(e.dataTransfer.getData('text/x-perch')).map((id) => S.byId.get(id)).filter(Boolean);
    if (r.dataset.drop === 'trash') {
      trashItems(items); S.sel.clear(); ui.refresh();
      toast('В корзину: ' + items.length, 0, { fn: () => { restoreItems(items); ui.refresh(); } });
      return;
    }
    items.forEach((it) => { if (!it.folders.includes(r.dataset.id)) it.folders.push(r.dataset.id); it.trashed = false; });
    saveIndex(); ui.refresh();
    const f = folderById(r.dataset.id);
    toast('В подборку «' + (f ? f.name : '') + '»: ' + items.length);
  });
}

export { flatFolders };

// a collection's actions (the «⋯» menu, F2 / Delete / Insert on the row)
async function folderAct(act, id, shift) {
  const f = folderById(id);
  if (!f) return;
  if (act === 'tog') { f.open = !f.open; saveIndex(); renderSide(); }
  else if (act === 'sub') {
    const n = await ask('Новая подборка в «' + f.name + '»');
    if (n) { f.open = true; S.folders.push({ id: uid(), name: n, parent: id, open: true }); saveIndex(); renderSide(); }
  } else if (act === 'ren') {
    const n = await ask('Переименовать подборку', f.name);
    if (n) { f.name = n; saveIndex(); ui.refresh(); }
  } else if (act === 'link') {
    // a Jira task, a Confluence page, a Figma file: shown in the collection's header, a click opens it (worklinks.js)
    const u = await ask('Ссылка на задачу Jira, страницу Confluence или файл Figma', 'https://');
    if (u && /^https?:\/\/\S+\.\S+/.test(u.trim())) { f.links = [...(f.links || []).filter((l) => l.url !== u.trim()), { url: u.trim() }]; saveIndex(); ui.refresh(); }
    else if (u) toast('Это не похоже на ссылку: нужен адрес вида https://…');
  } else if (act === 'md') {
    const [W, E] = await Promise.all([import('../lib/worklinks.js'), import('../lib/exporter.js')]);
    const md = W.collectionMd(f, E.folderItems(f.id));
    try { await navigator.clipboard.writeText(md); toast('Текст подборки скопирован — вставьте на страницу Confluence или в задачу Jira'); }
    catch (e) { toast('Не удалось скопировать текст подборки'); }
  } else if (act === 'exp') {
    const f = S.folders.find((x) => x.id === id);
    if (f) import('../lib/exporter.js').then((m) => m.runExport(m.folderItems(f.id), f.name, shift));
  } else if (act === 'del') {
    const ids = descend(id);
    // remember what goes away, so «Отменить» can put the collection and its files back
    const folders = S.folders.slice(), member = new Map(S.items.filter((it) => it.folders.some((x) => ids.has(x))).map((it) => [it, it.folders.slice()]));
    const view = S.view;
    S.folders = S.folders.filter((x) => !ids.has(x.id));
    member.forEach((_, it) => { it.folders = it.folders.filter((x) => !ids.has(x)); });
    if (S.view.type === 'folder' && ids.has(S.view.id)) S.view = { type: 'all', id: null };
    saveIndex(); ui.refresh();
    toast(`Подборка «${f.name}» удалена, файлы остались в библиотеке`, 0, { fn: () => {
      S.folders = folders;
      member.forEach((fl, it) => { it.folders = fl; });
      S.view = view;
      saveIndex(); ui.refresh();
    } });
  }
}

// the «⋯» menu of a collection row: opens under its button, closes on a pick, Esc, a click outside or a scroll
let menuEl = null;
function closeRowMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
function rowMenu(btn, id) {
  if (menuEl && menuEl.dataset.for === id) { closeRowMenu(); return; }
  closeRowMenu();
  const items = [['sub', 'plus', 'Вложенная подборка'], ['ren', 'edit', 'Переименовать'], ['exp', 'download', 'Экспорт в папку…'], ['expzip', 'download', 'Экспорт в zip…'], ['link', 'link', 'Ссылка на задачу или страницу…'], ['md', 'copy', 'Текст для Confluence / Jira'], ['del', 'trash', 'Удалить подборку']];
  menuEl = document.createElement('div');
  menuEl.className = 'ctx glass side-menu';
  menuEl.setAttribute('role', 'menu');
  menuEl.dataset.for = id;
  menuEl.innerHTML = items.map(([a, i, t]) => `<button type="button" class="mi${a === 'del' ? ' danger' : ''}" role="menuitem" data-fa="${a}">${ic(i)}<span>${t}</span></button>`).join('');
  document.body.appendChild(menuEl);
  const r = btn.getBoundingClientRect();
  menuEl.style.left = Math.min(innerWidth - 230, r.right - 8) + 'px';
  menuEl.style.top = Math.min(innerHeight - 230, r.top) + 'px';
  menuEl.addEventListener('click', (e) => {
    const m = e.target.closest('[data-fa]');
    if (!m) return;
    closeRowMenu();
    folderAct(m.dataset.fa === 'expzip' ? 'exp' : m.dataset.fa, id, m.dataset.fa === 'expzip');
  });
  menuEl.querySelector('.mi').focus();
  const away = (e) => { if (!menuEl || menuEl.contains(e.target)) return; closeRowMenu(); off(); };
  const key = (e) => { if (e.key === 'Escape') { closeRowMenu(); off(); btn.focus(); } };
  const off = () => { removeEventListener('pointerdown', away, true); removeEventListener('keydown', key, true); $('#sideScroll').removeEventListener('scroll', gone); };
  const gone = () => { closeRowMenu(); off(); };
  setTimeout(() => { addEventListener('pointerdown', away, true); addEventListener('keydown', key, true); $('#sideScroll').addEventListener('scroll', gone, { passive: true }); });
}
