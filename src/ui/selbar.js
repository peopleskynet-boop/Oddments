// Selection bar — after «Selection Actions» from Beautiful UI (beautifului.dev, MIT): when several files are
// selected, a glass pill rises above the dock with what can be done to all of them at once — favourite, a
// collection, Blender, rename, trash — and «Ещё» with the whole card menu. One file has the properties panel
// for that, so the bar waits for two. The actions are the context menu's own (ctxmenu.js → cardAction).
import { S } from '../state.js';
import { ic } from './icons.js';
import { cardAction, openCardMenu, isMenuOpen, closeMenu } from './ctxmenu.js';
import { toast } from './dialogs.js';

let el = null, onSel = null, shown = false;

const items = () => Array.from(S.sel).map((id) => S.byId.get(id)).filter(Boolean);

function html(list) {
  const n = list.length;
  const b = (id, icon, label, cls = '') => `<button type="button" class="sb-b${cls}" data-sb="${id}">${ic(icon)}<span>${label}</span></button>`;
  if (list.every((i) => i.trashed)) {
    return `<span class="sb-n"><b>${n}</b> выбрано</span>${b('restore', 'restore', 'Вернуть')}<button type="button" class="ib sb-x" data-sb="clear" title="Снять выделение (Esc)" aria-label="Снять выделение">${ic('x')}</button>`;
  }
  const allFav = list.every((i) => i.fav);
  const b3d = list.some((i) => i.kind === 'model' || i.kind === 'material');
  const pii = list.some((i) => i.pii && i.pii.length && !i.masked);
  return `<span class="sb-n"><b>${n}</b> выбрано</span>`
    + `<button type="button" class="ib sb-grip" data-sb="grip" title="Перетащите выбранные в другую программу" aria-label="Перетащить выбранные в другую программу">${ic('grip')}</button>`
    + b('fav', allFav ? 'heartOn' : 'heart', allFav ? 'Из избранного' : 'В избранное')
    + b('folder', 'folderplus', 'В подборку')
    + (b3d ? b('blender', 'external', 'В Blender') : '')
    + (pii ? b('mask', 'shield', 'Скрыть личные данные') : '')
    + ((S.teams || []).length && list.every((i) => !i.team) ? b('toteam', 'team', 'В команду') : '')
    + b('rename', 'edit', 'Переименовать')
    + b('trash', 'trash', 'В корзину', ' danger')
    + `<button type="button" class="ib sb-more" data-sb="more" title="Все действия" aria-label="Все действия">${ic('more')}</button>`
    + `<button type="button" class="ib sb-x" data-sb="clear" title="Снять выделение (Esc)" aria-label="Снять выделение">${ic('x')}</button>`;
}

export function updateSelBar() {
  if (!el) return;
  const list = items();
  const on = list.length > 1 && !document.body.classList.contains('tidy-on') && !document.body.classList.contains('dupes-on');
  if (on) {
    el.innerHTML = html(list);
    if (!shown) { el.hidden = false; void el.offsetWidth; }
  }
  el.classList.toggle('on', on);
  document.body.classList.toggle('sb-on', on);
  // gone for real (and for screen readers) after its fade; without animations there is no transitionend to wait for
  if (!on && shown) setTimeout(() => { if (!shown) el.hidden = true; }, document.body.classList.contains('motion') ? 400 : 0);
  shown = on;
}

export function initSelBar(selectionChanged) {
  onSel = selectionChanged;
  el = document.createElement('div');
  el.className = 'selbar glass';
  el.setAttribute('role', 'toolbar');
  el.setAttribute('aria-label', 'Действия с выделенными');
  el.hidden = true;
  document.body.appendChild(el);
  el.addEventListener('pointerdown', (e) => e.stopPropagation()); // a click on the bar is not a click on the wall
  import('../lib/dragout.js').then((m) => m.bindDragOut(el, '.sb-grip', items, () => toast('Перетаскивание в другие программы — в приложении Oddments'), () => toast('Зажмите ⠿ и перетащите выбранное в другую программу: Figma, Blender, PureRef, Проводник', 4500)));
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sb]');
    if (!b) return;
    e.stopPropagation();
    const a = b.dataset.sb;
    if (a === 'clear') { S.sel.clear(); onSel(); return; }
    if (a === 'more' || a === 'folder') {
      if (isMenuOpen()) { closeMenu(); return; }
      const r = b.getBoundingClientRect();
      openCardMenu(r.left, r.top - 8, a === 'folder' ? 'folder' : null);
      return;
    }
    cardAction(a, items()).then(() => updateSelBar());
  });
}
