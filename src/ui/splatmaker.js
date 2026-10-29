// «Сплат из модели»: a model of the library turned into Gaussian splats (lib/splat.js bakeSplats). No training — the
// model's surface is covered with flat discs, and each one's colour is taken from 64 renders of the model in the light the
// 3D view shows now (its own «Освещение», L), with a part that changes with the view angle if «Блики» is on. The stage
// shows the model, then the splat («Модель / Сплат»). The result goes next to the model («… — сплат.ply» or .spz: same
// collections and tags, `splatOf`) or to Blender (5.3+ opens splats).
import './splatmaker.css';
import { pushLayer, popLayer } from './layers.js';
import { ui, isSplatItem } from '../state.js';
import { ic } from './icons.js';
import { toast } from './dialogs.js';
import { sfx } from './sound.js';
import { pixLoader, elapsed } from './pixload.js';
import { absPath, addFromBlobs, saveIndex } from '../lib/library.js';
import { readPref, writePref } from '../lib/prefs.js';
import { fmtSize, DEC, LOC } from '../util.js';
import * as fs from '@tauri-apps/plugin-fs';
import { t } from '../lib/i18n.js';

const PREF = 'perch.splatmk';
const prefs = readPref(PREF, { count: 500000, sh: true, fmt: 'ply' });
const COUNTS = [[250000, '250 тыс'], [500000, '500 тыс'], [1000000, '1 млн'], [2000000, '2 млн']];
let el = null, cur = null, buf = null, ext = '', stop = null, mnt = 0, run = 0, result = null, spz = null, loader = null, working = false;
export const isSplatMakerOpen = () => !!(el && !el.hidden);
const $ = (s) => el.querySelector(s);
const fmtN = (n) => Math.round(n).toLocaleString(LOC);

function build() {
  el = document.createElement('section');
  el.className = 'spm';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Сплат из модели');
  el.innerHTML = `<div class="spm-view"></div>
    <div class="orb-bar glass spm-bar"><span class="orb-t">Сплат из модели</span><span class="cap-sm spm-name"></span>
      <span class="spm-seg" role="group" aria-label="Что показать"><button type="button" data-show="model" aria-pressed="true">Модель</button><button type="button" data-show="splat" aria-pressed="false" disabled>Сплат</button></span>
      <button type="button" class="ib" data-spm="close" aria-label="Закрыть" title="Закрыть (Esc)">${ic('x')}</button></div>
    <aside class="spm-panel glass" aria-label="Настройки сплата" tabindex="-1">
      <span class="spm-h">Сколько точек</span>
      <div class="spm-seg wide" role="group" aria-label="Сколько точек">${COUNTS.map(([n, t]) => `<button type="button" data-count="${n}">${t}</button>`).join('')}</div>
      <p class="spm-note">Больше точек — мельче детали и тяжелее файл: ~60 байт на точку в PLY, в SPZ — около 10.</p>
      <button type="button" class="ibtn wide spm-chk" data-spm="sh" title="Цвет точки чуть меняется, когда смотришь с другой стороны — блики и отражения «живут» при вращении">Блики меняются с ракурсом</button>
      <p class="spm-light"></p>
      <button type="button" class="ibtn pri wide" data-spm="go">${ic('splat')}Сделать сплат</button>
      <div class="spm-prog" hidden><div class="spm-ld"></div><i><b></b></i></div>
      <div class="spm-res" hidden>
        <div class="spm-stats"></div>
        <span class="spm-h">Формат файла</span>
        <div class="spm-seg wide" role="group" aria-label="Формат файла"><button type="button" data-fmt="ply">PLY</button><button type="button" data-fmt="spz">SPZ</button></div>
        <p class="spm-note spm-fmtnote"></p>
        <button type="button" class="ibtn pri wide" data-spm="save">Сохранить в библиотеку</button>
        <button type="button" class="ibtn wide" data-spm="blender">В Blender</button>
      </div>
      <p class="spm-note">Обучения нет: форма модели известна, поэтому точки ложатся прямо на поверхность, а цвет каждой снимается с 64 ракурсов. Стекло и прозрачность передаются плохо.</p>
    </aside>`;
  document.body.appendChild(el);
  el.addEventListener('click', onClick);
  $('.spm-panel').addEventListener('pointerenter', drawLight);
}

function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeSplatMaker(); }
}

function onClick(e) {
  const b = e.target.closest('[data-spm], [data-count], [data-fmt], [data-show]');
  if (!b || b.disabled) return;
  if (b.dataset.count) { prefs.count = +b.dataset.count; writePref(PREF, prefs); sfx('tick'); drawSettings(); }
  else if (b.dataset.fmt) { prefs.fmt = b.dataset.fmt; writePref(PREF, prefs); sfx('tick'); drawSettings(); drawResult(); }
  else if (b.dataset.show) show(b.dataset.show);
  else if (b.dataset.spm === 'close') closeSplatMaker();
  else if (b.dataset.spm === 'sh') { prefs.sh = !prefs.sh; writePref(PREF, prefs); drawSettings(); }
  else if (b.dataset.spm === 'go') bake();
  else if (b.dataset.spm === 'save') save();
  else if (b.dataset.spm === 'blender') toBlender();
}

function drawSettings() {
  el.querySelectorAll('[data-count]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.count === prefs.count)));
  el.querySelectorAll('[data-fmt]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.fmt === prefs.fmt)));
  $('[data-spm="sh"]').setAttribute('aria-pressed', String(!!prefs.sh));
  drawLight();
}

// the light that will be baked: whatever the 3D view shows now
async function drawLight() {
  const { viewLight } = await import('./viewer3d.js');
  const L = viewLight();
  $('.spm-light').innerHTML = `Свет запечётся как в просмотре: <b>${L.label}</b>${L.rot ? `, поворот ${Math.round(L.rot)}°` : ''}${L.ev ? `, экспозиция ${L.ev > 0 ? '+' : '−'}${Math.abs(L.ev).toFixed(1).replace('.', DEC)}` : ''}. Сменить — лампочка внизу или L.`;
}

function unmount() { if (stop) { stop(); stop = null; } }

async function show(what) {
  if (what === 'splat' && !result) return;
  el.querySelectorAll('[data-show]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.show === what)));
  const my = ++mnt, hold = $('.spm-view'), stale = () => my !== mnt || !isSplatMakerOpen();
  unmount();
  hold.innerHTML = `<div class="pv-other"><p>${what === 'model' ? 'Загружаю модель…' : 'Показываю сплат…'}</p></div>`;
  try {
    let done;
    if (what === 'model') {
      const { mountViewer } = await import('./viewer3d.js');
      done = await mountViewer(hold, buf.slice(0), ext, stale, {});
    } else {
      const { mountSplat } = await import('./splatview.js');
      done = await mountSplat(hold, result.ply, 'ply', stale, { format: 'ply' });
    }
    if (stale()) done(); else stop = done;
  } catch (e) {
    console.warn(e);
    if (!stale()) hold.innerHTML = `<div class="pv-other"><p>Не удалось показать: ${(e && e.message) || e}</p></div>`;
  }
}

function progress(text, frac = -1) {
  const p = $('.spm-prog');
  p.hidden = false;
  if (!loader) { loader = pixLoader(text); $('.spm-ld').replaceChildren(loader.el); } else loader.set(text);
  p.querySelector('i').hidden = frac < 0;
  p.querySelector('b').style.transform = `scaleX(${Math.max(0.02, Math.min(1, frac)).toFixed(3)})`;
}
function endProgress() {
  if (loader) { loader.stop(); loader = null; }
  $('.spm-ld').replaceChildren();
  $('.spm-prog').hidden = true;
}

async function bake() {
  if (working || !buf) return;
  const id = ++run, it = cur, t0 = performance.now();
  working = true;
  $('[data-spm="go"]').disabled = true;
  $('.spm-res').hidden = true;
  progress('Готовлю модель и свет…');
  let renderer = null, env = null, obj = null, M = null;
  try {
    const [model3d, { bakeSplats }, V] = await Promise.all([import('../lib/model3d.js'), import('../lib/splat.js'), import('./viewer3d.js')]);
    M = model3d;
    const T = await M.loadThree();
    obj = await M.parseModel(T, ext, buf.slice(0));
    const L = V.viewLight();
    // a renderer of its own, without anti-aliasing (it would blend the packed distances at edges) and with plain alpha
    renderer = new T.THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: false, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
    env = await V.envTexture(T, renderer, L.id);
    if (id !== run) return;
    const r = await bakeSplats(T, obj, { count: prefs.count, sh: prefs.sh, renderer, light: { env, room: L.id === 'room', rot: L.rot, ev: L.ev }, name: it.name }, (p) => {
      if (id !== run) return;
      if (p.phase === 'sample') progress('Раскладываю точки по поверхности…');
      else if (p.phase === 'view') progress(`Снимаю цвет с ракурсов · ${p.done} из ${p.total}`, p.done / p.total);
      else if (p.phase === 'fit') progress('Считаю цвет каждой точки…');
    }, () => id !== run || !isSplatMakerOpen());
    if (id !== run || !isSplatMakerOpen()) return;
    result = { ...r, light: L.label, ms: performance.now() - t0, sh: !!prefs.sh };
    spz = null;
    sfx('done');
    endProgress();
    $('[data-show="splat"]').disabled = false;
    drawResult();
    show('splat');
  } catch (e) {
    if (id !== run || (e && e.message === 'stale')) return;
    console.warn(e);
    endProgress();
    toast('Не удалось сделать сплат: ' + ((e && e.message) || e) + '. Попробуйте меньше точек.', 7000);
  } finally {
    if (env) env.dispose();
    if (obj && M) M.disposeObject(obj);
    if (renderer) { renderer.dispose(); renderer.forceContextLoss(); }
    if (id === run) { working = false; if (el) $('[data-spm="go"]').disabled = false; }
  }
}

async function spzBytes() {
  if (!spz) { const { toSpz } = await import('../lib/splat.js'); spz = await toSpz(result.ply, 'ply'); }
  return spz;
}

async function drawResult() {
  if (!result) return;
  $('.spm-res').hidden = false;
  $('.spm-stats').innerHTML = `<div><b>${fmtN(result.n)}</b><span>точек</span></div><div><b>${elapsed(result.ms)}</b><span>${result.sh ? 'с бликами' : 'без бликов'}</span></div>`;
  const note = $('.spm-fmtnote');
  if (prefs.fmt === 'ply') { note.textContent = `${fmtSize(result.ply.length)} · открывают Blender 5.3, SuperSplat, Postshot, KIRI`; return; }
  note.textContent = 'Сжимаю…';
  try { const b = await spzBytes(); if (prefs.fmt === 'spz') note.textContent = `${fmtSize(b.length)} · в ~${Math.max(2, Math.round(result.ply.length / b.length))} раз меньше PLY; для сайтов и Spark`; }
  catch (e) { note.textContent = 'SPZ не получился: ' + ((e && e.message) || e); }
}

const outName = () => `${cur.name.replace(/\.[^.]+$/, '')} — ${t('сплат')}`;

async function save() {
  if (!result || !cur) return;
  const btn = $('[data-spm="save"]');
  btn.disabled = true;
  try {
    const bytes = prefs.fmt === 'spz' ? await spzBytes() : result.ply;
    const [copy] = await addFromBlobs([{ blob: new Blob([bytes]), name: `${outName()}.${prefs.fmt}`, source: cur.url || '' }], { folder: (cur.folders || [])[0] || null });
    if (!copy) throw new Error('файл не добавился');
    copy.folders = [...new Set([...(copy.folders || []), ...(cur.folders || [])])];
    copy.tags = [...new Set([...(copy.tags || []), ...(cur.tags || [])])];
    copy.splatOf = cur.id; // optional field: which model this splat was made from
    saveIndex();
    ui.refresh();
    sfx('add');
    toast(`Сплат в библиотеке: «${copy.name}»`, 4000);
  } catch (e) {
    toast('Не удалось сохранить сплат: ' + ((e && e.message) || e), 6000);
  } finally { btn.disabled = false; }
}

async function toBlender() {
  if (!result) return;
  const m = await import('./toblender.js');
  // PLY: Blender 5.3 reads it with the view-dependent part; SPZ — only if this Blender has the SPZ importer
  await m.bytesToBlender(result.ply, outName() + '.ply', 'Сплат');
}

export async function openSplatMaker(it) {
  if (!it || it.kind !== 'model' || isSplatItem(it)) { toast('Сплат делается из 3D-модели'); return; }
  const pv = await import('./preview.js');
  if (pv.isPreviewOpen()) pv.closePreview(true);
  if (!el) build();
  cur = it; result = null; spz = null; buf = null; run++;
  $('.spm-name').textContent = it.name;
  $('.spm-res').hidden = true;
  $('[data-show="splat"]').disabled = true;
  endProgress();
  drawSettings();
  el.hidden = false;
  document.body.classList.add('spm-on');
  pushLayer({ el, title: 'Сплат из модели', close: closeSplatMaker, onKey });
  sfx('open');
  try {
    let file = it.file;
    if (it.ext === 'blend' || it.ext === 'abc') { // the scene Blender exported for the preview
      if (!it.glb) { progress('Blender готовит сцену…'); await (await import('../lib/blender.js')).prepare(it); endProgress(); }
      file = it.glb;
    }
    const u8 = await fs.readFile(absPath(file));
    if (cur !== it) return;
    buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    ext = file === it.file ? it.ext : 'glb';
    show('model');
  } catch (e) {
    endProgress();
    $('.spm-view').innerHTML = `<div class="pv-other"><p>Модель не прочиталась: ${(e && e.message) || e}</p></div>`;
  }
}

// from the left panel or the palette: the selected model, or the models view with a hint
export async function splatSelected() {
  const { S } = await import('../state.js');
  const sel = Array.from(S.sel).map((id) => S.byId.get(id)).filter(Boolean);
  const ok = (i) => i.kind === 'model' && !isSplatItem(i) && (!['blend', 'abc'].includes(i.ext) || !!i.glb);
  if (sel.length === 1 && ok(sel[0])) return openSplatMaker(sel[0]);
  // no model selected: pick one here (audit 29.10: it moved the wall to «3D-модели» with only a toast to say why)
  (await import('./pick.js')).pickItem({ title: 'Сплат из модели', filter: ok, run: openSplatMaker, empty: 'Моделей в библиотеке пока нет: перетащите GLB, OBJ, FBX или STL в окно.' });
}

export function closeSplatMaker() {
  if (!isSplatMakerOpen()) return;
  run++; mnt++;
  unmount();
  endProgress();
  el.hidden = true;
  document.body.classList.remove('spm-on');
  popLayer(el);
  result = null; spz = null; buf = null; working = false;
  $('.spm-view').innerHTML = '';
}
