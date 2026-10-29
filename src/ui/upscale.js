// «Увеличить»: the picture enlarged by Real-ESRGAN (lib/upscale.js) against a plain resize, on one frame with a divider —
// drag it (or ←/→) to compare; «1:1» shows real pixels of the result (scroll to look around). A loupe follows the cursor
// (loupe.js: the wheel — magnification, L — off/on) and keeps the divider: plain resize left of it, the AI right of it.
// «Сохранить в библиотеку» puts the enlarged copy next to the original («… @4x.png», same collections and tags); the
// original is not touched.
import './upscale.css';
import { pushLayer, popLayer } from './layers.js';
import { ui } from '../state.js';
import { ic } from './icons.js';
import { toast } from './dialogs.js';
import { sfx } from './sound.js';
import { pixLoader, elapsed } from './pixload.js';
import { pictureUrl } from '../lib/masker.js';
import { canUpscale, outSize, upscaleItem, saveUpscaled, stopUpscale, upscaleModelState, upscaleFetching, UPSCALE_MODEL } from '../lib/upscale.js';
import { readPref, writePref } from '../lib/prefs.js';
import { attachLoupe } from './loupe.js';

const PREF = 'perch.upscale';
const prefs = readPref(PREF, { scale: 4 });
// the scale chosen last; a picture over 2 MP still opens at ×2 — ×4 of 1920 × 1390 is 42 MP and ~40 s (audit 29.10)
let pick = prefs.scale;
let el = null, cur = null, srcUrl = '', loader = null, run = 0, split = 0.5, drag = false, working = false, lp = null, askDone = null;
let lpAfter = null, lpBefore = null; // bitmaps the loupe draws: the result and the original
const done = new Map(); // scale → { blob, url, w, h, device, ms }
export const isUpscaleOpen = () => !!(el && !el.hidden);

function build() {
  el = document.createElement('section');
  el.className = 'ups';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Увеличить картинку');
  el.innerHTML = `<div class="ups-bar glass"><span class="orb-t">Увеличить</span><span class="ups-name cap-sm"></span>` +
    `<span class="ups-seg" role="group" aria-label="Во сколько раз"><button type="button" data-sc="2">×2</button><button type="button" data-sc="4">×4</button></span>` +
    `<button type="button" class="ibtn flat" data-up="px" aria-pressed="false" title="Настоящие пиксели результата">1:1</button>` +
    `<button type="button" class="ibtn pri" data-up="save" disabled>Сохранить в библиотеку</button>` +
    `<button type="button" class="ib" data-up="close" aria-label="Закрыть" title="Закрыть (Esc)">${ic('x')}</button></div>` +
    `<div class="ups-stage"><div class="ups-cmp" hidden><img class="ups-a" alt="После"><div class="ups-b"><img alt="До"></div>` +
    `<div class="ups-cut" role="slider" tabindex="0" aria-label="Граница до / после" aria-valuemin="0" aria-valuemax="100"><i></i></div>` +
    `<span class="ups-lab l">Обычное увеличение</span><span class="ups-lab r">ИИ · Real-ESRGAN</span></div>` +
    `<img class="ups-orig" alt="" hidden><div class="ups-wait"><div class="ups-ld"></div><div class="ups-prog"><i></i></div><p class="ups-note"></p></div></div>` +
    `<p class="ups-info cap-sm"></p>`;
  document.body.appendChild(el);
  el.addEventListener('click', onClick);
  el.addEventListener('keydown', onKey);
  const cmp = el.querySelector('.ups-cmp');
  cmp.addEventListener('pointerdown', (e) => { if (e.button) return; drag = true; cmp.setPointerCapture(e.pointerId); moveCut(e); });
  cmp.addEventListener('pointermove', (e) => { if (drag) moveCut(e); });
  const end = () => { drag = false; };
  cmp.addEventListener('pointerup', end);
  cmp.addEventListener('pointercancel', end);
  cmp.addEventListener('lostpointercapture', end);
  lp = attachLoupe(cmp, {
    at: (x, y) => {
      const r = done.get(prefs.scale);
      if (!r || !lpAfter || cmp.hidden) return null;
      const b = cmp.getBoundingClientRect();
      if (x < b.left || y < b.top || x > b.right || y > b.bottom) return null;
      return { x: ((x - b.left) / b.width) * r.w, y: ((y - b.top) / b.height) * r.h };
    },
    // result pixels; the original is stretched to the same size (what a plain resize gives) left of the divider
    paint: (g, x, y, s, w, h) => {
      const r = done.get(prefs.scale), cut = split * r.w;
      g.setTransform(s, 0, 0, s, w / 2 - x * s, h / 2 - y * s);
      g.drawImage(lpAfter, 0, 0, r.w, r.h);
      if (lpBefore) {
        g.save(); g.beginPath(); g.rect(0, 0, cut, r.h); g.clip();
        g.drawImage(lpBefore, 0, 0, r.w, r.h);
        g.restore();
      }
      g.fillStyle = '#fff';
      g.fillRect(cut - 1 / s, 0, 2 / s, r.h);
    },
  });
}

function moveCut(e) {
  const r = el.querySelector('.ups-cmp').getBoundingClientRect();
  setCut((e.clientX - r.left) / r.width);
}
function setCut(v) {
  split = Math.min(1, Math.max(0, v));
  const cmp = el.querySelector('.ups-cmp');
  cmp.style.setProperty('--cut', split * 100 + '%');
  el.querySelector('.ups-cut').setAttribute('aria-valuenow', String(Math.round(split * 100)));
  if (lp) lp.refresh();
}

function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeUpscale(); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setCut(split + (e.key === 'ArrowLeft' ? -0.05 : 0.05)); }
  else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
  else if (e.code === 'KeyL' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); lp.toggle(); }
  e.stopPropagation();
}

function onClick(e) {
  const b = e.target.closest('[data-up], [data-sc]');
  if (!b) return;
  if (b.dataset.sc) { const s = +b.dataset.sc; if (s !== prefs.scale) { prefs.scale = pick = s; writePref(PREF, prefs); sfx('tick'); go(); } }
  else if (b.dataset.up === 'close') closeUpscale();
  else if (b.dataset.up === 'save') save();
  else if (b.dataset.up === 'px') { const on = !el.classList.contains('px'); el.classList.toggle('px', on); b.setAttribute('aria-pressed', String(on)); fit(); }
}

// the frame: fitted into the stage, or the result's real size in «1:1»
function fit() {
  const r = done.get(prefs.scale), cmp = el.querySelector('.ups-cmp');
  if (!r) return;
  if (el.classList.contains('px')) { cmp.style.width = r.w / devicePixelRatio + 'px'; cmp.style.height = r.h / devicePixelRatio + 'px'; return; }
  const st = el.querySelector('.ups-stage').getBoundingClientRect();
  const k = Math.min(st.width / r.w, st.height / r.h);
  cmp.style.width = Math.floor(r.w * k) + 'px'; cmp.style.height = Math.floor(r.h * k) + 'px';
}

function wait(text, frac = -1) {
  const w = el.querySelector('.ups-wait');
  w.hidden = false;
  if (!loader) { loader = pixLoader(text); el.querySelector('.ups-ld').replaceChildren(loader.el); } else loader.set(text);
  const p = el.querySelector('.ups-prog');
  p.hidden = frac < 0;
  p.firstElementChild.style.transform = `scaleX(${Math.max(0.02, Math.min(1, frac)).toFixed(3)})`;
}
const mb = (n) => Math.round(n / 1e6);

async function go() {
  const id = ++run, scale = prefs.scale, it = cur;
  el.querySelectorAll('[data-sc]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.sc === scale)));
  const save = el.querySelector('[data-up="save"]');
  save.disabled = true;
  const o = outSize(it, scale);
  if (done.has(scale)) { show(); return; }
  el.querySelector('.ups-cmp').hidden = true;
  el.querySelector('.ups-info').textContent = '';
  // the original at once, dimmed under the progress (audit 29.10: a black stage until the result)
  const og = el.querySelector('.ups-orig');
  if (srcUrl && og.getAttribute('src') !== srcUrl) og.src = srcUrl;
  og.hidden = !srcUrl;
  if (!o.fits) {
    if (loader) { loader.stop(); loader = null; }
    el.querySelector('.ups-ld').replaceChildren();
    el.querySelector('.ups-prog').hidden = true;
    el.querySelector('.ups-wait').hidden = false;
    el.querySelector('.ups-note').textContent = `Слишком большая для ×${scale}: вышло бы ${o.w} × ${o.h}.` + (scale === 4 ? ' Попробуйте ×2.' : '');
    return;
  }
  el.querySelector('.ups-note').textContent = 'Оригинал не меняется — увеличенная копия ляжет рядом.';
  if (!(await allowModel(id))) return;
  wait('Готовлю модель…');
  const t0 = performance.now();
  working = true;
  try {
    const r = await upscaleItem(it, scale, (p) => {
      if (id !== run) return;
      if (p.phase === 'download') wait(`Скачиваю модель · ${mb(p.got)} из ${mb(p.total)} МБ (один раз)`, p.got / p.total);
      else if (p.phase === 'loading') wait('Запускаю модель…');
      else if (p.phase === 'run') wait(`Увеличиваю ×${scale} · ${p.done} из ${p.total}` + (p.done > 1 && p.left > 3000 ? ` · ещё ~${elapsed(p.left)}` : ''), p.done / p.total);
    });
    if (id !== run || !isUpscaleOpen()) return;
    done.set(scale, { ...r, url: URL.createObjectURL(r.blob), ms: performance.now() - t0 });
    sfx('done');
    show();
  } catch (e) {
    if (id !== run || !isUpscaleOpen()) return;
    if (loader) { loader.stop(); loader = null; }
    el.querySelector('.ups-ld').replaceChildren();
    el.querySelector('.ups-prog').hidden = true;
    el.querySelector('.ups-note').textContent = `Не удалось увеличить: ${(e && e.message) || e}. Проверьте сеть (модель скачивается один раз) и попробуйте ещё раз.`;
  } finally { if (id === run) working = false; }
}

// the first use: the window asks before downloading the model (it used to start on opening)
async function allowModel(id) {
  if (askDone) askDone(null); // a newer run (×2 / ×4) asks instead: the old card goes, the window stays
  if ((await upscaleModelState()) !== 'missing') return true;
  if (id !== run || !isUpscaleOpen()) return false;
  if (loader) { loader.stop(); loader = null; }
  el.querySelector('.ups-ld').replaceChildren();
  el.querySelector('.ups-prog').hidden = true;
  const w = el.querySelector('.ups-wait'), note = el.querySelector('.ups-note'), was = note.textContent;
  w.hidden = false;
  note.innerHTML = `<b>Нужна модель «Увеличить» · ${mb(UPSCALE_MODEL.file.size)} МБ</b>Скачивается один раз и работает на этом компьютере — картинки никуда не уходят.`;
  const ask = document.createElement('div');
  ask.className = 'ups-ask';
  ask.innerHTML = `<button type="button" class="ibtn pri" data-ask="1">Скачать и увеличить ×${prefs.scale}</button><button type="button" class="ibtn" data-ask="0">Не сейчас</button>`;
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
  if (!yes) { closeUpscale(); return false; }
  return id === run && isUpscaleOpen();
}

function show() {
  const r = done.get(prefs.scale);
  if (!r) return;
  if (loader) { loader.stop(); loader = null; }
  el.querySelector('.ups-wait').hidden = true;
  el.querySelector('.ups-orig').hidden = true;
  const cmp = el.querySelector('.ups-cmp');
  cmp.querySelector('.ups-a').src = r.url;
  cmp.querySelector('.ups-b img').src = srcUrl;
  cmp.hidden = false;
  setCut(split);
  fit();
  el.querySelector('[data-up="save"]').disabled = false;
  const where = r.device === 'webgpu' ? 'на видеокарте' : 'на процессоре';
  el.querySelector('.ups-info').textContent = `${cur.w} × ${cur.h} → ${r.w} × ${r.h} · ${where} · ${elapsed(r.ms)} · тяните границу, чтобы сравнить · лупа: колесо — крупнее, L — выкл.`;
  loupeImages(r);
}

// the loupe draws from bitmaps (an <img> of an 8K result would be decoded again on every frame)
async function loupeImages(r) {
  const my = run;
  if (lpAfter) lpAfter.close();
  lpAfter = null;
  try {
    const after = await createImageBitmap(r.blob);
    const before = lpBefore || await createImageBitmap(await (await fetch(srcUrl)).blob());
    if (my !== run || !isUpscaleOpen()) { after.close(); if (!lpBefore) before.close(); return; }
    lpAfter = after; lpBefore = before;
    lp.refresh();
  } catch (e) { /* no loupe — the frame itself still works */ }
}

async function save() {
  const r = done.get(prefs.scale), btn = el.querySelector('[data-up="save"]');
  if (!r || !cur || btn.disabled) return;
  btn.disabled = true;
  try {
    const copy = await saveUpscaled(cur, r.blob, prefs.scale);
    if (!copy) throw new Error('копия не добавилась');
    sfx('add');
    toast(`Увеличенная копия: «${copy.name}»`, 4000);
    ui.refresh();
    closeUpscale();
  } catch (e) {
    btn.disabled = false;
    toast('Не удалось сохранить копию: ' + ((e && e.message) || e) + '. Оригинал не тронут.', 6000);
  }
}

export async function openUpscale(it) {
  if (!canUpscale(it)) { toast('Увеличить можно картинку или PSD (не SVG и не GIF)'); return; }
  if (!el) build();
  cur = it;
  prefs.scale = (it.w || 0) * (it.h || 0) > 2e6 ? 2 : pick;
  done.clear();
  if (lpBefore) { lpBefore.close(); lpBefore = null; } // the loupe's «before» is the new picture's
  el.querySelector('.ups-name').textContent = it.name;
  el.querySelector('.ups-info').textContent = '';
  el.querySelector('.ups-cmp').hidden = true;
  el.hidden = false;
  pushLayer({ el, title: 'Увеличить картинку', close: closeUpscale, onKey });
  addEventListener('resize', fit);
  sfx('open');
  try { srcUrl = await pictureUrl(it); } catch (e) {
    el.querySelector('.ups-note').textContent = `Файл не прочитался: ${(e && e.message) || e}.`;
    return;
  }
  if (cur === it) go();
}

export function closeUpscale() {
  if (!isUpscaleOpen()) return;
  run++;
  if (askDone) askDone(false);
  const f = upscaleFetching();
  if (f) toast(`Модель «Увеличить» докачивается: ${mb(f.got)} из ${mb(f.total)} МБ. Когда закончит, окно откроется сразу с ней.`, 7000);
  // a run in progress stops; a finished model stays loaded for the next picture
  if (working) { stopUpscale(); working = false; }
  if (loader) { loader.stop(); loader = null; }
  el.hidden = true;
  el.classList.remove('px');
  popLayer(el);
  removeEventListener('resize', fit);
  done.forEach((r) => URL.revokeObjectURL(r.url));
  done.clear();
  if (srcUrl) URL.revokeObjectURL(srcUrl);
  srcUrl = ''; cur = null;
  if (lp) lp.hide();
  if (lpAfter) lpAfter.close();
  if (lpBefore) lpBefore.close();
  lpAfter = lpBefore = null;
  el.querySelectorAll('img').forEach((i) => i.removeAttribute('src'));
  sfx('close');
}
