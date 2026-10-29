// «Убрать фон»: the cut-out (lib/cutout.js) on a backdrop of one's choice — a checkerboard, white, black or any colour —
// so the edge can be judged where it will be used. A brush mends what the model got wrong: «Вернуть» brings the
// original pixels back, «Стереть» takes them away (Ctrl+Z undoes a stroke); Space held shows the original.
// «Копировать» puts the PNG on the clipboard (Figma keeps its transparency), «Сохранить» lays a copy next to the
// original («… — без фона.png», same collections and tags); «Обрезать поля» trims the empty margins of both.
// Several pictures at once: each is cut and saved in turn, the window shows the progress.
// A loupe follows the cursor (loupe.js: the edge up close on the same backdrop; the wheel — magnification, L — off/on).
import './cutout.css';
import { pushLayer, popLayer } from './layers.js';
import { ui } from '../state.js';
import { ic } from './icons.js';
import { toast } from './dialogs.js';
import { sfx } from './sound.js';
import { pixLoader, elapsed } from './pixload.js';
import { pictureUrl } from '../lib/masker.js';
import { canCutout, cutoutItem, pngOf, saveCutout, stopCutout, cutoutModelState, cutoutFetching, hasGpu, CUTOUT_MODEL } from '../lib/cutout.js';
import { readPref, writePref } from '../lib/prefs.js';
import { attachLoupe } from './loupe.js';

const PREF = 'perch.cutout';
const prefs = readPref(PREF, { bg: 'checker', color: '#d7ff63', trim: false, brush: 36 });
const BGS = [['checker', 'Шахматка'], ['white', 'Белый'], ['black', 'Чёрный'], ['color', 'Свой цвет']];
let el = null, cv = null, cx = null, cur = null, run = 0, loader = null, working = false;
let W = 0, H = 0, cut = null, orig = null, full = null, fullX = null, origBm = null, undo = [];
let tool = '', showOrig = false, fit = { s: 1, x: 0, y: 0 }, stroke = null, drawQueued = false, lp = null, askDone = null;
export const isCutoutOpen = () => !!(el && !el.hidden);
const $ = (s) => el.querySelector(s);

function build() {
  el = document.createElement('section');
  el.className = 'cut';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Убрать фон');
  el.innerHTML = `<div class="cut-bar glass"><span class="orb-t">Убрать фон</span><span class="cut-name cap-sm"></span>` +
    `<button type="button" class="ibtn flat" data-cu="trim" aria-pressed="false" title="Убрать пустые прозрачные поля вокруг объекта">Обрезать поля</button>` +
    `<button type="button" class="ibtn" data-cu="copy" disabled title="PNG с прозрачностью — в буфер (Ctrl+C)">${ic('copy')}Копировать</button>` +
    `<button type="button" class="ibtn pri" data-cu="save" disabled title="Копия рядом с оригиналом (Ctrl+S)">Сохранить в библиотеку</button>` +
    `<button type="button" class="ib" data-cu="close" aria-label="Закрыть" title="Закрыть (Esc)">${ic('x')}</button></div>` +
    `<div class="cut-stage"><canvas class="cut-cv" aria-label="Результат: объект без фона"></canvas><i class="cut-ring" hidden></i>` +
    `<div class="cut-wait"><div class="cut-ld"></div><div class="cut-prog"><i></i></div><p class="cut-note"></p></div></div>` +
    `<div class="cut-dock glass" role="toolbar" aria-label="Фон и кисть">` +
    `<span class="cut-seg" role="radiogroup" aria-label="Фон под результатом">${BGS.map(([id, t]) => `<button type="button" role="radio" data-bg="${id}" title="${t}" aria-label="${t}"><i class="sw ${id}"></i></button>`).join('')}</span>` +
    `<input type="color" class="cut-color" aria-label="Свой цвет фона" title="Свой цвет фона">` +
    `<span class="cut-sep"></span>` +
    `<span class="cut-seg" role="radiogroup" aria-label="Кисть"><button type="button" role="radio" data-tool="keep" title="Вернуть: кисть возвращает пиксели оригинала (X — переключить)">${ic('brush')}Вернуть</button><button type="button" role="radio" data-tool="erase" title="Стереть: кисть убирает лишнее (X — переключить)">${ic('eraser')}Стереть</button></span>` +
    `<label class="cut-size" title="Размер кисти ([ и ])"><input type="range" min="6" max="200" step="1" aria-label="Размер кисти"><b></b></label>` +
    `<button type="button" class="ib" data-cu="undo" aria-label="Отменить мазок" title="Отменить мазок (Ctrl+Z)" disabled>${ic('undo')}</button>` +
    `<span class="cut-sep"></span>` +
    `<button type="button" class="ibtn flat" data-cu="orig" aria-pressed="false" title="Оригинал (держите Пробел)">Оригинал</button></div>` +
    `<p class="cut-info cap-sm"></p>`;
  document.body.appendChild(el);
  cv = $('.cut-cv');
  cx = cv.getContext('2d');
  el.addEventListener('click', onClick);
  $('.cut-color').addEventListener('input', (e) => { prefs.color = e.target.value; prefs.bg = 'color'; writePref(PREF, prefs); drawDock(); draw(); });
  $('.cut-size input').addEventListener('input', (e) => { prefs.brush = +e.target.value; writePref(PREF, prefs); drawDock(); });
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onUp);
  cv.addEventListener('lostpointercapture', onUp);
  cv.addEventListener('pointerleave', () => { $('.cut-ring').hidden = true; });
  lp = attachLoupe(cv, {
    at: (x, y) => {
      if (!W || !full) return null;
      const r = cv.getBoundingClientRect(), ix = (x - r.left - fit.x) / fit.s, iy = (y - r.top - fit.y) / fit.s;
      return ix < 0 || iy < 0 || ix > W || iy > H ? null : { x: ix, y: iy };
    },
    // the same backdrop as the stage, then the cut-out (or the original while Space is held)
    paint: (g, x, y, s, w, h) => {
      if (prefs.bg === 'checker') {
        const t = new OffscreenCanvas(16, 16), tx = t.getContext('2d');
        tx.fillStyle = '#e8e8ea'; tx.fillRect(0, 0, 16, 16); tx.fillStyle = '#c4c4c8'; tx.fillRect(0, 0, 8, 8); tx.fillRect(8, 8, 8, 8);
        g.fillStyle = g.createPattern(t, 'repeat');
      } else g.fillStyle = prefs.bg === 'white' ? '#ffffff' : prefs.bg === 'black' ? '#000000' : prefs.color;
      g.fillRect(0, 0, w, h);
      g.setTransform(s, 0, 0, s, w / 2 - x * s, h / 2 - y * s);
      g.drawImage(showOrig && origBm ? origBm : full, 0, 0, W, H);
    },
  });
}

function drawDock() {
  el.querySelectorAll('[data-bg]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.bg === prefs.bg)));
  el.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.tool === tool)));
  $('.cut-color').value = prefs.color;
  $('.cut-size input').value = prefs.brush;
  $('.cut-size b').textContent = prefs.brush + ' px';
  $('.cut-size').classList.toggle('off', !tool);
  $('[data-cu="trim"]').setAttribute('aria-pressed', String(!!prefs.trim));
  $('[data-cu="orig"]').setAttribute('aria-pressed', String(showOrig));
  $('[data-cu="undo"]').disabled = !undo.length;
  el.style.setProperty('--cut-color', prefs.color);
  cv.classList.toggle('brush', !!tool);
}

function onClick(e) {
  const b = e.target.closest('[data-cu], [data-bg], [data-tool]');
  if (!b || b.disabled) return;
  if (b.dataset.bg) { prefs.bg = b.dataset.bg; writePref(PREF, prefs); if (prefs.bg === 'color') $('.cut-color').click(); sfx('tick'); }
  else if (b.dataset.tool) { tool = tool === b.dataset.tool ? '' : b.dataset.tool; sfx('tick'); }
  else if (b.dataset.cu === 'close') { closeCutout(); return; }
  else if (b.dataset.cu === 'save') { save(); return; }
  else if (b.dataset.cu === 'copy') { copy(); return; }
  else if (b.dataset.cu === 'undo') undoStroke();
  else if (b.dataset.cu === 'trim') { prefs.trim = !prefs.trim; writePref(PREF, prefs); }
  else if (b.dataset.cu === 'orig') showOrig = !showOrig;
  drawDock(); draw();
}

function onKey(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') { e.preventDefault(); if (tool) { tool = ''; drawDock(); } else closeCutout(); }
  else if (mod && e.code === 'KeyZ') { e.preventDefault(); undoStroke(); }
  else if (mod && e.code === 'KeyC') { e.preventDefault(); copy(); }
  else if (mod && (e.code === 'KeyS' || e.key === 'Enter')) { e.preventDefault(); save(); }
  else if (e.code === 'Space' && !e.repeat) { e.preventDefault(); showOrig = true; drawDock(); draw(); }
  else if (e.code === 'KeyX') { tool = tool === 'keep' ? 'erase' : 'keep'; drawDock(); }
  else if (e.code === 'KeyL' && !mod) { e.preventDefault(); lp.toggle(); }
  else if (e.code === 'BracketLeft' || e.code === 'BracketRight') { prefs.brush = Math.max(6, Math.min(200, Math.round(prefs.brush * (e.code === 'BracketLeft' ? 0.8 : 1.25)))); writePref(PREF, prefs); drawDock(); }
  e.stopPropagation();
}
function onKeyUp(e) { if (e.code === 'Space' && isCutoutOpen()) { showOrig = false; drawDock(); draw(); } }

/* ---------- drawing ---------- */

function size() {
  const r = $('.cut-stage').getBoundingClientRect(), dpr = devicePixelRatio || 1;
  cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
  cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
  if (W) { const s = Math.min(r.width / W, r.height / H, 1e9); fit = { s, x: (r.width - W * s) / 2, y: (r.height - H * s) / 2 }; }
  draw();
}

let checker = null;
function backdrop(x, y, w, h) {
  if (prefs.bg === 'checker') {
    if (!checker) {
      const t = new OffscreenCanvas(16, 16), tx = t.getContext('2d');
      tx.fillStyle = '#e8e8ea'; tx.fillRect(0, 0, 16, 16); tx.fillStyle = '#c4c4c8'; tx.fillRect(0, 0, 8, 8); tx.fillRect(8, 8, 8, 8);
      checker = cx.createPattern(t, 'repeat');
    }
    cx.fillStyle = checker;
  } else cx.fillStyle = prefs.bg === 'white' ? '#ffffff' : prefs.bg === 'black' ? '#000000' : prefs.color;
  cx.fillRect(x, y, w, h);
}

function draw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    if (!cv) return;
    const dpr = devicePixelRatio || 1;
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.clearRect(0, 0, cv.width, cv.height);
    if (!W || !full) return;
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const x = fit.x, y = fit.y, w = W * fit.s, h = H * fit.s;
    backdrop(x, y, w, h);
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(showOrig && origBm ? origBm : full, x, y, w, h);
    if (lp) lp.refresh();
  });
}

/* ---------- brush ---------- */

const toImage = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left - fit.x) / fit.s, y: (e.clientY - r.top - fit.y) / fit.s }; };

function ring(e) {
  const g = $('.cut-ring');
  if (!tool || !cut) { g.hidden = true; return; }
  const r = $('.cut-stage').getBoundingClientRect();
  g.hidden = false;
  g.style.width = g.style.height = prefs.brush + 'px';
  g.style.transform = `translate(${e.clientX - r.left - prefs.brush / 2}px, ${e.clientY - r.top - prefs.brush / 2}px)`;
  g.classList.toggle('erase', tool === 'erase');
}

// one dab: a soft disc (full strength in the inner half, fading to the edge)
function dab(px, py) {
  const rr = Math.max(1, prefs.brush / 2 / fit.s);
  const x0 = Math.max(0, Math.floor(px - rr)), x1 = Math.min(W - 1, Math.ceil(px + rr)), y0 = Math.max(0, Math.floor(py - rr)), y1 = Math.min(H - 1, Math.ceil(py + rr));
  if (x1 < x0 || y1 < y0) return;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - px, y + 0.5 - py) / rr;
      if (d >= 1) continue;
      const w = Math.min(1, (1 - d) * 2), o = (y * W + x) * 4;
      if (tool === 'erase') cut[o + 3] = cut[o + 3] * (1 - w);
      else {
        for (let c = 0; c < 3; c++) cut[o + c] += (orig[o + c] - cut[o + c]) * w;
        cut[o + 3] = Math.max(cut[o + 3], Math.min(w * 255, orig[o + 3]));
      }
    }
  }
  const b = stroke.box;
  b.x0 = Math.min(b.x0, x0); b.y0 = Math.min(b.y0, y0); b.x1 = Math.max(b.x1, x1); b.y1 = Math.max(b.y1, y1);
  fullX.putImageData(new ImageData(cut, W, H), 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}

function onDown(e) {
  if (!tool || !cut || e.button) return;
  cv.setPointerCapture(e.pointerId);
  stroke = { before: cut.slice(), last: toImage(e), box: { x0: W, y0: H, x1: -1, y1: -1 } };
  dab(stroke.last.x, stroke.last.y);
  draw();
}
function onMove(e) {
  ring(e);
  if (!stroke) return;
  const p = toImage(e), l = stroke.last, step = Math.max(1, prefs.brush / 2 / fit.s / 3);
  const n = Math.ceil(Math.hypot(p.x - l.x, p.y - l.y) / step);
  for (let i = 1; i <= n; i++) dab(l.x + ((p.x - l.x) * i) / n, l.y + ((p.y - l.y) * i) / n);
  stroke.last = p;
  draw();
}
function onUp() {
  if (!stroke) return;
  const { before, box } = stroke;
  stroke = null;
  if (box.x1 < box.x0) return;
  // only the touched rectangle is kept for «Отменить»
  const w = box.x1 - box.x0 + 1, h = box.y1 - box.y0 + 1, part = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) part.set(before.subarray(((box.y0 + y) * W + box.x0) * 4, ((box.y0 + y) * W + box.x0 + w) * 4), y * w * 4);
  undo.push({ x: box.x0, y: box.y0, w, h, part });
  if (undo.length > 30) undo.shift();
  drawDock();
}
function undoStroke() {
  const u = undo.pop();
  if (!u || !cut) return;
  for (let y = 0; y < u.h; y++) cut.set(u.part.subarray(y * u.w * 4, (y + 1) * u.w * 4), ((u.y + y) * W + u.x) * 4);
  fullX.putImageData(new ImageData(cut, W, H), 0, 0, u.x, u.y, u.w, u.h);
  drawDock(); draw();
}

/* ---------- the run ---------- */

function wait(text, frac = -1) {
  const w = $('.cut-wait');
  w.hidden = false;
  if (!loader) { loader = pixLoader(text); $('.cut-ld').replaceChildren(loader.el); } else loader.set(text);
  const p = $('.cut-prog');
  p.hidden = frac < 0;
  p.firstElementChild.style.transform = `scaleX(${Math.max(0.02, Math.min(1, frac)).toFixed(3)})`;
}
function endWait() {
  if (loader) { loader.stop(); loader = null; }
  $('.cut-ld').replaceChildren();
  $('.cut-wait').hidden = true;
}
const mb = (n) => Math.round(n / 1e6);
const phaseText = (p, i, n) => {
  const of = n > 1 ? ` · ${i + 1} из ${n}` : '';
  if (p.phase === 'download') return [`Скачиваю модель · ${mb(p.got)} из ${mb(p.total)} МБ (один раз)`, p.got / p.total];
  if (p.phase === 'loading') return ['Запускаю модель…', -1];
  if (p.phase === 'model') return ['Ищу объект' + of, n > 1 ? i / n : -1];
  return ['Уточняю край по фото' + of, n > 1 ? (i + 0.5) / n : -1];
};

async function cutOne(it, id, i = 0, n = 1) {
  return cutoutItem(it, (p) => { if (id === run) wait(...phaseText(p, i, n)); });
}

async function show(it, r) {
  W = r.w; H = r.h; cut = r.rgba; undo = [];
  full = new OffscreenCanvas(W, H); fullX = full.getContext('2d');
  fullX.putImageData(new ImageData(cut, W, H), 0, 0);
  // the original's pixels, for «Вернуть» and «Оригинал» (already here when it was shown while the model worked)
  if (!origBm) {
    const url = await pictureUrl(it);
    try { origBm = await createImageBitmap(await (await fetch(url)).blob()); } finally { URL.revokeObjectURL(url); }
  }
  const oc = new OffscreenCanvas(W, H), ox = oc.getContext('2d', { willReadFrequently: true });
  ox.drawImage(origBm, 0, 0, W, H);
  orig = ox.getImageData(0, 0, W, H).data;
  endWait();
  cv.classList.remove('pending');
  size();
  $('[data-cu="save"]').disabled = false;
  $('[data-cu="copy"]').disabled = false;
  $('.cut-info').textContent = `${W} × ${H} · ${elapsed(r.ms)} · Пробел — оригинал, кисть — поправить край, лупа: колесо — крупнее, L — выкл.`;
  drawDock();
}

// the original at once, dimmed under the progress: the stage was black for the whole first run (audit 29.10)
async function preview(it, id) {
  try {
    const url = await pictureUrl(it);
    let bm;
    try { bm = await createImageBitmap(await (await fetch(url)).blob()); } finally { URL.revokeObjectURL(url); }
    if (id !== run || !isCutoutOpen()) { bm.close(); return; }
    origBm = bm; W = bm.width; H = bm.height;
    full = new OffscreenCanvas(W, H); fullX = full.getContext('2d'); fullX.drawImage(bm, 0, 0);
    cv.classList.add('pending');
    size();
  } catch (e) { console.warn('cutout preview', e); } // the stage waits for the result
}

// the first use: the model is 223 MB, so the window asks before downloading it (it used to start on opening). Without
// WebGPU there is nothing to ask — the run says why it cannot work.
async function allowModel(id) {
  if (askDone) askDone(null); // a newer run (×2 / ×4) asks instead: the old card goes, the window stays
  if ((await cutoutModelState()) !== 'missing' || !(await hasGpu())) return true;
  if (id !== run || !isCutoutOpen()) return false;
  endWait();
  const w = $('.cut-wait'), note = $('.cut-note'), was = note.textContent;
  w.hidden = false;
  $('.cut-prog').hidden = true;
  note.innerHTML = `<b>Нужна модель «Убрать фон» · ${mb(CUTOUT_MODEL.file.size)} МБ</b>Скачивается один раз и работает на этом компьютере — картинки никуда не уходят.`;
  const ask = document.createElement('div');
  ask.className = 'cut-ask';
  ask.innerHTML = '<button type="button" class="ibtn pri" data-ask="1">Скачать и убрать фон</button><button type="button" class="ibtn" data-ask="0">Не сейчас</button>';
  w.appendChild(ask);
  ask.querySelector('.pri').focus();
  const yes = await new Promise((res) => {
    askDone = res;
    ask.addEventListener('click', (e) => { const b = e.target.closest('[data-ask]'); if (b) res(b.dataset.ask === '1'); });
  });
  askDone = null;
  ask.remove();
  note.textContent = was;
  if (yes === null) return false;
  if (!yes) { closeCutout(); return false; }
  return id === run && isCutoutOpen();
}

async function go(items) {
  const id = ++run;
  working = true;
  W = 0; full = null; draw();
  $('.cut-info').textContent = '';
  try {
    if (items.length === 1) await preview(items[0], id);
    if (!(await allowModel(id))) return;
    if (items.length === 1) {
      wait('Готовлю…');
      const r = await cutOne(items[0], id);
      if (id !== run || !isCutoutOpen()) return;
      sfx('done');
      await show(items[0], r);
      return;
    }
    // several pictures: each is cut and saved as it comes; the last one stays on screen
    let ok = 0;
    const failed = [];
    for (let i = 0; i < items.length; i++) {
      if (id !== run || !isCutoutOpen()) return;
      try {
        const r = await cutOne(items[i], id, i, items.length);
        if (id !== run) return;
        await saveCutout(items[i], await pngOf(r.rgba, r.w, r.h, prefs.trim));
        ok++;
        W = r.w; H = r.h; full = new OffscreenCanvas(W, H); fullX = full.getContext('2d'); fullX.putImageData(new ImageData(r.rgba, W, H), 0, 0); cut = null; size();
      } catch (e) { failed.push(items[i].name); console.warn(e); }
    }
    ui.refresh();
    sfx('add');
    toast(`Без фона: ${ok} ${ok === 1 ? 'копия' : 'копий'} рядом с оригиналами` + (failed.length ? ` · не вышло: ${failed.slice(0, 3).join(', ')}` : ''), 6000);
    closeCutout();
  } catch (e) {
    if (id !== run || !isCutoutOpen()) return;
    if (loader) { loader.stop(); loader = null; }
    $('.cut-ld').replaceChildren();
    $('.cut-prog').hidden = true;
    $('.cut-note').textContent = `Не удалось убрать фон: ${(e && e.message) || e}. Модель скачивается один раз — проверьте сеть и попробуйте ещё раз.`;
  } finally { if (id === run) working = false; }
}

async function copy() {
  if (!cut) return;
  try {
    const { toClipboard } = await import('./media.js');
    await toClipboard(await pngOf(cut, W, H, prefs.trim));
    sfx('done');
    toast('PNG без фона — в буфере: вставьте в Figma (Ctrl+V)', 3500);
  } catch (e) { toast('Не удалось скопировать: ' + ((e && e.message) || e) + '. Сохраните в библиотеку и перетащите файл.', 6000); }
}

async function save() {
  const btn = $('[data-cu="save"]');
  if (!cut || !cur || btn.disabled) return;
  btn.disabled = true;
  try {
    const copy = await saveCutout(cur, await pngOf(cut, W, H, prefs.trim));
    if (!copy) throw new Error('копия не добавилась');
    sfx('add');
    toast(`Без фона: «${copy.name}»`, 4000);
    ui.refresh();
    closeCutout();
  } catch (e) {
    btn.disabled = false;
    toast('Не удалось сохранить: ' + ((e && e.message) || e) + '. Оригинал не тронут.', 6000);
  }
}

export async function openCutout(items) {
  items = (Array.isArray(items) ? items : [items]).filter(canCutout);
  if (!items.length) { toast('Фон убирается с картинок и PSD (не с GIF)'); return; }
  if (!el) build();
  cur = items[0];
  tool = ''; showOrig = false; undo = []; cut = null; orig = null; origBm = null;
  $('.cut-name').textContent = items.length > 1 ? `${items.length} картинок` : cur.name;
  $('[data-cu="save"]').hidden = $('[data-cu="copy"]').hidden = items.length > 1;
  $('.cut-dock').hidden = items.length > 1;
  $('[data-cu="save"]').disabled = $('[data-cu="copy"]').disabled = true;
  $('.cut-note').textContent = items.length > 1 ? 'Каждая копия «… — без фона.png» ляжет рядом со своим оригиналом.' : 'Оригинал не меняется — копия без фона ляжет рядом.';
  el.hidden = false;
  drawDock();
  pushLayer({ el, title: 'Убрать фон', close: closeCutout, onKey });
  addEventListener('resize', size);
  addEventListener('keyup', onKeyUp);
  sfx('open');
  size();
  go(items);
}

export function closeCutout() {
  if (!isCutoutOpen()) return;
  run++;
  if (askDone) askDone(false);
  if (working) { stopCutout(); working = false; }
  // the model's download is not the window's: it goes on, and the next opening starts with it
  const f = cutoutFetching();
  if (f) toast(`Модель «Убрать фон» докачивается: ${mb(f.got)} из ${mb(f.total)} МБ. Когда закончит, окно откроется сразу с ней.`, 7000);
  endWait();
  el.hidden = true;
  popLayer(el);
  removeEventListener('resize', size);
  removeEventListener('keyup', onKeyUp);
  if (lp) lp.hide();
  if (origBm) origBm.close();
  cut = orig = full = fullX = origBm = null; undo = []; W = H = 0; stroke = null;
  cv.classList.remove('pending');
}
