// «Показ»: a collection (or the selected files) as a presentation for a review or a concept defence — one picture at a
// time, large, its name under it, the comments (notes.js) on it when wanted; ← → to move. «PDF» saves the slides as
// they look (pdf.js), the Figma plugin makes slides of a collection too.
import './show.css';
import { pushLayer, popLayer } from './layers.js';
import { S, folderById } from '../state.js';
import { esc } from '../util.js';
import { ic } from './icons.js';
import { assetUrl } from '../lib/library.js';
import { sfx } from './sound.js';
import { toast, busy, busyDone } from './dialogs.js';
import { notesOf } from './notesblock.js';
import { readPref, writePref } from '../lib/prefs.js';

const PREF = 'perch.show';
const prefs = readPref(PREF, { notes: true });
let el = null, list = [], at = 0, title = '';
export const isShowOpen = () => !!(el && !el.hidden);

// what a slide shows: the original picture, a PSD's render, otherwise the thumbnail (video frame, model render, PDF page)
const picOf = (it) => (it.kind === 'image' && it.file && !/\.(tiff?|heic)$/i.test(it.file) ? it.file : it.preview || it.thumb);
const showable = (it) => it && !it.trashed && !!picOf(it);

function build() {
  el = document.createElement('section');
  el.className = 'shw';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-roledescription', 'презентация');
  el.innerHTML = `<div class="shw-stage"><div class="shw-pic"><img alt=""><svg class="shw-svg" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true"></svg><div class="shw-marks"></div></div></div>` +
    `<div class="shw-cap"><div><h2 class="shw-t"></h2><p class="shw-s"></p></div><ol class="shw-notes"></ol></div>` +
    `<div class="shw-bar glass"><button type="button" class="ib" data-sh="prev" aria-label="Назад" title="Назад (←)">${ic('left')}</button>` +
    `<span class="shw-n cap-sm" aria-live="polite"></span>` +
    `<button type="button" class="ib" data-sh="next" aria-label="Дальше" title="Дальше (→, Пробел)">${ic('right')}</button>` +
    `<button type="button" class="pill ghost" data-sh="notes" title="Комментарии на слайдах (C)">${ic('chat')}<span>Комментарии</span></button>` +
    `<button type="button" class="pill ghost" data-sh="pdf" title="Сохранить слайды в PDF">${ic('download')}<span>PDF</span></button>` +
    `<button type="button" class="ib" data-sh="full" aria-label="Во весь экран" title="Во весь экран (F)">${ic('fitView')}</button>` +
    `<button type="button" class="ib" data-sh="close" aria-label="Закрыть" title="Закрыть (Esc)">${ic('x')}</button></div>`;
  document.body.appendChild(el);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sh]');
    if (!b) { if (e.target.closest('.shw-stage')) go(e.clientX < innerWidth / 3 ? -1 : 1); return; }
    const a = b.dataset.sh;
    if (a === 'prev') go(-1); else if (a === 'next') go(1); else if (a === 'close') closeShow();
    else if (a === 'notes') { prefs.notes = !prefs.notes; writePref(PREF, prefs); draw(); }
    else if (a === 'pdf') savePdf();
    else if (a === 'full') full();
  });
  el.addEventListener('keydown', onKey);
}
function onKey(e) {
  const k = e.key;
  if (k === 'Escape') { e.preventDefault(); if (document.fullscreenElement) document.exitFullscreen(); else closeShow(); }
  else if (k === 'ArrowRight' || k === ' ' || k === 'PageDown') { e.preventDefault(); go(1); }
  else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); go(-1); }
  else if (k === 'Home') { e.preventDefault(); at = 0; draw(); }
  else if (k === 'End') { e.preventDefault(); at = list.length - 1; draw(); }
  else if (e.code === 'KeyC' && !e.ctrlKey) { prefs.notes = !prefs.notes; writePref(PREF, prefs); draw(); }
  else if (e.code === 'KeyF' && !e.ctrlKey) full();
  e.stopPropagation();
}
const full = () => { if (document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen && el.requestFullscreen().catch(() => {}); };
function go(d) {
  const n = Math.max(0, Math.min(list.length - 1, at + d));
  if (n === at) return;
  at = n; sfx('tick'); draw();
}

const marksSvg = (notes) => `<defs><marker id="shwArr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"/></marker></defs>` +
  notes.map((n) => (n.kind === 'box' ? `<rect x="${Math.min(n.x, n.x2) * 1000}" y="${Math.min(n.y, n.y2) * 1000}" width="${Math.abs(n.x2 - n.x) * 1000}" height="${Math.abs(n.y2 - n.y) * 1000}" rx="8"/>`
    : n.kind === 'arrow' ? `<line x1="${n.x * 1000}" y1="${n.y * 1000}" x2="${n.x2 * 1000}" y2="${n.y2 * 1000}" marker-end="url(#shwArr)"/>` : '')).join('');

function draw() {
  const it = list[at];
  if (!it) return;
  const img = el.querySelector('.shw-pic img');
  img.src = assetUrl(picOf(it));
  img.alt = it.name;
  const notes = prefs.notes ? notesOf(it) : [];
  el.querySelector('.shw-svg').innerHTML = marksSvg(notes);
  el.querySelector('.shw-marks').innerHTML = notes.map((n, i) => { const p = n.kind === 'box' ? { x: Math.min(n.x, n.x2), y: Math.min(n.y, n.y2) } : n; return `<span class="shw-m" style="left:${p.x * 100}%;top:${p.y * 100}%">${i + 1}</span>`; }).join('');
  el.querySelector('.shw-t').textContent = it.name.replace(/\.[^.]+$/, '');
  el.querySelector('.shw-s').textContent = [title, it.scr && [it.scr.app, it.scr.type].filter(Boolean).join(' · '), it.url && new URL(it.url, 'https://x').hostname.replace(/^www\./, '')].filter(Boolean).join(' · ');
  el.querySelector('.shw-notes').innerHTML = notes.map((n) => `<li>${esc(n.text)}${n.by ? `<small> — ${esc(n.by)}</small>` : ''}</li>`).join('');
  el.querySelector('.shw-n').textContent = `${at + 1} / ${list.length}`;
  el.querySelector('[data-sh="prev"]').disabled = at === 0;
  el.querySelector('[data-sh="next"]').disabled = at === list.length - 1;
  el.querySelector('[data-sh="notes"]').setAttribute('aria-pressed', String(prefs.notes));
  el.setAttribute('aria-label', `${title}: слайд ${at + 1} из ${list.length}`);
  // the next picture is fetched ahead: the step feels instant
  const nx = list[at + 1];
  if (nx) { const p = new Image(); p.src = assetUrl(picOf(nx)); }
}

/* ---------- PDF: each slide drawn as it looks, 1920×1080 ---------- */
async function slideJpeg(it) {
  const W = 1920, H = 1080, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#0b0c10'; g.fillRect(0, 0, W, H);
  const img = new Image();
  img.src = assetUrl(picOf(it));
  await img.decode();
  const notes = prefs.notes ? notesOf(it) : [];
  const capH = 150, side = notes.length ? 520 : 0, pad = 70;
  const bw = W - pad * 2 - side, bh = H - pad - capH;
  const k = Math.min(bw / img.naturalWidth, bh / img.naturalHeight);
  const w = img.naturalWidth * k, h = img.naturalHeight * k, x = pad + (bw - w) / 2, y = pad / 1.4 + (bh - h) / 2;
  g.drawImage(img, x, y, w, h);
  const lime = '#d7ff63';
  g.strokeStyle = lime; g.fillStyle = lime; g.lineWidth = 4;
  notes.forEach((n, i) => {
    if (n.kind === 'box') { g.beginPath(); g.roundRect(x + Math.min(n.x, n.x2) * w, y + Math.min(n.y, n.y2) * h, Math.abs(n.x2 - n.x) * w, Math.abs(n.y2 - n.y) * h, 10); g.stroke(); }
    else if (n.kind === 'arrow') {
      const x1 = x + n.x * w, y1 = y + n.y * h, x2 = x + n.x2 * w, y2 = y + n.y2 * h, a = Math.atan2(y2 - y1, x2 - x1);
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      g.beginPath(); g.moveTo(x2, y2); g.lineTo(x2 - 22 * Math.cos(a - 0.45), y2 - 22 * Math.sin(a - 0.45)); g.lineTo(x2 - 22 * Math.cos(a + 0.45), y2 - 22 * Math.sin(a + 0.45)); g.fill();
    }
    const p = n.kind === 'box' ? { x: Math.min(n.x, n.x2), y: Math.min(n.y, n.y2) } : n;
    g.beginPath(); g.arc(x + p.x * w, y + p.y * h, 20, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#111'; g.font = '700 20px "Geist Mono Variable", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(i + 1), x + p.x * w, y + p.y * h + 1);
    g.fillStyle = lime;
  });
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillStyle = '#f2f2f5'; g.font = '600 44px "Golos Text Variable", "Golos Text", sans-serif';
  g.fillText(it.name.replace(/\.[^.]+$/, '').slice(0, 70), pad, H - 70);
  g.fillStyle = '#8b8d98'; g.font = '400 26px "Golos Text Variable", "Golos Text", sans-serif';
  g.fillText(`${title}${title ? ' · ' : ''}${list.indexOf(it) + 1} / ${list.length}`, pad, H - 30);
  if (notes.length) {
    let ty = pad + 10;
    g.font = '400 26px "Golos Text Variable", "Golos Text", sans-serif';
    notes.forEach((n, i) => {
      g.fillStyle = lime; g.fillText(`${i + 1}`, W - side + 10, ty);
      g.fillStyle = '#e8e8ec';
      // wrapped to the column by words
      const words = String(n.text).split(/\s+/); let line = '';
      for (const wd of words) { const t = line ? line + ' ' + wd : wd; if (g.measureText(t).width > side - 90 && line) { g.fillText(line, W - side + 50, ty); ty += 36; line = wd; } else line = t; }
      if (line) { g.fillText(line, W - side + 50, ty); ty += 50; }
    });
  }
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), w: W, h: H };
}

async function savePdf() {
  const { imagesToPdf } = await import('../lib/pdf.js');
  const pages = [];
  try {
    for (let i = 0; i < list.length; i++) { busy(`PDF · слайд ${i + 1} из ${list.length}`, (i + 1) / list.length); pages.push(await slideJpeg(list[i])); }
  } catch (e) { busyDone(''); toast('Не удалось нарисовать слайд: ' + ((e && e.message) || e)); return; }
  const bytes = imagesToPdf(pages);
  busyDone('');
  const name = (title || 'Показ').replace(/[\\/:*?"<>|]+/g, '_') + '.pdf';
  if (!window.__TAURI_INTERNALS__) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return;
  }
  const { save } = await import('@tauri-apps/plugin-dialog');
  const path = await save({ defaultPath: name, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (!path) return;
  try {
    const fs = await import('@tauri-apps/plugin-fs');
    await fs.writeFile(path, bytes);
    sfx('done');
    toast(`PDF: ${list.length} слайдов`, 5000, { label: 'Показать', fn: () => import('@tauri-apps/plugin-opener').then((m) => m.revealItemInDir(path)).catch(() => {}) });
  } catch (e) { toast('Не удалось сохранить PDF: ' + ((e && e.message) || e)); }
}

/* ---------- open / close ---------- */
// items: what to show (in this order); name: the presentation's title (a collection's name)
export function openShow(items, name = '', from = 0) {
  list = items.filter(showable);
  if (!list.length) { toast('Показывать нечего: в показе — картинки, кадры видео, рендеры моделей'); return; }
  if (!el) build();
  title = name; at = Math.max(0, Math.min(list.length - 1, from));
  el.hidden = false;
  pushLayer({ el, title: 'Показ', close: closeShow, onKey });
  sfx('open');
  draw();
  el.focus && el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}
export function closeShow() {
  if (!isShowOpen()) return;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  el.hidden = true;
  popLayer(el);
  el.querySelector('.shw-pic img').removeAttribute('src');
  list = [];
  sfx('close');
}

// the current place: the selection when two or more are selected, otherwise everything the grid shows
export function showCurrent() {
  const sel = [...S.sel].map((id) => S.byId.get(id)).filter(Boolean);
  const f = S.view.type === 'folder' && folderById(S.view.id);
  if (sel.length > 1) openShow(S.vis.filter((i) => S.sel.has(i.id)), f ? f.name : 'Выбранное');
  else openShow(S.vis, f ? f.name : '', sel.length === 1 ? S.vis.indexOf(sel[0]) : 0);
}
