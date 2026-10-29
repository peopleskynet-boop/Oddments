// Small shared dialogs: toasts (a stack at the bottom, with «Отменить»), the busy pill for long work, ask() — one line
// of text, choose() — a few buttons, arm() — a two-step confirmation for what cannot be undone; trapTab keeps Tab inside
// an open layer.
import { $ } from '../util.js';
import { sfx } from './sound.js';
import { ic } from './icons.js';
import { motionOn } from './motion.js';
import { SPRINGS } from './spring.js';
import { pixGrid, elapsed } from './pixload.js';

// Toast stack, after Arc's toast stack (uiarc.dev, MIT, © 2026 Elia Kuratli): new toasts rise from below,
// older ones tuck behind with a 14px peek and a 5 % smaller scale (three show at most), the stack fans out on
// hover or focus and every timer waits meanwhile; a swipe to the right throws a toast away, Escape closes the
// focused one. The same text twice in a row does not stack: the front toast just restarts its timer.
// undo: { label, fn } adds a button (e.g. «Отменить») and keeps the toast up longer
const VISIBLE = 3, LIMIT = 6, GAP = 8, PEEK = 14;
const stack = []; // newest first: { el, msg, left, t0, timer }
let fanned = false;

function layoutToasts() {
  let y = 0;
  // folded, the toasts behind take the front one's width and hide their text: a neat pile, not a fan of edges
  if (stack[0]) { stack[0].el.style.width = ''; stack[0].el.style.height = ''; }
  const fw = stack[0] ? stack[0].el.offsetWidth : 0, fh = stack[0] ? stack[0].el.offsetHeight : 0;
  stack.forEach((s, i) => {
    const tuck = !fanned && i > 0;
    s.el.classList.toggle('behind', tuck);
    s.el.style.width = tuck ? fw + 'px' : '';
    s.el.style.height = tuck ? fh + 'px' : '';
    const h = s.el.offsetHeight;
    const hidden = i >= VISIBLE;
    const ty = fanned ? -y : -PEEK * i, sc = fanned ? 1 : 1 - 0.05 * i;
    s.el.style.translate = `-50% ${ty}px`;
    s.el.style.scale = String(sc);
    s.el.style.opacity = hidden ? '0' : '1';
    s.el.style.zIndex = String(LIMIT - i);
    s.el.inert = hidden || (!fanned && i > 0);
    y += h + GAP;
  });
  // fanned, the stack is one hover area, so crossing the gaps between toasts does not fold it
  const box = $('#toast');
  box.classList.toggle('fan', fanned);
  box.style.height = fanned ? Math.max(0, y - GAP) + 'px' : (stack[0] ? stack[0].el.offsetHeight + 'px' : '0px');
}

function startTimer(s) {
  clearTimeout(s.timer);
  if (fanned || document.hidden) return;
  s.t0 = Date.now();
  s.timer = setTimeout(() => dismissToast(s), s.left);
}
function pauseAll() { stack.forEach((s) => { if (s.timer) { clearTimeout(s.timer); s.timer = 0; s.left = Math.max(600, s.left - (Date.now() - s.t0)); } }); }
function resumeAll() { stack.forEach(startTimer); }

function dismissToast(s, throwX = 0) {
  const i = stack.indexOf(s);
  if (i < 0) return;
  stack.splice(i, 1);
  clearTimeout(s.timer);
  const el = s.el;
  el.classList.add('out');
  el.inert = true;
  if (throwX) el.style.translate = `calc(-50% + ${throwX}px) ${el.style.translate.split(' ')[1] || '0px'}`;
  else el.style.scale = String(parseFloat(el.style.scale || '1') * 0.92);
  el.style.opacity = '0';
  setTimeout(() => el.remove(), 320);
  if (!stack.length && fanned) fanned = false;
  layoutToasts();
}

function swipe(s) {
  const el = s.el;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const x0 = e.clientX, base = el.style.translate;
    let dx = 0;
    el.setPointerCapture(e.pointerId);
    el.classList.add('drag');
    const mv = (ev) => {
      dx = ev.clientX - x0;
      const d = dx > 0 ? dx : dx / 4; // left rubber-bands
      el.style.translate = `calc(-50% + ${d}px) ${base.split(' ')[1] || '0px'}`;
    };
    const upH = () => {
      el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', upH); el.removeEventListener('pointercancel', upH);
      el.classList.remove('drag');
      if (dx > 70) { sfx('whisk'); dismissToast(s, dx + 260); } else layoutToasts();
    };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', upH); el.addEventListener('pointercancel', upH);
  });
}

let wired = false;
function wire(box) {
  if (wired) return;
  wired = true;
  box.addEventListener('pointerenter', () => { if (stack.length > 1) { fanned = true; layoutToasts(); } pauseAll(); });
  box.addEventListener('pointerleave', () => { fanned = false; layoutToasts(); resumeAll(); });
  box.addEventListener('focusin', () => { fanned = stack.length > 1; layoutToasts(); pauseAll(); });
  box.addEventListener('focusout', (e) => { if (!box.contains(e.relatedTarget)) { fanned = false; layoutToasts(); resumeAll(); } });
  box.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const s = stack.find((x) => x.el.contains(document.activeElement));
    if (s) { e.preventDefault(); e.stopPropagation(); dismissToast(s); }
  });
  document.addEventListener('visibilitychange', () => (document.hidden ? pauseAll() : resumeAll()));
}

export function toast(msg, ms = 2000, undo = null) {
  const box = $('#toast');
  wire(box);
  if (/^Не (удалось|получилось|нашлось)/.test(msg)) sfx('error');
  if (undo) ms = Math.max(ms, 5000);
  const front = stack[0];
  if (front && front.msg === msg && !undo && !front.undo) {
    front.left = ms; startTimer(front);
    front.el.animate([{ scale: '1.04' }, { scale: '1' }], { duration: 260, easing: 'ease-out', composite: 'add' });
    return;
  }
  const el = document.createElement('div');
  el.className = 'tst' + (undo ? ' act' : '');
  const tx = document.createElement('span');
  tx.textContent = msg;
  el.appendChild(tx);
  const s = { el, msg, left: ms, t0: 0, timer: 0, undo: !!undo };
  if (undo) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = undo.label || 'Отменить';
    b.onclick = () => { dismissToast(s); sfx('undo'); undo.fn(); };
    el.appendChild(b);
  }
  box.appendChild(el);
  // rise from its own height below the edge
  el.style.transition = 'none';
  el.style.translate = `-50% ${el.offsetHeight + 16}px`;
  el.style.opacity = '0';
  void el.offsetWidth;
  el.style.transition = '';
  stack.unshift(s);
  while (stack.length > LIMIT) dismissToast(stack[stack.length - 1]);
  swipe(s);
  layoutToasts();
  if (fanned) pauseAll(); else startTimer(s);
}

// Text prompt (window.prompt is unavailable in the webview).
// Import progress: a glass pill under the toolbar with a bar. frac < 0 means "working, unknown how long".
// The pill leads with the pixel loader (pixload.js) and, after two seconds, counts the time up.
let busyHide = null, busyT0 = 0, busyTick = 0;
export function busy(text, frac = -1) {
  const el = $('#busy');
  clearTimeout(busyHide);
  if (el.hidden || !busyTick) {
    $('#busyI').innerHTML = pixGrid('drive');
    busyT0 = performance.now();
    clearInterval(busyTick);
    const s = $('#busyS');
    s.textContent = '';
    busyTick = setInterval(() => { const ms = performance.now() - busyT0; s.textContent = ms > 2000 ? elapsed(ms) : ''; }, 100);
  }
  el.hidden = false;
  el.classList.toggle('indet', frac < 0);
  $('#busyT').textContent = text;
  $('#busyP').style.transform = frac < 0 ? '' : `scaleX(${Math.max(0.03, Math.min(1, frac)).toFixed(3)})`;
}
export function busyDone(text) {
  const el = $('#busy');
  if (text) { el.classList.remove('indet'); $('#busyT').textContent = text; $('#busyP').style.transform = 'scaleX(1)'; }
  clearInterval(busyTick); busyTick = 0;
  if (text) $('#busyI').innerHTML = ic('check');
  busyHide = setTimeout(() => { el.hidden = true; }, text ? 1400 : 0);
}

// Keep Tab inside a modal layer: from the last control back to the first and the other way round.
export function trapTab(e, root) {
  if (e.key !== 'Tab') return;
  const f = Array.from(root.querySelectorAll('button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((x) => x.getClientRects().length);
  if (!f.length) { e.preventDefault(); return; }
  const i = f.indexOf(document.activeElement);
  if (e.shiftKey ? i <= 0 : i < 0 || i === f.length - 1) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); }
}

export function ask(title, initial = '') {
  return new Promise((resolve) => {
    const modal = $('#modal'), inp = $('#dlgIn'), form = $('#dlg');
    const back = document.activeElement;
    $('#dlgT').textContent = title;
    inp.value = initial;
    modal.classList.add('on');
    setTimeout(() => { inp.focus(); inp.select(); }, 0);
    const done = (v) => {
      modal.classList.remove('on');
      form.onsubmit = null;
      $('#dlgNo').onclick = null;
      if (back && back.isConnected && back !== document.body) back.focus({ preventScroll: true });
      resolve(v);
    };
    form.onsubmit = (e) => { e.preventDefault(); done(inp.value.trim() || null); };
    $('#dlgNo').onclick = () => done(null);
  });
}

export const isAskOpen = () => $('#modal').classList.contains('on');

// a question with a few answers (not a text field): resolves with the chosen option's value, null on Esc / «Отмена».
// options: [{ label, value, pri }] — the pri one is the default (Enter) and gets focus. Its own modal, so it can open
// while a layer is up; Esc and Tab stay inside it.
export function choose(title, text, options) {
  return new Promise((resolve) => {
    const back = document.activeElement;
    const m = document.createElement('div');
    m.className = 'modal on';
    m.innerHTML = `<div class="dlg" role="alertdialog" aria-modal="true" aria-labelledby="chT" aria-describedby="chP"><h2 id="chT"></h2><p id="chP" class="dlg-p"></p>` +
      `<div class="row"><button type="button" class="ibtn" data-v="-1">Отмена</button>${options.map((o, i) => `<button type="button" class="ibtn${o.pri ? ' pri' : ''}" data-v="${i}"></button>`).join('')}</div></div>`;
    m.querySelector('#chT').textContent = title;
    m.querySelector('#chP').textContent = text;
    options.forEach((o, i) => { m.querySelector(`[data-v="${i}"]`).textContent = o.label; });
    document.body.appendChild(m);
    const done = (i) => { m.remove(); if (back && back.isConnected && back !== document.body) back.focus({ preventScroll: true }); resolve(i >= 0 ? options[i].value : null); };
    m.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) done(+b.dataset.v); else if (e.target === m) done(-1); });
    m.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); done(-1); } else if (e.key === 'Tab') trapTab(e, m);
      e.stopPropagation();
    });
    (m.querySelector('.pri') || m.querySelector('[data-v]')).focus();
  });
}

// Two-step destructive button that morphs in place, after Arc's confirm morph (uiarc.dev, MIT, © 2026 Elia
// Kuratli): the first click turns it into a red «Точно? Ещё раз» with a bar draining for 3 s (then it settles
// back), the second runs the action with a spinner and shows the result. The label crossfades with a short
// rise and blur; the width follows the new label on the morph spring.
const ARM_MS = 3000;
function morphTo(btn, html, cls) {
  const w0 = btn.offsetWidth;
  btn.innerHTML = `<span class="am">${html}</span>`;
  ['armed', 'working', 'done'].forEach((c) => btn.classList.toggle(c, c === cls));
  if (!motionOn()) return;
  const w1 = btn.offsetWidth;
  if (Math.abs(w1 - w0) > 1 && getComputedStyle(btn).flexGrow === '0') btn.animate([{ width: w0 + 'px' }, { width: w1 + 'px' }], { duration: SPRINGS.morph.ms, easing: SPRINGS.morph.easing });
  btn.firstChild.animate([{ opacity: 0, translate: '0 4px', filter: 'blur(4px)' }, { opacity: 1, translate: '0 0', filter: 'blur(0)' }], { duration: 220, easing: 'cubic-bezier(.22, 1, .36, 1)' });
}

export function arm(btn, fn, done = 'Готово') {
  if (btn.dataset.arm === 'busy') return;
  if (btn.dataset.arm === '1') {
    clearTimeout(btn.__armT);
    btn.dataset.arm = 'busy';
    morphTo(btn, '<i class="spin" aria-hidden="true"></i>Удаляю…', 'working');
    Promise.resolve(fn()).finally(() => {
      // the action usually re-renders the panel; a button still on screen shows the result, then settles
      if (!btn.isConnected) return;
      morphTo(btn, `${ic('check')}${done}`, 'done');
      setTimeout(() => { if (btn.isConnected) { delete btn.dataset.arm; morphTo(btn, btn.__armOld, ''); } }, 1400);
    });
    return;
  }
  btn.__armOld = btn.innerHTML;
  btn.dataset.arm = '1';
  btn.style.setProperty('--arm-ms', ARM_MS + 'ms');
  morphTo(btn, 'Точно? Ещё раз', 'armed');
  sfx('latch');
  btn.__armT = setTimeout(() => { if (btn.isConnected && btn.dataset.arm === '1') { delete btn.dataset.arm; morphTo(btn, btn.__armOld, ''); } }, ARM_MS);
}
