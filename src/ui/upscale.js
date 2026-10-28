// «Увеличить»: the picture enlarged by Real-ESRGAN (lib/upscale.js) against a plain resize, on one frame with a divider —
// drag it (or ←/→) to compare; «1:1» shows real pixels of the result (scroll to look around). «Сохранить в библиотеку»
// puts the enlarged copy next to the original («… @4x.png», same collections and tags); the original is not touched.
import './upscale.css';
import { pushLayer, popLayer } from './layers.js';
import { ui } from '../state.js';
import { ic } from './icons.js';
import { toast } from './dialogs.js';
import { sfx } from './sound.js';
import { pixLoader, elapsed } from './pixload.js';
import { pictureUrl } from '../lib/masker.js';
import { canUpscale, outSize, upscaleItem, saveUpscaled, stopUpscale } from '../lib/upscale.js';
import { readPref, writePref } from '../lib/prefs.js';

const PREF = 'perch.upscale';
const prefs = readPref(PREF, { scale: 4 });
let el = null, cur = null, srcUrl = '', loader = null, run = 0, split = 0.5, drag = false, working = false;
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
    `<div class="ups-wait"><div class="ups-ld"></div><div class="ups-prog"><i></i></div><p class="ups-note"></p></div></div>` +
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
}

function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeUpscale(); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setCut(split + (e.key === 'ArrowLeft' ? -0.05 : 0.05)); }
  else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
  e.stopPropagation();
}

function onClick(e) {
  const b = e.target.closest('[data-up], [data-sc]');
  if (!b) return;
  if (b.dataset.sc) { const s = +b.dataset.sc; if (s !== prefs.scale) { prefs.scale = s; writePref(PREF, prefs); sfx('tick'); go(); } }
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
  p.firstElementChild.style.width = Math.round(Math.max(0.02, frac) * 100) + '%';
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
  if (!o.fits) {
    if (loader) { loader.stop(); loader = null; }
    el.querySelector('.ups-ld').replaceChildren();
    el.querySelector('.ups-prog').hidden = true;
    el.querySelector('.ups-wait').hidden = false;
    el.querySelector('.ups-note').textContent = `Слишком большая для ×${scale}: вышло бы ${o.w} × ${o.h}.` + (scale === 4 ? ' Попробуйте ×2.' : '');
    return;
  }
  el.querySelector('.ups-note').textContent = 'Оригинал не меняется — увеличенная копия ляжет рядом.';
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

function show() {
  const r = done.get(prefs.scale);
  if (!r) return;
  if (loader) { loader.stop(); loader = null; }
  el.querySelector('.ups-wait').hidden = true;
  const cmp = el.querySelector('.ups-cmp');
  cmp.querySelector('.ups-a').src = r.url;
  cmp.querySelector('.ups-b img').src = srcUrl;
  cmp.hidden = false;
  setCut(split);
  fit();
  el.querySelector('[data-up="save"]').disabled = false;
  const where = r.device === 'webgpu' ? 'на видеокарте' : 'на процессоре';
  el.querySelector('.ups-info').textContent = `${cur.w} × ${cur.h} → ${r.w} × ${r.h} · ${where} · ${elapsed(r.ms)} · тяните границу, чтобы сравнить`;
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
  done.clear();
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
  el.querySelectorAll('img').forEach((i) => i.removeAttribute('src'));
  sfx('close');
}
