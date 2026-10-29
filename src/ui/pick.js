// «Выберите картинку»: the library's files as tiles for a tool started with nothing fitting selected — the palette's
// «Убрать фон», «Увеличить», «Скрыть личные данные» (audit 29.10: the palette hid these tools until the right file was
// selected, «Ничего не нашлось» on «фон»). A search by name and tag, arrows and Enter, Esc or a click elsewhere closes.
// The look follows the «SVG в 3D» picker (svg3d.js).
import './pick.css';
import { S } from '../state.js';
import { esc } from '../util.js';
import { ic } from './icons.js';
import { assetUrl } from '../lib/library.js';
import { sfx } from './sound.js';

let el = null, cur = null, back = null;
const COLS = 4;

export function pickItem({ title, filter, run, empty = 'Подходящих файлов в библиотеке пока нет.' }) {
  if (!el) build();
  cur = { filter, run, empty };
  back = document.activeElement;
  el.querySelector('h2').textContent = title;
  el.setAttribute('aria-label', title);
  const q = el.querySelector('.pk-q');
  q.value = '';
  fill('');
  el.hidden = false;
  sfx('open');
  requestAnimationFrame(() => (el.querySelector('[data-pid]') || q).focus());
}

function close(it) {
  if (!el || el.hidden) return;
  el.hidden = true;
  sfx('close');
  if (it) cur.run(it);
  else if (back && back.isConnected && back.focus) back.focus();
}

function build() {
  el = document.createElement('div');
  el.className = 'pk glass';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.innerHTML = `<div class="pk-h"><h2></h2><button type="button" class="ib" data-pk="x" aria-label="Закрыть" title="Закрыть (Esc)">${ic('x')}</button></div>
    <input class="pk-q" type="search" placeholder="Найти по названию или тегу" aria-label="Поиск файла" autocomplete="off">
    <div class="pk-grid" role="listbox" aria-label="Файлы библиотеки"></div>`;
  document.body.appendChild(el);
  const q = el.querySelector('.pk-q');
  q.addEventListener('input', () => fill(q.value));
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pk], [data-pid]');
    if (!b) return;
    if (b.dataset.pk === 'x') close();
    else close(S.byId.get(b.dataset.pid));
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    const tiles = Array.from(el.querySelectorAll('[data-pid]'));
    const i = tiles.indexOf(document.activeElement);
    const go = (j) => { if (tiles[j]) tiles[j].focus(); };
    if (e.key === 'Enter' && document.activeElement === q && tiles.length) { e.preventDefault(); close(S.byId.get(tiles[0].dataset.pid)); }
    else if (e.key === 'ArrowDown' && document.activeElement === q) { e.preventDefault(); go(0); }
    else if (i >= 0 && ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault();
      if (e.key === 'ArrowUp' && i < COLS) q.focus();
      else go(i + { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS }[e.key]);
    }
    e.stopPropagation(); // the wall underneath keeps its keys
  });
  document.addEventListener('pointerdown', (e) => { if (el && !el.hidden && !el.contains(e.target)) close(); }, true);
}

function fill(query) {
  const words = query.trim().toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean);
  const all = S.items.filter((i) => !i.trashed && cur.filter(i));
  const list = all.filter((i) => words.every((w) => (i.name + ' ' + i.tags.join(' ')).toLowerCase().replace(/ё/g, 'е').includes(w))).slice(0, 240);
  const grid = el.querySelector('.pk-grid');
  grid.innerHTML = list.length
    ? list.map((it) => `<button type="button" role="option" class="pk-t" data-pid="${esc(it.id)}" title="${esc(it.name)}"><span class="pk-img"><img src="${assetUrl(it.thumb || it.file)}" alt="" draggable="false" loading="lazy"></span><span class="pk-n">${esc(it.name)}</span></button>`).join('')
    : `<p class="pk-empty">${all.length ? 'Ничего не нашлось.' : esc(cur.empty)}</p>`;
}
