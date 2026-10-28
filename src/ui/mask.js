// «Скрыть личные данные»: a review window over everything. The picture with what pii.js found on it — card numbers,
// phones, names, sums… — already hidden; a click on a place shows it again (or hides it back), dragging over the
// picture hides a place of one's own (a face, a name on an avatar the text reader cannot know). «Сохранить копию»
// puts the hidden-data copy next to the original (masker.js); the original is not touched.
// Several pictures go one after another («Пропустить» moves on).
import './mask.css';
import { pushLayer, popLayer } from './layers.js';
import { S, ui } from '../state.js';
import { esc, plural } from '../util.js';
import { ic } from './icons.js';
import { toast } from './dialogs.js';
import { sfx } from './sound.js';
import { pixLoader } from './pixload.js';
import { KINDS } from '../lib/pii.js';
import { findRegions, maskToBlob, paint, saveMaskedCopy, canMask } from '../lib/masker.js';
import { readPref, writePref } from '../lib/prefs.js';

const PREF = 'perch.mask';
const prefs = readPref(PREF, { mode: 'pixel', sums: true });
let el = null, queue = [], at = 0, cur = null, img = null, regions = [], busy = false, loader = null, drag = null, picUrl = '';
const dropUrl = () => { if (picUrl) URL.revokeObjectURL(picUrl); picUrl = ''; };
export const isMaskOpen = () => !!(el && !el.hidden);

function build() {
  el = document.createElement('section');
  el.className = 'msk';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Скрыть личные данные');
  el.innerHTML = `<div class="msk-bar glass"><span class="orb-t">Скрыть личные данные</span>` +
    `<span class="msk-name cap-sm"></span><span class="msk-n cap-sm"></span>` +
    `<span class="msk-seg" role="group" aria-label="Как скрывать"><button type="button" data-mode="pixel">Пикселями</button><button type="button" data-mode="fill">Заливкой</button></span>` +
    `<button type="button" class="ibtn flat" data-mk="skip" hidden>Пропустить</button>` +
    `<button type="button" class="ibtn pri" data-mk="save" disabled>Сохранить копию</button>` +
    `<button type="button" class="ib" data-mk="close" aria-label="Закрыть" title="Закрыть (Esc)">${ic('x')}</button></div>` +
    `<div class="msk-stage"><div class="msk-pic"><canvas></canvas><div class="msk-boxes"></div></div><div class="msk-wait"></div></div>` +
    `<aside class="msk-side glass" aria-label="Что скрыто"></aside>`;
  document.body.appendChild(el);
  el.addEventListener('click', onClick);
  el.addEventListener('keydown', onKey);
  const pic = el.querySelector('.msk-pic');
  pic.addEventListener('pointerdown', startDrag);
  pic.addEventListener('pointermove', moveDrag);
  pic.addEventListener('pointerup', endDrag);
  pic.addEventListener('pointercancel', () => { drag = null; drawBoxes(); });
}

function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeMask(); }
  else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
  e.stopPropagation(); // the wall's keys stay off
}

function onClick(e) {
  const b = e.target.closest('[data-mk], [data-mode], [data-kind], [data-r]');
  if (!b) return;
  if (b.dataset.mk === 'close') closeMask();
  else if (b.dataset.mk === 'save') save();
  else if (b.dataset.mk === 'skip') next();
  else if (b.dataset.mk === 'sums') { prefs.sums = !prefs.sums; writePref(PREF, prefs); regions.filter((r) => r.kind === 'sum').forEach((r) => { r.on = prefs.sums; }); redraw(); }
  else if (b.dataset.mode) { prefs.mode = b.dataset.mode; writePref(PREF, prefs); sfx('tick'); redraw(); }
  else if (b.dataset.kind) {
    const k = b.dataset.kind, all = regions.filter((r) => r.kind === k), on = !all.every((r) => r.on);
    all.forEach((r) => { r.on = on; });
    sfx(on ? 'on' : 'off'); redraw();
  } else if (b.dataset.r != null) {
    const r = regions[+b.dataset.r];
    if (r.kind === 'manual' && r.on) regions.splice(+b.dataset.r, 1); else r.on = !r.on;
    sfx(r.on ? 'on' : 'off'); redraw();
  }
}

/* ---------- drawing a place of one's own ---------- */
const rel = (e) => {
  const c = el.querySelector('.msk-pic canvas').getBoundingClientRect();
  return { x: Math.min(1, Math.max(0, (e.clientX - c.left) / c.width)), y: Math.min(1, Math.max(0, (e.clientY - c.top) / c.height)) };
};
function startDrag(e) {
  if (!img || e.button !== 0 || e.target.closest('[data-r]')) return;
  e.preventDefault();
  e.currentTarget.setPointerCapture(e.pointerId);
  drag = { a: rel(e), b: rel(e) };
}
function moveDrag(e) { if (!drag) return; drag.b = rel(e); drawBoxes(); }
function endDrag() {
  if (!drag) return;
  const { a, b } = drag;
  drag = null;
  const r = { kind: 'manual', text: '', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y), on: true };
  if (r.w * img.naturalWidth > 6 && r.h * img.naturalHeight > 6) { regions.push(r); sfx('on'); }
  redraw();
}

/* ---------- the picture ---------- */
function redraw() {
  if (!img) return;
  const c = el.querySelector('.msk-pic canvas'), g = c.getContext('2d', { willReadFrequently: true });
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  g.drawImage(img, 0, 0);
  paint(g, img, regions.filter((r) => r.on), prefs.mode);
  el.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === prefs.mode)));
  drawBoxes();
  drawSide();
}

function drawBoxes() {
  const box = (r, i) => `<button type="button" class="msk-r${r.on ? ' on' : ''}${r.kind === 'manual' ? ' own' : ''}" data-r="${i}" style="left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%"` +
    ` aria-pressed="${r.on}" aria-label="${esc((KINDS[r.kind] || 'своя область') + (r.on ? ': скрыто' : ': видно'))}" title="${r.kind === 'manual' ? 'Своя область — щелчок убирает' : esc(KINDS[r.kind]) + (r.on ? ' — щелчок показывает' : ' — щелчок скрывает')}"></button>`;
  let h = regions.map(box).join('');
  if (drag) {
    const { a, b } = drag;
    h += `<i class="msk-draft" style="left:${Math.min(a.x, b.x) * 100}%;top:${Math.min(a.y, b.y) * 100}%;width:${Math.abs(a.x - b.x) * 100}%;height:${Math.abs(a.y - b.y) * 100}%"></i>`;
  }
  el.querySelector('.msk-boxes').innerHTML = h;
}

function drawSide(state) {
  const side = el.querySelector('.msk-side');
  const save = el.querySelector('[data-mk="save"]');
  if (state) { side.innerHTML = state; save.disabled = true; return; }
  const by = new Map();
  for (const r of regions) { if (!by.has(r.kind)) by.set(r.kind, []); by.get(r.kind).push(r); }
  const rows = [...by].map(([k, list]) => {
    const on = list.filter((r) => r.on).length;
    return `<button type="button" class="msk-k" data-kind="${k}" aria-pressed="${on === list.length}"><span class="msk-chk">${on ? ic('check') : ''}</span>` +
      `<span>${esc(k === 'manual' ? 'Свои области' : KINDS[k][0].toUpperCase() + KINDS[k].slice(1))}</span><span class="msk-c">${on} из ${list.length}</span></button>`;
  }).join('');
  const n = regions.filter((r) => r.on).length;
  side.innerHTML = `<h3 class="msk-h">Скрыто: ${n}</h3>` +
    (rows || '<p class="msk-p">Личных данных в тексте не нашлось.</p>') +
    `<label class="msk-sw"><input type="checkbox" data-mk="sums"${prefs.sums ? ' checked' : ''}> Скрывать суммы и балансы</label>` +
    `<p class="msk-p">Тяните по картинке, чтобы скрыть своё: лицо, подпись, аватарку. Щелчок по месту показывает его снова.</p>` +
    `<p class="msk-p mut">Находится по тексту на картинке. Проверьте глазами: имена на фото и рукописное не читаются.</p>`;
  save.disabled = !n || busy;
}

/* ---------- open / one picture after another ---------- */
export async function openMask(items) {
  queue = items.filter(canMask);
  if (!queue.length) { toast('Скрыть данные можно только на картинках и PSD'); return; }
  if (!el) build();
  at = 0;
  el.hidden = false;
  pushLayer({ el, title: 'Скрыть личные данные', close: closeMask, onKey });
  sfx('open');
  await show();
}

async function show() {
  cur = queue[at];
  img = null; regions = [];
  el.querySelector('.msk-name').textContent = cur.name;
  el.querySelector('.msk-n').textContent = queue.length > 1 ? `${at + 1} из ${queue.length}` : '';
  el.querySelector('[data-mk="skip"]').hidden = queue.length < 2;
  el.querySelector('.msk-pic').hidden = true;
  const wait = el.querySelector('.msk-wait');
  wait.hidden = false;
  if (loader) loader.stop();
  loader = pixLoader('Ищу личные данные на картинке…');
  wait.replaceChildren(loader.el);
  drawSide('<p class="msk-p">Читаю текст на картинке…</p>');
  const id = cur.id;
  dropUrl();
  let found;
  try { found = await findRegions(cur, { sums: true }); } catch (e) {
    if (loader) { loader.stop(); loader = null; }
    drawSide(`<p class="msk-p">Файл не прочитался: ${esc((e && e.message) || 'неизвестная ошибка')}. Оригинал не тронут.</p>`);
    return;
  }
  picUrl = found.url;
  if (!isMaskOpen() || !cur || cur.id !== id) return;
  regions = found.regions.map((r) => ({ ...r, on: r.kind === 'sum' ? prefs.sums : true }));
  try {
    img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = found.url;
    await img.decode();
  } catch (e) {
    img = null;
    if (loader) { loader.stop(); loader = null; }
    drawSide(`<p class="msk-p">Картинка не открылась: ${esc((e && e.message) || 'неизвестная ошибка')}.</p>`);
    return;
  }
  if (!isMaskOpen() || cur.id !== id) return;
  if (loader) { loader.stop(); loader = null; }
  wait.hidden = true;
  el.querySelector('.msk-pic').hidden = false;
  el.querySelector('.msk-pic').style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
  redraw();
  if (!found.ok) {
    el.querySelector('.msk-side').insertAdjacentHTML('afterbegin', found.why === 'off'
      ? '<p class="msk-p warn">Чтение текста на картинках выключено (Настройки › ИИ) — найти данные само не может. Отметьте места вручную.</p>'
      : `<p class="msk-p warn">Текст не прочитался: ${esc(found.why)}. Отметьте места вручную.</p>`);
  }
}

async function save() {
  if (busy || !img || !cur) return;
  const on = regions.filter((r) => r.on);
  if (!on.length) return;
  busy = true; drawSide();
  try {
    const blob = await maskToBlob(img.src, on, prefs.mode);
    const copy = await saveMaskedCopy(cur, blob);
    if (!copy) throw new Error('копия не добавилась');
    sfx('done');
    toast(`Копия без личных данных: «${copy.name}»`, 4000);
    ui.refresh();
  } catch (e) {
    toast('Не удалось сохранить копию: ' + ((e && e.message) || e) + '. Оригинал не тронут.', 6000);
    busy = false; drawSide();
    return;
  }
  busy = false;
  next();
}

function next() {
  if (at + 1 < queue.length) { at++; show(); } else closeMask();
}

export function closeMask() {
  if (!isMaskOpen()) return;
  if (loader) { loader.stop(); loader = null; }
  el.hidden = true;
  popLayer(el);
  queue = []; cur = null; img = null; regions = [];
  dropUrl();
  el.querySelector('.msk-pic canvas').width = 1;
  sfx('close');
}

// the count of pictures with personal data among some items (the export asks about them first)
export const withPii = (items) => items.filter((i) => i.pii && i.pii.length && !i.masked);
export const piiLabel = (it) => (it.pii || []).map((k) => KINDS[k] || k).join(', ');
export const piiCount = (n) => `${n} ${plural(n, ['картинка', 'картинки', 'картинок'])} с личными данными`;
