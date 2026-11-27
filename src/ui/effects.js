// «Эффекты»: a picture made retro and saved as a copy next to it — a look (as is, ANSI text, 1-bit, halftone) on a
// medium (nothing, a CRT tube, a microfiche). The math is lib/effects.js, the drawing lib/fxgl.js (one WebGL 2 context,
// given back on closing). On the left the result with a divider, the original left of it (drag, ←/→); on the right
// the tiles — each a live miniature of this picture with that choice — and the settings of both steps.
// Keys: 1–4 the look, Shift+1–3 the medium, Ctrl+S save, Esc close. The last settings of every effect are remembered
// (perch.effects); a copy made here remembers its own (`effect`) and opens its original with them.
import './effects.css';
import { pushLayer, popLayer } from './layers.js';
import { S, ui, isPic } from '../state.js';
import { ic } from './icons.js';
import { toast } from './dialogs.js';
import { sfx } from './sound.js';
import { esc, isMac } from '../util.js';
import { pictureUrl } from '../lib/masker.js';
import { addFromBlobs, saveIndex } from '../lib/library.js';
import { readPref, writePref } from '../lib/prefs.js';
import { LOOKS, MEDIA, CONTROLS, settle, snapshot, hasEffect, ansiCells, bitCells, gridOf, outSize, copyName, seedOf } from '../lib/effects.js';
import { createFx, paramsOf, glyphAtlas, labelCanvas } from '../lib/fxgl.js';

const PREF = 'perch.effects';
let el = null, cur = null, st = null, fx = null, cv = null, src = null, srcUrl = '', nat = { w: 1, h: 1 };
let run = 0, split = 0.25, drag = false, saving = false, queued = false, tileT = 0, prefT = 0;
let keys = {}, ansiGrid = [1, 1];
const small = new Map(); // «cols x rows» → RGBA of the picture at that grid
export const canEffects = (it) => isPic(it) && it.ext !== 'svg';
const isOpen = () => !!(el && !el.hidden);

const tile = (kind, x, i) => `<button type="button" class="fx-tile" role="radio" aria-checked="false" data-${kind}="${x.id}" ` +
  `title="${x.label} (${kind === 'look' ? '' : 'Shift '}${i + 1})"><canvas aria-hidden="true"></canvas><span>${x.label}</span></button>`;

function build() {
  el = document.createElement('section');
  el.className = 'fx';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Эффекты');
  el.innerHTML = `<div class="orb-bar glass fx-bar"><span class="orb-t">Эффекты</span><span class="cap-sm fx-name"></span>` +
    `<button type="button" class="ib" data-fx="close" aria-label="Закрыть" title="Закрыть (Esc)">${ic('x')}</button></div>` +
    `<div class="fx-stage"><div class="fx-cmp" hidden><div class="fx-b"><img alt="Оригинал"></div>` +
    `<div class="fx-cut" role="slider" tabindex="0" aria-label="Граница до / после" aria-valuemin="0" aria-valuemax="100"><i></i></div>` +
    `<span class="fx-lab l">Оригинал</span><span class="fx-lab r">Эффект</span></div><p class="fx-wait"></p></div>` +
    `<aside class="fx-panel glass" aria-label="Настройки эффекта">` +
    `<p class="fx-h">Рисунок</p><div class="fx-tiles" role="radiogroup" aria-label="Рисунок">${LOOKS.map((x, i) => tile('look', x, i)).join('')}</div>` +
    `<p class="fx-h">Носитель</p><div class="fx-tiles three" role="radiogroup" aria-label="Носитель">${MEDIA.map((x, i) => tile('media', x, i)).join('')}</div>` +
    `<div class="fx-ctl" data-for="look"></div><div class="fx-ctl" data-for="media"></div>` +
    // the actions stay at the bottom of the panel however far it is scrolled (critique 15.11: at 900 px of height the
    // save button was 200 px below the screen)
    `<div class="fx-foot"><div class="fx-acts"><button type="button" class="ibtn" data-fx="reset" title="Настройки этих двух эффектов — как были сначала">Сбросить</button>` +
    `<button type="button" class="ibtn pri" data-fx="save" title="PNG рядом с оригиналом (Ctrl+S)">Сохранить в библиотеку</button></div>` +
    `<p class="fx-note"></p></div></aside>`;
  document.body.appendChild(el);
  el.addEventListener('click', onClick);
  el.addEventListener('keydown', onKey);
  el.addEventListener('input', onInput);
  el.addEventListener('change', onInput);
  const cmp = el.querySelector('.fx-cmp');
  cmp.addEventListener('pointerdown', (e) => { if (e.button) return; drag = true; cmp.setPointerCapture(e.pointerId); moveCut(e); });
  cmp.addEventListener('pointermove', (e) => { if (drag) moveCut(e); });
  const end = () => { drag = false; };
  cmp.addEventListener('pointerup', end);
  cmp.addEventListener('pointercancel', end);
  cmp.addEventListener('lostpointercapture', end);
}

function moveCut(e) {
  const r = el.querySelector('.fx-cmp').getBoundingClientRect();
  setCut((e.clientX - r.left) / r.width);
}
function setCut(v) {
  split = Math.min(1, Math.max(0, v));
  el.querySelector('.fx-cmp').style.setProperty('--cut', split * 100 + '%');
  el.querySelector('.fx-cut').setAttribute('aria-valuenow', String(Math.round(split * 100)));
}

// ——— the panel ———
const fmt = (c, v) => (c.unit === '%' ? `${v} %` : c.unit ? `${v}${c.unit}` : String(v));
function controls(kind) {
  const p = st[kind];
  return CONTROLS[kind].filter((c) => !c.when || p[c.when[0]] === c.when[1]).map((c) => {
    const d = `data-kind="${kind}" data-k="${c.k}"`;
    if (c.type === 'range') return `<label class="fx-row"><span>${c.label}</span><b>${fmt(c, p[c.k])}</b><input type="range" ${d} min="${c.min}" max="${c.max}" step="${c.step}" value="${p[c.k]}"></label>`;
    if (c.type === 'color') return `<label class="fx-row fx-col"><span>${c.label}</span><input type="color" ${d} value="${esc(p[c.k])}"></label>`;
    if (c.type === 'toggle') return `<label class="fx-row fx-tg"><span>${c.label}</span><input type="checkbox" class="switch" ${d}${p[c.k] ? ' checked' : ''}></label>`;
    return `<div class="fx-f"><span class="fx-l">${c.label}</span><div class="fx-chips" role="radiogroup" aria-label="${c.label}">` +
      c.opts.map(([v, l]) => `<button type="button" role="radio" ${d} data-v="${v}" aria-checked="${p[c.k] === v}">${l}</button>`).join('') + '</div></div>';
  }).join('');
}
function renderPanel() {
  el.querySelectorAll('.fx-tile').forEach((b) => {
    const on = b.dataset.look ? b.dataset.look === st.look : b.dataset.media === st.media;
    b.setAttribute('aria-checked', String(on));
  });
  for (const [slot, kind, list] of [['look', st.look, LOOKS], ['media', st.media, MEDIA]]) {
    const box = el.querySelector(`.fx-ctl[data-for="${slot}"]`);
    box.hidden = !CONTROLS[kind];
    box.innerHTML = CONTROLS[kind] ? `<p class="fx-h">${list.find((x) => x.id === kind).label}</p>${controls(kind)}` : '';
  }
  note();
}
function note() {
  const save = el.querySelector('[data-fx="save"]'), o = outSize(nat.w, nat.h);
  save.disabled = saving || !hasEffect(st) || !src;
  if (saving) return;
  el.querySelector('.fx-note').textContent = hasEffect(st)
    ? `PNG ${o.w} × ${o.h} ляжет рядом с оригиналом, сам оригинал не меняется. ${isMac ? '⌘S' : 'Ctrl S'} — сохранить.`
    : 'Выберите рисунок или носитель.';
}

function changed() {
  clearTimeout(prefT);
  prefT = setTimeout(() => writePref(PREF, st), 300);
  note();
  redraw();
}
function choose(slot, id) {
  if (st[slot] === id) return;
  st[slot] = id;
  sfx('tick');
  renderPanel();
  changed();
}

function onClick(e) {
  const b = e.target.closest('[data-fx], [data-look], [data-media], [data-v]');
  if (!b) return;
  if (b.dataset.look) choose('look', b.dataset.look);
  else if (b.dataset.media) choose('media', b.dataset.media);
  else if (b.dataset.v) {
    const { kind, k, v } = b.dataset;
    if (st[kind][k] === v) return;
    st[kind][k] = v;
    sfx('tick');
    renderPanel();
    const again = el.querySelector(`[data-kind="${kind}"][data-k="${k}"][data-v="${v}"]`); // the panel was drawn anew
    if (again) again.focus({ preventScroll: true });
    changed();
  } else if (b.dataset.fx === 'close') closeEffects();
  else if (b.dataset.fx === 'save') save();
  else if (b.dataset.fx === 'reset') {
    const d = settle({ look: st.look, media: st.media });
    for (const kind of [st.look, st.media]) if (CONTROLS[kind]) st[kind] = d[kind];
    sfx('tick');
    renderPanel();
    changed();
  }
}
function onInput(e) {
  const t = e.target, { kind, k } = t.dataset || {};
  if (!kind || !k || t.dataset.v) return;
  const c = CONTROLS[kind].find((x) => x.k === k);
  const v = c.type === 'range' ? Number(t.value) : c.type === 'toggle' ? t.checked : t.value;
  if (st[kind][k] === v) return;
  st[kind][k] = settle({ [kind]: { ...st[kind], [k]: v } })[kind][k];
  if (c.type === 'range') t.parentElement.querySelector('b').textContent = fmt(c, st[kind][k]);
  else if (c.type === 'toggle') sfx(t.checked ? 'on' : 'off');
  changed();
}

function onKey(e) {
  const inRange = e.target.matches && e.target.matches('input[type=range]');
  if (e.key === 'Escape') { e.preventDefault(); closeEffects(); }
  else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') { e.preventDefault(); save(); }
  else if (!e.ctrlKey && !e.metaKey && !e.altKey && /^Digit[1-4]$/.test(e.code)) {
    // by the key's place: the same in any layout, and Shift+1 is «!» or «"» in different ones
    e.preventDefault();
    const n = +e.code.slice(5) - 1;
    if (e.shiftKey) { if (MEDIA[n]) choose('media', MEDIA[n].id); } else choose('look', LOOKS[n].id);
  } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !inRange && !(e.target.closest && e.target.closest('[role=radiogroup]'))) {
    e.preventDefault();
    setCut(split + (e.key === 'ArrowLeft' ? -0.05 : 0.05));
  }
  e.stopPropagation();
}

// ——— drawing ———
const alive = (my) => my === run && isOpen() && fx && !fx.lost;
const today = () => new Date().toISOString().slice(0, 10);
// the picture at a grid's size (its cells' average colours), kept for the few grids in use
async function smallAt(cols, rows) {
  const k = cols + 'x' + rows;
  if (small.has(k)) return small.get(k);
  const bm = await createImageBitmap(src, { resizeWidth: cols, resizeHeight: rows, resizeQuality: 'high' });
  const c = new OffscreenCanvas(cols, rows), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bm, 0, 0);
  bm.close();
  const d = g.getImageData(0, 0, cols, rows).data;
  if (small.size > 6) small.delete(small.keys().next().value);
  small.set(k, d);
  return d;
}
// a grid no taller or wider than a texture can be
function gridFor(across) {
  const g = gridOf(nat.w, nat.h, across), k = Math.min(1, fx.maxTex / Math.max(g.cols, g.rows));
  return k < 1 ? { cols: Math.max(1, Math.floor(g.cols * k)), rows: Math.max(1, Math.floor(g.rows * k)) } : g;
}
// the textures the looks need, made again only when their settings changed (the tiles show every look at once)
async function prepare(my) {
  const a = st.ansi, ga = gridFor(a.cols);
  const ka = [ga.cols, ga.rows, a.pal, a.bg, a.contrast, a.accent, a.mono, a.set].join();
  if (ka !== keys.ansi) {
    const d = await smallAt(ga.cols, ga.rows);
    if (!alive(my)) return false;
    fx.ansi(ansiCells(d, ga.cols, ga.rows, a), ga.cols, ga.rows);
    keys.ansi = ka; ansiGrid = [ga.cols, ga.rows];
  }
  if (a.set !== keys.atlas) {
    const c = await glyphAtlas(a.set);
    if (!alive(my)) return false;
    fx.atlas(c);
    keys.atlas = a.set;
  }
  const b = st.bit, gb = gridFor(b.dots), kb = [gb.cols, gb.rows, b.method, b.contrast, b.bright].join();
  if (kb !== keys.bit) {
    const d = await smallAt(gb.cols, gb.rows);
    if (!alive(my)) return false;
    fx.bits(bitCells(d, gb.cols, gb.rows, b), gb.cols, gb.rows);
    keys.bit = kb;
  }
  if (st.fiche.label) {
    const kl = [cur.name, today()].join('|');
    if (kl !== keys.label) {
      const c = await labelCanvas(cur.name.replace(/\.[^.]+$/, ''), today(), nat.w / nat.h);
      if (!alive(my)) return false;
      fx.label(c);
      keys.label = kl;
    }
  }
  return true;
}
const uniforms = (s) => paramsOf(s, { asp: nat.w / nat.h, srcW: src.width, ansiGrid, seed: seedOf(cur.id), label: !!keys.label });

function redraw() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(async () => {
    queued = false;
    const my = run;
    if (!alive(my) || !src) return;
    try {
      if (!(await prepare(my)) || !alive(my)) return;
      fx.draw(uniforms(st));
      clearTimeout(tileT);
      tileT = setTimeout(() => drawTiles(my), 140);
    } catch (e) { fail(e); }
  });
}
// a look's tile shows a detail from the middle (the pattern reads), a medium's the whole picture (the tube's edge, the
// marks); both cover their tile
function cropFor(kind, w, h) {
  const asp = nat.w / nat.h, ta = w / h;
  if (kind === 'media') return asp > ta ? [(1 - ta / asp) / 2, 0, ta / asp, 1] : [0, (1 - asp / ta) / 2, 1, asp / ta];
  let cw = 0.24, ch = cw * asp / ta;
  if (ch > 1) { ch = 1; cw = ta / asp; }
  return [0.5 - cw / 2, 0.5 - ch / 2, cw, ch];
}
function drawTiles(my) {
  if (!alive(my)) return;
  try {
    el.querySelectorAll('.fx-tile').forEach((b) => {
      const c = b.querySelector('canvas'), kind = b.dataset.look ? 'look' : 'media';
      if (!c.width) return;
      const s = kind === 'look' ? { ...st, look: b.dataset.look } : { ...st, media: b.dataset.media };
      const img = fx.tile(uniforms(s), c.width, c.height, cropFor(kind, c.width, c.height));
      if (img) c.getContext('2d').putImageData(img, 0, 0);
    });
  } catch (e) { fail(e); }
}

// the frame fitted into the stage in the file's proportions; the canvas at the screen's pixels (up to 2400)
function fit() {
  if (!isOpen() || !cv) return;
  const stage = el.querySelector('.fx-stage').getBoundingClientRect(), cmp = el.querySelector('.fx-cmp');
  const asp = nat.w / nat.h;
  let w = stage.width, h = w / asp;
  if (h > stage.height) { h = stage.height; w = h * asp; }
  cmp.style.width = Math.max(1, Math.floor(w)) + 'px';
  cmp.style.height = Math.max(1, Math.floor(h)) + 'px';
  const dpr = Math.min(window.devicePixelRatio || 1, 2), k = Math.min(1, 2400 / Math.max(w * dpr, h * dpr, 1));
  const cw = Math.max(1, Math.round(w * dpr * k)), ch = Math.max(1, Math.round(h * dpr * k));
  if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
  el.querySelectorAll('.fx-tile canvas').forEach((c) => {
    const r = c.getBoundingClientRect(), tw = Math.round(r.width * dpr), th = Math.round(r.height * dpr);
    if (tw && th && (c.width !== tw || c.height !== th)) { c.width = tw; c.height = th; }
  });
  redraw();
}

function wait(text) {
  const w = el.querySelector('.fx-wait');
  w.textContent = text;
  w.hidden = !text;
}
function fail(e) {
  if (!isOpen()) return;
  el.querySelector('.fx-cmp').hidden = true;
  wait(`Эффекты не нарисовались: ${(e && e.message) || e}. Закройте окно и откройте ещё раз; если повторится — обновите видеодрайвер.`);
}

// ——— saving ———
async function saveCopy(it, blob) {
  const [copy] = await addFromBlobs([{ blob, name: copyName(it.name, st.look, st.media), source: it.url || '' }], { folder: (it.folders || [])[0] || null });
  if (!copy) return null;
  copy.folders = [...new Set([...(copy.folders || []), ...(it.folders || [])])];
  copy.tags = [...new Set([...(copy.tags || []), ...(it.tags || [])])];
  copy.effectOf = it.id; // optional fields: which file this is made from, and with what (opens it again with them)
  copy.effect = snapshot(st);
  saveIndex();
  return copy;
}
async function save() {
  const btn = el.querySelector('[data-fx="save"]'), my = run;
  if (saving || !src || !hasEffect(st)) return;
  saving = true;
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Сохраняю…';
  try {
    if (!(await prepare(my))) return;
    const o = outSize(nat.w, nat.h);
    const canvas = await fx.toCanvas(uniforms(st), o.w, o.h, (done, total) => {
      if (!alive(my)) throw new DOMException('closed', 'AbortError');
      if (total > 1) btn.textContent = `Сохраняю… ${Math.round(done / total * 100)} %`;
      return new Promise((r) => setTimeout(r, 0)); // the window breathes between pieces
    });
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    if (!alive(my)) return;
    const copy = await saveCopy(cur, blob);
    if (!copy) throw new Error('копия не добавилась');
    sfx('add');
    toast(`Копия с эффектом: «${copy.name}»`, 4000);
    ui.refresh();
    closeEffects();
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    toast(`Не удалось сохранить копию: ${(e && e.message) || e}. Оригинал не тронут.`, 6000);
  } finally {
    saving = false;
    if (my === run) { btn.textContent = label; note(); }
  }
}

// ——— open / close ———
export async function openEffects(it) {
  // a copy made here opens its original, with the copy's settings
  let base = it, from = null;
  if (it && it.effect && it.effectOf) {
    const o = S.byId.get(it.effectOf);
    if (o && canEffects(o)) { base = o; from = it.effect; }
  }
  if (!canEffects(base)) { toast('Эффекты — для картинок и PSD (не SVG и не GIF).'); return; }
  if (!el) build();
  if (isOpen()) closeEffects();
  const my = ++run;
  cur = base;
  const stored = settle(readPref(PREF, {}));
  st = from ? settle({ ...stored, ...from }) : stored;
  keys = {}; ansiGrid = [1, 1]; small.clear();
  el.querySelector('.fx-name').textContent = base.name;
  el.querySelector('.fx-cmp').hidden = true;
  wait('Читаю картинку…');
  el.hidden = false;
  pushLayer({ el, title: 'Эффекты', close: closeEffects, onKey });
  addEventListener('resize', fit);
  sfx('open');
  // a new canvas each time: a context given back on closing cannot be taken again from the same one
  cv = document.createElement('canvas');
  cv.className = 'fx-cv';
  cv.setAttribute('aria-label', 'Картинка с эффектом');
  el.querySelector('.fx-cmp').prepend(cv);
  try {
    fx = createFx(cv, () => fail(new Error('видеокарта сбросила рисунок')));
  } catch (e) { fail(e); return; }
  if (!fx) { wait('Эффектам нужен WebGL 2, а он здесь недоступен. Обновите видеодрайвер или Oddments.'); return; }
  renderPanel();
  setCut(split);
  try {
    srcUrl = await pictureUrl(base);
    const blob = await (await fetch(srcUrl)).blob();
    let bm = await createImageBitmap(blob);
    if (my !== run) { bm.close(); return; }
    nat = { w: bm.width, h: bm.height };
    // the picture on the graphics card: at most 4096 px on the long side (a cell is never finer than that)
    const cap = Math.min(4096, fx.maxTex), long = Math.max(bm.width, bm.height);
    if (long > cap) {
      const k = cap / long;
      const s = await createImageBitmap(bm, { resizeWidth: Math.round(bm.width * k), resizeHeight: Math.round(bm.height * k), resizeQuality: 'high' });
      bm.close();
      bm = s;
    }
    if (my !== run) { bm.close(); return; }
    src = bm;
    fx.source(src);
  } catch (e) {
    if (my === run) wait(`Файл не прочитался: ${(e && e.message) || e}. Оригинал не тронут.`);
    return;
  }
  el.querySelector('.fx-b img').src = srcUrl;
  el.querySelector('.fx-cmp').hidden = false;
  wait('');
  note();
  fit();
  el.querySelector('.fx-tile[aria-checked="true"]').focus({ preventScroll: true });
}

export function closeEffects() {
  if (!isOpen()) return;
  run++;
  el.hidden = true;
  popLayer(el);
  removeEventListener('resize', fit);
  clearTimeout(tileT);
  if (prefT) { clearTimeout(prefT); prefT = 0; writePref(PREF, st); }
  if (fx) fx.dispose();
  fx = null;
  if (cv) cv.remove();
  cv = null;
  if (src) src.close();
  src = null;
  small.clear();
  if (srcUrl) URL.revokeObjectURL(srcUrl);
  srcUrl = ''; cur = null;
  el.querySelector('.fx-b img').removeAttribute('src');
  el.querySelectorAll('.fx-tile canvas').forEach((c) => { c.width = 0; c.height = 0; });
  sfx('close');
}
