// The top of the content area: big title with a dot-matrix counter, Drinkit-style stats,
// collection covers (top-level folders), sticky tabs, and the "new files" line.
import { S, ui, KINDS, flatFolders, activeItems, folderById } from '../state.js';
import { $, esc, fmtSize, plural } from '../util.js';
import { ic } from './icons.js';
import { assetUrl, saveIndex } from '../lib/library.js';
import { slideIndicator, tick } from './motion.js';
import { viewTitle, setView, matchesQuery } from '../lib/filter.js';
import { openDupes } from './lazy.js';
import { arm, toast } from './dialogs.js';
import { purgeItems } from '../lib/library.js';
import { settings } from './settings.js';

const WEEK = 7 * 864e5;
const freshCount = () => S.items.reduce((n, i) => n + (i.fresh && !i.trashed ? 1 : 0), 0);

function stats() {
  const all = activeItems();
  const size = all.reduce((s, i) => s + i.size, 0);
  const week = all.filter((i) => i.added > Date.now() - WEEK).length;
  const nf = S.folders.length;
  const cell = (dt, dd, hl) => `<div><dt${hl ? ' class="hl"' : ''}>${dt}</dt><dd>${dd}</dd></div>`;
  return cell(esc(fmtSize(size)).replace(' ', '&nbsp;'), 'на&nbsp;диске') +
    cell(String(nf), plural(nf, ['подборка', 'подборки', 'подборок'])) +
    (week ? cell('+' + week, 'за&nbsp;неделю') : '');
}

let moreKinds = [];

function tabs() {
  const v = S.view, all = activeItems();
  // counts follow the search and colour filter; a type with nothing under the filter stays, dimmed
  const base = S.q.trim() || S.color ? all.filter(matchesQuery()) : all;
  const kinds = Object.keys(KINDS).filter((k) => all.some((i) => i.kind === k));
  const fresh = freshCount();
  const t = (vt, id, label, extra = '') => {
    const on = v.type === vt && (v.id || null) === (id || null);
    return `<button class="chip${on ? ' on' : ''}" aria-pressed="${on}" data-vt="${vt}"${id ? ` data-id="${id}"` : ''}>${label}${extra}</button>`;
  };
  let h = t('all', null, 'Всё');
  // the active colour filter sits up front: at the end of a long row it would be scrolled out of sight
  if (S.color) h += `<button class="chip col" data-act="clrColor" title="Убрать фильтр по цвету" aria-label="Фильтр по цвету ${S.color.toUpperCase()}, убрать"><i style="background:${S.color}"></i>${S.color.toUpperCase()}<span class="x">${ic('x')}</span></button>`;
  if (fresh) { const nf = base === all ? fresh : base.filter((i) => i.fresh).length; h += t('new', null, '<span class="dotn"></span>Новые', `<span class="n">${nf}</span>`).replace('class="chip', `class="chip${nf ? '' : ' zero'}`); }
  // the three biggest types stay in the row (and the open one); the rest wait behind «Ещё»
  const count = (k) => base.filter((i) => i.kind === k).length;
  const byN = kinds.slice().sort((a, b) => all.filter((i) => i.kind === b).length - all.filter((i) => i.kind === a).length);
  const shown = byN.slice(0, 3);
  if (v.type === 'kind' && !shown.includes(v.id) && kinds.includes(v.id)) shown.push(v.id);
  const chip = (k) => { const n = count(k); return t('kind', k, KINDS[k].label, `<span class="n">${n}</span>`).replace('class="chip', `class="chip${n ? '' : ' zero'}`); };
  h += kinds.filter((k) => shown.includes(k)).map(chip).join('');
  moreKinds = kinds.filter((k) => !shown.includes(k)).map((k) => [k, count(k)]);
  if (moreKinds.length) h += `<button class="chip more" data-act="moreKinds" aria-haspopup="menu" aria-expanded="false">Ещё${ic('chev')}</button>`;
  return h;
}

// Empty results say what filtered them out and offer the next step, not just "nothing here".
function emptyText(v, filtered) {
  if (!filtered) return v.type === 'trash' ? 'Удалённые файлы появятся здесь.' : 'Перетащите сюда файлы или выберите их в другом разделе.';
  const wide = S.colorTol >= 100;
  if (S.color && !S.q.trim()) return wide ? `Здесь нет файлов с цветом ${S.color.toUpperCase()}, даже при самой широкой точности.` : `Здесь нет файлов с цветом ${S.color.toUpperCase()}. Можно искать шире — по похожим оттенкам.`;
  if (S.color) return `Ничего с «${esc(S.q.trim())}» и цветом ${S.color.toUpperCase()}. Уберите цвет или измените запрос.`;
  return v.type === 'all' ? `Ничего с «${esc(S.q.trim())}» в названиях, тегах, заметках и ссылках.` : `В этом разделе ничего с «${esc(S.q.trim())}». Поищите во всей библиотеке.`;
}
function emptyActs() {
  let h = '';
  if (S.color && !S.q.trim() && S.colorTol < 100) h += '<button class="pill" data-act="widen">Искать шире</button>';
  if (S.q.trim() && S.view.type !== 'all') h += '<button class="pill" data-act="everywhere">Искать во всей библиотеке</button>';
  return h + '<button class="pill ghost" data-act="reset">Сбросить фильтры</button>';
}

let keepBar = false, shownFor = null;

export function renderHead() {
  const v = S.view;
  $('#vTitle').textContent = viewTitle();
  $('#trTitle').textContent = viewTitle();
  $('#trCount').textContent = S.vis.length;
  tick($('#vCount'), S.vis.length);
  $('#vCount').title = `${S.vis.length} ${plural(S.vis.length, ['файл', 'файла', 'файлов'])}` + (S.sel.size ? `, выбрано ${S.sel.size}` : '');
  const home = v.type === 'all' && !S.q && !S.color;
  $('#stats').innerHTML = home ? stats() : (S.sel.size ? `<div><dt>${S.sel.size}</dt><dd>выбрано</dd></div>` : '');
  // collection covers used to repeat the «Подборки» list of the sidebar here; the header keeps only the title
  $('#covers').hidden = true;
  $('#tabs').innerHTML = tabs();
  slideIndicator($('#tabs'), '.chip.on', 'tab-ind');
  fitTabs(true);
  // the trash: where the extra copies end up, so duplicates are found from here
  // a flow collection (a recording cut into screens): its storyboard and the walk-through
  const flow = v.type === 'folder' && (folderById(v.id) || {}).flow;
  $('#vAct').innerHTML = v.type === 'trash' ? trashActs() : flow ? flowActs() : '';
  // the clean screen hides the view's header: the trash's two buttons float on top of the wall there (bugs #59, #62)
  trashBar(v.type === 'trash' ? 'trash' : flow ? 'flow' : '');

  // The "N new" line keeps its place while you look at the view: if it vanished the moment the last
  // new file was seen, every card below would jump up. It goes away on the next view change.
  const fresh = freshCount(), nb = $('#newbar');
  const viewKey = v.type + '|' + (v.id || '') + '|' + S.q + '|' + (S.color || '');
  if (viewKey !== shownFor) { keepBar = !!fresh; shownFor = viewKey; }
  if (fresh) keepBar = true;
  nb.hidden = !keepBar || v.type === 'trash' || !S.vis.length; // no «N новых» line over an empty result
  nb.classList.toggle('done', !fresh);
  nb.innerHTML = fresh
    ? `<i></i><span><b>${fresh} ${plural(fresh, ['новый', 'новых', 'новых'])}</b> — отметка исчезнет, когда вы их увидите</span><hr><button data-act="seenAll">Отметить всё</button>`
    : '<i></i><span>Всё новое просмотрено</span><hr>';

  const filtered = S.q || S.color;
  const fresh0 = !filtered && v.type === 'all';
  const em = $('#empty');
  em.classList.toggle('first', fresh0);
  em.innerHTML = fresh0
    ? `<div class="scatter" aria-hidden="true">${'<i></i>'.repeat(9)}</div><div class="em-body"><h2>Соберите первые референсы</h2><p>Скопируйте картинку где угодно и&nbsp;нажмите <kbd>Ctrl</kbd>&nbsp;<kbd>V</kbd> прямо здесь. Или перетащите файлы в&nbsp;окно.</p><p class="em-3d">Модели тоже сюда: GLB, OBJ, FBX, .blend. Из&nbsp;Blender — аддоном Oddments, он есть в&nbsp;настройках.</p><button class="pill" data-act="pick">${ic('plus')}<span>Добавить файлы</span></button></div>`
    : `<div class="em-body"><h2>${filtered ? 'Ничего не нашлось' : v.type === 'trash' ? 'Корзина пуста' : 'Здесь пока пусто'}</h2><p>${emptyText(v, filtered)}</p>${filtered ? emptyActs() : ''}</div>`;
  document.body.classList.toggle('view-empty', !S.vis.length);
  document.body.classList.toggle('has-sel', S.sel.size > 0);
  const it = $('#inspTog');
  it.disabled = !S.sel.size;
  it.setAttribute('aria-pressed', String(!settings.inspOff));
  it.title = !S.sel.size ? 'Панель свойств — сначала выберите файл' : settings.inspOff ? 'Панель свойств скрыта — показать ( ] )' : 'Панель свойств — скрыть ( ] )';
  // the panel was hidden (] or this button) and a file is picked: say so once, or it looks broken (bug #83)
  if (S.sel.size && settings.inspOff && !inspHinted) {
    inspHinted = true;
    toast('Панель свойств скрыта', 5000, { label: 'Показать ( ] )', fn: () => it.click() });
  }
  document.body.classList.toggle('home', v.type === 'all');
  $('#filtBtn').classList.toggle('on', !!S.color);
  $('#simBtn').disabled = S.sel.size !== 1;
  $('#backBtn').disabled = home;
}

// The tab row scrolls sideways when the types do not fit: fade the edge that hides something,
// and keep the active tab in view.
function fitTabs(reveal) {
  const t = $('#tabs');
  if (reveal) {
    const a = t.querySelector('.chip.on');
    if (a && (a.offsetLeft < t.scrollLeft || a.offsetLeft + a.offsetWidth > t.scrollLeft + t.clientWidth)) {
      t.scrollLeft = a.offsetLeft - (t.clientWidth - a.offsetWidth) / 2;
    }
  }
  t.classList.toggle('fl', t.scrollLeft > 2);
  t.classList.toggle('fr', t.scrollLeft + t.clientWidth < t.scrollWidth - 2);
}

export function markAllSeen() {
  let n = 0;
  S.items.forEach((i) => { if (i.fresh) { i.fresh = false; n++; } });
  document.querySelectorAll('#grid .card .newdot').forEach((d) => d.closest('.card').classList.add('seen'));
  if (n) { saveIndex(); ui.refresh(); }
}

// «Ещё»: the smaller file types in a small glass menu under the chip. ↑/↓ move, Enter opens, Esc closes.
let kmenu = null;
function closeKindMenu(focusBtn) {
  if (!kmenu) return;
  const btn = kmenu.__btn;
  kmenu.remove(); kmenu = null;
  if (btn) { btn.setAttribute('aria-expanded', 'false'); if (focusBtn) btn.focus(); }
}
function kindMenu(btn) {
  if (kmenu) { closeKindMenu(); return; }
  kmenu = document.createElement('div');
  kmenu.className = 'menu glass kmenu';
  kmenu.setAttribute('role', 'menu');
  kmenu.__btn = btn;
  kmenu.innerHTML = moreKinds.map(([k, n]) => `<button type="button" role="menuitem" class="mi${n ? '' : ' zero'}" data-k="${k}"><span>${esc(KINDS[k].label)}</span><span class="n">${n}</span></button>`).join('');
  document.body.appendChild(kmenu);
  const r = btn.getBoundingClientRect();
  kmenu.style.left = Math.min(r.left, innerWidth - kmenu.offsetWidth - 12) + 'px';
  kmenu.style.top = r.bottom + 8 + 'px';
  btn.setAttribute('aria-expanded', 'true');
  const items = Array.from(kmenu.querySelectorAll('.mi'));
  items[0].focus();
  kmenu.addEventListener('click', (e) => { const m = e.target.closest('[data-k]'); if (m) { closeKindMenu(); setView('kind', m.dataset.k); } });
  kmenu.addEventListener('keydown', (e) => {
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); closeKindMenu(true); }
  });
  setTimeout(() => document.addEventListener('pointerdown', function off(e) {
    if (kmenu && !kmenu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) closeKindMenu();
    if (!kmenu) document.removeEventListener('pointerdown', off, true);
  }, true));
}

// «Найти дубликаты» and «Очистить корзину» with what will go: «Удалить навсегда 42 файла · 1,3 ГБ»
function trashActs() {
  const gone = S.items.filter((i) => i.trashed), bytes = gone.reduce((a, i) => a + (i.size || 0), 0);
  return `<button class="pill ghost" data-act="dupes" title="Точные копии и очень похожие картинки во всей библиотеке">${ic('copy')}<span>Найти дубликаты</span></button>`
    + (gone.length ? `<button class="pill ghost danger" data-act="empty" title="Файлы удалятся с диска навсегда">${ic('trash')}<span>Очистить корзину · ${gone.length} ${plural(gone.length, ['файл', 'файла', 'файлов'])}, ${fmtSize(bytes)}</span></button>` : '');
}
function flowActs() {
  return `<button class="pill ghost" data-act="story" title="Все шаги в ряд со стрелками">${ic('flow')}<span>Раскадровка</span></button>`
    + `<button class="pill ghost" data-act="walk" title="Шаг за шагом в рамке телефона">${ic('play')}<span>Пройти сценарий</span></button>`;
}
const story = (how) => { if (S.view.type === 'folder') import('./storyboard.js').then((m) => m.openStory(S.view.id, how)); };
let inspHinted = false;
let bar = null;
function trashBar(kind) {
  const on = !!kind;
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'trashbar glass';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Корзина');
    document.body.appendChild(bar);
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'dupes') openDupes();
      else if (b.dataset.act === 'empty') emptyTrash(b);
      else if (b.dataset.act === 'story') story('board');
      else if (b.dataset.act === 'walk') story('walk');
    });
  }
  bar.innerHTML = kind === 'trash' ? trashActs() : kind === 'flow' ? flowActs() : '';
  bar.setAttribute('aria-label', kind === 'flow' ? 'Сценарий' : 'Корзина');
  document.body.classList.toggle('in-trash', on); // the floating bar's place on the clean screen (styles: .trashbar)
}
// the two-step «Точно? Ещё раз» confirm, then the files are deleted from the disk
export function emptyTrash(b) {
  arm(b, async () => { await purgeItems(S.items.filter((i) => i.trashed)); ui.refresh(); toast('Корзина очищена'); });
}
// from the palette and the left panel's menu: open the trash and arm its button, so one more click deletes
export function askEmptyTrash() {
  setView('trash');
  requestAnimationFrame(() => {
    const b = (document.body.classList.contains('clean') ? bar : $('#vAct')).querySelector('[data-act="empty"]');
    if (b) { b.focus(); emptyTrash(b); } else toast('Корзина уже пуста');
  });
}

export function initHead({ newFolder, pick }) {
  const scroll = $('#scroll'), tabsEl = $('#tabs');
  tabsEl.addEventListener('scroll', () => fitTabs(false), { passive: true });
  // a plain mouse wheel scrolls the row sideways
  tabsEl.addEventListener('wheel', (e) => {
    if (tabsEl.scrollWidth <= tabsEl.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    tabsEl.scrollLeft += e.deltaY;
  }, { passive: false });
  new ResizeObserver(() => fitTabs(false)).observe(tabsEl);
  // once the big header has scrolled away, its title and count ride along in the sticky tab row
  const head = document.querySelector('.head');
  new IntersectionObserver(([en]) => document.body.classList.toggle('head-gone', !en.isIntersecting), { root: scroll, rootMargin: '-24px 0px 0px 0px' }).observe(head);
  $('#trTop').addEventListener('click', () => scroll.scrollTo({ top: 0, behavior: document.body.classList.contains('motion') ? 'smooth' : 'auto' }));
  scroll.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act],[data-vt],[data-fid]');
    if (!b || !scroll.contains(b) || b.closest('#grid')) return;
    if (b.dataset.fid) return setView('folder', b.dataset.fid);
    if (b.dataset.vt) return setView(b.dataset.vt, b.dataset.id);
    const a = b.dataset.act;
    if (a === 'clrColor') { S.color = null; S.sel.clear(); ui.refresh(); }
    else if (a === 'seenAll') markAllSeen();
    else if (a === 'newfolder') newFolder();
    else if (a === 'pick') pick();
    else if (a === 'dupes') openDupes();
    else if (a === 'story') story('board');
    else if (a === 'walk') story('walk');
    else if (a === 'moreKinds') kindMenu(b);
    else if (a === 'reset') { S.q = ''; S.color = null; $('#q').value = ''; ui.refresh(); }
    else if (a === 'widen') {
      // one click: widen just enough for the nearest shades to show up (or to the widest, if nothing is near)
      const all = activeItems();
      do S.colorTol = Math.min(100, S.colorTol + 10); while (S.colorTol < 100 && !all.some(matchesQuery()));
      ui.refresh();
    }
    else if (a === 'everywhere') setView('all');
  });
}

export { flatFolders };
