// «Исправить SVG»: the chosen SVGs mended by lib/svgfix.js — before and after side by side with their points, what was
// fixed, the strength («Бережно / Обычно / Сильно»). «Сохранить» puts a mended copy next to each original («… — исправлен.svg»,
// same collections and tags, field `fixOf`); files that had nothing to fix are skipped. Originals are not touched.
import './svgfix.css';
import * as fs from '@tauri-apps/plugin-fs';
import { pushLayer, popLayer } from './layers.js';
import { ui } from '../state.js';
import { ic } from './icons.js';
import { toast } from './dialogs.js';
import { sfx } from './sound.js';
import { esc } from '../util.js';
import { absPath, addFromBlobs, saveIndex, trashItems } from '../lib/library.js';
import { fixSvg, reportLines } from '../lib/svgfix.js';
import { readPref, writePref } from '../lib/prefs.js';

const PREF = 'perch.svgfix';
const prefs = readPref(PREF, { strength: 'normal', dots: true });
let el = null, list = [], at = 0, run = 0;
const res = new Map(); // id → { text, out?, error? } for the current strength
export const isSvgFixOpen = () => !!(el && !el.hidden);

function build() {
  el = document.createElement('section');
  el.className = 'sfx';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Исправить SVG');
  el.tabIndex = -1;
  el.innerHTML = `<div class="sfx-bar glass"><span class="orb-t">Исправить SVG</span>` +
    `<span class="sfx-pg"><button type="button" class="ib" data-fx="prev" aria-label="Предыдущий" title="Предыдущий (←)">${ic('left')}</button><span class="sfx-name cap-sm"></span><button type="button" class="ib" data-fx="next" aria-label="Следующий" title="Следующий (→)">${ic('right')}</button></span>` +
    `<span class="sfx-seg" role="group" aria-label="Сила"><button type="button" data-st="soft" title="Края сдвигаются не дальше 0,15 % кадра">Бережно</button><button type="button" data-st="normal" title="Не дальше 0,3 % кадра">Обычно</button><button type="button" data-st="strong" title="Не дальше 0,6 % кадра: сильный шум (обводка трассировкой)">Сильно</button></span>` +
    `<button type="button" class="ibtn flat" data-fx="dots" aria-pressed="false" title="Показать точки (P)">Точки</button>` +
    `<button type="button" class="ibtn pri" data-fx="save" disabled>Сохранить</button>` +
    `<button type="button" class="ib" data-fx="close" aria-label="Закрыть" title="Закрыть (Esc)">${ic('x')}</button></div>` +
    `<div class="sfx-stage"><figure class="sfx-pane"><figcaption class="sfx-lab"></figcaption><div class="sfx-art" data-side="a"></div></figure>` +
    `<figure class="sfx-pane"><figcaption class="sfx-lab"></figcaption><div class="sfx-art" data-side="b"></div></figure></div>` +
    `<ul class="sfx-rep" aria-label="Что исправлено"></ul><p class="sfx-info cap-sm"></p>`;
  document.body.appendChild(el);
  el.addEventListener('click', onClick);
  el.addEventListener('keydown', onKey);
}

function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeSvgFix(); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); step(e.key === 'ArrowLeft' ? -1 : 1); }
  else if (e.code === 'KeyP' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); toggleDots(); }
  else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
  e.stopPropagation();
}

function onClick(e) {
  const b = e.target.closest('[data-fx], [data-st]');
  if (!b || b.disabled) return;
  if (b.dataset.st) { if (b.dataset.st !== prefs.strength) { prefs.strength = b.dataset.st; writePref(PREF, prefs); sfx('tick'); res.clear(); show(); } }
  else if (b.dataset.fx === 'close') closeSvgFix();
  else if (b.dataset.fx === 'save') save();
  else if (b.dataset.fx === 'dots') toggleDots();
  else if (b.dataset.fx === 'prev') step(-1);
  else if (b.dataset.fx === 'next') step(1);
}

function toggleDots() { prefs.dots = !prefs.dots; writePref(PREF, prefs); show(); }
function step(d) { if (list.length < 2) return; at = (at + d + list.length) % list.length; sfx('tick'); show(); }

// one file mended with the current strength (cached until the strength changes)
async function resultOf(it) {
  if (res.has(it.id)) return res.get(it.id);
  const r = {};
  try {
    r.text = await fs.readTextFile(absPath(it.file));
    r.out = fixSvg(r.text, { strength: prefs.strength });
  } catch (e) { r.error = (e && e.message) || String(e); }
  res.set(it.id, r);
  return r;
}

// the drawing as one colour (the file's own colours can be white on white) with its points over it
function art(pv, side) {
  const f = pv.frame, pad = Math.max(f.w, f.h) * 0.04, r = Math.max(f.w, f.h) * 0.006;
  const ds = side === 'a' ? pv.before : pv.after.map((p) => p.d);
  const pts = side === 'a' ? pv.ptsBefore : pv.ptsAfter;
  const shape = ds.map((d) => `<path d="${esc(d)}"/>`).join('');
  const dots = prefs.dots ? `<g class="sfx-dots">${pts.map(([x, y]) => `<circle cx="${+x.toFixed(3)}" cy="${+y.toFixed(3)}" r="${r}"/>`).join('')}</g>` : '';
  return `<svg viewBox="${f.x - pad} ${f.y - pad} ${f.w + 2 * pad} ${f.h + 2 * pad}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><g class="sfx-ink" fill-rule="${side === 'a' ? 'evenodd' : 'nonzero'}" stroke-width="${r * 0.5}">${shape}</g>${dots}</svg>`;
}

async function show() {
  const id = ++run, it = list[at];
  el.querySelector('.sfx-name').textContent = list.length > 1 ? `${it.name} · ${at + 1} из ${list.length}` : it.name;
  el.querySelector('.sfx-pg').classList.toggle('one', list.length < 2);
  el.querySelectorAll('[data-st]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.st === prefs.strength)));
  el.querySelector('[data-fx="dots"]').setAttribute('aria-pressed', String(!!prefs.dots));
  const r = await resultOf(it);
  if (id !== run || !isSvgFixOpen()) return;
  const [la, lb] = el.querySelectorAll('.sfx-lab'), [aa, ab] = el.querySelectorAll('.sfx-art');
  const rep = el.querySelector('.sfx-rep');
  if (r.error) {
    la.textContent = 'Было'; lb.textContent = 'Стало';
    aa.innerHTML = ''; ab.innerHTML = '';
    rep.innerHTML = `<li class="bad">Не удалось исправить: ${esc(r.error)}. Файл остаётся как есть.</li>`;
  } else {
    const o = r.out, rp = o.report;
    la.textContent = `Было · ${rp.before} ${pts(rp.before)}`;
    lb.textContent = `Стало · ${rp.after} ${pts(rp.after)}`;
    aa.innerHTML = art(o.preview, 'a');
    ab.innerHTML = art(o.preview, 'b');
    const lines = reportLines(rp).filter((l) => !l.startsWith('Точек '));
    rep.innerHTML = lines.length ? lines.map((l) => `<li>${esc(l)}</li>`).join('') : '<li class="ok">Ошибок в точках нет — исправлять нечего</li>';
  }
  // what «Сохранить» will do across all chosen files (each mended with this strength)
  const all = await Promise.all(list.map(resultOf));
  if (id !== run || !isSvgFixOpen()) return;
  const todo = all.filter((x) => x.out && x.out.report.changed).length;
  const btn = el.querySelector('[data-fx="save"]');
  btn.disabled = !todo;
  btn.textContent = list.length > 1 ? `Сохранить исправленные (${todo})` : 'Сохранить копию';
  el.querySelector('.sfx-info').textContent = todo
    ? 'Оригинал не меняется — исправленная копия ляжет рядом, с теми же подборками и тегами.' + (list.length > 1 && todo < list.length ? ` Без ошибок: ${list.length - todo} — их не трогаю.` : '')
    : 'В выбранном исправлять нечего.';
}
const pts = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'точка' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'точки' : 'точек');

async function save() {
  const btn = el.querySelector('[data-fx="save"]');
  if (btn.disabled) return;
  btn.disabled = true;
  const made = [];
  try {
    for (const it of list) {
      const r = await resultOf(it);
      if (!r.out || !r.out.report.changed) continue;
      const base = it.name.replace(/\.svg$/i, '');
      const blob = new Blob([r.out.svg], { type: 'image/svg+xml' });
      const [copy] = await addFromBlobs([{ blob, name: `${base} — исправлен.svg`, source: it.url || '' }], { folder: (it.folders || [])[0] || null });
      if (!copy) continue;
      copy.folders = [...new Set([...(copy.folders || []), ...(it.folders || [])])];
      copy.tags = [...new Set([...(copy.tags || []), ...(it.tags || [])])];
      copy.fixOf = it.id; // optional field: which file this is a mended copy of
      made.push(copy);
    }
    if (!made.length) throw new Error('копии не добавились');
    saveIndex();
    sfx('add');
    toast(made.length === 1 ? `Исправленная копия: «${made[0].name}»` : `Исправленных копий: ${made.length}`, 5000, { fn: () => { trashItems(made); ui.refresh(); } });
    ui.refresh();
    closeSvgFix();
  } catch (e) {
    btn.disabled = false;
    if (made.length) { saveIndex(); ui.refresh(); }
    toast('Не удалось сохранить исправленный SVG: ' + ((e && e.message) || e) + '. Оригиналы не тронуты.', 6000);
  }
}

export function openSvgFix(items) {
  const svgs = (items || []).filter((i) => i.ext === 'svg' && !i.trashed);
  if (!svgs.length) { toast('Исправить можно SVG-файлы'); return; }
  if (!el) build();
  list = svgs; at = 0;
  res.clear();
  el.hidden = false;
  pushLayer({ el, title: 'Исправить SVG', close: closeSvgFix, onKey });
  sfx('open');
  show();
  el.focus({ preventScroll: true });
}

export function closeSvgFix() {
  if (!isSvgFixOpen()) return;
  run++;
  el.hidden = true;
  popLayer(el);
  res.clear();
  list = [];
  sfx('close');
}
