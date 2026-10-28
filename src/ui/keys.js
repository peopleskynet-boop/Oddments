// Shortcut sheet: «?» shows every key Oddments knows, grouped by where it works. Esc, «?» again or a click
// outside closes it. It is a reference, not a step in a task, so it never takes over the window.
import { $ } from '../util.js';
import { ic } from './icons.js';
import { HOTKEYS } from './hotkeys.js';

// the wall's keys come from the table main.js runs (hotkeys.js); the layers' own keys are listed here
const LAYER_KEYS = [
  ['Просмотр', [['← →', 'соседний файл'], ['колесо', 'масштаб'], ['Esc', 'закрыть']]],
  ['3D', [['1–5', 'режим: рендер, глина, мэткап, нормали, UV'], ['W', 'каркас'], ['G', 'сетка пола'], ['F', 'сбросить вид'], ['I', 'информация']]],
  ['Конструктор иконок (как в Figma)', [
    ['V R O C', 'выбор, прямоугольник, эллипс, капсула'], ['Enter', 'править точки контура'],
    ['Alt A / D', 'по левому / правому краю'], ['Alt W / S', 'по верху / низу'], ['Alt H / V', 'по центру / середине'],
    ['Shift H / V', 'отразить по горизонтали / вертикали'], ['Ctrl ] / [', 'слой выше / ниже (+Shift — наверх / вниз)'],
    ['Ctrl C X V', 'копировать, вырезать, вставить (+Shift — на то же место)'], ['Ctrl D', 'дублировать'], ['Ctrl G / Ctrl Shift G', 'сгруппировать / разобрать'],
    ['Ctrl Shift H', 'скрыть / показать'], ['Tab', 'следующая фигура'], ['Shift 0 / 1 / 2', '100 %, вписать, к выделенному'],
    ['Пробел + тянуть', 'двигать холст'],
  ]],
  ['Боковая панель', [['↑ ↓', 'по разделам'], ['F2', 'переименовать подборку'], ['Insert', 'вложенная подборка'], ['Delete', 'удалить подборку']]],
];

function groups() {
  const g = new Map();
  for (const r of HOTKEYS) if (r.keys) { if (!g.has(r.group)) g.set(r.group, []); g.get(r.group).push([r.keys, r.what]); }
  return [...g, ...LAYER_KEYS];
}

let el = null, back = null;
export const isKeysOpen = () => !!(el && !el.hidden);

function build() {
  el = document.createElement('div');
  el.className = 'keys glass';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Клавиши');
  el.tabIndex = -1;
  el.innerHTML = `<div class="keys-h"><h2>Клавиши</h2><button type="button" class="ib" data-k="x" aria-label="Закрыть">${ic('x')}</button></div>` +
    `<div class="keys-g">${groups().map(([g, rows]) => `<section><h3>${g}</h3><dl>${rows.map(([k, d]) => `<dt>${k.split(' ').map((p) => (p === '+' || /^[а-яё]+$/.test(p) ? p : `<kbd>${p}</kbd>`)).join(' ')}</dt><dd>${d}</dd>`).join('')}</dl></section>`).join('')}</div>`;
  document.body.appendChild(el);
  el.addEventListener('click', (e) => { if (e.target.closest('[data-k="x"]')) toggleKeys(false); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); e.stopPropagation(); toggleKeys(false); } });
  document.addEventListener('pointerdown', (e) => { if (isKeysOpen() && !el.contains(e.target)) toggleKeys(false); }, true);
}

export function toggleKeys(on = !isKeysOpen()) {
  if (!el) build();
  if (on === isKeysOpen()) return;
  el.hidden = !on;
  if (on) { back = document.activeElement; el.focus({ preventScroll: true }); }
  else if (back && back.isConnected) back.focus({ preventScroll: true });
}
