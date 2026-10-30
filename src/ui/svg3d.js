// «SVG в 3D» and «Ремеш»: one full-window layer in Oddments' own style. On the left — the regular 3D viewer
// (modes, matcaps, wireframe), on the right — a glass panel with the settings.
// - From an SVG: the clean mesh is built right here (lib/svg3d.js, «Точная»); «AutoRemesher» sends that
//   model to the bundled remesher (lib/remesh.js) for an even quad flow over the whole surface.
// - From a 3D model: AutoRemesher only.
// Every result is checked (closed, no zero-area or flipped faces) before it can be saved; the saved model is
// a new OBJ in the library, next to the source.
import './svg3d.css';
import { pushLayer, popLayer } from './layers.js';
import { S, ui, isSplatItem } from '../state.js';
import { $, esc, isMac, DEC } from '../util.js';
import { ic } from './icons.js';
import { toast } from './dialogs.js';
import { sfx } from './sound.js';
import { motionOn } from './motion.js';
import { markStep } from './onboard.js';
import { absPath, addFromBlobs, assetUrl } from '../lib/library.js';
import { showQuickFile } from './quickfile.js';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import * as fs from '@tauri-apps/plugin-fs';
import { readPref, writePref } from '../lib/prefs.js';
import { t } from '../lib/i18n.js';

const PREFS_KEY = 'perch.svg3d';
const DEF = { fix: true, round: 0, depth: 0.24, bevel: 0.04, bseg: 3, sseg: 1, dens: 18, corner: 32, inner: 12, loops: 3, cap: 'quad', engine: 'exact', quads: 1500, sharp: 60, adapt: 1, aniso: 1 };
let P = { ...DEF };
Object.assign(P, readPref(PREFS_KEY, {}));
const keep = () => writePref(PREFS_KEY, P);

let el = null, lib = null, src = null, shapes = null, result = null, cleanup = null, token = 0, busy = false;
export const isSvg3dOpen = () => !!(el && !el.hidden);
const inApp = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

const SLIDERS = [
  ['depth', 'Глубина', 0.02, 1, 0.01, (v) => Math.round(v * 50) + '%', 'svg'],
  ['bevel', 'Фаска', 0, 0.12, 0.002, (v) => (v ? (v * 50).toFixed(1) + '%' : 'нет'), 'svg'],
  ['round', 'Скругление углов', 0, 0.3, 0.005, (v) => (v ? (v * 50).toFixed(1) + '%' : 'нет'), 'svg'],
  // the mesh layout of «Точная» only: AutoRemesher rebuilds every face itself, so these change nothing there
  ['bseg', 'Сегменты фаски', 1, 8, 1, (v) => v, 'svgx'],
  ['sseg', 'Петли на стенке', 1, 6, 1, (v) => v, 'svgx'],
  ['dens', 'Плотность контура', 4, 60, 1, (v) => v, 'svgx'],
  ['corner', 'Острый угол от', 10, 80, 1, (v) => v + '°', 'svg'],
  ['inner', 'Сетка в середине', 4, 40, 1, (v) => v + ' кл.', 'exact'],
  ['loops', 'Петли по краю крышки', 0, 8, 1, (v) => v, 'exact'],
  ['quads', 'Квадов примерно', 200, 20000, 100, (v) => Math.round(v).toLocaleString('ru'), 'ar'],
  ['sharp', 'Острые рёбра от', 30, 180, 1, (v) => v + '°', 'ar'],
  ['adapt', 'Гуще на изгибах', 0, 1, 0.05, (v) => Math.round(v * 100) + '%', 'ar'],
  ['aniso', 'Вытягивать вдоль изгиба', 0, 1, 0.05, (v) => Math.round(v * 100) + '%', 'ar'],
];

function build() {
  el = document.createElement('section');
  el.className = 's3d';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'SVG в 3D');
  el.innerHTML = `<div class="s3d-view" id="s3dView" data-keep-view="1"></div>
    <div class="orb-bar glass s3d-bar"><span class="orb-t" id="s3dT"></span><span class="cap-sm" id="s3dSrc"></span>
      <button type="button" class="ib" data-s3="x" aria-label="Закрыть" title="Закрыть (Esc)">${ic('x')}</button></div>
    <aside class="s3d-panel glass" aria-label="Настройки" tabindex="-1">
      <div class="seg s3d-eng" role="group" aria-label="Сетка">
        <button type="button" data-eng="exact">Точная</button><button type="button" data-eng="ar">AutoRemesher</button>
      </div>
      <p class="s3d-note" id="s3dEngNote"></p>
      <div id="s3dSliders"></div>
      <div class="seg s3d-cap" role="group" aria-label="Крышки" data-only="exact">
        <button type="button" data-cap="quad">Квады</button><button type="button" data-cap="ngon">N-гоны</button><button type="button" data-cap="tri">Треуг.</button>
      </div>
      <button type="button" class="ibtn wide s3d-fix" data-s3="fix" data-only="svg" title="Шум и лишние точки, изломы, почти прямые линии, самопересечения, наложения фигур, обводки → контуры. Сам файл не меняется.">Исправить SVG</button>
      <p class="s3d-note" id="s3dFix" data-only="svg"></p>
      <div class="s3d-stats" id="s3dStats"></div>
      <p class="s3d-q" id="s3dQ"></p>
      <div class="s3d-prog" id="s3dProg" hidden><i><b></b></i><span></span></div>
      <button type="button" class="ibtn pri wide" data-s3="run" data-only="ar">Сделать сетку</button>
      <button type="button" class="ibtn pri wide" data-s3="save">Сохранить в библиотеку</button>
      <div class="s3d-row2"><button type="button" class="ibtn" data-s3="blender">В Blender</button><button type="button" class="ibtn" data-s3="obj">Сохранить OBJ…</button></div>
      <p class="s3d-note">«В Blender» — модель сразу появится в открытом Blender (аддон Oddments 1.2, «Принимать из Oddments»). Квады и n-гоны сохраняются.</p>
    </aside>`;
  document.body.appendChild(el);
  const box = el.querySelector('#s3dSliders');
  box.innerHTML = SLIDERS.map(([k, label, min, max, step, , only]) => `<label class="s3d-row" data-only="${only}"><span>${label}</span><b id="s3v-${k}"></b><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${P[k]}"></label>`).join('');
  // live: recompute in the next frame; moves that come in while a rebuild runs collapse into one more pass
  let dirty = false, live = false;
  const later = () => {
    dirty = true;
    if (live) return;
    live = true;
    requestAnimationFrame(async () => {
      try { while (dirty) { dirty = false; await update(); await new Promise((r2) => requestAnimationFrame(r2)); } }
      finally { live = false; }
    });
  };
  box.addEventListener('input', (e) => {
    const k = e.target.dataset.k; if (!k) return;
    P[k] = +e.target.value; label(k); keep();
    // AutoRemesher: every slider (the shape that goes in, or the remesher's own) re-runs it once the hand rests
    if (P.engine === 'ar') { markStale(); autoRun(); return; }
    later();
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.s3 === 'x') closeSvg3d();
    else if (b.dataset.s3 === 'save') saveToLibrary();
    else if (b.dataset.s3 === 'obj') saveObj();
    else if (b.dataset.s3 === 'blender' && result) import('./toblender.js').then((m) => m.textToBlender(currentText(), outName() + '.obj', outName()));
    else if (b.dataset.s3 === 'run') runRemesh();
    else if (b.dataset.s3 === 'fix') { P.fix = !P.fix; keep(); layout(); loadShapes().then((ok) => { if (ok && P.engine === 'exact') update(); else if (ok) { markStale(); autoRun(); } }); }
    else if (b.dataset.eng) { P.engine = b.dataset.eng; keep(); layout(); if (P.engine === 'exact') update(); else { markStale(); autoRun(); } }
    else if (b.dataset.cap) { P.cap = b.dataset.cap; keep(); layout(); update(); }
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSvg3d(); }
    else if (e.key !== 'Tab') e.stopPropagation(); // grid shortcuts stay off while the layer is open
  });
}

function label(k) { const s = SLIDERS.find((x) => x[0] === k); $('#s3v-' + k).textContent = s[5](P[k]); }

// which controls apply: an SVG shows its shape settings; «Точная» its cap settings; AutoRemesher its own
function layout() {
  const fromSvg = src.kind === 'svg';
  if (!fromSvg) P.engine = 'ar';
  el.querySelectorAll('[data-only]').forEach((x) => {
    const o = x.dataset.only;
    x.hidden = (o === 'svg' && !fromSvg) || (o === 'svgx' && (!fromSvg || P.engine !== 'exact')) || (o === 'exact' && P.engine !== 'exact') || (o === 'ar' && P.engine !== 'ar');
  });
  el.querySelector('.s3d-eng').hidden = !fromSvg || isMac; // no AutoRemesher on macOS: «Точная» only
  if (isMac && P.engine === 'ar') P.engine = 'exact';
  el.querySelectorAll('[data-eng]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.eng === P.engine));
  el.querySelectorAll('[data-cap]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.cap === P.cap));
  el.querySelector('[data-s3="fix"]').setAttribute('aria-pressed', String(P.fix !== false));
  $('#s3dEngNote').textContent = P.engine === 'ar'
    ? (inApp() ? 'Ровный поток квадов по всей поверхности. Форма может чуть скруглиться на острых углах.' : 'AutoRemesher работает в приложении для компьютера; в веб-версии — только «Точная».')
    : 'Сетка строится сразу чистой: квады на стенках и фаске, крышки — квадами, где получается.';
  el.querySelector('[data-s3="run"]').disabled = !inApp();
}

let staleAr = true, autoT = 0, again = false;
// re-run AutoRemesher 0.7 s after the last slider move; a move during a run asks for one more run after it
function autoRun() {
  if (!inApp()) return;
  clearTimeout(autoT);
  autoT = setTimeout(() => { if (busy) again = true; else runRemesh(); }, 700);
}
function markStale() { staleAr = true; status(null, inApp() ? 'Пересчитаю сетку, когда отпустите ползунок…' : 'Нажмите «Сделать сетку», чтобы пересчитать.'); el.querySelector('[data-s3="save"]').disabled = true; el.querySelector('[data-s3="obj"]').disabled = true; }

// seconds keep a tenth (a 0.3 s run read as «0 секунд»); a string passes through as it is
const secs = (v) => (v < 10 ? v.toFixed(1).replace('.', DEC) : String(Math.round(v)));
function status(stats, note, level = 'ok') {
  $('#s3dStats').innerHTML = stats ? stats.map(([n, l]) => `<div><b>${typeof n === 'string' ? n : Math.round(n).toLocaleString('ru')}</b><span>${l}</span></div>`).join('') : '';
  const q = $('#s3dQ');
  q.className = 's3d-q ' + level;
  q.textContent = note || '';
}

/* ---------- the exact mesh (from SVG) ---------- */
async function exactMesh(params) {
  const p = { ...params, step: 2 / params.dens };
  return lib.build(lib.contours(shapes, p.step, p.corner, p.round), p);
}

function describe(mesh) {
  const q = mesh.faces.filter((f) => f.length === 4).length, t = mesh.faces.filter((f) => f.length === 3).length;
  return [[mesh.verts.length, 'вершин'], [q, 'квадов'], [mesh.faces.length - q - t, 'n-гонов'], [t, 'треугольников']];
}

async function update() {
  if (src.kind !== 'svg' || P.engine !== 'exact') return;
  const my = ++token;
  const mesh = await exactMesh(P);
  if (my !== token) return;
  const check = lib.checkMesh(mesh.verts, mesh.faces);
  const notes = [];
  let level = 'ok';
  if (mesh.bevel != null) notes.push(`Фаска уменьшена до ${(mesh.bevel * 50).toFixed(1)}%: шире не помещается в тонких местах`);
  if (P.cap === 'quad') {
    if (mesh.kind === 'grid') notes.unshift('Сетка ровная: только квады');
    else if (mesh.kind === 'split') { notes.unshift('Квады, в середине неравномерно'); level = 'mid'; }
    else { notes.unshift('Часть крышек — чистые n-гоны: форма сложная для квадов'); level = 'mid'; }
  } else notes.unshift(P.cap === 'ngon' ? 'Крышки n-гонами (как в Cinema 4D)' : 'Крышки треугольниками');
  if (!check.ok) { notes.unshift('В сетке ошибки — смените настройки'); level = 'bad'; }
  result = { mesh, ok: check.ok };
  // each note on its own: the dictionary knows the notes, not their «. »-joined combinations
  status(describe(mesh), notes.map(t).join('. '), level);
  await show(lib.toOBJ(mesh, src.name));
  el.querySelector('[data-s3="save"]').disabled = !check.ok;
  el.querySelector('[data-s3="obj"]').disabled = !check.ok;
}

/* ---------- AutoRemesher ---------- */
async function runRemesh() {
  if (busy) return;
  busy = true;
  const run = el.querySelector('[data-s3="run"]');
  run.disabled = true;
  const prog = $('#s3dProg'), bar = prog.querySelector('b'), txt = prog.querySelector('span');
  prog.hidden = false; bar.style.transform = 'scaleX(.02)'; txt.textContent = 'Готовлю модель…';
  const t0 = performance.now();
  try {
    const R = await import('../lib/remesh.js');
    // the source: from an SVG — a dense, plain triangle version of the exact mesh; a model — its own file as OBJ
    let objText;
    if (src.kind === 'svg') objText = lib.toOBJ({ ...(await exactMesh({ ...P, cap: 'tri', dens: Math.max(P.dens, 30), loops: 0 })), uv: null }, src.name); // geometry only for the remesher
    else objText = await modelToObj(src.item);
    const { text, stats } = await R.remesh(objText, { targetQuads: P.quads, sharpEdge: P.sharp, adaptivity: P.adapt, anisotropy: P.aniso, edgeScaling: 1 }, (pct, stage) => {
      bar.style.transform = `scaleX(${Math.max(2, Math.min(100, pct)) / 100})`;
      txt.textContent = (R.STAGES[stage] || 'Строю сетку') + ` · ${pct}%`;
    });
    const mesh = lib.parseOBJ(text);
    const check = lib.checkMesh(mesh.verts, mesh.faces);
    result = { mesh, text, ok: check.ok };
    staleAr = false;
    status([[stats.quads, 'квадов'], [stats.non_quads, 'не квадов'], [stats.vertices, 'вершин'], [secs(stats.seconds || (performance.now() - t0) / 1000), 'секунд']],
      check.ok ? (stats.non_quads ? 'Почти только квады, сетка без ошибок' : 'Только квады, сетка без ошибок')
        : `В сетке ошибки (${check.open + check.degenerate + check.flipped}) — на острых углах AutoRemesher иногда ломает форму.${src.kind === 'svg' ? ' Попробуйте «Точную».' : ' Попробуйте другое число квадов.'}`,
      check.ok ? 'ok' : 'bad');
    await show(text);
    el.querySelector('[data-s3="save"]').disabled = false; // saving a flawed result is allowed, with the warning above
    el.querySelector('[data-s3="obj"]').disabled = false;
    sfx(check.ok ? 'done' : 'error');
  } catch (e) {
    console.warn(e);
    status(null, 'Не получилось: ' + (e && e.message ? e.message : e), 'bad');
    sfx('error');
  } finally {
    busy = false; run.disabled = !inApp();
    prog.hidden = true;
    if (again) { again = false; runRemesh(); }
  }
}

// any model the viewer can open → OBJ text (geometry only, in world space)
async function modelToObj(it) {
  const { loadThree, parseModel, disposeObject } = await import('../lib/model3d.js');
  const T = await loadThree();
  const u8 = await fs.readFile(absPath(it.file));
  const obj = await parseModel(T, it.ext, u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
  const { OBJExporter } = await import('three/examples/jsm/exporters/OBJExporter.js');
  obj.updateMatrixWorld(true);
  const text = new OBJExporter().parse(obj);
  disposeObject(obj);
  return text;
}

/* ---------- preview: the app's own 3D viewer ---------- */
// The viewer shares one canvas across the app, so mounts must not overlap: one runs at a time, the previous
// model is taken down before the next goes up, and slider moves that come in meanwhile collapse to the latest.
let pendingView = null, mounting = false;
async function mountQueued(view) {
  pendingView = view;
  if (mounting) return;
  mounting = true;
  try {
    const holder = $('#s3dView');
    const { mountViewer } = await import('./viewer3d.js');
    while (pendingView) {
      const v = pendingView;
      pendingView = null;
      if (cleanup) { cleanup(); cleanup = null; mountedExt = null; }
      if (!isSvg3dOpen()) break;
      const buf = v.text != null ? new TextEncoder().encode(v.text).buffer : v.buf;
      try {
        const done = await mountViewer(holder, buf, v.ext, () => !isSvg3dOpen(), { infoKey: 's3dInfo' });
        if (!isSvg3dOpen()) { if (done) done(); break; }
        cleanup = done; mountedExt = v.ext;
      } catch (e) {
        console.warn('svg3d preview', e);
        status(null, 'Не удалось показать модель: ' + (e && e.message ? e.message : e), 'bad');
      }
    }
  } finally { mounting = false; }
}
let mountedExt = null;
// a converter model already on screen is swapped in place: no remount, no flash, the camera stays
async function show(objText) {
  if (cleanup && cleanup.swap && mountedExt === 'obj' && !mounting) return cleanup.swap(new TextEncoder().encode(objText).buffer);
  return mountQueued({ text: objText, ext: 'obj' });
}

/* ---------- saving ---------- */
const outName = () => (src.kind === 'svg' ? src.name : `${src.name} — ${t('ремеш')}`);
const currentText = () => (result.text || lib.toOBJ(result.mesh, src.name));

async function saveToLibrary() {
  if (!result) return;
  const blob = new Blob([currentText()], { type: 'model/obj' });
  const ctx = src.item && src.item.folders.length ? { folder: src.item.folders[0] } : null;
  const added = await addFromBlobs([{ blob, name: outName() + '.obj', source: '' }], ctx);
  if (added && added.length) {
    if (src.item) added.forEach((it) => { it.tags = Array.from(new Set([...it.tags, ...src.item.tags])); });
    ui.refresh();
    closeSvg3d();
    showQuickFile(added);
  }
}

async function saveObj() {
  if (!result) return;
  try {
    const f = await saveDialog({ title: 'Сохранить модель для Blender', defaultPath: outName() + '.obj', filters: [{ name: 'Wavefront OBJ', extensions: ['obj'] }] });
    if (!f) return;
    await fs.writeTextFile(f, currentText());
    toast('Модель сохранена');
  } catch (e) { toast('Не удалось сохранить: ' + (e && e.message ? e.message : e)); }
}

// the SVG's shapes, mended first by «Исправить SVG» (lib/svgfix.js) unless it is switched off; what was fixed goes
// under the button. The file itself is not changed.
async function loadShapes() {
  let text = src.text, note = '';
  if (P.fix !== false) {
    try {
      const fx = await import('../lib/svgfix.js');
      const r = fx.fixSvg(src.text);
      const lines = fx.reportLines(r.report);
      text = r.svg;
      note = lines.length ? lines.slice(0, 3).join(' · ') : 'Ошибок в точках нет.';
    } catch (e) { note = `Не исправился (${(e && e.message) || e}) — взят как есть.`; }
  }
  const r = lib.parseSvg(text);
  if (!r.shapes.length) { toast(r.strokesOnly ? 'В этом SVG только обводки. Включите «Исправить SVG» — обводки станут контурами.' : 'В SVG не нашлось залитых фигур.'); return false; }
  shapes = r.shapes;
  if (el) $('#s3dFix').textContent = note;
  return true;
}

/* ---------- open / close ---------- */
// source: { kind: 'svg', text, name, item? } or { kind: 'model', item }
export async function openSvg3d(source) {
  markStep('3d');
  // «Ремеш…» from an open model: the preview goes first, at once — it holds the app's one 3D context, and this layer opens
  // under it: the model went dark there and the screen looked black
  const pv = await import('./preview.js');
  if (pv.isPreviewOpen()) pv.closePreview(true);
  if (!el) build();
  lib = await import('../lib/svg3d.js');
  src = source.kind === 'model' ? { ...source, name: source.item.name } : source;
  result = null; staleAr = true;
  if ($('#s3dView')) $('#s3dView').__view = null; // a new source starts from the default angle
  if (src.kind === 'svg' && !(await loadShapes())) return;
  $('#s3dT').textContent = src.kind === 'svg' ? 'SVG в 3D' : 'Ремеш модели';
  $('#s3dSrc').textContent = src.name;
  SLIDERS.forEach(([k]) => { el.querySelector(`[data-k="${k}"]`).value = P[k]; label(k); });
  el.hidden = false;
  document.body.classList.add('s3d-on');
  pushLayer({ el, title: '3D-мастерская', close: closeSvg3d });
  sfx('orbit');
  layout();
  if (src.kind === 'svg' && P.engine === 'exact') await update();
  else {
    markStale();
    if (src.kind === 'model') await showModel(src.item);
    else await update().then(() => markStale());
  }
  el.querySelector('.s3d-panel').focus({ preventScroll: true });
}

async function showModel(it) {
  const u8 = await fs.readFile(absPath(it.file));
  return mountQueued({ buf: u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength), ext: it.ext });
}

export function closeSvg3d() {
  if (!isSvg3dOpen() || busy) return;
  sfx('close');
  el.hidden = true;
  document.body.classList.remove('s3d-on');
  popLayer(el);
  pendingView = null;
  if (cleanup) { cleanup(); cleanup = null; mountedExt = null; }
  $('#s3dView').innerHTML = '';
  document.getElementById('grid').focus({ preventScroll: true });
}

// «SVG в 3D» from the sidebar: the selected SVG opens at once; otherwise a picker with every SVG in the
// library (search by name and tag) and «С компьютера…» for a file that is not in the library yet.
export async function pickSvgFor3d() {
  // the same button shows and hides the picker
  if (isPickerOpen()) { hidePicker(); return; }
  const sel = Array.from(S.sel).map((id) => S.byId.get(id)).filter(Boolean);
  if (sel.length === 1 && sel[0].ext === 'svg') return openFromItem(sel[0]);
  showPicker();
}

let picker = null;
const TRIGGERS = '.nav[data-vt="tool-svg3d"], #addMore';
function showPicker() {
  if (!picker) {
    picker = document.createElement('div');
    picker.className = 's3pick glass';
    picker.setAttribute('role', 'dialog');
    picker.setAttribute('aria-label', 'SVG в 3D: выберите иконку');
    picker.innerHTML = `<div class="s3p-h"><h2>SVG в 3D</h2><button type="button" class="ib" data-p="x" aria-label="Закрыть">${ic('x')}</button></div>
      <input class="s3p-q" type="search" placeholder="Найти SVG по названию или тегу" aria-label="Поиск SVG">
      <div class="s3p-grid" role="listbox" aria-label="SVG из библиотеки"></div>
      <button type="button" class="ibtn wide" data-p="disk">${ic('folder')}С компьютера…</button>`;
    document.body.appendChild(picker);
    const q = picker.querySelector('.s3p-q');
    q.addEventListener('input', () => fillPicker(q.value));
    picker.addEventListener('click', (e) => {
      const b = e.target.closest('[data-p], [data-sid]');
      if (!b) return;
      if (b.dataset.p === 'x') hidePicker();
      else if (b.dataset.p === 'disk') { hidePicker(); fromDisk(); }
      else { const it = S.byId.get(b.dataset.sid); hidePicker(); if (it) openFromItem(it); }
    });
    picker.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hidePicker(); return; }
      const tiles = Array.from(picker.querySelectorAll('[data-sid]'));
      const i = tiles.indexOf(document.activeElement);
      const cols = 4;
      const go = (j) => { if (tiles[j]) tiles[j].focus(); };
      if (e.key === 'ArrowDown' && document.activeElement === q) { e.preventDefault(); go(0); }
      else if (i >= 0 && ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        if (e.key === 'ArrowUp' && i < cols) q.focus();
        else go(i + { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key]);
      }
      e.stopPropagation(); // the grid underneath keeps its keys
    });
    // a click elsewhere closes it, except on the buttons that open it: those toggle it themselves (closing here
    // first made a second click reopen the picker instead of hiding it)
    document.addEventListener('pointerdown', (e) => { if (isPickerOpen() && !picker.contains(e.target) && !e.target.closest(TRIGGERS)) hidePicker(); }, true);
  }
  delete picker.dataset.closing; picker.getAnimations().forEach((a) => a.cancel());
  picker.hidden = false;
  const q = picker.querySelector('.s3p-q');
  q.value = '';
  fillPicker('');
  sfx('open');
  requestAnimationFrame(() => { const first = picker.querySelector('[data-sid]'); (first || q).focus(); });
}
// it leaves the way it came: a short fade and drop, hidden once that is over (the same toggle sees it closed
// at once, so a quick second click reopens it cleanly)
const isPickerOpen = () => picker && !picker.hidden && !picker.dataset.closing;
function hidePicker() {
  if (!isPickerOpen()) return;
  sfx('close');
  if (!motionOn()) { picker.hidden = true; return; }
  picker.dataset.closing = '1';
  picker.animate([{ opacity: 1, scale: '1', translate: '-50% -50%' }, { opacity: 0, scale: '.97', translate: '-50% calc(-50% + 8px)' }],
    { duration: 190, easing: 'cubic-bezier(.4, 0, 1, 1)' }).onfinish = () => { if (picker.dataset.closing) { picker.hidden = true; delete picker.dataset.closing; } };
}
function fillPicker(query) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const all = S.items.filter((i) => i.ext === 'svg' && !i.trashed);
  const list = all.filter((i) => words.every((w) => (i.name + ' ' + i.tags.join(' ')).toLowerCase().includes(w)));
  const grid = picker.querySelector('.s3p-grid');
  grid.innerHTML = list.length
    ? list.map((it) => `<button type="button" role="option" class="s3p-t" data-sid="${esc(it.id)}" title="${esc(it.name)}"><span class="s3p-img"><img src="${assetUrl(it.thumb || it.file)}" alt="" draggable="false"></span><span class="s3p-n">${esc(it.name)}</span></button>`).join('')
    : `<p class="s3p-empty">${all.length ? 'Ничего не нашлось.' : 'В библиотеке пока нет SVG. Добавьте их как обычно — Ctrl+V или перетаскиванием — или выберите файл с компьютера.'}</p>`;
}

async function fromDisk() {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const r = await open({ multiple: false, title: t('SVG для 3D'), filters: [{ name: 'SVG', extensions: ['svg'] }] });
    const p = Array.isArray(r) ? r[0] : r;
    if (!p) return;
    const text = await fs.readTextFile(p);
    return openSvg3d({ kind: 'svg', text, name: p.split(/[\\/]/).pop().replace(/\.svg$/i, '') });
  } catch (e) { toast('Не удалось открыть SVG: ' + (e && e.message ? e.message : e)); }
}

// «Ремеш» from the sidebar: the selected model; without one, the models view and a hint
export async function remeshSelected() {
  const sel = Array.from(S.sel).map((id) => S.byId.get(id)).filter(Boolean);
  const ok = (i) => i.kind === 'model' && !['blend', 'abc'].includes(i.ext) && !isSplatItem(i);
  if (sel.length === 1 && ok(sel[0])) return openFromItem(sel[0]);
  // no model selected: pick one here, as «Сплат из модели» does (audit 29.10)
  (await import('./pick.js')).pickItem({ title: 'Ремеш', filter: ok, run: openFromItem, empty: 'Моделей в библиотеке пока нет: перетащите GLB, OBJ, FBX или STL в окно.' });
}

// helpers for the entry points
export const isSvgItem = (it) => it && it.ext === 'svg';
export async function openFromItem(it) {
  if (it.kind === 'model') return openSvg3d({ kind: 'model', item: it });
  const text = await fs.readTextFile(absPath(it.file));
  return openSvg3d({ kind: 'svg', text, name: it.name, item: it });
}
