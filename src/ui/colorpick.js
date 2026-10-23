// Colour search: a row of presets plus a hue/saturation wheel with brightness, HEX,
// tolerance and recently used colours. Picking updates the grid live.
import { S, ui, activeItems } from '../state.js';
import { $, colorDist, plural } from '../util.js';
import { markStep } from './onboard.js';
import { okDist } from '../lib/palette.js';

const PRESETS = ['#ff453a', '#ff9f0a', '#ffd60a', '#30d158', '#64d2ff', '#0a84ff', '#5e5ce6', '#bf5af2',
  '#ff375f', '#a2845e', '#8e8e93', '#1c1c1e', '#ffffff', '#f2e6d0', '#2c3b34', '#14213d'];
const NAMES = { '#ff453a': 'Красный', '#ff9f0a': 'Оранжевый', '#ffd60a': 'Жёлтый', '#30d158': 'Зелёный', '#64d2ff': 'Голубой',
  '#0a84ff': 'Синий', '#5e5ce6': 'Индиго', '#bf5af2': 'Фиолетовый', '#ff375f': 'Розовый', '#a2845e': 'Коричневый', '#8e8e93': 'Серый',
  '#1c1c1e': 'Чёрный', '#ffffff': 'Белый', '#f2e6d0': 'Бежевый', '#2c3b34': 'Тёмно-зелёный', '#14213d': 'Тёмно-синий' };
const R = 86; // wheel radius, px
const RECENT_KEY = 'perch.recentColors';

const hsv2hex = (h, s, v) => {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return '#' + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
};
const hex2hsv = (hx) => {
  const n = parseInt(hx.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) { h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return [h, mx ? d / mx : 0, mx];
};

let H = 40, Sat = 0.7, V = 0.9, timer = null;

function recent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e) { return []; } }
function remember(hx) {
  const r = [hx, ...recent().filter((c) => c !== hx)].slice(0, 6);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(r)); } catch (e) { /* ignore */ }
}

function countFor(hx) {
  const lim = 0.05 + S.colorTol * 0.0022; // the same measure as the search (filter.js)
  return activeItems().filter((i) => i.colors.some((c) => okDist(c, hx) < lim)).length;
}

function build() {
  const el = $('#pop');
  el.innerHTML = `
    <div class="hd"><b>Поиск по цвету</b><button class="ib" data-act="close" aria-label="Закрыть">×</button></div>
    <div class="presets">${PRESETS.map((c) => `<button data-c="${c}" style="background:${c}" title="${NAMES[c]} ${c.toUpperCase()}" aria-label="${NAMES[c]}"></button>`).join('')}</div>
    <div class="wheel-wrap">
      <div class="wheel" id="wheel" role="slider" tabindex="0" aria-label="Цветовой круг: стрелки влево и вправо меняют тон, вверх и вниз — насыщенность"><div class="shade" id="shade"></div><div class="knob" id="knob"></div></div>
      <div class="wside">
        <div class="cur" id="cur"></div>
        <input class="hex" id="hexIn" spellcheck="false" aria-label="HEX" maxlength="7">
        <span class="cap-sm">Яркость</span>
        <input class="vrange" id="valIn" type="range" min="0" max="100" aria-label="Яркость">
      </div>
    </div>
    <label class="row2"><span class="cap-sm">Точность</span><input class="vrange tol" id="tolIn" type="range" min="0" max="100" value="${100 - S.colorTol}" aria-label="Точность"></label>
    <div class="row2"><div class="recent" id="recent"></div><span class="cap-sm"><b id="found"></b></span></div>
    <button class="pill ghost wide" data-act="reset">Сбросить цвет</button>`;

  const wheel = $('#wheel');
  const pick = (e) => {
    const r = wheel.getBoundingClientRect(), x = e.clientX - r.left - R, y = e.clientY - r.top - R;
    H = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; Sat = Math.min(1, Math.hypot(x, y) / R);
    apply();
  };
  wheel.addEventListener('pointerdown', (e) => { wheel.setPointerCapture(e.pointerId); pick(e); wheel.onpointermove = pick; });
  wheel.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 15 : 5;
    if (e.key === 'ArrowLeft') H = (H - step + 360) % 360;
    else if (e.key === 'ArrowRight') H = (H + step) % 360;
    else if (e.key === 'ArrowUp') Sat = Math.min(1, Sat + 0.05);
    else if (e.key === 'ArrowDown') Sat = Math.max(0, Sat - 0.05);
    else return;
    e.preventDefault(); e.stopPropagation();
    apply();
  });
  wheel.addEventListener('pointerup', () => { wheel.onpointermove = null; if (S.color) remember(S.color); drawRecent(); });
  $('#valIn').oninput = (e) => { V = e.target.value / 100; apply(); };
  $('#tolIn').oninput = (e) => { S.colorTol = 100 - +e.target.value; apply(true); };
  $('#hexIn').oninput = (e) => {
    const v = e.target.value.trim();
    if (/^#?[0-9a-f]{6}$/i.test(v)) { setHex(v.startsWith('#') ? v : '#' + v); apply(false, true); }
  };
  el.addEventListener('click', (e) => {
    const c = e.target.closest('[data-c]');
    if (c) { setHex(c.dataset.c); apply(); remember(c.dataset.c); drawRecent(); return; }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'close') close();
    if (a.dataset.act === 'reset') { S.color = null; S.sel.clear(); ui.refresh(); paint(); }
  });
}

function setHex(hx) { [H, Sat, V] = hex2hsv(hx.toLowerCase()); }

function drawRecent() {
  $('#recent').innerHTML = recent().map((c) => `<button data-c="${c}" style="background:${c}" title="${c.toUpperCase()}"></button>`).join('');
}

function paint(fromHex) {
  if (S.color) markStep('color');
  const hx = S.color || hsv2hex(H, Sat, V), a = H * Math.PI / 180;
  const knob = $('#knob');
  knob.style.left = (R + Math.cos(a) * Sat * R) + 'px'; knob.style.top = (R + Math.sin(a) * Sat * R) + 'px';
  knob.style.background = hx;
  $('#shade').style.opacity = 1 - V;
  $('#wheel').setAttribute('aria-valuetext', S.color ? hx.toUpperCase() : 'цвет не выбран');
  $('#cur').style.background = S.color ? hx : 'repeating-conic-gradient(var(--glass-lo) 0 25%, transparent 0 50%) 0 0 / 14px 14px';
  if (!fromHex) $('#hexIn').value = S.color ? hx.toUpperCase() : '';
  $('#valIn').value = Math.round(V * 100);
  $('#valIn').style.background = `linear-gradient(90deg, #000, ${hsv2hex(H, Sat, 1)})`;
  $('#pop').querySelectorAll('.presets [data-c]').forEach((b) => b.classList.toggle('on', S.color === b.dataset.c));
  const n = S.color ? countFor(S.color) : 0;
  $('#found').textContent = !S.color ? 'Выберите цвет' : n ? `${n} ${plural(n, ['найден', 'найдено', 'найдено'])}` : S.colorTol < 100 ? 'Ничего — сдвиньте «Точность» влево' : 'Такого цвета в библиотеке нет';
}

// fromWheel: the colour changes; live grid update is throttled so dragging stays smooth
function apply(onlyTol, fromHex) {
  if (!onlyTol) S.color = hsv2hex(H, Sat, V);
  paint(fromHex);
  clearTimeout(timer);
  timer = setTimeout(() => { S.sel.clear(); ui.refresh(); }, 60);
}

export function openColor() {
  const el = $('#pop');
  if (!el.firstChild) build();
  if (S.color) setHex(S.color);
  drawRecent(); paint();
  el.hidden = false;
  // opened from the keyboard: focus moves to the colours (and comes back to the button on close)
  const btn = $('#filtBtn');
  if (document.activeElement === btn && btn.matches(':focus-visible')) {
    const f = el.querySelector(`.presets [data-c="${S.color}"]`) || el.querySelector('.presets button');
    if (f) f.focus();
  }
}
export function close() {
  const el = $('#pop');
  if (el.contains(document.activeElement)) $('#filtBtn').focus();
  el.hidden = true;
}
export const isColorOpen = () => !$('#pop').hidden;
export function toggleColor() { if (isColorOpen()) close(); else openColor(); }
