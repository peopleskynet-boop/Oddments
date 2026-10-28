// «Знакомство» — a quiet first-run guide for people new to Oddments. It never blocks the app: a small card at the
// bottom of the sidebar lists four real actions, each step ticks itself off when the person actually does it
// (anywhere in the app), «Показать» points at the control with a ring and one sentence. It can be hidden; when
// every step is done it says so once and folds away. Settings › «Показать знакомство» brings it back.
import { $ } from '../util.js';
import { ic } from './icons.js';
import { sfx } from './sound.js';
import { toast } from './dialogs.js';
import { readPref, writePref } from '../lib/prefs.js';

const KEY = 'perch.onboard';
const STEPS = [
  { id: 'add', title: 'Добавьте референс', how: 'Скопируйте картинку где угодно и нажмите Ctrl V прямо в Oddments. Или перетащите файлы в окно, или нажмите «Добавить».', target: '#addBtn' },
  { id: 'edges', title: 'Включите чистый экран', how: 'Клавиша \ (или «Обычный вид» внизу слева) убирает все панели — на виду только референсы. Панели возвращаются, если подвести мышь к краю: слева — разделы, сверху — поиск, снизу — размер. Ещё раз \ — обычный вид.', target: '#sideTog' },
  { id: 'open', title: 'Откройте просмотр', how: 'Двойной клик по карточке или Пробел. Стрелки листают, Esc закрывает.', target: '#grid .card' },
  { id: 'color', title: 'Найдите по цвету', how: 'Кружок в строке поиска: выберите цвет, и в сетке останутся картинки с ним.', target: '#filtBtn' },
  { id: '3d', title: 'Попробуйте 3D', how: 'Откройте модель из «3D › 3D-модели» и покрутите её, или превратите SVG-иконку в модель для Blender: «3D › SVG в 3D».', target: '.nav[data-vt="tool-svg3d"]' },
];

let state = { done: [], hidden: false, finished: false };
Object.assign(state, readPref(KEY, {}));
const save = () => writePref(KEY, state); // private mode: the card just comes back

// open on the first run; after the first step done it folds to one line (audit 24.10: the open card covered the
// lower third of the sidebar), unless the person opened it themselves
let el = null, open = state.open ?? !state.done.length, spot = null;

export function initOnboard() {
  const side = $('#side');
  if (!side) return;
  el = document.createElement('section');
  el.className = 'ob';
  el.setAttribute('aria-label', 'Знакомство с Oddments');
  side.insertBefore(el, side.querySelector('.side-foot'));
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ob]');
    if (!b) return;
    const a = b.dataset.ob;
    if (a === 'toggle') { open = !open; state.open = open; save(); draw(); }
    else if (a === 'hide') { hideOnboard(); toast('Знакомство убрано — вернуть можно в Настройках', 5000, { label: 'Вернуть', fn: showOnboard }); }
    else if (a === 'show') point(STEPS.find((s) => s.id === b.dataset.step));
  });
  draw();
}

// an action somewhere in the app counts towards its step
export function markStep(id) {
  if (state.done.includes(id) || !STEPS.some((s) => s.id === id)) return;
  state.done.push(id);
  save();
  if (spot && spot.step === id) unpoint();
  if (!el || state.hidden) return;
  if (state.done.length === STEPS.length && !state.finished) { state.finished = true; save(); sfx('done'); open = true; }
  else if (state.open == null) open = false; // the first step done: one line from now on
  draw();
}

export function hideOnboard() { state.hidden = true; save(); unpoint(); draw(); }
export function showOnboard() { state.hidden = false; state.finished = state.done.length === STEPS.length && state.finished; open = true; save(); draw(); }

function draw() {
  if (!el) return;
  const all = STEPS.length, n = STEPS.filter((s) => state.done.includes(s.id)).length;
  el.hidden = state.hidden;
  if (state.hidden) return;
  const complete = n === all;
  el.classList.toggle('open', open);
  el.classList.toggle('complete', complete);
  // the close cross sits in the header, always visible, so the card is easy to get rid of
  el.innerHTML = `<div class="ob-top"><button type="button" class="ob-head" data-ob="toggle" aria-expanded="${open}">
      <span class="ob-t">${complete ? 'Готово — Oddments ваш' : 'Знакомство'}</span>
      <span class="ob-dots" aria-label="${n} из ${all}">${STEPS.map((s) => `<i class="${state.done.includes(s.id) ? 'on' : ''}"></i>`).join('')}</span>
      ${ic('chev')}</button><button type="button" class="ob-x" data-ob="hide" aria-label="Убрать знакомство" title="Убрать (вернуть — Настройки › «Показать знакомство»)">${ic('x')}</button></div>` +
    (open ? `<div class="ob-body">` +
      (complete
        ? '<p class="ob-p">Сохраняйте находки за одно движение, ищите их по цвету и тегам, держите 3D рядом с картинками. Клавиши — по «?».</p>'
        : `<ol class="ob-list">${STEPS.map((s) => {
            const d = state.done.includes(s.id);
            return `<li class="${d ? 'done' : ''}"><span class="ob-c" aria-hidden="true">${d ? ic('check') : ''}</span><span class="ob-s">${s.title}<span class="sr">${d ? ' — сделано' : ''}</span></span>${d ? '' : `<button type="button" class="lnk" data-ob="show" data-step="${s.id}">Показать</button>`}</li>`;
          }).join('')}</ol>`) +
      `<button type="button" class="ibtn ob-hide" data-ob="hide">${complete ? 'Закрыть' : 'Скрыть, разберусь сам'}</button></div>` : '');
}

/* ---------- «Показать»: a ring around the control and one sentence next to it ---------- */
function point(step) {
  unpoint();
  if (!step) return;
  let target = document.querySelector(step.target);
  if (step.id === 'open') target = Array.from(document.querySelectorAll('#grid .card')).find((c) => { const r = c.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }) || target;
  if (!target || !target.getClientRects().length) { if (step.id === 'open' || step.id === '3d') target = $('#grid') || target; }
  if (!target || !target.getClientRects().length) return;
  target.scrollIntoView({ block: 'nearest' });
  const r = target.getBoundingClientRect();
  const ring = document.createElement('div');
  ring.className = 'ob-ring';
  ring.style.cssText = `left:${r.left - 6}px;top:${r.top - 6}px;width:${r.width + 12}px;height:${r.height + 12}px`;
  const tip = document.createElement('div');
  tip.className = 'ob-tip glass';
  tip.setAttribute('role', 'dialog');
  tip.setAttribute('aria-label', step.title);
  tip.innerHTML = `<b>${step.title}</b><p>${step.how}</p><button type="button" class="ibtn" data-ob="ok">Понятно</button>`;
  document.body.append(ring, tip);
  // next to the control: below it if there is room, otherwise above; kept inside the window
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let x = Math.min(Math.max(12, r.left), innerWidth - tw - 12), y = r.bottom + 14;
  if (y + th > innerHeight - 12) y = Math.max(12, r.top - th - 14);
  if (r.width > innerWidth * 0.5) { x = Math.min(innerWidth - tw - 12, r.left + 24); y = Math.min(innerHeight - th - 12, r.top + 24); }
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
  tip.querySelector('[data-ob="ok"]').addEventListener('click', unpoint);
  const off = (e) => { if (!tip.contains(e.target)) unpoint(); };
  setTimeout(() => document.addEventListener('pointerdown', off, true));
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); unpoint(); } };
  document.addEventListener('keydown', esc, true);
  spot = { step: step.id, ring, tip, off, esc };
  tip.querySelector('[data-ob="ok"]').focus({ preventScroll: true });
  sfx('tick');
}

function unpoint() {
  if (!spot) return;
  spot.ring.remove(); spot.tip.remove();
  document.removeEventListener('pointerdown', spot.off, true);
  document.removeEventListener('keydown', spot.esc, true);
  spot = null;
}
