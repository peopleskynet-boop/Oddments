// Icon constructor (Oddments › «Добавить › Конструктор иконок…», the palette, «Открыть в конструкторе» on an SVG).
// A Figma-like editor for interface icons: layers on the left, design on the right, a floating toolbar,
// a dark canvas with the 24 px artboard. Shapes are drawn by dragging (R rectangle, O ellipse, C capsule, rhombus,
// triangle, modifiers), selected with small screen-sized handles, a size label, rotation at the corners, Shift-click
// and marquee for several; smart guides snap to the centre, the keylines, the margins and other shapes. The geometry,
// the rules check and every size in Fill and Outline come from ../lib/iconkit.js; AI variants from ../lib/iconai.js.
import './iconkit.css';
import { pushLayer, popLayer } from './layers.js';
import { $, esc } from '../util.js';
import { ic } from './icons.js';
import { toast } from './dialogs.js';
import { sfx } from './sound.js';
import { S, ui } from '../state.js';
import * as R from '../lib/iconrules.js';
import { pixGrid, pixLoader, elapsed } from './pixload.js';

let K = null; // ../lib/iconkit.js, loaded with the constructor
let el = null, svg = null, world = null, over = null;
const STORE = 'perch.iconkit';
const blank = () => ({ name: '', keys: '', shapes: [], style: 'outline', keylines: true });
let doc = blank(), sel = new Set(), hover = null, tool = 'move', hist = [], fut = [];
const cam = { z: 20, x: 0, y: 0 }; // screen px per grid unit, screen position of the artboard's origin
// point editing (Enter / double-click on a shape): { id, cs: contours, pts: Set of 'ci:si' } — see contoursOf
let edit = null;
const lastPt = { key: null, at: 0 }, lastShape = { id: null, at: 0 };
const load = () => { try { doc = { ...blank(), ...JSON.parse(localStorage.getItem(STORE) || '{}') }; } catch (e) { doc = blank(); } };
const keep = () => { try { localStorage.setItem(STORE, JSON.stringify(doc)); } catch (e) { /* private mode */ } };
const half = (v) => Math.round(v * 2) / 2;
const uid = () => Math.random().toString(36).slice(2, 9);
const byId = (id) => doc.shapes.find((s) => s.id === id);
const selected = () => doc.shapes.filter((s) => sel.has(s.id));
const one = () => (sel.size === 1 ? byId([...sel][0]) : null);
// groups (Ctrl+G, as in Figma): shapes sharing `g` are picked and moved together; the order of add / cut stays theirs
const groupOf = (id) => { const s = byId(id); return s && s.g ? doc.shapes.filter((x) => x.g === s.g).map((x) => x.id) : [id]; };
const withGroups = (ids) => new Set([...ids].flatMap(groupOf));

const SHAPES = ['squircle', 'circle', 'capsule', 'rhombus', 'triangle'], MODS = ['plus', 'minus', 'check', 'slash', 'dot'];
const TOOL_ICON = { squircle: 'tRect', circle: 'tCircle', capsule: 'tPill', rhombus: 'tDiamond', triangle: 'tTriangle', plus: 'plus', minus: 'minus', check: 'check', slash: 'tSlash', dot: 'tDot', path: 'edit' };
const TOOL_KEY = { squircle: 'R', circle: 'O', capsule: 'C' };
const SIZE_DEF = { plus: [7, 7], minus: [7, 0], check: [8, 6], slash: [18, 18], dot: [6, 6] };

function commit() {
  hist.push(JSON.stringify(doc.shapes));
  if (hist.length > 100) hist.shift();
  fut = [];
}
function undo() { edit = null; if (!hist.length) return; fut.push(JSON.stringify(doc.shapes)); doc.shapes = JSON.parse(hist.pop()); sel.clear(); keep(); draw(); }
function redo() { edit = null; if (!fut.length) return; hist.push(JSON.stringify(doc.shapes)); doc.shapes = JSON.parse(fut.pop()); sel.clear(); keep(); draw(); }

/* ---------- open / close ---------- */
export async function openIconKit(fromItem) {
  K = K || await import('../lib/iconkit.js');
  if (!el) build();
  drawModel();
  load();
  hist = []; fut = []; sel.clear(); tool = 'move';
  if (fromItem) await useSvgItem(fromItem);
  el.hidden = false;
  document.body.classList.add('s3d-on', 'ik-on');
  pushLayer({ el, title: 'Конструктор иконок', close: closeIconKit, onKey });
  sfx('orbit');
  requestAnimationFrame(() => { fit(); draw(); });
}
export const isIconKitOpen = () => !!(el && !el.hidden);
export function closeIconKit() {
  if (!isIconKitOpen()) return;
  sfx('close');
  el.hidden = true;
  document.body.classList.remove('s3d-on', 'ik-on');
  popLayer(el);
  document.getElementById('grid').focus({ preventScroll: true });
}

// an SVG of the library: stylized into the library's look (K.stylize) — the silhouette, lines of the size's thickness,
// fitted into the keyline that suits it, soft corners
async function useSvgItem(it) {
  try {
    const fs = await import('@tauri-apps/plugin-fs');
    const { absPath } = await import('../lib/library.js');
    stylizeText(new TextDecoder().decode(await fs.readFile(absPath(it.file))), it.name);
  } catch (e) { toast('Не удалось открыть SVG: ' + (e.message || e)); }
}
function stylizeText(text, name) {
  const r = K.stylize(text);
  if (!r.shapes.length) { toast('В этом SVG не нашлось фигур'); return false; }
  if (doc.shapes.length) commit();
  const fixed = K.fixToRules(r.shapes);
  doc = { ...blank(), name: String(name || '').replace(/\.svg$/i, '').replace(/[^A-Za-z0-9 ]+/g, ' ').trim(), shapes: fixed.shapes };
  sel.clear(); edit = null;
  keep(); if (el && !el.hidden) { fit(); draw(); }
  toast(r.note + (fixed.done.length ? ' · ' + fixed.done.join(', ') : ''), 5000);
  sfx('done');
  return true;
}
// «Стилизовать SVG…»: a file from the disk (the browser's file picker works in the app too)
function pickSvgToStylize() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.svg,image/svg+xml'; inp.multiple = true;
  // one file opens here to look at and adjust; several are a pack — stylized and saved straight away
  inp.onchange = async () => {
    const fs = [...(inp.files || [])];
    if (fs.length === 1) stylizeText(await fs[0].text(), fs[0].name);
    else if (fs.length > 1) stylizePack(fs);
  };
  inp.click();
}
// «Привести к правилам»: grid, margins, optical centre (K.fixToRules); the rest stays in the check
function fixRules() {
  const r = K.fixToRules(doc.shapes);
  if (!r.done.length) { toast('Уже по правилам: сетка, поля и центр в порядке', 2200); return; }
  commit(); doc.shapes = r.shapes; keep(); draw();
  toast('Поправлено: ' + r.done.join(', '), 4000);
}

/* ---------- layout ---------- */
function build() {
  el = document.createElement('section');
  el.className = 'ik';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Конструктор иконок');
  const tb = (t) => `<button type="button" class="ik-tool" data-tool="${t}" title="${esc(K.TYPES[t])}${TOOL_KEY[t] ? ' (' + TOOL_KEY[t] + ')' : ''}" aria-label="${esc(K.TYPES[t])}">${ic(TOOL_ICON[t])}</button>`;
  el.innerHTML = `<div class="ik-stage" id="ikStage"><svg id="ikSvg" aria-label="Холст"><g id="ikWorld"></g><g id="ikOver"></g></svg>
      <div id="ikEditNote" class="ik-editnote glass" role="status" hidden>Правка точек · клик по контуру — новая точка · двойной клик по точке — угол / плавно · Alt — ручки отдельно · Enter — готово</div>
      <div class="ik-zoom glass"><button type="button" data-ik="zout" aria-label="Мельче">${ic('minus')}</button><button type="button" data-ik="fit" id="ikZ" title="Вписать (Shift+1)">100%</button><button type="button" data-ik="zin" aria-label="Крупнее">${ic('plus')}</button></div></div>
    <div class="ik-top glass" role="toolbar" aria-label="Инструменты">
      <button type="button" class="ik-tool" data-tool="move" title="Выбор (V)" aria-label="Выбор">${ic('tCursor')}</button>
      <i class="ik-sep"></i>${SHAPES.map(tb).join('')}<i class="ik-sep"></i>${MODS.map(tb).join('')}<i class="ik-sep"></i>
      <div class="ik-seg" role="group" aria-label="Стиль"><button type="button" data-style="outline">Контур</button><button type="button" data-style="fill">Заливка</button></div>
      <button type="button" class="ik-tool" data-ik="keylines" title="Опорные фигуры и сетка" aria-label="Опорные фигуры">${ic('grid')}</button>
      <i class="ik-sep"></i>
      <button type="button" class="ik-tool" data-ik="undo" title="Отменить (Ctrl+Z)" aria-label="Отменить">${ic('undo')}</button>
      <button type="button" class="ik-tool" data-ik="redo" title="Вернуть (Ctrl+Shift+Z)" aria-label="Вернуть">${ic('redo')}</button>
      <button type="button" class="ik-tool" data-ik="x" title="Закрыть (Esc)" aria-label="Закрыть">${ic('x')}</button>
    </div>
    <aside class="ik-left glass" aria-label="Слои">
      <div class="ik-sty">
        <span class="ik-h">Из любой иконки</span>
        <button type="button" class="ibtn wide pri" data-ik="stylize" title="SVG из Material, Lucide, стока или Figma — в стиле библиотеки: силуэт, контур нужной толщины, мягкие углы, все размеры">Стилизовать SVG…</button>
        <small class="ik-note">или перетащите SVG на холст · несколько — пачкой сразу в библиотеку</small>
      </div>
      <div class="ik-ai">
        <span class="ik-h">ИИ: опишите иконку</span>
        <div class="ik-ask"><input id="ikAsk" type="text" placeholder="умная лампа с Wi-Fi" autocomplete="off"><button type="button" data-ik="gen" title="Сгенерировать варианты (Enter)" aria-label="Сгенерировать">${ic('sparkle')}</button></div>
        <div class="ik-ask-foot"><button type="button" class="ik-model" data-ik="model" aria-haspopup="menu" aria-expanded="false" title="Модель"></button><span>Enter — 3 варианта</span></div>
        <div class="ik-like ik-words" id="ikWords" hidden><span class="ik-h">Уже есть в библиотеке</span><div class="ik-like-g"></div></div>
        <div class="ik-trace" id="ikTrace" hidden></div>
        <div class="ik-vars" id="ikVars"></div>
      </div>
      <span class="ik-h">Слои</span>
      <div class="ik-layers" id="ikLayers"></div>
      <div class="ik-like" id="ikLike" hidden><span class="ik-h">Похожие в библиотеке</span><div class="ik-like-g"></div></div>
    </aside>
    <aside class="ik-right glass" aria-label="Свойства" id="ikRight"></aside>`;
  document.body.appendChild(el);
  $('#ikStage').appendChild(el.querySelector('.ik-top')); // the toolbar floats over the canvas, between the panels
  svg = $('#ikSvg'); world = $('#ikWorld'); over = $('#ikOver');
  el.addEventListener('click', onClick);
  el.addEventListener('input', onInput);
  el.addEventListener('change', (e) => { if (e.target.dataset.k) { keep(); draw(); } });
  $('#ikAsk').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); gen(el.querySelector('[data-ik="gen"]')); } });
  $('#ikAsk').addEventListener('input', wordsSoon);
  el.addEventListener('keydown', onKey, true); // keys outside the layer (focus on the page body) come through layers.js
  document.addEventListener('keyup', (e) => { if (e.code === 'Space') { spaceDown = false; svg.classList.remove('pan'); } }, true);
  bindCanvas();
  // an SVG dropped on the canvas: stylized (the app's own drop handling stays off while the constructor is open)
  $('#ikStage').addEventListener('dragover', (e) => { if ([...(e.dataTransfer.items || [])].some((i) => i.kind === 'file')) { e.preventDefault(); e.stopPropagation(); } });
  $('#ikStage').addEventListener('drop', async (e) => {
    const fs = [...(e.dataTransfer.files || [])].filter((x) => /\.svg$/i.test(x.name) || x.type === 'image/svg+xml');
    if (!fs.length) return;
    e.preventDefault(); e.stopPropagation();
    if (fs.length === 1) stylizeText(await fs[0].text(), fs[0].name); else stylizePack(fs);
  });
  bindLayers();
  new ResizeObserver(() => { if (isIconKitOpen()) drawCanvas(); }).observe($('#ikStage'));
}

/* ---------- camera ---------- */
function fit() {
  const r = $('#ikStage').getBoundingClientRect();
  cam.z = Math.max(4, Math.floor(Math.min(r.width - 120, r.height - 160) / 26));
  cam.x = Math.round(r.width / 2 - 12 * cam.z);
  cam.y = Math.round(r.height / 2 - 12 * cam.z + 10);
}
// Shift+2: the selection fills the view
function fitTo(b) {
  const r = $('#ikStage').getBoundingClientRect();
  cam.z = Math.min(120, Math.max(1, Math.min((r.width - 160) / Math.max(b.w, 1), (r.height - 200) / Math.max(b.h, 1))));
  cam.x = r.width / 2 - (b.x + b.w / 2) * cam.z;
  cam.y = r.height / 2 - (b.y + b.h / 2) * cam.z + 10;
}
// Shift+0: the 100 % of the zoom label (cam.z 20), about the middle of the view
function zoomTo(z) {
  const r = $('#ikStage').getBoundingClientRect();
  zoomAt(z / cam.z, r.width / 2, r.height / 2);
}
function zoomAt(f, sx, sy) {
  const z = Math.min(120, Math.max(1, cam.z * f));
  const wx = (sx - cam.x) / cam.z, wy = (sy - cam.y) / cam.z;
  cam.z = z; cam.x = sx - wx * z; cam.y = sy - wy * z;
  drawCanvas();
}
const toScreen = (wx, wy) => [cam.x + wx * cam.z, cam.y + wy * cam.z];

/* ---------- drawing ---------- */
function draw() {
  if (!el || el.hidden) return;
  el.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(tool === b.dataset.tool)));
  el.querySelectorAll('[data-style]').forEach((b) => b.setAttribute('aria-pressed', String(doc.style === b.dataset.style)));
  el.querySelector('[data-ik="keylines"]').setAttribute('aria-pressed', String(doc.keylines));
  drawCanvas();
  drawLayers();
  drawRight();
  likeSoon();
}

// «Похожие в библиотеке» (lib/iconlike.js): the library's SVG icons with this silhouette, refreshed when the drawing
// rests; a click opens one here (Ctrl+Z returns the current icon)
let likeT = 0, likeKey = '', likeItems = [];
function likeSoon() {
  clearTimeout(likeT);
  likeT = setTimeout(async () => {
    const box = $('#ikLike');
    if (!box || !el || el.hidden) return;
    const shapes = visible();
    const key = JSON.stringify(shapes);
    if (key === likeKey) return;
    likeKey = key;
    if (!shapes.length) { box.hidden = true; return; }
    const { similarIcons } = await import('../lib/iconlike.js');
    const list = await similarIcons(K.build(shapes, 24).fill);
    if (key !== likeKey) return; // the drawing changed meanwhile
    likeItems = list.map((x) => x.it);
    box.hidden = !list.length;
    const { assetUrl } = await import('../lib/library.js');
    box.querySelector('.ik-like-g').innerHTML = list.map((x, i) => `<button type="button" class="ik-like-c" data-like="${i}" title="${esc(x.it.name.split(' — ')[0])} · похожа на ${Math.round(x.score * 100)} % · клик — открыть здесь (Ctrl+Z вернёт вашу)"><img src="${assetUrl(x.it.thumb)}" alt=""><span>${esc(x.it.name.split(' — ')[0])}</span></button>`).join('');
  }, 700);
}

// «Уже есть в библиотеке» under the description: icons the library has for these words (lib/iconlike.js
// iconsByWords) — a base to open instead of drawing anew; no API key needed, the local AI adds matches by meaning
let wordsT = 0, wordsItems = [];
function wordsSoon() {
  clearTimeout(wordsT);
  wordsT = setTimeout(async () => {
    const box = $('#ikWords');
    if (!box) return;
    const ask = $('#ikAsk').value.trim();
    const { iconsByWords } = await import('../lib/iconlike.js');
    let meaning = null;
    try { const ai = await import('../lib/ai.js'); if (ai.aiReady()) meaning = await ai.scoreText(ask); } catch (e) { meaning = null; }
    if ($('#ikAsk').value.trim() !== ask) return; // typed on meanwhile
    const list = ask ? iconsByWords(ask, { meaning }) : [];
    wordsItems = list.map((x) => x.it);
    box.hidden = !list.length;
    const { assetUrl } = await import('../lib/library.js');
    box.querySelector('.ik-like-g').innerHTML = list.map((x, i) => `<button type="button" class="ik-like-c" data-word="${i}" title="${esc(x.it.name.split(' — ')[0])} · ${x.why === 'words' ? 'по словам' : 'по смыслу'} · клик — открыть здесь как основу (Ctrl+Z вернёт вашу)"><img src="${assetUrl(x.it.thumb)}" alt=""><span>${esc(x.it.name.split(' — ')[0])}</span></button>`).join('');
  }, 350);
}

let guides = []; // [{ axis: 'x'|'y', v }] shown while dragging
function drawCanvas() {
  if (!svg) return;
  $('#ikZ').textContent = Math.round((cam.z / 20) * 100) + '%';
  const r = K.build(doc.shapes, K.BASE);
  const lw = 1 / cam.z; // one screen pixel in grid units
  let h = `<g transform="translate(${cam.x} ${cam.y}) scale(${cam.z})">`;
  h += `<rect x="0" y="0" width="24" height="24" class="ik-board"/>`;
  if (doc.keylines) {
    if (cam.z >= 10) for (let i = 1; i < 24; i++) h += `<path d="M${i} 0V24M0 ${i}H24" class="ik-px" stroke-width="${lw}"/>`;
    h += '<path d="M0 0H24V24H0Z M2 2V22H22V2Z" class="ik-margin" fill-rule="evenodd"/>';
    const k = K.KEYLINES;
    h += `<g class="ik-key" stroke-width="${lw}"><rect x="${k.square.x}" y="${k.square.y}" width="${k.square.w}" height="${k.square.h}" rx="6"/><rect x="${k.vertical.x}" y="${k.vertical.y}" width="${k.vertical.w}" height="${k.vertical.h}" rx="5"/><rect x="${k.horizontal.x}" y="${k.horizontal.y}" width="${k.horizontal.w}" height="${k.horizontal.h}" rx="5"/><circle cx="12" cy="12" r="10"/><path d="M0 0L24 24M24 0L0 24M12 0V24M0 12H24"/></g>`;
  }
  const d = doc.style === 'fill' ? r.fill : r.outline;
  if (d) h += `<path d="${d}" class="ik-ink" fill-rule="evenodd"/>`;
  if (showArea) h += `<path d="${showArea}" class="ik-bad-area" stroke-width="${2 / cam.z}"/>`; // «Показать» of a failed check
  // hit areas: each shape's own box, transparent, under the overlay
  for (const s of doc.shapes) if (!s.hidden) h += `<rect data-sid="${s.id}" x="${s.x}" y="${s.y}" width="${Math.max(s.w, 0.5)}" height="${Math.max(s.h, 0.5)}" class="ik-hit" transform="rotate(${s.rot || 0} ${s.x + s.w / 2} ${s.y + s.h / 2})"/>`;
  h += '</g>';
  world.innerHTML = h;
  drawOverlay();
}

// the overlay lives in screen pixels: hover and selection outlines, small handles, the size label, guides, marquee
function drawOverlay() {
  if (edit) { drawEdit(); return; }
  let h = '';
  const outline = (s, cls) => {
    const c = corners(s).map((p) => toScreen(p[0], p[1]));
    return `<polygon points="${c.map((p) => p.join(',')).join(' ')}" class="${cls}"/>`;
  };
  const hs = byId(hover);
  if (hs && !sel.has(hover)) h += outline(hs, 'ik-hov');
  for (const s of selected()) h += outline(s, 'ik-selo');
  const s1 = one(), list = selected();
  if (list.length) {
    let box;
    if (s1) {
      const c = corners(s1).map((p) => toScreen(p[0], p[1]));
      if (s1.rot) h += `<polygon points="${c.map((p) => p.join(',')).join(' ')}" class="ik-sel"/>`;
      else { const [x1, y1] = c[0], [x2, y2] = c[2]; h += `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" class="ik-sel"/>`; }
      // eight handles at the (rotated) box
      handlePoints(s1).forEach(([px, py, k]) => { const [sx, sy] = toScreen(px, py); h += `<rect data-handle="${k}" x="${sx - 4}" y="${sy - 4}" width="8" height="8" class="ik-hd"/>`; });
      box = bboxOf([s1]);
    } else {
      box = bboxOf(list);
      const [x1, y1] = toScreen(box.x, box.y), [x2, y2] = toScreen(box.x + box.w, box.y + box.h);
      h += `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" class="ik-sel"/>`;
    }
    // the size label under the selection
    const [lx, ly] = toScreen(box.x + box.w / 2, box.y + box.h);
    const txt = s1 ? `${fmt(s1.w)} × ${fmt(s1.h)}${s1.rot ? ` · ${s1.rot}°` : ''}` : `${fmt(box.w)} × ${fmt(box.h)}`;
    const tw = txt.length * 6.4 + 12;
    h += `<g class="ik-size"><rect x="${lx - tw / 2}" y="${ly + 8}" width="${tw}" height="18" rx="4"/><text x="${lx}" y="${ly + 21}">${txt}</text></g>`;
  }
  for (const g of guides) {
    if (g.axis === 'x') { const [x] = toScreen(g.v, 0), [, y1] = toScreen(0, -1), [, y2] = toScreen(0, 25); h += `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" class="ik-guide"/>`; }
    else { const [, y] = toScreen(0, g.v), [x1] = toScreen(-1, 0), [x2] = toScreen(25, 0); h += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" class="ik-guide"/>`; }
  }
  if (marquee) { const x = Math.min(marquee.x0, marquee.x1), y = Math.min(marquee.y0, marquee.y1); h += `<rect x="${x}" y="${y}" width="${Math.abs(marquee.x1 - marquee.x0)}" height="${Math.abs(marquee.y1 - marquee.y0)}" class="ik-marq"/>`; }
  over.innerHTML = h;
}
// point editing: the outline, its points (white squares, blue when chosen), the chosen points' handles
function drawEdit() {
  const P = (x, y) => toScreen(x, y).map((v) => +v.toFixed(2)).join(' ');
  let d = '';
  for (const c of edit.cs) {
    if (c.length < 2) continue;
    d += `M${P(...c[0].p)}`;
    for (let i = 1; i <= c.length; i++) {
      const a = c[i - 1], b = c[i % c.length];
      d += `C${P(a.p[0] + a.o[0], a.p[1] + a.o[1])} ${P(b.p[0] + b.i[0], b.p[1] + b.i[1])} ${P(...b.p)}`;
    }
    d += 'Z';
  }
  let h = `<path d="${d}" class="ik-epath"/>`;
  edit.cs.forEach((c, ci) => c.forEach((q, si) => {
    const key = ci + ':' + si;
    if (!edit.pts.has(key)) return;
    const [ax, ay] = toScreen(...q.p);
    for (const k of ['i', 'o']) {
      if (Math.hypot(...q[k]) < 1e-6) continue;
      const [hx, hy] = toScreen(q.p[0] + q[k][0], q.p[1] + q[k][1]);
      h += `<line x1="${ax}" y1="${ay}" x2="${hx}" y2="${hy}" class="ik-hl"/><circle data-hp="${key}:${k}" cx="${hx}" cy="${hy}" r="4" class="ik-hp"/>`;
    }
  }));
  edit.cs.forEach((c, ci) => c.forEach((q, si) => {
    const [x, y] = toScreen(...q.p), key = ci + ':' + si;
    h += `<rect data-pt="${key}" x="${x - 3.5}" y="${y - 3.5}" width="7" height="7" class="ik-pt${edit.pts.has(key) ? ' on' : ''}"/>`;
  }));
  for (const g of guides) {
    if (g.axis === 'x') { const [x] = toScreen(g.v, 0), [, y1] = toScreen(0, -1), [, y2] = toScreen(0, 25); h += `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" class="ik-guide"/>`; }
    else { const [, y] = toScreen(0, g.v), [x1] = toScreen(-1, 0), [x2] = toScreen(25, 0); h += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" class="ik-guide"/>`; }
  }
  if (marquee) { const x = Math.min(marquee.x0, marquee.x1), y = Math.min(marquee.y0, marquee.y1); h += `<rect x="${x}" y="${y}" width="${Math.abs(marquee.x1 - marquee.x0)}" height="${Math.abs(marquee.y1 - marquee.y0)}" class="ik-marq"/>`; }
  over.innerHTML = h;
  const note = $('#ikEditNote');
  if (note) note.hidden = false;
  // the panel follows which points are chosen (not every redraw: typing X / Y would lose its field)
  const key = [...edit.pts].sort().join(',') + '|' + edit.cs.map((c) => c.length).join(',');
  if (key !== edit.panelKey) { edit.panelKey = key; drawRight(); }
}
function enterEdit(s) {
  if (!s || MODS.includes(s.type)) return;
  commit();
  const cs = K.contoursOf(s);
  Object.assign(s, K.pathShape(s, cs));
  edit = { id: s.id, cs: K.contoursOf(s), pts: new Set() };
  sel = new Set([s.id]); tool = 'move';
  keep(); draw();
}
function exitEdit() {
  edit = null;
  const note = $('#ikEditNote');
  if (note) note.hidden = true;
  keep(); draw();
}
// the edited contours back into the shape (its box follows the points)
function applyEdit(redraw = true) {
  const s = byId(edit.id);
  if (!s) { edit = null; return; }
  Object.assign(s, K.pathShape(s, edit.cs));
  if (redraw) drawCanvas();
}
const ptOf = (key) => { const [ci, si] = key.split(':').map(Number); return edit.cs[ci] && edit.cs[ci][si]; };
function deletePoints() {
  if (!edit.pts.size) return;
  commit();
  const drop = new Set(edit.pts);
  edit.cs = edit.cs.map((c, ci) => c.filter((_, si) => !drop.has(ci + ':' + si))).filter((c) => c.length >= 3);
  edit.pts.clear();
  if (!edit.cs.length) { const id = edit.id; edit = null; doc.shapes = doc.shapes.filter((x) => x.id !== id); sel.clear(); keep(); draw(); return; }
  applyEdit(); keep(); draw();
}
function nudgePoints(dx, dy) {
  if (!edit.pts.size) return;
  commit();
  for (const k of edit.pts) { const q = ptOf(k); q.p = [q.p[0] + dx, q.p[1] + dy]; }
  applyEdit(); keep(); draw();
}

const fmt = (n) => String(+(+n).toFixed(2)).replace('.', ',');
function corners(s) {
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2, a = ((s.rot || 0) * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => { const dx = (u * s.w) / 2, dy = (v * Math.max(s.h, 0)) / 2; return [cx + dx * co - dy * si, cy + dx * si + dy * co]; });
}
function handlePoints(s) {
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2, a = ((s.rot || 0) * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
  return [[-1, -1, 'nw'], [0, -1, 'n'], [1, -1, 'ne'], [1, 0, 'e'], [1, 1, 'se'], [0, 1, 's'], [-1, 1, 'sw'], [-1, 0, 'w']]
    .map(([u, v, k]) => { const dx = (u * s.w) / 2, dy = (v * s.h) / 2; return [cx + dx * co - dy * si, cy + dx * si + dy * co, k]; });
}
function bboxOf(list) {
  const pts = list.flatMap(corners);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

const layerName = (s, i) => s.name || `${K.TYPES[s.type] || s.type} ${i + 1}`;
function drawLayers() {
  const box = $('#ikLayers');
  if (!doc.shapes.length) { box.innerHTML = '<p class="ik-empty">Пусто. Выберите фигуру сверху (R — прямоугольник, O — эллипс) и протяните на холсте.</p>'; return; }
  // Figma order: the topmost first
  box.innerHTML = doc.shapes.map((s, i) => [s, i]).reverse().map(([s, i]) => `<div class="ik-layer${sel.has(s.id) ? ' on' : ''}${s.hidden ? ' off' : ''}" data-pick="${s.id}" draggable="true">
      <span class="ik-li">${ic(TOOL_ICON[s.type] || 'square')}</span><span class="ik-ln">${esc(layerName(s, i))}</span>${s.g ? '<i class="ik-grp" title="В группе (Ctrl+Shift+G — разобрать)"></i>' : ''}
      <b class="ik-op ${s.op}" title="${s.op === 'cut' ? 'Вырезает' : s.op === 'mod' ? 'Модификатор поверх' : 'Добавляет'}">${s.op === 'cut' ? '−' : s.op === 'mod' ? '◆' : '+'}</b>
      <button type="button" class="ik-eye" data-eye="${s.id}" aria-label="${s.hidden ? 'Показать' : 'Скрыть'}">${ic(s.hidden ? 'eyeOff' : 'eye')}</button></div>`).join('');
}

function drawRight() {
  const box = $('#ikRight'), s1 = one(), list = selected();
  if (edit) { box.innerHTML = pointPanel(); return; }
  if (s1) {
    const mod = MODS.includes(s1.type);
    const num = (k, label, step = 0.5) => `<label class="ik-f"><span>${label}</span><input type="number" step="${step}" data-k="${k}" value="${+((s1[k] ?? 0).toFixed(2))}"></label>`;
    box.innerHTML = `<div class="ik-sec"><span class="ik-h">${esc(K.TYPES[s1.type] || s1.type)}</span>
        ${mod ? '<p class="ik-note">Модификатор: линией этого размера поверх иконки, с прорезью в толщину линии вокруг.</p>' : `<div class="ik-seg wide" role="group" aria-label="Операция"><button type="button" data-op="add" aria-pressed="${s1.op !== 'cut'}">Добавить</button><button type="button" data-op="cut" aria-pressed="${s1.op === 'cut'}">Вырезать</button></div>`}</div>
      <div class="ik-sec">${alignRow()}</div>
      <div class="ik-sec ik-fields">${num('x', 'X')}${num('y', 'Y')}${num('w', 'W')}${num('h', 'H')}${num('rot', '∠', 1)}${['squircle', 'rhombus', 'triangle'].includes(s1.type) ? num('r', '◜') : ''}</div>
      ${mod ? '' : `<div class="ik-sec"><button type="button" class="ibtn wide${edit ? ' pri' : ''}" data-ik="points">${edit ? 'Готово · Enter' : 'Править точки · Enter'}</button></div>`}
      <div class="ik-sec ik-row2"><button type="button" class="ibtn" data-ik="dup">Дублировать</button><button type="button" class="ibtn" data-ik="del">Удалить</button></div>
      ${checksHtml()}`;
    return;
  }
  if (list.length > 1) {
    box.innerHTML = `<div class="ik-sec"><span class="ik-h">Выбрано: ${list.length}</span></div><div class="ik-sec">${alignRow()}</div>
      <div class="ik-sec ik-row2"><button type="button" class="ibtn" data-ik="dup">Дублировать</button><button type="button" class="ibtn" data-ik="del">Удалить</button></div>${checksHtml()}`;
    return;
  }
  // nothing selected: the icon itself — name, words, checks, every size, export
  box.innerHTML = `<div class="ik-sec"><span class="ik-h">Иконка</span>
      <label class="ik-f wide"><span>Имя</span><input id="ikName" type="text" placeholder="Smart Lamp" value="${esc(doc.name || '')}" autocomplete="off"></label>
      <label class="ik-f wide"><span>Слова</span><input id="ikKeys" type="text" placeholder="Lamp, Light, Лампа" value="${esc(doc.keys || '')}" autocomplete="off"></label></div>
    ${checksHtml()}${sizesHtml()}
    <div class="ik-sec"><span class="ik-h">Экспорт</span>
      <button type="button" class="ibtn pri wide" data-ik="save">Сохранить в библиотеку</button>
      <div class="ik-row2"><button type="button" class="ibtn" data-ik="copy">Копировать SVG</button><button type="button" class="ibtn" data-ik="to3d">В 3D</button></div>
      <button type="button" class="ibtn wide" data-ik="new">Новая иконка</button></div>
    <details class="ik-sec ik-guide"><summary class="ik-h">Правила хорошего тона</summary>${R.GUIDE.map(([t, d, src]) => `<p><b>${esc(t)}</b> ${esc(d)} <span>${esc(src)}</span></p>`).join('')}</details>`;
}
// point editing: the chosen point's place, its corner radius (a sharp corner only), sharp ↔ smooth
function pointPanel() {
  const keys = [...edit.pts], q = keys.length === 1 ? ptOf(keys[0]) : null;
  const sharp = q && Math.hypot(...q.i) + Math.hypot(...q.o) < 1e-6;
  const head = `<div class="ik-sec"><span class="ik-h">Правка точек</span><p class="ik-note">Клик по контуру — новая точка, Delete — убрать, второе нажатие на точку — угол ↔ плавная.</p></div>`;
  if (!q) return head + `<div class="ik-sec"><p class="ik-note">${keys.length ? `Выбрано точек: ${keys.length}` : 'Выберите точку'}</p></div><div class="ik-sec"><button type="button" class="ibtn wide pri" data-ik="points">Готово · Enter</button></div>`;
  return head + `<div class="ik-sec ik-fields"><label class="ik-f"><span>X</span><input type="number" step="0.5" data-pk="x" value="${+q.p[0].toFixed(2)}"></label><label class="ik-f"><span>Y</span><input type="number" step="0.5" data-pk="y" value="${+q.p[1].toFixed(2)}"></label></div>`
    + (sharp ? `<div class="ik-sec"><span class="ik-h">Скругление угла</span><div class="ik-row2"><label class="ik-f"><span>◜</span><input type="number" step="0.5" min="0" id="ikPtR" value="2"></label><button type="button" class="ibtn" data-ik="ptround">Скруглить</button></div></div>` : '')
    + `<div class="ik-sec"><button type="button" class="ibtn wide" data-ik="ptsmooth">${sharp ? 'Сделать плавной' : 'Сделать углом'}</button></div>`
    + `<div class="ik-sec"><button type="button" class="ibtn wide pri" data-ik="points">Готово · Enter</button></div>`;
}
const alignRow = () => `<div class="ik-align" role="group" aria-label="Выравнивание">${[['l', 'alL', 'По левому краю · Alt+A'], ['c', 'alC', 'По центру · Alt+H'], ['r', 'alR', 'По правому краю · Alt+D'], ['t', 'alT', 'По верху · Alt+W'], ['m', 'alM', 'По середине · Alt+V'], ['b', 'alB', 'По низу · Alt+S']].map(([k, i, t]) => `<button type="button" data-align="${k}" title="${t}" aria-label="${t}">${ic(i)}</button>`).join('')}</div>`;
// a failed check says what to do (bug #109): its next step under it, «Показать» marks the place on the canvas in red,
// «Исправить» where the constructor can do it itself
let lastChecks = [], showArea = '';
function checksHtml() {
  if (!doc.shapes.length) return '';
  const list = K.check(doc.shapes, K.BASE);
  lastChecks = list;
  if (showArea && !list.some((c) => !c.ok && c.area === showArea)) showArea = '';
  const small = K.check(doc.shapes, 16).filter((c) => !c.ok).map((c) => ({ ok: false, text: '16 px: ' + c.text, soft: true, how: c.how ? 'На 16 px: ' + c.how.replace('Красным — места', 'Места').replace('Красным — щели', 'Щели').replace(' Красным — что заходит ближе:', '') : '' }));
  let tips = [];
  try { tips = R.advice(doc.shapes, doc.style); } catch (e) { tips = []; }
  const row = (c, i) => {
    if (c.ok) return `<p class="ik-chk ok">${esc(c.text)}</p>`;
    const acts = (c.area ? `<button type="button" class="ik-chk-b${showArea === c.area ? ' on' : ''}" data-ik="show" data-ci="${i}">${showArea === c.area ? 'Скрыть' : 'Показать'}</button>` : '')
      + (c.fix ? '<button type="button" class="ik-chk-b" data-ik="fix">Исправить</button>' : '');
    return `<div class="ik-chk ${c.soft ? 'soft' : 'bad'} more"><b>${esc(c.text)}</b>${c.how ? `<small>${esc(c.how)}</small>` : ''}${acts ? `<span class="ik-chk-a">${acts}</span>` : ''}</div>`;
  };
  return `<div class="ik-sec"><span class="ik-h">Проверка</span>${list.map(row).join('')}${small.map((c) => row(c, -1)).join('')}<button type="button" class="ibtn wide" data-ik="fix" title="На пиксельную сетку, внутрь полей, оптический центр">Привести к правилам</button></div>`
    // «Хороший тон» (the user asked what it is): soft advice, not rules — what a careful designer would look at again
    + (tips.length ? `<div class="ik-sec"><span class="ik-h">Хороший тон</span><p class="ik-note">Советы, а не правила: на что ещё посмотреть глазами. Жёлтое можно оставить, если так задумано.</p>${tips.map((c) => (c.ok ? `<p class="ik-chk ok">${esc(c.text)}</p>` : row({ ...c, soft: true }, -1))).join('')}</div>` : '');
}
function sizesHtml() {
  if (!doc.shapes.length) return '';
  const row = (style) => Object.keys(K.SIZES).map((sz) => {
    const r = K.build(doc.shapes, +sz), d = style === 'fill' ? r.fill : r.outline;
    return `<figure title="${sz} px"><svg width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}"><path d="${d}" fill-rule="evenodd"/></svg><figcaption>${sz}</figcaption></figure>`;
  }).join('');
  // «Умный 16»: what the small size got done by itself (K.build → smartSmall), so nobody wonders why 16 differs
  const done = (K.build(doc.shapes, 16).smart || []).filter((x) => x !== 'на пиксельной сетке');
  const note = done.length ? `<p class="ik-note">16 px подогнан сам: ${esc(done.join(', '))}, всё на пиксельной сетке</p>` : '';
  return `<div class="ik-sec"><span class="ik-h">Все размеры</span><div class="ik-sizes">${row('outline')}</div><div class="ik-sizes">${row('fill')}</div>${note}</div>`;
}

/* ---------- editing ---------- */
function onInput(e) {
  const t = e.target;
  if (t.id === 'ikName') { doc.name = t.value; keep(); return; }
  if (t.id === 'ikKeys') { doc.keys = t.value; keep(); return; }
  if (edit && t.dataset.pk && edit.pts.size === 1) { // a point's X / Y typed in
    const v = parseFloat(t.value); if (Number.isNaN(v)) return;
    if (!t.dataset.started) { commit(); t.dataset.started = '1'; }
    const q = ptOf([...edit.pts][0]); q.p = t.dataset.pk === 'x' ? [v, q.p[1]] : [q.p[0], v];
    applyEdit(); drawOverlay(); return;
  }
  const s = one();
  if (s && t.dataset.k) {
    if (!t.dataset.started) { commit(); t.dataset.started = '1'; }
    const v = parseFloat(t.value);
    if (Number.isNaN(v)) return;
    s[t.dataset.k] = t.dataset.k === 'w' || t.dataset.k === 'h' ? Math.max(0, v) : v;
    drawCanvas();
  }
}

function onClick(e) {
  const like = e.target.closest('[data-like]');
  if (like) { const it = likeItems[+like.dataset.like]; if (it) useSvgItem(it); return; }
  const word = e.target.closest('[data-word]');
  if (word) { const it = wordsItems[+word.dataset.word]; if (it) useSvgItem(it); return; }
  const b = e.target.closest('button, [data-var]');
  if (!b) return;
  if (b.dataset.var != null && !b.dataset.ik) { useVariant(+b.dataset.var); return; }
  if (b.dataset.model) { setModel(b.dataset.model); return; }
  if (b.dataset.tool) { tool = b.dataset.tool; draw(); return; }
  if (b.dataset.style) { doc.style = b.dataset.style; keep(); draw(); return; }
  if (b.dataset.op) { const s = one(); if (s) { commit(); s.op = b.dataset.op; keep(); draw(); } return; }
  if (b.dataset.eye) { const s = byId(b.dataset.eye); if (s) { commit(); s.hidden = !s.hidden; keep(); draw(); } return; }
  if (b.dataset.align) { align(b.dataset.align); return; }
  const a = b.dataset.ik;
  if (a === 'show') { const c = lastChecks[+b.dataset.ci]; showArea = c && c.area !== showArea ? c.area : ''; draw(); return; }
  if (a === 'x') closeIconKit();
  else if (a === 'undo') undo();
  else if (a === 'redo') redo();
  else if (a === 'keylines') { doc.keylines = !doc.keylines; keep(); draw(); }
  else if (a === 'ptround' && edit && edit.pts.size === 1) {
    const [ci, si] = [...edit.pts][0].split(':').map(Number);
    const r = Math.max(0, parseFloat(($('#ikPtR') || {}).value) || 0);
    if (r) { commit(); edit.cs[ci] = K.roundPoint(edit.cs[ci], si, r); edit.pts = new Set([ci + ':' + si, ci + ':' + (si + 1)]); applyEdit(); keep(); draw(); }
  } else if (a === 'ptsmooth' && edit && edit.pts.size === 1) {
    const [ci, si] = [...edit.pts][0].split(':').map(Number);
    commit(); K.toggleSmooth(edit.cs[ci], si); applyEdit(); keep(); draw();
  } else if (a === 'points') { if (edit) exitEdit(); else if (one()) enterEdit(one()); }
  else if (a === 'stylize') pickSvgToStylize();
  else if (a === 'fix') fixRules();
  else if (a === 'dup') dup();
  else if (a === 'del') del();
  else if (a === 'new') { if (doc.shapes.length) commit(); doc = blank(); sel.clear(); keep(); draw(); }
  else if (a === 'copy') copySvg();
  else if (a === 'save') save();
  else if (a === 'to3d') to3d();
  else if (a === 'gen') gen(b);
  else if (a === 'model') modelMenu(b);
  else if (a === 'trace') { const t = $('#ikTrace'); t.classList.toggle('open'); b.setAttribute('aria-expanded', String(t.classList.contains('open'))); }
  else if (a === 'fit') { fit(); drawCanvas(); }
  else if (a === 'zin' || a === 'zout') { const r = $('#ikStage').getBoundingClientRect(); zoomAt(a === 'zin' ? 1.25 : 0.8, r.width / 2, r.height / 2); }
}
function dup() {
  const list = selected(); if (!list.length) return;
  commit();
  const regroup = newGroups();
  const copies = list.map((s) => ({ ...s, id: uid(), x: s.x + 1, y: s.y + 1, name: s.name ? s.name + ' copy' : undefined, g: regroup(s.g) }));
  doc.shapes.push(...copies); sel = new Set(copies.map((c) => c.id)); keep(); draw();
}
// Shift+H / Shift+V: mirrored inside the selection's common box (each shape's own flip flag + its place)
function flip(axis) {
  const list = selected(); if (!list.length) return;
  commit();
  const box = bboxOf(list);
  for (const s of list) {
    s[axis] = !s[axis];
    if (s.rot) s.rot = -s.rot;
    if (axis === 'fx') s.x = half(box.x + box.x + box.w - s.x - s.w); else s.y = half(box.y + box.y + box.h - s.y - s.h);
  }
  keep(); draw();
}
// Ctrl+G groups the selection (two or more), Ctrl+Shift+G takes it apart
// copies of grouped shapes form groups of their own (not the originals' group)
function newGroups() { const m = new Map(); return (g) => (g ? (m.get(g) || (m.set(g, uid()), m.get(g))) : undefined); }
function group(on) {
  const list = selected();
  if (on && list.length < 2) return;
  if (!on && !list.some((s) => s.g)) return;
  commit();
  const gid = uid();
  for (const s of list) { if (on) s.g = gid; else delete s.g; }
  keep(); draw();
  toast(on ? `Группа: ${list.length}` : 'Группа разобрана', 1400);
}
function toggleHidden() {
  const list = selected(); if (!list.length) return;
  commit();
  const hide = !list.every((s) => s.hidden);
  for (const s of list) s.hidden = hide;
  keep(); draw();
}
// Ctrl+] / Ctrl+[ one step up / down the layers, with Shift (or Alt) to the top / bottom — the order of add and cut
function reorder(dir, toEnd) {
  if (!sel.size) return;
  commit();
  const sh = doc.shapes;
  if (toEnd) {
    const moved = sh.filter((s) => sel.has(s.id)), rest = sh.filter((s) => !sel.has(s.id));
    doc.shapes = dir > 0 ? [...rest, ...moved] : [...moved, ...rest];
  } else {
    const idx = sh.map((s, i) => (sel.has(s.id) ? i : -1)).filter((i) => i >= 0);
    for (const i of dir > 0 ? idx.reverse() : idx) {
      const j = i + dir;
      if (j < 0 || j >= sh.length || sel.has(sh[j].id)) continue;
      [sh[i], sh[j]] = [sh[j], sh[i]];
    }
  }
  keep(); draw();
}
// Ctrl+C / Ctrl+X / Ctrl+V (Ctrl+Shift+V — in place): shapes between icons, kept for the session
let clip = null;
function copyShapes(cut) {
  clip = selected().map((s) => ({ ...s }));
  if (cut) del();
  toast(cut ? 'Вырезано: ' + clip.length : 'Скопировано: ' + clip.length, 1400);
}
function paste(inPlace) {
  if (!clip || !clip.length) return;
  commit();
  const d = inPlace ? 0 : 1;
  const regroup = newGroups();
  const copies = clip.map((s) => ({ ...s, id: uid(), x: s.x + d, y: s.y + d, g: regroup(s.g) }));
  doc.shapes.push(...copies);
  sel = new Set(copies.map((c) => c.id));
  clip = copies.map((s) => ({ ...s })); // the next paste steps on again
  keep(); draw();
}
// Tab / Shift+Tab: the next / previous shape
function cycle(dir) {
  const ids = doc.shapes.map((s) => s.id);
  const cur = sel.size === 1 ? ids.indexOf([...sel][0]) : -1;
  const i = cur < 0 ? (dir > 0 ? 0 : ids.length - 1) : (cur + dir + ids.length) % ids.length;
  sel = new Set([ids[i]]);
  draw();
}
function del() { if (!sel.size) return; commit(); doc.shapes = doc.shapes.filter((s) => !sel.has(s.id)); sel.clear(); keep(); draw(); }
// one shape aligns to the live area (2–22), several to their common box
function align(k) {
  const list = selected(); if (!list.length) return;
  commit();
  const area = list.length === 1 ? { x: 2, y: 2, w: 20, h: 20 } : bboxOf(list);
  for (const s of list) {
    const b = bboxOf([s]);
    if (k === 'l') s.x += area.x - b.x;
    if (k === 'r') s.x += area.x + area.w - (b.x + b.w);
    if (k === 'c') s.x += area.x + area.w / 2 - (b.x + b.w / 2);
    if (k === 't') s.y += area.y - b.y;
    if (k === 'b') s.y += area.y + area.h - (b.y + b.h);
    if (k === 'm') s.y += area.y + area.h / 2 - (b.y + b.h / 2);
    s.x = half(s.x); s.y = half(s.y);
  }
  keep(); draw();
}

let spaceDown = false;
function onKey(e) {
  if (!isIconKitOpen()) return;
  lastShape.id = null; lastPt.key = null; // a key between two presses: they are not a double click
  const t = e.target, typing = t.closest && t.closest('input, textarea');
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') {
    e.preventDefault(); e.stopPropagation();
    if (typing) t.blur(); else if (edit) exitEdit(); else if (tool !== 'move') { tool = 'move'; draw(); } else if (sel.size) { sel.clear(); draw(); } else closeIconKit();
    return;
  }
  if (typing) return;
  const stop = () => { e.preventDefault(); e.stopPropagation(); };
  if (e.code === 'Space') { stop(); spaceDown = true; svg.classList.add('pan'); return; }
  if (mod && e.code === 'KeyZ') { stop(); if (e.shiftKey) redo(); else undo(); return; }
  // Enter: edit the points of the selected shape; Enter again (or Esc) — done
  if (e.key === 'Enter' && !mod) { stop(); if (edit) exitEdit(); else if (one()) enterEdit(one()); return; }
  if (edit) {
    if (e.key === 'Delete' || e.key === 'Backspace') { stop(); deletePoints(); return; }
    const dv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (dv) { stop(); const st = e.shiftKey ? 2 : 0.5; nudgePoints(dv[0] * st, dv[1] * st); return; }
    if (mod && e.code === 'KeyA') { stop(); edit.pts = new Set(edit.cs.flatMap((c, ci) => c.map((_, si) => ci + ':' + si))); drawOverlay(); return; }
  }
  if (mod && e.code === 'KeyD') { stop(); dup(); return; }
  if (mod && e.code === 'KeyG' && !edit) { stop(); group(!e.shiftKey); return; }
  if (mod && e.code === 'KeyA') { stop(); sel = new Set(doc.shapes.map((s) => s.id)); draw(); return; }
  if (e.shiftKey && e.code === 'Digit1') { stop(); fit(); drawCanvas(); return; }
  // Figma's keys (by key position, so they work in the Russian layout too)
  if (e.shiftKey && !mod && e.code === 'Digit0') { stop(); zoomTo(20); return; }
  if (e.shiftKey && !mod && e.code === 'Digit2') { stop(); if (sel.size) fitTo(bboxOf(selected())); else fit(); drawCanvas(); return; }
  if (e.altKey && !mod && !e.shiftKey) {
    const al = { KeyA: 'l', KeyD: 'r', KeyW: 't', KeyS: 'b', KeyH: 'c', KeyV: 'm' }[e.code];
    if (al) { stop(); align(al); return; }
  }
  if (e.shiftKey && !mod && !e.altKey && (e.code === 'KeyH' || e.code === 'KeyV')) { stop(); flip(e.code === 'KeyH' ? 'fx' : 'fy'); return; }
  if (mod && e.shiftKey && e.code === 'KeyH') { stop(); toggleHidden(); return; }
  if (mod && (e.code === 'BracketRight' || e.code === 'BracketLeft')) { stop(); reorder(e.code === 'BracketRight' ? 1 : -1, e.shiftKey || e.altKey); return; }
  if (mod && e.code === 'KeyC') { if (sel.size) { stop(); copyShapes(false); } return; }
  if (mod && e.code === 'KeyX') { if (sel.size) { stop(); copyShapes(true); } return; }
  if (mod && e.code === 'KeyV') { if (clip) { stop(); paste(e.shiftKey); } return; }
  if (e.code === 'Tab' && doc.shapes.length) { stop(); cycle(e.shiftKey ? -1 : 1); return; }
  if (!mod && (e.key === '+' || e.key === '=' || e.key === '-')) { stop(); const r = $('#ikStage').getBoundingClientRect(); zoomAt(e.key === '-' ? 0.8 : 1.25, r.width / 2, r.height / 2); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { if (sel.size) { stop(); del(); } return; }
  if (!mod && !e.altKey) {
    const keyTool = { KeyV: 'move', KeyR: 'squircle', KeyO: 'circle', KeyC: 'capsule' }[e.code];
    if (keyTool) { stop(); tool = keyTool; draw(); return; }
  }
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (sel.size && dir) {
    stop(); commit();
    const st = e.shiftKey ? 2 : 0.5;
    for (const s of selected()) { s.x += dir[0] * st; s.y += dir[1] * st; }
    keep(); draw();
  }
}

/* ---------- pointer work on the canvas ---------- */
let drag = null, marquee = null;
// smart guides: where a moving edge or centre may stick — the centre, the keylines, the margins, other shapes
function targets(skip) {
  const xs = [2, 3, 4, 12, 20, 21, 22], ys = [2, 3, 4, 12, 20, 21, 22];
  for (const s of doc.shapes) {
    if (skip.has(s.id) || s.hidden) continue;
    const b = bboxOf([s]);
    xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  return { xs, ys };
}
// the shift that sticks one of `vals` to the nearest target (within 6 screen px), or null
function stick(vals, tg) {
  const lim = 6 / cam.z;
  let best = null;
  for (const v of vals) for (const t of tg) { const d = t - v; if (Math.abs(d) <= lim && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, t }; }
  return best;
}

function bindCanvas() {
  const at = (e) => { const r = svg.getBoundingClientRect(); const sx = e.clientX - r.left, sy = e.clientY - r.top; return { sx, sy, x: (sx - cam.x) / cam.z, y: (sy - cam.y) / cam.z }; };
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = at(e);
    if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.0025), p.sx, p.sy); // pinch and Ctrl+wheel zoom at the pointer
    else { cam.x -= e.shiftKey ? e.deltaY : e.deltaX; cam.y -= e.shiftKey ? 0 : e.deltaY; drawCanvas(); } // the wheel pans, as in Figma
  }, { passive: false });

  svg.addEventListener('pointermove', (e) => {
    const p = at(e);
    if (!drag) {
      const hitEl = document.elementFromPoint(e.clientX, e.clientY);
      const id = hitEl && hitEl.dataset && hitEl.dataset.sid ? hitEl.dataset.sid : null;
      svg.dataset.cur = tool !== 'move' ? 'cross' : rotZone(p) ? 'rotate' : '';
      if (id !== hover) { hover = id; drawOverlay(); }
      return;
    }
    onDrag(p, e);
  });
  svg.addEventListener('pointerleave', () => { if (!drag && hover) { hover = null; drawOverlay(); } });

  svg.addEventListener('pointerdown', (e) => {
    const p = at(e);
    svg.setPointerCapture(e.pointerId);
    if (spaceDown || e.button === 1) { drag = { mode: 'pan', sx: p.sx, sy: p.sy, cx: cam.x, cy: cam.y }; return; }
    if (e.button !== 0) return;
    if (edit && tool === 'move') {
      const hp = e.target.dataset && e.target.dataset.hp, pt = e.target.dataset && e.target.dataset.pt;
      if (hp) { // a handle: Alt — only this one, otherwise a smooth point keeps both in line
        const [ci, si, k] = hp.split(':'), q = edit.cs[+ci][+si], o = k === 'i' ? 'o' : 'i';
        const smooth = Math.hypot(...q[o]) > 1e-6 && Math.abs(Math.atan2(q.i[1], q.i[0]) - Math.atan2(-q.o[1], -q.o[0])) % (2 * Math.PI) < 0.02;
        commit(); drag = { mode: 'hd', q, k, o, smooth };
        return;
      }
      if (pt) {
        // a second press on the same point: sharp ↔ smooth (the overlay is redrawn between clicks, so the browser's
        // own dblclick loses its target)
        const now = performance.now();
        if (lastPt.key === pt && now - lastPt.at < 400) {
          lastPt.key = null;
          commit(); const [ci, si] = pt.split(':').map(Number); K.toggleSmooth(edit.cs[ci], si); edit.pts = new Set([pt]); applyEdit(); keep(); drawOverlay();
          return;
        }
        lastPt.key = pt; lastPt.at = now;
        if (e.shiftKey) { if (edit.pts.has(pt)) edit.pts.delete(pt); else edit.pts.add(pt); drawOverlay(); return; }
        if (!edit.pts.has(pt)) edit.pts = new Set([pt]);
        commit();
        drag = { mode: 'pts', p0: p, grab: ptOf(pt).p.slice(), orig: [...edit.pts].map((k) => ({ q: ptOf(k), p: ptOf(k).p.slice() })) };
        drawOverlay();
        return;
      }
      // on the outline: a new point there
      const ins = K.insertPoint(edit.cs, p.x, p.y, 5 / cam.z);
      if (ins) { commit(); edit.cs = ins.cs; edit.pts = new Set([ins.ci + ':' + ins.si]); applyEdit(); keep(); drawOverlay(); return; }
      const hit = e.target.dataset && e.target.dataset.sid;
      if (hit && hit !== edit.id) { exitEdit(); } // another shape: leave the points, select it as usual
      else {
        if (!e.shiftKey) edit.pts.clear();
        marquee = { x0: p.sx, y0: p.sy, x1: p.sx, y1: p.sy, base: new Set(edit.pts) };
        drag = { mode: 'ptmarq' };
        drawOverlay();
        return;
      }
    }
    // drawing a new shape
    if (tool !== 'move') {
      commit();
      const x0 = half(p.x), y0 = half(p.y);
      const s = { id: uid(), type: tool, x: x0, y: y0, w: 0, h: 0, op: MODS.includes(tool) ? 'mod' : 'add', rot: 0 };
      if (tool === 'squircle') s.r = 4; if (tool === 'rhombus' || tool === 'triangle') s.r = 1.5;
      doc.shapes.push(s); sel = new Set([s.id]);
      drag = { mode: 'create', x0, y0, id: s.id };
      return;
    }
    const hd = e.target.closest && e.target.closest('[data-handle]');
    const s1 = one();
    if (hd && s1) { commit(); drag = { mode: 'resize', k: hd.dataset.handle, orig: { ...s1 } }; return; }
    if (s1 && rotZone(p)) { commit(); const c = { x: s1.x + s1.w / 2, y: s1.y + s1.h / 2 }; drag = { mode: 'rotate', c, a0: Math.atan2(p.y - c.y, p.x - c.x), r0: s1.rot || 0 }; return; }
    const hit = e.target.dataset && e.target.dataset.sid;
    if (hit) {
      // a second press on the same shape: edit its points (the canvas is redrawn after the first click, so the
      // browser's own dblclick never reaches the shape)
      const now = performance.now();
      if (!e.shiftKey && lastShape.id === hit && now - lastShape.at < 400) { lastShape.id = null; sel = new Set([hit]); enterEdit(byId(hit)); return; }
      lastShape.id = hit; lastShape.at = now;
      if (e.shiftKey) { const g = groupOf(hit); if (sel.has(hit)) g.forEach((x) => sel.delete(x)); else g.forEach((x) => sel.add(x)); draw(); return; }
      if (!sel.has(hit)) sel = new Set(groupOf(hit));
      commit();
      drag = { mode: 'move', p0: p, orig: selected().map((s) => ({ id: s.id, x: s.x, y: s.y })), box: bboxOf(selected()), dup: e.altKey };
      if (e.altKey) { // Alt-drag duplicates, as in Figma
        const regroup = newGroups();
        const copies = selected().map((s) => ({ ...s, id: uid(), g: regroup(s.g) }));
        doc.shapes.push(...copies); sel = new Set(copies.map((c) => c.id));
        drag.orig = copies.map((s) => ({ id: s.id, x: s.x, y: s.y }));
      }
      draw();
      return;
    }
    // empty canvas: a marquee
    if (!e.shiftKey) sel.clear();
    marquee = { x0: p.sx, y0: p.sy, x1: p.sx, y1: p.sy, base: new Set(sel) };
    drag = { mode: 'marquee' };
    draw();
  });

  const end = () => {
    if (!drag) return;
    if (drag.mode === 'create') {
      const s = byId(drag.id);
      if (s && s.w < 0.5 && s.h < 0.5) { // a click, not a drag: the tool's default size around the point
        const [w, h] = SIZE_DEF[s.type] || [8, 8];
        s.w = w; s.h = h; s.x = half(s.x - w / 2); s.y = half(s.y - h / 2);
      }
      tool = 'move';
    }
    if (drag && drag.mode === 'marquee') sel = withGroups(sel); // a group caught by the frame comes whole
    drag = null; marquee = null; guides = [];
    keep(); draw();
  };
  svg.addEventListener('pointerup', end);
  // double-click: on a shape — edit its points; on a point — sharp ↔ smooth; on empty canvas — done
  svg.addEventListener('dblclick', (e) => {
    const pt = e.target.dataset && e.target.dataset.pt;
    if (edit && pt) return; // handled on the second press (see pointerdown)
    if (edit) { if (!(e.target.dataset && e.target.dataset.sid === edit.id)) exitEdit(); return; }
    const hit = e.target.dataset && e.target.dataset.sid;
    if (hit && tool === 'move') enterEdit(byId(hit));
  });
  svg.addEventListener('pointercancel', end);
}

// near a corner of the single selection, just outside it: rotation (Figma's behaviour)
function rotZone(p) {
  const s = one(); if (!s) return false;
  const lim = 16 / cam.z, inner = 5 / cam.z;
  return corners(s).some(([cx, cy]) => { const d = Math.hypot(p.x - cx, p.y - cy); return d <= lim && d > inner; }) && !insideShape(s, p);
}
function insideShape(s, p) {
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2, a = (-(s.rot || 0) * Math.PI) / 180;
  const dx = p.x - cx, dy = p.y - cy, lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(lx) <= s.w / 2 && Math.abs(ly) <= s.h / 2;
}

function onDrag(p, e) {
  const free = e.altKey && drag.mode !== 'move';
  guides = [];
  if (drag.mode === 'pan') { cam.x = drag.cx + (p.sx - drag.sx); cam.y = drag.cy + (p.sy - drag.sy); drawCanvas(); return; }
  if (drag.mode === 'pts') { // points follow the pointer; the grabbed one sticks to guides or the 0.5 grid (Alt — free)
    let x = drag.grab[0] + p.x - drag.p0.x, y = drag.grab[1] + p.y - drag.p0.y;
    if (e.shiftKey) { if (Math.abs(x - drag.grab[0]) > Math.abs(y - drag.grab[1])) y = drag.grab[1]; else x = drag.grab[0]; }
    if (!e.altKey) {
      const tg = targets(new Set([edit.id])), sx = stick([x], tg.xs), sy = stick([y], tg.ys);
      x = sx ? sx.t : half(x); y = sy ? sy.t : half(y);
      if (sx) guides.push({ axis: 'x', v: sx.t }); if (sy) guides.push({ axis: 'y', v: sy.t });
    }
    const dx = x - drag.grab[0], dy = y - drag.grab[1];
    for (const o of drag.orig) o.q.p = [o.p[0] + dx, o.p[1] + dy];
    applyEdit(); return;
  }
  if (drag.mode === 'hd') {
    const q = drag.q;
    let hx = p.x, hy = p.y;
    if (!e.altKey) { hx = half(hx); hy = half(hy); }
    q[drag.k] = [hx - q.p[0], hy - q.p[1]];
    if (drag.smooth && !e.altKey) { // the other handle turns with it, keeping its own length
      const len = Math.hypot(...q[drag.o]), l = Math.hypot(...q[drag.k]) || 1;
      q[drag.o] = [(-q[drag.k][0] / l) * len, (-q[drag.k][1] / l) * len];
    }
    applyEdit(); return;
  }
  if (drag.mode === 'ptmarq') {
    marquee.x1 = p.sx; marquee.y1 = p.sy;
    const x1 = Math.min(marquee.x0, marquee.x1), x2 = Math.max(marquee.x0, marquee.x1), y1 = Math.min(marquee.y0, marquee.y1), y2 = Math.max(marquee.y0, marquee.y1);
    edit.pts = new Set(marquee.base);
    edit.cs.forEach((c, ci) => c.forEach((q, si) => { const [x, y] = toScreen(...q.p); if (x >= x1 && x <= x2 && y >= y1 && y <= y2) edit.pts.add(ci + ':' + si); }));
    drawOverlay(); return;
  }
  if (drag.mode === 'marquee') {
    marquee.x1 = p.sx; marquee.y1 = p.sy;
    const x1 = (Math.min(marquee.x0, marquee.x1) - cam.x) / cam.z, x2 = (Math.max(marquee.x0, marquee.x1) - cam.x) / cam.z;
    const y1 = (Math.min(marquee.y0, marquee.y1) - cam.y) / cam.z, y2 = (Math.max(marquee.y0, marquee.y1) - cam.y) / cam.z;
    sel = new Set(marquee.base);
    for (const s of doc.shapes) { const b = bboxOf([s]); if (!s.hidden && b.x < x2 && b.x + b.w > x1 && b.y < y2 && b.y + b.h > y1) sel.add(s.id); }
    drawOverlay(); drawLayers();
    return;
  }
  if (drag.mode === 'move') {
    let dx = p.x - drag.p0.x, dy = p.y - drag.p0.y;
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; } // Shift: along one axis
    const b = drag.box, tg = targets(sel);
    const sx = stick([b.x + dx, b.x + b.w / 2 + dx, b.x + b.w + dx], tg.xs), sy = stick([b.y + dy, b.y + b.h / 2 + dy, b.y + b.h + dy], tg.ys);
    dx = sx ? dx + sx.d : half(b.x + dx) - b.x; dy = sy ? dy + sy.d : half(b.y + dy) - b.y;
    if (sx) guides.push({ axis: 'x', v: sx.t }); if (sy) guides.push({ axis: 'y', v: sy.t });
    for (const o of drag.orig) { const s = byId(o.id); s.x = o.x + dx; s.y = o.y + dy; }
    drawCanvas(); return;
  }
  if (drag.mode === 'rotate') {
    const s = one(); let r = drag.r0 + ((Math.atan2(p.y - drag.c.y, p.x - drag.c.x) - drag.a0) * 180) / Math.PI;
    r = e.shiftKey ? Math.round(r / 15) * 15 : Math.round(r);
    s.rot = ((r % 360) + 540) % 360 - 180;
    drawCanvas(); return;
  }
  const tg = targets(sel);
  const snapX = (v) => { if (free) return Math.round(v * 10) / 10; const st = stick([v], tg.xs); if (st) { guides.push({ axis: 'x', v: st.t }); return st.t; } return half(v); };
  const snapY = (v) => { if (free) return Math.round(v * 10) / 10; const st = stick([v], tg.ys); if (st) { guides.push({ axis: 'y', v: st.t }); return st.t; } return half(v); };
  if (drag.mode === 'create') {
    const s = byId(drag.id);
    let x1 = snapX(p.x), y1 = snapY(p.y), x0 = drag.x0, y0 = drag.y0;
    if (e.shiftKey) { const side = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); x1 = x0 + Math.sign(x1 - x0 || 1) * side; y1 = y0 + Math.sign(y1 - y0 || 1) * side; }
    if (e.altKey) { x0 = 2 * drag.x0 - x1; y0 = 2 * drag.y0 - y1; } // from the centre
    s.x = Math.min(x0, x1); s.y = Math.min(y0, y1); s.w = Math.abs(x1 - x0); s.h = Math.abs(y1 - y0);
    drawCanvas(); return;
  }
  if (drag.mode === 'resize') {
    const s = one(), o = drag.orig, k = drag.k;
    if (!o.rot) {
      let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
      if (k.includes('w')) x1 = snapX(p.x); if (k.includes('e')) x2 = snapX(p.x);
      if (k.includes('n')) y1 = snapY(p.y); if (k.includes('s')) y2 = snapY(p.y);
      if (e.shiftKey && k.length === 2 && o.w && o.h) { // proportional
        const ar = o.w / o.h, w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
        if (w / ar > h) { const nh = w / ar; if (k.includes('n')) y1 = y2 - nh; else y2 = y1 + nh; } else { const nw = h * ar; if (k.includes('w')) x1 = x2 - nw; else x2 = x1 + nw; }
      }
      s.x = Math.min(x1, x2); s.y = Math.min(y1, y2); s.w = Math.abs(x2 - x1); s.h = Math.abs(y2 - y1);
    } else {
      // a turned shape resizes in its own frame: the opposite handle stays put
      const a = (o.rot * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a), c0 = { x: o.x + o.w / 2, y: o.y + o.h / 2 };
      const dx = p.x - c0.x, dy = p.y - c0.y, lx = dx * co + dy * si, ly = -dx * si + dy * co;
      let l = -o.w / 2, r = o.w / 2, t = -o.h / 2, b = o.h / 2;
      if (k.includes('w')) l = lx; if (k.includes('e')) r = lx; if (k.includes('n')) t = ly; if (k.includes('s')) b = ly;
      const w = half(Math.abs(r - l)), h = half(Math.abs(b - t)), mx = (l + r) / 2, my = (t + b) / 2;
      const cx = c0.x + mx * co - my * si, cy = c0.y + mx * si + my * co;
      s.w = w; s.h = h; s.x = cx - w / 2; s.y = cy - h / 2;
    }
    drawCanvas();
  }
}

/* ---------- layers: pick, Shift-pick, drag to reorder ---------- */
function bindLayers() {
  const box = $('#ikLayers');
  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-eye]')) return;
    const row = e.target.closest('[data-pick]'); if (!row) return;
    const id = row.dataset.pick;
    if (e.shiftKey) { if (sel.has(id)) sel.delete(id); else sel.add(id); } else sel = new Set([id]);
    draw();
  });
  box.addEventListener('mouseover', (e) => { const row = e.target.closest('[data-pick]'); const id = row ? row.dataset.pick : null; if (id !== hover) { hover = id; drawOverlay(); } });
  box.addEventListener('mouseleave', () => { hover = null; drawOverlay(); });
  let dragId = null;
  box.addEventListener('dragstart', (e) => { const row = e.target.closest('[data-pick]'); if (!row) return; dragId = row.dataset.pick; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-perch', '[]'); });
  box.addEventListener('dragover', (e) => { if (!dragId) return; e.preventDefault(); const row = e.target.closest('[data-pick]'); box.querySelectorAll('.drop').forEach((r) => r.classList.remove('drop')); if (row && row.dataset.pick !== dragId) row.classList.add('drop'); });
  box.addEventListener('drop', (e) => {
    e.preventDefault();
    const row = e.target.closest('[data-pick]');
    if (dragId && row && row.dataset.pick !== dragId) {
      commit();
      const from = doc.shapes.findIndex((s) => s.id === dragId), moving = doc.shapes.splice(from, 1)[0];
      const to = doc.shapes.findIndex((s) => s.id === row.dataset.pick);
      doc.shapes.splice(to + 1, 0, moving); // the list is top-first: dropping on a row puts it just above that row
      keep();
    }
    dragId = null; draw();
  });
  box.addEventListener('dragend', () => { dragId = null; box.querySelectorAll('.drop').forEach((r) => r.classList.remove('drop')); });
}

/* ---------- generation by request (iconai.js) ---------- */
let variants = [], AIK = null; // ../lib/iconai.js
const shortModel = (id) => { const m = AIK && AIK.MODELS.find((x) => x.id === id); return m ? m.label.split(' — ')[0].replace(/^Claude /, '') : id; };
async function drawModel() {
  AIK = AIK || await import('../lib/iconai.js');
  const b = el && el.querySelector('[data-ik="model"]');
  if (b) b.innerHTML = `${esc(shortModel(AIK.aiPrefs().model))}${ic('caretD')}`;
}
// the model is chosen right under the prompt (after «Prompt Bar», Beautiful UI): a small menu, the choice is kept
function modelMenu(btn) {
  const old = el.querySelector('.ik-models');
  if (old) { old.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
  const cur = AIK.aiPrefs().model;
  const m = document.createElement('div');
  m.className = 'ik-models';
  m.setAttribute('role', 'menu');
  m.innerHTML = AIK.MODELS.map((x) => {
    const [n, d] = x.label.split(' — ');
    return `<button type="button" role="menuitemradio" aria-checked="${x.id === cur}" data-model="${x.id}"><b>${esc(n.replace(/^Claude /, ''))}</b><span>${esc(d || '')}</span>${x.id === cur ? ic('check') : ''}</button>`;
  }).join('');
  btn.parentElement.after(m);
  btn.setAttribute('aria-expanded', 'true');
  const off = (e) => {
    if (m.contains(e.target) || btn.contains(e.target)) return;
    m.remove(); btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', off, true);
  };
  document.addEventListener('pointerdown', off, true);
  (m.querySelector('[aria-checked="true"]') || m.querySelector('button')).focus();
}
function setModel(id) {
  AIK.setAiPrefs({ model: id });
  const m = el.querySelector('.ik-models'); if (m) m.remove();
  const b = el.querySelector('[data-ik="model"]'); if (b) { b.setAttribute('aria-expanded', 'false'); b.focus(); }
  drawModel();
}

// generation as a trace (after «Thinking», Beautiful UI): the steps with a pixel loader and the seconds while it
// works, then one line «Готово за 14,2 с · 3 варианта» that opens the steps again
const trIcon = (st) => st === 'run' ? pixGrid('drive') : st === 'done' ? ic('check') : st === 'err' ? ic('warnC') : '<i class="ai-wait"></i>';
function trace(steps, head) {
  const t = $('#ikTrace');
  t.querySelector('.ik-tr-steps').innerHTML = steps.map(([st, text]) => `<li class="${st}"><span class="ik-tr-i">${trIcon(st)}</span><span>${esc(text)}</span></li>`).join('');
  if (head) {
    const h = t.querySelector('.ik-tr-h');
    h.innerHTML = `<span class="ik-tr-i">${trIcon(head.state)}</span><span class="ik-tr-l">${esc(head.text)}</span>${ic('caretD')}`;
    h.classList.toggle('err', head.state === 'err');
  }
}
async function gen(btn) {
  const ask = $('#ikAsk').value.trim();
  if (!ask) { $('#ikAsk').focus(); toast('Опишите иконку словами: «умная лампа с Wi-Fi», «календарь с галочкой»'); return; }
  const ai = AIK = AIK || await import('../lib/iconai.js');
  if (!ai.aiPrefs().key) {
    toast(wordsItems.length ? 'Без ключа API рисовать не выйдет — но в библиотеке уже есть похожие: они под полем' : 'Нужен ключ API: Настройки › «ИИ для иконок»', 7000);
    return;
  }
  btn.disabled = true;
  const model = shortModel(ai.aiPrefs().model);
  const t = $('#ikTrace');
  t.hidden = false;
  t.className = 'ik-trace open';
  t.innerHTML = '<button type="button" class="ik-tr-h" data-ik="trace" aria-expanded="true"></button><ol class="ik-tr-steps"></ol>';
  const live = pixLoader('Модель собирает варианты');
  const h = t.querySelector('.ik-tr-h');
  h.append(live.el);
  h.insertAdjacentHTML('beforeend', ic('caretD'));
  const prep = ['done', 'Правила иконок и примеры из библиотеки'];
  let ask1 = ['run', `Запрос к ${model} · обычно 15–40 с`];
  trace([prep, ask1, ['wait', 'Модель смотрит на варианты'], ['wait', 'Проверка по правилам']]);
  $('#ikVars').innerHTML = '';
  try {
    let t1 = '';
    const r = await ai.generateIcons(ask, 3, (text) => {
      if (text.startsWith('Модель смотрит')) {
        t1 = elapsed(live.since());
        live.set('Модель смотрит на варианты');
        trace([prep, ['done', ask1[1].replace(/ · обычно.*/, '') + ' · ' + t1], ['run', 'Модель смотрит на варианты'], ['wait', 'Проверка по правилам']]);
      } else { ask1 = ['run', text.replace('Запрос к модели', `Запрос к ${model}`)]; trace([prep, ask1, ['wait', 'Модель смотрит на варианты'], ['wait', 'Проверка по правилам']]); }
    });
    variants = r.variants;
    const ex = r.examples.total ? `примеры: ${r.examples.mine} ваших из ${r.examples.total}` : 'примеры встроенные — отправьте свои иконки из Figma (плагин › «Иконки»)';
    const looked = ['done', r.redone ? `Модель посмотрела: переделано ${r.redone}` : 'Модель посмотрела: всё похоже на запрос'];
    live.set('Проверяю по правилам');
    const bad = drawVariants(), n = variants.length;
    live.stop();
    t.classList.remove('open');
    trace([['done', 'Правила иконок, ' + ex], ['done', `Ответ ${model} · ${t1}`], looked, ['done', bad ? `Проверка: замечания у ${bad} из ${n}` : 'Проверка: все по правилам']],
      { state: 'done', text: `Готово за ${elapsed(live.since())} · ${n} ${n === 1 ? 'вариант' : n < 5 ? 'варианта' : 'вариантов'}` });
    t.querySelector('.ik-tr-h').setAttribute('aria-expanded', 'false');
    sfx('done');
  } catch (e) {
    live.stop();
    trace([prep, ['err', `Не получилось: ${(e && e.message) || String(e)}`]], { state: 'err', text: `Не получилось · ${elapsed(live.since())}` });
  } finally { btn.disabled = false; }
}
function drawVariants() {
  let worse = 0;
  $('#ikVars').innerHTML = variants.map((v, i) => {
    const r = K.build(v.shapes, 24), bad = K.check(v.shapes, 24).filter((c) => !c.ok).length;
    if (bad) worse++;
    return `<button type="button" class="ik-var" data-var="${i}" title="${esc((v.idea || v.name) + (v.why ? ' · ' + (v.redone ? 'переделано: ' : '') + v.why : ''))} — открыть в конструкторе">
      <span class="ik-var-pic"><svg viewBox="0 0 24 24"><path d="${r.outline}" fill-rule="evenodd"/></svg><svg viewBox="0 0 24 24"><path d="${r.fill}" fill-rule="evenodd"/></svg></span>
      <b>${esc(v.name)}</b><i class="${bad ? 'bad' : 'ok'}">${bad ? 'замечаний: ' + bad : 'по правилам'}</i></button>`;
  }).join('');
  return worse;
}
function useVariant(i) {
  const v = variants[i];
  if (!v) return;
  if (doc.shapes.length) commit();
  doc = { ...doc, name: v.name, keys: v.keys, shapes: v.shapes.map((s) => ({ ...s })) };
  sel.clear(); keep(); draw();
  toast('Вариант «' + v.name + '» в конструкторе — доводите руками, Ctrl+Z вернёт прежнее');
}

/* ---------- out ---------- */
const fileName = () => (doc.name || 'New Icon').replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim() || 'New Icon';
const visible = () => doc.shapes.filter((s) => !s.hidden);

async function copySvg() {
  const r = K.build(visible(), 24);
  if (!r.fill) { toast('Пусто: добавьте фигуру'); return; }
  const text = K.svgOf(doc.style === 'fill' ? r.fill : r.outline, 24);
  try { const { writeText } = await import('@tauri-apps/plugin-clipboard-manager'); await writeText(text); } catch (e) { try { await navigator.clipboard.writeText(text); } catch (e2) { toast('Не удалось скопировать'); return; } }
  sfx('done'); toast('SVG 24 (' + (doc.style === 'fill' ? 'Fill' : 'Outline') + ') скопирован — вставьте в Figma');
}

// every size × both styles, as the library names them: «Name — Size=24, Style=Outline»
async function save() {
  const shapes = visible();
  if (!shapes.length) { toast('Пусто: добавьте фигуру'); return; }
  const bad = K.check(shapes, 24).filter((c) => !c.ok).length;
  const added = await saveIcon(shapes, fileName(), doc.keys);
  ui.refresh();
  sfx('done');
  toast(`«${fileName()}» — ${added} файлов в библиотеке (5 размеров × Outline и Fill)${bad ? '. Есть замечания проверки — посмотрите перед ревью' : ''}`, 7000);
}
// every size × both styles of one icon into the library, tagged «иконка» + its name + its words → number of files
async function saveIcon(shapes, name, keys) {
  const list = [];
  for (const sz of Object.keys(K.SIZES)) {
    const r = K.build(shapes, +sz);
    for (const [style, d] of [['Outline', r.outline], ['Fill', r.fill]]) list.push({ blob: new Blob([K.svgOf(d, +sz)], { type: 'image/svg+xml' }), name: `${name} — Size=${sz}, Style=${style}.svg`, source: '' });
  }
  const { addFromBlobs } = await import('../lib/library.js');
  const tags = ['иконка', name, ...String(keys || '').split(/[,;]+/).map((t) => t.trim()).filter(Boolean)];
  const v = S.view;
  const added = await addFromBlobs(list, { folder: v.type === 'folder' ? v.id : null, tags: [...new Set(tags)] });
  return added.length;
}
// a pack: several SVGs at once — each stylized, put to the rules and saved with every size; the open icon stays as it is.
// Then «Иконки» in the Figma plugin makes component sets of them.
async function stylizePack(files) {
  let ok = 0, warn = 0;
  for (const f of files) {
    const r = K.stylize(await f.text());
    if (!r.shapes.length) continue;
    const fixed = K.fixToRules(r.shapes).shapes;
    const name = f.name.replace(/\.svg$/i, '').replace(/[^A-Za-z0-9 _-]+/g, ' ').replace(/[_-]+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase()) || 'Icon';
    if (K.check(fixed, 24).some((c) => !c.ok)) warn++;
    await saveIcon(fixed, name, '');
    ok++;
  }
  ui.refresh();
  sfx('done');
  toast(`Стилизовано и сохранено: ${ok} ${ok === 1 ? 'иконка' : ok < 5 ? 'иконки' : 'иконок'}${warn ? ` · с замечаниями проверки: ${warn} — откройте их в конструкторе` : ''}. В Figma — плагин Oddments › «Иконки»`, 8000);
}

async function to3d() {
  const r = K.build(visible(), 24);
  if (!r.fill) { toast('Пусто: добавьте фигуру'); return; }
  const text = K.svgOf(doc.style === 'fill' ? r.fill : r.outline, 24);
  closeIconKit();
  const m = await import('./svg3d.js');
  m.openSvg3d({ kind: 'svg', text, name: fileName() });
}
